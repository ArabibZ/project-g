begin;

select plan(45);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc as proc
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = proc.pronamespace
    where namespace.nspname = 'public'
      and (
        pg_catalog.has_function_privilege('anon', proc.oid, 'execute')
        or pg_catalog.has_function_privilege('authenticated', proc.oid, 'execute')
      )
  ),
  'public functions are not executable by API user roles'
);

select ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.complete_source_scrape(uuid,text,uuid,timestamp with time zone,jsonb)',
    'execute'
  ),
  'service role can execute worker RPCs'
);

select ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.authorize_admin_session(uuid,uuid)',
    'execute'
  ),
  'service role can authorize live admin sessions'
);

select ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.get_dashboard(date)',
    'execute'
  ),
  'service role can load dashboard snapshot'
);

select ok(
  pg_catalog.has_table_privilege('authenticated', 'public.profiles', 'select')
    and not pg_catalog.has_table_privilege('anon', 'public.profiles', 'select')
    and not pg_catalog.has_table_privilege('authenticated', 'public.jobs', 'select')
    and not exists (
      select 1
      from pg_catalog.pg_class as seq
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = seq.relnamespace
      where namespace.nspname = 'public'
        and seq.relkind = 'S'
        and (
          pg_catalog.has_sequence_privilege('anon', seq.oid, 'usage')
          or pg_catalog.has_sequence_privilege('authenticated', seq.oid, 'usage')
        )
    ),
  'only authenticated profile reads have a direct API grant'
);

select ok(
  pg_catalog.has_table_privilege('service_role', 'public.jobs', 'select')
    and not pg_catalog.has_table_privilege('service_role', 'public.jobs', 'insert')
    and not pg_catalog.has_table_privilege('service_role', 'public.jobs', 'update')
    and not pg_catalog.has_table_privilege('service_role', 'public.jobs', 'delete')
    and not pg_catalog.has_table_privilege('service_role', 'public.jobs', 'truncate'),
  'service role can read but cannot directly mutate jobs'
);

insert into auth.users (
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at
) values (
  '40000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'migration-test@example.invalid',
  '',
  now(),
  now(),
  now()
);

insert into public.profiles(id, role)
values ('40000000-0000-4000-8000-000000000001', 'admin');

insert into auth.sessions(id, user_id, created_at, updated_at, not_after)
values (
  '41000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  now(),
  now(),
  now() + interval '1 hour'
);

select ok(
  (
    select session_active
      and is_admin
      and email = 'migration-test@example.invalid'
    from public.authorize_admin_session(
      '40000000-0000-4000-8000-000000000001',
      '41000000-0000-4000-8000-000000000001'
    )
  ),
  'matching live session returns active admin and email'
);

select ok(
  (
    select count(*) = 1
      and not pg_catalog.bool_or(session_active)
    from public.authorize_admin_session(
      '40000000-0000-4000-8000-000000000001',
      '41000000-0000-4000-8000-000000000002'
    )
  ),
  'session mismatch returns exactly one inactive row'
);

set local request.jwt.claims = '{"sub":"40000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}';
set local role authenticated;
select is(
  (select count(*) from public.profiles),
  0::bigint,
  'AAL1 cannot read admin profile'
);
reset role;

set local request.jwt.claims = '{"sub":"40000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}';
set local role authenticated;
select is(
  (select count(*) from public.profiles),
  1::bigint,
  'AAL2 admin can read own profile'
);
reset role;

set local request.jwt.claims = '{"sub":"40000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}';
set local role authenticated;
select is(
  (select count(*) from public.profiles),
  0::bigint,
  'AAL2 cannot read another profile'
);
reset role;

update public.telegram_bot_settings
set
  connected = true,
  bot_id = 123456789,
  encrypted_token = 'ciphertext',
  token_iv = 'iv',
  encrypted_webhook_secret = 'secret-ciphertext',
  webhook_secret_iv = 'secret-iv',
  notifications_enabled = true
where singleton;

insert into public.telegram_subscribers (
  id,
  bot_id,
  chat_id,
  status,
  approved_at
) values (
  '20000000-0000-4000-8000-000000000001',
  123456789,
  987654321,
  'active',
  now()
);

