begin;

do $$
declare
  v_coach_id uuid := gen_random_uuid();
  v_client_id uuid := gen_random_uuid();
  v_keep_resource_id uuid := gen_random_uuid();
  v_revoke_resource_id uuid := gen_random_uuid();
  v_keep_active boolean;
  v_revoke_active boolean;
  v_keep_result record;
  v_revoke_result record;
begin
  insert into public.coaches (id, name, email)
  values (v_coach_id, 'Resource Archive Coach', 'resource-archive@example.com');
  insert into public.clients (id, coach_id, name)
  values (v_client_id, v_coach_id, 'Resource Archive Client');
  insert into public.resource_library (
    id, title, storage_path, file_name, uploaded_by_coach_id
  ) values
    (v_keep_resource_id, 'Keep Access', 'keep/test.pdf', 'keep.pdf', v_coach_id),
    (v_revoke_resource_id, 'Revoke Access', 'revoke/test.pdf', 'revoke.pdf', v_coach_id);
  insert into public.resource_assignments (resource_id, client_id, active)
  values
    (v_keep_resource_id, v_client_id, true),
    (v_revoke_resource_id, v_client_id, true);

  select * into v_keep_result
  from public.archive_resource(v_keep_resource_id, false);
  select active into v_keep_active
  from public.resource_assignments
  where resource_id = v_keep_resource_id and client_id = v_client_id;
  if v_keep_active is distinct from true
    or v_keep_result.active_assignments is distinct from 1
    or v_keep_result.revoked_assignments is distinct from 0 then
    raise exception 'Keep-access archive changed the assignment: active %, result %',
      v_keep_active, row_to_json(v_keep_result);
  end if;

  select * into v_revoke_result
  from public.archive_resource(v_revoke_resource_id, true);
  select active into v_revoke_active
  from public.resource_assignments
  where resource_id = v_revoke_resource_id and client_id = v_client_id;
  if v_revoke_active is distinct from false
    or v_revoke_result.active_assignments is distinct from 1
    or v_revoke_result.revoked_assignments is distinct from 1 then
    raise exception 'Revoke-access archive did not deactivate the assignment: active %, result %',
      v_revoke_active, row_to_json(v_revoke_result);
  end if;
end;
$$;

select 'resource archive keep/revoke scenarios passed' as result;

rollback;
