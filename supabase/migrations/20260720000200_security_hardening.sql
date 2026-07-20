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

revoke all on function public.is_auth_session_active(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.is_auth_session_active(uuid, uuid)
to service_role;

notify pgrst, 'reload schema';
