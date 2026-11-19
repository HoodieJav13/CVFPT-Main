-- Load range and per-side: authored through sync_workout_exercises (omitted
-- keys keep stored values; explicit keys set or clear; range shifts and clears
-- succeed atomically; invalid ranges are refused with nothing saved), copied by
-- clone_workout, snapshotted at start, never invented for an override, and
-- visible in program history.
do $$
declare
  w constant uuid := '00000000-0000-4000-8000-000000000005';
  coach constant uuid := '00000000-0000-4000-8000-000000000001';
  we_id constant uuid := '00000000-0000-4000-8000-000000000061';
  base constant text := '"id":"00000000-0000-4000-8000-000000000061","exercise_library_id":"00000000-0000-4000-8000-000000000051","sets":"3","reps":"4-6"';
  we public.workout_exercises; c jsonb; le public.workout_log_exercises; failed boolean; msg text;
begin
  perform public.sync_workout_exercises(w, format('[{%s,"default_load_value":"170","default_load_unit":"lb","prescribed_load_max":"180","per_side":true}]', base)::jsonb);
  select * into we from public.workout_exercises where id = we_id;
  assert we.prescribed_load_max = 180 and we.per_side and we.default_load_value = 170, format('authored %s', to_jsonb(we));

  -- An older payload with the same stable id and no new keys keeps both facts.
  perform public.sync_workout_exercises(w, format('[{%s,"default_load_value":"170","default_load_unit":"lb","notes":"fictional"}]', base)::jsonb);
  select * into we from public.workout_exercises where id = we_id;
  assert we.prescribed_load_max = 180 and we.per_side, format('omitted keys preserved %s', to_jsonb(we));

  -- Valid range shift past the old upper load: 170-180 -> 190-200.
  perform public.sync_workout_exercises(w, format('[{%s,"default_load_value":"190","default_load_unit":"lb","prescribed_load_max":"200"}]', base)::jsonb);
  select * into we from public.workout_exercises where id = we_id;
  assert we.default_load_value = 190 and we.prescribed_load_max = 200 and we.per_side, format('range shift %s', to_jsonb(we));

  -- Invalid range: refused, nothing from that save kept (lower stays 190).
  failed := false;
  begin
    perform public.sync_workout_exercises(w, format('[{%s,"default_load_value":"210","default_load_unit":"lb","prescribed_load_max":"205"}]', base)::jsonb);
  exception when others then failed := true; msg := sqlerrm; end;
  assert failed and msg like 'The upper load must be higher%', format('invalid range refused %s', msg);
  select * into we from public.workout_exercises where id = we_id;
  assert we.default_load_value = 190 and we.prescribed_load_max = 200, format('nothing saved %s', to_jsonb(we));

  -- An upper load equal to the lower one is the single number.
  perform public.sync_workout_exercises(w, format('[{%s,"default_load_value":"190","default_load_unit":"lb","prescribed_load_max":"190"}]', base)::jsonb);
  assert (select prescribed_load_max is null from public.workout_exercises where id = we_id), 'equal upper load is no range';

  -- An older payload that moves the lower load past the stored upper load:
  -- the stale upper load is cleared, the save succeeds.
  update public.workout_exercises set prescribed_load_max = 200 where id = we_id;
  perform public.sync_workout_exercises(w, format('[{%s,"default_load_value":"205","default_load_unit":"lb"}]', base)::jsonb);
  select * into we from public.workout_exercises where id = we_id;
  assert we.default_load_value = 205 and we.prescribed_load_max is null and we.per_side, format('stale upper cleared %s', to_jsonb(we));

  -- A unit change without the upper load never relabels it (170-180 lb is not
  -- 170-180 kg); a new payload that states the upper load in the new unit keeps it.
  perform public.sync_workout_exercises(w, format('[{%s,"default_load_value":"170","default_load_unit":"lb","prescribed_load_max":"180"}]', base)::jsonb);
  perform public.sync_workout_exercises(w, format('[{%s,"default_load_value":"170","default_load_unit":"kg"}]', base)::jsonb);
  select * into we from public.workout_exercises where id = we_id;
  assert we.default_load_unit = 'kg' and we.prescribed_load_max is null, format('unit change clears upper %s', to_jsonb(we));
  perform public.sync_workout_exercises(w, format('[{%s,"default_load_value":"80","default_load_unit":"kg","prescribed_load_max":"85"}]', base)::jsonb);
  select * into we from public.workout_exercises where id = we_id;
  assert we.default_load_unit = 'kg' and we.default_load_value = 80 and we.prescribed_load_max = 85, format('new writer unit + range %s', to_jsonb(we));
  update public.workout_exercises set default_load_unit = 'lb' where id = we_id;
  assert (select prescribed_load_max is null from public.workout_exercises where id = we_id), 'direct unit change clears upper';
  -- A lower-load move that would still be numerically valid is also not kept
  -- silently: 80-85 moved to 82 by an old payload becomes the single number.
  perform public.sync_workout_exercises(w, format('[{%s,"default_load_value":"80","default_load_unit":"kg","prescribed_load_max":"85"}]', base)::jsonb);
  perform public.sync_workout_exercises(w, format('[{%s,"default_load_value":"82","default_load_unit":"kg"}]', base)::jsonb);
  assert (select default_load_value = 82 and prescribed_load_max is null from public.workout_exercises where id = we_id), 'lower move clears omitted upper';

  -- Clearing the lower load: explicit clear of both, and an older payload.
  update public.workout_exercises set prescribed_load_max = 215 where id = we_id;
  perform public.sync_workout_exercises(w, format('[{%s,"default_load_value":"","prescribed_load_max":null}]', base)::jsonb);
  select * into we from public.workout_exercises where id = we_id;
  assert we.default_load_value is null and we.prescribed_load_max is null, format('explicit clear %s', to_jsonb(we));
  perform public.sync_workout_exercises(w, format('[{%s,"default_load_value":"170","default_load_unit":"lb","prescribed_load_max":"180"}]', base)::jsonb);
  perform public.sync_workout_exercises(w, format('[{%s,"default_load_value":""}]', base)::jsonb);
  select * into we from public.workout_exercises where id = we_id;
  assert we.default_load_value is null and we.prescribed_load_max is null, format('older payload clear %s', to_jsonb(we));
  -- An upper load with no lower load is refused.
  failed := false;
  begin perform public.sync_workout_exercises(w, format('[{%s,"default_load_value":"","prescribed_load_max":"100"}]', base)::jsonb);
  exception when others then failed := true; msg := sqlerrm; end;
  assert failed and msg like 'The upper load must be higher%', format('upper without lower %s', msg);
  -- Explicit per_side false clears it.
  perform public.sync_workout_exercises(w, format('[{%s,"default_load_value":"170","default_load_unit":"lb","prescribed_load_max":"180","per_side":false}]', base)::jsonb);
  assert (select not per_side and prescribed_load_max = 180 from public.workout_exercises where id = we_id), 'explicit per_side false';
  failed := false;
  begin update public.workout_exercises set prescribed_load_max = 100 where id = we_id;
  exception when others then failed := true; msg := sqlerrm; end;
  assert failed, 'a direct write of a max below the load is refused';
  update public.workout_exercises set prescribed_load_max = 180, per_side = true where id = we_id;
  select * into we from public.workout_exercises where id = we_id;

  c := public.clone_workout(w, coach, null, true, null);
  assert (select prescribed_load_max is null and per_side from public.workout_exercises where workout_id = (c->>'workout_id')::uuid), 'client copy as template strips the range with the loads';
  c := public.clone_workout(w, coach, '00000000-0000-4000-8000-000000000011', false, null);
  assert (select prescribed_load_max = 180 and per_side from public.workout_exercises where workout_id = (c->>'workout_id')::uuid), 'client copy keeps range and per side';

  insert into public.workout_log_exercises(id, workout_log_id, exercise_library_id, exercise_name, position, source_workout_exercise_id, prescribed_load_value, prescribed_load_unit)
    values ('00000000-0000-4000-8000-0000000a0101', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000051', 'Snap', 9, we.id, 170, 'lb'),
           ('00000000-0000-4000-8000-0000000a0102', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000051', 'Override', 10, we.id, 200, 'lb'),
           ('00000000-0000-4000-8000-0000000a0103', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000051', 'Kg', 11, we.id, 170, 'kg');
  select * into le from public.workout_log_exercises where id = '00000000-0000-4000-8000-0000000a0101';
  assert le.prescribed_load_max = 180 and le.per_side, format('snapshot %s', to_jsonb(le));
  select * into le from public.workout_log_exercises where id = '00000000-0000-4000-8000-0000000a0102';
  assert le.prescribed_load_max is null and le.per_side, format('different load keeps single load %s', to_jsonb(le));
  select * into le from public.workout_log_exercises where id = '00000000-0000-4000-8000-0000000a0103';
  assert le.prescribed_load_max is null, format('different unit keeps single load %s', to_jsonb(le));
  -- An explicit per-client override equal to the authored lower load is still a
  -- single number: provenance, not equality, decides.
  insert into public.workout_assignment_exercise_loads(workout_assignment_id, workout_exercise_id, load_value, load_unit)
    values ('00000000-0000-4000-8000-00000000000b', we.id, 170, 'lb');
  insert into public.workout_log_exercises(id, workout_log_id, exercise_library_id, exercise_name, position, source_workout_exercise_id, prescribed_load_value, prescribed_load_unit)
    values ('00000000-0000-4000-8000-0000000a0104', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000051', 'Equal override', 12, we.id, 170, 'lb');
  select * into le from public.workout_log_exercises where id = '00000000-0000-4000-8000-0000000a0104';
  assert le.prescribed_load_max is null and le.per_side, format('equal override keeps single load %s', to_jsonb(le));

  -- A plan edit that moves a started exercise's load past its upper load clears
  -- the stale upper load instead of failing.
  update public.workout_log_exercises set prescribed_load_value = 190 where id = '00000000-0000-4000-8000-0000000a0101';
  assert (select prescribed_load_max is null from public.workout_log_exercises where id = '00000000-0000-4000-8000-0000000a0101'), 'started stale upper cleared';
  update public.workout_log_exercises set prescribed_load_max = 200 where id = '00000000-0000-4000-8000-0000000a0101';
  update public.workout_log_exercises set prescribed_load_unit = 'kg' where id = '00000000-0000-4000-8000-0000000a0101';
  assert (select prescribed_load_max is null from public.workout_log_exercises where id = '00000000-0000-4000-8000-0000000a0101'), 'started unit change clears upper';
end $$;

-- Program history shows a change that touches only these facts, and leaves
-- the snapshot of an exercise without them exactly as before.
do $$
declare
  we_id constant uuid := '00000000-0000-4000-8000-000000000061';
  p constant uuid := '00000000-0000-4000-8000-000000000006';
  before jsonb; after jsonb; ex jsonb;
begin
  if not exists (select 1 from public.program_days where program_id = p and workout_id = '00000000-0000-4000-8000-000000000005' and not archived) then
    insert into public.program_days(program_id, day_number, workout_id) values (p, 9, '00000000-0000-4000-8000-000000000005');
  end if;
  update public.workout_exercises set prescribed_load_max = null, per_side = false where id = we_id;
  before := public.program_history_snapshot(p);
  select e into ex from jsonb_path_query(before, '$.days[*].workout.exercises[*]') e where e->>'id' = we_id::text;
  assert ex is not null and not (ex ? 'prescribed_load_max') and not (ex ? 'per_side'), format('unset facts add no keys %s', ex);
  update public.workout_exercises set default_load_value = 170, default_load_unit = 'lb' where id = we_id;
  before := public.program_history_snapshot(p);
  update public.workout_exercises set prescribed_load_max = 180, per_side = true where id = we_id;
  after := public.program_history_snapshot(p);
  assert after is distinct from before, 'field-only change is visible';
  select e into ex from jsonb_path_query(after, '$.days[*].workout.exercises[*]') e where e->>'id' = we_id::text;
  assert (ex->>'per_side')::boolean and (ex->>'prescribed_load_max')::numeric = 180, format('facts in snapshot %s', ex);
end $$;
