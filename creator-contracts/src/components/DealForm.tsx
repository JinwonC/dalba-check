"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { saveDeal } from "@/app/(app)/deals/actions";
import { useT } from "@/components/Lang";
import { ContractDoc } from "@/components/Document";
import { COUNTRIES, PLACEHOLDERS, clauseState, defaultClauses, itemsOf, joinNames, liveFee, money, type Clause, type Fields, type Item, type Kind } from "@/lib/template";

type Props = { dealId: string | null; initialFields: Fields; initialClauses: Clause[]; live: boolean };

export default function DealForm({ dealId, initialFields, initialClauses, live }: Props) {
  const [f, setFields] = useState<Fields>({ ...initialFields, items: itemsOf(initialFields) });
  // Keep the joined product name and total in sync so the preview is always right.
  const setF = (fn: (p: Fields) => Fields) =>
    setFields((p) => {
      const n = fn(p);
      if (n.kind === "live") return { ...n, fee: liveFee(n), effectiveDate: n.startDate };
      return { ...n, product: joinNames(n.items.map((i) => i.product)), deliverableCount: n.items.reduce((t, i) => t + (Number(i.count) || 0), 0) };
    });
  const setItem = (idx: number, patch: Partial<Item>) => setF((p) => ({ ...p, items: p.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)) }));
  const [clauses, setClauses] = useState<Clause[]>(initialClauses);
  const t = useT();
  const [open, setOpen] = useState<string | null>(null);
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const set = <K extends keyof Fields>(k: K, v: Fields[K]) => setF((p) => ({ ...p, [k]: v }));
  const text = (k: keyof Fields) => ({
    value: String(f[k] ?? ""),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => set(k, e.target.value as never),
  });
  const number = (k: keyof Fields) => ({
    type: "number",
    min: 0,
    value: f[k] === 0 ? "" : String(f[k]),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(k, (e.target.value === "" ? 0 : Number(e.target.value)) as never),
  });

  const patchClause = (id: string, patch: Partial<Clause>) => setClauses((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const move = (i: number, dir: -1 | 1) =>
    setClauses((cs) => {
      const j = i + dir;
      if (j < 0 || j >= cs.length) return cs;
      const next = [...cs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const addClause = () => {
    const id = `custom-${Date.now().toString(36)}`;
    setClauses((cs) => [...cs, { id, title: t("New clause"), body: "" }]);
    setOpen(id);
  };
  const isLiveDeal = f.kind === "live";
  const standard = defaultClauses(f.kind);
  const removed = standard.filter((d) => !clauses.some((c) => c.id === d.id));

  // Switching the contract type swaps in that type's standard clauses.
  const switchKind = (kind: Kind) => {
    if (kind === (f.kind ?? "video")) return;
    const edited = clauses.some((c) => clauseState(c) !== "standard");
    if (edited && !window.confirm(t("Switching the contract type replaces the clauses with the standard ones for that type. Continue?"))) return;
    setClauses(defaultClauses(kind));
    setOpen(null);
    setF((p) => ({
      ...p,
      kind,
      sessionLength: p.sessionLength || "Minimum 1 hour per session",
      items: kind === "video" && !p.items.length ? [{ product: "", count: 10 }] : p.items,
      invoiceDescription: kind === "live" ? "Livestream hourly service" : "TikTok Shop Video Content Package",
      deliverableType: kind === "live" ? "TikTok Live" : "TikTok shoppable videos",
      paidUsageDays: kind === "live" ? 0 : p.paidUsageDays || 30,
    }));
  };

  const submit = (send: boolean) => {
    setError(null);
    start(async () => {
      const res = await saveDeal(dealId, f, clauses, send);
      if (res?.error) setError(res.error);
    });
  };

  return (
    <div>
      <div className="tabs">
        <button type="button" className={tab === "edit" ? "tab active" : "tab"} onClick={() => setTab("edit")}>
          {t("Edit")}
        </button>
        <button type="button" className={tab === "preview" ? "tab active" : "tab"} onClick={() => setTab("preview")}>
          {t("Preview as creator")}
        </button>
      </div>

      {tab === "preview" ? (
        <div className="paper-wrap">
          <ContractDoc fields={{ ...f, talentName: f.talentName || f.handle }} clauses={clauses.filter((c) => c.body.trim())} />
        </div>
      ) : (
        <>
          <section className="card">
            <h2>{t("Contract type")}</h2>
            <div className="kind" role="group" aria-label={t("Contract type")}>
              <button type="button" aria-pressed={!isLiveDeal} onClick={() => switchKind("video")} disabled={live}>
                <strong>{t("Video")}</strong>
                <span>{t("Shoppable videos: products, video counts, fixed fee")}</span>
              </button>
              <button type="button" aria-pressed={isLiveDeal} onClick={() => switchKind("live")} disabled={live}>
                <strong>{t("Live")}</strong>
                <span>{t("Livestream hosting: schedule, hourly rate, hours")}</span>
              </button>
            </div>
            {live && <p className="hint">{t("The type cannot be changed after the link is created.")}</p>}
          </section>

          <section className="card">
            <h2>{t("Creator")}</h2>
            <div className="grid">
              <label className="field">
                <span>{t("TikTok handle *")}</span>
                <input {...text("handle")} placeholder="rache__empire" autoComplete="off" />
              </label>
              <label className="field">
                <span>{t("Talent / Agency name")}</span>
                <input {...text("talentName")} placeholder={t("Defaults to the handle")} />
              </label>
              <label className="field">
                <span>{t("Creator email (optional)")}</span>
                <input {...text("creatorEmail")} type="email" />
              </label>
              <label className="field">
                <span>{t("Country")}</span>
                <select {...text("country")}>
                  {COUNTRIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          {isLiveDeal ? (
            <>
              <section className="card">
                <h2>{t("Live terms")}</h2>
                <div className="grid">
                  <label className="field">
                    <span>{t("Contract starts *")}</span>
                    <input {...text("startDate")} type="date" />
                  </label>
                  <label className="field">
                    <span>{t("Contract ends *")}</span>
                    <input {...text("endDate")} type="date" />
                  </label>
                  <label className="field span-2">
                    <span>{t("Date and time of the sessions")}</span>
                    <input {...text("liveSchedule")} placeholder="e.g. Tue & Thu 7-9 PM ET, to be confirmed 24 hours ahead" />
                  </label>
                  <label className="field span-2">
                    <span>{t("Session length")}</span>
                    <input {...text("sessionLength")} />
                  </label>
                </div>
              </section>
              <section className="card">
                <h2>{t("Fee and invoice")}</h2>
                <div className="grid">
                  <label className="field">
                    <span>{t("Hourly rate *")}</span>
                    <input {...number("hourlyRate")} step="0.01" placeholder="100" />
                  </label>
                  <label className="field">
                    <span>{t("Total hours *")}</span>
                    <input {...number("hours")} step="0.5" placeholder="10" />
                  </label>
                  <label className="field">
                    <span>{t("Currency")}</span>
                    <select {...text("currency")}>
                      <option>USD</option>
                      <option>GBP</option>
                      <option>EUR</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>{t("Commission % (0 for none)")}</span>
                    <input {...number("commissionPct")} step="0.1" />
                  </label>
                </div>
                <p className="hint">
                  {t("Invoice total: {hours} hours x {rate} = {total}", { hours: f.hours || 0, rate: money(Number(f.hourlyRate) || 0, f.currency), total: money(liveFee(f), f.currency) })}
                </p>
              </section>
            </>
          ) : (
            <>
          <section className="card">
            <h2>{t("Deal terms")}</h2>
            <div className="grid">
              <div className="span-2 items">
                <div className="items-head">
                  <span>{t("Product *")}</span>
                  <span>{t("Videos *")}</span>
                </div>
                {f.items.map((it, i) => (
                  <div key={i} className="items-row">
                    <input value={it.product} onChange={(e) => setItem(i, { product: e.target.value })} placeholder="White Truffle First Spray Serum Holiday Gift Set (3+2+1)" aria-label={`Product ${i + 1}`} />
                    <input type="number" min={0} value={it.count === 0 ? "" : it.count} onChange={(e) => setItem(i, { count: e.target.value === "" ? 0 : Number(e.target.value) })} aria-label={`Videos for product ${i + 1}`} />
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setF((p) => ({ ...p, items: p.items.filter((_, j) => j !== i) }))} disabled={f.items.length === 1} aria-label="Remove product">
                      ✕
                    </button>
                  </div>
                ))}
                <div className="row">
                  <button type="button" className="btn btn-sm" onClick={() => setF((p) => ({ ...p, items: [...p.items, { product: "", count: 0 }] }))}>
                    {t("+ Add product")}
                  </button>
                  <span className="muted small">{t("Total: {n} videos", { n: f.deliverableCount })}</span>
                </div>
              </div>
              <label className="field">
                <span>{t("Effective date *")}</span>
                <input {...text("effectiveDate")} type="date" />
              </label>
              <label className="field">
                <span>{t("Paid usage (days)")}</span>
                <input {...number("paidUsageDays")} />
              </label>
              <label className="field">
                <span>{t("Content goes live from (month) *")}</span>
                <MonthPick value={f.startDate} onChange={(v) => set("startDate", v)} t={t} />
              </label>
              <label className="field">
                <span>{t("Content completed by (month) *")}</span>
                <MonthPick value={f.endDate} onChange={(v) => set("endDate", v)} t={t} />
              </label>
              <label className="field">
                <span>{t("Deliverable type")}</span>
                <input {...text("deliverableType")} />
              </label>
            </div>
          </section>

          <section className="card">
            <h2>{t("Fee and invoice")}</h2>
            <div className="grid">
              <label className="field">
                <span>{t("Fixed fee *")}</span>
                <input {...number("fee")} step="0.01" placeholder="300" />
              </label>
              <label className="field">
                <span>{t("Currency")}</span>
                <select {...text("currency")}>
                  <option>USD</option>
                  <option>GBP</option>
                  <option>EUR</option>
                </select>
              </label>
              <label className="field">
                <span>{t("Commission % (0 for none)")}</span>
                <input {...number("commissionPct")} step="0.1" />
              </label>
              <label className="field">
                <span>{t("Invoice line description")}</span>
                <input {...text("invoiceDescription")} />
              </label>
            </div>
            <p className="hint">{t("The invoice is generated from these values and the bank details the creator enters when signing.")}</p>
          </section>

            </>
          )}

          <section className="card">
            <h2>{t("Clauses")}</h2>
            <p className="hint">
              {t("Edits apply to this creator only. Placeholders are filled from the fields above:")}{" "}
              {PLACEHOLDERS.map((p) => (
                <code key={p}>{`{{${p}}}`}</code>
              ))}
              . {t("Start a line with")} <code>## </code> {t("for a sub-heading or")} <code>- </code> {t("for a bullet.")}
            </p>
            {clauses.map((c, i) => {
              const state = clauseState(c);
              const base = standard.find((d) => d.id === c.id);
              return (
                <div key={c.id} className="clause">
                  <div className="clause-head">
                    <button type="button" className="clause-title" onClick={() => setOpen(open === c.id ? null : c.id)} aria-expanded={open === c.id}>
                      <span className="chev">{open === c.id ? "▾" : "▸"}</span>
                      {i + 1}. {c.title}
                    </button>
                    {state !== "standard" && <span className="badge badge-warn">{state === "added" ? t("Added") : t("Modified")}</span>}
                    <span className="clause-tools">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">
                        ↑
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => move(i, 1)} disabled={i === clauses.length - 1} aria-label="Move down">
                        ↓
                      </button>
                    </span>
                  </div>
                  {open === c.id && (
                    <div className="clause-body">
                      <label className="field">
                        <span>{t("Title")}</span>
                        <input value={c.title} onChange={(e) => patchClause(c.id, { title: e.target.value })} />
                      </label>
                      <label className="field">
                        <span>{t("Text")}</span>
                        <textarea rows={Math.min(24, Math.max(6, c.body.split("\n").length + 4))} value={c.body} onChange={(e) => patchClause(c.id, { body: e.target.value })} />
                      </label>
                      <div className="row">
                        {base && state === "modified" && (
                          <button type="button" className="btn btn-sm" onClick={() => patchClause(c.id, { title: base.title, body: base.body })}>
                            {t("Reset to standard")}
                          </button>
                        )}
                        <button type="button" className="btn btn-sm btn-danger" onClick={() => setClauses((cs) => cs.filter((x) => x.id !== c.id))}>
                          {t("Remove clause")}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            <div className="row" style={{ marginTop: 12 }}>
              <button type="button" className="btn btn-sm" onClick={addClause}>
                {t("+ Add clause")}
              </button>
              {removed.map((d) => (
                <button key={d.id} type="button" className="btn btn-sm" onClick={() => setClauses((cs) => [...cs, d])}>
                  {t("Restore “{title}”", { title: d.title })}
                </button>
              ))}
            </div>
          </section>
        </>
      )}

      {error && <p className="alert alert-warn">{error}</p>}
      <div className="actions">
        <Link href={dealId ? `/deals/${dealId}` : "/"} className="btn btn-ghost">
          {t("Cancel")}
        </Link>
        {!live && (
          <button type="button" className="btn" disabled={pending} onClick={() => submit(false)}>
            {t("Save draft")}
          </button>
        )}
        <button type="button" className="btn btn-primary" disabled={pending} onClick={() => submit(true)}>
          {pending ? t("Saving…") : live ? t("Save changes") : t("Save and create link")}
        </button>
      </div>
    </div>
  );
}

/** Month and year only, stored as "2026-11". Older agreements saved with a full date open on that month. */
function MonthPick({ value, onChange, t }: { value: string; onChange: (v: string) => void; t: (s: string) => string }) {
  const year = value.slice(0, 4);
  const month = value.slice(5, 7);
  const thisYear = new Date().getFullYear();
  const years = [...new Set([year, ...[-1, 0, 1, 2].map((n) => String(thisYear + n))])].filter(Boolean).sort();
  const pick = (y: string, m: string) => onChange(m ? `${y || thisYear}-${m}` : "");
  return (
    <span className="monthpick">
      <select aria-label={t("Month")} value={month} onChange={(e) => pick(year, e.target.value)}>
        <option value="">{t("Month")}</option>
        {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0")).map((m) => (
          <option key={m} value={m}>
            {Number(m)}
          </option>
        ))}
      </select>
      <select aria-label={t("Year")} value={year || String(thisYear)} onChange={(e) => pick(e.target.value, month)}>
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </span>
  );
}
