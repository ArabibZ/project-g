# Project G

Single-admin dashboard for monitoring GigClickers jobs and delivering approved Telegram notifications. The application is private; its source repository is public.

## Production

- Web: <https://project-g-ten-rouge.vercel.app>
- API health: <https://project-g-api.arabibz.workers.dev/health>
- Worker: `project-g-api`
- Vercel project: `project-g`
- Supabase project: `project-g` (`dmnzsknqynysqpapilwu`)
- Turnstile widget: `project-g-login` (managed, production hostname only)
- GitHub: `ArabibZ/project-g` (public)

## Architecture

- `apps/web`: Next.js App Router UI and same-origin BFF on Vercel.
- `apps/worker`: Hono API, auth enforcement, scraper, Telegram integration, and one SQLite Durable Object alarm coordinator.
- `packages/shared`: strict shared validation, types, time, URL, and escaping utilities.
- `supabase`: PostgreSQL schema, RLS, immutable job history, idempotent RPCs, and pgTAP tests.
- `test`: one saved source fixture and focused Bun tests.

Browser receives no Supabase key or session token. The BFF keeps sessions in `Secure`, `HttpOnly`, `SameSite=Lax` cookies and authenticates to the Worker with a server-only shared secret. Worker verifies Supabase JWT claims, live user session, admin profile, and `aal2` for every admin endpoint. Login additionally requires server-verified Turnstile. Public signup and anonymous auth are disabled.

## Performance And Quota

- Vercel Functions run in `sin1`, next to the Singapore Supabase project. Static assets remain globally cached.
- Protected pages load their authenticated DTO once in a Server Component. They do not repeat the same GET after hydration.
- Admin navigation prefetch is disabled so idle links do not consume Vercel or Worker requests.
- Worker authorization uses one service-role RPC after local JWT verification. Dashboard data uses one aggregate RPC instead of six to nine REST reads.
- A bounded, isolate-local cache stores only successful non-secret read DTOs after full live authorization. Limits: 64 entries; dashboard/sources 5 seconds, bot/subscribers/operations 10 seconds, jobs 15 seconds. Writes invalidate the local cache.
- Auth, AAL2, session revocation, admin role, tokens, and secrets are never cached. API responses remain `no-store`.

Measured production dashboard p50 improved from `1319ms` to `52ms`; BFF p50 improved from `1644ms` to `116ms`. A cold desktop browser run reached LCP in `2.02s`, warm runs in `120-880ms`, and simulated mobile 4G in `940ms`. Initial dashboard Worker calls dropped from two to one; warm Supabase subrequests dropped from about 12 to two on a payload miss or one on an isolate cache hit.

## Development

Requirements: Bun 1.3.14+, Node.js 24+, Supabase CLI, Wrangler 4+, and Vercel CLI.

```bash
bun install
cp .env.example .env.local
bun run dev:worker
bun run dev:web
```

Use local-only credentials in ignored env files. Never place service-role, Worker internal, encryption, HMAC, Telegram, or Turnstile secrets in browser-prefixed variables.

Run all checks:

```bash
bun run check
supabase db lint --local --level warning
supabase test db --local supabase/tests/database.test.sql
```

## Deployment

1. Create/link an isolated Supabase project and apply `supabase/migrations` in order.
2. Push `supabase/config.toml`; confirm global signup is disabled and email login plus TOTP remain enabled.
3. Set Worker public vars in `apps/worker/wrangler.jsonc` and all required secrets with `wrangler secret bulk` or `wrangler secret put`.
4. Deploy `apps/worker`; verify `/health`, internal-secret denial, AAL2 denial, and strict CORS.
5. Create a real managed Turnstile widget for the production hostname. Store its secret in Worker and its site key in Vercel.
6. Set Vercel `WORKER_API_URL`, `INTERNAL_API_SECRET`, and `NEXT_PUBLIC_TURNSTILE_SITE_KEY`; keep `apps/web/vercel.json` pinned to `sin1`; deploy production.
7. Keep Telegram notifications Off, resume scheduler, and verify the first scheduled scrape becomes the no-notification baseline.
8. Verify a later cycle dedupes existing IDs, then enable Telegram only after bot/subscriber approval.

Detailed procedures: [`docs/migrations.md`](docs/migrations.md), [`docs/operations.md`](docs/operations.md), and [`docs/production-checklist.md`](docs/production-checklist.md).

## Admin Handoff

Temporary credentials and TOTP bootstrap material exist only at `.private/admin-handoff.json` with user-only permissions. This path is gitignored. On first use, import the TOTP URI, replace the temporary email with a real recovery email, and replace the temporary password.
