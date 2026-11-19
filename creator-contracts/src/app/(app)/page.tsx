import Link from "next/link";
import { requireUser } from "@/lib/session";
import CopyLink from "@/components/CopyLink";
import {
  CONTRACT_LABEL,
  INVOICE_LABEL,
  contractStatus,
  daysSince,
  invoiceStatus,
  isDone,
  linkToken,
  listDeals,
  waitingSince,
  type ContractStatus,
  type InvoiceStatus,
  type Summary,
} from "@/lib/deals";
import { money } from "@/lib/template";
import { origin } from "@/lib/url";

export const dynamic = "force-dynamic";

// Dashboard buckets: each answers "what are we waiting on?".
const BUCKETS: { key: string; label: string; hint: string; match: (d: Summary) => boolean }[] = [
  { key: "signature", label: "Awaiting signature", hint: "Creator has the link", match: (d) => ["sent", "viewed"].includes(contractStatus(d)) },
  { key: "changes", label: "Changes requested", hint: "Creator asked for edits", match: (d) => contractStatus(d) === "changes" },
  { key: "stamp", label: "Company stamp", hint: "Signed, needs our seal", match: (d) => ["stamp_needed", "stamp_requested"].includes(contractStatus(d)) },
  { key: "content", label: "Content in progress", hint: "Invoice not issued yet", match: (d) => !d.cancelled_at && invoiceStatus(d) === "prepared" },
  { key: "payment", label: "Awaiting payment", hint: "Invoice issued", match: (d) => !d.cancelled_at && invoiceStatus(d) === "issued" },
];

const CONTRACT_TONE: Record<ContractStatus, string> = {
  draft: "neutral",
  sent: "wait",
  viewed: "wait",
  changes: "warn",
  stamp_needed: "warn",
  stamp_requested: "wait",
  executed: "ok",
  cancelled: "neutral",
};
const INVOICE_TONE: Record<InvoiceStatus, string> = { none: "neutral", prepared: "wait", issued: "warn", paid: "ok" };

type Search = { scope?: string; bucket?: string; q?: string; country?: string };

