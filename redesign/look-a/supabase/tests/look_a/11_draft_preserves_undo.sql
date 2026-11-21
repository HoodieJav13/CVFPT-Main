-- Fictional Set 1 is logged; Set 2 is only typed. The server must retain
-- the log's inverse without undoing or dropping the next set's saved draft.
do $$
declare
  log constant uuid := '00000000-0000-4000-8000-0000000000a1';
  s1 constant uuid := '00000000-0000-4000-8000-0000000b0031';
  s2 constant uuid := '00000000-0000-4000-8000-0000000b0032';
  logged constant uuid := '00000000-0000-4000-8000-0000000d0101';
  draft constant uuid := '00000000-0000-4000-8000-0000000d0102';
  u1 constant uuid := '00000000-0000-4000-8000-0000000d0111';
  r jsonb;
begin
  r := public.apply_workout_set_event_v3(s1, logged, 'client', null, 0, 1, false, 0,
    '{"status":"completed","actual_reps":6}', 'entered');
  assert r->>'outcome' = 'applied' and (r->'change'->>'undoable')::boolean, format('first set logged %s', r);
  r := public.apply_workout_set_event_v3(s2, draft, 'client', null, 0, 2, false, 0,
    '{"status":"pending","actual_reps":7}', 'entered');
  assert r->>'outcome' = 'applied' and r->'change' = 'null'::jsonb, format('draft is saved but not a new Undo %s', r);
  assert public.workout_current_undo(log, 'client', null)->>'change_id' is not distinct from logged::text,
    'typing Set 2 must keep the Set 1 Undo';
  assert public.workout_current_undo(log, 'client', null)->'result'->>'set_id' is not distinct from s1::text,
    'the named Set 1 Undo must hydrate after reload';
  assert r->'undo'->'result'->>'set_id' is not distinct from s1::text, 'the draft reply names the prior Set Undo';
  r := public.apply_workout_set_event_v3(s2, draft, 'client', null, 1, 2, false, 0,
    '{"status":"pending","actual_reps":7}', 'entered');
  assert r->>'outcome' = 'replayed' and r->'change' = 'null'::jsonb, 'draft replay does not create an Undo';
  assert r->'undo'->'result'->>'set_id' is not distinct from s1::text, 'lost draft reply replays the current Set Undo';
  r := public.apply_workout_set_event_v3(s1, logged, 'client', null, 1, 1, false, 0,
    '{"status":"completed","actual_reps":6}', 'entered');
  assert r->>'outcome' = 'replayed' and (r->'change'->>'undoable')::boolean, 'log replay still names its own current inverse';
  assert public.workout_current_undo(log, 'coach', '00000000-0000-4000-8000-000000000001') is null,
    'never offer the client Undo to the coach';
  r := public.undo_workout_material_change(log, logged, u1, 'client', null);
  assert r->>'outcome' = 'applied', format('undo set 1 %s', r);
  assert (select status = 'pending' and actual_reps is null from public.workout_log_sets where id = s1), 'set 1 restored';
  assert (select status = 'pending' and actual_reps = 7 and revision = 1 from public.workout_log_sets where id = s2), 'set 2 draft untouched';
  assert public.workout_current_undo(log, 'client', null) is null, 'no older inverse is revived';

  -- An unrelated legacy write changes the fingerprint before another draft.
  -- That subsequent typing must not revive an invalidated Undo.
  r := public.apply_workout_set_event_v3(s1, '00000000-0000-4000-8000-0000000d0103', 'client', null, 2, 3, false, 0,
    '{"status":"completed","actual_reps":8}', 'entered');
  assert r->>'outcome' = 'applied' and (r->'change'->>'undoable')::boolean, 'new Log gets its own inverse';
  update public.workout_log_exercises set client_notes = 'Fictional concurrent change'
    where id = '00000000-0000-4000-8000-0000000a0004';
  r := public.apply_workout_set_event_v3(s2, '00000000-0000-4000-8000-0000000d0104', 'client', null, 1, 4, false, 0,
    '{"actual_reps":9}', 'entered');
  assert r->>'outcome' = 'applied' and r->'change' = 'null'::jsonb, 'draft still saves with an invalidated inverse';
  assert r->'undo' = 'null'::jsonb, 'the authoritative draft reply clears an invalidated offer';
  assert public.workout_current_undo(log, 'client', null) is null, 'do not absorb prior legacy edit';
  r := public.undo_workout_material_change(log, '00000000-0000-4000-8000-0000000d0103',
    '00000000-0000-4000-8000-0000000d0112', 'client', null);
  assert r->>'outcome' = 'refused', 'legacy edit still fences an attempted Undo';

  -- A later Log, unlike a draft, is the new Undo action.
  r := public.apply_workout_set_event_v3(s2, '00000000-0000-4000-8000-0000000d0105', 'client', null, 2, 5, false, 0,
    '{"status":"completed","actual_reps":9}', 'entered');
  assert r->>'outcome' = 'applied' and (r->'change'->>'undoable')::boolean, 'set 2 Log is undoable';
  assert public.workout_current_undo(log, 'client', null)->>'change_id' is not distinct from '00000000-0000-4000-8000-0000000d0105',
    'set 2 Log supersedes set 1';

  assert not has_function_privilege('anon', 'public.look_a_material_fingerprint_with_set(uuid,uuid,bigint)', 'EXECUTE'),
    'fingerprint helper not granted to anon';
  assert not has_function_privilege('authenticated', 'public.look_a_material_fingerprint_with_set(uuid,uuid,bigint)', 'EXECUTE'),
    'fingerprint helper not granted to authenticated';
  assert has_function_privilege('service_role', 'public.look_a_material_fingerprint_with_set(uuid,uuid,bigint)', 'EXECUTE'),
    'service role can use the fingerprint helper';
end $$;
