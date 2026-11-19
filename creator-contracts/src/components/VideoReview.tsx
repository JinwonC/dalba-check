"use client";

import { useState, useTransition } from "react";
import { reviewDraft, setVideoByManager } from "@/app/(app)/deals/actions";
import type { VideoSlot } from "@/lib/deals";

const LABEL: Record<VideoSlot["status"], string> = {
  empty: "Not submitted",
  review: "Draft to review",
  revise: "Revision requested",
  approved: "Approved, not posted",
  posted: "Posted",
};
const TONE: Record<VideoSlot["status"], string> = { empty: "neutral", review: "warn", revise: "wait", approved: "wait", posted: "ok" };

function Row({ dealId, v }: { dealId: string; v: VideoSlot }) {
  const [feedback, setFeedback] = useState("");
  const [live, setLive] = useState("");
  const [manual, setManual] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ error: string } | undefined>) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (res?.error) return setError(res.error);
      setFeedback("");
      setLive("");
      setManual(false);
    });
  };
  return (
    <li className={`vrow vrow-${v.status}`}>
      <div className="vrow-main">
        <span className="vrow-n">#{v.n}</span>
        <span className={`pill pill-${TONE[v.status]}`}>{LABEL[v.status]}</span>
        {v.draft_url && (
          <a href={v.draft_url} target="_blank" rel="noopener noreferrer" className="small">
            Draft
          </a>
        )}
        {v.live_url && (
          <a href={v.live_url} target="_blank" rel="noopener noreferrer" className="small">
            Live video
          </a>
        )}
        {v.status === "posted" && <span className={v.spark_code ? "small muted" : "small late"}>{v.spark_code ? `Spark: ${v.spark_code}` : "No Spark code"}</span>}
        <button type="button" className="linkish small vrow-more" onClick={() => setManual(!manual)}>
          {manual ? "Close" : "Edit"}
        </button>
      </div>
      {v.draft_note && v.status === "review" && <p className="small muted">Creator note: {v.draft_note}</p>}
      {v.status === "revise" && v.feedback && <p className="small muted">Your feedback: {v.feedback}</p>}
      {v.status === "review" && (
        <div className="vrow-act">
          <input value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Feedback (required to request a revision)" aria-label="Feedback" />
          <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => run(() => reviewDraft(dealId, v.id, "approve", feedback))}>
            Approve
          </button>
          <button type="button" className="btn btn-sm" disabled={pending} onClick={() => run(() => reviewDraft(dealId, v.id, "revise", feedback))}>
            Request revision
          </button>
        </div>
      )}
      {manual && (
        <div className="vrow-act">
          <input value={live} onChange={(e) => setLive(e.target.value)} placeholder="Live video link the creator sent you" aria-label="Live link" />
          <button type="button" className="btn btn-sm" disabled={pending || !live.trim()} onClick={() => run(() => setVideoByManager(dealId, v.id, live))}>
            Save as posted
          </button>
          {v.status !== "empty" && (
            <button
              type="button"
              className="btn btn-sm btn-danger"
              disabled={pending}
              onClick={() => window.confirm("Clear this video's draft and links?") && run(() => setVideoByManager(dealId, v.id, ""))}
            >
              Reset
            </button>
          )}
        </div>
      )}
      {error && <p className="alert alert-warn">{error}</p>}
    </li>
  );
}

export default function VideoReview({ dealId, slots }: { dealId: string; slots: VideoSlot[] }) {
  const products = [...new Set(slots.map((s) => s.product))];
  return (
    <>
      {products.map((p) => {
        const mine = slots.filter((s) => s.product === p);
        return (
          <div key={p} className="vgroup">
            <h3>
              {p} <span className="muted small">· {mine.filter((s) => s.status === "posted").length}/{mine.length} posted</span>
            </h3>
            <ul className="vrows">
              {mine.map((v) => (
                <Row key={v.id} dealId={dealId} v={v} />
              ))}
            </ul>
          </div>
        );
      })}
    </>
  );
}
