import {
  CONFIGS_BY_HEADER_HASH,
  DEFAULT_ALERT_SUBJECT,
  RULES_HEADERS,
  SHEETS,
  TARGET_SCHEMA
} from "./config";
import {
  generateCompositeKey,
  normalizeHeader,
  normalizeHeaders,
  normalizeWhitespace,
  ruleMatches,
  TransactionRecord,
  Rule
} from "./core";

const SCRIPT_PROPERTIES = {
  rawFolderId: "RAW_FOLDER_ID",
  archiveFolderId: "ARCHIVE_FOLDER_ID",
  alertEmail: "ALERT_EMAIL"
};

const AUDIT_COLUMNS = {
  categoryByRule: "Category by Rule",
  matchedRuleId: "Matched Rule ID"
};

export function ingestCSVs(): void {
  const rawFolderId = getRequiredProperty(SCRIPT_PROPERTIES.rawFolderId);
  const folder = DriveApp.getFolderById(rawFolderId);
  const files = folder.getFiles();
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const transactionSheet = ensureSheetWithHeaders(spreadsheet, SHEETS.transactions, TARGET_SCHEMA);

  const headerRow = transactionSheet.getRange(1, 1, 1, transactionSheet.getLastColumn()).getValues()[0];
  const headerIndex = createHeaderIndex(headerRow);
  const existingKeys = buildExistingKeys(transactionSheet, headerRow);

  const rowsToAppend: unknown[][] = [];
  const now = new Date();

  while (files.hasNext()) {
    const file = files.next();
    const name = file.getName();
    const isCsv = name.toLowerCase().endsWith(".csv") || file.getMimeType() === MimeType.CSV;
    if (!isCsv) continue;

    try {
      const blob = file.getBlob();
      const csvData = Utilities.parseCsv(blob.getDataAsString());
      if (csvData.length < 2) continue;

      const rawHeaders = csvData[0].map((header) => String(header || ""));
      const normalizedHeaders = normalizeHeaders(rawHeaders);
      const headerHash = computeHeaderHash(normalizedHeaders);
      const config = CONFIGS_BY_HEADER_HASH[headerHash];

      if (!config) {
        sendAlert(
          `Unknown CSV header hash for file ${name}.`,
          `Header hash: ${headerHash}\nHeaders: ${rawHeaders.join(", ")}`
        );
        continue;
      }

      const sourceIndex = createHeaderIndex(rawHeaders);
      const seenKeysInFile = new Set<string>();

      for (let i = 1; i < csvData.length; i += 1) {
        const row = csvData[i];
        if (row.every((cell) => String(cell || "").trim() === "")) continue;

        const record = mapRowToRecord(row, sourceIndex, config, name, now);
        const key = generateCompositeKey({
          date: record.date,
          withdrawal: record.withdrawal,
          deposit: record.deposit,
          description: record.description,
          accountName: record.accountName,
          type: record.type
        });

        if (existingKeys.has(key)) continue;
        if (seenKeysInFile.has(key)) {
          record.description = `[Possible Duplicate] ${record.description}`;
        }
        seenKeysInFile.add(key);

        rowsToAppend.push(buildRowFromRecord(record, headerRow, headerIndex));
        existingKeys.add(key);
      }

      archiveFileIfConfigured(file);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendAlert(`Failed ingestion for file ${name}.`, message);
    }
  }

  if (rowsToAppend.length > 0) {
    const startRow = transactionSheet.getLastRow() + 1;
    transactionSheet.getRange(startRow, 1, rowsToAppend.length, headerRow.length).setValues(rowsToAppend);
  }
}

