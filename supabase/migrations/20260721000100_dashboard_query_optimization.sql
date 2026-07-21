create or replace function public.get_dashboard(p_dhaka_day date)
returns table (
  today_jobs bigint,
  total_sources bigint,
  active_sources bigint,
  scheduler_status text,
  last_check_at timestamptz,
  next_run_at timestamptz,
  bot_users_total bigint,
  bot_users_on bigint,
  bot_users_off bigint,
  bot_users_pending bigint,
  latest_jobs jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with job_totals as (
    select count(*) as today_jobs
    from public.jobs as job
    where job.dhaka_day = p_dhaka_day
      and not job.is_baseline
  ), source_totals as (
    select
      count(*) as total_sources,
      count(*) filter (where source.enabled) as active_sources
    from public.sources as source
  ), scheduler_snapshot as (
    select
      pg_catalog.max(state.status) filter (where state.singleton) as scheduler_status,
      pg_catalog.max(state.last_check_at) filter (where state.singleton) as last_check_at,
      pg_catalog.max(state.next_run_at) filter (where state.singleton) as next_run_at
    from public.scraper_state as state
  ), subscriber_totals as (
    select
      count(subscriber.id) as bot_users_total,
      count(subscriber.id) filter (
        where subscriber.status = 'active'
          and not subscriber.disabled_by_admin
      ) as bot_users_on,
      count(subscriber.id) filter (
        where subscriber.status = 'pending'
      ) as bot_users_pending
    from public.telegram_bot_settings as bot
    left join public.telegram_subscribers as subscriber
      on bot.connected
      and subscriber.bot_id = bot.bot_id
      and subscriber.archived_at is null
    where bot.singleton
  ), latest as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'job_id', job.job_id,
          'name', job.name,
          'done_count', job.done_count,
          'total_target', job.total_target,
          'payment', job.payment,
          'details_url', job.details_url,
          'source_url', job.source_url,
          'first_seen_at', job.first_seen_at
        ) order by job.first_seen_at desc, job.job_id desc
      ),
      '[]'::jsonb
    ) as latest_jobs
    from (
      select
        stored_job.job_id,
        stored_job.name,
        stored_job.done_count,
        stored_job.total_target,
        stored_job.payment,
        stored_job.details_url,
        stored_job.source_url,
        stored_job.first_seen_at
      from public.jobs as stored_job
      order by stored_job.first_seen_at desc, stored_job.job_id desc
      limit 10
    ) as job
  )
  select
    job_totals.today_jobs,
    source_totals.total_sources,
    source_totals.active_sources,
    scheduler_snapshot.scheduler_status,
    scheduler_snapshot.last_check_at,
    scheduler_snapshot.next_run_at,
    subscriber_totals.bot_users_total,
    subscriber_totals.bot_users_on,
    subscriber_totals.bot_users_total
      - subscriber_totals.bot_users_on
      - subscriber_totals.bot_users_pending,
    subscriber_totals.bot_users_pending,
    latest.latest_jobs
  from job_totals
  cross join source_totals
  cross join scheduler_snapshot
  cross join subscriber_totals
  cross join latest;
$$;

revoke all on function public.get_dashboard(date)
from public, anon, authenticated;
grant execute on function public.get_dashboard(date)
to service_role;

notify pgrst, 'reload schema';
