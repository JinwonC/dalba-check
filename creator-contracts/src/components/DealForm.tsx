"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { saveDeal } from "@/app/(app)/deals/actions";
import { ContractDoc } from "@/components/Document";
import { COUNTRIES, DEFAULT_CLAUSES, PLACEHOLDERS, clauseState, type Clause, type Fields } from "@/lib/template";

type Props = { dealId: string | null; initialFields: Fields; initialClauses: Clause[]; live: boolean };

export default function DealForm({ dealId, initialFields, initialClauses, live }: Props) {
  const [f, setF] = useState<Fields>(initialFields);
  const [clauses, setClauses] = useState<Clause[]>(initialClauses);
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
    setClauses((cs) => [...cs, { id, title: "New clause", body: "" }]);
    setOpen(id);
  };
  const removed = DEFAULT_CLAUSES.filter((d) => !clauses.some((c) => c.id === d.id));

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
          Edit
        </button>
        <button type="button" className={tab === "preview" ? "tab active" : "tab"} onClick={() => setTab("preview")}>
          Preview as creator
        </button>
      </div>

      {tab === "preview" ? (
        <div className="paper-wrap">
          <ContractDoc fields={{ ...f, talentName: f.talentName || f.handle }} clauses={clauses.filter((c) => c.body.trim())} />
        </div>
      ) : (
        <>
          <section className="card">
            <h2>Creator</h2>
            <div className="grid">
              <label className="field">
                <span>TikTok handle *</span>
                <input {...text("handle")} placeholder="rache__empire" autoComplete="off" />
              </label>
              <label className="field">
                <span>Talent / Agency name</span>
                <input {...text("talentName")} placeholder="Defaults to the handle" />
              </label>
              <label className="field">
                <span>Creator email (optional)</span>
                <input {...text("creatorEmail")} type="email" />
              </label>
              <label className="field">
                <span>Country</span>
                <select {...text("country")}>
                  {COUNTRIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          <section className="card">
            <h2>Deal terms</h2>
            <div className="grid">
              <label className="field span-2">
                <span>Product *</span>
                <input {...text("product")} placeholder="White Truffle First Spray Serum Holiday Gift Set (3+2+1)" />
              </label>
              <label className="field">
                <span>Effective date *</span>
                <input {...text("effectiveDate")} type="date" />
              </label>
              <label className="field">
                <span>Paid usage (days)</span>
                <input {...number("paidUsageDays")} />
              </label>
              <label className="field">
                <span>Content goes live from *</span>
                <input {...text("startDate")} type="date" />
              </label>
              <label className="field">
                <span>Content completed by *</span>
                <input {...text("endDate")} type="date" />
              </label>
              <label className="field">
                <span>Number of deliverables *</span>
                <input {...number("deliverableCount")} />
              </label>
              <label className="field">
                <span>Deliverable type</span>
                <input {...text("deliverableType")} />
              </label>
            </div>
          </section>

          <section className="card">
            <h2>Fee and invoice</h2>
            <div className="grid">
              <label className="field">
                <span>Fixed fee *</span>
                <input {...number("fee")} step="0.01" placeholder="300" />
              </label>
              <label className="field">
                <span>Currency</span>
                <select {...text("currency")}>
                  <option>USD</option>
                  <option>GBP</option>
                  <option>EUR</option>
                </select>
              </label>
              <label className="field">
                <span>Commission % (0 for none)</span>
                <input {...number("commissionPct")} step="0.1" />
              </label>
              <label className="field">
                <span>Invoice line description</span>
                <input {...text("invoiceDescription")} />
              </label>
            </div>
            <p className="hint">The invoice is generated from these values and the bank details the creator enters when signing.</p>
          </section>

          <section className="card">
            <h2>Clauses</h2>
            <p className="hint">
              Edits apply to this creator only. Placeholders are filled from the fields above:{" "}
              {PLACEHOLDERS.map((p) => (
                <code key={p}>{`{{${p}}}`}</code>
              ))}
              . Start a line with <code>## </code> for a sub-heading or <code>- </code> for a bullet.
            </p>
            {clauses.map((c, i) => {
              const state = clauseState(c);
              const base = DEFAULT_CLAUSES.find((d) => d.id === c.id);
              return (
                <div key={c.id} className="clause">
                  <div className="clause-head">
                    <button type="button" className="clause-title" onClick={() => setOpen(open === c.id ? null : c.id)} aria-expanded={open === c.id}>
                      <span className="chev">{open === c.id ? "▾" : "▸"}</span>
                      {i + 1}. {c.title}
                    </button>
                    {state !== "standard" && <span className="badge badge-warn">{state === "added" ? "Added" : "Modified"}</span>}
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
                        <span>Title</span>
                        <input value={c.title} onChange={(e) => patchClause(c.id, { title: e.target.value })} />
                      </label>
                      <label className="field">
                        <span>Text</span>
                        <textarea rows={Math.min(24, Math.max(6, c.body.split("\n").length + 4))} value={c.body} onChange={(e) => patchClause(c.id, { body: e.target.value })} />
                      </label>
                      <div className="row">
                        {base && state === "modified" && (
                          <button type="button" className="btn btn-sm" onClick={() => patchClause(c.id, { title: base.title, body: base.body })}>
                            Reset to standard
                          </button>
                        )}
                        <button type="button" className="btn btn-sm btn-danger" onClick={() => setClauses((cs) => cs.filter((x) => x.id !== c.id))}>
                          Remove clause
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            <div className="row" style={{ marginTop: 12 }}>
              <button type="button" className="btn btn-sm" onClick={addClause}>
                + Add clause
              </button>
              {removed.map((d) => (
                <button key={d.id} type="button" className="btn btn-sm" onClick={() => setClauses((cs) => [...cs, d])}>
                  Restore “{d.title}”
                </button>
              ))}
            </div>
          </section>
        </>
      )}

      {error && <p className="alert alert-warn">{error}</p>}
      <div className="actions">
        <Link href={dealId ? `/deals/${dealId}` : "/"} className="btn btn-ghost">
          Cancel
        </Link>
        {!live && (
          <button type="button" className="btn" disabled={pending} onClick={() => submit(false)}>
            Save draft
          </button>
        )}
        <button type="button" className="btn btn-primary" disabled={pending} onClick={() => submit(true)}>
          {pending ? "Saving…" : live ? "Save changes" : "Save and create link"}
        </button>
      </div>
    </div>
  );
}
