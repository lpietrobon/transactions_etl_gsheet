# Transactions Aggregation (Apps Script)

Modular Google Apps Script to:
- Ingest CSVs from a Google Drive folder
- Normalize to a unified schema (per-source column mapping)
- Deduplicate and append into a single “Transactions” sheet
- Apply rules (regex + amount range) to assign categories
- Alert via email on unknown CSV headers or errors

## Files
- `config.gs` — All hardcoded config: folder IDs, tab names, target schema, and per-source mappings keyed by a header hash.
- `alerting.gs` — Email alerts (`alert_(subject, body)`), simple logging.
- `ingestion.gs` — `ingestAllCSVs()` plus mapping, date/amount normalization, dedupe, and archive move.
- `rules.gs` — `categorizeTransactions()` + `onEdit(e)` and optional `installTriggers()`.

## Setup
1. Create a Google Sheet with a tab named `Transactions` (or set `CFG.TARGET_SHEET_NAME` accordingly). Leave it empty; the script will add the header.
2. Create a tab named `Rules` with header row:
```
