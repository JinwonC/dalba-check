import Link from "next/link";
import { bridgeConfigured } from "@/lib/bridge";
import { getT } from "@/lib/lang";
import { requireUser } from "@/lib/session";
import BridgeTest from "./BridgeTest";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireUser();
  const { t } = await getT();
  return (
    <>
      <p className="crumbs">
        <Link href="/">{t("← Agreements")}</Link>
      </p>
      <h1>{t("Connections")}</h1>
      <section className="card">
        <h2>{t("Email and work-request sheet")}</h2>
        <p>
          {bridgeConfigured()
            ? t("Connected through Google Apps Script. Use the buttons below to check that it really works.")
            : t("Not connected yet. Sign emails and sheet rows are switched off.")}
        </p>
        {bridgeConfigured() && <BridgeTest email={user.email} />}
      </section>
    </>
  );
}
