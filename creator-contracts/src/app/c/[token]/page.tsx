import type { Metadata } from "next";
import { billingOf, getDealByToken, updateDeal } from "@/lib/deals";
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
    return (
      <Shell>
        <div className="card notice ok">
          <h1>Signed. Thank you!</h1>
          <p>
            Your agreement with d&apos;Alba is signed and your invoice is on file. There is nothing else you need to send. We will add
            our company seal and process your payment after all content is posted.
          </p>
          <a className="btn btn-primary" href={`/c/${token}/pdf`}>
            Download your copy (PDF)
          </a>
        </div>
        <div className="paper-wrap">
          <ContractDoc fields={deal.fields} clauses={deal.clauses} billing={billing} signature={deal.signature} />
          <InvoiceDoc fields={deal.fields} billing={billing} invoiceNumber={deal.invoice_number} issueDate={deal.signed_at} />
        </div>
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
