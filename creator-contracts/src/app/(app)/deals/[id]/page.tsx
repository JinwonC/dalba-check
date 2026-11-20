import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import ConfirmButton from "@/components/ConfirmButton";
import CopyLink from "@/components/CopyLink";
import StampUpload from "@/components/StampUpload";
import { ContractDoc, InvoiceDoc } from "@/components/Document";
import Stepper from "@/components/Stepper";
import { STAGE_LABEL, billingOf, getDeal, linkToken, nextAction, stageOf, stepsDone, transferOverdue } from "@/lib/deals";
import { clauseState, DEFAULT_CLAUSES, itemsOf, money } from "@/lib/template";
import { fmtDate, fmtWhen, type Lang, type T } from "@/lib/i18n";
import { getT } from "@/lib/lang";
import { origin } from "@/lib/url";
import PaymentRequest from "@/components/PaymentRequest";
import { cancelDeal, clearPaymentRequest, markContentDone, markPaid, markStamped, reassignToMe, undoContentDone, undoStamped } from "../actions";

export const dynamic = "force-dynamic";

const EVENT_LABEL: Record<string, string> = {
  created: "Agreement created",
  edited: "Draft edited",
  link_created: "Creator link created",
  revised: "Agreement revised (link updated)",
  viewed: "Creator opened the link",
  changes_requested: "Creator requested changes",
  signed: "Creator signed",
  stamp_requested: "Company stamp requested",
  stamped: "Company stamp received",
  stamped_undone: "Company stamp step undone",
  stamped_uploaded: "Stamped PDF uploaded",
  invoice_issued: "Invoice issued",
  content_done: "Content confirmed complete",
  content_done_undone: "Content confirmation undone",
  payment_requested: "Transfer requested",
  payment_date_changed: "Expected transfer date changed",
  payment_request_cleared: "Transfer request undone",
  paid: "Marked as paid",
  cancelled: "Cancelled",
  reassigned: "Manager changed",
};

function Step({ done, current, title, at, note, lang, children }: { done: boolean; current: boolean; title: string; at?: string | null; note?: string; lang: Lang; children?: React.ReactNode }) {
  return (
    <li className={done ? "step done" : current ? "step current" : "step"}>
      <span className="step-dot" aria-hidden>
        {done ? "✓" : ""}
      </span>
      <div className="step-main">
        <div className="step-title">
          {title}
          {done && at && <span className="muted small"> · {fmtWhen(lang, at)}</span>}
          {done && note && <span className="muted small"> · {note}</span>}
        </div>
        {current && children && <div className="step-body">{children}</div>}
      </div>
    </li>
  );
}

