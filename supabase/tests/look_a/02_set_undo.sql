-- Set events through v3: same outcomes as v2, plus a recorded inverse. Undo
-- restores the set's exact fields (status, values, completed_at, origin) and is
-- refused once any other material change happened (legacy PATCH, notes,
-- another set), and never adopts a replay's current row.
do $$
declare
  log constant uuid := '00000000-0000-4000-8000-0000000000a1';
  squat constant uuid := '00000000-0000-4000-8000-0000000a0001';
  s3 constant uuid := '00000000-0000-4000-8000-0000000b0003';
  s4 constant uuid := '00000000-0000-4000-8000-0000000b0004';
  before3 jsonb; r jsonb; u jsonb;
begin
  select to_jsonb(s) into before3 from public.workout_log_sets s where id = s3;
  r := public.apply_workout_set_event_v3(s3, '00000000-0000-4000-8000-0000000d0001', 'client', null, 0, 1, false, 0,
    '{"status":"completed","actual_reps":6,"actual_load_value":175,"actual_load_unit":"lb"}', 'entered');
  assert r->>'outcome' = 'applied' and (r->'change'->>'undoable')::boolean, format('v3 %s', r);
  assert (select status = 'completed' and actual_reps = 6 and value_origin = 'entered' from public.workout_log_sets where id = s3), 'applied';

  -- A replay reports the ORIGINAL change's undo state, not the current row.
  r := public.apply_workout_set_event_v3(s3, '00000000-0000-4000-8000-0000000d0001', 'client', null, 0, 1, false, 0,
    '{"status":"completed","actual_reps":6,"actual_load_value":175,"actual_load_unit":"lb"}', 'entered');
  assert r->>'outcome' = 'replayed' and (r->'change'->>'undoable')::boolean, format('replay %s', r);

  u := public.undo_workout_material_change(log, '00000000-0000-4000-8000-0000000d0001', '00000000-0000-4000-8000-0000000d0011', 'client', null);
  assert u->>'outcome' = 'applied', format('undo %s', u);
  assert (select status = 'pending' and actual_reps is null and actual_load_value = 170 and actual_load_unit = 'lb'
          and completed_at is null and value_origin = before3->>'value_origin' and revision = 2
          from public.workout_log_sets where id = s3), format('restored %s', (select to_jsonb(s) from public.workout_log_sets s where id = s3));
  -- After Undo the replay of the original says it is no longer undoable.
  r := public.apply_workout_set_event_v3(s3, '00000000-0000-4000-8000-0000000d0001', 'client', null, 0, 1, false, 0,
    '{"status":"completed","actual_reps":6,"actual_load_value":175,"actual_load_unit":"lb"}', 'entered');
  assert not (r->'change'->>'undoable')::boolean, format('replay after undo %s', r);

  -- Another set logged, then an unrelated legacy PATCH elsewhere: Undo refused.
  r := public.apply_workout_set_event_v3(s4, '00000000-0000-4000-8000-0000000d0002', 'client', null, 0, 2, false, 0,
    '{"status":"completed"}', 'entered');
  assert r->>'outcome' = 'applied', format('s4 %s', r);
  -- Replay of an earlier change after a later one: not undoable any more.
  r := public.apply_workout_set_event_v3(s3, '00000000-0000-4000-8000-0000000d0001', 'client', null, 0, 1, false, 0,
    '{"status":"completed","actual_reps":6,"actual_load_value":175,"actual_load_unit":"lb"}', 'entered');
  assert r->>'outcome' = 'replayed' and not (r->'change'->>'undoable')::boolean, format('replay after newer change %s', r);
  -- Replay of the latest change: still undoable, until a legacy write lands.
  r := public.apply_workout_set_event_v3(s4, '00000000-0000-4000-8000-0000000d0002', 'client', null, 0, 2, false, 0, '{"status":"completed"}', 'entered');
  assert r->>'outcome' = 'replayed' and (r->'change'->>'undoable')::boolean, format('replay of latest %s', r);
  update public.workout_log_sets set actual_load_value = 41, updated_at = now() where id = '00000000-0000-4000-8000-0000000b0031';
  u := public.undo_workout_material_change(log, '00000000-0000-4000-8000-0000000d0002', '00000000-0000-4000-8000-0000000d0012', 'client', null);
  assert u->>'outcome' = 'refused', format('legacy patch invalidates %s', u);
  r := public.apply_workout_set_event_v3(s4, '00000000-0000-4000-8000-0000000d0002', 'client', null, 0, 2, false, 0, '{"status":"completed"}', 'entered');
  assert r->>'outcome' = 'replayed' and not (r->'change'->>'undoable')::boolean, format('replay after legacy change %s', r);
  assert (select status from public.workout_log_sets where id = s4) = 'completed', 'nothing restored on refusal';

  -- Exercise notes are material too.
  r := public.apply_workout_set_event_v3(s3, '00000000-0000-4000-8000-0000000d0003', 'client', null, 2, 3, false, 0,
    '{"status":"completed","actual_reps":5}', 'entered');
  update public.workout_log_exercises set client_notes = 'fictional note', updated_at = now() where id = squat;
  u := public.undo_workout_material_change(log, '00000000-0000-4000-8000-0000000d0003', '00000000-0000-4000-8000-0000000d0013', 'client', null);
  assert u->>'outcome' = 'refused', format('notes invalidate %s', u);

  -- A refused (no-op) later attempt does not invalidate: unchanged outcome writes nothing.
  r := public.apply_workout_set_event_v3(s3, '00000000-0000-4000-8000-0000000d0004', 'client', null, 3, 4, false, 0,
    '{"status":"completed","actual_reps":7}', 'entered');
  assert r->>'outcome' = 'applied', format('fresh change %s', r);
  r := public.mark_workout_exercise_not_set_tracked(log, squat, '00000000-0000-4000-8000-0000000d0005', 'client', null);
  -- Every Squat set is now logged or skipped: marking it done is refused and,
  -- being a no-op, does not take the Undo away from the last real change.
  assert r->>'outcome' = 'refused', format('nothing pending %s', r);
  -- A same-value write is applied by v2 but changes nothing material: no
  -- record, no Undo of its own, and the earlier Undo survives.
  r := public.apply_workout_set_event_v3(s3, '00000000-0000-4000-8000-0000000d0006', 'client', null, 4, 5, false, 0,
    '{"status":"completed","actual_reps":7}', 'entered');
  assert r->>'outcome' = 'applied' and r->'change' = 'null'::jsonb, format('same-value write %s', r);
  assert not exists (select 1 from public.workout_material_changes where id = '00000000-0000-4000-8000-0000000d0006'), 'no ledger row for a no-op';
  u := public.undo_workout_material_change(log, '00000000-0000-4000-8000-0000000d0004', '00000000-0000-4000-8000-0000000d0014', 'client', null);
  assert u->>'outcome' = 'applied', format('no-op keeps undo %s', u);

  -- ABA through a legacy writer: a material edit then a restore of the exact
  -- same values does not revive the Undo (the set's counter moved twice).
  r := public.apply_workout_set_event_v3(s4, '00000000-0000-4000-8000-0000000d0007', 'client', null, null, 6, false, 0,
    '{"actual_reps":9}', 'entered');
  assert r->>'outcome' = 'applied' and (r->'change'->>'undoable')::boolean, format('d7 %s', r);
  update public.workout_log_sets set actual_load_value = 180, updated_at = now() where id = '00000000-0000-4000-8000-0000000b0032';
  update public.workout_log_sets set actual_load_value = 40, updated_at = now() where id = '00000000-0000-4000-8000-0000000b0032';
  u := public.undo_workout_material_change(log, '00000000-0000-4000-8000-0000000d0007', '00000000-0000-4000-8000-0000000d0017', 'client', null);
  assert u->>'outcome' = 'refused' and u->>'reason' like 'This workout changed since%', format('legacy ABA %s', u);
  assert (select actual_reps from public.workout_log_sets where id = s4) = 9, 'nothing restored';
  -- The same for a whole-row restore of exercise notes.
  r := public.apply_workout_set_event_v3(s4, '00000000-0000-4000-8000-0000000d0008', 'client', null, null, 7, false, 0,
    '{"actual_reps":10}', 'entered');
  update public.workout_log_exercises set client_notes = 'other', updated_at = now() where id = squat;
  update public.workout_log_exercises set client_notes = 'fictional note', updated_at = now() where id = squat;
  u := public.undo_workout_material_change(log, '00000000-0000-4000-8000-0000000d0008', '00000000-0000-4000-8000-0000000d0018', 'client', null);
  assert u->>'outcome' = 'refused', format('notes ABA %s', u);
  -- An acknowledgement-only write (updated_at alone) keeps the Undo.
  r := public.apply_workout_set_event_v3(s4, '00000000-0000-4000-8000-0000000d0009', 'client', null, null, 8, false, 0,
    '{"actual_reps":11}', 'entered');
  update public.workout_log_exercises set updated_at = now() + interval '1 second' where id = squat;
  u := public.undo_workout_material_change(log, '00000000-0000-4000-8000-0000000d0009', '00000000-0000-4000-8000-0000000d0019', 'client', null);
  assert u->>'outcome' = 'applied', format('ack keeps undo %s', u);
  assert (select actual_reps from public.workout_log_sets where id = s4) = 10, 'restored to the value before d9';
end $$;
