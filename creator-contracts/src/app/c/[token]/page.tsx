import type { Metadata } from "next";
import { billingOf, getDealByToken, updateDeal, videoCounts, videoSlots } from "@/lib/deals";
import { longDate } from "@/lib/template";
import VideoBoard from "./VideoBoard";
import { ContractDoc, InvoiceDoc } from "@/components/Document";
import SignFlow from "./SignFlow";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "d'Alba agreement", referrer: "no-referrer" };

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="creator">{children}</main>;
}

export default async function CreatorPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const deal = await getDealByToken(token);

  if (!deal || !deal.sent_at || deal.cancelled_at) {
    return (
      <Shell>
        <div className="card notice">
          <h1>This link is not available</h1>
          <p>The agreement may have been withdrawn or the link is incorrect. Please contact your d&apos;Alba manager.</p>
        </div>
      </Shell>
    );
  }

  if (deal.signed_at) {
    const billing = billingOf(deal)!;
    const slots = videoSlots(deal);
    const vc = videoCounts(deal);
    return (
      <Shell>
        <header className="creator-head">
          <h1>@{deal.fields.handle} x d&apos;Alba</h1>
          <p>
            Your agreement is signed and your invoice is on file. Use this page to send us each video: first the draft for approval, then the
            link once it is posted. Keep this link.
          </p>
        </header>
        <div className="card progress-card">
          <div>
            <div className="big">
              {vc.posted} / {vc.total}
            </div>
            <div className="muted small">videos posted</div>
          </div>
          <div className="small">
            <div>
              Posting window: {longDate(deal.fields.startDate)} to <strong>{longDate(deal.fields.endDate)}</strong>
            </div>
            <div className="muted">
              {vc.review} in review · {vc.revise} need changes · {vc.approved} approved and ready to post
            </div>
          </div>
        </div>
        {deal.content_done_at ? (
          <div className="card notice ok">
            <h2>All content received. Thank you!</h2>
            <p>Your payment is being processed.</p>
          </div>
        ) : null}
        <VideoBoard token={token} slots={slots} />
        <details className="card">
          <summary>
            <h2>Your signed agreement and invoice</h2>
          </summary>
          <p>
            <a className="btn" href={`/c/${token}/pdf`}>
              Download your copy (PDF)
            </a>
          </p>
          <div className="paper-wrap">
            <ContractDoc fields={deal.fields} clauses={deal.clauses} billing={billing} signature={deal.signature} />
            <InvoiceDoc fields={deal.fields} billing={billing} invoiceNumber={deal.invoice_number} issueDate={deal.signed_at} />
          </div>
        </details>
      </Shell>
    );
  }

  if (!deal.viewed_at) {
    await updateDeal(deal.id, "creator", (d) => {
      if (d.viewed_at) return null;
      d.viewed_at = new Date().toISOString();
      return { event: "viewed" };
    });
  }

  return (
    <Shell>
      <header className="creator-head">
        <h1>Agreement for @{deal.fields.handle}</h1>
        <p>Review the agreement, add your payment details, and type your name to sign. It takes about three minutes. No download or printing needed.</p>
      </header>
      {deal.change_request && (
        <div className="alert alert-info">
          <strong>Your change request was sent to d&apos;Alba.</strong> Your manager will update the agreement at this same link.
          <p className="pre">{deal.change_request}</p>
        </div>
      )}
      <SignFlow token={token} fields={deal.fields} clauses={deal.clauses} />
    </Shell>
  );
}
