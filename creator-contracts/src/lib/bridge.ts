// Calls the Google Apps Script web app (apps-script/Code.gs) that sends email
// and writes to the work-request sheet on our behalf. Off until both
// APPS_SCRIPT_URL and APPS_SCRIPT_KEY are set.

export const bridgeConfigured = () => {
  const url = process.env.APPS_SCRIPT_URL || "";
  return url.startsWith("https://script.google.com/") && !!process.env.APPS_SCRIPT_KEY;
};

export async function callBridge(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!bridgeConfigured()) throw new Error("Apps Script bridge is not configured");
  const res = await fetch(process.env.APPS_SCRIPT_URL!, {
    method: "POST",
    // text/plain keeps this a simple request; the script parses the JSON body itself.
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ ...payload, key: process.env.APPS_SCRIPT_KEY }),
    redirect: "follow",
    signal: AbortSignal.timeout(45000),
  });
  const text = await res.text();
  let ok = false;
  let json: Record<string, unknown> = {};
  let error = `unexpected response (${res.status})`;
  try {
    json = JSON.parse(text);
    ok = json.ok === true;
    if (json.error) error = String(json.error);
  } catch {
    // An HTML page here usually means the web app is not deployed for "Anyone".
  }
  if (!ok) throw new Error(`Apps Script: ${error}`);
  return json;
}
