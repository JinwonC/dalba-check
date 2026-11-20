"use client";

import { useState, useTransition } from "react";
import { setPaymentRequest } from "@/app/(app)/deals/actions";
import { useT } from "@/components/Lang";
import { REQUEST_KINDS, requestText } from "@/lib/request-text";
import type { Fields } from "@/lib/template";

type Props = {
  dealId: string;
  fields: Fields;
  videos: string[];
  requested?: string | null;
  expected?: string | null;
  saved?: { kind: string; purpose: string; folder: string; sheet_at?: string } | null;
  sheetOn: boolean;
};

/** The transfer request: dates, purpose and the stamped-copy folder link, with the text that goes on the work-request sheet. */
export default function PaymentRequest({ dealId, fields, videos, requested, expected, saved, sheetOn }: Props) {
  const t = useT();
  const editing = !!requested;
  const [req, setReq] = useState(requested?.slice(0, 10) ?? new Date().toISOString().slice(0, 10));
  const [exp, setExp] = useState(expected ?? "");
  const [purpose, setPurpose] = useState(saved?.purpose ?? "");
  const [folder, setFolder] = useState(saved?.folder ?? "");
  const [kind, setKind] = useState(saved?.kind ?? REQUEST_KINDS[0]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  const text = requestText(fields, { purpose, expected: exp, videos });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt(t("Copy"), text);
    }
  };

  return (
    <form
      className="req"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        setNote(null);
        start(async () => {
          const res = await setPaymentRequest(dealId, { requested: req, expected: exp, purpose, folder, kind });
          if ("error" in res) return setError(res.error);
          setNote(
            res.sheet === "added"
              ? t("Saved and added to the work-request sheet.")
              : res.sheet === "failed"
                ? t("Saved, but the sheet could not be updated. Copy the text below and paste it into the sheet.")
                : res.sheet === "kept"
                  ? t("Saved. The sheet row added earlier was not changed.")
                  : t("Saved. The sheet is not connected yet: copy the text below and paste it into the sheet."),
          );
        });
      }}
    >
      <div className="grid">
        <label className="field">
          <span>{t("Transfer requested on")}</span>
          <input type="date" value={req} onChange={(e) => setReq(e.target.value)} required />
        </label>
        <label className="field">
          <span>{t("Expected transfer date")}</span>
          <input type="date" value={exp} onChange={(e) => setExp(e.target.value)} required />
        </label>
        <label className="field span-2">
          <span>{t("Purpose and expected effect")}</span>
          <input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="BFCM 기간 매출 증대 등" required maxLength={500} />
        </label>
        <label className="field span-2">
          <span>{t("Folder link of the stamped agreement and invoice")}</span>
          <input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="https://" required inputMode="url" />
          <small>{t("Upload the company-stamped copy to the drive yourself, then paste the link here.")}</small>
        </label>
        <label className="field">
          <span>{t("Request type")}</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {REQUEST_KINDS.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="req-preview">
        <div className="req-preview-head">
          <strong>{t("Text for the work-request sheet")}</strong>
          <button type="button" className="btn btn-sm" onClick={copy}>
            {copied ? t("Copied") : t("Copy")}
          </button>
        </div>
        <pre>{text}</pre>
        <p className="small muted">
          {saved?.sheet_at
            ? t("Already added to the sheet on {date}.", { date: saved.sheet_at.slice(0, 10) })
            : sheetOn
              ? t("Saving adds this as a new row on the sheet.")
              : t("The sheet is not connected yet, so saving only records it here.")}
        </p>
      </div>

      {error && <p className="alert alert-warn">{error}</p>}
      {note && <p className="alert alert-info">{note}</p>}
      <button className={editing ? "btn" : "btn btn-primary"} disabled={pending}>
        {pending ? t("Saving…") : editing ? t("Update request") : t("Transfer requested")}
      </button>
    </form>
  );
}
