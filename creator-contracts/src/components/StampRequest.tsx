"use client";

import { useState, useTransition } from "react";
import { requestStamp, uploadSignedToDrive } from "@/app/(app)/deals/actions";
import { useT } from "@/components/Lang";

type Props = { dealId: string; handle: string; folder: string; requestedAt: string; onSheet: boolean; sheetOn: boolean };

/** Step 2: put the signed PDF in a Drive folder, then send the "계약서 상신" request with that folder link. */
export default function StampRequest({ dealId, handle, folder: initial, requestedAt, onSheet, sheetOn }: Props) {
  const t = useT();
  const [folder, setFolder] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<"drive" | "request" | null>(null);
  const [, start] = useTransition();
  const text = `계약서 1건 날인 요청 @${handle}`;

  const toDrive = () => {
    setError(null);
    setNote(null);
    setBusy("drive");
    start(async () => {
      const res = await uploadSignedToDrive(dealId);
      setBusy(null);
      if ("error" in res) return setError(res.error);
      setFolder(res.url);
      setNote(t("Saved to Google Drive."));
    });
  };

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNote(null);
    setBusy("request");
    start(async () => {
      const res = await requestStamp(dealId, folder);
      setBusy(null);
      if ("error" in res) return setError(res.error);
      setNote(
        res.sheet === "added"
          ? t("Requested and added to the work-request sheet.")
          : res.sheet === "failed"
            ? t("Requested, but the sheet could not be updated. Copy the text and paste it into the sheet.")
            : res.sheet === "kept"
              ? t("Requested. The sheet row added earlier was not changed.")
              : t("Requested. The sheet is not connected: copy the text and paste it into the sheet."),
      );
    });
  };

  return (
    <form className="req" onSubmit={send}>
      {requestedAt && (
        <p className="small" style={{ margin: 0 }}>
          <strong>{t("Stamp requested on {date}.", { date: requestedAt })}</strong> {t("Finance adds the stamped copy to the same folder. The transfer request later uses this same link.")}
        </p>
      )}
      <div>
        <strong className="small">{t("1. Put the signed agreement in a Drive folder")}</strong>
        <div className="row" style={{ marginTop: 6 }}>
          <button type="button" className="btn" onClick={toDrive} disabled={busy !== null}>
            {busy === "drive" ? t("Saving to Drive…") : t("Save to Google Drive")}
          </button>
          <span className="small muted">{t("or paste a folder link you made yourself")}</span>
        </div>
        <label className="field" style={{ marginTop: 8 }}>
          <span>{t("Folder link")}</span>
          <input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="https://" required inputMode="url" />
        </label>
        {folder && /^https?:\/\//.test(folder) && (
          <a href={folder} target="_blank" rel="noopener noreferrer" className="small">
            {folder}
          </a>
        )}
      </div>
      <div>
        <strong className="small">{t("2. Send the stamp request")}</strong>
        <p className="small muted" style={{ margin: "4px 0 8px" }}>
          {t("Sheet row")}: 계약서 상신 · {text}
          {onSheet ? ` · ${t("Already on the sheet.")}` : sheetOn ? "" : ` · ${t("The sheet is not connected yet, so saving only records it here.")}`}
        </p>
        <button className={requestedAt ? "btn" : "btn btn-primary"} disabled={busy !== null}>
          {busy === "request" ? t("Saving…") : requestedAt ? t("Update request link") : t("Request stamp")}
        </button>
      </div>
      {error && <p className="alert alert-warn">{error}</p>}
      {note && <p className="alert alert-info">{note}</p>}
    </form>
  );
}
