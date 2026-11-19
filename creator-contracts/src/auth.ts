import NextAuth from "next-auth";
import type { Provider } from "next-auth/providers";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { redirect } from "next/navigation";

const allowedDomains = (process.env.ALLOWED_EMAIL_DOMAINS || "dalbausa.com")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

function allowed(email?: string | null): boolean {
  const domain = (email || "").toLowerCase().split("@")[1];
  return !!domain && allowedDomains.includes(domain);
}

// Typed-email login exists only for local development.
export const devLogin = process.env.DEV_LOGIN === "1" && process.env.VERCEL_ENV !== "production";
export const googleLogin = !!process.env.AUTH_GOOGLE_ID;

const providers: Provider[] = [];
if (googleLogin) providers.push(Google);
if (devLogin) {
  providers.push(
    Credentials({
      id: "dev",
      credentials: { email: {} },
      authorize: async (c) => {
        const email = String(c?.email || "").trim().toLowerCase();
        return allowed(email) ? { id: email, email, name: email.split("@")[0] } : null;
      },
    }),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    signIn: ({ user }) => allowed(user.email),
  },
});

export type Manager = { email: string; name: string };

export async function currentUser(): Promise<Manager | null> {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email || !allowed(email)) return null;
  return { email, name: session?.user?.name || email.split("@")[0] };
}

export async function requireUser(): Promise<Manager> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}
