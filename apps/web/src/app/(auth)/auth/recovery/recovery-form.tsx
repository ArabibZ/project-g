"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button, LoadingState, Notice } from "@/components/ui";
import { api } from "@/lib/api";

export function RecoveryForm({ tokenHash, validType }: { tokenHash: string; validType: boolean }) {
  const started = useRef(false);
  const invalid = !validType || tokenHash.length < 20 || tokenHash.length > 2048;
  const [verified, setVerified] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState(invalid ? "Recovery link is invalid or expired" : "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (invalid) return;
    void (async () => {
      try {
        await api("/api/auth/recovery/verify", {
          method: "POST",
          body: JSON.stringify({ tokenHash, type: "recovery" })
        });
        window.history.replaceState(null, "", "/auth/recovery");
        setVerified(true);
      } catch (verifyError) {
        setError(verifyError instanceof Error ? verifyError.message : "Recovery link is invalid or expired");
      }
    })();
  }, [invalid, tokenHash]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirmation = String(form.get("confirmation") ?? "");
    if (password.length < 12) {
      setError("Password must be at least 12 characters");
      return;
    }
    if (password !== confirmation) {
      setError("Passwords do not match");
      return;
    }

    setBusy(true);
    setError("");
    try {
      await api("/api/auth/recovery/password", {
        method: "POST",
        body: JSON.stringify({ password })
      });
      setComplete(true);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update password");
    } finally {
      setBusy(false);
    }
  }

  if (!verified && !error) {
    return (
      <div className="auth-box">
        <LoadingState label="Verifying recovery link" />
      </div>
    );
  }

  if (complete) {
    return (
      <section className="auth-box page-anim" aria-labelledby="recovery-complete">
        <div className="auth-head">
          <p className="microlabel on-accent">Password updated</p>
          <h1 id="recovery-complete">Recovery complete</h1>
          <p>All existing sessions were signed out. Sign in with the new password.</p>
        </div>
        <Link className="btn btn-primary btn-lg btn-block" href="/login" prefetch={false}>
          Return to sign in
        </Link>
      </section>
    );
  }

  if (!verified) {
    return (
      <section className="auth-box page-anim" aria-labelledby="recovery-invalid">
        <div className="auth-head">
          <p className="microlabel">Recovery unavailable</p>
          <h1 id="recovery-invalid">Link cannot be used</h1>
        </div>
        <Notice>{error}</Notice>
        <div className="auth-alt">
          <Link className="btn btn-secondary btn-block" href="/login" prefetch={false}>
            Return to sign in
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="auth-box page-anim" aria-labelledby="recovery-title">
      <div className="auth-head">
        <p className="microlabel on-accent">Account recovery</p>
        <h1 id="recovery-title">Set new password</h1>
        <p>Use at least 12 characters. Existing sessions will be signed out.</p>
      </div>
      <form className="auth-form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="new-password">New password</label>
          <input
            className="input"
            id="new-password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            required
            disabled={busy}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "recovery-password-error" : undefined}
          />
        </div>
        <div className="field">
          <label htmlFor="confirm-password">Confirm password</label>
          <input
            className="input"
            id="confirm-password"
            name="confirmation"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            required
            disabled={busy}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "recovery-password-error" : undefined}
          />
        </div>
        {error ? (
          <div id="recovery-password-error">
            <Notice>{error}</Notice>
          </div>
        ) : null}
        <Button type="submit" variant="primary" className="btn-lg btn-block" busy={busy} busyLabel="Updating…">
          Update password
        </Button>
      </form>
    </section>
  );
}
