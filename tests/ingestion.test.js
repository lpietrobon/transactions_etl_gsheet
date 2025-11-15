const { describe, it } = require('node:test');
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

describe('ingestion helpers', () => {
  describe('header normalization & hashing', () => {
    // Validates whitespace normalization before hashing to ensure deterministic keying.
    it('normalizes header cells prior to hashing', () => {
      const { normalizeHeader_, headerHash_ } = loadContext();

      assert.equal(normalizeHeader_('  Posting   Date  '), 'posting date');

      const header = [' Date ', 'Description', 'Amount '];
      const expected = crypto
        .createHash('sha256')
        .update('date|description|amount')
        .digest('hex');
      assert.equal(headerHash_(header), `sha256:${expected}`);
    });

    // Ensures the byte-to-hex helper handles signed bytes from Apps Script digests.
    it('converts byte arrays to lowercase hexadecimal strings', () => {
      const { bytesToHex_ } = loadContext();

      assert.equal(bytesToHex_([0, 15, 16, 255]), '000f10ff');
      assert.equal(bytesToHex_([-1, 128]), 'ff80');
    });
  });

  describe('parseDateFlexible_', () => {
    // Exercises the supported pattern list and fallback Date constructor parsing.
    it('parses configured formats and falls back to native Date parsing', () => {
      const { parseDateFlexible_ } = loadContext();

      assert.equal(parseDateFlexible_('02/01/2023', ['MM/dd/yyyy']), '2023-02-01');
      assert.equal(parseDateFlexible_('2/9/2023', ['M/d/yyyy']), '2023-02-09');
      assert.equal(parseDateFlexible_('10-Jan-2024', ['dd-MMM-yyyy']), '2024-01-10');
      assert.equal(parseDateFlexible_('2023-03-15', ['MM/dd/yyyy']), '2023-03-15');
    });

    // Confirms invalid strings bubble an error instead of silently defaulting.
    it('rejects values that cannot be parsed', () => {
      const { parseDateFlexible_ } = loadContext();

      assert.throws(() => parseDateFlexible_('not-a-date', ['MM/dd/yyyy']), /Unparseable date/);
    });
  });

  describe('normalizeMonetaryFields_', () => {
    // Verifies raw withdrawal/deposit values normalize commas, currency symbols, and parentheses.
    it('normalizes withdrawal and deposit fields', () => {
      const { normalizeMonetaryFields_ } = loadContext();

      const record = { withdrawal: '(1,234.56)', deposit: '$789.10', amount: '' };
      normalizeMonetaryFields_(record, { signConvention: 'raw_sign' });
      assert.equal(record.withdrawal, 1234.56);
      assert.equal(record.deposit, 789.1);
      assert.equal(record.amount, undefined);
    });

    // Confirms the helper derives fields from the "amount" helper according to sign conventions.
    it('derives deposit/withdrawal from amount helper field', () => {
      const { normalizeMonetaryFields_ } = loadContext();

      const expenseRecord = { amount: '(200.00)' };
      normalizeMonetaryFields_(expenseRecord, { signConvention: 'expenses_negative' });
      assert.equal(expenseRecord.withdrawal, 200);
      assert.equal(expenseRecord.deposit, '');
      assert.equal(expenseRecord.amount, undefined);

      const depositRecord = { amount: '150.25' };
      normalizeMonetaryFields_(depositRecord, { signConvention: 'raw_sign' });
      assert.equal(depositRecord.deposit, 150.25);
      assert.equal(depositRecord.withdrawal, '');
    });
  });

  describe('mapCsvRowsToTarget_', () => {
    // Exercises duplicate-prefixing, schema defaults, and filtering existing keys.
    it('applies defaults, prefixes duplicates, and skips already-known keys', () => {
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
  });
});
