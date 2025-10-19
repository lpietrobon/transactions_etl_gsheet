/***** CSV INGESTION (Drive → Transactions sheet) *****/

/**
 * Run via manual or time-driven trigger to ingest all CSVs in RAW folder.
 */
function ingestAllCSVs() {
  try {
    ensureTargetHeader();

    const folder = DriveApp.getFolderById(CFG.RAW_FOLDER_ID);
    const files = folder.getFilesByType(MimeType.CSV);
    const sheet = getTargetSheet_();
    const existingKeys = buildExistingKeySet_(sheet);

    const processed = [];
    const problems = [];
    const counts = {};

    while (files.hasNext()) {
      const file = files.next();
      const res = processSingleCSVFile_(file, existingKeys);
      if (res.ok) {
        processed.push(file.getName());
        counts[file.getName()] = res.rowsAppended;
        moveToArchiveIfConfigured_(file);
      } else {
        problems.push(`${file.getName()} → ${res.reason}`);
      }
    }

    if (problems.length) {
      notifyAlert_('[CSV Import] Some files could not be mapped', problems.join('\n'));
    }
    if (processed.length) {
      notifyInfo_('[CSV Import] Done:\n' + processed.map(n => `• ${n}: ${counts[n]} new rows`).join('\n'));
    } else {
      notifyInfo_('[CSV Import] No CSVs found.');
    }
  } catch (e) {
    notifyAlert_('[CSV Import] Fatal error', stringifyError_(e));
    throw e;
  }
}

function processSingleCSVFile_(file, existingKeysSet) {
  try {
    const text = file.getBlob().getDataAsString('UTF-8');
    const rows = Utilities.parseCsv(text);
    if (!rows || rows.length === 0) {
      return { ok: false, rowsAppended: 0, reason: 'Empty or unreadable CSV' };
    }

    const header = rows[0].map(s => String(s).trim());
    const hash = headerHash_(header);
    const cfg = CONFIGS_BY_HEADER_HASH[hash];
    if (!cfg) {
      return { ok: false, rowsAppended: 0, reason: `Unknown header hash: ${hash}\nHeader: [${header.join(' | ')}]` };
    }

    const mapped = mapCsvRowsToTarget_(rows, header, cfg, file.getName());
    if (mapped.errors.length) {
      notifyAlert_(`[CSV Import] Row mapping issues in ${file.getName()}`, mapped.errors.slice(0, 30).join('\n'));
    }

    const deduped = mapped.records.filter(r => !existingKeysSet.has(buildKey_(r)));
    appendRecords_(deduped);
    deduped.forEach(r => existingKeysSet.add(buildKey_(r)));

    return { ok: true, rowsAppended: deduped.length, reason: '' };
  } catch (e) {
    notifyAlert_(`[CSV Import] Exception for "${file.getName()}"`, stringifyError_(e));
    return { ok: false, rowsAppended: 0, reason: 'Exception thrown; see alert' };
  }
}

/***** Mapping, transforms, dedupe *****/

function mapCsvRowsToTarget_(rows, header, cfg, sourceFileName) {
  const headerIndex = {};
  header.forEach((h, i) => headerIndex[normalizeHeader_(h)] = i);

  const recs = [];
  const errs = [];
  const seenWithinCsv = new Set(); // detect identical rows inside the same CSV (pre-append)

  for (let r = 1; r < rows.length; r++) {
    const raw = rows[r];
    if (raw.every(c => String(c).trim() === '')) continue;

    try {
      const rec = emptyTargetRecord_();

      rec.source_file = sourceFileName;

      // Map columns
      for (const [srcHeader, targetField] of Object.entries(cfg.mapping)) {
        const idx = headerIndex[normalizeHeader_(srcHeader)];
        if (idx == null) continue;
        rec[targetField] = String(raw[idx]).trim();
      }

      // Normalize date & monetary fields
      rec.date = parseDateFlexible_(rec.date, cfg.dateFormats);
      normalizeMonetaryFields_(rec, cfg);

      // Standardize strings
      rec.description = rec.description || '';
      rec.account_name = rec.account_name || (cfg.accountName || '');
      rec.financial_institution = rec.financial_institution || (cfg.financialInstitutionName || '');
      rec.type = rec.type || '';
      rec.check_number = rec.check_number || '';
      rec.category = rec.category || '';

      // Build a base key for within-CSV duplicate detection (without any duplicate prefix)
      const baseKey = buildKey_(rec);

      if (seenWithinCsv.has(baseKey)) {
        // Duplicate inside this CSV: prepend configured flag to description
        const prefix = CFG.DUPLICATE_TRANSACTION_AT_INGESTION_PREFIX || '[Possible Duplicate] ';
        rec.description = prefix + rec.description;
      } else {
        seenWithinCsv.add(baseKey);
      }

      recs.push(rec);

    } catch (rowErr) {
      errs.push(`Row ${r + 1}: ${stringifyError_(rowErr)}`);
    }
  }
  return { records: recs, errors: errs };
}

function emptyTargetRecord_() {
  const obj = {};
  CFG.TARGET_SCHEMA.forEach(k => obj[k] = '');
  return obj;
}

function parseDateFlexible_(value, formats) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  for (const fmt of (formats || [])) {
    const d = tryParseDate_(raw, fmt);
    if (d) return formatISODate_(d);
  }
  const d2 = new Date(raw);
  if (!isNaN(d2.getTime())) return formatISODate_(d2);
  throw new Error(`Unparseable date "${raw}"`);
}

