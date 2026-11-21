import { diffWords } from "@/lib/diff";
import type { T } from "@/lib/i18n";
import { clauseState, defaultClauses, type Clause, type Kind } from "@/lib/template";

/** Shows, clause by clause, what differs from the standard template: removed words struck through, added words highlighted. */
export default function ClauseChanges({ clauses, kind, t }: { clauses: Clause[]; kind?: Kind; t: T }) {
  const standard = defaultClauses(kind);
  const changed = clauses.filter((c) => clauseState(c) !== "standard");
  const removed = standard.filter((d) => !clauses.some((c) => c.id === d.id));
  if (!changed.length && !removed.length) return null;
  return (
    <details className="changes-box">
      <summary>{t("Show what was changed")}</summary>
      <p className="small muted changes-legend">
        <span className="diff-del">{t("removed text")}</span> <span className="diff-add">{t("added text")}</span>
      </p>
      {changed.map((c) => {
        const base = standard.find((d) => d.id === c.id);
        const index = clauses.findIndex((x) => x.id === c.id) + 1;
        return (
          <section key={c.id} className="change">
            <h3>
              {index}. {c.title} <span className="badge badge-warn">{base ? t("Modified") : t("Added")}</span>
            </h3>
            {base && base.title !== c.title && (
              <p className="small">
                {t("Title")}: <span className="diff-del">{base.title}</span> <span className="diff-add">{c.title}</span>
              </p>
            )}
            <div className="diff">
              {(base ? diffWords(base.body, c.body) : [{ type: "add" as const, text: c.body }]).map((p, i) =>
                p.type === "same" ? <span key={i}>{p.text} </span> : <span key={i} className={p.type === "add" ? "diff-add" : "diff-del"}>{p.text}</span>,
              )}
            </div>
          </section>
        );
      })}
      {removed.map((d) => (
        <section key={d.id} className="change">
          <h3>
            {d.title} <span className="badge badge-warn">{t("Removed")}</span>
          </h3>
          <div className="diff">
            <span className="diff-del">{d.body}</span>
          </div>
        </section>
      ))}
    </details>
  );
}
