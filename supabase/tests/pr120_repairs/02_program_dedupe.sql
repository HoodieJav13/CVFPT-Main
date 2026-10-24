-- Review 4366537642: a workout reused on two program days is replaced once.
do $$
declare
  a constant uuid := '00000000-0000-4000-8000-000000000007';
  s constant uuid := '00000000-0000-4000-8000-000000000073';
  c constant uuid := '00000000-0000-4000-8000-000000000001';
  w constant uuid := '00000000-0000-4000-8000-000000000005';
  ids uuid[]; r jsonb; n integer; days text; failed boolean;
begin
  select array_agg(workout_exercise_id order by day_number) into ids from public.program_substitution_targets(a, '00000000-0000-4000-8000-000000000051', 'Original');
  assert array_length(ids, 1) = 2 and ids[1] = ids[2], format('preview should list the one physical row once per day: %s', ids);
  -- A preview that does not list every day is refused before any change.
  failed := false;
  begin
    perform public.apply_program_substitution('00000000-0000-4000-8000-000000000202', a, s, c, array[ids[1]], '{}'::jsonb);
  exception when others then failed := sqlerrm like '%preview_mismatch%';
  end;
  assert failed, 'partial preview must be refused';
  select count(*) into n from public.workout_exercises where workout_id = w and not archived;
  assert n = 1;

  r := public.apply_program_substitution('00000000-0000-4000-8000-000000000201', a, s, c, ids, '{"sets":2,"reps":"8"}'::jsonb);
  assert r->>'outcome' = 'applied', format('apply %s', r);
  select count(*) into n from public.workout_exercises where workout_id = w and not archived;
  assert n = 1, format('expected exactly one active exercise in the reused workout, found %s', n);
  select count(*) into n from public.workout_exercises where workout_id = w and not archived and exercise_library_id = '00000000-0000-4000-8000-000000000052';
  assert n = 1, 'the remaining active exercise is the replacement';
  select count(*) into n from public.workout_exercises where id = ids[1] and archived;
  assert n = 1, 'the original is archived (soft)';
  -- Audit keeps both days.
  select string_agg(e->>'day_number', ',' order by (e->>'day_number')::int) into days from jsonb_array_elements(r->'application'->'affected') e;
  assert days = '1,2', format('per-day audit %s', days);
  -- Replay by application id: same answer, nothing new.
  r := public.apply_program_substitution('00000000-0000-4000-8000-000000000201', a, s, c, ids, '{"sets":2,"reps":"8"}'::jsonb);
  assert r->>'outcome' = 'replayed', format('replay %s', r);
  select count(*) into n from public.workout_exercises where workout_id = w and not archived;
  assert n = 1;
  -- A stale preview (new application id, old ids) is refused.
  failed := false;
  begin
    perform public.apply_program_substitution('00000000-0000-4000-8000-000000000203', a, s, c, ids, '{}'::jsonb);
  exception when others then failed := sqlerrm like '%preview_mismatch%';
  end;
  assert failed, 'stale preview must be refused';
  select count(*) into n from public.workout_exercises where workout_id = w;
  assert n = 2, format('exactly original + one replacement exist, found %s', n);
  -- Completed history (the logged exercise) is unchanged.
  select count(*) into n from public.workout_log_exercises where id = '00000000-0000-4000-8000-000000000031' and not archived
    and exercise_library_id = '00000000-0000-4000-8000-000000000051' and source_workout_exercise_id = ids[1];
  assert n = 1, 'logged history changed';
end $$;
