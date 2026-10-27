-- Service-only, SECURITY INVOKER, fixed empty search_path; no browser roles.
do $$
declare f text; p record;
begin
  foreach f in array array['public.decide_workout_substitution(uuid,uuid,text,uuid,uuid)', 'public.apply_program_substitution(uuid,uuid,uuid,uuid,uuid[],jsonb)'] loop
    assert not has_function_privilege('anon', f, 'execute'), f || ' anon';
    assert not has_function_privilege('authenticated', f, 'execute'), f || ' authenticated';
    assert has_function_privilege('service_role', f, 'execute'), f || ' service_role';
    select prosecdef, proconfig, proacl into p from pg_proc where oid = f::regprocedure;
    assert not p.prosecdef, f || ' must be SECURITY INVOKER';
    assert p.proconfig = array['search_path=""'], format('%s search_path %s', f, p.proconfig);
    assert not exists (select 1 from unnest(p.proacl) acl where acl::text like '=%'), f || ' PUBLIC execute';
  end loop;
  -- No RLS or policy change on the swap tables.
  assert (select relrowsecurity from pg_class where oid = 'public.workout_log_substitutions'::regclass), 'RLS stays on';
  assert not exists (select 1 from pg_policies where tablename in ('workout_log_substitutions', 'program_substitution_applications')), 'no policies';
end $$;
