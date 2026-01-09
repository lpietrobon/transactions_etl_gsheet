import { CFG } from './config';

export function getRequiredProperty(name) {
  if (CFG && Object.prototype.hasOwnProperty.call(CFG, name) && CFG[name]) {
    return CFG[name];
  }
  if (typeof PropertiesService !== 'undefined') {
    const value = PropertiesService.getScriptProperties().getProperty(name);
    if (value) return value;
  }
  throw new Error(`Missing required property: ${name}`);
}

export function getAlertEmail() {
  return getRequiredProperty('ALERT_EMAIL');
}

export function sendAlert(subject, body) {
  try {
    MailApp.sendEmail({
      to: getAlertEmail(),
      subject,
      htmlBody: `<pre>${escapeHtml(body)}</pre>`
    });
  } catch (error) {
    console.error('ALERT FAILED\n' + subject + '\n' + body + '\n' + stringifyError(error));
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function stringifyError(error) {
  if (!error) return 'Unknown error';
  const message = error.message ? error.message : (error.toString ? error.toString() : String(error));
  return message + (error.stack ? `\n\n${error.stack}` : '');
}
