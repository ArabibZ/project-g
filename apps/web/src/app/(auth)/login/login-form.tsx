"use client";

import { GENERIC_LOGIN_ERROR } from "@project-g/shared";
import Script from "next/script";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Notice } from "@/components/ui";
import { api } from "@/lib/api";
import { loginResultSchema } from "@/lib/contracts";

declare global {
  interface Window {
    turnstile?: {
      remove: (widgetId: string) => void;
      render: (
        container: HTMLElement,
        options: {
          action: string;
          callback: (token: string) => void;
          "error-callback": () => void;
          "expired-callback": () => void;
          sitekey: string;
          theme: "light";
        }
      ) => string;
      reset: (widgetId: string) => void;
    };
  }
}

export function LoginForm({ siteKey }: { siteKey: string }) {
  const router = useRouter();
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!scriptReady || !siteKey || !container.current || !window.turnstile) return;
    const id = window.turnstile.render(container.current, {
      sitekey: siteKey,
      action: "login",
      theme: "light",
      callback: setTurnstileToken,
      "expired-callback": () => setTurnstileToken(""),
      "error-callback": () => setTurnstileToken("")
    });
    widgetId.current = id;
    return () => {
      try {
        window.turnstile?.remove(id);
      } catch {
        // Widget may already be removed during navigation.
      }
    };
  }, [scriptReady, siteKey]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!turnstileToken) {
      setError("Complete security check");
      return;
    }

    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const result = loginResultSchema.parse(
        await api("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({
            email: form.get("email"),
            password: form.get("password"),
            turnstileToken
          })
        })
      );
      const destination =
        result.next === "enroll"
          ? "/auth/mfa/enroll"
          : result.next === "challenge"
            ? "/auth/mfa/challenge"
            : "/dashboard";
      router.replace(destination);
      router.refresh();
    } catch {
      setError(GENERIC_LOGIN_ERROR);
      setTurnstileToken("");
      if (widgetId.current) window.turnstile?.reset(widgetId.current);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="auth-card" aria-labelledby="login-title">
      <div className="auth-heading">
        <p className="eyebrow">Private administration</p>
        <h1 id="login-title">Welcome back</h1>
        <p>Sign in to monitor jobs and Telegram delivery.</p>
      </div>
      <form className="auth-form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            className="input"
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            inputMode="email"
            maxLength={320}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            className="input"
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            maxLength={1024}
            required
          />
        </div>
        <div className="turnstile-wrap">
          <span className="field-label">Security check</span>
          {siteKey ? (
            <div
              ref={container}
              className="cf-turnstile turnstile-slot"
              data-sitekey={siteKey}
              data-action="login"
            />
          ) : (
            <Notice>Security check is not configured.</Notice>
          )}
        </div>
        {error ? <Notice>{error}</Notice> : null}
        <button className="button button-primary auth-submit" type="submit" disabled={busy || !siteKey}>
          {busy ? "Signing in..." : "Sign in"}
        </button>
      </form>
      {siteKey ? (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          strategy="afterInteractive"
          onReady={() => setScriptReady(true)}
          onError={() => setError("Security check unavailable")}
        />
      ) : null}
    </section>
  );
}
