import { redirect } from "next/navigation";
import LangToggle from "@/components/LangToggle";
import { getT } from "@/lib/lang";
import { accountsEnabled, findByLogin } from "@/lib/accounts";
import { accessCodeSet, checkAccessCode, currentUser, misconfigured, startSession, workEmail } from "@/lib/session";

export const dynamic = "force-dynamic";

async function signIn(fd: FormData) {
  "use server";
  const account = findByLogin(String(fd.get("id") || ""), String(fd.get("pw") || ""));
  if (!account) {
    await new Promise((r) => setTimeout(r, 600)); // slow down guessing
    redirect("/enter?error=login");
  }
  await startSession(account.name || account.id, account.email);
  redirect("/");
}

async function enter(fd: FormData) {
  "use server";
  if (accountsEnabled()) redirect("/enter");
  const name = String(fd.get("name") || "").trim().replace(/\s+/g, " ").slice(0, 60);
  if (!name) redirect("/enter?error=name");
  const email = workEmail(String(fd.get("email") || ""));
  if (!email) redirect("/enter?error=email");
  if (!checkAccessCode(String(fd.get("code") || ""))) redirect("/enter?error=code");
  await startSession(name, email);
  redirect("/");
}

export default async function EnterPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await currentUser()) redirect("/");
  const { error } = await searchParams;
  const { t, lang } = await getT();
  return (
    <main className="login">
      <form className="card login-card" action={accountsEnabled() ? signIn : enter}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="d'Alba" className="login-logo" />
        <h1>{t("Creator Contracts")}</h1>
        {accountsEnabled() ? (
          <>
            <p className="muted">{t("Sign in with the same ID and password as the outreach tool.")}</p>
            {error === "login" && <p className="alert alert-warn">{t("The ID or password is not correct.")}</p>}
            <label className="field">
              <span>{t("ID")}</span>
              <input name="id" required autoComplete="username" autoCapitalize="none" />
            </label>
            <label className="field">
              <span>{t("Password")}</span>
              <input name="pw" type="password" required autoComplete="current-password" />
            </label>
            <button className="btn btn-primary btn-block">{t("Sign in")}</button>
          </>
        ) : misconfigured() ? (
          <p className="alert alert-warn">{t("The team access code is not configured yet.")}</p>
        ) : (
          <>
            <p className="muted">{t("Enter your name and work email once on this browser. They label the deals you manage.")}</p>
            {error === "code" && <p className="alert alert-warn">{t("That access code is not correct.")}</p>}
            {error === "name" && <p className="alert alert-warn">{t("Enter your name.")}</p>}
            {error === "email" && <p className="alert alert-warn">{t("Enter your company email (@dalbausa.com or @dalba.com).")}</p>}
            <label className="field">
              <span>{t("Your name")}</span>
              <input name="name" required maxLength={60} autoComplete="name" placeholder={t("e.g. Jinwon")} />
            </label>
            <label className="field">
              <span>{t("Work email")}</span>
              <input name="email" type="email" required autoComplete="email" placeholder="you@dalbausa.com" />
              <small>{t("We email you here when your creator signs.")}</small>
              <small className="tip">{t("The first email may land in your spam folder. Mark it as \"not spam\" once and later ones will reach your inbox.")}</small>
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
