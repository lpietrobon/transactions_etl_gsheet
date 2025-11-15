const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { loadAppsScript } = require('./loadAppsScript');

function parseDateByPattern(text, pattern) {
  const value = String(text).trim();
  const monthNames = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    sept: 8,
    oct: 9,
    nov: 10,
    dec: 11
  };

  if (pattern === 'MM/dd/yyyy' || pattern === 'M/d/yyyy') {
    const parts = value.split('/').map(p => p.trim());
    if (parts.length !== 3) throw new Error('Invalid date');
    const [month, day, year] = parts.map(Number);
    if (!month || !day || !year) throw new Error('Invalid date');
    return new Date(year, month - 1, day);
  }

  if (pattern === 'yyyy-MM-dd') {
    const parts = value.split('-').map(p => p.trim());
    if (parts.length !== 3) throw new Error('Invalid date');
    const [year, month, day] = parts.map(Number);
    if (!year || !month || !day) throw new Error('Invalid date');
    return new Date(year, month - 1, day);
  }

  if (pattern === 'dd-MMM-yyyy' || pattern === 'd-MMM-yyyy') {
    const parts = value.split('-');
    if (parts.length !== 3) throw new Error('Invalid date');
    const [dayStr, monthStr, yearStr] = parts;
    const month = monthNames[monthStr.toLowerCase()];
    if (month == null) throw new Error('Invalid date');
    const day = Number(dayStr);
    const year = Number(yearStr);
    if (!day || !year) throw new Error('Invalid date');
    return new Date(year, month, day);
  }

  throw new Error(`Unsupported pattern ${pattern}`);
}

function createUtilitiesMock() {
  return {
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    computeDigest: (algorithm, value) => {
      assert.equal(algorithm, 'SHA_256');
      const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
      return Array.from(crypto.createHash('sha256').update(buffer).digest());
    },
    parseDate: (text, timezone, pattern) => {
      assert.equal(timezone, 'America/Los_Angeles');
      return parseDateByPattern(text, pattern);
    }
  };
}

function loadContext() {
  return loadAppsScript(['config.gs', 'ingestion.gs'], {
    Utilities: createUtilitiesMock()
  });
}

// Verifies header normalization, byte-to-hex conversion, and SHA-256 hashing stay consistent.
test('normalizeHeader_, bytesToHex_, and headerHash_ produce normalized SHA-256', () => {
  const ctx = loadContext();
  const { normalizeHeader_, bytesToHex_, headerHash_ } = ctx;

  assert.equal(normalizeHeader_('  Posting   Date  '), 'posting date');
  assert.equal(bytesToHex_([0, 15, 16, 255]), '000f10ff');
  assert.equal(bytesToHex_([-1, 128]), 'ff80');

  const header = [' Date ', 'Description', 'Amount '];
  const expected = crypto
    .createHash('sha256')
    .update('date|description|amount')
    .digest('hex');
  assert.equal(headerHash_(header), `sha256:${expected}`);
});

// Confirms flexible date parsing works across configured patterns and rejects invalid input.
test('parseDateFlexible_ covers configured formats and fallback parsing', () => {
  const ctx = loadContext();
  const { parseDateFlexible_ } = ctx;

  assert.equal(parseDateFlexible_('02/01/2023', ['MM/dd/yyyy']), '2023-02-01');
  assert.equal(parseDateFlexible_('2/9/2023', ['M/d/yyyy']), '2023-02-09');
  assert.equal(parseDateFlexible_('10-Jan-2024', ['dd-MMM-yyyy']), '2024-01-10');
  assert.equal(parseDateFlexible_('2023-03-15', ['MM/dd/yyyy']), '2023-03-15');
  assert.throws(() => parseDateFlexible_('not-a-date', ['MM/dd/yyyy']), /Unparseable date/);
});

