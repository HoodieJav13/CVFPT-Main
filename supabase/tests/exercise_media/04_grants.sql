-- Browser roles get nothing; service_role gets no DELETE; every function is a
-- security-invoker helper with a pinned search_path.
do $$
declare t text; f record; r text;
begin
  foreach t in array array['exercise_media_revisions','exercise_media_assets','exercise_media_current','exercise_media_jobs'] loop
    perform pg_temp.expect((select relrowsecurity from pg_class where oid = ('public.' || t)::regclass), t || ' RLS enabled');
    perform pg_temp.expect(not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t), t || ' has no policies');
    foreach r in array array['anon','authenticated'] loop
      perform pg_temp.expect(not has_table_privilege(r, 'public.' || t, 'SELECT') and not has_table_privilege(r, 'public.' || t, 'INSERT')
        and not has_table_privilege(r, 'public.' || t, 'UPDATE') and not has_table_privilege(r, 'public.' || t, 'DELETE'), r || ' denied on ' || t);
    end loop;
    perform pg_temp.expect(has_table_privilege('service_role', 'public.' || t, 'SELECT') and has_table_privilege('service_role', 'public.' || t, 'UPDATE'), 'service_role reads/updates ' || t);
    perform pg_temp.expect(not has_table_privilege('service_role', 'public.' || t, 'DELETE'), 'service_role cannot delete ' || t);
    perform pg_temp.expect(not has_table_privilege('service_role', 'public.' || t, 'TRUNCATE'), 'service_role cannot truncate ' || t);
  end loop;
  for f in select p.oid, p.proname, p.prosecdef, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'exercise_media_%' loop
    perform pg_temp.expect(not f.prosecdef, f.proname || ' is security invoker');
    perform pg_temp.expect(f.proconfig is not null and 'search_path=""' = any(f.proconfig), f.proname || ' pins search_path');
    perform pg_temp.expect(not has_function_privilege('anon', f.oid, 'EXECUTE') and not has_function_privilege('authenticated', f.oid, 'EXECUTE'), f.proname || ' not executable by browser roles');
    perform pg_temp.expect(has_function_privilege('service_role', f.oid, 'EXECUTE'), f.proname || ' executable by service_role');
  end loop;
  perform pg_temp.expect((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'exercise_media_%') = 25, 'expected helper count');
end $$;

-- service_role itself cannot hard-delete or truncate business rows.
set local role service_role;
do $$
begin
  begin
    delete from public.exercise_media_revisions;
    raise exception 'service_role deleted revisions';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.exercise_media_current;
    raise exception 'service_role deleted pointers';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