insert into public.telegram_subscribers (
  id,
  bot_id,
  chat_id,
  status,
  disabled_by_admin,
  approved_at
) values
  (
    '20000000-0000-4000-8000-000000000002',
    123456789,
    987654322,
    'pending',
    false,
    null
  ),
  (
    '20000000-0000-4000-8000-000000000003',
    123456789,
    987654323,
    'off',
    true,
    now()
  );

insert into public.sources (
  id,
  url,
  normalized_url,
  enabled,
  position
) values (
  '10000000-0000-4000-8000-000000000001',
  'https://bot.gigclickers.com/test/',
  'https://bot.gigclickers.com/test/',
  true,
  100
);

insert into public.scrape_runs(id, run_key, status, sources_total)
values (
  '30000000-0000-4000-8000-000000000001',
  'test:baseline',
  'running',
  1
);

select is(
  (
    select count(*)
    from public.complete_source_scrape(
      '10000000-0000-4000-8000-000000000001',
      'https://bot.gigclickers.com/test/',
      '30000000-0000-4000-8000-000000000001',
      '2026-07-20T00:00:00Z',
      '[{"jobId":"9001","name":"Baseline job","doneCount":1,"totalTarget":2,"payment":"$1.00","detailsUrl":"https://bot.gigclickers.com/tasks/9001/details/"}]'::jsonb
    )
  ),
  1::bigint,
  'first source scrape inserts one job'
);

select ok(
  (select baseline_completed from public.sources where id = '10000000-0000-4000-8000-000000000001'),
  'first valid scrape completes baseline'
);

select ok(
  (select is_baseline from public.jobs where job_id = '9001'),
  'first scrape job is marked baseline'
);

select is(
  (select count(*) from public.notification_deliveries where job_id = '9001'),
  0::bigint,
  'baseline job queues no notification'
);

select is(
  (select valid_jobs_seen from public.scrape_runs where id = '30000000-0000-4000-8000-000000000001'),
  1,
  'baseline run records valid jobs'
);

select is(
  (select new_jobs_saved from public.scrape_runs where id = '30000000-0000-4000-8000-000000000001'),
  0,
  'baseline run excludes jobs from new-job count'
);

select is(
  (
    select count(*)
    from public.complete_source_scrape(
      '10000000-0000-4000-8000-000000000001',
      'https://bot.gigclickers.com/test/',
      '30000000-0000-4000-8000-000000000001',
      '2026-07-20T00:00:00Z',
      '[{"jobId":"9001","name":"Baseline job","doneCount":1,"totalTarget":2,"payment":"$1.00","detailsUrl":"https://bot.gigclickers.com/tasks/9001/details/"}]'::jsonb
    )
  ),
  0::bigint,
  'repeating completed source RPC is a no-op'
);

select is(
  (select sources_completed from public.scrape_runs where id = '30000000-0000-4000-8000-000000000001'),
  1,
  'idempotent retry does not increment run twice'
);

insert into public.scrape_runs(id, run_key, status, sources_total)
values (
  '30000000-0000-4000-8000-000000000002',
  'test:live',
  'running',
  1
);

select is(
  (
    select count(*)
    from public.complete_source_scrape(
      '10000000-0000-4000-8000-000000000001',
      'https://bot.gigclickers.com/test/',
      '30000000-0000-4000-8000-000000000002',
      '2026-07-20T01:00:00Z',
      '[{"jobId":"9002","name":"Live job","doneCount":0,"totalTarget":3,"payment":"$2.00","detailsUrl":"https://bot.gigclickers.com/tasks/9002/details/"}]'::jsonb
    )
  ),
  1::bigint,
  'post-baseline scrape inserts new job'
);

select ok(
  not (select is_baseline from public.jobs where job_id = '9002'),
  'post-baseline job is not marked baseline'
);

select is(
  (select count(*) from public.notification_deliveries where job_id = '9002'),
  1::bigint,
  'new job queues one delivery for active subscriber'
);