// Checks monetary normalization handles sign conventions and derives deposit/withdrawal fields.
test('normalizeMonetaryFields_ normalizes withdrawals, deposits, and amount helper field', () => {
  const ctx = loadContext();
  const { normalizeMonetaryFields_ } = ctx;

  const record = { withdrawal: '(1,234.56)', deposit: '$789.10', amount: '' };
  normalizeMonetaryFields_(record, { signConvention: 'raw_sign' });
  assert.equal(record.withdrawal, 1234.56);
  assert.equal(record.deposit, 789.1);
  assert.equal(record.amount, undefined);

  const amountRecord = { amount: '(200.00)' };
  normalizeMonetaryFields_(amountRecord, { signConvention: 'expenses_negative' });
  assert.equal(amountRecord.withdrawal, 200);
  assert.equal(amountRecord.deposit, '');
  assert.equal(amountRecord.amount, undefined);

  const depositRecord = { amount: '150.25' };
  normalizeMonetaryFields_(depositRecord, { signConvention: 'raw_sign' });
  assert.equal(depositRecord.deposit, 150.25);
  assert.equal(depositRecord.withdrawal, '');
});

// Ensures CSV mapping populates defaults, prefixes duplicates, and filters existing keys.
test('mapCsvRowsToTarget_ applies defaults, duplicate prefix, and dedupe keys', () => {
  const ctx = loadContext();
  const { mapCsvRowsToTarget_, buildKey_, buildExistingKeySet_, __runInContext } = ctx;
  const duplicatePrefix = __runInContext('CFG.DUPLICATE_TRANSACTION_AT_INGESTION_PREFIX');
  const targetSchema = __runInContext('CFG.TARGET_SCHEMA');

  const header = ['Date', 'Description', 'Amount'];
  const rows = [
    header,
    ['2023-05-01', 'Coffee', '-3.50'],
    ['2023-05-01', 'Coffee', '-3.50'],
    ['2023-05-02', 'Paycheck', '1,000.00']
  ];

  const cfg = {
    accountName: 'MyChecking',
    financialInstitutionName: 'Sample Bank',
    dateFormats: ['yyyy-MM-dd'],
    signConvention: 'raw_sign',
    mapping: {
      Date: 'date',
      Description: 'description',
      Amount: 'amount'
    }
  };

  const result = mapCsvRowsToTarget_(rows, header, cfg, 'example.csv');
  assert.equal(result.errors.length, 0);
  assert.equal(result.records.length, 3);

  const [first, second, third] = result.records;
  assert.equal(first.account_name, 'MyChecking');
  assert.equal(first.financial_institution, 'Sample Bank');
  assert.equal(first.source_file, 'example.csv');
  assert.equal(first.description, 'Coffee');
  assert.equal(first.withdrawal, 3.5);
  assert.equal(first.deposit, '');

  assert.equal(second.description.startsWith(duplicatePrefix), true);
  assert.equal(second.withdrawal, 3.5);

  assert.equal(third.deposit, 1000);
  assert.equal(third.withdrawal, '');

  const sheetValues = [
    targetSchema,
    [
      'MyChecking',
      'Sample Bank',
      '2023-05-01',
      '',
      'Coffee',
      '3.5',
      '',
      '',
      '',
      'example.csv'
    ]
  ];

  const fakeSheet = {
    getLastRow: () => sheetValues.length,
    getLastColumn: () => sheetValues[0].length,
    getRange: () => ({ getValues: () => sheetValues })
  };

  const existingKeys = buildExistingKeySet_(fakeSheet);
  assert.equal(existingKeys.has(buildKey_(first)), true);

  const deduped = result.records.filter(r => !existingKeys.has(buildKey_(r)));
  assert.equal(deduped.map(r => r.description).join('|'), '[Possible Duplicate] Coffee|Paycheck');

  deduped.forEach(r => existingKeys.add(buildKey_(r)));
  const secondPass = result.records.filter(r => !existingKeys.has(buildKey_(r)));
  assert.equal(secondPass.length, 0);
});