export function applyCategorization(): void {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const transactionSheet = ensureSheetWithHeaders(spreadsheet, SHEETS.transactions, TARGET_SCHEMA);
  const rulesSheet = ensureSheetWithHeaders(spreadsheet, SHEETS.rules, RULES_HEADERS);

  const transactionHeaders = transactionSheet.getRange(1, 1, 1, transactionSheet.getLastColumn()).getValues()[0];
  const headerIndex = createHeaderIndex(transactionHeaders);

  const rules = loadRules(rulesSheet);
  const dataRange = transactionSheet.getDataRange();
  const values = dataRange.getValues();

  if (values.length <= 1) return;

  const categoryCol = ensureColumn(transactionSheet, AUDIT_COLUMNS.categoryByRule, transactionHeaders);
  const matchedRuleCol = ensureColumn(transactionSheet, AUDIT_COLUMNS.matchedRuleId, transactionHeaders);

  const categoryUpdates: string[][] = [];
  const ruleIdUpdates: string[][] = [];

  for (let rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
    const row = values[rowIndex];
    const record = rowToRecord(row, headerIndex);
    const match = rules.find((rule) => ruleMatches(rule, record));

    if (match) {
      categoryUpdates.push([match.category]);
      ruleIdUpdates.push([match.id]);
    } else {
      categoryUpdates.push([""]);
      ruleIdUpdates.push([""]);
    }
  }

  const startRow = 2;
  transactionSheet.getRange(startRow, categoryCol, categoryUpdates.length, 1).setValues(categoryUpdates);
  transactionSheet.getRange(startRow, matchedRuleCol, ruleIdUpdates.length, 1).setValues(ruleIdUpdates);
}

export function onEdit(e: GoogleAppsScript.Events.SheetsOnEdit): void {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  const name = sheet.getName();
  if (name === SHEETS.rules || name === SHEETS.transactions) {
    applyCategorization();
  }
}

function loadRules(sheet: GoogleAppsScript.Spreadsheet.Sheet): Rule[] {
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];
  const headers = values[0].map((header) => normalizeWhitespace(String(header || "")));
  const index = createHeaderIndex(headers);

  const rules: Rule[] = [];
  for (let i = 1; i < values.length; i += 1) {
    const row = values[i];
    const id = String(row[index["rule id"]] || "").trim();
    if (!id) continue;

    const enabled = String(row[index["on"]] || "").toLowerCase() === "on";
    const category = String(row[index["category"]] || "").trim();
    const descriptionRegex = buildRegex(row[index["description regex"]]);
    const accountRegex = buildRegex(row[index["account regex"]]);
    const typeRegex = buildRegex(row[index["type regex"]]);
    const minAmount = parseNumber(row[index["min amount"]]);
    const maxAmount = parseNumber(row[index["max amount"]]);

    rules.push({
      id,
      enabled,
      category,
      descriptionRegex,
      accountRegex,
      typeRegex,
      minAmount: minAmount ?? undefined,
      maxAmount: maxAmount ?? undefined
    });
  }
  return rules;
}

function mapRowToRecord(
  row: unknown[],
  sourceIndex: Record<string, number>,
  config: {
    dateFormat: string;
    amountColumn?: string;
    withdrawalColumn?: string;
    depositColumn?: string;
    accountName?: string;
    institution?: string;
    signConvention: "positive_deposit" | "positive_withdrawal";
    columnMap: Record<string, string>;
  },
  sourceFile: string,
  now: Date
): TransactionRecord {
  const mapped: Record<string, string> = {};
  Object.entries(config.columnMap).forEach(([sourceHeader, targetHeader]) => {
    const normalizedSource = normalizeHeader(sourceHeader);
    const index = sourceIndex[normalizedSource];
    mapped[targetHeader] = index !== undefined ? String(row[index] || "") : "";
  });

  const dateValue = mapped["Date"] || "";
  const parsedDate = parseDate(dateValue, config.dateFormat) ?? now;
  const formattedDate = Utilities.formatDate(parsedDate, Session.getScriptTimeZone(), "yyyy-MM-dd");

  const description = mapped["Description"] || "";
  const type = mapped["Type"] || "";
  const checkNumber = mapped["Check Number"] || "";

  let withdrawal = 0;
  let deposit = 0;

  if (config.withdrawalColumn || config.depositColumn) {
    if (config.withdrawalColumn) {
      const index = sourceIndex[normalizeHeader(config.withdrawalColumn)];
      withdrawal = parseCurrency(String(row[index] || ""));
    }
    if (config.depositColumn) {
      const index = sourceIndex[normalizeHeader(config.depositColumn)];
      deposit = parseCurrency(String(row[index] || ""));
    }
  } else if (config.amountColumn) {
    const index = sourceIndex[normalizeHeader(config.amountColumn)];
    const amount = parseCurrency(String(row[index] || ""));
    if (config.signConvention === "positive_deposit") {
      if (amount >= 0) deposit = amount;
      else withdrawal = Math.abs(amount);
    } else {
      if (amount >= 0) withdrawal = amount;
      else deposit = Math.abs(amount);
    }
  }

  return {
    accountName: config.accountName ?? mapped["Account Name"] ?? "",
    institution: config.institution ?? mapped["Institution"] ?? "",
    date: formattedDate,
    type: type,
    description: description,
    withdrawal: withdrawal,
    deposit: deposit,
    checkNumber: checkNumber,
    category: mapped["Category"] || "",
    sourceFile,
    manualCategory: mapped["Manual Category"] || ""
  };
}

