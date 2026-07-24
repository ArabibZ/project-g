import Link from "next/link";
import { BrandLockup } from "@/components/logo";
import { IconLock } from "@/components/ui";

export default function AuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="auth-split">
      <div className="auth-brandpane">
        <Link href="/" className="brand-lockup" aria-label="Project G home" prefetch={false}>
          <BrandLockup />
        </Link>
        <div className="auth-statement">
          <p className="auth-display">
            Watches GigClickers<span className="tick">.</span>
            <br />
            Pings Telegram<span className="tick">.</span>
          </p>
          <p>
            Private job monitor for one administrator. Deduplicated history, approved subscribers,
            Dhaka time.
          </p>
        </div>
        <p className="auth-footrow">
          <IconLock size={11} />
          Restricted system · authorized administrator only
        </p>
      </div>
      <main className="auth-formpane">{children}</main>
    </div>
  );
}
