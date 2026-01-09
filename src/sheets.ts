import { normalizeHeader } from './core';

export function ensureSheetWithHeaders(sheetName, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);
  if (headers && headers.length) {
    ensureHeaders(sheet, headers);
  }
  return sheet;
}

export function ensureHeaders(sheet, headers) {
  const existingRow = sheet.getLastRow() > 0
    ? sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getValues()[0]
    : [];
  if (existingRow.length === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    return headers.slice();
  }
  const headerRow = existingRow.slice();
  headers.forEach(header => {
    ensureColumn(sheet, headerRow, header);
  });
  return headerRow;
}

export function ensureColumn(sheet, headerRow, columnName) {
  let idx = headerRow.indexOf(columnName);
  if (idx === -1) {
    headerRow.push(columnName);
    sheet.getRange(1, 1, 1, headerRow.length).setValues([headerRow]);
    idx = headerRow.length - 1;
  }
  return idx;
}

export function createHeaderIndex(headerRow) {
  const index = {};
  headerRow.forEach((header, i) => {
    index[normalizeHeader(header)] = i;
  });
  return index;
}

export function rowToRecord(row, headerRow) {
  const record = {};
  headerRow.forEach((header, i) => {
    record[normalizeHeader(header)] = row[i];
  });
  return record;
}

export function buildExistingKeys(sheet, buildKey) {
  const values = safeGetValues(sheet);
  if (values.length <= 1) return new Set();
  const header = values[0];
  const headerIndex = createHeaderIndex(header);
  const set = new Set();
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const record = {
      date: headerIndex.date === undefined ? '' : row[headerIndex.date],
      withdrawal: headerIndex.withdrawal === undefined ? '' : row[headerIndex.withdrawal],
      deposit: headerIndex.deposit === undefined ? '' : row[headerIndex.deposit],
      description: headerIndex.description === undefined ? '' : row[headerIndex.description],
      account_name: headerIndex.account_name === undefined ? '' : row[headerIndex.account_name],
      type: headerIndex.type === undefined ? '' : row[headerIndex.type]
    };
    set.add(buildKey(record));
  }
  return set;
}

function safeGetValues(sheet) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow === 0) return [];
  return sheet.getRange(1, 1, lastRow, lastCol).getValues();
}
