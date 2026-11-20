import { billingOf, type Deal } from "./deals";
import { pdfFileName, renderDealPdf } from "./pdf";

/** The signed agreement + invoice PDF for a signed deal, or null if it is not signed yet. */
export async function signedPdfBytes(deal: Deal): Promise<Buffer | null> {
  const billing = billingOf(deal);
  if (!deal.signed_at || !deal.signature || !billing) return null;
  return renderDealPdf({
    fields: deal.fields,
    clauses: deal.clauses,
    billing,
    signature: deal.signature,
    invoiceNumber: deal.invoice_number,
    issueDate: new Date(deal.signed_at),
    dealId: deal.id,
  });
}

export async function signedPdfResponse(deal: Deal): Promise<Response> {
  const pdf = await signedPdfBytes(deal);
  if (!pdf) return new Response("Not signed yet", { status: 409 });
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${pdfFileName(deal.fields, "Signed")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
