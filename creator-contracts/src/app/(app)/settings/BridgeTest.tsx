"use client";

import { useState, useTransition } from "react";
import { useT } from "@/components/Lang";
import { testBridge } from "./actions";

export default function BridgeTest({ email }: { email: string }) {
  const t = useT();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const run = (what: "ping" | "email" | "row") =>
    start(async () => {
      setResult(null);
      const res = await testBridge(what);
      setResult("error" in res ? { ok: false, text: res.error } : { ok: true, text: t(res.message, { email }) });
    });
  return (
    <>
      <div className="row">
        <button type="button" className="btn" disabled={pending} onClick={() => run("ping")}>
          {t("Check connection")}
        </button>
        <button type="button" className="btn" disabled={pending} onClick={() => run("email")}>
          {t("Send me a test email")}
        </button>
        <button type="button" className="btn" disabled={pending} onClick={() => run("row")}>
          {t("Add a test row to the sheet")}
        </button>
      </div>
      {pending && <p className="small muted" style={{ marginTop: 10 }}>{t("Working…")}</p>}
      {result && (
        <p className={result.ok ? "alert alert-info" : "alert alert-warn"} style={{ marginTop: 12 }}>
          {result.text}
        </p>
      )}
    </>
  );
}
