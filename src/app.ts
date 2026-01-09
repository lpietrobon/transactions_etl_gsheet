// Apps Script entrypoints and trigger wiring for ingestion and categorization.
import { applyCategorization, applyCategorizationForTransactionRows } from "./categorization";
import { ingestCSVs } from "./ingestion";
import { SHEETS } from "./config";

export { ingestCSVs, applyCategorization };

export function onEdit(e: GoogleAppsScript.Events.SheetsOnEdit): void {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  const name = sheet.getName();
  if (name === SHEETS.rules) {
    // Rules changes can affect any transaction, so re-categorize everything.
    applyCategorization();
    return;
  }
  if (name === SHEETS.transactions) {
    // Transaction edits should only re-categorize the touched rows.
    applyCategorizationForTransactionRows(e.range.getRow(), e.range.getNumRows());
  }
}
