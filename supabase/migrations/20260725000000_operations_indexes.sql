create index if not exists notification_deliveries_created_idx
  on public.notification_deliveries (created_at desc);

create index if not exists login_attempts_created_idx
  on public.login_attempts (created_at desc);
