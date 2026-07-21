# Production Checklist

## Platform

- [x] Private Supabase project created and migrations applied.
- [x] Signup/anonymous auth disabled; email login and TOTP enabled.
- [x] Confirmed single admin profile provisioned; local handoff is gitignored and mode `0600`.
- [x] Worker and SQLite Durable Object deployed.
- [x] Worker secrets configured outside source control.
- [x] Vercel monorepo linked, built, and production alias assigned.
- [x] Dynamic Vercel Functions pinned to Singapore (`sin1`) beside Supabase.
- [x] Real managed Turnstile widget created and both production keys installed.

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
- [x] Pre-bot hardening runs persisted `forced_notifications_off=true`; baseline notifications and deliveries remained zero.

## Performance And Quota

- [x] Shared layout auth plus hydration GET waterfall replaced by one server-loaded protected request.
- [x] Admin link prefetch disabled; production idle navigation generated zero speculative admin RSC requests.
- [x] Admin authorization collapsed to one RPC and dashboard reads collapsed to one aggregate RPC.
- [x] Post-authorization 64-entry TTL cache verified for hit, expiry, eviction, invalidation, rejection, request-local misses, and in-flight invalidation.
- [x] Initial dashboard generated zero browser `/api/dashboard` requests on desktop and mobile.
- [x] Dashboard page p50 improved `1319ms -> 52ms`; BFF p50 improved `1644ms -> 116ms`.
- [x] Cold desktop LCP measured `2.02s`, warm LCP `120-880ms`, and simulated mobile 4G LCP `940ms`; CLS remained zero.

## Release

- [x] ESLint, strict TypeScript, Bun tests, Worker build, and Next production build pass.
- [x] Desktop/mobile login and authenticated admin smoke pass with zero browser console errors.
- [x] Real widget render and Cloudflare secret/hostname validation pass; real password, TOTP, AAL2, refresh, and logout production smoke pass.
- [x] Protected direct routes deny unauthenticated requests; authenticated admin routes pass mobile smoke.
- [x] Secret scan, git status/diff review, private GitHub push complete.

Production uses the real managed widget and never uses Cloudflare test keys. Automated Chromium remained challenged by Turnstile as intended; verification did not inject tokens, alter the widget, or bypass the challenge.
