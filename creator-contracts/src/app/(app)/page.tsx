import Link from "next/link";
import { requireUser } from "@/lib/session";
import CopyLink from "@/components/CopyLink";
import Stepper from "@/components/Stepper";
import { STAGE_LABEL, daysSince, isDone, linkToken, listDeals, nextAction, stageOf, stepsDone, transferOverdue, waitingSince, type Stage, type Summary } from "@/lib/deals";
import { itemsOf, longDate, medDate, money } from "@/lib/template";
import { origin } from "@/lib/url";

export const dynamic = "force-dynamic";

// The five stages of the process, in order. Each card answers "how many creators are here?".
const BUCKETS: { key: string; n: number; label: string; hint: string; stages: Stage[] }[] = [
  { key: "sign", n: 1, label: "Creator signs", hint: "Agreement + invoice", stages: ["sign", "changes"] },
  { key: "stamp", n: 2, label: "Approval and stamp", hint: "Our internal sign-off", stages: ["stamp"] },
  { key: "content", n: 3, label: "Content", hint: "Creator delivers", stages: ["content"] },
  { key: "transfer", n: 4, label: "Request transfer", hint: "Content done, not requested", stages: ["transfer"] },
  { key: "payout", n: 5, label: "Transfer pending", hint: "Requested, not yet paid", stages: ["payout"] },
];

const OWNER_LABEL = { you: "You", creator: "Creator", finance: "Finance", none: "" } as const;

type Search = { scope?: string; bucket?: string; q?: string; country?: string; todo?: string };

