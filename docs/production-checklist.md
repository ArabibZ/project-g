# Production Checklist

## Platform

- [x] Private Supabase project created and migrations applied.
- [x] Signup/anonymous auth disabled; email login and TOTP enabled.
- [x] Confirmed single admin profile provisioned; local handoff is gitignored and mode `0600`.
- [x] Worker and SQLite Durable Object deployed.
- [x] Worker secrets configured outside source control.
- [x] Vercel monorepo linked, built, and production alias assigned.
- [ ] Real managed Turnstile widget created and both production keys installed.

## Security

- [x] API denies missing internal secret.
- [x] Admin API denies missing/invalid bearer and requires AAL2.
- [x] Login fails closed when Turnstile cannot verify.
- [x] CORS returns exact production origin only.
- [x] Browser bundle receives no Supabase or service credentials.
- [x] Security headers, no-store API responses, generic login error, hidden recovery route verified.
- [x] Remote Supabase signup denial verified.
- [x] Remote database lint reports no schema errors.
- [x] Static Telegram webhook rejects missing/wrong secrets before database access; legacy secret-bearing path is absent.
- [x] Logout revokes the live AAL2 session immediately; the old access token returns `401`.
- [x] Refresh rotation accepts production Supabase tokens and unsafe return destinations fall back to `/dashboard`.

## Data And Scheduler

- [x] Seed source exists, enabled, and ordered first.
- [x] Scheduler uses persistent alarms and starts paused.
- [x] First real scheduled cycle stored 211 baseline jobs with zero deliveries.
- [x] Later real cycle saw the same 211 IDs and saved zero duplicates.
- [x] Scheduler left armed with next random run persisted.
- [x] Post-hardening runs persist `forced_notifications_off=true`; Telegram remains disconnected and deliveries remain zero.

## Release

- [x] ESLint, strict TypeScript, Bun tests, Worker build, and Next production build pass.
- [x] Desktop/mobile login and authenticated admin smoke pass with zero browser console errors.
- [ ] Real Turnstile login, TOTP challenge, and logout smoke pass.
- [x] Protected direct routes deny unauthenticated requests; authenticated admin routes pass mobile smoke.
- [x] Secret scan, git status/diff review, private GitHub push complete.

Turnstile remains the only external-access prerequisite. Never use Cloudflare test keys in production and never weaken login while it is unavailable.
