/***** RULES ENGINE (regex + amount range) *****/

/**
 * Columns expected in Rules sheet (row 1 headers):
 * Rule ID | Status | Description Regex | Type Regex | Category Regex | AccountName Regex | Min Amount | Max Amount | Category Assigned by Rule
 *
 * Empty cells mean "no constraint" for that criterion.
 */

function onEdit(e) {
  // Simple trigger: re-categorize if Rules changed or if main sheet got new data (not header).
  try {
    const sh = e && e.range && e.range.getSheet();
    if (!sh) return;
    const name = sh.getName();
    if (name === CFG.RULES_SHEET_NAME || (name === CFG.TARGET_SHEET_NAME && e.range.getRow() > 1)) {
      categorizeTransactions();
    }
  } catch (err) {
    notifyAlert_('[Rules] onEdit error', stringifyError_(err));
  }
}

/**
 * Installable trigger helper to run categorization on a schedule (optional).
 */
function installTriggers() {
  // Runs ingestion hourly
  ScriptApp.newTrigger('ingestAllCSVs').timeBased().everyHours(1).create();
  // Runs categorization hourly (after ingestion)
  ScriptApp.newTrigger('categorizeTransactions').timeBased().everyHours(1).create();
}

function categorizeTransactions() {
  try {
    const rules = readRules_();
    applyRulesToMain_(rules);
  } catch (e) {
    notifyAlert_('[Rules] categorizeTransactions error', stringifyError_(e));
    throw e;
  }
}

function readRules_() {
  const sh = getRulesSheet_();
  const values = sh.getDataRange().getValues();
  if (values.length <= 1) return [];
  const hdr = values[0].map(h => String(h).trim());
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
  const idx = {};
  const missing = [];
  for (const [key, label] of columns) {
    const position = hdr.indexOf(label);
    if (position === -1) {
      missing.push(label);
    }
    idx[key] = position;
  }
  if (missing.length) {
    throw new Error('Rules sheet missing required column(s): ' + missing.join(', '));
  }
  const list = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (row.every(c => String(c).trim() === '')) continue;
    const status = String(row[idx.status] || '').trim().toUpperCase();
    if (status !== 'ON') continue;
    const categoryCell = String(row[idx.category] || '').trim();
    if (!categoryCell) continue;
    const minStr = String(row[idx.minAmt] ?? '').trim();
    const maxStr = String(row[idx.maxAmt] ?? '').trim();
    const ruleId = String(row[idx.id] || '').trim();

    const descriptionPattern = String(row[idx.descriptionRegex] || '').trim();
    const typePattern = String(row[idx.typeRegex] || '').trim();
    const categoryPattern = String(row[idx.categoryRegex] || '').trim();
    const accountNamePattern = String(row[idx.accountNameRegex] || '').trim();

    list.push({
      id: ruleId,
      descriptionRegex: compileRuleRegex_(descriptionPattern, 'Description Regex', ruleId),
      typeRegex: compileRuleRegex_(typePattern, 'Type Regex', ruleId),
      categoryRegex: compileRuleRegex_(categoryPattern, 'Category Regex', ruleId),
      accountNameRegex: compileRuleRegex_(accountNamePattern, 'AccountName Regex', ruleId),
      minAmount: minStr === '' ? null : parseFloat(minStr),
      maxAmount: maxStr === '' ? null : parseFloat(maxStr),
      category: categoryCell
    });
  }
  return list;
}

function compileRuleRegex_(pattern, label, ruleId) {
  if (!pattern) return null;
  try {
    return new RegExp(pattern, 'i');
  } catch (err) {
    const idText = ruleId ? ` (Rule ID: ${ruleId})` : '';
    throw new Error(`Invalid ${label}${idText}: ${err.message}`);
  }
}

function applyRulesToMain_(rules) {
  const sh = getTargetSheet_();
  const vals = sh.getDataRange().getValues();
  if (vals.length <= 1) return;

  const header = vals[0];
  const idx = {
    desc: header.indexOf('description'),
    txnType: header.indexOf('type'),
    txnCategory: header.indexOf('category'),
    accountName: header.indexOf('account_name'),
    withdrawal: header.indexOf('withdrawal'),
    deposit: header.indexOf('deposit'),
    // add these two columns to your sheet if you'd like separate audit columns:
    catAudit: header.indexOf('Category by Rule'),
    ruleAudit: header.indexOf('Matched Rule ID')
  };

  // If audit columns are missing, create them to the right.
  let needWriteHeader = false;
  if (idx.catAudit === -1) { header.push('Category by Rule'); idx.catAudit = header.length - 1; needWriteHeader = true; }
  if (idx.ruleAudit === -1) { header.push('Matched Rule ID'); idx.ruleAudit = header.length - 1; needWriteHeader = true; }
  if (needWriteHeader) {
    sh.getRange(1, 1, 1, header.length).setValues([header]);
  }

  const dataRows = vals.slice(1);
  const outCat = [];
  const outRule = [];

  for (let r = 0; r < dataRows.length; r++) {
    const row = dataRows[r];
    const description = String(row[idx.desc] || '');
    const txnType = idx.txnType === -1 ? '' : String(row[idx.txnType] || '');
    const txnCategory = idx.txnCategory === -1 ? '' : String(row[idx.txnCategory] || '');
    const accountName = idx.accountName === -1 ? '' : String(row[idx.accountName] || '');
    const withdrawal = idx.withdrawal === -1 ? 0 : Number(row[idx.withdrawal] || 0);
    const deposit = idx.deposit === -1 ? 0 : Number(row[idx.deposit] || 0);
    const signedAmount = deposit - withdrawal;
    const magnitude = Math.abs(signedAmount);

    // Find first matching rule
    let matched = null;
    for (const rule of rules) {
      // Regex filters (optional)
      if (rule.descriptionRegex && !rule.descriptionRegex.test(description)) continue;
      if (rule.typeRegex && !rule.typeRegex.test(txnType)) continue;
      if (rule.categoryRegex && !rule.categoryRegex.test(txnCategory)) continue;
      if (rule.accountNameRegex && !rule.accountNameRegex.test(accountName)) continue;
      // Amount range (optional)
      if (rule.minAmount != null && magnitude < rule.minAmount) continue;
      if (rule.maxAmount != null && magnitude > rule.maxAmount) continue;

      matched = rule;
      break; // first match wins
    }

    if (matched) {
      outCat.push(matched.category);
      outRule.push(matched.id);
    } else {
      outCat.push(''); // clear if no match
      outRule.push('');
    }
  }

  // Write results back (only audit columns)
  if (dataRows.length > 0) {
    sh.getRange(2, idx.catAudit + 1, dataRows.length, 1).setValues(outCat.map(x => [x]));
    sh.getRange(2, idx.ruleAudit + 1, dataRows.length, 1).setValues(outRule.map(x => [x]));
  }
}