export default async function Dashboard({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const scope = sp.scope === "all" ? "all" : "mine";
  const todoOnly = sp.todo === "1";
  const [all, linkBase] = await Promise.all([listDeals(), origin()]);

  const scoped = all.filter((d) => scope === "all" || d.manager === user.name);
  const active = scoped.filter((d) => !isDone(d));
  const mine = (d: Summary) => nextAction(d, d.vc).owner === "you";
  const perCreator = new Map<string, number>();
  for (const d of all) perCreator.set(d.fields.handle.toLowerCase(), (perCreator.get(d.fields.handle.toLowerCase()) ?? 0) + 1);
  const term = (sp.q || "").trim().toLowerCase();

  const rows = scoped
    .filter((d) => {
      const stage = stageOf(d);
      if (sp.bucket === "done") {
        if (!isDone(d)) return false;
      } else if (sp.bucket === "draft") {
        if (stage !== "draft") return false;
      } else if (sp.bucket) {
        if (!BUCKETS.find((b) => b.key === sp.bucket)?.stages.includes(stage)) return false;
      } else if (isDone(d)) return false; // default view: everything still in progress
      if (todoOnly && !mine(d)) return false;
      if (sp.country && d.fields.country !== sp.country) return false;
      if (term && !`${d.fields.handle} ${d.fields.talentName} ${d.fields.product} ${d.manager}`.toLowerCase().includes(term)) return false;
      return true;
    })
    // Things you must do first, then whatever has been waiting longest.
    .sort((a, b) => Number(mine(b)) - Number(mine(a)) || waitingSince(a).localeCompare(waitingSince(b)));

  const href = (patch: Partial<Search>) => {
    const next = { scope, bucket: sp.bucket, q: sp.q, country: sp.country, todo: sp.todo, ...patch };
    const qs = Object.entries(next)
      .filter(([k, v]) => v && !(k === "scope" && v === "mine"))
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join("&");
    return qs ? `/?${qs}` : "/";
  };
  const countries = [...new Set(scoped.map((d) => d.fields.country).filter(Boolean))].sort();
  const todoCount = active.filter(mine).length;

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
          {todoOnly && <input type="hidden" name="todo" value="1" />}
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

      <Link href={href({ todo: todoOnly ? undefined : "1" })} className={`todo-banner${todoOnly ? " active" : ""}${todoCount ? "" : " clear"}`}>
        <span className="todo-n">{todoCount}</span>
        <span>
          <strong>{todoCount === 1 ? "deal needs" : "deals need"} your action</strong>
          <span className="muted"> · {active.length - todoCount} waiting on the creator or finance</span>
        </span>
        <span className="todo-toggle">{todoOnly ? "Show all" : "Show only these"}</span>
      </Link>

      <div className="pipeline">
        {BUCKETS.map((b) => {
          const inStage = scoped.filter((d) => b.stages.includes(stageOf(d)));
          const need = inStage.filter(mine).length;
          const on = sp.bucket === b.key;
          return (
            <Link key={b.key} href={href({ bucket: on ? undefined : b.key })} className={on ? "bucket active" : "bucket"}>
              <span className="bucket-step">Step {b.n}</span>
              <span className="bucket-n">{inStage.length}</span>
              <span className="bucket-label">{b.label}</span>
              <span className="bucket-hint">{need > 0 ? <span className="need">{need} need you</span> : b.hint}</span>
            </Link>
          );
        })}
      </div>
      <p className="subfilters">
        <Link href={href({ bucket: undefined })} className={!sp.bucket ? "active" : ""}>
          In progress ({active.length})
        </Link>
        <Link href={href({ bucket: "draft" })} className={sp.bucket === "draft" ? "active" : ""}>
          Drafts ({scoped.filter((d) => stageOf(d) === "draft").length})
        </Link>
        <Link href={href({ bucket: "done" })} className={sp.bucket === "done" ? "active" : ""}>
          Completed ({scoped.filter(isDone).length})
        </Link>
      </p>

      {rows.length === 0 ? (
        <div className="card empty">
          <p>{all.length === 0 ? "No agreements yet." : "Nothing in this view."}</p>
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
                <th>Contract</th>
                <th>Progress</th>
                <th>Next step</th>
                <th>Waiting</th>
                {scope === "all" && <th>Manager</th>}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => {
                const stage = stageOf(d);
                const next = nextAction(d, d.vc);
                const contracts = perCreator.get(d.fields.handle.toLowerCase()) ?? 1;
                const done = isDone(d);
                const days = daysSince(waitingSince(d));
                const plain = stage === "cancelled" || stage === "draft";
                return (
                  <tr key={d.id} className={next.owner === "you" ? "row-todo" : ""}>
                    <td>
                      <Link href={`/deals/${d.id}`} className="strong">
                        @{d.fields.handle}
                      </Link>
                      <div className="muted small">
                        {money(d.fields.fee, d.fields.currency)}
                        {d.fields.commissionPct > 0 && ` + ${d.fields.commissionPct}%`} · {d.fields.country}
                      </div>
                      {contracts > 1 && (
                        <Link href={href({ q: d.fields.handle, bucket: undefined, todo: undefined, scope: "all" })} className="small linkish">
                          {contracts} contracts
                        </Link>
                      )}
                    </td>
                    <td>
                      <div className="nowrap">
                        {medDate(d.fields.startDate) || "—"} → {medDate(d.fields.endDate) || "—"}
                      </div>
                      <ul className="plist">
                        {itemsOf(d.fields).map((it, n) => (
                          <li key={n}>
                            <span className="pcount">{it.count}</span> <span className="pname">{it.product || "—"}</span>
                          </li>
                        ))}
                      </ul>
                      {d.custom > 0 && <span className="badge badge-warn" style={{ marginLeft: 0 }}>Custom terms</span>}
                    </td>
                    <td>
                      {plain ? <span className="pill pill-neutral">{STAGE_LABEL[stage]}</span> : <Stepper done={stepsDone(d)} />}
                      {!plain && <div className="small stage-label">{STAGE_LABEL[stage]}</div>}
                      {d.signed_at && !d.cancelled_at && (
                        <div className="small muted">
                          Videos {d.vc.posted}/{d.vc.total}
                          {d.vc.review > 0 && <span className="need"> · {d.vc.review} to review</span>}
                        </div>
                      )}
                    </td>
                    <td>
                      {next.owner !== "none" && (
                        <>
                          <span className={`who who-${next.owner}`}>{OWNER_LABEL[next.owner]}</span>
                          <span className="small"> {next.text}</span>
                        </>
                      )}
                      {stage === "payout" && d.payment_expected && (
                        <div className={transferOverdue(d) ? "small late" : "small muted"}>Expected {longDate(d.payment_expected)}</div>
                      )}
                    </td>
                    <td className={!done && stage !== "draft" && days >= 5 ? "late" : ""}>{done || stage === "draft" ? <span className="muted">—</span> : days === 0 ? "today" : `${days}d`}</td>
                    {scope === "all" && <td className="small">{d.manager}</td>}
                    <td className="right nowrap">
                      {stage === "sign" && <CopyLink compact url={`${linkBase}/c/${linkToken(d)}`} />}{" "}
                      <Link href={`/deals/${d.id}`} className={next.owner === "you" ? "btn btn-sm btn-primary" : "btn btn-sm"}>
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
