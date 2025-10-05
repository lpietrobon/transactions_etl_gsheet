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
    'date',
    'amount',
    'description',
    'account',
    'institution',
    'financial_institution_name',
    'category',
    'raw_memo',
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
 *   name: 'Internal short label for debugging/logging',
 *   dateFormats: ['MM/dd/yyyy','M/d/yyyy'],
 *   signConvention: 'raw_sign' | 'expenses_negative',
 *   mapping: { 'Source Header' : 'target_field_in_CFG.TARGET_SCHEMA' }
 * }
 *
 * Fill these by first running logHeaderHashForAFile() after dropping a sample CSV in RAW.
 */
const CONFIGS_BY_HEADER_HASH = {
  // --- EXAMPLES: replace the hashes and headers with your real ones ---

  // Chase example
  'sha256:EXAMPLE_CHASE_HEADER_HASH': {
    name: 'Chase',
    financialInstitutionName: 'Chase Bank',
    dateFormats: ['MM/dd/yyyy', 'M/d/yyyy'],
    signConvention: 'raw_sign',
    mapping: {
      'Transaction Date': 'date',
      'Description': 'description',
      'Amount': 'amount',
      'Card Last 4 Digits': 'account',
      'Category': 'category',
      'Extended Details': 'raw_memo'
    }
  },

  // Charles Schwab example
  'sha256:EXAMPLE_SCHWAB_HEADER_HASH': {
    name: 'CharlesSchwab',
    financialInstitutionName: 'Charles Schwab Bank',
    dateFormats: ['MM/dd/yyyy', 'M/d/yyyy'],
    signConvention: 'raw_sign',
    mapping: {
      'Date': 'date',
      'Description': 'description',
      'Amount': 'amount',
      'Account Number': 'account'
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
