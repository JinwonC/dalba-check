import { redirect } from "next/navigation";
import LangToggle from "@/components/LangToggle";
import { getT } from "@/lib/lang";
import { accessCodeSet, checkAccessCode, currentUser, misconfigured, startSession } from "@/lib/session";

export const dynamic = "force-dynamic";

async function enter(fd: FormData) {
  "use server";
  const name = String(fd.get("name") || "").trim().replace(/\s+/g, " ").slice(0, 60);
  if (!name) redirect("/enter?error=name");
  if (!checkAccessCode(String(fd.get("code") || ""))) redirect("/enter?error=code");
  await startSession(name);
  redirect("/");
}

export default async function EnterPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await currentUser()) redirect("/");
  const { error } = await searchParams;
  const { t, lang } = await getT();
  return (
    <main className="login">
      <form className="card login-card" action={enter}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="d'Alba" className="login-logo" />
        <h1>{t("Creator Contracts")}</h1>
        {misconfigured() ? (
          <p className="alert alert-warn">{t("The team access code is not configured yet.")}</p>
        ) : (
          <>
            <p className="muted">{t("Enter your name once on this browser. It labels the deals you manage.")}</p>
            {error === "code" && <p className="alert alert-warn">{t("That access code is not correct.")}</p>}
            {error === "name" && <p className="alert alert-warn">{t("Enter your name.")}</p>}
            <label className="field">
              <span>{t("Your name")}</span>
              <input name="name" required maxLength={60} autoComplete="name" placeholder={t("e.g. Jinwon")} />
            </label>
            {accessCodeSet() && (
              <label className="field">
                <span>{t("Team access code")}</span>
                <input name="code" type="password" required autoComplete="current-password" />
              </label>
            )}
            <button className="btn btn-primary btn-block">{t("Continue")}</button>
          </>
        )}
      </form>
      <div className="login-lang">
        <LangToggle lang={lang} />
      </div>
    </main>
  );
}
