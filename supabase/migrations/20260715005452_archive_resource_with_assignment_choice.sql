-- Archive a resource and optionally revoke its active assignments as one
-- transaction. Express validates coach authorization and supplies the explicit
-- access decision; this RPC prevents a half-applied archive/revoke operation.

create or replace function public.archive_resource(
  p_resource_id uuid,
  p_revoke_assigned_access boolean
)
returns table (
  resource_id uuid,
  active_assignments integer,
  revoked_assignments integer
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_active_assignments integer;
  v_revoked_assignments integer := 0;
begin
  if p_revoke_assigned_access is null then
    raise exception 'Choose whether to keep or revoke assigned client access';
  end if;

  perform 1
  from public.resource_library
  where id = p_resource_id
    and archived = false
  for update;

  if not found then
    raise exception 'Resource not found';
  end if;

  select count(*)::integer
  into v_active_assignments
  from public.resource_assignments as assignment
  where assignment.resource_id = p_resource_id
    and assignment.active = true;

  if p_revoke_assigned_access then
    update public.resource_assignments as assignment
    set active = false
    where assignment.resource_id = p_resource_id
      and assignment.active = true;
    get diagnostics v_revoked_assignments = row_count;
  end if;

  update public.resource_library
  set archived = true
  where id = p_resource_id;

  return query select p_resource_id, v_active_assignments, v_revoked_assignments;
end;
$$;

revoke execute on function public.archive_resource(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.archive_resource(uuid, boolean) to service_role;
