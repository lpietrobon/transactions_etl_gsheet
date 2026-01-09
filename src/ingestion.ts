import { CFG, CONFIGS_BY_HEADER_HASH } from './config';
import { bytesToHex, formatISODate, normalizeHeader, notifyAlert, notifyInfo, stringifyError } from './core';
import { buildExistingKeys, createHeaderIndex, ensureSheetWithHeaders } from './sheets';

export function ingestCSVs() {
  try {
    const sheet = ensureSheetWithHeaders(CFG.TARGET_SHEET_NAME, CFG.TARGET_SCHEMA);
    const folder = DriveApp.getFolderById(CFG.RAW_FOLDER_ID);
    const files = folder.getFilesByType(MimeType.CSV);
    const existingKeys = buildExistingKeys(sheet, buildKey);

    const processed = [];
    const problems = [];
    const counts = {};

    while (files.hasNext()) {
      const file = files.next();
      const res = processSingleCSVFile(file, existingKeys);
      if (res.ok) {
        processed.push(file.getName());
        counts[file.getName()] = res.rowsAppended;
        archiveFileIfConfigured(file);
      } else {
        problems.push(`${file.getName()} → ${res.reason}`);
      }
    }

    if (problems.length) {
      notifyAlert('[CSV Import] Some files could not be mapped', problems.join('\n'));
    }
    if (processed.length) {
      notifyInfo('[CSV Import] Done:\n' + processed.map(n => `• ${n}: ${counts[n]} new rows`).join('\n'));
    } else {
      notifyInfo('[CSV Import] No CSVs found.');
    }
  } catch (error) {
    notifyAlert('[CSV Import] Fatal error', stringifyError(error));
    throw error;
  }
}

export function computeHeaderHash(headerRow) {
  const normalized = headerRow.map(header => normalizeHeader(header)).join('|');
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, normalized);
  return `sha256:${bytesToHex(digest)}`;
}

export function mapRowToRecord(rawRow, headerIndex, cfg, sourceFileName, seenWithinCsv) {
  const record = emptyTargetRecord();
  record.source_file = sourceFileName;

  for (const [srcHeader, targetField] of Object.entries(cfg.mapping)) {
    const idx = headerIndex[normalizeHeader(srcHeader)];
    if (idx == null) continue;
    record[targetField] = String(rawRow[idx]).trim();
  }

  record.date = parseDateFlexible(record.date, cfg.dateFormats);
  normalizeMonetaryFields(record, cfg);

  record.description = record.description || '';
  record.account_name = record.account_name || (cfg.accountName || '');
  record.financial_institution = record.financial_institution || (cfg.financialInstitutionName || '');
  record.type = record.type || '';
  record.check_number = record.check_number || '';
  record.category = record.category || '';

  const baseKey = buildKey(record);
  if (seenWithinCsv.has(baseKey)) {
    const prefix = CFG.DUPLICATE_TRANSACTION_AT_INGESTION_PREFIX || '[Possible Duplicate] ';
    record.description = prefix + record.description;
  } else {
    seenWithinCsv.add(baseKey);
  }

  return record;
}

export function buildRowFromRecord(record) {
  return CFG.TARGET_SCHEMA.map(col => record[col] ?? '');
}

export function archiveFileIfConfigured(file) {
  if (!CFG.ARCHIVE_FOLDER_ID) return;
  try {
    const archive = DriveApp.getFolderById(CFG.ARCHIVE_FOLDER_ID);
    archive.addFile(file);
    const parents = file.getParents();
    if (parents.hasNext()) parents.next().removeFile(file);
  } catch (error) {
    notifyAlert('[CSV Import] Failed to archive file', `${file.getName()}\n\n${stringifyError(error)}`);
  }
}

function processSingleCSVFile(file, existingKeysSet) {
  try {
    const text = file.getBlob().getDataAsString('UTF-8');
    const rows = Utilities.parseCsv(text);
    if (!rows || rows.length === 0) {
      return { ok: false, rowsAppended: 0, reason: 'Empty or unreadable CSV' };
    }

    const header = rows[0].map(s => String(s).trim());
    const hash = computeHeaderHash(header);
    const cfg = CONFIGS_BY_HEADER_HASH[hash];
    if (!cfg) {
      return { ok: false, rowsAppended: 0, reason: `Unknown header hash: ${hash}\nHeader: [${header.join(' | ')}]` };
    }

    const mapped = mapCsvRowsToTarget(rows, header, cfg, file.getName());
    if (mapped.errors.length) {
      notifyAlert(`[CSV Import] Row mapping issues in ${file.getName()}`, mapped.errors.slice(0, 30).join('\n'));
    }

    const deduped = mapped.records.filter(r => !existingKeysSet.has(buildKey(r)));
    appendRecords(deduped);
    deduped.forEach(r => existingKeysSet.add(buildKey(r)));

    return { ok: true, rowsAppended: deduped.length, reason: '' };
  } catch (error) {
    notifyAlert(`[CSV Import] Exception for "${file.getName()}"`, stringifyError(error));
    return { ok: false, rowsAppended: 0, reason: 'Exception thrown; see alert' };
  }
}

