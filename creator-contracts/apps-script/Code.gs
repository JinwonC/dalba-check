/**
 * d'Alba Creator Contracts → Google bridge.
 *
 * Lets the contracts site (1) email a manager when their creator signs and
 * (2) add a transfer request row to the work-request sheet.
 *
 * Setup: open the work-request sheet → Extensions → Apps Script → paste this
 * file → set KEY below → Deploy → New deployment → Web app
 * (Execute as: Me, Who has access: Anyone) → copy the web app URL.
 */
const KEY = 'PASTE_THE_KEY_HERE';
const SHEET_ID = '1Xmrzo8JR-73v2HGIehXHVl79ytnsI8TfNqdgxGG-UqI';
const TAB = 'test';
const ALLOWED_DOMAINS = ['dalbausa.com', 'dalba.com'];

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return out({ ok: false, error: 'bad request' });
  }
  if (body.key !== KEY) return out({ ok: false, error: 'unauthorized' });
  try {
    if (body.action === 'ping') {
      // connection test
    } else if (body.action === 'email') {
      const domain = String(body.to || '').toLowerCase().split('@')[1];
      if (ALLOWED_DOMAINS.indexOf(domain) === -1) throw new Error('recipient not allowed');
      MailApp.sendEmail({ to: body.to, subject: body.subject, htmlBody: body.html, name: "d'Alba Creator Contracts" });
    } else if (body.action === 'row') {
      const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(TAB);
      if (!sheet) throw new Error('tab not found: ' + TAB);
      // No. (left blank) / 요청일 / 요청자 / 요청내용 / 요청 업무 내용 / 요청 폴더 링크
      sheet.appendRow(['', body.date, body.requester, body.kind, body.text, body.folder]);
    } else {
      throw new Error('unknown action');
    }
    return out({ ok: true });
  } catch (err) {
    return out({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Run this once from the editor (Run ▶) to grant mail and sheet permissions. */
function authorize() {
  SpreadsheetApp.openById(SHEET_ID).getSheetByName(TAB);
  MailApp.getRemainingDailyQuota();
}
