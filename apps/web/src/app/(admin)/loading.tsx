import { LoadingState } from "@/components/ui";

export default function AdminLoading() {
  return (
    <main className="page-shell">
      <LoadingState label="Opening workspace" />
    </main>
  );
}
