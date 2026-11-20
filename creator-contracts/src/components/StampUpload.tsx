"use client";

import { useActionState } from "react";
import { useT } from "@/components/Lang";
import { uploadStamped, type UploadResult } from "@/app/(app)/deals/actions";

export default function StampUpload({ dealId, replace }: { dealId: string; replace?: boolean }) {
  const t = useT();
  const [state, action, pending] = useActionState<UploadResult | null, FormData>(uploadStamped.bind(null, dealId), null);
  return (
    <form action={action} className="upload">
      <input type="file" name="file" accept="application/pdf,.pdf" required aria-label="Stamped PDF" />
      <button className={replace ? "btn btn-sm" : "btn btn-primary"} disabled={pending}>
        {pending ? t("Uploading…") : t("Upload stamped PDF")}
      </button>
      {state && "error" in state && <p className="alert alert-warn">{state.error}</p>}
    </form>
  );
}
