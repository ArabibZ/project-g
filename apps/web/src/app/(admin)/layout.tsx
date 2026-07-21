import { Nav } from "@/components/nav";

export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <Nav />
      <main className="page-shell">{children}</main>
    </>
  );
}
