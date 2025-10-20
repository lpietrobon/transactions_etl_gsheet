/***** CONFIGURATION (single source of truth) *****/
const CFG = {
  // --- Folders ---
  RAW_FOLDER_ID: 'PUT_RAW_FOLDER_ID_HERE',
  ARCHIVE_FOLDER_ID: 'PUT_ARCHIVE_FOLDER_ID_HERE', // '' to skip archiving

  // --- Tabs / Sheet names ---
  TARGET_SHEET_NAME: 'Transactions',
  RULES_SHEET_NAME: 'Rules',

  // --- Alerts ---
  ALERT_EMAIL: 'you@example.com',

  // --- Duplicate handling ---
  DUPLICATE_TRANSACTION_AT_INGESTION_PREFIX: '[Possible Duplicate] ', // prepended to description for duplicate rows within the same CSV

  // --- Unified schema for the Transactions sheet (header row) ---
  TARGET_SCHEMA: [
    'account_name',
    'financial_institution',
    'date',
    'type',
    'description',
    'withdrawal',
    'deposit',
    'check_number',
    'category',
    'source_file'
  ],

  // --- Default time zone for any date parsing that needs it ---
  TIMEZONE: 'America/Los_Angeles'
};

/**
 * Mapping configs keyed by a stable header fingerprint (sha256 of normalized header row).
 * Each entry:
 * {
 *   financialInstitutionName: 'Readable name for the bank/issuer',
 *   accountName: 'Internal short label for debugging/logging',
 *   dateFormats: ['MM/dd/yyyy','M/d/yyyy'],
 *   signConvention: 'raw_sign' | 'expenses_negative',
 *   mapping: { 'Source Header' : 'target_field_in_CFG.TARGET_SCHEMA' }
 *     • You can also map to helper fields like 'amount'; ingestion will split
 *       the value into `deposit`/`withdrawal` columns.
 * }
 * 
 * `signConvention` only comes into play when the source header is mapped to the helper field amount
 * In that case, the parser reads the signed value according to the configured convention and then chooses which target column to populate: a negative number goes to withdrawal, a positive number goes to deposit
 *
 * Fill these by first running logHeaderHashForAFile() after dropping a sample CSV in RAW.
 */
const CONFIGS_BY_HEADER_HASH = {
  // --- EXAMPLES: replace the hashes and headers with your real ones ---

  // Chase example
  'sha256:b8d252a0bea5609a9ed14d51ae0a214a556c2b949626d1b27c2cfc538544d238': {
    accountName: 'Chase',
    financialInstitutionName: 'Chase Bank',
    dateFormats: ['MM/dd/yyyy'],
    signConvention: 'expenses_negative',
    mapping: {
      // 'Details' - this is just 'DEBIT' or 'CREDIT', embedded in the sign of the Amount
      'Posting Date': 'date',
      'Description': 'description',
      'Amount': 'deposit',
      'Type': 'type',
      // 'Balance'
      'Check or Slip #': 'check_number',
      'Check or Slip # ': 'check_number'
    }
  },

  // Charles Schwab example
  'sha256:0741502d4e8f7779dc44e8e3b0434bbbd71c57edce8b7fa5c69d9db1ef5d6199': {
    accountName: 'CharlesSchwab',
    financialInstitutionName: 'Charles Schwab Bank',
    dateFormats: ['MM/dd/yyyy'],
    signConvention: 'raw_sign',
    mapping: {
      'Date': 'date',
      // 'Status': , posted/pending
      'Type': 'type',
      'CheckNumber': 'check_number',
      'Description': 'description',
      'Withdrawal': 'withdrawal',
      'Deposit': 'deposit',
      // 'RunningBalance'
    }
  }
};

/***** Common helpers (shared by modules) *****/

function getTargetSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(CFG.TARGET_SHEET_NAME);
  if (!sh) sh = ss.insertSheet(CFG.TARGET_SHEET_NAME);
  return sh;
}

function getRulesSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(CFG.RULES_SHEET_NAME);
  if (!sh) sh = ss.insertSheet(CFG.RULES_SHEET_NAME);
  return sh;
}

function ensureTargetHeader() {
  const sheet = getTargetSheet_();
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, CFG.TARGET_SCHEMA.length).setValues([CFG.TARGET_SCHEMA]);
  }
}

function normalizeHeader_(s) {
  return String(s).toLowerCase().replace(/\s+/g, ' ').trim();
}

function bytesToHex_(bytes) {
  return bytes.map(b => (b + 256 & 255).toString(16).padStart(2, '0')).join('');
}

function headerHash_(headerRow) {
  const norm = headerRow.map(h => normalizeHeader_(h)).join('|');
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, norm);
  return 'sha256:' + bytesToHex_(digest);
}

function formatISODate_(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function stringifyError_(e) {
  if (!e) return 'Unknown error';
  const msg = e.message ? e.message : (e.toString ? e.toString() : String(e));
  return msg + (e.stack ? `\n\n${e.stack}` : '');
}

function escapeHtml_(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Helper wrappers that gracefully fall back to console logging when the
 * optional alerting utilities are not loaded in the Apps Script project.
 */
function notifyAlert_(subject, body) {
  if (typeof alert_ === 'function') {
    try {
      alert_(subject, body);
      return;
    } catch (err) {
      console.error('[Alert fallback] Failed to send alert via alert_');
      console.error(stringifyError_(err));
    }
  }
  console.log(`[ALERT] ${subject}\n${body}`);
}

function notifyInfo_(msg) {
  if (typeof logInfo_ === 'function') {
    try {
      logInfo_(msg);
      return;
    } catch (err) {
      console.error('[Log fallback] Failed to log via logInfo_');
      console.error(stringifyError_(err));
    }
  }
  console.log(msg);
}
