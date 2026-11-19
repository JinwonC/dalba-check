import { billingOf, type Deal } from "./deals";
import { pdfFileName, renderDealPdf } from "./pdf";

/** Build the signed agreement + invoice PDF for a signed deal. */
export async function signedPdfResponse(deal: Deal): Promise<Response> {
  const billing = billingOf(deal);
  if (!deal.signed_at || !deal.signature || !billing) return new Response("Not signed yet", { status: 409 });
  const pdf = await renderDealPdf({
    fields: deal.fields,
    clauses: deal.clauses,
    billing,
    signature: deal.signature,
    invoiceNumber: deal.invoice_number,
    issueDate: deal.content_done_at,
    dealId: deal.id,
  });
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${pdfFileName(deal.fields, "Signed")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
