"use client";

import { useState, useTransition } from "react";
import { useT } from "@/components/Lang";
import { setPaymentRequest } from "@/app/(app)/deals/actions";

/** Record when the transfer was requested internally and when it is expected to go out. */
export default function PaymentRequest({ dealId, requested, expected }: { dealId: string; requested?: string | null; expected?: string | null }) {
  const t = useT();
  const editing = !!requested;
  const [req, setReq] = useState(requested?.slice(0, 10) ?? new Date().toISOString().slice(0, 10));
  const [exp, setExp] = useState(expected ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="upload"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const res = await setPaymentRequest(dealId, req, exp);
          if (res && "error" in res) setError(res.error);
        });
      }}
    >
      <label className="field" style={{ flex: "0 1 200px" }}>
        <span>{t("Transfer requested on")}</span>
        <input type="date" value={req} onChange={(e) => setReq(e.target.value)} required />
      </label>
      <label className="field" style={{ flex: "0 1 200px" }}>
        <span>{t("Expected transfer date")}</span>
        <input type="date" value={exp} onChange={(e) => setExp(e.target.value)} required />
      </label>
      <button className={editing ? "btn" : "btn btn-primary"} disabled={pending} style={{ alignSelf: "flex-end" }}>
        {pending ? t("Saving…") : editing ? t("Update dates") : t("Transfer requested")}
      </button>
      {error && <p className="alert alert-warn">{error}</p>}
    </form>
  );
}
