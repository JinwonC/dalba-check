import DealForm from "@/components/DealForm";
import { DEFAULT_CLAUSES, defaultFields } from "@/lib/template";

export default function NewDealPage() {
  const fields = { ...defaultFields(), effectiveDate: new Date().toISOString().slice(0, 10) };
  return (
    <>
      <h1>New agreement</h1>
      <DealForm dealId={null} initialFields={fields} initialClauses={DEFAULT_CLAUSES} live={false} />
    </>
  );
}
