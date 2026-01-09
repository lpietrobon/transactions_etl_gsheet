// Reads and validates key/value configuration stored in the Config sheet.
import { SHEETS } from "./config";
import { ensureSheetWithHeaders } from "./sheets";

const CONFIG_HEADERS = ["Key", "Value"];

function getConfigSheet(): GoogleAppsScript.Spreadsheet.Sheet {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  return ensureSheetWithHeaders(spreadsheet, SHEETS.config, CONFIG_HEADERS);
}

function readConfigMap(): Record<string, string> {
  const sheet = getConfigSheet();
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return {};

  const config: Record<string, string> = {};
  for (let i = 1; i < data.length; i += 1) {
    const key = String(data[i][0] ?? "").trim();
    if (!key) continue;
    const value = String(data[i][1] ?? "").trim();
    config[key] = value;
  }
  return config;
}

export function getConfigValue(key: string): string {
  const config = readConfigMap();
  return config[key] ?? "";
}

export function getRequiredConfigValue(key: string): string {
  const value = getConfigValue(key);
  if (!value) {
    throw new Error(`Missing required config value "${key}" in sheet "${SHEETS.config}".`);
  }
  return value;
}
