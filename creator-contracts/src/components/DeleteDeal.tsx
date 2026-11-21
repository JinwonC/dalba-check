"use client";

import { useState, useTransition } from "react";
import { deleteDeal } from "@/app/(app)/deals/actions";
import { useT } from "@/components/Lang";

/** Permanently deletes a deal after the manager types the creator's handle. */
export default function DeleteDeal({ dealId, handle, signed }: { dealId: string; handle: string; signed: boolean }) {
  const t = useT();
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const match = typed.trim().replace(/^@/, "").toLowerCase() === handle.toLowerCase();
  return (
    <details className="card danger-zone">
      <summary>
        <h2>{t("Delete this agreement")}</h2>
      </summary>
      <p>{t("This removes the agreement, the creator's bank details, the activity record and any uploaded stamped copy from this site. The creator link stops working. It cannot be undone.")}</p>
      {signed && <p className="alert alert-warn">{t("This agreement is signed. Download the signed PDF first if you need to keep a record. Files already in Google Drive and rows already on the sheet are not removed.")}</p>}
      <label className="field" style={{ maxWidth: 360 }}>
        <span>{t("Type the handle {handle} to confirm", { handle: `@${handle}` })}</span>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
      </label>
      {error && <p className="alert alert-warn">{error}</p>}
      <button
        type="button"
        className="btn btn-delete"
        disabled={!match || pending}
        onClick={() =>
          start(async () => {
            const res = await deleteDeal(dealId, typed);
            if (res?.error) setError(res.error);
          })
        }
      >
        {pending ? t("Working…") : t("Delete permanently")}
      </button>
    </details>
  );
}
