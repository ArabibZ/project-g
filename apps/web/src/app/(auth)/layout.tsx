import Link from "next/link";

export default function AuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <main className="auth-shell">
      <Link href="/" className="auth-brand" aria-label="Project G home" prefetch={false}>
        <span className="brand-mark">G</span>
        <span>Project G</span>
      </Link>
      {children}
    </main>
  );
}
