-- Swap count and swap Undo (LOOK-A-HANDOFF-REVIEW.md 1-3; owner decisions
-- 2026-11-14). A coach backup gets its own set count minus the sets already
-- completed or skipped on the exercise it replaces (minimum 1), decided in the
-- swap's own transaction; a different count than the person was shown is
-- refused, never silently changed. A swap is one material change with one
-- revision-checked inverse. Original exercise and set rows are never changed.
do $$
declare
  log constant uuid := '00000000-0000-4000-8000-0000000000a1';
  client constant uuid := '00000000-0000-4000-8000-000000000014';
  squat constant uuid := '00000000-0000-4000-8000-0000000a0001';
  press constant uuid := '00000000-0000-4000-8000-0000000a0004';
  wex constant uuid := '00000000-0000-4000-8000-000000000061';
  lib constant uuid := '00000000-0000-4000-8000-000000000052';
  coach constant uuid := '00000000-0000-4000-8000-000000000001';
  b1 constant uuid := '00000000-0000-4000-8000-0000000d0001';
  b2 constant uuid := '00000000-0000-4000-8000-0000000d0002';
  sw1 constant uuid := '00000000-0000-4000-8000-0000000c1001';
  rep1 constant uuid := '00000000-0000-4000-8000-0000000c1101';
  set1 constant uuid := '00000000-0000-4000-8000-0000000c1201';
  r jsonb; u jsonb; before_ex jsonb; before_sets jsonb; failed boolean; msg text;
  row_for jsonb;
begin
  update public.workout_log_exercises set source_workout_exercise_id = wex where id in (squat, press);
  insert into public.workout_exercise_backups(id, workout_exercise_id, backup_exercise_library_id, target_sets, target_reps, target_load_value, target_load_unit, target_load_max, target_per_side, created_by_coach_id)
    values (b1, wex, lib, 3, '8', 30, 'kg', 35, true, coach);
  select to_jsonb(e) into before_ex from public.workout_log_exercises e where id = squat;
  select jsonb_agg(to_jsonb(s) order by s.id) into before_sets from public.workout_log_sets s where workout_log_exercise_id = squat;
  row_for := jsonb_build_object('workout_log_id', log, 'client_id', client, 'original_log_exercise_id', squat,
    'original_exercise_library_id', '00000000-0000-4000-8000-000000000051', 'original_name', 'Fictional Squat',
    'replacement_exercise_library_id', lib, 'replacement_name', 'Replacement', 'source', 'coach_backup', 'backup_id', b1,
    'trigger', 'other', 'targets', '{"reps":"8","load_value":30,"load_unit":"kg","load_max":35,"per_side":true}'::jsonb, 'offline', false, 'actor_role', 'client');

  -- Squat: completed 1 + skipped 1 (+ 2 pending): 3 - 2 = 1. Shown 2: refused, nothing written.
  r := public.create_workout_substitution_v3(row_for || jsonb_build_object('id', '00000000-0000-4000-8000-0000000c1000', 'replacement_log_exercise_id', '00000000-0000-4000-8000-0000000c1100'), true, 2,
    array['00000000-0000-4000-8000-0000000c1200', '00000000-0000-4000-8000-0000000c1209']::uuid[]);
  assert r->>'outcome' = 'refused' and r->>'reason' = 'count_changed' and (r->>'sets')::int = 1, format('count changed %s', r);
  assert not exists (select 1 from public.workout_log_substitutions where id = '00000000-0000-4000-8000-0000000c1000'), 'no swap row';
  -- Its replay answers the recorded refusal, not a fresh count.
  r := public.create_workout_substitution_v3(row_for || jsonb_build_object('id', '00000000-0000-4000-8000-0000000c1000', 'replacement_log_exercise_id', '00000000-0000-4000-8000-0000000c1100'), true, 2,
    array['00000000-0000-4000-8000-0000000c1200', '00000000-0000-4000-8000-0000000c1209']::uuid[]);
  assert r->>'outcome' = 'replayed' and r->>'original_outcome' = 'refused', format('refusal replays %s', r);

  -- Shown 1: applied, one replacement set with the page's id, the backup's facts.
  r := public.create_workout_substitution_v3(row_for || jsonb_build_object('id', sw1, 'replacement_log_exercise_id', rep1), true, 1, array[set1]);
  assert r->>'outcome' = 'created' and (r->>'sets')::int = 1 and (r->>'undoable')::boolean, format('swap %s', r);
  assert (select count(*) from public.workout_log_sets where workout_log_exercise_id = rep1) = 1, 'one set';
  assert exists (select 1 from public.workout_log_sets where id = set1 and workout_log_exercise_id = rep1 and status = 'pending'), 'the page id';
  assert (select (prescribed_sets, prescribed_load_value, prescribed_load_unit, prescribed_load_max, per_side) = ('1', 30::numeric, 'kg', 35::numeric, true)
    from public.workout_log_exercises where id = rep1), format('replacement prescription %s', (select to_jsonb(e) from public.workout_log_exercises e where id = rep1));
  assert (select to_jsonb(e) from public.workout_log_exercises e where id = squat) = before_ex, 'original exercise row unchanged';
  assert (select jsonb_agg(to_jsonb(s) order by s.id) from public.workout_log_sets s where workout_log_exercise_id = squat) = before_sets, 'original set rows unchanged';
  assert (public.workout_current_undo(log, 'client', null)->>'kind') = 'swap', 'the swap is the one Undo';
  -- Same id replays its recorded answer and never subtracts again.
  update public.workout_log_sets set status = 'skipped' where workout_log_exercise_id = squat and set_number = 3;
  r := public.create_workout_substitution_v3(row_for || jsonb_build_object('id', sw1, 'replacement_log_exercise_id', rep1), true, 1, array[set1]);
  assert r->>'outcome' = 'replayed' and (r->>'sets')::int = 1, format('replay %s', r);
  assert (select count(*) from public.workout_log_sets where workout_log_exercise_id = rep1) = 1, 'still one set';
  update public.workout_log_sets set status = 'pending' where workout_log_exercise_id = squat and set_number = 3;
  -- (that edit changed the workout, so the swap is no longer undoable)
  assert public.workout_current_undo(log, 'client', null) is null, 'a later change ends the swap Undo';
