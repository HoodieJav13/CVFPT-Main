-- Atomic replacement of compound workout/program records and serialized
-- append-only waiver version allocation. Backend service role only.

create or replace function public.save_workout(
  p_workout_id uuid,
  p_coach_id uuid,
  p_name text,
  p_description text,
  p_goal text,
  p_exercises jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_workout_id uuid;
  v_exercise jsonb;
  v_position integer := 0;
begin
  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'Workout name is required';
  end if;

  if p_workout_id is null then
    insert into public.workouts (coach_id, name, description, goal)
    values (p_coach_id, btrim(p_name), nullif(p_description, ''), nullif(p_goal, ''))
    returning id into v_workout_id;
  else
    update public.workouts
    set name = btrim(p_name),
        description = nullif(p_description, ''),
        goal = nullif(p_goal, ''),
        updated_at = now()
    where id = p_workout_id and archived = false
    returning id into v_workout_id;

    if not found then
      return null;
    end if;
  end if;

  update public.workout_exercises
  set archived = true
  where workout_id = v_workout_id and archived = false;

  for v_exercise in
    select value from jsonb_array_elements(coalesce(p_exercises, '[]'::jsonb))
  loop
    if nullif(v_exercise ->> 'exercise_library_id', '') is not null
       or btrim(coalesce(v_exercise ->> 'custom_name', v_exercise ->> 'name', '')) <> '' then
      insert into public.workout_exercises (
        workout_id, exercise_library_id, custom_name, sets, reps, rest, tempo,
        notes, client_notes, coach_notes, video_url, position
      ) values (
        v_workout_id,
        nullif(v_exercise ->> 'exercise_library_id', '')::uuid,
        nullif(coalesce(v_exercise ->> 'custom_name', v_exercise ->> 'name'), ''),
        nullif(v_exercise ->> 'sets', ''),
        nullif(v_exercise ->> 'reps', ''),
        nullif(v_exercise ->> 'rest', ''),
        nullif(v_exercise ->> 'tempo', ''),
        nullif(coalesce(v_exercise ->> 'client_notes', v_exercise ->> 'notes'), ''),
        nullif(coalesce(v_exercise ->> 'client_notes', v_exercise ->> 'notes'), ''),
        nullif(v_exercise ->> 'coach_notes', ''),
        nullif(v_exercise ->> 'video_url', ''),
        v_position
      );
      v_position := v_position + 1;
    end if;
  end loop;

  return v_workout_id;
end;
$$;

create or replace function public.save_program(
  p_program_id uuid,
  p_coach_id uuid,
  p_is_admin boolean,
  p_name text,
  p_description text,
  p_frequency_days integer,
  p_days jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_program_id uuid;
  v_day jsonb;
  v_workout_id uuid;
begin
  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'Program name is required';
  end if;
  if p_frequency_days not in (3, 4, 5) then
    raise exception 'Program frequency must be 3, 4, or 5';
  end if;
  if jsonb_array_length(coalesce(p_days, '[]'::jsonb)) <> p_frequency_days then
    raise exception 'Program day count must match frequency';
  end if;
  if (
    select count(distinct (value ->> 'day_number')::integer)
    from jsonb_array_elements(coalesce(p_days, '[]'::jsonb))
  ) <> p_frequency_days then
    raise exception 'Program day numbers must be unique';
  end if;

  for v_day in select value from jsonb_array_elements(p_days)
  loop
    v_workout_id := nullif(v_day ->> 'workout_id', '')::uuid;
    if not exists (
      select 1 from public.workouts
      where id = v_workout_id
        and archived = false
        and (p_is_admin or coach_id is null or coach_id = p_coach_id)
    ) then
      raise exception 'Workout not found';
    end if;
  end loop;

  if p_program_id is null then
    insert into public.programs (coach_id, name, description, frequency_days)
    values (p_coach_id, btrim(p_name), nullif(p_description, ''), p_frequency_days)
    returning id into v_program_id;
  else
    update public.programs
    set name = btrim(p_name),
        description = nullif(p_description, ''),
        frequency_days = p_frequency_days
    where id = p_program_id and archived = false
    returning id into v_program_id;

    if not found then
      return null;
    end if;
  end if;

  update public.program_days
  set archived = true
  where program_id = v_program_id and archived = false;

  for v_day in select value from jsonb_array_elements(p_days)
  loop
    insert into public.program_days (program_id, day_number, workout_id, notes, archived)
    values (
      v_program_id,
      (v_day ->> 'day_number')::integer,
      (v_day ->> 'workout_id')::uuid,
      nullif(v_day ->> 'notes', ''),
      false
    )
    on conflict (program_id, day_number) do update
    set workout_id = excluded.workout_id,
        notes = excluded.notes,
        archived = false;
  end loop;

  return v_program_id;
end;
$$;

create or replace function public.create_waiver_version(p_full_text text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_version public.waiver_versions%rowtype;
begin
  if btrim(coalesce(p_full_text, '')) = '' then
    raise exception 'Waiver text is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('cvf_pt_waiver_version', 0));

  insert into public.waiver_versions (version_number, full_text)
  select coalesce(max(version_number), 0) + 1, p_full_text
  from public.waiver_versions
  returning * into v_version;

  return to_jsonb(v_version);
end;
$$;

revoke execute on function public.save_workout(uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.save_program(uuid, uuid, boolean, text, text, integer, jsonb) from public, anon, authenticated;
revoke execute on function public.create_waiver_version(text) from public, anon, authenticated;

grant execute on function public.save_workout(uuid, uuid, text, text, text, jsonb) to service_role;
grant execute on function public.save_program(uuid, uuid, boolean, text, text, integer, jsonb) to service_role;
grant execute on function public.create_waiver_version(text) to service_role;
