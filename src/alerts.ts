// Alert email helpers for ingestion failures and configuration warnings.
import { DEFAULT_ALERT_SUBJECT } from "./config";
import { getConfigValue } from "./configSheet";

const ALERT_EMAIL_KEY = "ALERT_EMAIL";

export function sendAlert(title: string, details: string): void {
  const to = getAlertEmail();
  if (!to) return;
  const subject = `${DEFAULT_ALERT_SUBJECT}: ${title}`;
  const body = `${title}\n\n${details}`;
  MailApp.sendEmail({ to, subject, body });
}

export function getAlertEmail(): string {
  return getConfigValue(ALERT_EMAIL_KEY);
}
