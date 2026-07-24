"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Notice } from "@/components/ui";
import { api } from "@/lib/api";

export default function MfaChallengePage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [action, setAction] = useState<"verify" | "logout" | "">("");
  const busy = action !== "";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit authentication code");
      return;
    }
    if (busy) return;
    setAction("verify");
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
      setAction("");
    }
  }

  async function signOut() {
    if (busy) return;
    setAction("logout");
    try {
      await api("/api/auth/logout", { method: "POST", body: "{}" });
    } catch {
      // Cookies are cleared by the BFF even when the upstream session already expired.
    } finally {
      window.location.assign("/login");
    }
  }

  return (
    <section className="auth-box page-anim" aria-labelledby="challenge-title">
      <div className="auth-head">
        <p className="microlabel on-accent">Second step</p>
        <h1 id="challenge-title">Authentication code</h1>
        <p>Enter the current code from your authenticator app.</p>
      </div>
      <form className="auth-form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="mfa-code">6-digit code</label>
          <input
            className="input code-input"
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
            disabled={busy}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "mfa-hint mfa-error" : "mfa-hint"}
          />
          <p className="field-help" id="mfa-hint">
            Codes rotate every 30 seconds.
          </p>
        </div>
        {error ? (
          <div id="mfa-error">
            <Notice>{error}</Notice>
          </div>
        ) : null}
        <Button
          type="submit"
          variant="primary"
          className="btn-lg btn-block"
          busy={action === "verify"}
          busyLabel="Verifying…"
          disabled={busy}
        >
          Verify
        </Button>
      </form>
      <div className="auth-alt">
        <Button
          variant="quiet"
          className="btn-block"
          disabled={busy}
          busy={action === "logout"}
          busyLabel="Signing out…"
          onClick={() => void signOut()}
        >
          Sign out and use a different account
        </Button>
      </div>
    </section>
  );
}
