-- Pasted programs may contain one to five workout days. Keep the table and
-- both transactional program-write paths aligned with that accepted domain.
alter table public.programs
  drop constraint if exists programs_frequency_days_check;

alter table public.programs
  add constraint programs_frequency_days_check
  check (frequency_days between 1 and 5);

create or replace function public.commit_program_import(
  p_coach_id uuid,
  p_source text,
  p_draft jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_program_id uuid;
  v_workout_id uuid;
  v_exercise_id uuid;
  v_day jsonb;
  v_exercise jsonb;
  v_created jsonb := '[]'::jsonb;
  v_reused jsonb := '[]'::jsonb;
  v_warnings jsonb := coalesce(p_draft #> '{import_meta,warnings}', '[]'::jsonb);
  v_program_name text := btrim(coalesce(p_draft #>> '{program,name}', ''));
  v_frequency integer := (p_draft #>> '{program,frequency_days}')::integer;
  v_day_count integer := jsonb_array_length(coalesce(p_draft -> 'days', '[]'::jsonb));
  v_normalized_name text;
begin
  if v_program_name = '' then
    raise exception 'Program name is required';
  end if;
  if v_frequency is null or v_frequency < 1 or v_frequency > 5 then
    raise exception 'Program frequency must be between 1 and 5';
  end if;
  if v_day_count <> v_frequency then
    raise exception 'Program day count must match frequency';
  end if;

  insert into public.programs (coach_id, name, description, frequency_days)
  values (
    p_coach_id,
    v_program_name,
    nullif(p_draft #>> '{program,description}', ''),
    v_frequency
  )
  returning id into v_program_id;

  for v_day in select * from jsonb_array_elements(p_draft -> 'days')
  loop
    insert into public.workouts (coach_id, name, description, goal)
    values (
      p_coach_id,
      coalesce(nullif(v_day ->> 'name', ''), 'Day ' || (v_day ->> 'day_number')),
      nullif(v_day ->> 'notes', ''),
      nullif(v_day ->> 'goal', '')
    )
    returning id into v_workout_id;

    for v_exercise in
      select * from jsonb_array_elements(coalesce(v_day -> 'exercises', '[]'::jsonb))
    loop
      v_normalized_name := regexp_replace(
        lower(btrim(coalesce(v_exercise ->> 'name', ''))),
        '\s+',
        ' ',
        'g'
      );
      if v_normalized_name = '' then
        raise exception 'Exercise name is required';
      end if;

      select id into v_exercise_id
      from public.exercise_library
      where archived = false
        and regexp_replace(lower(btrim(name)), '\s+', ' ', 'g') = v_normalized_name
      order by created_at asc
      limit 1;

      if v_exercise_id is null then
        insert into public.exercise_library (
          name,
          category,
          equipment,
          primary_muscle,
          video_url,
          notes,
          source,
          review_status
        )
        values (
          btrim(v_exercise ->> 'name'),
          nullif(v_exercise ->> 'category', ''),
          nullif(v_exercise ->> 'equipment', ''),
          nullif(v_exercise ->> 'primary_muscle', ''),
          nullif(v_exercise ->> 'video_url', ''),
          nullif(v_exercise ->> 'client_notes', ''),
          p_source,
          'needs_review'
        )
        returning id into v_exercise_id;
        v_created := v_created || jsonb_build_array(
          jsonb_build_object('id', v_exercise_id, 'name', btrim(v_exercise ->> 'name'))
        );
      else
        v_reused := v_reused || jsonb_build_array(
          jsonb_build_object('id', v_exercise_id, 'name', btrim(v_exercise ->> 'name'))
        );
      end if;

      insert into public.workout_exercises (
        workout_id,
        exercise_library_id,
        custom_name,
        sets,
        reps,
        rest,
        tempo,
        notes,
        client_notes,
        coach_notes,
        video_url,
        position
      )
      values (
        v_workout_id,
        v_exercise_id,
        btrim(v_exercise ->> 'name'),
        nullif(v_exercise ->> 'sets', ''),
        nullif(v_exercise ->> 'reps', ''),
        nullif(v_exercise ->> 'rest', ''),
        nullif(v_exercise ->> 'tempo', ''),
        nullif(v_exercise ->> 'client_notes', ''),
        nullif(v_exercise ->> 'client_notes', ''),
        nullif(v_exercise ->> 'coach_notes', ''),
        nullif(v_exercise ->> 'video_url', ''),
        coalesce((
          select count(*)
          from public.workout_exercises
          where workout_id = v_workout_id
        ), 0)
      );
    end loop;

    insert into public.program_days (program_id, day_number, workout_id, notes)
    values (
      v_program_id,
      (v_day ->> 'day_number')::integer,
      v_workout_id,
      nullif(v_day ->> 'notes', '')
    );
  end loop;

  return jsonb_build_object(
    'program_id', v_program_id,
    'created_exercises', v_created,
    'reused_exercises', v_reused,
    'warnings', v_warnings
  );
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
  if p_frequency_days is null or p_frequency_days < 1 or p_frequency_days > 5 then
    raise exception 'Program frequency must be between 1 and 5';
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

revoke execute on function public.commit_program_import(uuid, text, jsonb)
  from public, anon, authenticated;
revoke execute on function public.save_program(uuid, uuid, boolean, text, text, integer, jsonb)
  from public, anon, authenticated;

grant execute on function public.commit_program_import(uuid, text, jsonb)
  to service_role;
grant execute on function public.save_program(uuid, uuid, boolean, text, text, integer, jsonb)
  to service_role;
