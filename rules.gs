/***** RULES ENGINE (regex + amount range) *****/

/**
 * Columns expected in Rules sheet (row 1 headers):
 * Rule ID | Description Regex | Min Amount | Max Amount | Category
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
  const idx = {
    id: hdr.indexOf('Rule ID'),
    regex: hdr.indexOf('Description Regex'),
    minAmt: hdr.indexOf('Min Amount'),
    maxAmt: hdr.indexOf('Max Amount'),
    category: hdr.indexOf('Category')
  };
  const list = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (row.every(c => String(c).trim() === '')) continue;
    list.push({
      id: row[idx.id],
      descriptionRegex: row[idx.regex] || '',
      minAmount: row[idx.minAmt] === '' ? null : parseFloat(row[idx.minAmt]),
      maxAmount: row[idx.maxAmt] === '' ? null : parseFloat(row[idx.maxAmt]),
      category: row[idx.category]
    });
  }
  return list;
}

function applyRulesToMain_(rules) {
  const sh = getTargetSheet_();
  const vals = sh.getDataRange().getValues();
  if (vals.length <= 1) return;

  const header = vals[0];
  const idx = {
    desc: header.indexOf('description'),
    withdrawal: header.indexOf('withdrawal'),
    deposit: header.indexOf('deposit'),
    catByRule: header.indexOf('category'),
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
    const withdrawal = idx.withdrawal === -1 ? 0 : Number(row[idx.withdrawal] || 0);
    const deposit = idx.deposit === -1 ? 0 : Number(row[idx.deposit] || 0);
    const amount = deposit - withdrawal;

    // Find first matching rule
    let matched = null;
    for (const rule of rules) {
      // Description regex (optional)
      if (rule.descriptionRegex && rule.descriptionRegex.trim() !== '') {
        const re = new RegExp(rule.descriptionRegex, 'i');
        if (!re.test(description)) continue;
      }
      // Amount range (optional)
      if (rule.minAmount != null && amount < rule.minAmount) continue;
      if (rule.maxAmount != null && amount > rule.maxAmount) continue;

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
