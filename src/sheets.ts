import { generateCompositeKey, normalizeHeader } from "./core";
import { parseNumber } from "./parsing";
import type { TransactionRecord } from "./core";

export function ensureSheetWithHeaders(
  spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet,
  name: string,
  headers: string[]
): GoogleAppsScript.Spreadsheet.Sheet {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    return sheet;
  }

  ensureHeaders(sheet, headers);
  return sheet;
}

export function ensureHeaders(sheet: GoogleAppsScript.Spreadsheet.Sheet, headers: string[]): void {
  const existing = sheet.getLastColumn() > 0
    ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    : [];
  const normalized = existing.map((value) => normalizeHeader(String(value || "")));

  const missing = headers.filter(
    (header) => !normalized.includes(normalizeHeader(header))
  );

  if (missing.length > 0) {
    const start = existing.length + 1;
    sheet.getRange(1, start, 1, missing.length).setValues([missing]);
  }
}

export function ensureColumn(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  columnName: string,
  headers: string[]
): number {
  const normalized = headers.map((header) => normalizeHeader(String(header || "")));
  const target = normalizeHeader(columnName);
  let index = normalized.indexOf(target);
  if (index === -1) {
    const start = headers.length + 1;
    sheet.getRange(1, start, 1, 1).setValues([[columnName]]);
    headers.push(columnName);
    index = start - 1;
  }
  return index + 1;
}

export function buildExistingKeys(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  headers: string[]
): Set<string> {
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return new Set();
  const headerIndex = createHeaderIndex(headers);
  const keys = new Set<string>();

  for (let i = 1; i < data.length; i += 1) {
    const record = rowToRecord(data[i], headerIndex);
    const key = generateCompositeKey({
      date: record.date,
      withdrawal: record.withdrawal,
      deposit: record.deposit,
      description: record.description,
      accountName: record.accountName,
      type: record.type
    });
    keys.add(key);
  }
  return keys;
}

export function createHeaderIndex(headers: string[]): Record<string, number> {
  const index: Record<string, number> = {};
  headers.forEach((header, idx) => {
    index[normalizeHeader(String(header || ""))] = idx;
  });
  return index;
}

export function buildRowFromRecord(
  record: TransactionRecord,
  headers: string[],
  headerIndex: Record<string, number>
): unknown[] {
  const row = new Array(headers.length).fill("");
  row[headerIndex["account name"]] = record.accountName;
  row[headerIndex["institution"]] = record.institution;
  row[headerIndex["date"]] = record.date;
  row[headerIndex["type"]] = record.type;
  row[headerIndex["description"]] = record.description;
  row[headerIndex["withdrawal"]] = record.withdrawal;
  row[headerIndex["deposit"]] = record.deposit;
  row[headerIndex["check number"]] = record.checkNumber;
  row[headerIndex["category"]] = record.category;
  row[headerIndex["source file"]] = record.sourceFile;
  row[headerIndex["manual category"]] = record.manualCategory;
  return row;
}

export function rowToRecord(row: unknown[], headerIndex: Record<string, number>): TransactionRecord {
  const getValue = (name: string) => String(row[headerIndex[name]] ?? "");
  const toNumber = (name: string) => parseNumber(row[headerIndex[name]]) ?? 0;

  return {
    accountName: getValue("account name"),
    institution: getValue("institution"),
    date: getValue("date"),
    type: getValue("type"),
    description: getValue("description"),
    withdrawal: toNumber("withdrawal"),
    deposit: toNumber("deposit"),
    checkNumber: getValue("check number"),
    category: getValue("category"),
    sourceFile: getValue("source file"),
    manualCategory: getValue("manual category")
  };
}
