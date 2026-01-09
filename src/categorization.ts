import { CFG } from './config';
import { normalizeHeader, notifyAlert, stringifyError } from './core';
import { ensureColumn, ensureSheetWithHeaders, createHeaderIndex, rowToRecord } from './sheets';

export function onEdit(e) {
  try {
    const sheet = e && e.range && e.range.getSheet();
    if (!sheet) return;
    const name = sheet.getName();
    if (name === CFG.RULES_SHEET_NAME || (name === CFG.TARGET_SHEET_NAME && e.range.getRow() > 1)) {
      applyCategorization();
    }
  } catch (error) {
    notifyAlert('[Rules] onEdit error', stringifyError(error));
  }
}

export function applyCategorization() {
  try {
    const rules = loadRules();
    applyRulesToMain(rules);
  } catch (error) {
    notifyAlert('[Rules] applyCategorization error', stringifyError(error));
    throw error;
  }
}

export function loadRules() {
  const sheet = ensureSheetWithHeaders(CFG.RULES_SHEET_NAME, []);
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];
  const header = values[0].map(h => String(h).trim());
  const index = createHeaderIndex(header);
  const columns = [
    ['id', 'Rule ID'],
    ['status', 'Status'],
    ['descriptionRegex', 'Description Regex'],
    ['typeRegex', 'Type Regex'],
    ['categoryRegex', 'Category Regex'],
    ['accountNameRegex', 'AccountName Regex'],
    ['minAmt', 'Min Amount'],
    ['maxAmt', 'Max Amount'],
    ['category', 'Category Assigned by Rule']
  ];

  const missing = [];
  const resolved = {};
  columns.forEach(([key, label]) => {
    const idx = index[normalizeHeader(label)];
    if (idx === undefined) {
      missing.push(label);
    }
    resolved[key] = idx;
  });

  if (missing.length) {
    throw new Error('Rules sheet missing required column(s): ' + missing.join(', '));
  }

  const list = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (row.every(c => String(c).trim() === '')) continue;
    const status = String(row[resolved.status] || '').trim().toUpperCase();
    if (status !== 'ON') continue;
    const categoryCell = String(row[resolved.category] || '').trim();
    if (!categoryCell) continue;
    const minStr = String(row[resolved.minAmt] ?? '').trim();
    const maxStr = String(row[resolved.maxAmt] ?? '').trim();
    const ruleId = String(row[resolved.id] || '').trim();

    const descriptionPattern = String(row[resolved.descriptionRegex] || '').trim();
    const typePattern = String(row[resolved.typeRegex] || '').trim();
    const categoryPattern = String(row[resolved.categoryRegex] || '').trim();
    const accountNamePattern = String(row[resolved.accountNameRegex] || '').trim();

    list.push({
      id: ruleId,
      descriptionRegex: compileRuleRegex(descriptionPattern, 'Description Regex', ruleId),
      typeRegex: compileRuleRegex(typePattern, 'Type Regex', ruleId),
      categoryRegex: compileRuleRegex(categoryPattern, 'Category Regex', ruleId),
      accountNameRegex: compileRuleRegex(accountNamePattern, 'AccountName Regex', ruleId),
      minAmount: minStr === '' ? null : parseFloat(minStr),
      maxAmount: maxStr === '' ? null : parseFloat(maxStr),
      category: categoryCell
    });
  }

  return list;
}

function compileRuleRegex(pattern, label, ruleId) {
  if (!pattern) return null;
  try {
    return new RegExp(pattern, 'i');
  } catch (error) {
    const idText = ruleId ? ` (Rule ID: ${ruleId})` : '';
    throw new Error(`Invalid ${label}${idText}: ${error.message}`);
  }
}

function applyRulesToMain(rules) {
  const sheet = ensureSheetWithHeaders(CFG.TARGET_SHEET_NAME, CFG.TARGET_SCHEMA);
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return;

  const header = values[0];
  const index = createHeaderIndex(header);

  const catAuditIndex = ensureColumn(sheet, header, 'Category by Rule');
  const ruleAuditIndex = ensureColumn(sheet, header, 'Matched Rule ID');

  const dataRows = values.slice(1);
  const outCat = [];
  const outRule = [];

  for (let r = 0; r < dataRows.length; r++) {
    const row = dataRows[r];
    const record = rowToRecord(row, header);
    const description = String(record.description || '');
    const txnType = index.type === undefined ? '' : String(record.type || '');
    const txnCategory = index.category === undefined ? '' : String(record.category || '');
    const accountName = index.account_name === undefined ? '' : String(record.account_name || '');
    const withdrawal = index.withdrawal === undefined ? 0 : Number(record.withdrawal || 0);
    const deposit = index.deposit === undefined ? 0 : Number(record.deposit || 0);
    const signedAmount = deposit - withdrawal;
    const magnitude = Math.abs(signedAmount);

    let matched = null;
    for (const rule of rules) {
      if (rule.descriptionRegex && !rule.descriptionRegex.test(description)) continue;
      if (rule.typeRegex && !rule.typeRegex.test(txnType)) continue;
      if (rule.categoryRegex && !rule.categoryRegex.test(txnCategory)) continue;
      if (rule.accountNameRegex && !rule.accountNameRegex.test(accountName)) continue;
      if (rule.minAmount != null && magnitude < rule.minAmount) continue;
      if (rule.maxAmount != null && magnitude > rule.maxAmount) continue;

      matched = rule;
      break;
    }

    if (matched) {
      outCat.push(matched.category);
      outRule.push(matched.id);
    } else {
      outCat.push('');
      outRule.push('');
    }
  }

  if (dataRows.length > 0) {
    sheet.getRange(2, catAuditIndex + 1, dataRows.length, 1).setValues(outCat.map(x => [x]));
    sheet.getRange(2, ruleAuditIndex + 1, dataRows.length, 1).setValues(outRule.map(x => [x]));
  }
}
