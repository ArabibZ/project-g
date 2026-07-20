"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Notice } from "@/components/ui";
import { api } from "@/lib/api";

export default function MfaChallengePage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit authentication code");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/mfa/verify", {
        method: "POST",
        body: JSON.stringify({ code })
      });
      router.replace("/dashboard");
      router.refresh();
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : "Invalid authentication code");
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="auth-card" aria-labelledby="challenge-title">
      <div className="auth-heading">
        <p className="eyebrow">Second step</p>
        <h1 id="challenge-title">Authentication code</h1>
        <p>Enter current code from your authenticator app.</p>
      </div>
      <form className="auth-form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="mfa-code">6-digit code</label>
          <input
            className="input code-input mono"
            id="mfa-code"
            type="text"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            autoFocus
            required
          />
        </div>
        {error ? <Notice>{error}</Notice> : null}
        <button className="button button-primary auth-submit" type="submit" disabled={busy}>
          {busy ? "Verifying..." : "Verify"}
        </button>
      </form>
    </section>
  );
}
