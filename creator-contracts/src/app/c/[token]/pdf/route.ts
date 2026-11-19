import { getDealByToken } from "@/lib/deals";
import { signedPdfResponse } from "@/lib/dealPdf";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const deal = await getDealByToken(token);
  if (!deal || deal.cancelled_at) return new Response("Not found", { status: 404 });
  return signedPdfResponse(deal);
}
