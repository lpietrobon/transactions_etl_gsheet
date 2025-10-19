# Transactions Aggregation (Apps Script)

This project bundles a modular Google Apps Script that ingests bank-export CSVs from Google Drive, normalizes them into a single ledger tab, applies categorization rules, and optionally alerts when something looks off.

## Features
- Pull CSV files from a "raw" Drive folder, normalize column names, and append to a `Transactions` sheet without duplicates.
- Compute a stable SHA-256 fingerprint of each CSV header row so different bank exports can be mapped to the unified schema.
- Apply regex + amount range rules that fill in categories (with optional audit columns) whenever transactions change.
- Email alerts when ingestion fails, a header is unknown, or a file cannot be archived.

## Repository layout
- `config.gs` – Folder IDs, sheet names, schema definition, and header-hash mapping table.
- `ingestion.gs` – `ingestAllCSVs()`, header hashing utilities, dedupe helpers, and archive move logic.
- `rules.gs` – Categorization logic, sheet-on-edit handler, and helper to install time-based triggers.
- `alerting.gs` – Email + console alert helpers used across the modules.

## Prerequisites
- A Google Sheet that will host the transaction ledger and rule table.
- Two Drive folders: one for new CSV exports ("RAW") and, optionally, one for archived files after ingestion.

## Google Sheet setup
1. Create a spreadsheet (for example, **Transactions ETL**).
2. Add/rename a tab to match `CFG.TARGET_SHEET_NAME` (default `Transactions`). Leave it empty; the script will write the header defined in `CFG.TARGET_SCHEMA` on first run.
3. Add another tab named `Rules` (or adjust `CFG.RULES_SHEET_NAME`). The header row must contain exactly:
   
   | Rule ID | Description Regex | Min Amount | Max Amount | Category |
   |---------|-------------------|------------|------------|----------|
   
   You may leave data rows blank until you build rules. The script will automatically add audit columns (`Category by Rule`, `Matched Rule ID`) if they are missing.
4. (Optional) Create extra columns in the `Transactions` sheet if you want to store human-curated categories separate from the rule-driven ones—the ingestion step preserves any columns not defined in the target schema.

## Configure `config.gs`
1. Grab the folder IDs from Drive URLs (the string between `/folders/` and the next `/`). Paste them into `CFG.RAW_FOLDER_ID` and, if you want automatic archiving, `CFG.ARCHIVE_FOLDER_ID`.
2. Update `CFG.ALERT_EMAIL` to the address that should receive error notifications.
3. Adjust `CFG.TARGET_SCHEMA` if you need to add/remove columns (make sure the sheet header matches and that mappings point to valid keys).
4. Populate `CONFIGS_BY_HEADER_HASH` with one entry per unique CSV layout you ingest. Each entry maps the normalized source headers to the target schema fields and records formatting rules for dates and sign conventions.

## Load the Apps Script project
1. Open the spreadsheet and choose **Extensions → Apps Script**.
2. Delete any placeholder file that Google created and add four script files named after the files in this repo (`config.gs`, `ingestion.gs`, `rules.gs`, `alerting.gs`).
3. Copy the contents of each file from this repository into the matching file in Apps Script. Save the project.

## Learn the header hash for a new CSV
1. Drop a sample CSV export into the RAW folder.
2. In the Apps Script editor, run the function `logHeaderHashForAFile` from `ingestion.gs`.
3. Open **View → Logs**. You will see the file name, the exact header row, and a line like `Header hash: sha256:abc123…`.
4. Use that hash as the key in `CONFIGS_BY_HEADER_HASH` and copy the logged header names into the `mapping` object so each column routes to the correct target field. Repeat for every unique CSV format you support.

## Computing header hashes outside Apps Script (optional)
The header fingerprint is calculated by:
1. Lowercasing each header cell.
2. Replacing runs of whitespace with a single space and trimming leading/trailing spaces.
3. Joining the normalized headers with `|`.
4. Computing the SHA-256 digest of the resulting UTF-8 string.
5. Prefixing the hex digest with `sha256:`.

To reproduce this locally for automation, you can use Python:
```bash
python - <<'PY'
import csv, hashlib, sys
with open(sys.argv[1], newline='', encoding='utf-8') as fh:
    reader = csv.reader(fh)
    header = next(reader)
normalized = '|'.join(' '.join(col.split()).lower() for col in header)
print('sha256:' + hashlib.sha256(normalized.encode('utf-8')).hexdigest())
PY path/to/sample.csv
```
This script mirrors the `headerHash_` helper in `config.gs`, so the digest will match what the Apps Script computes.

## Running the ingestion and rules
- Run `ingestAllCSVs()` to pull any CSVs in the RAW folder, normalize the rows, append them to the sheet, and (optionally) move the processed files into the archive folder. Any headers without a matching hash produce an email alert and stop ingestion until you add a mapping.
- Run `categorizeTransactions()` to reapply your rules. The simple `onEdit(e)` trigger will call it automatically when you edit the `Rules` tab or new transactions arrive.
- Call `installTriggers()` from `rules.gs` if you want time-based triggers that ingest and categorize hourly.

## Maintenance tips
- If ingestion fails, check the execution log and the alert email for the stack trace provided by `alerting.gs`.
- When you update the target schema, update both the sheet header row and every mapping in `CONFIGS_BY_HEADER_HASH` to include the new columns.
- Periodically clear out the archive folder if it grows large, or disable archiving by leaving `CFG.ARCHIVE_FOLDER_ID` empty.
