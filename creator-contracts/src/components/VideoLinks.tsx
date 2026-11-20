"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { VideoGroup } from "@/lib/deals";

export type VideoLabels = {
  submitted: string; // "{a} of {b} submitted"
  remaining: string; // "{n} left"
  allIn: string;
  placeholder: string;
  add: string;
  adding: string;
  remove: string;
  confirmRemove: string;
  none: string;
};

type Result = { error: string } | { ok: true } | undefined;

function Group({ g, labels, onAdd, onRemove }: { g: VideoGroup; labels: VideoLabels; onAdd: (item: number, url: string) => Promise<Result>; onRemove: (id: string) => Promise<Result> }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const left = Math.max(0, g.count - g.videos.length);
  const run = (fn: () => Promise<Result>, after?: () => void) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (res && "error" in res) return setError(res.error);
      after?.();
      router.refresh();
    });
  };
  return (
    <div className="vgroup">
      <div className="vgroup-head">
        <h3>{g.product}</h3>
        <span className="vgroup-count">
          {labels.submitted.replace("{a}", String(g.videos.length)).replace("{b}", String(g.count))}
          {left > 0 ? <span className="need">{labels.remaining.replace("{n}", String(left))}</span> : <span className="pill pill-ok">{labels.allIn}</span>}
        </span>
      </div>
      <div className="vbar" aria-hidden>
        <span style={{ width: `${g.count ? Math.min(100, (g.videos.length / g.count) * 100) : 0}%` }} />
      </div>
      {g.videos.length === 0 ? (
        <p className="small muted">{labels.none}</p>
      ) : (
        <ol className="vlist">
          {g.videos.map((v) => (
            <li key={v.id}>
              <a href={v.url} target="_blank" rel="noopener noreferrer">
                {v.url}
              </a>
              <span className="muted small">{v.at.slice(0, 10)}</span>
              <button type="button" className="linkish small" disabled={pending} onClick={() => window.confirm(labels.confirmRemove) && run(() => onRemove(v.id))}>
                {labels.remove}
              </button>
            </li>
          ))}
        </ol>
      )}
      {left > 0 && (
        <form
          className="vadd"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => onAdd(g.item, url), () => setUrl(""));
          }}
        >
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={labels.placeholder} required inputMode="url" autoComplete="off" aria-label={labels.placeholder} />
          <button className="btn btn-primary" disabled={pending}>
            {pending ? labels.adding : labels.add}
          </button>
        </form>
      )}
      {error && <p className="alert alert-warn">{error}</p>}
    </div>
  );
}

/** Posted-video links per product, with a field to add the next one. Used by creators and managers. */
export default function VideoLinks(props: { groups: VideoGroup[]; labels: VideoLabels; onAdd: (item: number, url: string) => Promise<Result>; onRemove: (id: string) => Promise<Result> }) {
  return (
    <>
      {props.groups.map((g) => (
        <Group key={g.item} g={g} labels={props.labels} onAdd={props.onAdd} onRemove={props.onRemove} />
      ))}
    </>
  );
}
