import Link from "next/link";
import { requireUser, signOut } from "@/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <>
      <header className="topbar">
        <Link href="/" className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="d'Alba Talent" />
          <span>Creator Contracts</span>
        </Link>
        <div className="topbar-right">
          <span className="muted hide-sm">{user.email}</span>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button className="btn btn-ghost btn-sm">Sign out</button>
          </form>
        </div>
      </header>
      <main className="page">{children}</main>
    </>
  );
}
