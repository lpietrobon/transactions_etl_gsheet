import { applyCategorization } from "./categorization";
import { ingestCSVs } from "./ingestion";
import { SHEETS } from "./config";

export { ingestCSVs, applyCategorization };

export function onEdit(e: GoogleAppsScript.Events.SheetsOnEdit): void {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  const name = sheet.getName();
  if (name === SHEETS.rules || name === SHEETS.transactions) {
    applyCategorization();
  }
}
