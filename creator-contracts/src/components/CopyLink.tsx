"use client";

import { useState } from "react";

export default function CopyLink({ url, compact }: { url: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt("Copy this link", url);
    }
  };
  if (compact) {
    return (
      <button type="button" className="btn btn-sm" onClick={copy}>
        {copied ? "Copied" : "Copy link"}
      </button>
    );
  }
  return (
    <div className="copy">
      <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Creator link" />
      <button type="button" className="btn btn-primary" onClick={copy}>
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  );
}
