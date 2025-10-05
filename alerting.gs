/***** ALERTING / NOTIFICATIONS *****/

function alert_(subject, body) {
  try {
    MailApp.sendEmail({
      to: CFG.ALERT_EMAIL,
      subject,
      htmlBody: `<pre>${escapeHtml_(body)}</pre>`
    });
  } catch (e) {
    console.error('ALERT FAILED\n' + subject + '\n' + body + '\n' + stringifyError_(e));
  }
}

function logInfo_(msg) {
  console.log(msg);
}
