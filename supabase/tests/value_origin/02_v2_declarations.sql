-- v2: declared origins, the server-held prefill snapshot, and the
-- coordinator's changed-prescription rule (keep the previous prefill value
-- and its meaning; never substitute the new prescription).
do $$
declare
  ex constant uuid := '00000000-0000-4000-8000-0000000e0001';
  s1 constant uuid := '00000000-0000-4000-8000-0000000f0001';
  s2 constant uuid := '00000000-0000-4000-8000-0000000f0002';
  s3 constant uuid := '00000000-0000-4000-8000-0000000f0003';
  s4 constant uuid := '00000000-0000-4000-8000-0000000f0004';
  s5 constant uuid := '00000000-0000-4000-8000-0000000f0005';
  qc constant jsonb := '{"status":"completed","actual_load_value":null,"actual_load_unit":null,"actual_reps":null,"actual_rpe":null}';
  undo50 constant jsonb := '{"status":"pending","actual_load_value":50,"actual_load_unit":"lb","actual_reps":null,"actual_rpe":null}';
  r jsonb; v text; n uuid; e text; failed boolean;
begin
  -- Finding 01 on the new schema: an explicit save of the same value is entered.
  r := public.apply_workout_set_event_v2(s1, '00000000-0000-4000-8000-0000000b0001', 'client', null, 0, 1, false, 0,
    '{"actual_load_value":50,"actual_load_unit":"lb"}', 'entered');
  assert r->>'outcome' = 'applied', format('same-value entered %s', r);
  select value_origin, value_origin_nonce into v, n from public.workout_log_sets where id = s1;
  assert v = 'entered' and n = '00000000-0000-4000-8000-0000000b0001', format('entered origin %s nonce %s', v, n);
  select declared_origin into e from public.workout_set_events where id = '00000000-0000-4000-8000-0000000b0001';
  assert e = 'entered', format('event declared origin %s', e);
  assert r->'set'->>'value_origin' = 'entered', 'response row carries origin';

  -- Quick complete of an untouched set captures the prefill snapshot; Undo restores prefill.
  r := public.apply_workout_set_event_v2(s2, '00000000-0000-4000-8000-0000000b0002', 'client', null, 0, 2, false, 0, qc, 'entered');
  assert r->>'outcome' = 'applied', format('qc %s', r);
  assert (select prefill_load_value = 50 and prefill_load_unit = 'lb' and value_origin = 'entered' from public.workout_log_sets where id = s2), 'snapshot captured';
  r := public.apply_workout_set_event_v2(s2, '00000000-0000-4000-8000-0000000b0003', 'client', null, 1, 3, false, 0, undo50, 'prefill');
  assert r->>'outcome' = 'applied', format('undo %s', r);
  select value_origin into v from public.workout_log_sets where id = s2;
  assert v = 'prefill', format('restored origin %s', v);
  assert r->'set'->>'value_origin' = 'prefill', 'undo response origin';
  -- The replay of that Undo changes nothing and reports the stored row.
  r := public.apply_workout_set_event_v2(s2, '00000000-0000-4000-8000-0000000b0003', 'client', null, 1, 3, false, 0, undo50, 'prefill');
  assert r->>'outcome' = 'replayed' and r->'set'->>'value_origin' = 'prefill', format('replay %s', r);

  -- Changed prescription while completed: Undo keeps the previous 50 lb as prefill.
  r := public.apply_workout_set_event_v2(s3, '00000000-0000-4000-8000-0000000b0004', 'client', null, 0, 4, false, 0, qc, 'entered');
  update public.workout_log_exercises set prescribed_load_value = 60, plan_revision = plan_revision + 1 where id = ex;
  update public.workout_log_sets set actual_load_value = 60, actual_load_unit = 'lb', value_origin = 'prefill', value_origin_nonce = gen_random_uuid(), updated_at = now()
  where workout_log_exercise_id = ex and status = 'pending' and not archived
    and (value_origin = 'prefill' or (value_origin = 'legacy' and revision = 0 and last_actor_role is null));
  assert (select status = 'completed' and actual_load_value is null from public.workout_log_sets where id = s3), 'completed set not propagated';
  r := public.apply_workout_set_event_v2(s3, '00000000-0000-4000-8000-0000000b0005', 'client', null, 1, 5, false, 1, undo50, 'prefill');
  assert (select value_origin = 'prefill' and actual_load_value = 50 from public.workout_log_sets where id = s3), format('changed prescription undo %s', r->'set');

  -- A prefill claim that does not match the snapshot is applied but unknown.
  r := public.apply_workout_set_event_v2(s4, '00000000-0000-4000-8000-0000000b0006', 'client', null, 0, 6, false, 1, qc, 'entered');
  r := public.apply_workout_set_event_v2(s4, '00000000-0000-4000-8000-0000000b0007', 'client', null, 1, 7, false, 1,
    '{"status":"pending","actual_load_value":55,"actual_load_unit":"lb"}', 'prefill');
  assert r->>'outcome' = 'applied', format('mismatch applied %s', r);
  assert (select value_origin = 'unknown' and actual_load_value = 55 from public.workout_log_sets where id = s4), 'mismatch unknown, value kept';
  -- A prefill claim with performed reps is unknown.
  r := public.apply_workout_set_event_v2(s4, '00000000-0000-4000-8000-0000000b0008', 'client', null, 2, 8, false, 1,
    '{"status":"pending","actual_load_value":50,"actual_load_unit":"lb","actual_reps":5}', 'prefill');
  assert (select value_origin = 'unknown' and actual_reps = 5 from public.workout_log_sets where id = s4), 'prefill with reps is unknown';

  -- Missing snapshot (the set was not untouched when completed): unknown.
  r := public.apply_workout_set_event(s5, '00000000-0000-4000-8000-0000000b0009', 'client', null, 0, 9, false, 1, '{"actual_load_value":50,"actual_load_unit":"lb"}');
  r := public.apply_workout_set_event_v2(s5, '00000000-0000-4000-8000-0000000b000a', 'client', null, 1, 10, false, 1, qc, 'entered');
  assert (select prefill_load_value is null from public.workout_log_sets where id = s5), 'no snapshot from a non-untouched row';
  r := public.apply_workout_set_event_v2(s5, '00000000-0000-4000-8000-0000000b000b', 'client', null, 2, 11, false, 1, undo50, 'prefill');
  assert (select value_origin = 'unknown' and actual_load_value = 50 from public.workout_log_sets where id = s5), 'missing snapshot unknown';

  -- A conflict leaves the row (and its origin) untouched.
  r := public.apply_workout_set_event_v2(s2, '00000000-0000-4000-8000-0000000b000c', 'coach', '00000000-0000-4000-8000-000000000001', 0, null, false, 1,
    '{"actual_load_value":70,"actual_load_unit":"lb"}', 'entered');
  assert r->>'outcome' = 'conflict', format('stale coach write %s', r);
  -- (s2 is the restored prefill, moved to 60 by the propagation above.)
  assert (select value_origin = 'prefill' and actual_load_value = 60 from public.workout_log_sets where id = s2), 'conflict kept origin';

  -- Invalid declarations are refused.
  failed := false;
  begin
    perform public.apply_workout_set_event_v2(s1, '00000000-0000-4000-8000-0000000b000d', 'client', null, 1, 12, false, 1, '{}', 'unknown');
  exception when others then failed := true;
  end;
  assert failed, 'unknown is not declarable';
end $$;
