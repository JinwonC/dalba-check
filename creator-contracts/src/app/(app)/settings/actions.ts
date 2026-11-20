"use server";

import { callBridge } from "@/lib/bridge";
import { sendToManager } from "@/lib/notify";
import { requireUser } from "@/lib/session";

type Result = { error: string } | { message: string; vars?: Record<string, string> };

/** Exercise the Apps Script bridge so a manager can confirm email and sheet writes work. */
export async function testBridge(what: "ping" | "email" | "row"): Promise<Result> {
  const user = await requireUser();
  try {
    if (what === "email") {
      const route = await sendToManager(
        user.email,
        "[d'Alba] 연결 테스트 / connection test",
        "<p>크리에이터 계약 사이트의 알림 메일이 정상적으로 연결되었습니다.<br>Sign notifications from the creator contracts site are working.</p>",
      );
      if (route === "off") return { error: "Email is not connected." };
      return { message: route === "works" ? "Test email sent from your own NAVER WORKS mailbox to {email}." : "Test email sent to {email}." };
    }
    if (what === "row") {
      await callBridge({ action: "row", date: new Date().toISOString().slice(0, 10), requester: user.name, kind: "테스트", text: "연결 테스트 행입니다. 지워도 됩니다.", folder: "" });
      return { message: "Test row added to the sheet." };
    }
    const res = await callBridge({ action: "ping" });
    if (typeof res.drive === "string") return { message: "Connection works. Drive folder: {url}", vars: { url: res.drive } };
    return { message: res.drive === false ? "Connection works, but the Drive folder could not be opened." : "Connection works." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
