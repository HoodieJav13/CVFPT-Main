\set ON_ERROR_STOP on

do $$
declare
  v_started jsonb;
  v_new_log uuid;
  v_count integer;
begin
  if (select exercise_library_id from public.workout_log_exercises where id = '80000000-0000-4000-8000-000000000001')
      <> '30000000-0000-4000-8000-000000000001'::uuid then
    raise exception 'legacy identity backfill failed';
  end if;

  v_started := public.start_workout_log(
    '20000000-0000-4000-8000-000000000001', null, null,
    '60000000-0000-4000-8000-000000000001'
  );
  v_new_log := (v_started ->> 'workout_log_id')::uuid;
  if (select exercise_library_id from public.workout_log_exercises where workout_log_id = v_new_log)
      <> '30000000-0000-4000-8000-000000000001'::uuid then
    raise exception 'current start snapshot failed';
  end if;

  select count(*) into v_count
  from public.get_workout_exercise_history(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001', null, null, null, 11
  );
  if v_count <> 1 then raise exception 'completed-only history expected 1 row, got %', v_count; end if;

  begin
    update public.workout_log_sets set actual_reps = -1
    where workout_log_exercise_id in (select id from public.workout_log_exercises where workout_log_id = v_new_log);
    raise exception 'negative reps unexpectedly accepted';
  exception when check_violation then null;
  end;
  begin
    update public.workout_log_sets set actual_rpe = 7.25
    where workout_log_exercise_id in (select id from public.workout_log_exercises where workout_log_id = v_new_log);
    raise exception 'quarter-step RPE unexpectedly accepted';
  exception when check_violation then null;
  end;
  begin
    update public.workout_log_exercises set exercise_name = 'Mutated'
    where id = '80000000-0000-4000-8000-000000000001';
    raise exception 'completed exercise unexpectedly mutable';
  exception when raise_exception then
    if sqlerrm <> 'Completed workout logs are immutable' then raise; end if;
  end;

  if has_function_privilege('authenticated', 'public.get_workout_exercise_history(uuid,uuid,uuid,timestamptz,uuid,integer)', 'execute') then
    raise exception 'authenticated unexpectedly has history execute';
  end if;
  if not has_function_privilege('service_role', 'public.get_workout_exercise_history(uuid,uuid,uuid,timestamptz,uuid,integer)', 'execute') then
    raise exception 'service_role missing history execute';
  end if;
end;
$$;

select 'exercise history migration assertions passed' as result;
