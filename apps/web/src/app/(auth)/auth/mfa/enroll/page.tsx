"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button, ErrorState, LoadingState, Notice } from "@/components/ui";
import { api } from "@/lib/api";
import { enrollmentSchema } from "@/lib/contracts";

type Enrollment = { qrCode: string; secret: string; uri: string };

export default function MfaEnrollPage() {
  const router = useRouter();
  const started = useRef(false);
  const actionRef = useRef(false);
  const [enrollment, setEnrollment] = useState<Enrollment>();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [action, setAction] = useState<"enroll" | "verify" | "">("");
  const [copied, setCopied] = useState(false);

  async function enroll() {
    if (actionRef.current) return;
    actionRef.current = true;
    setAction("enroll");
    setError("");
    try {
      const next = enrollmentSchema.parse(
        await api("/api/auth/mfa/enroll", { method: "POST", body: "{}" })
      );
      setError("");
      setEnrollment(next);
    } catch (enrollError) {
      setError(enrollError instanceof Error ? enrollError.message : "Enrollment failed");
    } finally {
      actionRef.current = false;
      setAction("");
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
    if (actionRef.current) return;
    actionRef.current = true;
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
      actionRef.current = false;
      setAction("");
    }
  }

  if (!enrollment && !error) {
    return (
      <div className="auth-box">
        <LoadingState label="Preparing authenticator" />
      </div>
    );
  }
  if (!enrollment) {
    return (
      <div className="auth-box">
        <ErrorState message={error} retry={() => void enroll()} />
      </div>
    );
  }

  return (
    <section className="auth-box auth-box-wide page-anim" aria-labelledby="enroll-title">
      <div className="auth-head">
        <p className="microlabel on-accent">Required security</p>
        <h1 id="enroll-title">Set up authenticator</h1>
        <p>Scan the QR code, save the setup key securely, then enter the current 6-digit code.</p>
      </div>
      <div className="enroll-grid">
        <div className="qr-panel">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enrollment.qrCode} alt="Authenticator enrollment QR code" width="200" height="200" />
        </div>
        <div style={{ display: "grid", gap: 18, minWidth: 0 }}>
          <div className="secret-block">
            <span className="field-label">Manual setup key</span>
            <code>{enrollment.secret}</code>
            <Button
              variant="secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(enrollment.secret);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 2200);
                } catch {
                  setError("Could not copy secret. Select and copy it manually.");
                }
              }}
              style={{ width: "fit-content" }}
            >
              {copied ? "Copied" : "Copy setup key"}
            </Button>
          </div>
          <form className="auth-form" onSubmit={submit}>
            <div className="field">
              <label htmlFor="enroll-code">6-digit code</label>
              <input
                className="input code-input"
                id="enroll-code"
                type="text"
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                disabled={action !== ""}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "enroll-code-error" : undefined}
              />
            </div>
            {error ? (
              <div id="enroll-code-error">
                <Notice>{error}</Notice>
              </div>
            ) : null}
            <Button
              type="submit"
              variant="primary"
              className="btn-lg"
              busy={action === "verify"}
              busyLabel="Verifying…"
              disabled={action !== ""}
            >
              Finish setup
            </Button>
          </form>
          <p className="recovery-hint">
            Keep the setup key with your other recovery material. If you lose this authenticator,
            signing in again requires the account recovery link sent to the admin email.
          </p>
        </div>
      </div>
    </section>
  );
}
