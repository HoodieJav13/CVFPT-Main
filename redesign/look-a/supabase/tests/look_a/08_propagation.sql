-- Look A propagation (20261114130000): import, Rescue, backups, workout and
-- program substitution, and history carry the upper load and per side, and a
-- replacement's facts come from the replacement only.
do $$
declare
  coach constant uuid := '00000000-0000-4000-8000-000000000001';
  program constant uuid := '00000000-0000-4000-8000-000000000006';
  assignment constant uuid := '00000000-0000-4000-8000-000000000007';
  workout constant uuid := '00000000-0000-4000-8000-000000000005';
  original_we constant uuid := '00000000-0000-4000-8000-000000000061';
  log_a constant uuid := '00000000-0000-4000-8000-000000000021';
  coach_auth constant uuid := '00000000-0000-4000-8000-0000000000f1';
  r jsonb; o jsonb; v_before text; day1 uuid; ids uuid[]; failed boolean; msg text; imported uuid; row record;
begin
  -- 1. Import: load, unit, upper load and per side from the draft row.
  r := public.commit_program_import(coach, 'csv', jsonb_build_object(
    'program', jsonb_build_object('name', 'Fictional Imported', 'frequency_days', 1),
    'days', jsonb_build_array(jsonb_build_object('day_number', 1, 'name', 'Day A', 'exercises', jsonb_build_array(
      jsonb_build_object('name', 'Original', 'sets', '3', 'reps', '8', 'default_load_value', 170, 'default_load_unit', 'lb', 'prescribed_load_max', 180, 'per_side', true),
      jsonb_build_object('name', 'Replacement', 'sets', '3', 'reps', '10', 'default_load_value', 20, 'default_load_unit', 'kg', 'prescribed_load_max', 20),
      jsonb_build_object('name', 'Fictional Plain Row', 'sets', '2', 'reps', '12'))))));
  imported := (r->>'program_id')::uuid;
  select array_agg(e.id order by e.position) into ids from public.program_days d join public.workout_exercises e on e.workout_id = d.workout_id where d.program_id = imported;
  assert (select default_load_value = 170 and default_load_unit = 'lb' and prescribed_load_max = 180 and per_side from public.workout_exercises where id = ids[1]), 'range + per side imported';
  assert (select default_load_value = 20 and default_load_unit = 'kg' and prescribed_load_max is null and not per_side from public.workout_exercises where id = ids[2]), 'kg kept; equal upper is the single number';
  assert (select default_load_value is null and default_load_unit is null and prescribed_load_max is null and not per_side from public.workout_exercises where id = ids[3]), 'no load imported as none';
  failed := false;
  begin
    perform public.commit_program_import(coach, 'csv', jsonb_build_object(
      'program', jsonb_build_object('name', 'Fictional Bad Range', 'frequency_days', 1),
      'days', jsonb_build_array(jsonb_build_object('day_number', 1, 'exercises', jsonb_build_array(
        jsonb_build_object('name', 'Original', 'default_load_value', 170, 'default_load_unit', 'lb', 'prescribed_load_max', 160))))));
  exception when others then failed := true; msg := sqlerrm; end;
  assert failed and msg like 'The upper load must be higher%', format('invalid range refused %s', msg);
  assert not exists (select 1 from public.programs where name = 'Fictional Bad Range'), 'nothing saved';

  -- 2. Rescue: present only when set (saved plans stay current), and an override drops the range.
  select id into day1 from public.program_days where program_id = program and day_number = 1;
  o := public.workout_rescue_original(program, day1);
  assert not (o #> '{workout,exercises,0}' ? 'prescribed_load_max') and not (o #> '{workout,exercises,0}' ? 'per_side'), 'absent when unset';
  v_before := md5(o::text);
  update public.workout_exercises set default_load_value = 170, default_load_unit = 'lb' where id = original_we;
  v_before := md5(public.workout_rescue_original(program, day1)::text);
  update public.workout_exercises set prescribed_load_max = 180, per_side = true where id = original_we;
  o := public.workout_rescue_original(program, day1);
  assert (o #>> '{workout,exercises,0,prescribed_load_max}')::numeric = 180 and (o #>> '{workout,exercises,0,per_side}')::boolean, format('present when set %s', o #> '{workout,exercises,0}');
  assert md5(o::text) <> v_before, 'a real prescription change marks a saved plan stale';
  insert into auth.users(id, email) values (coach_auth, 'coach-auth@example.invalid');
  update public.coaches set auth_user_id = coach_auth where id = coach;
  r := public.read_workout_rescue(program, day1, coach_auth, assignment);
  assert (r #>> '{original,workout,exercises,0,prescribed_load_max}')::numeric = 180, 'no override: range shown';
  insert into public.program_assignment_exercise_loads(program_assignment_id, program_day_id, workout_exercise_id, load_value, load_unit)
    values (assignment, day1, original_we, 150, 'lb');
  r := public.read_workout_rescue(program, day1, coach_auth, assignment);
  assert (r #>> '{original,workout,exercises,0,default_load_value}')::numeric = 150 and not (r #> '{original,workout,exercises,0}' ? 'prescribed_load_max'),
    format('override is a single number %s', r #> '{original,workout,exercises,0}');
  assert (r #>> '{original,workout,exercises,0,per_side}')::boolean, 'per side still shown';
  update public.program_assignment_exercise_loads set archived = true where workout_exercise_id = original_we;

  -- 3. Backups: an upper load needs a lower one below it.
  failed := false;
  begin insert into public.workout_exercise_backups(workout_exercise_id, backup_exercise_library_id, target_load_value, target_load_unit, target_load_max, created_by_coach_id)
    values (original_we, '00000000-0000-4000-8000-000000000052', 50, 'lb', 40, coach);
  exception when check_violation then failed := true; end;
  assert failed, 'backup range checked';
  insert into public.workout_exercise_backups(workout_exercise_id, backup_exercise_library_id, target_load_value, target_load_unit, target_load_max, target_per_side, created_by_coach_id)
    values (original_we, '00000000-0000-4000-8000-000000000052', 50, 'lb', 60, true, coach);

  -- 4a. Workout substitution: the replacement's own facts only. The original
  -- log exercise is per side with a range; a replacement without them gets none.
  update public.workout_log_exercises set prescribed_load_value = 170, prescribed_load_unit = 'lb', prescribed_load_max = 180, per_side = true
    where id = '00000000-0000-4000-8000-000000000031';
  update public.workout_log_substitutions set targets = '{"sets":2,"reps":"8","load_value":50,"load_unit":"kg","load_max":60,"per_side":true}'
    where id = '00000000-0000-4000-8000-000000000071';
  update public.workout_log_substitutions set targets = '{"sets":2,"reps":"8","load_value":50,"load_unit":"lb","load_max":50}'
    where id = '00000000-0000-4000-8000-000000000072';
  r := public.decide_workout_substitution(log_a, '00000000-0000-4000-8000-000000000071', 'approve', '00000000-0000-4000-8000-000000000301', coach);
  r := public.decide_workout_substitution(log_a, '00000000-0000-4000-8000-000000000072', 'approve', '00000000-0000-4000-8000-000000000302', coach);
  assert (select prescribed_load_value = 50 and prescribed_load_unit = 'kg' and prescribed_load_max = 60 and per_side
          from public.workout_log_exercises where id = '00000000-0000-4000-8000-000000000041'), 'replacement range + per side from its targets (kg kept)';
  assert (select prescribed_load_value = 50 and prescribed_load_max is null and not per_side
          from public.workout_log_exercises where id = '00000000-0000-4000-8000-000000000043'), 'nothing inherited; equal upper is none';
  assert (select prescribed_load_max = 180 and per_side from public.workout_log_exercises where id = '00000000-0000-4000-8000-000000000031'), 'original unchanged';

  -- 4b. Program substitution: from the coach's targets only.
  select array_agg(workout_exercise_id order by day_number) into ids from public.program_substitution_targets(assignment, '00000000-0000-4000-8000-000000000051', 'Original');
  r := public.apply_program_substitution('00000000-0000-4000-8000-000000000303', assignment, '00000000-0000-4000-8000-000000000073', coach, ids,
    '{"sets":2,"reps":"8","load_value":30,"load_unit":"kg","load_max":35,"per_side":true}');
  assert r->>'outcome' = 'applied', format('apply %s', r);
  select * into row from public.workout_exercises where workout_id = workout and not archived;
  assert row.exercise_library_id = '00000000-0000-4000-8000-000000000052' and row.default_load_value = 30 and row.default_load_unit = 'kg'
    and row.prescribed_load_max = 35 and row.per_side, format('replacement prescription %s', to_jsonb(row));
  -- Without per side / upper load in the targets, the original's never carry over.
  update public.workout_exercises set exercise_library_id = '00000000-0000-4000-8000-000000000051', prescribed_load_max = 40, per_side = true, default_load_value = 30 where id = row.id;
  update public.workout_log_substitutions set status = 'active' where id = '00000000-0000-4000-8000-000000000071';
  select array_agg(workout_exercise_id order by day_number) into ids from public.program_substitution_targets(assignment, '00000000-0000-4000-8000-000000000051', 'Original');
  r := public.apply_program_substitution('00000000-0000-4000-8000-000000000304', assignment, '00000000-0000-4000-8000-000000000071', coach, ids,
    '{"sets":2,"reps":"8","load_value":30,"load_unit":"lb"}');
  select * into row from public.workout_exercises where workout_id = workout and not archived;
  assert row.prescribed_load_max is null and not row.per_side and row.default_load_unit = 'lb', format('nothing inherited %s', to_jsonb(row));

  -- 5. History v3: each performed occurrence with its own prescription.
  update public.workout_log_sets set status = 'completed', actual_reps = 8, actual_load_value = 175, actual_load_unit = 'lb', completed_at = now()
    where workout_log_exercise_id = '00000000-0000-4000-8000-000000000031';
  insert into public.workout_log_sets(workout_log_exercise_id, set_number, status, actual_reps, actual_load_value, actual_load_unit, completed_at)
    select '00000000-0000-4000-8000-000000000031', 1, 'completed', 8, 175, 'lb', now()
    where not exists (select 1 from public.workout_log_sets where workout_log_exercise_id = '00000000-0000-4000-8000-000000000031');
  update public.workout_logs set status = 'completed', completed_at = now() where id = log_a;
  select * into row from public.get_workout_exercise_history_v3('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000051', null) h
    where h.workout_log_exercise_id = '00000000-0000-4000-8000-000000000031' limit 1;
  assert row.prescribed_load_value = 170 and row.prescribed_load_unit = 'lb' and row.prescribed_load_max = 180 and row.per_side and row.actual_load_value = 175,
    format('history v3 %s', to_jsonb(row));
  assert (select count(*) from public.get_workout_exercise_history_v3('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000051', null))
       = (select count(*) from public.get_workout_exercise_history_v2('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000051', null)), 'same rows as v2';
end $$;