function tryParseDate_(text, pattern) {
  try {
    const d = Utilities.parseDate(text, CFG.TIMEZONE, pattern);
    return d;
  } catch (e) {
    return null;
  }
}

// Accept $ and commas, parentheses for negatives
function normalizeAmount_(value, signConvention) {
  let s = String(value || '').replace(/[$,]/g, '').trim();
  if (s === '') return 0;
  const parenNeg = /^\((.*)\)$/.test(s);
  if (parenNeg) s = s.replace(/^\(|\)$/g, '');
  let n = Number(s);
  if (isNaN(n)) throw new Error(`Unparseable amount "${value}"`);
  if (parenNeg) n = -Math.abs(n);
  if (signConvention === 'expenses_negative') return n; // keep as-is; adjust per-source if needed
  return n; // 'raw_sign'
}

function normalizeMonetaryFields_(rec, cfg) {
  const hasWithdrawal = String(rec.withdrawal || '').trim() !== '';
  const hasDeposit = String(rec.deposit || '').trim() !== '';
  if (hasWithdrawal) {
    const withdrawal = Math.abs(normalizeAmount_(rec.withdrawal, 'raw_sign'));
    rec.withdrawal = withdrawal === 0 ? '' : withdrawal;
  } else {
    rec.withdrawal = '';
  }

  if (hasDeposit) {
    const deposit = Math.abs(normalizeAmount_(rec.deposit, 'raw_sign'));
    rec.deposit = deposit === 0 ? '' : deposit;
  } else {
    rec.deposit = '';
  }

  const amountSource = String(rec.amount || '').trim();
  if (!hasWithdrawal && !hasDeposit && amountSource !== '') {
    const amount = normalizeAmount_(amountSource, cfg.signConvention);
    if (amount < 0) {
      const value = Math.abs(amount);
      rec.withdrawal = value === 0 ? '' : value;
      rec.deposit = '';
    } else if (amount > 0) {
      const value = Math.abs(amount);
      rec.deposit = value === 0 ? '' : value;
      rec.withdrawal = '';
    } else {
      rec.withdrawal = '';
      rec.deposit = '';
    }
  }

  delete rec.amount;
}

function buildKey_(rec) {
  const date = rec.date;
  const deposit = Number(rec.deposit || 0).toFixed(2);
  const withdrawal = Number(rec.withdrawal || 0).toFixed(2);
  const desc = (rec.description || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const acct = (rec.account_name || '').toLowerCase().trim();
  const type = (rec.type || '').toLowerCase().trim();
  return [date, withdrawal, deposit, desc, acct, type].join(' | ');
}

function buildExistingKeySet_(sheet) {
  const values = safeGetValues_(sheet);
  if (values.length <= 1) return new Set();
  const header = values[0];
  const idx = {
    date: header.indexOf('date'),
    withdrawal: header.indexOf('withdrawal'),
    deposit: header.indexOf('deposit'),
    description: header.indexOf('description'),
    account: header.indexOf('account_name'),
    type: header.indexOf('type')
  };
  const set = new Set();
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const rec = {
      date: idx.date === -1 ? '' : row[idx.date],
      withdrawal: idx.withdrawal === -1 ? '' : row[idx.withdrawal],
      deposit: idx.deposit === -1 ? '' : row[idx.deposit],
      description: idx.description === -1 ? '' : row[idx.description],
      account_name: idx.account === -1 ? '' : row[idx.account],
      type: idx.type === -1 ? '' : row[idx.type]
    };
    set.add(buildKey_(rec));
  }
  return set;
}

function safeGetValues_(sheet) {
  const lastRow = sheet.getLastRow();
  const lastCol = Math.max(sheet.getLastColumn(), CFG.TARGET_SCHEMA.length);
  if (lastRow === 0) return [];
  return sheet.getRange(1, 1, lastRow, lastCol).getValues();
}

function appendRecords_(recs) {
  if (!recs || recs.length === 0) return;
  const sheet = getTargetSheet_();
  const rows = recs.map(r => CFG.TARGET_SCHEMA.map(col => r[col] ?? ''));
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, CFG.TARGET_SCHEMA.length).setValues(rows);
}

function moveToArchiveIfConfigured_(file) {
  if (!CFG.ARCHIVE_FOLDER_ID) return;
  try {
    const archive = DriveApp.getFolderById(CFG.ARCHIVE_FOLDER_ID);
    archive.addFile(file);
    // remove from original parent
    const parents = file.getParents();
    if (parents.hasNext()) parents.next().removeFile(file);
  } catch (e) {
    notifyAlert_('[CSV Import] Failed to archive file', `${file.getName()}\n\n${stringifyError_(e)}`);
  }
}

/**
 * Utility to learn a new header hash: drop one CSV into RAW, then run this.
 * Copy hash + header into CONFIGS_BY_HEADER_HASH in config.gs.
 */
function logHeaderHashForAFile() {
  const folder = DriveApp.getFolderById(CFG.RAW_FOLDER_ID);
  const files = folder.getFilesByType(MimeType.CSV);
  if (!files.hasNext()) { console.log('No CSVs in RAW.'); return; }
  const file = files.next();
  const rows = Utilities.parseCsv(file.getBlob().getDataAsString('UTF-8'));
  if (!rows || !rows.length) { console.log('Empty CSV.'); return; }
  const header = rows[0].map(s => String(s).trim());
  const hash = headerHash_(header);
  console.log(`File: ${file.getName()}`);
  console.log(`Header: [${header.join(' | ')}]`);
  console.log(`Header hash: ${hash}`);
}
