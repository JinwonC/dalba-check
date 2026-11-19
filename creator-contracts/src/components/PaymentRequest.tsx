"use client";

import { useState, useTransition } from "react";
import { setPaymentRequest } from "@/app/(app)/deals/actions";

/** Record that the remittance was requested internally, with the expected transfer date. */
export default function PaymentRequest({ dealId, current }: { dealId: string; current?: string | null }) {
  const [date, setDate] = useState(current ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="upload"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const res = await setPaymentRequest(dealId, date);
          if (res && "error" in res) setError(res.error);
        });
      }}
    >
      <label className="field" style={{ flex: "0 1 220px" }}>
        <span>Expected transfer date</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
      </label>
      <button className={current ? "btn" : "btn btn-primary"} disabled={pending} style={{ alignSelf: "flex-end" }}>
        {pending ? "Saving…" : current ? "Update date" : "Mark transfer requested"}
      </button>
      {error && <p className="alert alert-warn">{error}</p>}
    </form>
  );
}