export default async function Dashboard({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const scope = sp.scope === "all" ? "all" : "mine";
  const all = await listDeals();
  const base = origin();

  const scoped = all.filter((d) => scope === "all" || d.manager === user.name);
  const term = (sp.q || "").trim().toLowerCase();
  const rows = scoped.filter((d) => {
    if (sp.bucket) {
      if (sp.bucket === "done") {
        if (!isDone(d)) return false;
      } else if (sp.bucket === "draft") {
        if (contractStatus(d) !== "draft") return false;
      } else if (!BUCKETS.find((b) => b.key === sp.bucket)?.match(d)) return false;
    }
    if (sp.country && d.fields.country !== sp.country) return false;
    if (term) {
      const hay = `${d.fields.handle} ${d.fields.talentName} ${d.fields.product} ${d.manager}`.toLowerCase();
      if (!hay.includes(term)) return false;
    }
    return true;
  });

  const href = (patch: Partial<Search>) => {
    const next = { scope, bucket: sp.bucket, q: sp.q, country: sp.country, ...patch };
    const qs = Object.entries(next)
      .filter(([k, v]) => v && !(k === "scope" && v === "mine"))
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join("&");
    return qs ? `/?${qs}` : "/";
  };
  const countries = [...new Set(scoped.map((d) => d.fields.country).filter(Boolean))].sort();
  const linkBase = await base;

  return (
    <>
      <div className="page-head">
        <h1>Agreements</h1>
        <Link href="/deals/new" className="btn btn-primary">
          + New agreement
        </Link>
      </div>

      <div className="toolbar">
        <div className="seg" role="group" aria-label="Scope">
          <Link href={href({ scope: "mine" })} className={scope === "mine" ? "seg-item active" : "seg-item"}>
            My deals
          </Link>
          <Link href={href({ scope: "all" })} className={scope === "all" ? "seg-item active" : "seg-item"}>
            All managers
          </Link>
        </div>
        <form className="search" action="/">
          {scope === "all" && <input type="hidden" name="scope" value="all" />}
          {sp.bucket && <input type="hidden" name="bucket" value={sp.bucket} />}
          <input name="q" defaultValue={sp.q || ""} placeholder="Search creator, product, manager" aria-label="Search" />
          <select name="country" defaultValue={sp.country || ""} aria-label="Country">
            <option value="">All countries</option>
            {countries.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <button className="btn btn-sm">Filter</button>
        </form>
      </div>

      <div className="buckets">
        {BUCKETS.map((b) => {
          const n = scoped.filter(b.match).length;
          const active = sp.bucket === b.key;
          return (
            <Link key={b.key} href={href({ bucket: active ? undefined : b.key })} className={active ? "bucket active" : "bucket"}>
              <span className="bucket-n">{n}</span>
              <span className="bucket-label">{b.label}</span>
              <span className="bucket-hint">{b.hint}</span>
            </Link>
          );
        })}
      </div>
      <p className="subfilters">
        <Link href={href({ bucket: undefined })} className={!sp.bucket ? "active" : ""}>
          All ({scoped.length})
        </Link>
        <Link href={href({ bucket: "draft" })} className={sp.bucket === "draft" ? "active" : ""}>
          Drafts ({scoped.filter((d) => contractStatus(d) === "draft").length})
        </Link>
        <Link href={href({ bucket: "done" })} className={sp.bucket === "done" ? "active" : ""}>
          Completed ({scoped.filter(isDone).length})
        </Link>
      </p>

      {rows.length === 0 ? (
        <div className="card empty">
          <p>{all.length === 0 ? "No agreements yet." : "Nothing matches this view."}</p>
          {all.length === 0 && (
            <Link href="/deals/new" className="btn btn-primary">
              Create the first agreement
            </Link>
          )}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Creator</th>
                <th>Deal</th>
                <th>Contract</th>
                <th>Invoice</th>
                <th>Waiting</th>
                {scope === "all" && <th>Manager</th>}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => {
                const c = contractStatus(d);
                const i = invoiceStatus(d);
                const idle = isDone(d) || c === "draft";
                const days = daysSince(waitingSince(d));
                const custom = d.custom;
                return (
                  <tr key={d.id}>
                    <td>
                      <Link href={`/deals/${d.id}`} className="strong">
                        @{d.fields.handle}
                      </Link>
                      <div className="muted small">{d.fields.country}</div>
                    </td>
                    <td>
                      <div>
                        {money(d.fields.fee, d.fields.currency)}
                        {d.fields.commissionPct > 0 && ` + ${d.fields.commissionPct}%`} · {d.fields.deliverableCount} videos
                      </div>
                      <div className="muted small clip">
                        {d.fields.product}
                        {custom > 0 && <span className="badge badge-warn">Custom terms</span>}
                      </div>
                    </td>
                    <td>
                      <span className={`pill pill-${CONTRACT_TONE[c]}`}>{CONTRACT_LABEL[c]}</span>
                    </td>
                    <td>{i === "none" || d.cancelled_at ? <span className="muted">—</span> : <span className={`pill pill-${INVOICE_TONE[i]}`}>{INVOICE_LABEL[i]}</span>}</td>
                    <td className={!idle && days >= 5 ? "late" : ""}>{idle ? <span className="muted">—</span> : days === 0 ? "today" : `${days}d`}</td>
                    {scope === "all" && <td className="small">{d.manager}</td>}
                    <td className="right nowrap">
                      {["sent", "viewed"].includes(c) && <CopyLink compact url={`${linkBase}/c/${linkToken(d)}`} />}{" "}
                      <Link href={`/deals/${d.id}`} className="btn btn-sm">
                        Open
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
