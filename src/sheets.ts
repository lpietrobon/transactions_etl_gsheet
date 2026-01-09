// Spreadsheet helpers for headers, table lookups, and row conversions.
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
  table: Table
): Set<string> {
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return new Set();
  const keys = new Set<string>();

  for (let i = 1; i < data.length; i += 1) {
    const record = rowToRecord(data[i], table);
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

export function createHeaderIndex(
  headers: string[],
  normalizer: (header: string) => string = normalizeHeader
): Record<string, number> {
  const index: Record<string, number> = {};
  headers.forEach((header, idx) => {
    index[normalizer(String(header || ""))] = idx;
  });
  return index;
}

// Table wraps a header row with lookup helpers so callers can work with column
// names instead of threading header indexes through every call site.
// It keeps header normalization consistent and centralizes row/object mapping.
export class Table {
  headers: string[];
  headerIndex: Record<string, number>;
  normalizer: (header: string) => string;

  constructor(headers: string[], normalizer: (header: string) => string = normalizeHeader) {
    this.headers = headers.map((header) => String(header || ""));
    this.normalizer = normalizer;
    this.headerIndex = createHeaderIndex(this.headers, this.normalizer);
  }

  static fromSheet(sheet: GoogleAppsScript.Spreadsheet.Sheet): Table {
    const headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0] ?? [];
    return new Table(headerRow.map((header) => String(header || "")));
  }

  ensureColumn(sheet: GoogleAppsScript.Spreadsheet.Sheet, columnName: string): number {
    const column = ensureColumn(sheet, columnName, this.headers);
    this.headerIndex = createHeaderIndex(this.headers, this.normalizer);
    return column;
  }

  ensureHeaders(requiredHeaders: string[]): void {
    const missing = requiredHeaders.filter(
      (header) => this.headerIndex[this.normalizer(header)] === undefined
    );
    if (missing.length > 0) {
      throw new Error(`Missing header(s): ${missing.join(", ")}`);
    }
  }

  getIndex(header: string): number {
    const normalized = this.normalizer(header);
    const index = this.headerIndex[normalized];
    if (index === undefined) {
      throw new Error(`Missing header(s): ${header}`);
    }
    return index;
  }

  getValue(row: unknown[], header: string): unknown {
    return row[this.getIndex(header)];
  }

  setValue(row: unknown[], header: string, value: unknown): void {
    row[this.getIndex(header)] = value;
  }

  rowToObject(row: unknown[]): Record<string, unknown> {
    const record: Record<string, unknown> = {};
    this.headers.forEach((header, idx) => {
      record[header] = row[idx];
    });
    return record;
  }

  objectToRow(record: Record<string, unknown>): unknown[] {
    const row = new Array(this.headers.length).fill("");
    this.headers.forEach((header, idx) => {
      if (Object.prototype.hasOwnProperty.call(record, header)) {
        row[idx] = record[header];
      }
    });
    return row;
  }
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
  table: Table
): unknown[] {
  const row = new Array(table.headers.length).fill("");
  table.ensureHeaders([
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
  row[table.getIndex(HEADER_KEYS.accountName)] = record.accountName;
  row[table.getIndex(HEADER_KEYS.institution)] = record.institution;
  row[table.getIndex(HEADER_KEYS.date)] = record.date;
  row[table.getIndex(HEADER_KEYS.type)] = record.type;
  row[table.getIndex(HEADER_KEYS.description)] = record.description;
  row[table.getIndex(HEADER_KEYS.withdrawal)] = record.withdrawal;
  row[table.getIndex(HEADER_KEYS.deposit)] = record.deposit;
  row[table.getIndex(HEADER_KEYS.checkNumber)] = record.checkNumber;
  row[table.getIndex(HEADER_KEYS.category)] = record.category;
  row[table.getIndex(HEADER_KEYS.sourceFile)] = record.sourceFile;
  row[table.getIndex(HEADER_KEYS.manualCategory)] = record.manualCategory;
  return row;
}

export function rowToRecord(row: unknown[], table: Table): TransactionRecord {
  table.ensureHeaders([
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
  const getValue = (name: string) => String(row[table.getIndex(name)] ?? "");
  const toNumber = (name: string) => parseNumber(row[table.getIndex(name)]) ?? 0;

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
