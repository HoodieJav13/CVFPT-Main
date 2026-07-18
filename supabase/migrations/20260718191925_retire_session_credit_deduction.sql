-- Session completion is independent from the retired in-app credit system.
-- Preserve the existing response keys for caller compatibility without
-- reading or mutating credit balances.
create or replace function public.complete_session(p_session_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session public.sessions%rowtype;
begin
  select * into v_session
  from public.sessions
  where id = p_session_id and archived = false
  for update;

  if not found or v_session.status <> 'scheduled' then
    return null;
  end if;

  update public.sessions
  set status = 'completed', credit_deducted = false, updated_at = now()
  where id = v_session.id
  returning * into v_session;

  return jsonb_build_object(
    'session', to_jsonb(v_session),
    'credit_deducted', false,
    'credits_remaining', null
  );
end;
$$;

revoke execute on function public.complete_session(uuid) from public, anon, authenticated;
grant execute on function public.complete_session(uuid) to service_role;
