import { generateCompositeKey, normalizeHeader } from "./core";
import { parseNumber } from "./parsing";
import { HEADER_KEYS } from "./config";
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

export function ensureHeaderIndexContains(
  headerIndex: Record<string, number>,
  requiredHeaders: string[]
): void {
  const missing = requiredHeaders.filter((header) => headerIndex[header] === undefined);
  if (missing.length > 0) {
    throw new Error(`Missing header(s): ${missing.join(", ")}`);
  }
}

export function buildRowFromRecord(
  record: TransactionRecord,
  headers: string[],
  headerIndex: Record<string, number>
): unknown[] {
  const row = new Array(headers.length).fill("");
  ensureHeaderIndexContains(headerIndex, [
    HEADER_KEYS.accountName,
    HEADER_KEYS.institution,
    HEADER_KEYS.date,
    HEADER_KEYS.type,
    HEADER_KEYS.description,
    HEADER_KEYS.withdrawal,
    HEADER_KEYS.deposit,
    HEADER_KEYS.checkNumber,
    HEADER_KEYS.category,
    HEADER_KEYS.sourceFile,
    HEADER_KEYS.manualCategory
  ]);
  row[headerIndex[HEADER_KEYS.accountName]] = record.accountName;
  row[headerIndex[HEADER_KEYS.institution]] = record.institution;
  row[headerIndex[HEADER_KEYS.date]] = record.date;
  row[headerIndex[HEADER_KEYS.type]] = record.type;
  row[headerIndex[HEADER_KEYS.description]] = record.description;
  row[headerIndex[HEADER_KEYS.withdrawal]] = record.withdrawal;
  row[headerIndex[HEADER_KEYS.deposit]] = record.deposit;
  row[headerIndex[HEADER_KEYS.checkNumber]] = record.checkNumber;
  row[headerIndex[HEADER_KEYS.category]] = record.category;
  row[headerIndex[HEADER_KEYS.sourceFile]] = record.sourceFile;
  row[headerIndex[HEADER_KEYS.manualCategory]] = record.manualCategory;
  return row;
}

export function rowToRecord(row: unknown[], headerIndex: Record<string, number>): TransactionRecord {
  ensureHeaderIndexContains(headerIndex, [
    HEADER_KEYS.accountName,
    HEADER_KEYS.institution,
    HEADER_KEYS.date,
    HEADER_KEYS.type,
    HEADER_KEYS.description,
    HEADER_KEYS.withdrawal,
    HEADER_KEYS.deposit,
    HEADER_KEYS.checkNumber,
    HEADER_KEYS.category,
    HEADER_KEYS.sourceFile,
    HEADER_KEYS.manualCategory
  ]);
  const getValue = (name: string) => String(row[headerIndex[name]] ?? "");
  const toNumber = (name: string) => parseNumber(row[headerIndex[name]]) ?? 0;

  return {
    accountName: getValue(HEADER_KEYS.accountName),
    institution: getValue(HEADER_KEYS.institution),
    date: getValue(HEADER_KEYS.date),
    type: getValue(HEADER_KEYS.type),
    description: getValue(HEADER_KEYS.description),
    withdrawal: toNumber(HEADER_KEYS.withdrawal),
    deposit: toNumber(HEADER_KEYS.deposit),
    checkNumber: getValue(HEADER_KEYS.checkNumber),
    category: getValue(HEADER_KEYS.category),
    sourceFile: getValue(HEADER_KEYS.sourceFile),
    manualCategory: getValue(HEADER_KEYS.manualCategory)
  };
}
