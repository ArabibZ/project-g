"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { BrandLockup } from "@/components/logo";
import {
  Button,
  IconActivity,
  IconBot,
  IconGauge,
  IconJobs,
  IconLogout,
  IconSources
} from "@/components/ui";
import { formatDhakaClock } from "@/lib/format";

type NavItem = {
  href: string;
  label: string;
  dockLabel?: string;
  icon: typeof IconGauge;
};

const links: readonly NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: IconGauge },
  { href: "/sources", label: "Sources", icon: IconSources },
  { href: "/bot", label: "Bot", icon: IconBot },
  { href: "/jobs", label: "Jobs", icon: IconJobs },
  { href: "/operations", label: "Operations", dockLabel: "Ops", icon: IconActivity }
];

const CLOCK_INTERVAL_MS = 30_000;

function subscribeClock(update: () => void): () => void {
  const id = window.setInterval(update, CLOCK_INTERVAL_MS);
  return () => window.clearInterval(id);
}

function getClockSnapshot(): number {
  return Math.floor(Date.now() / CLOCK_INTERVAL_MS);
}

function getClockServerSnapshot(): null {
  return null;
}

function useActive(href: string): boolean {
  const pathname = usePathname();
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({
  href,
  label,
  icon: Icon,
  iconSize
}: {
  href: string;
  label: string;
  icon: typeof IconGauge;
  iconSize: number;
}) {
  const active = useActive(href);
  return (
    <Link href={href} prefetch={false} aria-current={active ? "page" : undefined}>
      <Icon size={iconSize} />
      {label}
    </Link>
  );
}

function DhakaClock() {
  const bucket = useSyncExternalStore(subscribeClock, getClockSnapshot, getClockServerSnapshot);
  const label = bucket === null ? "Dhaka time" : formatDhakaClock(bucket * CLOCK_INTERVAL_MS);
  return <span className="clock">{label}</span>;
}

async function logoutRequest() {
  await fetch("/api/auth/logout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}"
  });
}

export function Nav() {
  const [loggingOut, setLoggingOut] = useState(false);

  async function logout() {
    setLoggingOut(true);
    try {
      await logoutRequest();
    } finally {
      window.location.assign("/login");
    }
  }

  return (
    <header className="tb">
      <Link href="/dashboard" className="brand-lockup" aria-label="Project G dashboard" prefetch={false}>
        <BrandLockup />
      </Link>

      <nav className="tb-nav" aria-label="Main navigation">
        {links.map((link) => (
          <NavLink
            key={link.href}
            href={link.href}
            label={link.label}
            icon={link.icon}
            iconSize={15}
          />
        ))}
      </nav>

      <div className="tb-side">
        <DhakaClock />
        <span className="tb-divider" aria-hidden="true" />
        <Button variant="quiet" busy={loggingOut} busyLabel="Signing out…" onClick={() => void logout()}>
          <IconLogout size={15} /> Sign out
        </Button>
      </div>
    </header>
  );
}

export function BottomDock() {
  return (
    <nav className="bottom-nav" aria-label="Main navigation">
      {links.map((link) => (
        <NavLink
          key={link.href}
          href={link.href}
          label={link.dockLabel ?? link.label}
          icon={link.icon}
          iconSize={19}
        />
      ))}
    </nav>
  );
}
