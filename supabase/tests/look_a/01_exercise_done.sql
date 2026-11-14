-- Exercise done, not set-tracked: one flag; every set row stays exactly as it
-- was (values, status, timestamps, revision, origin), for partial, skipped,
-- timed, distance and kg exercises; replay, refusals and the strict Undo.
do $$
declare
  log constant uuid := '00000000-0000-4000-8000-0000000000a1';
  squat constant uuid := '00000000-0000-4000-8000-0000000a0001';
  plank constant uuid := '00000000-0000-4000-8000-0000000a0002';
  row_ex constant uuid := '00000000-0000-4000-8000-0000000a0003';
  press constant uuid := '00000000-0000-4000-8000-0000000a0004';
  all_sets uuid[];
  r jsonb; u jsonb; before_ex jsonb; failed boolean; msg text;
begin
  select array_agg(id) into all_sets from look_a_rows;
  select to_jsonb(e) into before_ex from public.workout_log_exercises e where id = squat;

  r := public.mark_workout_exercise_not_set_tracked(log, squat, '00000000-0000-4000-8000-0000000c0001', 'client', null);
  assert r->>'outcome' = 'applied' and (r->>'undoable')::boolean, format('done %s', r);
  assert (select not_set_tracked and not_set_tracked_at is not null and not_set_tracked_change_id = '00000000-0000-4000-8000-0000000c0001'
          from public.workout_log_exercises where id = squat), 'flag set';
  assert pg_temp.look_a_sets_unchanged(all_sets), 'every set row unchanged after exercise done (partial/skipped/pending)';
  assert (select count(*) from public.workout_set_events where workout_log_id = log) = 0, 'no set events written';

  -- Timed, distance and kg exercises, too.
  perform public.mark_workout_exercise_not_set_tracked(log, plank, '00000000-0000-4000-8000-0000000c0002', 'client', null);
  perform public.mark_workout_exercise_not_set_tracked(log, row_ex, '00000000-0000-4000-8000-0000000c0003', 'client', null);
  perform public.mark_workout_exercise_not_set_tracked(log, press, '00000000-0000-4000-8000-0000000c0004', 'client', null);
  assert pg_temp.look_a_sets_unchanged(all_sets), 'every set row unchanged (timed/distance/kg)';
  assert (select status from public.workout_logs where id = log) = 'active', 'exercise done never finishes the workout';

  -- Replay: same id and request answers the recorded outcome, no new write.
  r := public.mark_workout_exercise_not_set_tracked(log, press, '00000000-0000-4000-8000-0000000c0004', 'client', null);
  assert r->>'outcome' = 'replayed' and r->>'original_outcome' = 'applied' and (r->>'undoable')::boolean, format('replay %s', r);
  r := public.mark_workout_exercise_not_set_tracked(log, squat, '00000000-0000-4000-8000-0000000c0001', 'client', null);
  assert r->>'outcome' = 'replayed' and not (r->>'undoable')::boolean, format('replay of an older change is not undoable %s', r);
  -- Same id, different scope: refused.
  failed := false;
  begin perform public.mark_workout_exercise_not_set_tracked(log, squat, '00000000-0000-4000-8000-0000000c0004', 'client', null);
  exception when others then failed := true; msg := sqlerrm; end;
  assert failed and msg = 'event_id_reused', format('reuse %s', msg);
  -- Already done: refused and recorded, nothing written.
  r := public.mark_workout_exercise_not_set_tracked(log, press, '00000000-0000-4000-8000-0000000c0005', 'client', null);
  assert r->>'outcome' = 'refused' and not (r->>'undoable')::boolean, format('already %s', r);

  -- Undo the latest change (press). Strict: the Squat change is no longer the latest.
  u := public.undo_workout_material_change(log, '00000000-0000-4000-8000-0000000c0001', '00000000-0000-4000-8000-0000000c0011', 'client', null);
  assert u->>'outcome' = 'refused' and u->>'reason' = 'A later change replaced this Undo.', format('older change refused %s', u);
  u := public.undo_workout_material_change(log, '00000000-0000-4000-8000-0000000c0004', '00000000-0000-4000-8000-0000000c0012', 'coach', '00000000-0000-4000-8000-000000000001');
  assert u->>'outcome' = 'refused' and u->>'reason' like 'Only the person%', format('other actor refused %s', u);
  u := public.undo_workout_material_change(log, '00000000-0000-4000-8000-0000000c0004', '00000000-0000-4000-8000-0000000c0013', 'client', null);
  assert u->>'outcome' = 'applied', format('undo %s', u);
  assert (select not not_set_tracked and not_set_tracked_at is null from public.workout_log_exercises where id = press), 'flag cleared';
  assert pg_temp.look_a_sets_unchanged(all_sets), 'sets unchanged through Undo';
  -- Repeat click (same Undo id) replays; a second Undo is refused.
  u := public.undo_workout_material_change(log, '00000000-0000-4000-8000-0000000c0004', '00000000-0000-4000-8000-0000000c0013', 'client', null);
  assert u->>'outcome' = 'replayed' and u->>'original_outcome' = 'applied', format('undo replay %s', u);
  u := public.undo_workout_material_change(log, '00000000-0000-4000-8000-0000000c0004', '00000000-0000-4000-8000-0000000c0014', 'client', null);
  assert u->>'outcome' = 'refused', format('second undo %s', u);
  -- ABA: done(C), done(D), Undo(D) cannot revive Undo(C). The ledger guard
  -- refuses it, and so would the material version on its own (counters only grow).
  u := public.undo_workout_material_change(log, '00000000-0000-4000-8000-0000000c0003', '00000000-0000-4000-8000-0000000c0017', 'client', null);
  assert u->>'outcome' = 'refused' and u->>'reason' = 'A later change replaced this Undo.', format('ABA ledger %s', u);
  assert public.workout_log_material_fingerprint(log) <> (select fingerprint_after from public.workout_material_changes
    where id = '00000000-0000-4000-8000-0000000c0003'), 'ABA: version after Undo(D) differs from the version after done(C)';
  assert (select not_set_tracked from public.workout_log_exercises where id = row_ex), 'C stays done';
  -- An Undo cannot be undone.
  u := public.undo_workout_material_change(log, '00000000-0000-4000-8000-0000000c0013', '00000000-0000-4000-8000-0000000c0015', 'client', null);
  assert u->>'outcome' = 'refused' and u->>'reason' = 'There is nothing to undo.', format('undo of undo %s', u);

  -- An exercise with nothing pending cannot be marked.
  update public.workout_log_sets set status = 'skipped' where workout_log_exercise_id = row_ex and status = 'pending';
  -- (row_ex was flagged above; use a fresh check on press after logging everything)
  update public.workout_log_sets set status = 'skipped' where workout_log_exercise_id = press;
  r := public.mark_workout_exercise_not_set_tracked(log, press, '00000000-0000-4000-8000-0000000c0016', 'client', null);
  assert r->>'outcome' = 'refused' and r->>'reason' like 'Every set%', format('nothing pending %s', r);
end $$;
