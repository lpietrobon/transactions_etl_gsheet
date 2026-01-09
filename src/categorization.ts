import { RULES_HEADERS, SHEETS, TARGET_SCHEMA } from "./config";
import { ruleMatches } from "./core";
import { buildRegex, parseNumber } from "./parsing";
import { ensureSheetWithHeaders, rowToRecord, Table } from "./sheets";
import type { Rule } from "./core";

const AUDIT_COLUMNS = {
  categoryByRule: "Category by Rule",
  matchedRuleId: "Matched Rule ID"
};

export function applyCategorization(): void {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const transactionSheet = ensureSheetWithHeaders(spreadsheet, SHEETS.transactions, TARGET_SCHEMA);
  const rulesSheet = ensureSheetWithHeaders(spreadsheet, SHEETS.rules, RULES_HEADERS);

  const lastRow = transactionSheet.getLastRow();
  if (lastRow <= 1) return;

  const transactionTable = Table.fromSheet(transactionSheet);
  const rules = loadRules(rulesSheet);

  applyCategorizationForRows(transactionSheet, transactionTable, rules, 2, lastRow - 1);
}

export function applyCategorizationForRows(
  transactionSheet: GoogleAppsScript.Spreadsheet.Sheet,
  transactionTable: Table,
  rules: Rule[],
  startRow: number,
  numRows: number
): void {
  if (numRows <= 0) return;

  const categoryCol = transactionTable.ensureColumn(transactionSheet, AUDIT_COLUMNS.categoryByRule);
  const matchedRuleCol = transactionTable.ensureColumn(transactionSheet, AUDIT_COLUMNS.matchedRuleId);

  const values = transactionSheet.getRange(startRow, 1, numRows, transactionSheet.getLastColumn()).getValues();
  const categoryUpdates: string[][] = [];
  const ruleIdUpdates: string[][] = [];

  for (const row of values) {
    const record = rowToRecord(row, transactionTable);
    const match = rules.find((rule) => ruleMatches(rule, record));

    if (match) {
      categoryUpdates.push([match.category]);
      ruleIdUpdates.push([match.id]);
    } else {
      categoryUpdates.push([""]);
      ruleIdUpdates.push([""]);
    }
  }

  transactionSheet.getRange(startRow, categoryCol, categoryUpdates.length, 1).setValues(categoryUpdates);
  transactionSheet.getRange(startRow, matchedRuleCol, ruleIdUpdates.length, 1).setValues(ruleIdUpdates);
}

export function applyCategorizationForTransactionRows(startRow: number, numRows: number): void {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const transactionSheet = ensureSheetWithHeaders(spreadsheet, SHEETS.transactions, TARGET_SCHEMA);
  const rulesSheet = ensureSheetWithHeaders(spreadsheet, SHEETS.rules, RULES_HEADERS);

  const lastRow = transactionSheet.getLastRow();
  if (lastRow <= 1) return;

  const safeStartRow = Math.max(2, startRow);
  const maxRows = lastRow - safeStartRow + 1;
  const safeNumRows = Math.min(numRows, maxRows);
  if (safeNumRows <= 0) return;

  const transactionTable = Table.fromSheet(transactionSheet);
  const rules = loadRules(rulesSheet);

  applyCategorizationForRows(transactionSheet, transactionTable, rules, safeStartRow, safeNumRows);
}

function loadRules(sheet: GoogleAppsScript.Spreadsheet.Sheet): Rule[] {
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];
  const headers = values[0].map((header) => String(header || ""));
  const table = new Table(headers);

  const rules: Rule[] = [];
  for (let i = 1; i < values.length; i += 1) {
    const row = values[i];
    const id = String(row[table.getIndex("rule id")] || "").trim();
    if (!id) continue;

    const enabled = String(row[table.getIndex("on")] || "").toLowerCase() === "on";
    const category = String(row[table.getIndex("category")] || "").trim();
    const descriptionRegex = buildRegex(row[table.getIndex("description regex")]);
    const accountRegex = buildRegex(row[table.getIndex("account regex")]);
    const typeRegex = buildRegex(row[table.getIndex("type regex")]);
    const minAmount = parseNumber(row[table.getIndex("min amount")]);
    const maxAmount = parseNumber(row[table.getIndex("max amount")]);

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
