import type { Metadata } from "next";
import { billingOf, getDealByToken, updateDeal, videoGroups, videoProgress } from "@/lib/deals";
import { longDate } from "@/lib/template";
import VideoLinks from "@/components/VideoLinks";
import { submitVideo, withdrawVideo } from "./actions";
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
    const vp = videoProgress(deal);
    const left = vp.total - vp.done;
    return (
      <Shell>
        <header className="hero">
          <p className="kicker">d&apos;Alba · creator agreement</p>
          <h1>@{deal.fields.handle}</h1>
          <p className="hero-sub">
            Your agreement is signed and your invoice is on file. Each time you post a video for this campaign, paste its link below so we can
            keep track. Keep this page&apos;s link.
          </p>
          <dl className="hero-stats">
            <div>
              <dt>Videos submitted</dt>
              <dd>
                {vp.done} / {vp.total}
              </dd>
            </div>
            <div>
              <dt>Left to post</dt>
              <dd>{left}</dd>
            </div>
            <div>
              <dt>Post by</dt>
              <dd className="hero-date">{longDate(deal.fields.endDate)}</dd>
            </div>
          </dl>
        </header>
        <section className="card">
          <h2>Your videos</h2>
          <VideoLinks
            groups={videoGroups(deal)}
            onAdd={submitVideo.bind(null, token)}
            onRemove={withdrawVideo.bind(null, token)}
            labels={{
              submitted: "{a} of {b} submitted",
              remaining: "{n} left",
              allIn: "All in",
              placeholder: "Paste the link to your posted video",
              add: "Submit link",
              adding: "Sending…",
              remove: "Remove",
              confirmRemove: "Remove this link?",
              none: "No links yet.",
            }}
          />
        </section>
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
      <header className="hero">
        <p className="kicker">d&apos;Alba · creator agreement</p>
        <h1>@{deal.fields.handle}</h1>
        <p className="hero-sub">Review the agreement, add your payment details, and type your name to sign. It takes about three minutes. No download or printing needed.</p>
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