select is(
  (select new_jobs_saved from public.scrape_runs where id = '30000000-0000-4000-8000-000000000002'),
  1,
  'live run counts inserted job'
);

select ok(
  (
    select dashboard.today_jobs = 1
      and dashboard.total_sources = 1
      and dashboard.active_sources = 1
      and dashboard.scheduler_status = 'paused'
      and dashboard.bot_users_total = 3
      and dashboard.bot_users_on = 1
      and dashboard.bot_users_off = 1
      and dashboard.bot_users_pending = 1
      and pg_catalog.jsonb_array_length(dashboard.latest_jobs) = 2
      and dashboard.latest_jobs->0->>'job_id' = '9002'
      and dashboard.latest_jobs->1->>'job_id' = '9001'
    from public.get_dashboard('2026-07-20') as dashboard
  ),
  'dashboard returns one consistent aggregate with ordered jobs'
);

select is(
  (
    select count(*)
    from public.complete_source_scrape(
      '10000000-0000-4000-8000-000000000001',
      'https://bot.gigclickers.com/test/',
      '30000000-0000-4000-8000-000000000002',
      '2026-07-20T01:00:00Z',
      '[{"jobId":"9002","name":"Live job","doneCount":0,"totalTarget":3,"payment":"$2.00","detailsUrl":"https://bot.gigclickers.com/tasks/9002/details/"}]'::jsonb
    )
  ),
  0::bigint,
  'live completion retry is a no-op'
);

select is(
  (select count(*) from public.notification_deliveries where job_id = '9002'),
  1::bigint,
  'completion retry cannot duplicate delivery'
);

select ok(
  (
    select status = 'pending'
      and attempts = 0
      and next_attempt_at is not null
      and lease_until is null
    from public.notification_deliveries
    where job_id = '9002'
  ),
  'new delivery starts in retryable pending state'
);

select throws_ok(
  $$
    insert into public.notification_deliveries(job_id, subscriber_id, chat_id, next_attempt_at)
    values ('9002', '20000000-0000-4000-8000-000000000001', 987654321, now())
  $$,
  '23505',
  'duplicate key value violates unique constraint "notification_deliveries_job_id_chat_id_key"',
  'job and chat delivery is deduplicated'
);

select throws_ok(
  $$
    insert into public.notification_deliveries(job_id, subscriber_id, chat_id)
    values ('9001', '20000000-0000-4000-8000-000000000001', 987654321)
  $$,
  '23514',
  'new row for relation "notification_deliveries" violates check constraint "notification_deliveries_state_check"',
  'invalid retry state is rejected'
);

insert into public.sources (
  id,
  url,
  normalized_url,
  enabled,
  position
) values (
  '10000000-0000-4000-8000-000000000002',
  'https://bot.gigclickers.com/changed/',
  'https://bot.gigclickers.com/changed/',
  true,
  101
);

insert into public.scrape_runs(id, run_key, status, sources_total)
values (
  '30000000-0000-4000-8000-000000000003',
  'test:changed-source',
  'running',
  1
);

select throws_ok(
  $$
    select *
    from public.complete_source_scrape(
      '10000000-0000-4000-8000-000000000002',
      'https://bot.gigclickers.com/changed/',
      '30000000-0000-4000-8000-000000000003',
      '2026-07-20T02:00:00Z',
      '[]'::jsonb
    )
  $$,
  'P0001',
  'jobs must be a non-empty JSON array',
  'empty scrape cannot complete source baseline'
);

select is(
  (
    select count(*)
    from public.complete_source_scrape(
      '10000000-0000-4000-8000-000000000002',
      'https://bot.gigclickers.com/old/',
      '30000000-0000-4000-8000-000000000003',
      '2026-07-20T02:00:00Z',
      '[{"jobId":"9010","name":"Stale source job","doneCount":0,"totalTarget":1,"payment":"$3.00","detailsUrl":"https://bot.gigclickers.com/tasks/9010/details/"}]'::jsonb
    )
  ),
  0::bigint,
  'stale source snapshot inserts no job'
);

