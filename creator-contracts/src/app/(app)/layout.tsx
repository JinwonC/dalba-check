import Link from "next/link";
import { redirect } from "next/navigation";
import { LangProvider } from "@/components/Lang";
import LangToggle from "@/components/LangToggle";
import { getT } from "@/lib/lang";
import { endSession, requireUser } from "@/lib/session";
import { accountsEnabled } from "@/lib/accounts";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const { t, lang } = await getT();
  return (
    <LangProvider lang={lang}>
      <header className="topbar">
        <Link href="/" className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="d'Alba" />
          <span>{t("Creator Contracts")}</span>
        </Link>
        <div className="topbar-right">
          <Link href="/guide" className="nav-guide">
            {t("How it works")}
          </Link>
          <Link href="/settings" className="small muted hide-sm">
            {t("Connections")}
          </Link>
          <LangToggle lang={lang} />
          <span className="muted hide-sm">{user.name}</span>
          <form
            action={async () => {
              "use server";
              await endSession();
              redirect("/enter");
            }}
          >
            <button className="btn btn-ghost btn-sm">{t(accountsEnabled() ? "Sign out" : "Switch user")}</button>
          </form>
        </div>
      </header>
      <main className="page">{children}</main>
    </LangProvider>
  );
}
