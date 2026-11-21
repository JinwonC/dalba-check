/**
 * d'Alba Creator Contracts → Google bridge.
 *
 * Lets the contracts site
 *   (1) email a manager (fallback when they have no staff account),
 *   (2) add rows to the work-request sheet (stamp requests, transfer requests),
 *   (3) put the creator-signed PDF in a Google Drive folder and return its link.
 *
 * Setup: open the work-request sheet → Extensions → Apps Script → paste this
 * file → fill in KEY → run "authorize" once → Deploy →
 * Manage deployments → Edit → New version (keeps the same web app URL).
 */
const KEY = 'PASTE_THE_KEY_HERE';
const SHEET_ID = '1Xmrzo8JR-73v2HGIehXHVl79ytnsI8TfNqdgxGG-UqI';
const TAB = 'test';
const ALLOWED_DOMAINS = ['dalbausa.com', 'dalba.com'];
// Where contract folders are created. Leave empty and the script makes a folder
// with the name below in this account's Drive the first time it is needed.
const DRIVE_PARENT = '';
const DRIVE_FOLDER_NAME = '크리에이터 계약서 (Creator Contracts)';

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
      return out({ ok: true, drive: driveReady() });
    } else if (body.action === 'email') {
      const domain = String(body.to || '').toLowerCase().split('@')[1];
      if (ALLOWED_DOMAINS.indexOf(domain) === -1) throw new Error('recipient not allowed');
      MailApp.sendEmail({ to: body.to, subject: body.subject, htmlBody: body.html, name: "d'Alba Creator Contracts" });
    } else if (body.action === 'row') {
      const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(TAB);
      if (!sheet) throw new Error('tab not found: ' + TAB);
      // No. (left blank) / 요청일 / 요청자 / 요청내용 / 요청 업무 내용 / 요청 폴더 링크
      sheet.appendRow(['', body.date, body.requester, body.kind, body.text, body.folder]);
    } else if (body.action === 'upload') {
      // One folder per contract; uploading again replaces the file of the same name.
      const parent = parentFolder();
      const found = parent.getFoldersByName(body.folderName);
      const folder = found.hasNext() ? found.next() : parent.createFolder(body.folderName);
      const old = folder.getFilesByName(body.fileName);
      while (old.hasNext()) old.next().setTrashed(true);
      folder.createFile(Utilities.newBlob(Utilities.base64Decode(body.data), 'application/pdf', body.fileName));
      // Empty sub-folders the site asks for (e.g. "날인" for the stamped copy finance adds).
      (body.subfolders || []).forEach(function (name) {
        if (name && !folder.getFoldersByName(name).hasNext()) folder.createFolder(name);
      });
      return out({ ok: true, url: folder.getUrl() });
    } else {
      throw new Error('unknown action');
    }
    return out({ ok: true });
  } catch (err) {
    return out({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function folderId(linkOrId) {
  const m = String(linkOrId).match(/folders\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : String(linkOrId).trim();
}

/** The folder that holds one sub-folder per contract; created on first use if DRIVE_PARENT is empty. */
function parentFolder() {
  if (DRIVE_PARENT) return DriveApp.getFolderById(folderId(DRIVE_PARENT));
  const found = DriveApp.getRootFolder().getFoldersByName(DRIVE_FOLDER_NAME);
  return found.hasNext() ? found.next() : DriveApp.getRootFolder().createFolder(DRIVE_FOLDER_NAME);
}

function driveReady() {
  try {
    return parentFolder().getUrl();
  } catch (err) {
    return false;
  }
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Run this once from the editor (Run ▶) to grant mail, sheet and Drive permissions. */
function authorize() {
  SpreadsheetApp.openById(SHEET_ID).getSheetByName(TAB);
  MailApp.getRemainingDailyQuota();
  Logger.log('Drive folder: ' + parentFolder().getUrl());
}
