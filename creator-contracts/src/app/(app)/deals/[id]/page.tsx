import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import ConfirmButton from "@/components/ConfirmButton";
import CopyLink from "@/components/CopyLink";
import StampUpload from "@/components/StampUpload";
import { ContractDoc, InvoiceDoc } from "@/components/Document";
import Stepper from "@/components/Stepper";
import { STAGE_LABEL, billingOf, getDeal, linkToken, nextAction, stageOf, stepsDone, transferOverdue } from "@/lib/deals";
import { clauseState, DEFAULT_CLAUSES, longDate, money } from "@/lib/template";
import { origin } from "@/lib/url";
import PaymentRequest from "@/components/PaymentRequest";
import { cancelDeal, clearPaymentRequest, markContentDone, markPaid, markStampRequested, reassignToMe, undoContentDone } from "../actions";

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

const when = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC" : "";

function Step({ done, current, title, at, note, children }: { done: boolean; current: boolean; title: string; at?: string | null; note?: string; children?: React.ReactNode }) {
  return (
    <li className={done ? "step done" : current ? "step current" : "step"}>
      <span className="step-dot" aria-hidden>
        {done ? "✓" : ""}
      </span>
      <div className="step-main">
        <div className="step-title">
          {title}
          {done && at && <span className="muted small"> · {when(at)}</span>}
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
        <Link href="/">← Agreements</Link>
      </p>
      <div className="page-head">
        <div>
          <h1>@{f.handle}</h1>
          <p className="muted">
            {money(f.fee, f.currency)}
            {f.commissionPct > 0 && ` + ${f.commissionPct}% commission`} · {f.deliverableCount} x {f.deliverableType} · {f.country} · Manager:{" "}
            {deal.manager}
            {deal.manager !== user.name && !cancelled && (
              <>
                {" "}
                <ConfirmButton action={reassignToMe.bind(null, id)} className="linkish" confirm="Make yourself the manager of this deal?">
                  take over
                </ConfirmButton>
              </>
            )}
          </p>
        </div>
        <div className="row">
          <span className="pill pill-neutral">{STAGE_LABEL[stage]}</span>
        </div>
      </div>

      {(custom.length > 0 || removed.length > 0) && (
        <div className="alert alert-info">
          <strong>Custom terms.</strong>{" "}
          {custom.length > 0 && <>Changed or added: {custom.map((x) => x.title).join(", ")}. </>}
          {removed.length > 0 && <>Removed: {removed.map((x) => x.title).join(", ")}.</>}
        </div>
      )}

      {cancelled ? (
        <div className="alert alert-warn">This deal was cancelled on {when(deal.cancelled_at)}. The creator link no longer works.</div>
      ) : (
        <section className="card">
          <h2>Progress</h2>
          {stage !== "draft" && <Stepper done={stepsDone(deal)} labels />}
          {next.owner !== "none" && (
            <p className={next.owner === "you" ? "nextup nextup-you" : "nextup"}>
              <strong>{next.owner === "you" ? "Your next step:" : next.owner === "creator" ? "Waiting on the creator:" : "Waiting on finance:"}</strong> {next.text}
            </p>
          )}
          <ol className="steps">
            <Step done={!!deal.sent_at} current={!deal.sent_at} title="Create the creator link" at={deal.sent_at}>
              <p>This is still a draft. Finish the terms, then create the link.</p>
              <Link href={`/deals/${id}/edit`} className="btn btn-primary">
                Continue editing
              </Link>
            </Step>

            <Step done={signed} current={!!deal.sent_at && !signed} title="1. Creator signs the agreement and invoice" at={deal.signed_at}>
              {deal.change_request ? (
                <div className="alert alert-warn">
                  <strong>Changes requested · {when(deal.change_requested_at)}</strong>
                  <p className="pre">{deal.change_request}</p>
                  <Link href={`/deals/${id}/edit`} className="btn btn-primary btn-sm">
                    Revise agreement
                  </Link>
                </div>
              ) : (
                <p>{deal.viewed_at ? `Opened ${when(deal.viewed_at)}, not signed yet.` : "Not opened yet. Send this link to the creator."}</p>
              )}
              <CopyLink url={link} />
              <div className="row">
                <Link href={`/deals/${id}/edit`} className="btn btn-sm">
                  Edit terms
                </Link>
                <ConfirmButton action={cancelDeal.bind(null, id)} className="btn btn-sm btn-danger" confirm="Cancel this deal? The creator link will stop working.">
                  Cancel deal
                </ConfirmButton>
              </div>
            </Step>

            <Step done={!!deal.executed_at} current={stage === "stamp"} title="2. Internal approval and company stamp" at={deal.executed_at}>
              <p>
                1. Download the signed PDF and submit it to the internal system for the company seal.
                <br />
                2. When the stamped file comes back, upload it here.
              </p>
              <div className="row">
                <a href={`/api/deals/${id}/pdf`} className="btn btn-primary">
                  Download signed PDF
                </a>
                {deal.stamp_requested_at ? (
                  <span className="muted small">Stamp requested {when(deal.stamp_requested_at)}</span>
                ) : (
                  <ConfirmButton action={markStampRequested.bind(null, id)} className="btn">
                    Mark stamp requested
                  </ConfirmButton>
                )}
              </div>
              <StampUpload dealId={id} />
            </Step>

            <Step done={!!deal.content_done_at} current={stage === "content"} title="3. Creator delivers the content" at={deal.content_done_at}>
              <p>
                When all {f.deliverableCount} {f.deliverableType} are posted and the creator has met the agreement, confirm it here.
              </p>
              <ConfirmButton action={markContentDone.bind(null, id)} className="btn btn-primary" confirm="Confirm the creator has delivered everything in the agreement?">
                Content complete
              </ConfirmButton>
            </Step>

            <Step done={!!deal.payment_requested_at} current={stage === "transfer"} title="4. Request the transfer" at={deal.payment_requested_at} note={deal.payment_expected && !deal.paid_at ? `expected ${longDate(deal.payment_expected)}` : undefined}>
              <p>
                Request the transfer of {money(f.fee, f.currency)} internally (invoice {deal.invoice_number}), then record it here with the expected transfer date.
              </p>
              <PaymentRequest dealId={id} />
              <ConfirmButton action={undoContentDone.bind(null, id)} className="btn btn-sm btn-ghost" confirm="Undo the content confirmation?">
                Content was not complete, undo
              </ConfirmButton>
            </Step>

            <Step done={!!deal.paid_at} current={stage === "payout"} title="5. Transfer sent" at={deal.paid_at}>
              <p>
                Expected transfer date: <strong className={overdue ? "late" : ""}>{longDate(deal.payment_expected ?? "")}</strong>
                {overdue && <span className="late"> (date has passed)</span>}
              </p>
              <div className="row">
                <ConfirmButton action={markPaid.bind(null, id)} className="btn btn-primary" confirm="Mark this payment as sent?">
                  Mark as paid
                </ConfirmButton>
                <ConfirmButton action={clearPaymentRequest.bind(null, id)} className="btn btn-sm btn-ghost" confirm="Undo the transfer request?">
                  Undo request
                </ConfirmButton>
              </div>
              <PaymentRequest dealId={id} current={deal.payment_expected} />
            </Step>
          </ol>
        </section>
      )}

      {signed && (
        <section className="card">
          <h2>Files</h2>
          <ul className="files">
            <li>
              <a href={`/api/deals/${id}/pdf`}>Signed agreement + invoice (PDF)</a>
              <span className="muted small"> · creator signature, no company stamp</span>
            </li>
            {deal.executed_at && (
              <li>
                <a href={`/api/deals/${id}/stamped`}>Stamped final agreement (PDF)</a>
                <span className="muted small"> · {deal.stamped_pdf_name}</span>
                <details className="replace">
                  <summary>Replace file</summary>
                  <StampUpload dealId={id} replace />
                </details>
              </li>
            )}
          </ul>
        </section>
      )}

      <details className="card" open={!signed}>
        <summary>
          <h2>Agreement</h2>
        </summary>
        <div className="paper-wrap">
          <ContractDoc fields={f} clauses={deal.clauses} billing={billing} signature={deal.signature} />
          {billing && <InvoiceDoc fields={f} billing={billing} invoiceNumber={deal.invoice_number} issueDate={deal.signed_at} />}
        </div>
      </details>

      <section className="card">
        <h2>Activity</h2>
        <ul className="events">
          {events.map((e, i2) => (
            <li key={i2}>
              <span className="muted small">{when(e.at)}</span>
              <span>
                {EVENT_LABEL[e.type] ?? e.type}
                <span className="muted small"> · {e.actor}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