function mapCsvRowsToTarget(rows, header, cfg, sourceFileName) {
  const headerIndex = createHeaderIndex(header);
  const records = [];
  const errors = [];
  const seenWithinCsv = new Set();

  for (let r = 1; r < rows.length; r++) {
    const raw = rows[r];
    if (raw.every(cell => String(cell).trim() === '')) continue;

    try {
      const record = mapRowToRecord(raw, headerIndex, cfg, sourceFileName, seenWithinCsv);
      records.push(record);
    } catch (rowError) {
      errors.push(`Row ${r + 1}: ${stringifyError(rowError)}`);
    }
  }

  return { records, errors };
}

function emptyTargetRecord() {
  const obj = {};
  CFG.TARGET_SCHEMA.forEach(k => {
    obj[k] = '';
  });
  return obj;
}

function parseDateFlexible(value, formats) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  for (const fmt of (formats || [])) {
    const parsed = tryParseDate(raw, fmt);
    if (parsed) return formatISODate(parsed);
  }
  const fallback = new Date(raw);
  if (!isNaN(fallback.getTime())) return formatISODate(fallback);
  throw new Error(`Unparseable date "${raw}"`);
}

function tryParseDate(text, pattern) {
  try {
    return Utilities.parseDate(text, CFG.TIMEZONE, pattern);
  } catch (error) {
    return null;
  }
}

function normalizeAmount(value, signConvention) {
  let s = String(value || '').replace(/[$,]/g, '').trim();
  if (s === '') return 0;
  const parenNeg = /^\((.*)\)$/.test(s);
  if (parenNeg) s = s.replace(/^\(|\)$/g, '');
  let n = Number(s);
  if (isNaN(n)) throw new Error(`Unparseable amount "${value}"`);
  if (parenNeg) n = -Math.abs(n);
  if (signConvention === 'expenses_negative') return n;
  return n;
}

function normalizeMonetaryFields(record, cfg) {
  const hasWithdrawal = String(record.withdrawal || '').trim() !== '';
  const hasDeposit = String(record.deposit || '').trim() !== '';
  if (hasWithdrawal) {
    const withdrawal = Math.abs(normalizeAmount(record.withdrawal, 'raw_sign'));
    record.withdrawal = withdrawal === 0 ? '' : withdrawal;
  } else {
    record.withdrawal = '';
  }

  if (hasDeposit) {
    const deposit = Math.abs(normalizeAmount(record.deposit, 'raw_sign'));
    record.deposit = deposit === 0 ? '' : deposit;
  } else {
    record.deposit = '';
  }

  const amountSource = String(record.amount || '').trim();
  if (!hasWithdrawal && !hasDeposit && amountSource !== '') {
    const amount = normalizeAmount(amountSource, cfg.signConvention);
    if (amount < 0) {
      const value = Math.abs(amount);
      record.withdrawal = value === 0 ? '' : value;
      record.deposit = '';
    } else if (amount > 0) {
      const value = Math.abs(amount);
      record.deposit = value === 0 ? '' : value;
      record.withdrawal = '';
    } else {
      record.withdrawal = '';
      record.deposit = '';
    }
  }

  delete record.amount;
}

function buildKey(record) {
  const date = normalizeDateForKey(record.date);
  const deposit = Number(record.deposit || 0).toFixed(2);
  const withdrawal = Number(record.withdrawal || 0).toFixed(2);
  const desc = (record.description || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const acct = (record.account_name || '').toLowerCase().trim();
  const type = (record.type || '').toLowerCase().trim();
  return [date, withdrawal, deposit, desc, acct, type].join(' | ');
}

function normalizeDateForKey(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return formatISODate(value);
  }
  return String(value || '').trim();
}

function appendRecords(records) {
  if (!records || records.length === 0) return;
  const sheet = ensureSheetWithHeaders(CFG.TARGET_SHEET_NAME, CFG.TARGET_SCHEMA);
  const rows = records.map(buildRowFromRecord);
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, CFG.TARGET_SCHEMA.length).setValues(rows);
}
