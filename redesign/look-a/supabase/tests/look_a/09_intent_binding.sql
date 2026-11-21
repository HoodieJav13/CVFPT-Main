-- Residual case 1 (LOOK-A-INTEGRATION-REVIEW.md): a set event is bound to what
-- it asked for (set, actor, plan, origin, values), not to the base revision
-- it happened to be rebuilt on. Two tabs that rebuild the same queued write
-- on different revisions both get "replayed"; different values stay refused.
do $$
declare
  s3 constant uuid := '00000000-0000-4000-8000-0000000b0003';
  a constant uuid := '00000000-0000-4000-8000-0000000c9001';
  b constant uuid := '00000000-0000-4000-8000-0000000c9002';
  r jsonb; failed boolean; msg text;
begin
  -- A applied at base 0 (its reply lost); both tabs hold [A, B(base 0)].
  r := public.apply_workout_set_event_v3(s3, a, 'client', null, 0, 1, false, 0, '{"actual_reps":7}', 'entered');
  assert r->>'outcome' = 'applied', format('A %s', r);
  -- Tab 1 replays A, rebuilds B on revision 1 and delivers it first.
  r := public.apply_workout_set_event_v3(s3, b, 'client', null, 1, 2, false, 0, '{"actual_reps":9}', 'entered');
  assert r->>'outcome' = 'applied', format('B base 1 %s', r);
  -- Tab 2 rebuilds B on revision 2: the same intent replays.
  r := public.apply_workout_set_event_v3(s3, b, 'client', null, 2, 2, false, 0, '{"actual_reps":9}', 'entered');
  assert r->>'outcome' = 'replayed', format('B base 2 replays %s', r);
  -- And the pre-rebuild original (base 0) too.
  r := public.apply_workout_set_event_v3(s3, b, 'client', null, 0, 2, false, 0, '{"actual_reps":9}', 'entered');
  assert r->>'outcome' = 'replayed', format('B base 0 replays %s', r);
  assert (select actual_reps from public.workout_log_sets where id = s3) = 9, 'written once';
  assert (select count(*) from public.workout_set_events where id = b) = 1, 'one event row';
  -- Different values are still a different change.
  failed := false;
  begin perform public.apply_workout_set_event_v3(s3, b, 'client', null, 2, 2, false, 0, '{"actual_reps":10}', 'entered');
  exception when others then failed := true; msg := sqlerrm; end;
  assert failed and msg = 'event_id_reused', format('different values refused %s', msg);
  -- A different plan revision is a different intent.
  failed := false;
  begin perform public.apply_workout_set_event_v3(s3, b, 'client', null, 2, 2, false, 1, '{"actual_reps":9}', 'entered');
  exception when others then failed := true; msg := sqlerrm; end;
  assert failed and msg = 'event_id_reused', format('different plan refused %s', msg);
end $$;
