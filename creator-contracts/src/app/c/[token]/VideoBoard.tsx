"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { VideoSlot } from "@/lib/deals";
import { submitDraft, submitLive } from "./actions";

const LABEL: Record<VideoSlot["status"], string> = {
  empty: "Not started",
  review: "Draft in review",
  revise: "Changes requested",
  approved: "Approved, ready to post",
  posted: "Posted",
};
const TONE: Record<VideoSlot["status"], string> = { empty: "neutral", review: "wait", revise: "warn", approved: "ok", posted: "ok" };

function Slot({ token, v }: { token: string; v: VideoSlot }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [extra, setExtra] = useState("");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const draftStep = v.status === "revise" || ((v.status === "empty" || v.status === "review") && editing);
  const liveStep = v.status === "approved" || (v.status === "posted" && editing);

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = draftStep ? await submitDraft(token, v.id, url, extra) : await submitLive(token, v.id, url, extra);
      if ("error" in res) return setError(res.error);
      setUrl("");
      setExtra("");
      setEditing(false);
      router.refresh();
    });
  };

  return (
    <li className={`vslot vslot-${v.status}`}>
      <div className="vslot-head">
        <strong>Video {v.n}</strong>
        <span className={`pill pill-${TONE[v.status]}`}>{LABEL[v.status]}</span>
      </div>
      {v.status === "revise" && v.feedback && (
        <p className="alert alert-warn">
          <strong>d&apos;Alba feedback:</strong> {v.feedback}
        </p>
      )}
      {v.status === "approved" && v.feedback && <p className="small muted">Note from d&apos;Alba: {v.feedback}</p>}
      {v.draft_url && v.status !== "posted" && (
        <p className="small">
          Draft:{" "}
          <a href={v.draft_url} target="_blank" rel="noopener noreferrer">
            {v.draft_url}
          </a>
        </p>
      )}
      {v.live_url && (
        <p className="small">
          Live:{" "}
          <a href={v.live_url} target="_blank" rel="noopener noreferrer">
            {v.live_url}
          </a>
          {v.spark_code ? " · Spark code received" : " · Spark code missing"}
        </p>
      )}
      {v.status === "review" && !editing && <p className="small muted">We are reviewing your draft. You will see the result here.</p>}

      {(draftStep || liveStep) && (
        <form onSubmit={send} className="vslot-form">
          <label className="field">
            <span>{draftStep ? "Link to your draft video" : "Link to the posted TikTok video"}</span>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" required inputMode="url" autoComplete="off" />
          </label>
          <label className="field">
            <span>{draftStep ? "Note for d'Alba (optional)" : "Spark Ads authorization code"}</span>
            <input value={extra} onChange={(e) => setExtra(e.target.value)} autoComplete="off" />
          </label>
          {error && <p className="alert alert-warn">{error}</p>}
          <button className="btn btn-primary" disabled={pending}>
            {pending ? "Sending…" : draftStep ? (v.status === "empty" ? "Submit draft" : "Submit new draft") : "Submit posted video"}
          </button>
        </form>
      )}
      {v.status === "empty" && !editing && (
        <button type="button" className="btn btn-sm" onClick={() => setEditing(true)}>
          Submit draft
        </button>
      )}
      {(v.status === "review" || v.status === "posted") && !editing && (
        <button type="button" className="linkish small" onClick={() => setEditing(true)}>
          {v.status === "review" ? "Replace draft link" : "Update link or Spark code"}
        </button>
      )}
    </li>
  );
}

export default function VideoBoard({ token, slots }: { token: string; slots: VideoSlot[] }) {
  const products = [...new Set(slots.map((s) => s.product))];
  return (
    <>
      {products.map((p) => {
        const mine = slots.filter((s) => s.product === p);
        return (
          <section key={p} className="card">
            <h2>{p}</h2>
            <p className="hint">
              {mine.filter((s) => s.status === "posted").length} of {mine.length} posted
            </p>
            <ul className="vslots">
              {mine.map((v) => (
                <Slot key={v.id} token={token} v={v} />
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}
