"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ErrorState, LoadingState, Notice } from "@/components/ui";
import { api } from "@/lib/api";
import { enrollmentSchema } from "@/lib/contracts";

type Enrollment = { qrCode: string; secret: string; uri: string };

export default function MfaEnrollPage() {
  const router = useRouter();
  const started = useRef(false);
  const [enrollment, setEnrollment] = useState<Enrollment>();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function enroll() {
    try {
      const next = enrollmentSchema.parse(
        await api("/api/auth/mfa/enroll", { method: "POST", body: "{}" })
      );
      setError("");
      setEnrollment(next);
    } catch (enrollError) {
      setError(enrollError instanceof Error ? enrollError.message : "Enrollment failed");
    }
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void enroll();
  }, []);

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

  if (!enrollment && !error) return <LoadingState label="Preparing authenticator" />;
  if (!enrollment) return <ErrorState message={error} retry={() => void enroll()} />;

  return (
    <section className="auth-card auth-card-wide" aria-labelledby="enroll-title">
      <div className="auth-heading">
        <p className="eyebrow">Required security</p>
        <h1 id="enroll-title">Set up authenticator</h1>
        <p>Scan QR code, save secret securely, then enter current 6-digit code.</p>
      </div>
      <div className="enrollment-grid">
        <div className="qr-panel">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enrollment.qrCode} alt="Authenticator QR code" width="220" height="220" />
        </div>
        <div className="enrollment-details">
          <div className="secret-block">
            <span className="field-label">Manual secret</span>
            <code>{enrollment.secret}</code>
            <button
              className="button button-secondary"
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(enrollment.secret);
                  setCopied(true);
                } catch {
                  setError("Could not copy secret. Select and copy it manually.");
                }
              }}
            >
              {copied ? "Copied" : "Copy secret"}
            </button>
          </div>
          <form className="auth-form" onSubmit={submit}>
            <div className="field">
              <label htmlFor="enroll-code">6-digit code</label>
              <input
                className="input code-input mono"
                id="enroll-code"
                type="text"
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
              />
            </div>
            {error ? <Notice>{error}</Notice> : null}
            <button className="button button-primary auth-submit" type="submit" disabled={busy}>
              {busy ? "Verifying..." : "Finish setup"}
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
