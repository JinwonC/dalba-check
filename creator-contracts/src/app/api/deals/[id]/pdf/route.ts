import { currentUser } from "@/lib/session";
import { getDeal } from "@/lib/deals";
import { signedPdfResponse } from "@/lib/dealPdf";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await currentUser())) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const deal = await getDeal(id);
  if (!deal) return new Response("Not found", { status: 404 });
  return signedPdfResponse(deal);
}
