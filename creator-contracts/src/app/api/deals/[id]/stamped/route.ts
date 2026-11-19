import { currentUser } from "@/lib/session";
import { getDeal, stampedKey } from "@/lib/deals";
import { readBytes } from "@/lib/store";
import { pdfFileName } from "@/lib/pdf";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await currentUser())) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const deal = await getDeal(id);
  if (!deal) return new Response("Not found", { status: 404 });
  const pdf = deal.executed_at ? await readBytes(stampedKey(id)) : null;
  if (!pdf) return new Response("No stamped file uploaded", { status: 404 });
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${pdfFileName(deal.fields, "Final_Stamped")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