export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { t, lang }: { t: T; lang: Lang } = await getT();
  const when = (d: string | null | undefined) => fmtWhen(lang, d);
  const longDate = (d: string | null | undefined) => fmtDate(lang, d);
  const medDate = longDate;
  const deal = await getDeal(id);
  if (!deal) notFound();
  const base = await origin();
  const events = [...deal.events].reverse();
  const f = deal.fields;
  const stage = stageOf(deal);
  const next = nextAction(deal);
  const overdue = transferOverdue(deal);
  const billing = billingOf(deal);
  const link = `${base}/c/${linkToken(deal)}`;
  const cancelled = !!deal.cancelled_at;
  const signed = !!deal.signed_at;
  const custom = deal.clauses.filter((x) => clauseState(x) !== "standard");
  const removed = DEFAULT_CLAUSES.filter((d) => !deal.clauses.some((x) => x.id === d.id));

  return (
    <>
      <p className="crumbs">
        <Link href="/">{t("← Agreements")}</Link>
      </p>
      <div className="page-head">
        <div>
          <h1>@{f.handle}</h1>
          <p className="muted">
            {money(f.fee, f.currency)}
            {f.commissionPct > 0 && ` + ${f.commissionPct}% ${t("commission")}`} · {t("{a} to {b}", { a: medDate(f.startDate), b: medDate(f.endDate) })} · {f.country} · {t("Manager")}: {deal.manager}
            {deal.manager !== user.name && !cancelled && (
              <>
                {" "}
                <ConfirmButton action={reassignToMe.bind(null, id)} className="linkish" confirm={t("Make yourself the manager of this deal?")}>
                  {t("take over")}
                </ConfirmButton>
              </>
            )}
          </p>
        </div>
        <div className="row">
          <span className="pill pill-neutral">{t(STAGE_LABEL[stage])}</span>
        </div>
      </div>

      {(custom.length > 0 || removed.length > 0) && (
        <div className="alert alert-info">
          <strong>{t("Custom terms.")}</strong>{" "}
          {custom.length > 0 && <>{t("Changed or added: {list}.", { list: custom.map((x) => x.title).join(", ") })} </>}
          {removed.length > 0 && <>{t("Removed: {list}.", { list: removed.map((x) => x.title).join(", ") })}</>}
        </div>
      )}

      {cancelled ? (
        <div className="alert alert-warn">{t("This deal was cancelled on {date}. The creator link no longer works.", { date: when(deal.cancelled_at) })}</div>
      ) : (
        <section className="card">
          <h2>{t("Progress")}</h2>
          {stage !== "draft" && <Stepper done={stepsDone(deal)} labels t={t} />}
          {next.owner !== "none" && (
            <p className={next.owner === "you" ? "nextup nextup-you" : "nextup"}>
              <strong>{t(next.owner === "you" ? "Your next step:" : next.owner === "creator" ? "Waiting on the creator:" : "Waiting on finance:")}</strong> {t(next.text)}
            </p>
          )}
          <ol className="steps">
            <Step lang={lang} done={!!deal.sent_at} current={!deal.sent_at} title={t("Create the creator link")} at={deal.sent_at}>
              <p>{t("This is still a draft. Finish the terms, then create the link.")}</p>
              <Link href={`/deals/${id}/edit`} className="btn btn-primary">
                {t("Continue editing")}
              </Link>
            </Step>

            <Step lang={lang} done={signed} current={!!deal.sent_at && !signed} title={t("1. Creator signs the agreement and invoice")} at={deal.signed_at}>
              {deal.change_request ? (
                <div className="alert alert-warn">
                  <strong>{t("Changes requested")} · {when(deal.change_requested_at)}</strong>
                  <p className="pre">{deal.change_request}</p>
                  <Link href={`/deals/${id}/edit`} className="btn btn-primary btn-sm">
                    {t("Revise agreement")}
                  </Link>
                </div>
              ) : (
                <p>{deal.viewed_at ? t("Opened {date}, not signed yet.", { date: when(deal.viewed_at) }) : t("Not opened yet. Send this link to the creator.")}</p>
              )}
              <CopyLink url={link} />
              <div className="row">
                <Link href={`/deals/${id}/edit`} className="btn btn-sm">
                  {t("Edit terms")}
                </Link>
                <ConfirmButton action={cancelDeal.bind(null, id)} className="btn btn-sm btn-danger" confirm={t("Cancel this deal? The creator link will stop working.")}>
                  {t("Cancel deal")}
                </ConfirmButton>
              </div>
            </Step>

            <Step lang={lang} done={!!deal.executed_at} current={stage === "stamp"} title={t("2. Internal approval and company stamp")} at={deal.executed_at}>
              <p>{t("Download the signed PDF, get it approved and stamped internally, then mark it here.")}</p>
              <div className="row">
                <ConfirmButton action={markStamped.bind(null, id)} className="btn btn-primary">
                  {t("Company stamp received")}
                </ConfirmButton>
                <a href={`/api/deals/${id}/pdf`} className="btn">
                  {t("Download signed PDF")}
                </a>
              </div>
            </Step>

            <Step lang={lang} done={!!deal.content_done_at} current={stage === "content"} title={t("3. Creator delivers the content")} at={deal.content_done_at}>
              <p>
                {t("When all {n} videos are posted and the creator has met the agreement, confirm it here.", { n: f.deliverableCount })}
              </p>
              <div className="row">
                <ConfirmButton action={markContentDone.bind(null, id)} className="btn btn-primary">
                  {t("Content complete")}
                </ConfirmButton>
                <ConfirmButton action={undoStamped.bind(null, id)} className="btn btn-sm btn-ghost" confirm={t("Undo the company stamp step?")}>
                  {t("Undo previous step")}
                </ConfirmButton>
              </div>
            </Step>

            <Step lang={lang} done={!!deal.payment_requested_at} current={stage === "transfer"} title={t("4. Request the transfer")} note={deal.payment_requested_at ? t("requested {a} · expected {b}", { a: longDate(deal.payment_requested_at), b: longDate(deal.payment_expected) }) : undefined}>
              <p>
                {t("Once you have requested the transfer of {amount} internally (invoice {no}), record the date you requested it and the date it is expected to go out.", {
                  amount: money(f.fee, f.currency),
                  no: deal.invoice_number ?? "",
                })}
              </p>
              <PaymentRequest dealId={id} />
              <ConfirmButton action={undoContentDone.bind(null, id)} className="btn btn-sm btn-ghost" confirm={t("Undo the content confirmation?")}>
                {t("Undo previous step")}
              </ConfirmButton>
            </Step>

            <Step lang={lang} done={!!deal.paid_at} current={stage === "payout"} title={t("5. Transfer sent")} at={deal.paid_at}>
              <p>
                {t("Requested {date}. Expected transfer date:", { date: longDate(deal.payment_requested_at) })} <strong className={overdue ? "late" : ""}>{longDate(deal.payment_expected)}</strong>
                {overdue && <span className="late"> {t("(date has passed)")}</span>}
              </p>
              <div className="row">
                <ConfirmButton action={markPaid.bind(null, id)} className="btn btn-primary">
                  {t("Transfer sent")}
                </ConfirmButton>
                <ConfirmButton action={clearPaymentRequest.bind(null, id)} className="btn btn-sm btn-ghost" confirm={t("Undo the transfer request?")}>
                  {t("Undo request")}
                </ConfirmButton>
              </div>
              <PaymentRequest dealId={id} requested={deal.payment_requested_at} expected={deal.payment_expected} />
            </Step>
          </ol>
        </section>
      )}

      {!cancelled && (
        <section className="card">
          <h2>
            {t("Products")} · {t("{a} to {b}", { a: medDate(f.startDate), b: medDate(f.endDate) })}
          </h2>
          <ul className="files">
            {itemsOf(f).map((it, n) => (
              <li key={n}>
                {it.count} x {it.product}
              </li>
            ))}
          </ul>
        </section>
      )}

      {signed && (
        <section className="card">
          <h2>{t("Files")}</h2>
          <ul className="files">
            <li>
              <a href={`/api/deals/${id}/pdf`}>{t("Signed agreement + invoice (PDF)")}</a>
              <span className="muted small"> · {t("creator signature, no company stamp")}</span>
            </li>
            <li>
              {deal.stamped_pdf_name ? (
                <>
                  <a href={`/api/deals/${id}/stamped`}>{t("Stamped final agreement (PDF)")}</a>
                  <span className="muted small"> · {deal.stamped_pdf_name}</span>
                </>
              ) : (
                <span className="muted">{t("Stamped copy not uploaded (optional)")}</span>
              )}
              <details className="replace">
                <summary>{deal.stamped_pdf_name ? t("Replace file") : t("Upload a copy")}</summary>
                <StampUpload dealId={id} replace />
              </details>
            </li>
          </ul>
        </section>
      )}

      <details className="card" open={!signed}>
        <summary>
          <h2>{t("Agreement")}</h2>
        </summary>
        <div className="paper-wrap">
          <ContractDoc fields={f} clauses={deal.clauses} billing={billing} signature={deal.signature} />
          {billing && <InvoiceDoc fields={f} billing={billing} invoiceNumber={deal.invoice_number} issueDate={deal.signed_at} />}
        </div>
      </details>

      <section className="card">
        <h2>{t("Activity")}</h2>
        <ul className="events">
          {events.map((e, i2) => (
            <li key={i2}>
              <span className="muted small">{when(e.at)}</span>
              <span>
                {t(EVENT_LABEL[e.type] ?? e.type)}
                <span className="muted small"> · {e.actor}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
