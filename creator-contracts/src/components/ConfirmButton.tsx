"use client";

import { useTransition } from "react";
import { useT } from "@/components/Lang";

/** Button that runs a server action, optionally after a confirm prompt. */
export default function ConfirmButton({
  action,
  confirm,
  className,
  children,
}: {
  action: () => Promise<void>;
  confirm?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const t = useT();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className={className ?? "btn"}
      disabled={pending}
      onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        start(() => action());
      }}
    >
      {pending ? t("Working…") : children}
    </button>
  );
}
