import Link from "next/link";
import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth";

export default async function PanelLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <nav className="topnav">
            <Link href="/panel" className="brand">Post Lead</Link>
            <Link href="/panel/sandbox" className="small">Sandbox</Link>
          </nav>
          <form action="/auth/signout" method="post">
            <span className="small">{user.email}</span>{" · "}
            <button type="submit" className="linklike">Sair</button>
          </form>
        </div>
      </header>
      {children}
    </>
  );
}
