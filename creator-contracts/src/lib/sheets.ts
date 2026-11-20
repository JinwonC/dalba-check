import crypto from "node:crypto";

// Appends a row to the internal work-request sheet with a Google service
// account. Off unless GOOGLE_SERVICE_ACCOUNT_JSON and REQUEST_SHEET_ID are set.

const b64 = (v: string | Buffer) => Buffer.from(v).toString("base64url");

export const sheetConfigured = () => !!(process.env.GOOGLE_SERVICE_ACCOUNT_JSON && process.env.REQUEST_SHEET_ID);

async function accessToken(): Promise<string> {
  const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON!);
  const now = Math.floor(Date.now() / 1000);
  const head = b64(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64(
    JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/spreadsheets", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 600 }),
  );
  const sig = crypto.createSign("RSA-SHA256").update(`${head}.${claim}`).sign(sa.private_key).toString("base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claim}.${sig}` }),
  });
  if (!res.ok) throw new Error(`Google auth failed (${res.status})`);
  return (await res.json()).access_token;
}

/** Columns: No. (left blank) / 요청일 / 요청자 / 요청내용 / 요청 업무 내용 / 요청 폴더 링크 */
export async function appendRequestRow(row: { date: string; requester: string; kind: string; text: string; folder: string }): Promise<void> {
  const tab = process.env.REQUEST_SHEET_TAB || "test";
  const range = encodeURIComponent(`'${tab.replace(/'/g, "''")}'!A:F`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${process.env.REQUEST_SHEET_ID}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: [["", row.date, row.requester, row.kind, row.text, row.folder]] }),
  });
  if (!res.ok) throw new Error(`Sheet append failed (${res.status})`);
}
