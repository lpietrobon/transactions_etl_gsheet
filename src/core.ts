import { sendAlert } from './alerts';
import { CFG } from './config';

export function getTargetSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CFG.TARGET_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(CFG.TARGET_SHEET_NAME);
  return sheet;
}

export function getRulesSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CFG.RULES_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(CFG.RULES_SHEET_NAME);
  return sheet;
}

export function normalizeHeader(value) {
  return String(value).toLowerCase().replace(/\s+/g, ' ').trim();
}

export function bytesToHex(bytes) {
  return bytes.map(b => (b + 256 & 255).toString(16).padStart(2, '0')).join('');
}

export function formatISODate(dateValue) {
  const year = dateValue.getFullYear();
  const month = String(dateValue.getMonth() + 1).padStart(2, '0');
  const day = String(dateValue.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function stringifyError(error) {
  if (!error) return 'Unknown error';
  const message = error.message ? error.message : (error.toString ? error.toString() : String(error));
  return message + (error.stack ? `\n\n${error.stack}` : '');
}

export function notifyAlert(subject, body) {
  try {
    sendAlert(subject, body);
    return;
  } catch (err) {
    console.error('[Alert fallback] Failed to send alert');
    console.error(stringifyError(err));
  }
  console.log(`[ALERT] ${subject}\n${body}`);
}

export function notifyInfo(message) {
  console.log(message);
}
