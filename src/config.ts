export const CFG = {
  // --- Folders ---
  RAW_FOLDER_ID: 'PUT_RAW_FOLDER_ID_HERE',
  ARCHIVE_FOLDER_ID: 'PUT_ARCHIVE_FOLDER_ID_HERE', // '' to skip archiving

  // --- Tabs / Sheet names ---
  TARGET_SHEET_NAME: 'Transactions',
  RULES_SHEET_NAME: 'Rules',

  // --- Alerts ---
  ALERT_EMAIL: 'you@example.com',

  // --- Duplicate handling ---
  DUPLICATE_TRANSACTION_AT_INGESTION_PREFIX: '[Possible Duplicate] ',

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

export const CONFIGS_BY_HEADER_HASH = {
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
      'Deposit': 'deposit'
      // 'RunningBalance'
    }
  }
};
