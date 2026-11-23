import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getT } from "@/lib/lang";
import { getDeal, now, type Deal } from "@/lib/deals";
import { bridgeConfigured } from "@/lib/bridge";
import { sheetConfigured } from "@/lib/sheets";
import BatchRequest, { type BatchItem } from "@/components/BatchRequest";

export const dynamic = "force-dynamic";
// Saving several signed PDFs to Drive takes a few seconds each.
export const maxDuration = 120;

type Search = { kind?: string; ids?: string };

export default async function Batch({ searchParams }: { searchParams: Promise<Search> }) {
  await requireUser();
  const sp = await searchParams;
  const { t } = await getT();
  const kind = sp.kind === "payment" ? "payment" : "stamp";
  const ids = [...new Set((sp.ids || "").split(",").filter(Boolean))].slice(0, 20);
  const deals = (await Promise.all(ids.map((id) => getDeal(id)))).filter((d): d is Deal => !!d);

  const why = (d: Deal): string | null => {
    if (d.cancelled_at) return "Cancelled";
    if (kind === "stamp") return d.signed_at ? null : "The creator has not signed yet.";
    if (d.paid_at) return "Already paid";
    return d.content_done_at ? null : "Content is not confirmed complete yet.";
  };
  const ok = deals.filter((d) => !why(d));
  const skipped = deals.filter((d) => why(d));
  const items: BatchItem[] = ok.map((d) => ({
    id: d.id,
    fields: d.fields,
    videos: (d.videos ?? []).map((v) => ({ url: v.url, at: v.at })),
    already: kind === "stamp" ? !!d.stamp_requested_at : !!d.payment_requested_at,
    folder: d.folder || "",
  }));

  return (
    <>
      <p className="crumbs">
        <Link href="/">← {t("Agreements")}</Link>
      </p>
      <div className="page-head">
        <div>
          <h1>{kind === "stamp" ? t("Stamp request for several agreements") : t("Transfer request for several agreements")}</h1>
          <p className="muted">
            {kind === "stamp"
              ? t("The signed PDFs go into one Drive folder and the sheet gets one row for all of them.")
              : t("The sheet gets one row for all of them, and each agreement gets the same request and expected dates.")}
          </p>
        </div>
      </div>
      {skipped.length > 0 && (
        <div className="alert alert-warn">
          <strong>{t("Left out of this request")}</strong>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {skipped.map((d) => (
              <li key={d.id}>
                @{d.fields.handle}: {t(why(d) || "")}
              </li>
            ))}
          </ul>
        </div>
      )}
      {items.length < 2 ? (
        <div className="card empty">
          <p>{t("Pick at least two agreements that are ready for this step, then try again.")}</p>
          <Link href="/" className="btn">
            {t("Back to the list")}
          </Link>
        </div>
      ) : (
        <BatchRequest kind={kind} items={items} today={now().slice(0, 10)} sheetOn={sheetConfigured()} driveOn={bridgeConfigured()} />
      )}
    </>
  );
}
