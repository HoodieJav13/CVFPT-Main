begin;

do $$
declare
  v_coach_id uuid := gen_random_uuid();
  v_library_id uuid := gen_random_uuid();
  v_result jsonb;
  v_draft jsonb;
  v_reused_id uuid;
begin
  insert into public.coaches (id, name, email)
  values (v_coach_id, 'Import Choice Coach', 'import-choice@example.com');
  insert into public.exercise_library (id, name, video_url, notes)
  values (v_library_id, 'Bench Press (DB)', 'https://example.com/bench', 'Existing coaching note');

  v_draft := jsonb_build_object(
    'program', jsonb_build_object('name', 'Use Existing Choice', 'frequency_days', 1),
    'days', jsonb_build_array(jsonb_build_object(
      'day_number', 1,
      'name', 'Day 1',
      'exercises', jsonb_build_array(jsonb_build_object(
        'name', 'DB Bench Press',
        'sets', '3',
        'reps', '8',
        'exercise_library_id', v_library_id
      ))
    )),
    'import_meta', jsonb_build_object('source_type', 'paste', 'warnings', jsonb_build_array())
  );
  v_result := public.commit_program_import(v_coach_id, 'manual', v_draft);
  select exercise_library_id into v_reused_id
  from public.workout_exercises
  where workout_id in (
    select workout_id from public.program_days
    where program_id = (v_result ->> 'program_id')::uuid
  );
  if v_reused_id is distinct from v_library_id
    or jsonb_array_length(v_result -> 'created_exercises') <> 0
    or jsonb_array_length(v_result -> 'reused_exercises') <> 1 then
    raise exception 'Explicit existing-exercise choice was not honored: %', v_result;
  end if;

  begin
    v_draft := jsonb_set(
      v_draft,
      '{program,name}',
      to_jsonb('Unavailable Choice'::text)
    );
    v_draft := jsonb_set(
      v_draft,
      '{days,0,exercises,0,exercise_library_id}',
      to_jsonb(gen_random_uuid())
    );
    perform public.commit_program_import(v_coach_id, 'manual', v_draft);
    raise exception 'Expected unavailable selected exercise to be rejected';
  exception
    when others then
      if sqlerrm not like 'Selected exercise is unavailable%' then raise; end if;
  end;
end;
$$;

select 'program import exercise choice scenarios passed' as result;

rollback;