function buildRowFromRecord(
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

function rowToRecord(row: unknown[], headerIndex: Record<string, number>): TransactionRecord {
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

function ensureSheetWithHeaders(
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

function ensureHeaders(sheet: GoogleAppsScript.Spreadsheet.Sheet, headers: string[]): void {
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

function ensureColumn(
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

function buildExistingKeys(
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

function createHeaderIndex(headers: string[]): Record<string, number> {
  const index: Record<string, number> = {};
  headers.forEach((header, idx) => {
    index[normalizeHeader(String(header || ""))] = idx;
  });
  return index;
}

function computeHeaderHash(headers: string[]): string {
  const normalized = headers.map((header) => normalizeHeader(header));
  const joined = normalized.join("|");
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, joined, Utilities.Charset.UTF_8);
  return digest.map((byte) => (byte + 256).toString(16).slice(-2)).join("");
}

function parseDate(value: string, format: string): Date | null {
  if (!value) return null;
  try {
    return Utilities.parseDate(value, Session.getScriptTimeZone(), format);
  } catch (_error) {
    const fallback = new Date(value);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }
}

function parseCurrency(value: string): number {
  const cleaned = String(value || "")
    .replace(/\$/g, "")
    .replace(/,/g, "")
    .trim();
  if (!cleaned) return 0;
  const isNegative = /^\(.*\)$/.test(cleaned);
  const normalized = cleaned.replace(/[()]/g, "");
  const parsed = Number(normalized);
  if (Number.isNaN(parsed)) return 0;
  return isNegative ? -Math.abs(parsed) : parsed;
}

function parseNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(String(value).replace(/,/g, ""));
  return Number.isNaN(numeric) ? null : numeric;
}

function buildRegex(value: unknown): RegExp | undefined {
  const raw = String(value || "").trim();
  if (!raw) return undefined;
  return new RegExp(raw, "i");
}

function getRequiredProperty(name: string): string {
  const value = PropertiesService.getScriptProperties().getProperty(name);
  if (!value) {
    throw new Error(`Missing required script property: ${name}`);
  }
  return value;
}

function sendAlert(title: string, details: string): void {
  const to = getAlertEmail();
  if (!to) return;
  const subject = `${DEFAULT_ALERT_SUBJECT}: ${title}`;
  const body = `${title}\n\n${details}`;
  MailApp.sendEmail({ to, subject, body });
}

function getAlertEmail(): string {
  const property = PropertiesService.getScriptProperties().getProperty(SCRIPT_PROPERTIES.alertEmail);
  if (property) return property;
  const user = Session.getEffectiveUser();
  return user ? user.getEmail() : "";
}

function archiveFileIfConfigured(file: GoogleAppsScript.Drive.File): void {
  const archiveFolderId = PropertiesService.getScriptProperties().getProperty(
    SCRIPT_PROPERTIES.archiveFolderId
  );
  if (!archiveFolderId) return;
  const archiveFolder = DriveApp.getFolderById(archiveFolderId);
  archiveFolder.addFile(file);
  const parents = file.getParents();
  while (parents.hasNext()) {
    const parent = parents.next();
    if (parent.getId() !== archiveFolderId) {
      parent.removeFile(file);
    }
  }
}
