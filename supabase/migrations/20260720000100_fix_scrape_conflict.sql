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

revoke all on function public.complete_source_scrape(uuid, text, uuid, timestamptz, jsonb)
from public, anon, authenticated;
grant execute on function public.complete_source_scrape(uuid, text, uuid, timestamptz, jsonb)
to service_role;