end $$;

-- Swap Undo: the latest swap only, revision-checked; no older Undo returns.
do $$
declare
  log constant uuid := '00000000-0000-4000-8000-0000000000a1';
  client constant uuid := '00000000-0000-4000-8000-000000000014';
  press constant uuid := '00000000-0000-4000-8000-0000000a0004';
  p1 constant uuid := '00000000-0000-4000-8000-0000000b0031';
  wex constant uuid := '00000000-0000-4000-8000-000000000061';
  lib constant uuid := '00000000-0000-4000-8000-000000000052';
  coach constant uuid := '00000000-0000-4000-8000-000000000001';
  b2 constant uuid := '00000000-0000-4000-8000-0000000d0002';
  sw constant uuid := '00000000-0000-4000-8000-0000000c2001';
  rep constant uuid := '00000000-0000-4000-8000-0000000c2101';
  r jsonb; u jsonb; before_ex jsonb; before_sets jsonb; row_for jsonb;
begin
  update public.workout_log_exercises set source_workout_exercise_id = wex where id = press;
  -- A backup without its own set count is refused with an explanation; no
  -- count is taken from the replaced exercise or from what was typed.
  -- (one active backup per exercise and library: the first test's is retired)
  update public.workout_exercise_backups set archived = true where workout_exercise_id = wex and not archived;
  insert into public.workout_exercise_backups(id, workout_exercise_id, backup_exercise_library_id, target_sets, created_by_coach_id)
    values (b2, wex, lib, null, coach);
  row_for := jsonb_build_object('workout_log_id', log, 'client_id', client, 'original_log_exercise_id', press,
    'original_exercise_library_id', '00000000-0000-4000-8000-000000000051', 'original_name', 'Fictional Press',
    'replacement_exercise_library_id', lib, 'replacement_name', 'Replacement', 'source', 'coach_backup', 'backup_id', b2,
    'trigger', 'other', 'targets', '{"sets":2}'::jsonb, 'offline', false, 'actor_role', 'client');
  r := public.create_workout_substitution_v3(row_for || jsonb_build_object('id', '00000000-0000-4000-8000-0000000c2010', 'replacement_log_exercise_id', '00000000-0000-4000-8000-0000000c2110'), true, 2,
    array['00000000-0000-4000-8000-0000000c2211', '00000000-0000-4000-8000-0000000c2212']::uuid[]);
  assert r->>'outcome' = 'refused' and r->>'reason' = 'missing_prescription' and r->>'message' like '%not set how many sets%', format('missing count %s', r);
  assert not exists (select 1 from public.workout_log_substitutions where id = '00000000-0000-4000-8000-0000000c2010'), 'no swap row';
  assert not exists (select 1 from public.workout_log_exercises where id = '00000000-0000-4000-8000-0000000c2110'), 'no replacement';
  update public.workout_exercise_backups set archived = true where id = b2;
  insert into public.workout_exercise_backups(id, workout_exercise_id, backup_exercise_library_id, target_sets, created_by_coach_id)
    values ('00000000-0000-4000-8000-0000000d0004', wex, lib, 2, coach);
  -- An earlier set write: its Undo is replaced by the swap and never returns.
  r := public.apply_workout_set_event_v3(p1, '00000000-0000-4000-8000-0000000c2900', 'client', null, 0, 1, false, 0, '{"actual_reps":4}', 'entered');
  assert r->>'outcome' = 'applied', format('earlier set %s', r);
  -- The not-set-tracked flag does not count as done sets: 2 - 0 = 2.
  update public.workout_log_exercises set not_set_tracked = true, not_set_tracked_at = now() where id = press;
  select to_jsonb(e) into before_ex from public.workout_log_exercises e where id = press;
  select jsonb_agg(to_jsonb(s) order by s.id) into before_sets from public.workout_log_sets s where workout_log_exercise_id = press;
  row_for := row_for || jsonb_build_object('id', sw, 'replacement_log_exercise_id', rep, 'backup_id', '00000000-0000-4000-8000-0000000d0004', 'targets', '{}'::jsonb);
  r := public.create_workout_substitution_v3(row_for, true, 2,
    array['00000000-0000-4000-8000-0000000c2201', '00000000-0000-4000-8000-0000000c2202']::uuid[]);
  assert r->>'outcome' = 'created' and (r->>'sets')::int = 2, format('flag not counted %s', r);
  u := public.undo_workout_material_change(log, sw, '00000000-0000-4000-8000-0000000c2002', 'client', null);
  assert u->>'outcome' = 'applied', format('undo swap %s', u);
  assert (select status from public.workout_log_substitutions where id = sw) = 'undone', 'swap undone';
  assert (select archived from public.workout_log_exercises where id = rep), 'replacement archived';
  assert not exists (select 1 from public.workout_log_sets where workout_log_exercise_id = rep and not archived), 'replacement sets archived';
  assert (select to_jsonb(e) from public.workout_log_exercises e where id = press) = before_ex, 'original exercise row unchanged';
  assert (select jsonb_agg(to_jsonb(s) order by s.id) from public.workout_log_sets s where workout_log_exercise_id = press) = before_sets, 'original set rows unchanged';
  -- One step: the earlier set Undo does not come back.
  assert public.workout_current_undo(log, 'client', null) is null, format('no older Undo %s', public.workout_current_undo(log, 'client', null));
  u := public.undo_workout_material_change(log, '00000000-0000-4000-8000-0000000c2900', '00000000-0000-4000-8000-0000000c2003', 'client', null);
  assert u->>'outcome' = 'refused', format('older Undo refused %s', u);
  -- The exercise can be swapped again.
  r := public.create_workout_substitution_v3(row_for || jsonb_build_object('id', '00000000-0000-4000-8000-0000000c2004', 'replacement_log_exercise_id', '00000000-0000-4000-8000-0000000c2104'), true, 2,
    array['00000000-0000-4000-8000-0000000c2203', '00000000-0000-4000-8000-0000000c2204']::uuid[]);
  assert r->>'outcome' = 'created', format('swap again %s', r);
  -- A changed replacement refuses the Undo safely.
  r := public.apply_workout_set_event_v3('00000000-0000-4000-8000-0000000c2203', '00000000-0000-4000-8000-0000000c2905', 'client', null, null, 2, false, 0, '{"status":"completed","actual_reps":8}', 'entered');
  assert r->>'outcome' = 'applied', format('replacement set %s', r);
  u := public.undo_workout_material_change(log, '00000000-0000-4000-8000-0000000c2004', '00000000-0000-4000-8000-0000000c2006', 'client', null);
  assert u->>'outcome' = 'refused', format('changed replacement refused %s', u);
  assert (select status from public.workout_log_substitutions where id = '00000000-0000-4000-8000-0000000c2004') = 'active', 'still active';
end $$;

-- Set ids that do not match the count are refused before anything is written.
do $$
declare failed boolean := false; msg text;
begin
  update public.workout_log_exercises set source_workout_exercise_id = '00000000-0000-4000-8000-000000000061' where id = '00000000-0000-4000-8000-0000000a0004';
  update public.workout_exercise_backups set archived = true where workout_exercise_id = '00000000-0000-4000-8000-000000000061' and not archived;
  insert into public.workout_exercise_backups(id, workout_exercise_id, backup_exercise_library_id, target_sets, created_by_coach_id)
    values ('00000000-0000-4000-8000-0000000d0003', '00000000-0000-4000-8000-000000000061', '00000000-0000-4000-8000-000000000052', 2, '00000000-0000-4000-8000-000000000001');
  begin
    perform public.create_workout_substitution_v3(jsonb_build_object('id', '00000000-0000-4000-8000-0000000c3001', 'workout_log_id', '00000000-0000-4000-8000-0000000000a1',
      'client_id', '00000000-0000-4000-8000-000000000014', 'original_log_exercise_id', '00000000-0000-4000-8000-0000000a0004', 'original_name', 'Fictional Press',
      'replacement_log_exercise_id', '00000000-0000-4000-8000-0000000c3101', 'replacement_exercise_library_id', '00000000-0000-4000-8000-000000000052',
      'replacement_name', 'Replacement', 'source', 'coach_backup', 'backup_id', '00000000-0000-4000-8000-0000000d0003', 'trigger', 'other', 'targets', '{}'::jsonb, 'actor_role', 'client'),
      true, 2, array['00000000-0000-4000-8000-0000000c3201']::uuid[]);
  exception when others then failed := true; msg := sqlerrm; end;
  assert failed and msg like '%set ids%', format('mismatched ids %s', msg);
  assert not exists (select 1 from public.workout_log_substitutions where id = '00000000-0000-4000-8000-0000000c3001'), 'nothing written';
end $$;

-- Older queued payloads and coach flows keep the unchanged older function:
-- it records no Undo, and its own replay is answered by the new one too.
do $$
declare r jsonb; failed boolean := false;
begin
  update public.workout_exercise_backups set archived = true where workout_exercise_id = '00000000-0000-4000-8000-000000000061' and not archived;
  r := public.create_workout_substitution(jsonb_build_object('id', '00000000-0000-4000-8000-0000000c4001', 'workout_log_id', '00000000-0000-4000-8000-0000000000a1',
    'client_id', '00000000-0000-4000-8000-000000000014', 'original_log_exercise_id', '00000000-0000-4000-8000-0000000a0003', 'original_name', 'Fictional Row',
    'replacement_log_exercise_id', '00000000-0000-4000-8000-0000000c4101', 'replacement_exercise_library_id', '00000000-0000-4000-8000-000000000052',
    'replacement_name', 'Replacement', 'source', 'catalog_suggestion', 'trigger', 'equipment_busy', 'reason', 'Rack taken',
    'targets', '{"sets":3}'::jsonb, 'actor_role', 'client', 'create_target_sets', false), true);
  assert r->>'outcome' = 'created', format('legacy %s', r);
  assert not exists (select 1 from public.workout_material_changes where id = '00000000-0000-4000-8000-0000000c4001'), 'legacy records no Undo';
  r := public.create_workout_substitution_v3(jsonb_build_object('id', '00000000-0000-4000-8000-0000000c4001', 'workout_log_id', '00000000-0000-4000-8000-0000000000a1',
    'client_id', '00000000-0000-4000-8000-000000000014', 'original_log_exercise_id', '00000000-0000-4000-8000-0000000a0003', 'original_name', 'Fictional Row',
    'replacement_log_exercise_id', '00000000-0000-4000-8000-0000000c4101', 'replacement_exercise_library_id', '00000000-0000-4000-8000-000000000052',
    'replacement_name', 'Replacement', 'source', 'catalog_suggestion', 'trigger', 'equipment_busy', 'reason', 'Rack taken',
    'targets', '{"sets":3}'::jsonb, 'actor_role', 'client'), true, 3, null);
  assert r->>'outcome' = 'replayed' and r->'substitution'->>'status' = 'active', format('legacy replay %s', r);
  -- A backup count can never be stored as zero.
  begin
    insert into public.workout_exercise_backups(id, workout_exercise_id, backup_exercise_library_id, target_sets, created_by_coach_id)
      values ('00000000-0000-4000-8000-0000000d0009', '00000000-0000-4000-8000-000000000061', '00000000-0000-4000-8000-000000000052', 0, '00000000-0000-4000-8000-000000000001');
  exception when check_violation then failed := true; end;
  assert failed, 'zero count refused by the table';
  -- The ledger now accepts swap; substitutions accept undone.
  assert has_function_privilege('service_role', 'public.create_workout_substitution_v3(jsonb, boolean, integer, uuid[])', 'execute'), 'service role';
  assert not has_function_privilege('authenticated', 'public.create_workout_substitution_v3(jsonb, boolean, integer, uuid[])', 'execute'), 'not for browsers';
  assert not has_function_privilege('anon', 'public.create_workout_substitution_v3(jsonb, boolean, integer, uuid[])', 'execute'), 'not for anon';
end $$;

-- Request identity, legacy ownership, Add Set after Undo, and coach decisions
-- after a withdrawn swap (LOOK-A-SWAP-RACE-REVIEW.md 1-3).
do $$
declare
  log constant uuid := '00000000-0000-4000-8000-0000000000a1';
  client constant uuid := '00000000-0000-4000-8000-000000000014';
  plank constant uuid := '00000000-0000-4000-8000-0000000a0002';
  lib constant uuid := '00000000-0000-4000-8000-000000000052';
  sw constant uuid := '00000000-0000-4000-8000-0000000c5001';
  rep constant uuid := '00000000-0000-4000-8000-0000000c5101';
  base jsonb; r jsonb; u jsonb; failed boolean; msg text;
begin
  base := jsonb_build_object('id', sw, 'workout_log_id', log, 'client_id', client, 'original_log_exercise_id', plank, 'original_name', 'Fictional Plank',
    'replacement_log_exercise_id', rep, 'replacement_exercise_library_id', lib, 'replacement_name', 'Replacement',
    'source', 'catalog_suggestion', 'trigger', 'other', 'targets', '{"sets":2}'::jsonb, 'actor_role', 'client');
  r := public.create_workout_substitution_v3(base, true, 2, array['00000000-0000-4000-8000-0000000c5201', '00000000-0000-4000-8000-0000000c5202']::uuid[]);
  assert r->>'outcome' = 'created', format('catalog swap %s', r);
  -- A server-derived name changing later does not break the replay.
  r := public.create_workout_substitution_v3(base || '{"replacement_name":"Renamed","chosen_at":"2026-11-14T10:00:00Z","offline":true}'::jsonb, true, 2,
    array['00000000-0000-4000-8000-0000000c5201', '00000000-0000-4000-8000-0000000c5202']::uuid[]);
  assert r->>'outcome' = 'replayed', format('derived fields ignored %s', r);
  -- A different choice under the same id is refused, before anything is written.
  failed := false;
  begin
    perform public.create_workout_substitution_v3(base || '{"trigger":"cannot_do"}'::jsonb, true, 2,
      array['00000000-0000-4000-8000-0000000c5201', '00000000-0000-4000-8000-0000000c5202']::uuid[]);
  exception when others then failed := true; msg := sqlerrm; end;
  assert failed and msg = 'event_id_reused', format('different choice %s', msg);
  -- Undo, then a late Add Set into the archived replacement is refused.
  u := public.undo_workout_material_change(log, sw, '00000000-0000-4000-8000-0000000c5002', 'client', null);
  assert u->>'outcome' = 'applied', format('undo %s', u);
  failed := false;
  begin
    insert into public.workout_log_sets(workout_log_exercise_id, set_number, set_origin, client_operation_id)
      values (rep, 3, 'extra', '00000000-0000-4000-8000-0000000c5301');
  exception when others then failed := true; msg := sqlerrm; end;
  assert failed and msg like '%no longer in the workout%', format('late add %s', msg);
  -- A late set write on an archived replacement set is refused too.
  failed := false;
  begin
    perform public.apply_workout_set_event_v3('00000000-0000-4000-8000-0000000c5201', '00000000-0000-4000-8000-0000000c5003', 'client', null, null, 1, false, 0, '{"status":"completed","actual_reps":8}', 'entered');
  exception when others then failed := true; end;
  assert failed, 'late set write refused';
  assert public.workout_current_undo(log, 'client', null) is null, 'no Undo after refusals';
  -- Unarchiving a set under the archived replacement is refused.
  failed := false;
  begin
    update public.workout_log_sets set archived = false where id = '00000000-0000-4000-8000-0000000c5201';
  exception when others then failed := true; end;
  assert failed, 'no set brought back under an archived exercise';
  -- Another workout's swap id is never answered with this workout's record.
  failed := false;
  begin
    perform public.create_workout_substitution_v3(base || jsonb_build_object('original_log_exercise_id', '00000000-0000-4000-8000-0000000a0003'), true, 2,
      array['00000000-0000-4000-8000-0000000c5201', '00000000-0000-4000-8000-0000000c5202']::uuid[]);
  exception when others then failed := true; msg := sqlerrm; end;
  assert failed and msg = 'event_id_reused', format('other exercise %s', msg);
end $$;

-- A request waiting for the coach, withdrawn by Undo: a later approval (or
-- its retry) never activates it; the exercise can be swapped again.
do $$
declare
  log constant uuid := '00000000-0000-4000-8000-0000000000a1';
  client constant uuid := '00000000-0000-4000-8000-000000000014';
  plank constant uuid := '00000000-0000-4000-8000-0000000a0002';
  lib constant uuid := '00000000-0000-4000-8000-000000000052';
  sw constant uuid := '00000000-0000-4000-8000-0000000c6001';
  rep constant uuid := '00000000-0000-4000-8000-0000000c6101';
  r jsonb; u jsonb; d jsonb;
begin
  r := public.create_workout_substitution_v3(jsonb_build_object('id', sw, 'workout_log_id', log, 'client_id', client, 'original_log_exercise_id', plank,
    'original_name', 'Fictional Plank', 'replacement_log_exercise_id', rep, 'replacement_exercise_library_id', lib, 'replacement_name', 'Replacement',
    'source', 'catalog_suggestion', 'trigger', 'other', 'targets', '{"sets":2}'::jsonb, 'actor_role', 'client'), false, 2, null);
  assert r->>'outcome' = 'created' and r->'substitution'->>'status' = 'pending_confirmation', format('request %s', r);
  assert (public.workout_current_undo(log, 'client', null)->>'kind') = 'swap', 'the request is the Undo';
  u := public.undo_workout_material_change(log, sw, '00000000-0000-4000-8000-0000000c6002', 'client', null);
  assert u->>'outcome' = 'applied', format('withdraw %s', u);
  d := public.decide_workout_substitution(log, sw, 'approve', '00000000-0000-4000-8000-0000000c6003', '00000000-0000-4000-8000-000000000001');
  assert d->>'outcome' = 'already_decided', format('approve after withdraw %s', d);
  d := public.decide_workout_substitution(log, sw, 'approve', '00000000-0000-4000-8000-0000000c6003', '00000000-0000-4000-8000-000000000001');
  assert d->>'outcome' = 'already_decided', format('approve retry %s', d);
  assert (select status from public.workout_log_substitutions where id = sw) = 'undone', 'still undone';
  assert not exists (select 1 from public.workout_log_exercises where id = rep), 'no replacement ever created';
  -- In the other order the coach's approval ends the client's Undo.
  r := public.create_workout_substitution_v3(jsonb_build_object('id', '00000000-0000-4000-8000-0000000c6004', 'workout_log_id', log, 'client_id', client,
    'original_log_exercise_id', plank, 'original_name', 'Fictional Plank', 'replacement_log_exercise_id', '00000000-0000-4000-8000-0000000c6104',
    'replacement_exercise_library_id', lib, 'replacement_name', 'Replacement', 'source', 'catalog_suggestion', 'trigger', 'other',
    'targets', '{"sets":2}'::jsonb, 'actor_role', 'client'), false, 2, null);
  assert r->>'outcome' = 'created', format('second request %s', r);
  d := public.decide_workout_substitution(log, '00000000-0000-4000-8000-0000000c6004', 'approve', '00000000-0000-4000-8000-0000000c6005', '00000000-0000-4000-8000-000000000001');
  assert d->>'outcome' = 'approve', format('approve %s', d);
  u := public.undo_workout_material_change(log, '00000000-0000-4000-8000-0000000c6004', '00000000-0000-4000-8000-0000000c6006', 'client', null);
  assert u->>'outcome' = 'refused', format('undo after approval refused %s', u);
  assert (select status from public.workout_log_substitutions where id = '00000000-0000-4000-8000-0000000c6004') = 'active', 'approved stays';
end $$;
