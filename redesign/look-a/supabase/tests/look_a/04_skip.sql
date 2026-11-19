-- Skip the rest of an exercise: exact pending set list and revisions or refused.
do $$
declare
  log constant uuid := '00000000-0000-4000-8000-0000000000a1';
  press constant uuid := '00000000-0000-4000-8000-0000000a0004';
  r jsonb; u jsonb; before jsonb;
begin
  select jsonb_agg(to_jsonb(s) order by s.id) into before from public.workout_log_sets s where workout_log_exercise_id = press;
  r := public.skip_workout_exercise_sets(log, press, '00000000-0000-4000-8000-0000000f1001', 'client', null,
    '[{"id":"00000000-0000-4000-8000-0000000b0031","revision":0}]');
  assert r->>'outcome' = 'refused' and r->>'reason' like 'These sets changed%', format('partial list refused %s', r);
  r := public.skip_workout_exercise_sets(log, press, '00000000-0000-4000-8000-0000000f1002', 'client', null,
    '[{"id":"00000000-0000-4000-8000-0000000b0031","revision":0},{"id":"00000000-0000-4000-8000-0000000b0032","revision":3}]');
  assert r->>'outcome' = 'refused', format('stale revision refused %s', r);
  assert (select jsonb_agg(to_jsonb(s) order by s.id) from public.workout_log_sets s where workout_log_exercise_id = press) = before, 'refusals wrote nothing';
  r := public.skip_workout_exercise_sets(log, press, '00000000-0000-4000-8000-0000000f1003', 'client', null,
    '[{"id":"00000000-0000-4000-8000-0000000b0031","revision":0},{"id":"00000000-0000-4000-8000-0000000b0032","revision":0}]');
  assert r->>'outcome' = 'applied' and (r->>'skipped')::integer = 2, format('skip %s', r);
  assert (select bool_and(status = 'skipped' and actual_load_value = 40 and actual_load_unit = 'kg' and value_origin = 'legacy')
          from public.workout_log_sets where workout_log_exercise_id = press), 'values, kg and origin kept';
  u := public.undo_workout_material_change(log, '00000000-0000-4000-8000-0000000f1003', '00000000-0000-4000-8000-0000000f1004', 'client', null);
  assert u->>'outcome' = 'applied', format('undo skip %s', u);
  assert (select jsonb_agg(to_jsonb(s) - array['updated_at','revision','value_origin_nonce','last_event_id','last_actor_role','material_seq'] order by s.id)
          from public.workout_log_sets s where workout_log_exercise_id = press)
       = (select jsonb_agg(x - array['updated_at','revision','value_origin_nonce','last_event_id','last_actor_role','material_seq'] order by x->>'id') from jsonb_array_elements(before) x),
       'restored to the exact material state';
  -- The counters moved forward twice (skip, then Undo): never back.
  assert (select bool_and(material_seq = 2) from public.workout_log_sets where workout_log_exercise_id = press), 'material counters only grow';
end $$;
