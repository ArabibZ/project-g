create extension if not exists pgcrypto with schema extensions;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role = 'admin'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index profiles_single_admin_idx on public.profiles(role);

create table public.sources (
  id uuid primary key default extensions.gen_random_uuid(),
  url text not null,
  normalized_url text not null unique,
  enabled boolean not null default false,
  position integer not null check (position >= 0),
  baseline_completed boolean not null default false,
  last_checked_at timestamptz,
  last_failed_at timestamptz,
  failure_count integer not null default 0 check (failure_count >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index sources_position_idx on public.sources(position, created_at);

insert into public.sources(url, normalized_url, enabled, position)
select 'https://bot.gigclickers.com/', 'https://bot.gigclickers.com/', true, 1
where not exists (select 1 from public.sources);

create table public.jobs (
  job_id text primary key check (job_id ~ '^[0-9]+$'),
  name text not null check (char_length(name) between 1 and 500),
  done_count integer not null check (done_count >= 0),
  total_target integer not null check (total_target > 0 and done_count <= total_target),
  payment text not null check (payment ~ '^\$[0-9]+(\.[0-9]+)?$'),
  details_url text not null,
  -- Keep the source snapshot even if its configurable source row is later removed.
  source_id uuid not null,
  source_url text not null,
  first_seen_at timestamptz not null,
  dhaka_day date not null,
  is_baseline boolean not null,
  created_at timestamptz not null default now()
);

create index jobs_history_idx on public.jobs(first_seen_at desc, job_id desc);
create index jobs_today_idx on public.jobs(dhaka_day, is_baseline, first_seen_at desc);
create index jobs_source_idx on public.jobs(source_id, first_seen_at desc);

create table public.scraper_settings (
  singleton boolean primary key default true check (singleton),
  min_delay_seconds integer not null default 240 check (min_delay_seconds >= 60),
  max_delay_seconds integer not null default 420 check (max_delay_seconds >= min_delay_seconds),
  updated_at timestamptz not null default now()
);

insert into public.scraper_settings(singleton) values (true);

create table public.scraper_state (
  singleton boolean primary key default true check (singleton),
  status text not null default 'paused' check (
    status in ('waiting', 'checking', 'pausing', 'paused', 'no_active_sources', 'error')
  ),
  pause_requested boolean not null default true,
  pause_reason text,
  current_source_id uuid,
  current_source_position integer,
  queued_source_count integer not null default 0 check (queued_source_count >= 0),
  last_check_at timestamptz,
  next_run_at timestamptz,
  active_run_id uuid,
  updated_at timestamptz not null default now()
);

insert into public.scraper_state(singleton, pause_reason)
values (true, 'Initial setup');

create table public.scrape_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  run_key text not null unique,
  status text not null check (status in ('running', 'succeeded', 'partial', 'failed')),
  forced_notifications_off boolean not null default false,
  sources_total integer not null default 0 check (sources_total >= 0),
  sources_completed integer not null default 0 check (sources_completed >= 0),
  valid_jobs_seen integer not null default 0 check (valid_jobs_seen >= 0),
  new_jobs_saved integer not null default 0 check (new_jobs_saved >= 0),
  notifications_sent integer not null default 0 check (notifications_sent >= 0),
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index scrape_runs_started_idx on public.scrape_runs(started_at desc);

create table public.scrape_errors (
  id bigint generated always as identity primary key,
  run_id uuid references public.scrape_runs(id) on delete set null,
  source_id uuid,
  category text not null,
  message text not null,
  created_at timestamptz not null default now()
);

create index scrape_errors_created_idx on public.scrape_errors(created_at desc);

create table public.scrape_run_sources (
  run_id uuid not null references public.scrape_runs(id) on delete cascade,
  source_id uuid not null,
  status text not null check (status in ('succeeded', 'failed')),
  valid_jobs_seen integer not null default 0 check (valid_jobs_seen >= 0),
  new_jobs_saved integer not null default 0 check (new_jobs_saved >= 0),
  error text,
  completed_at timestamptz not null default now(),
  primary key (run_id, source_id)
);

create index scrape_run_sources_source_idx
  on public.scrape_run_sources(source_id, completed_at desc);

create table public.telegram_bot_settings (
  singleton boolean primary key default true check (singleton),
  connected boolean not null default false,
  bot_id bigint,
  username text,
  display_name text,
  avatar_url text,
  encrypted_token text,
  token_iv text,
  encrypted_webhook_secret text,
  webhook_secret_iv text,
  notifications_enabled boolean not null default false,
  connected_at timestamptz,
  updated_at timestamptz not null default now(),
  check (
    (not connected and bot_id is null and encrypted_token is null and token_iv is null) or
    (connected and bot_id is not null and encrypted_token is not null and token_iv is not null
      and encrypted_webhook_secret is not null and webhook_secret_iv is not null)
  )
);

insert into public.telegram_bot_settings(singleton) values (true);

create table public.telegram_subscribers (
  id uuid primary key default extensions.gen_random_uuid(),
  bot_id bigint not null,
  chat_id bigint not null,
  telegram_user_id bigint,
  first_name text,
  last_name text,
  username text,
  status text not null default 'pending' check (
    status in ('pending', 'active', 'off', 'unavailable', 'blocked')
  ),
  disabled_by_admin boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  approved_at timestamptz,
  archived_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (bot_id, chat_id)
);

create index telegram_subscribers_current_idx
  on public.telegram_subscribers(bot_id, archived_at, status, first_seen_at desc);

create table public.notification_deliveries (
  id uuid primary key default extensions.gen_random_uuid(),
  job_id text not null references public.jobs(job_id),
  subscriber_id uuid not null references public.telegram_subscribers(id),
  chat_id bigint not null,
  status text not null default 'pending' check (
    status in ('pending', 'sending', 'sent', 'skipped', 'failed')
  ),
  attempts integer not null default 0 check (attempts between 0 and 3),
  next_attempt_at timestamptz,
  lease_until timestamptz,
  telegram_message_id bigint,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (job_id, chat_id),
  constraint notification_deliveries_state_check check (
    (
      status = 'pending'
      and attempts < 3
      and next_attempt_at is not null
      and lease_until is null
      and telegram_message_id is null
      and sent_at is null
    ) or (
      status = 'sending'
      and attempts > 0
      and next_attempt_at is null
      and lease_until is not null
      and telegram_message_id is null
      and sent_at is null
    ) or (
      status = 'sent'
      and attempts > 0
      and next_attempt_at is null
      and lease_until is null
      and telegram_message_id is not null
      and sent_at is not null
    ) or (
      status = 'skipped'
      and next_attempt_at is null
      and lease_until is null
      and telegram_message_id is null
      and sent_at is null
    ) or (
      status = 'failed'
      and attempts > 0
      and next_attempt_at is null
      and lease_until is null
      and telegram_message_id is null
      and sent_at is null
    )
  )
);

create index notification_deliveries_due_idx
  on public.notification_deliveries(status, next_attempt_at)
  where status in ('pending', 'sending');
create index notification_deliveries_lease_idx
  on public.notification_deliveries(lease_until)
  where status = 'sending';

create table public.login_attempts (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  account_hash text not null,
  browser_hash text not null,
  successful boolean not null,
  suspicious boolean not null default false,
  failure_reason text,
  created_at timestamptz not null default now()
);

create index login_attempts_lookup_idx
  on public.login_attempts(ip_hash, account_hash, created_at desc);
create index login_attempts_account_idx
  on public.login_attempts(account_hash, created_at desc);

create table public.login_cooldowns (
  key_hash text primary key,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index login_cooldowns_expiry_idx on public.login_cooldowns(expires_at);

create table public.api_rate_limits (
  key_hash text primary key,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count >= 0),
  updated_at timestamptz not null default now()
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_created_idx on public.audit_log(created_at desc);

create or replace function public.record_login_event(
  p_ip_hash text,
  p_account_hash text,
  p_browser_hash text,
  p_key_hash text,
  p_successful boolean,
  p_failure_reason text default null
)
returns table (
  failure_count integer,
  cooldown_until timestamptz,
  suspicious boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt_id bigint;
  v_failures integer := 0;
  v_distinct_origins integer := 0;
  v_cooldown timestamptz;
begin
  perform pg_catalog.pg_advisory_xact_lock(1, pg_catalog.hashtext(p_key_hash));
  perform pg_catalog.pg_advisory_xact_lock(2, pg_catalog.hashtext(p_account_hash));

  if p_successful then
    insert into public.login_attempts(
      ip_hash, account_hash, browser_hash, successful
    ) values (
      p_ip_hash, p_account_hash, p_browser_hash, true
    );
    delete from public.login_cooldowns where key_hash = p_key_hash;
    return query select 0, null::timestamptz, false;
    return;
  end if;

  insert into public.login_attempts(
    ip_hash, account_hash, browser_hash, successful, failure_reason
  ) values (
    p_ip_hash, p_account_hash, p_browser_hash, false, left(p_failure_reason, 120)
  ) returning id into v_attempt_id;

  select count(*)::integer
  into v_failures
  from public.login_attempts
  where ip_hash = p_ip_hash
    and account_hash = p_account_hash
    and not successful
    and created_at >= now() - interval '15 minutes';

  select count(distinct (ip_hash || ':' || browser_hash))::integer
  into v_distinct_origins
  from public.login_attempts
  where account_hash = p_account_hash
    and not successful
    and created_at >= now() - interval '15 minutes';

  if v_distinct_origins >= 3 then
    update public.login_attempts set suspicious = true where id = v_attempt_id;
  end if;

  if v_failures >= 6 then
    v_cooldown := now() + interval '15 minutes';
    insert into public.login_cooldowns(key_hash, expires_at)
    values (p_key_hash, v_cooldown)
    on conflict (key_hash) do update set expires_at = greatest(login_cooldowns.expires_at, excluded.expires_at);
  end if;

  return query select v_failures, v_cooldown, v_distinct_origins >= 3;
end;
$$;

create or replace function public.consume_rate_limit(
  p_key_hash text,
  p_window_seconds integer,
  p_limit integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_started_at timestamptz;
begin
  if p_window_seconds < 1 or p_limit < 1 then
    raise exception 'invalid rate limit';
  end if;

  insert into public.api_rate_limits(key_hash, window_started_at, request_count)
  values (p_key_hash, now(), 1)
  on conflict (key_hash) do update
  set
    window_started_at = case
      when api_rate_limits.window_started_at + make_interval(secs => p_window_seconds) <= now()
        then now()
      else api_rate_limits.window_started_at
    end,
    request_count = case
      when api_rate_limits.window_started_at + make_interval(secs => p_window_seconds) <= now()
        then 1
      else api_rate_limits.request_count + 1
    end,
    updated_at = now()
  returning request_count, window_started_at into v_count, v_started_at;

  return v_count <= p_limit
    and v_started_at + make_interval(secs => p_window_seconds) > now();
end;
$$;

create or replace function public.reject_job_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'jobs are immutable';
end;
$$;

create trigger jobs_are_immutable
before update or delete on public.jobs
for each row execute function public.reject_job_mutation();

create trigger jobs_cannot_be_truncated
before truncate on public.jobs
for each statement execute function public.reject_job_mutation();

create or replace function public.complete_source_scrape(
  p_source_id uuid,
  p_source_url text,
  p_run_id uuid,
  p_observed_at timestamptz,
  p_jobs jsonb
)
returns table (
  job_id text,
  name text,
  done_count integer,
  total_target integer,
  payment text,
  details_url text,
  source_id uuid,
  source_url text,
  first_seen_at timestamptz,
  is_baseline boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_baseline boolean;
  v_source_enabled boolean;
  v_source_url text;
  v_skip_reason text;
  v_inserted_count integer;
  v_valid_count integer;
begin
  select not s.baseline_completed, s.enabled, s.url
  into v_is_baseline, v_source_enabled, v_source_url
  from public.sources as s
  where s.id = p_source_id
  for update;

  if not found then
    v_skip_reason := 'Source removed during scrape';
  elsif not v_source_enabled then
    v_skip_reason := 'Source disabled during scrape';
  elsif v_source_url is distinct from p_source_url then
    v_skip_reason := 'Source URL changed during scrape';
  end if;

  if exists (
    select 1
    from public.scrape_run_sources as completed
    where completed.run_id = p_run_id
      and completed.source_id = p_source_id
  ) then
    return;
  end if;

  if v_skip_reason is not null then
    insert into public.scrape_run_sources(run_id, source_id, status, error)
    values (p_run_id, p_source_id, 'failed', v_skip_reason)
    on conflict on constraint scrape_run_sources_pkey do nothing;

    get diagnostics v_inserted_count = row_count;
    if v_inserted_count > 0 then
      update public.scrape_runs
      set sources_completed = sources_completed + 1
      where id = p_run_id;
    end if;
    return;
  end if;

  if p_jobs is null or jsonb_typeof(p_jobs) is distinct from 'array' then
    raise exception 'jobs must be a non-empty JSON array';
  end if;
  v_valid_count := jsonb_array_length(p_jobs);
  if v_valid_count = 0 then
    raise exception 'jobs must be a non-empty JSON array';
  end if;

  perform 1
  from public.telegram_bot_settings
  where singleton
  for share;

  perform 1
  from public.telegram_subscribers as subscriber
  join public.telegram_bot_settings as bot
    on bot.singleton
    and bot.connected
    and bot.notifications_enabled
    and subscriber.bot_id = bot.bot_id
  where subscriber.archived_at is null
    and subscriber.status = 'active'
    and not subscriber.disabled_by_admin
  for share of subscriber;

  return query
  with inserted_jobs as (
    insert into public.jobs (
      job_id,
      name,
      done_count,
      total_target,
      payment,
      details_url,
      source_id,
      source_url,
      first_seen_at,
      dhaka_day,
      is_baseline
    )
    select
      item->>'jobId',
      item->>'name',
      (item->>'doneCount')::integer,
      (item->>'totalTarget')::integer,
      item->>'payment',
      item->>'detailsUrl',
      p_source_id,
      p_source_url,
      p_observed_at,
      (p_observed_at at time zone 'Asia/Dhaka')::date,
      v_is_baseline
    from jsonb_array_elements(p_jobs) as item
    on conflict on constraint jobs_pkey do nothing
    returning jobs.*
  ), queued_deliveries as (
    insert into public.notification_deliveries (
      job_id,
      subscriber_id,
      chat_id,
      next_attempt_at
    )
    select
      inserted.job_id,
      subscriber.id,
      subscriber.chat_id,
      now()
    from inserted_jobs as inserted
    join public.telegram_bot_settings as bot
      on bot.singleton
      and bot.connected
      and bot.notifications_enabled
    join public.telegram_subscribers as subscriber
      on subscriber.bot_id = bot.bot_id
      and subscriber.archived_at is null
      and subscriber.status = 'active'
      and not subscriber.disabled_by_admin
    where not v_is_baseline
    on conflict on constraint notification_deliveries_job_id_chat_id_key do nothing
    returning notification_deliveries.job_id
  )
  select
    inserted.job_id,
    inserted.name,
    inserted.done_count,
    inserted.total_target,
    inserted.payment,
    inserted.details_url,
    inserted.source_id,
    inserted.source_url,
    inserted.first_seen_at,
    inserted.is_baseline
  from inserted_jobs as inserted;

  get diagnostics v_inserted_count = row_count;

  insert into public.scrape_run_sources (
    run_id,
    source_id,
    status,
    valid_jobs_seen,
    new_jobs_saved
  ) values (
    p_run_id,
    p_source_id,
    'succeeded',
    v_valid_count,
    case when v_is_baseline then 0 else v_inserted_count end
  );

  update public.sources
  set
    baseline_completed = true,
    last_checked_at = p_observed_at,
    failure_count = 0,
    last_error = null,
    updated_at = now()
  where id = p_source_id;

  update public.scrape_runs
  set
    sources_completed = sources_completed + 1,
    valid_jobs_seen = valid_jobs_seen + v_valid_count,
    new_jobs_saved = new_jobs_saved + case when v_is_baseline then 0 else v_inserted_count end
  where id = p_run_id;
end;
$$;

create or replace function public.fail_source_scrape(
  p_source_id uuid,
  p_run_id uuid,
  p_category text,
  p_message text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_failure_count integer;
begin
  select source.failure_count
  into v_failure_count
  from public.sources as source
  where source.id = p_source_id
  for update;

  if not found then
    raise exception 'source not found';
  end if;

  if exists (
    select 1
    from public.scrape_run_sources as completed
    where completed.run_id = p_run_id
      and completed.source_id = p_source_id
  ) then
    return v_failure_count;
  end if;

  insert into public.scrape_run_sources(run_id, source_id, status, error)
  values (p_run_id, p_source_id, 'failed', left(p_message, 1000));

  update public.sources
  set
    failure_count = failure_count + 1,
    last_failed_at = now(),
    last_error = left(p_message, 1000),
    updated_at = now()
  where id = p_source_id
  returning failure_count into v_failure_count;

  insert into public.scrape_errors(run_id, source_id, category, message)
  values (p_run_id, p_source_id, left(p_category, 100), left(p_message, 1000));

  update public.scrape_runs
  set sources_completed = sources_completed + 1
  where id = p_run_id;

  return v_failure_count;
end;
$$;

create or replace function public.configure_telegram_bot(
  p_bot_id bigint,
  p_username text,
  p_display_name text,
  p_avatar_url text,
  p_encrypted_token text,
  p_token_iv text,
  p_encrypted_webhook_secret text,
  p_webhook_secret_iv text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_was_connected boolean;
  v_previous_bot_id bigint;
begin
  if p_bot_id <= 0 then
    raise exception 'invalid bot ID';
  end if;

  select setting.connected, setting.bot_id
  into v_was_connected, v_previous_bot_id
  from public.telegram_bot_settings as setting
  where setting.singleton
  for update;

  update public.notification_deliveries as delivery
  set
    status = 'skipped',
    next_attempt_at = null,
    lease_until = null,
    last_error = 'Bot changed',
    updated_at = now()
  where delivery.status = 'pending'
    and exists (
      select 1
      from public.telegram_subscribers as subscriber
      where subscriber.id = delivery.subscriber_id
        and subscriber.bot_id <> p_bot_id
    );

  update public.telegram_subscribers
  set
    status = 'off',
    archived_at = coalesce(archived_at, now()),
    updated_at = now()
  where bot_id <> p_bot_id
    and archived_at is null;

  update public.telegram_bot_settings
  set
    connected = true,
    bot_id = p_bot_id,
    username = p_username,
    display_name = p_display_name,
    avatar_url = p_avatar_url,
    encrypted_token = p_encrypted_token,
    token_iv = p_token_iv,
    encrypted_webhook_secret = p_encrypted_webhook_secret,
    webhook_secret_iv = p_webhook_secret_iv,
    notifications_enabled = case
      when v_was_connected and v_previous_bot_id = p_bot_id then notifications_enabled
      else false
    end,
    connected_at = case
      when v_was_connected and v_previous_bot_id = p_bot_id then connected_at
      else now()
    end,
    updated_at = now()
  where singleton;
end;
$$;

create or replace function public.disconnect_telegram_bot()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1
  from public.telegram_bot_settings
  where singleton
  for update;

  update public.notification_deliveries
  set
    status = 'skipped',
    next_attempt_at = null,
    lease_until = null,
    last_error = 'Bot disconnected',
    updated_at = now()
  where status = 'pending';

  update public.telegram_bot_settings
  set
    connected = false,
    bot_id = null,
    username = null,
    display_name = null,
    avatar_url = null,
    encrypted_token = null,
    token_iv = null,
    encrypted_webhook_secret = null,
    webhook_secret_iv = null,
    notifications_enabled = false,
    connected_at = null,
    updated_at = now()
  where singleton;
end;
$$;

create or replace function public.set_telegram_master_notifications(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1
  from public.telegram_bot_settings
  where singleton
  for update;

  if p_enabled and not exists (
    select 1
    from public.telegram_bot_settings
    where singleton and connected
  ) then
    raise exception 'Telegram bot is not connected';
  end if;

  update public.telegram_bot_settings
  set notifications_enabled = p_enabled, updated_at = now()
  where singleton;

  if not p_enabled then
    update public.notification_deliveries
    set
      status = 'skipped',
      next_attempt_at = null,
      lease_until = null,
      last_error = 'Notifications disabled',
      updated_at = now()
    where status = 'pending';
  end if;
end;
$$;

create or replace function public.reorder_sources(p_source_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer;
begin
  select count(*) into v_total from public.sources;

  if cardinality(p_source_ids) <> v_total
    or (select count(distinct item.id) from unnest(p_source_ids) as item(id)) <> v_total
    or exists (
      select 1 from unnest(p_source_ids) as item(id)
      where not exists (select 1 from public.sources where sources.id = item.id)
    )
  then
    raise exception 'source order must include every source exactly once';
  end if;

  update public.sources as source
  set
    position = ordered.position,
    updated_at = now()
  from unnest(p_source_ids) with ordinality as ordered(id, position)
  where source.id = ordered.id;
end;
$$;

create or replace function public.list_jobs(
  p_query text default null,
  p_cursor_time timestamptz default null,
  p_cursor_job_id text default null,
  p_limit integer default 26
)
returns table (
  job_id text,
  name text,
  done_count integer,
  total_target integer,
  payment text,
  details_url text,
  source_url text,
  first_seen_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit < 1 or p_limit > 100 then
    raise exception 'invalid job page limit';
  end if;
  if (p_cursor_time is null) <> (p_cursor_job_id is null) then
    raise exception 'incomplete job cursor';
  end if;

  return query
  select
    job.job_id,
    job.name,
    job.done_count,
    job.total_target,
    job.payment,
    job.details_url,
    job.source_url,
    job.first_seen_at
  from public.jobs as job
  where (
      nullif(btrim(p_query), '') is null
      or position(lower(btrim(p_query)) in lower(job.job_id)) > 0
      or position(lower(btrim(p_query)) in lower(job.name)) > 0
    )
    and (
      p_cursor_time is null
      or (job.first_seen_at, job.job_id) < (p_cursor_time, p_cursor_job_id)
    )
  order by job.first_seen_at desc, job.job_id desc
  limit p_limit;
end;
$$;

create or replace function public.is_auth_session_active(
  p_user_id uuid,
  p_session_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.sessions as session
    where session.id = p_session_id
      and session.user_id = p_user_id
  );
$$;

revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function public.complete_source_scrape(uuid, text, uuid, timestamptz, jsonb) to service_role;
grant execute on function public.fail_source_scrape(uuid, uuid, text, text) to service_role;
grant execute on function public.configure_telegram_bot(bigint, text, text, text, text, text, text, text) to service_role;
grant execute on function public.disconnect_telegram_bot() to service_role;
grant execute on function public.set_telegram_master_notifications(boolean) to service_role;
grant execute on function public.reorder_sources(uuid[]) to service_role;
grant execute on function public.record_login_event(text, text, text, text, boolean, text) to service_role;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;
grant execute on function public.list_jobs(text, timestamptz, text, integer) to service_role;
grant execute on function public.is_auth_session_active(uuid, uuid) to service_role;

alter table public.profiles enable row level security;
alter table public.sources enable row level security;
alter table public.jobs enable row level security;
alter table public.scraper_settings enable row level security;
alter table public.scraper_state enable row level security;
alter table public.scrape_runs enable row level security;
alter table public.scrape_errors enable row level security;
alter table public.scrape_run_sources enable row level security;
alter table public.telegram_bot_settings enable row level security;
alter table public.telegram_subscribers enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.login_attempts enable row level security;
alter table public.login_cooldowns enable row level security;
alter table public.api_rate_limits enable row level security;
alter table public.audit_log enable row level security;

create policy "Admin reads own profile at AAL2"
on public.profiles
for select
to authenticated
using (
  id = (select auth.uid())
  and role = 'admin'
  and (select auth.jwt()->>'aal') = 'aal2'
);

revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
grant select on public.profiles to authenticated;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
revoke insert, update, delete, truncate on public.jobs from service_role;

alter default privileges in schema public revoke all on tables from public, anon, authenticated;
alter default privileges in schema public revoke all on sequences from public, anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;

notify pgrst, 'reload schema';
