# Database Migrations

## Apply

Always identify the target Project G ref explicitly. Never run linked commands until `supabase/.temp/project-ref` is verified.

```bash
supabase link --project-ref <project-ref>
supabase db push --linked --include-all --yes
supabase config push --project-ref <project-ref> --yes
supabase db lint --linked --level warning
```

Current migrations:

- `20260720000000_initial.sql`: tables, indexes, immutable job guards, RLS/grants, scraper/auth/Telegram RPCs, and seed source.
- `20260720000100_fix_scrape_conflict.sql`: production-safe qualification for the scrape-run idempotency constraint.
- `20260720000200_security_hardening.sql`: live auth-session revocation check with service-role-only access.
- `20260721000000_admin_read_optimization.sql`: combined admin authorization and aggregate dashboard RPCs.
- `20260721000100_dashboard_query_optimization.sql`: keeps the dashboard's Dhaka-day count on the indexed job subset as history grows.

Applied migrations are append-only. Add a new timestamped migration for every production change; do not rewrite production history.

## Local Verification

The pgTAP suite runs inside a transaction and rolls back its fixtures.

```bash
supabase start
supabase db reset --local --no-seed
supabase db lint --local --level warning
supabase test db --local supabase/tests/database.test.sql
```

Tests cover grants, RLS/AAL2 isolation, optimized admin authorization/dashboard RPCs, immutable permanent job IDs, baseline behavior, source-race handling, notification dedupe/state, and login cooldown behavior.

## Invariants

- `jobs.job_id` is global, permanent, and immutable.
- Source deletion never deletes historical jobs.
- First successful source scrape is baseline and queues zero notifications.
- Browser roles cannot read operational tables directly.
- Worker RPCs execute only as `service_role`; the key remains Worker-only.
- Login cooldown applies to IP plus normalized account, not a globally locked account.
- `authorize_admin_session` and `get_dashboard` are callable only by `service_role`; browser roles cannot bypass live authorization or read aggregates directly.
