-- v1 keeps its exact 9-argument signature (named call) and service-only grants;
-- v2 and the guard function are service-only too.
do $$
declare
  s1 constant uuid := '00000000-0000-4000-8000-0000000f0001';
  r jsonb; role_name text;
begin
  r := public.apply_workout_set_event(p_set_id => s1, p_event_id => '00000000-0000-4000-8000-0000000e1001', p_actor_role => 'client',
    p_actor_coach_id => null, p_base_revision => 0, p_local_seq => 1, p_offline => false, p_plan_revision_seen => 0,
    p_payload => '{"actual_reps":5}'::jsonb);
  assert r->>'outcome' = 'applied', format('named v1 %s', r);
  assert (select count(*) from pg_proc where proname = 'apply_workout_set_event' and pronamespace = 'public'::regnamespace) = 1, 'one v1 overload';
  foreach role_name in array array['anon', 'authenticated', 'public'] loop
    if role_name <> 'public' then
      assert not has_function_privilege(role_name, 'public.apply_workout_set_event_v2(uuid, uuid, text, uuid, integer, integer, boolean, integer, jsonb, text)', 'execute'), format('%s v2', role_name);
      assert not has_function_privilege(role_name, 'public.apply_workout_set_event(uuid, uuid, text, uuid, integer, integer, boolean, integer, jsonb)', 'execute'), format('%s v1', role_name);
      assert not has_function_privilege(role_name, 'public.set_value_origin_guard()', 'execute'), format('%s guard', role_name);
    end if;
  end loop;
  assert has_function_privilege('service_role', 'public.apply_workout_set_event_v2(uuid, uuid, text, uuid, integer, integer, boolean, integer, jsonb, text)', 'execute'), 'service v2';
  assert has_function_privilege('service_role', 'public.apply_workout_set_event(uuid, uuid, text, uuid, integer, integer, boolean, integer, jsonb)', 'execute'), 'service v1';
end $$;
