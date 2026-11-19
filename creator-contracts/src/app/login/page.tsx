import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { currentUser, devLogin, googleLogin, signIn } from "@/auth";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await currentUser()) redirect("/");
  const { error } = await searchParams;
  return (
    <main className="login">
      <div className="card login-card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="d'Alba Talent" className="login-logo" />
        <h1>Creator Contracts</h1>
        <p className="muted">Sign in with your d&apos;Alba account.</p>
        {error && <p className="alert alert-warn">Sign-in failed. Use your company account.</p>}
        {googleLogin && (
          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: "/" });
            }}
          >
            <button className="btn btn-primary btn-block">Continue with Google</button>
          </form>
        )}
        {devLogin && (
          <form
            className="stack"
            action={async (fd: FormData) => {
              "use server";
              try {
                await signIn("dev", { email: String(fd.get("email") || ""), redirectTo: "/" });
              } catch (e) {
                if (e instanceof AuthError) redirect("/login?error=1");
                throw e;
              }
            }}
          >
            <label className="field">
              <span>Development login</span>
              <input name="email" type="email" placeholder="you@dalbausa.com" required />
            </label>
            <button className="btn btn-block">Sign in</button>
          </form>
        )}
        {!googleLogin && !devLogin && <p className="alert alert-warn">Login is not configured yet. Set the Google OAuth variables.</p>}
      </div>
    </main>
  );
}
