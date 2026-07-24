import { BottomDock, Nav } from "@/components/nav";

export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <Nav />
      <main className="workspace">
        <div className="page page-anim">{children}</div>
      </main>
      <BottomDock />
    </>
  );
}
