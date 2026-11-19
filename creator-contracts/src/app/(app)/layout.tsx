import Link from "next/link";
import { redirect } from "next/navigation";
import { endSession, requireUser } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <>
      <header className="topbar">
        <Link href="/" className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="d'Alba" />
          <span>Creator Contracts</span>
        </Link>
        <div className="topbar-right">
          <span className="muted hide-sm">{user.name}</span>
          <form
            action={async () => {
              "use server";
              await endSession();
              redirect("/enter");
            }}
          >
            <button className="btn btn-ghost btn-sm">Switch user</button>
          </form>
        </div>
      </header>
      <main className="page">{children}</main>
    </>
  );
}
