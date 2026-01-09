import { DEFAULT_ALERT_SUBJECT } from "./config";

const ALERT_EMAIL_PROPERTY = "ALERT_EMAIL";

export function sendAlert(title: string, details: string): void {
  const to = getAlertEmail();
  if (!to) return;
  const subject = `${DEFAULT_ALERT_SUBJECT}: ${title}`;
  const body = `${title}\n\n${details}`;
  MailApp.sendEmail({ to, subject, body });
}

export function getAlertEmail(): string {
  const property = PropertiesService.getScriptProperties().getProperty(ALERT_EMAIL_PROPERTY);
  if (property) return property;
  const user = Session.getEffectiveUser();
  return user ? user.getEmail() : "";
}
