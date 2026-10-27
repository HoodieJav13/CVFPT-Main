\set ON_ERROR_STOP on
do $$
declare
  fn text;
  who text;
begin
  foreach fn in array array[
    'public.find_session_conflict(uuid,uuid,timestamptz,integer,uuid)',
    'public.check_session_slots(uuid,uuid,integer,jsonb,jsonb)',
    'public.schedule_session_series(uuid,text,uuid,uuid,integer,text,jsonb,uuid,boolean,jsonb)'
  ] loop
    foreach who in array array['anon', 'authenticated'] loop
      if has_function_privilege(who, fn, 'execute') then raise exception '% must not execute %', who, fn; end if;
    end loop;
    if not has_function_privilege('service_role', fn, 'execute') then raise exception 'service_role must execute %', fn; end if;
  end loop;

  if not (select relrowsecurity from pg_class where oid = 'public.session_series'::regclass) then
    raise exception 'RLS must be enabled on session_series';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'session_series') then
    raise exception 'session_series must have no RLS policies (service-role-only)';
  end if;
  foreach who in array array['anon', 'authenticated'] loop
    if has_table_privilege(who, 'public.session_series', 'select') then raise exception '% must not read session_series', who; end if;
  end loop;
  if not has_table_privilege('service_role', 'public.session_series', 'insert') then
    raise exception 'service_role must write session_series';
  end if;
end;
$$;

select 'grants and RLS tests passed' as result;
