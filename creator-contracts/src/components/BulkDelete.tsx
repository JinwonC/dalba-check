"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/Lang";

/** Header checkbox that ticks every row in the same form. */
export function SelectAll() {
  const t = useT();
  return (
    <input
      type="checkbox"
      aria-label={t("Select all")}
      onChange={(e) => {
        e.currentTarget.form?.querySelectorAll<HTMLInputElement>('input[name="ids"]').forEach((box) => (box.checked = e.currentTarget.checked));
        e.currentTarget.form?.dispatchEvent(new Event("change", { bubbles: true }));
      }}
    />
  );
}

/** Bar that appears when rows are ticked; confirms before submitting the surrounding form. */
export function DeleteSelected() {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState<{ id: string; handle: string; signed: boolean }[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const read = () =>
      setPicked(
        [...form.querySelectorAll<HTMLInputElement>('input[name="ids"]:checked')].map((b) => ({ id: b.value, handle: b.dataset.handle || "", signed: b.dataset.signed === "1" })),
      );
    form.addEventListener("change", read);
    read();
    return () => form.removeEventListener("change", read);
  }, []);

  const submit = () => {
    const form = ref.current?.closest("form");
    if (!form || !picked.length) return;
    const names = picked.map((p) => `@${p.handle}`).join(", ");
    const signed = picked.filter((p) => p.signed).length;
    const lines = [t("Delete {n} agreement(s) permanently?", { n: picked.length }), names];
    if (signed) lines.push(t("{n} of them are signed. Download the signed PDFs first if you need a record.", { n: signed }));
    lines.push(t("This cannot be undone."));
    if (!window.confirm(lines.join("\n\n"))) return;
    setBusy(true);
    form.requestSubmit();
  };

  // One stamp or transfer request covering every ticked agreement.
  const together = (kind: "stamp" | "payment") => {
    window.location.href = `/batch?kind=${kind}&ids=${picked.map((p) => encodeURIComponent(p.id)).join(",")}`;
  };

  return (
    <div ref={ref} className={picked.length ? "bulkbar on" : "bulkbar"}>
      <span>{picked.length ? t("{n} selected", { n: picked.length }) : t("Tick agreements to request or delete several at once.")}</span>
      <button type="button" className="btn btn-sm" disabled={picked.length < 2 || busy} onClick={() => together("stamp")}>
        {t("Stamp request together")}
      </button>
      <button type="button" className="btn btn-sm" disabled={picked.length < 2 || busy} onClick={() => together("payment")}>
        {t("Transfer request together")}
      </button>
      <button type="button" className="btn btn-sm btn-delete" disabled={!picked.length || busy} onClick={submit}>
        {busy ? t("Working…") : t("Delete selected")}
      </button>
    </div>
  );
}
