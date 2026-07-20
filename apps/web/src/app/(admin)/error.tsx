"use client";

import { ErrorState } from "@/components/ui";

export default function AdminError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="page-shell">
      <ErrorState message="Admin service is temporarily unavailable." retry={reset} />
    </main>
  );
}
