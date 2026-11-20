import Link from "next/link";
import { requireUser } from "@/lib/session";
import CopyLink from "@/components/CopyLink";
import Stepper from "@/components/Stepper";
import { STAGE_LABEL, daysSince, isDone, linkToken, listDeals, nextAction, stageOf, stepsDone, transferOverdue, waitingSince, type Stage, type Summary } from "@/lib/deals";
import { itemsOf, money } from "@/lib/template";
import { fmtDate } from "@/lib/i18n";
import { getT } from "@/lib/lang";
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
  const { t, lang } = await getT();
  const scope = sp.scope === "all" ? "all" : "mine";
  const todoOnly = sp.todo === "1";
  const [all, linkBase] = await Promise.all([listDeals(), origin()]);

  const scoped = all.filter((d) => scope === "all" || d.manager === user.name);
  const active = scoped.filter((d) => !isDone(d));
  const mine = (d: Summary) => nextAction(d, d.vp).owner === "you";
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
      <header className="hero">
        <div className="hero-top">
          <div>
            <p className="kicker">{t("d'Alba · creator partnerships")}</p>
            <h1>{t("Agreements")}</h1>
          </div>
          <Link href="/deals/new" className="btn btn-primary">
            {t("+ New agreement")}
          </Link>
        </div>
        <p className="hero-sub">{t("Every creator contract and invoice in one place: who has signed, what is waiting on us, and when each payment goes out.")}</p>
        <dl className="hero-stats">
          <div>
            <dt>{t("In progress")}</dt>
            <dd>{active.length}</dd>
          </div>
          <div>
            <dt>{t("Need you")}</dt>
            <dd>{todoCount}</dd>
          </div>
          <div>
            <dt>{t("Completed")}</dt>
            <dd>{scoped.filter(isDone).length}</dd>
          </div>
          <div>
            <dt>{t("Creators")}</dt>
            <dd>{new Set(scoped.map((d) => d.fields.handle.toLowerCase())).size}</dd>
          </div>
        </dl>
      </header>

      <div className="toolbar">
        <div className="seg" role="group" aria-label="Scope">
          <Link href={href({ scope: "mine" })} className={scope === "mine" ? "seg-item active" : "seg-item"}>
            {t("My deals")}
          </Link>
          <Link href={href({ scope: "all" })} className={scope === "all" ? "seg-item active" : "seg-item"}>
            {t("All managers")}
          </Link>
        </div>
        <form className="search" action="/">
          {scope === "all" && <input type="hidden" name="scope" value="all" />}
          {sp.bucket && <input type="hidden" name="bucket" value={sp.bucket} />}
          {todoOnly && <input type="hidden" name="todo" value="1" />}
          <input name="q" defaultValue={sp.q || ""} placeholder={t("Search creator, product, manager")} aria-label="Search" />
          <select name="country" defaultValue={sp.country || ""} aria-label="Country">
            <option value="">{t("All countries")}</option>
            {countries.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <button className="btn btn-sm">{t("Filter")}</button>
        </form>
      </div>

      <Link href={href({ todo: todoOnly ? undefined : "1" })} className={`todo-banner${todoOnly ? " active" : ""}${todoCount ? "" : " clear"}`}>
        <span className="todo-n">{todoCount}</span>
        <span>
          <strong>{t(todoCount === 1 ? "deal needs your action" : "deals need your action")}</strong>
          <span className="muted"> · {t("{n} waiting on the creator or finance", { n: active.length - todoCount })}</span>
        </span>
        <span className="todo-toggle">{todoOnly ? t("Show all") : t("Show only these")}</span>
      </Link>

      <div className="pipeline">
        {BUCKETS.map((b) => {
          const inStage = scoped.filter((d) => b.stages.includes(stageOf(d)));
          const need = inStage.filter(mine).length;
          const on = sp.bucket === b.key;
          return (
            <Link key={b.key} href={href({ bucket: on ? undefined : b.key })} className={on ? "bucket active" : "bucket"}>
              <span className="bucket-step">{t("Step {n}", { n: b.n })}</span>
              <span className="bucket-n">{inStage.length}</span>
              <span className="bucket-label">{t(b.label)}</span>
              <span className="bucket-hint">{need > 0 ? <span className="need">{t("{n} need you", { n: need })}</span> : t(b.hint)}</span>
            </Link>
          );
        })}
      </div>
      <p className="subfilters">
        <Link href={href({ bucket: undefined })} className={!sp.bucket ? "active" : ""}>
          {t("In progress ({n})", { n: active.length })}
        </Link>
        <Link href={href({ bucket: "draft" })} className={sp.bucket === "draft" ? "active" : ""}>
          {t("Drafts ({n})", { n: scoped.filter((d) => stageOf(d) === "draft").length })}
        </Link>
        <Link href={href({ bucket: "done" })} className={sp.bucket === "done" ? "active" : ""}>
          {t("Completed ({n})", { n: scoped.filter(isDone).length })}
        </Link>
      </p>

      {rows.length === 0 ? (
        <div className="card empty">
          <p>{all.length === 0 ? t("No agreements yet.") : t("Nothing in this view.")}</p>
          {all.length === 0 && (
            <Link href="/deals/new" className="btn btn-primary">
              {t("Create the first agreement")}
            </Link>
          )}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t("Creator")}</th>
                <th>{t("Contract")}</th>
                <th>{t("Progress")}</th>
                <th>{t("Next step")}</th>
                <th>{t("Waiting")}</th>
                {scope === "all" && <th>{t("Manager")}</th>}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => {
                const stage = stageOf(d);
                const next = nextAction(d, d.vp);
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
                          {t("{n} contracts", { n: contracts })}
                        </Link>
                      )}
                    </td>
                    <td>
                      <div className="nowrap">
                        {fmtDate(lang, d.fields.startDate) || "—"} → {fmtDate(lang, d.fields.endDate) || "—"}
                      </div>
                      <ul className="plist">
                        {itemsOf(d.fields).map((it, n) => (
                          <li key={n}>
                            <span className="pcount">{it.count}</span> <span className="pname">{it.product || "—"}</span>
                          </li>
                        ))}
                      </ul>
                      {d.custom > 0 && <span className="badge badge-warn" style={{ marginLeft: 0 }}>{t("Custom terms")}</span>}
                    </td>
                    <td>
                      {plain ? <span className="pill pill-neutral">{t(STAGE_LABEL[stage])}</span> : <Stepper done={stepsDone(d)} t={t} />}
                      {!plain && <div className="small stage-label">{t(STAGE_LABEL[stage])}</div>}
                      {d.signed_at && !d.cancelled_at && d.vp.total > 0 && (
                        <div className="small muted nowrap">
                          {t("Videos {a}/{b}", { a: d.vp.done, b: d.vp.total })}
                          {d.vp.total - d.vp.done > 0 ? ` · ${t("{n} left", { n: d.vp.total - d.vp.done })}` : ""}
                        </div>
                      )}
                    </td>
                    <td>
                      {next.owner !== "none" && (
                        <>
                          <span className={`who who-${next.owner}`}>{t(OWNER_LABEL[next.owner])}</span>
                          <span className="small"> {t(next.text, next.vars)}</span>
                        </>
                      )}
                      {stage === "payout" && d.payment_expected && (
                        <div className={transferOverdue(d) ? "small late" : "small muted"}>{t("Expected {date}", { date: fmtDate(lang, d.payment_expected) })}</div>
                      )}
                    </td>
                    <td className={!done && stage !== "draft" && days >= 5 ? "late nowrap" : "nowrap"}>{done || stage === "draft" ? <span className="muted">—</span> : days === 0 ? t("today") : t("{n}d", { n: days })}</td>
                    {scope === "all" && <td className="small">{d.manager}</td>}
                    <td className="right nowrap">
                      {stage === "sign" && <CopyLink compact url={`${linkBase}/c/${linkToken(d)}`} />}{" "}
                      <Link href={`/deals/${d.id}`} className={next.owner === "you" ? "btn btn-sm btn-primary" : "btn btn-sm"}>
                        {t("Open")}
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
