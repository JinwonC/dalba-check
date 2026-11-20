import { notFound, redirect } from "next/navigation";
import { getT } from "@/lib/lang";
import DealForm from "@/components/DealForm";
import { getDeal } from "@/lib/deals";
import { defaultFields } from "@/lib/template";

export default async function EditDealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t } = await getT();
  const deal = await getDeal(id);
  if (!deal) notFound();
  if (deal.signed_at || deal.cancelled_at) redirect(`/deals/${id}`);
  return (
    <>
      <h1>
        {t("Edit agreement")} · @{deal.fields.handle}
      </h1>
      {deal.change_request && (
        <div className="alert alert-warn">
          <strong>{t("Creator requested changes:")}</strong>
          <p className="pre">{deal.change_request}</p>
        </div>
      )}
      {deal.sent_at && <p className="hint">{t("The link is already live. Saving updates what the creator sees at the same link.")}</p>}
      <DealForm dealId={id} initialFields={{ ...defaultFields(), ...deal.fields }} initialClauses={deal.clauses} live={!!deal.sent_at} />
    </>
  );
}
