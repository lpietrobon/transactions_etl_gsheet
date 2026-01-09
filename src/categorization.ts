import { RULES_HEADERS, SHEETS, TARGET_SCHEMA } from "./config";
import { normalizeWhitespace, ruleMatches } from "./core";
import { buildRegex, parseNumber } from "./parsing";
import { ensureColumn, ensureSheetWithHeaders, createHeaderIndex, rowToRecord } from "./sheets";
import type { Rule } from "./core";

const AUDIT_COLUMNS = {
  categoryByRule: "Category by Rule",
  matchedRuleId: "Matched Rule ID"
};

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
