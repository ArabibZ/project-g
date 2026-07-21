"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const links = [
  ["/dashboard", "Dashboard"],
  ["/bot", "Bot"],
  ["/sources", "Sources"]
] as const;

export function Nav() {
  const pathname = usePathname();
  const [loggingOut, setLoggingOut] = useState(false);

  async function logout() {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      });
    } finally {
      window.location.assign("/login");
    }
  }

  return (
    <header className="site-header">
      <div className="nav-wrap">
        <Link href="/dashboard" className="brand" aria-label="Project G dashboard" prefetch={false}>
          <span className="brand-mark">G</span>
          <span className="brand-copy">
            <strong>Project G</strong>
            <small>Job monitor</small>
          </span>
        </Link>
        <nav className="top-nav" aria-label="Main navigation">
          {links.map(([href, label]) => (
            <Link
              href={href}
              key={href}
              prefetch={false}
              aria-current={pathname === href || pathname.startsWith(`${href}/`) ? "page" : undefined}
            >
              {label}
            </Link>
          ))}
          <button type="button" onClick={logout} disabled={loggingOut}>
            {loggingOut ? "Leaving..." : "Logout"}
          </button>
        </nav>
      </div>
    </header>
  );
}
