-- Trigger ordering and immutability: the guard never hides an immutability or
-- metrics failure, a finished log's set keeps its origin on a late write, and a
-- coach resolution (undeclared writer) leaves the set unknown.
do $$
declare
  done_set constant uuid := '00000000-0000-4000-8000-0000000f0101';
  s1 constant uuid := '00000000-0000-4000-8000-0000000f0001';
  coach constant uuid := '00000000-0000-4000-8000-000000000001';
  r jsonb; v text; msg text; failed boolean;
begin
  select trigger_name into v from information_schema.triggers
  where event_object_table = 'workout_log_sets' and trigger_name = 'set_value_origin_guard' limit 1;
  assert v is not null, 'guard trigger present';
  assert (select array_agg(tgname::text order by tgname) from pg_trigger where tgrelid = 'public.workout_log_sets'::regclass and not tgisinternal)
    -- look_a_require_live_exercise (20261114170000) refuses a set under an
    -- archived exercise; it sorts before the guard, which still fires last.
    = array['check_workout_set_metrics', 'look_a_require_live_exercise', 'prevent_completed_workout_set_change', 'set_value_origin_guard'], 'trigger set and name order';

  failed := false;
  begin
    update public.workout_log_sets set actual_load_value = 70, updated_at = now() where id = done_set;
  exception when others then failed := true; msg := sqlerrm;
  end;
  assert failed and msg = 'Completed workout logs are immutable', format('immutability %s', msg);

  r := public.apply_workout_set_event_v2(done_set, '00000000-0000-4000-8000-0000000d0001', 'client', null, 0, 1, false, 0,
    '{"actual_load_value":70,"actual_load_unit":"lb"}', 'entered');
  assert r->>'outcome' = 'conflict', format('late write %s', r);
  assert (select value_origin = 'legacy' and actual_load_value = 50 from public.workout_log_sets where id = done_set), 'late write kept origin';
  select declared_origin into v from public.workout_set_events where id = '00000000-0000-4000-8000-0000000d0001';
  assert v = 'entered', 'conflict event keeps declared intent';

  r := public.resolve_workout_set_conflict((r->>'conflict_id')::uuid, '00000000-0000-4000-8000-0000000d0002', 'incoming', null, coach);
  assert r->>'outcome' = 'resolved', format('resolution %s', r);
  assert (select value_origin = 'unknown' and actual_load_value = 70 from public.workout_log_sets where id = done_set), 'resolution unknown';

  -- Metrics trigger still refuses a mismatched metric through v2.
  failed := false;
  begin
    perform public.apply_workout_set_event_v2(s1, '00000000-0000-4000-8000-0000000d0003', 'client', null, 0, 2, false, 0,
      '{"actual_duration_value":30,"actual_duration_unit":"s"}', 'entered');
  exception when others then failed := true; msg := sqlerrm;
  end;
  assert failed and msg like 'Performed metrics do not match%', format('metrics %s', msg);
  assert (select value_origin = 'legacy' and revision = 0 from public.workout_log_sets where id = s1), 'refused write left no trace';
end $$;