select is(
  (
    select status
    from public.scrape_run_sources
    where run_id = '30000000-0000-4000-8000-000000000003'
      and source_id = '10000000-0000-4000-8000-000000000002'
  ),
  'failed',
  'stale source snapshot closes run source as failed'
);

select ok(
  not (select baseline_completed from public.sources where id = '10000000-0000-4000-8000-000000000002'),
  'stale scrape cannot complete replacement source baseline'
);

select is(
  (select count(*) from public.jobs where job_id = '9010'),
  0::bigint,
  'stale source provenance is not saved'
);

insert into public.sources (
  id,
  url,
  normalized_url,
  enabled,
  position
) values (
  '10000000-0000-4000-8000-000000000003',
  'https://bot.gigclickers.com/removed/',
  'https://bot.gigclickers.com/removed/',
  true,
  102
);

insert into public.scrape_runs(id, run_key, status, sources_total)
values (
  '30000000-0000-4000-8000-000000000004',
  'test:removed-source',
  'running',
  1
);

delete from public.sources where id = '10000000-0000-4000-8000-000000000003';

select is(
  (
    select count(*)
    from public.complete_source_scrape(
      '10000000-0000-4000-8000-000000000003',
      'https://bot.gigclickers.com/removed/',
      '30000000-0000-4000-8000-000000000004',
      '2026-07-20T03:00:00Z',
      null::jsonb
    )
  ),
  0::bigint,
  'removed source completion inserts no job'
);

select ok(
  (
    select error = 'Source removed during scrape'
    from public.scrape_run_sources
    where run_id = '30000000-0000-4000-8000-000000000004'
      and source_id = '10000000-0000-4000-8000-000000000003'
  ) and (
    select sources_completed = 1
    from public.scrape_runs
    where id = '30000000-0000-4000-8000-000000000004'
  ),
  'removed source closes run and increments completion once'
);

select is(
  (select count(*) from public.jobs where job_id = '9020'),
  0::bigint,
  'removed source provenance is not saved'
);

delete from public.sources where id = '10000000-0000-4000-8000-000000000001';

select is(
  (select count(*) from public.jobs where source_id = '10000000-0000-4000-8000-000000000001'),
  2::bigint,
  'source deletion preserves historical jobs'
);

select is(
  (select source_url from public.jobs where job_id = '9001'),
  'https://bot.gigclickers.com/test/',
  'historical job preserves source URL snapshot'
);

select throws_ok(
  $$update public.jobs set name = 'changed' where job_id = '9001'$$,
  'P0001',
  'jobs are immutable',
  'job update is rejected'
);

select throws_ok(
  $$delete from public.jobs where job_id = '9001'$$,
  'P0001',
  'jobs are immutable',
  'job delete is rejected'
);

select throws_ok(
  $$truncate public.notification_deliveries, public.jobs$$,
  'P0001',
  'jobs are immutable',
  'job truncate is rejected'
);

do $$
begin
  perform * from public.record_login_event('ip-a', 'account-a', 'browser-a', 'key-a', false, 'credentials');
  perform * from public.record_login_event('ip-b', 'account-a', 'browser-b', 'key-b', false, 'credentials');
end;
$$;

select ok(
  (
    select suspicious
    from public.record_login_event(
      'ip-c',
      'account-a',
      'browser-c',
      'key-c',
      false,
      'credentials'
    )
  ),
  'third distinct account origin is marked suspicious'
);

do $$
begin
  for attempt in 1..5 loop
    perform * from public.record_login_event(
      'ip-limit',
      'account-limit',
      pg_catalog.format('browser-%s', attempt),
      'key-limit',
      false,
      'credentials'
    );
  end loop;
end;
$$;

create temporary table login_limit_result on commit drop as
select *
from public.record_login_event(
  'ip-limit',
  'account-limit',
  'browser-6',
  'key-limit',
  false,
  'credentials'
);

select is(
  (select failure_count from login_limit_result),
  6,
  'sixth IP-account failure reaches threshold despite browser rotation'
);

select ok(
  (select cooldown_until > now() from login_limit_result),
  'sixth origin failure creates active cooldown'
);

select * from finish();
rollback;
