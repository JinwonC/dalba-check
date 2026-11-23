"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { batchPaymentRequest, batchStampRequest, type BatchResult } from "@/app/(app)/batch/actions";
import { batchPaymentText, batchPaymentTitle, batchStampText, batchStampTitle } from "@/lib/request-text";
import { money, type Fields } from "@/lib/template";
import { useT } from "@/components/Lang";

export type BatchItem = { id: string; fields: Fields; videos: { url: string; at: string }[]; already: boolean; folder: string };
type Props = { kind: "stamp" | "payment"; items: BatchItem[]; today: string; sheetOn: boolean; driveOn: boolean };

/** One request for several creators. The sheet text is generated, and can be edited before sending. */
export default function BatchRequest({ kind, items, today, sheetOn, driveOn }: Props) {
  const t = useT();
  const stamp = kind === "stamp";
  const [title, setTitle] = useState(stamp ? batchStampTitle(items) : batchPaymentTitle(items));
  const [purpose, setPurpose] = useState("");
  const [custom, setCustom] = useState<string | null>(null);
  // Contracts stamped together share one folder, so offer it for the transfer request.
  const shared = items.every((i) => i.folder && i.folder === items[0].folder) ? items[0].folder : "";
  const [folder, setFolder] = useState(stamp ? "" : shared);
  const [requested, setRequested] = useState(today);
  const [expected, setExpected] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Extract<BatchResult, { ok: true }> | null>(null);
  const [busy, start] = useTransition();

  const auto = useMemo(() => (stamp ? batchStampText(items, title, purpose) : batchPaymentText(items, title)), [stamp, items, title, purpose]);
  const text = custom ?? auto;
  const again = items.filter((i) => i.already);

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (stamp && !purpose.trim() && custom === null) return setError(t("Enter the purpose and expected effect."));
    start(async () => {
      const ids = items.map((i) => i.id);
      const res = stamp ? await batchStampRequest(ids, { text, folder }) : await batchPaymentRequest(ids, { text, folder, requested, expected });
      if ("error" in res) return setError(res.error);
      setDone(res);
    });
  };

  if (done) {
    return (
      <div className="card">
        <h2>{t("Requested for {n} agreements.", { n: done.count })}</h2>
        <p>
          {done.sheet === "added"
            ? t("One row was added to the work-request sheet.")
            : done.sheet === "failed"
              ? t("The sheet could not be updated. Copy the text below and paste it into the sheet.")
              : t("The sheet is not connected. Copy the text below and paste it into the sheet.")}
        </p>
        <p>
          {t("Folder")}:{" "}
          <a href={done.folder} target="_blank" rel="noopener noreferrer">
            {done.folder}
          </a>
        </p>
        <pre className="pre small">{text}</pre>
        <Link href="/" className="btn btn-primary">
          {t("Back to the list")}
        </Link>
      </div>
    );
  }

  return (
    <form className="card stack" onSubmit={send}>
      <div>
        <h2>{t("{n} agreements in this request", { n: items.length })}</h2>
        <ul className="batchlist">
          {items.map((i) => (
            <li key={i.id}>
              <Link href={`/deals/${i.id}`} className="strong">
                @{i.fields.handle}
              </Link>{" "}
              <span className="muted small">
                {money(i.fields.fee, i.fields.currency)}
                {!stamp && ` · ${t("{n} video link(s)", { n: i.videos.length })}`}
                {i.already && ` · ${t("requested before")}`}
              </span>
            </li>
          ))}
        </ul>
        {again.length > 0 && <p className="hint">{t("Some of these were requested before. Sending again adds a new row to the sheet.")}</p>}
      </div>

      <label className="field">
        <span>{t("Request title")}</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={120} />
      </label>
      {stamp && (
        <label className="field">
          <span>{t("Purpose and expected effect (same for all)")}</span>
          <input value={purpose} onChange={(e) => { setPurpose(e.target.value); setError(null); }} placeholder="BFCM 기간 매출 증대 등" maxLength={300} />
        </label>
      )}
      {!stamp && (
        <div className="grid">
          <label className="field">
            <span>{t("Request date")}</span>
            <input type="date" value={requested} onChange={(e) => setRequested(e.target.value)} required />
          </label>
          <label className="field">
            <span>{t("Expected transfer date")}</span>
            <input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} required />
          </label>
        </div>
      )}
      <label className="field">
        <span>{t("Folder link")}</span>
        <input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="https://" inputMode="url" required={!stamp || !driveOn} />
        <small>
          {stamp
            ? driveOn
              ? t("Leave empty and one Drive folder is created with every signed PDF and an empty “날인” folder.")
              : t("Google Drive is not connected. Paste the folder link yourself.")
            : t("The folder that holds the stamped agreements.")}
        </small>
      </label>

      <label className="field">
        <span>
          {t("Text for the sheet")} {custom !== null && <em className="muted">({t("edited by hand")})</em>}
        </span>
        <textarea rows={Math.min(22, text.split("\n").length + 2)} value={text} onChange={(e) => setCustom(e.target.value)} />
        <small>
          {stamp ? "계약서 상신" : "지출결의서 상신"} · {sheetOn ? t("Goes to the work-request sheet as one row.") : t("The sheet is not connected yet, so saving only records it here.")}
          {!stamp && ` ${t("The date beside each creator is when the link was submitted here; change it if the video went up on another day.")}`}
        </small>
        {custom !== null && (
          <button type="button" className="linkish small" style={{ justifySelf: "start" }} onClick={() => setCustom(null)}>
            {t("Back to the generated text")}
          </button>
        )}
      </label>

      {error && <p className="alert alert-warn">{error}</p>}
      <div className="row">
        <button className="btn btn-primary" disabled={busy}>
          {busy ? (stamp && !folder ? t("Saving to Drive…") : t("Saving…")) : t("Send one request for {n} agreements", { n: items.length })}
        </button>
        <Link href="/" className="btn btn-ghost">
          {t("Cancel")}
        </Link>
      </div>
    </form>
  );
}
