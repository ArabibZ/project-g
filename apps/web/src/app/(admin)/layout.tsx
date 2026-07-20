import { Nav } from "@/components/nav";
import { requireAdmin } from "@/lib/server/require-admin";

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireAdmin();
  return (
    <>
      <Nav />
      <main className="page-shell">{children}</main>
    </>
  );
}
