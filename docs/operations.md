# Operations

## Scraper

Only HTTPS URLs on exact host `bot.gigclickers.com` are accepted. Credentials, custom ports, fragments, redirects outside that host, challenge bypasses, and malformed cards are rejected.

The parser reads server-rendered task links matching `/tasks/{numeric-id}/details`, requires name/payment/progress, ignores the compact responsive duplicate, and rejects the full source check if structure becomes unsafe. Tests use `test/fixtures/gigclickers-task-cards.html`; do not repeatedly fetch production in tests.

One Durable Object named `scheduler-v1` owns scheduling. It persists pause state, batch cursor, lock, and next alarm. A cycle snapshots enabled sources in saved order and processes at most one source per alarm invocation. Source failure does not stop later sources. Delay after a complete batch is cryptographically sampled from 240 through 420 seconds.

- Pause finishes the current source, then stops.
- Resume starts a fresh random wait.
- No enabled sources causes durable `No active sources` pause and alarm cancellation.
- Enabling a source never resumes a paused scheduler.
- Reordering affects the next complete cycle.
- Three consecutive failures expose an error while retrying continues.

## Baseline

Before first production resume, keep Telegram disconnected or master notifications Off. The first successful scrape per source stores all valid jobs with `is_baseline=true`; Today count and Telegram delivery both exclude them. Verify a second cycle does not create duplicate jobs.

## Telegram

Connect validates the token with Telegram, encrypts token and webhook secret using AES-GCM, installs the secret webhook, and verifies webhook health. A new bot starts with master Job Notifications Off.

Private `/start` requests create Pending subscribers and reply exactly `Request received. Waiting for admin approval.` Admin approval enables future-only alerts. Repeated `/start` never reverses an admin disable. Blocked/unavailable chats are turned Off and are not retried.

Each genuine new job creates at most one delivery per chat. Temporary known failures retry at most three times without another scrape. Ambiguous network outcomes are not retried, preferring a rare missed alert over a duplicate successful alert. Telegram HTML is escaped before sending.

## Recovery

No forgot-password link is public. Start recovery only from Supabase Dashboard for the admin email. Redirect target must be exact production `/auth/recovery`. After password replacement, all sessions are signed out.

## Read Cache And Quota

Every protected read performs fresh JWT, AAL2, live-session, and admin authorization. Only the resulting non-secret data payload can be cached.

- Dashboard and sources: 5 seconds.
- Bot and subscribers: 10 seconds.
- Job history: 15 seconds.
- Maximum: 64 entries per Worker isolate.
- Successful mutations and Telegram webhook handling clear that isolate's cache.

The cache is intentionally memory-only and best-effort. Another isolate or scheduler alarm can leave a read stale only until its short TTL expires. Never extend this cache to authorization, sessions, tokens, secrets, login, MFA, recovery, or mutation responses. External API responses stay `no-store`.

Vercel Functions must remain in `sin1` through `apps/web/vercel.json`. Protected pages server-load once; admin links keep `prefetch={false}`. Reintroducing client mount GETs or admin link prefetch increases Vercel, Worker, and Supabase usage.

## Incident Checks

1. Check Worker health and structured logs; logs must not contain tokens, cookies, source HTML, or secrets.
2. Inspect `scraper_state`, latest `scrape_runs`, and `scrape_errors` before changing scheduler state.
3. Leave the scheduler paused if source structure changed; update parser plus fixture/tests first.
4. Rotate compromised Worker secrets in Cloudflare and matching Vercel server env where applicable.
5. Rotate Telegram token through the UI; same-bot rotation preserves subscribers, different bot archives them.
6. If reads slow down, confirm Vercel functions still report `sin1`, then compare direct Worker latency before changing cache TTLs.
