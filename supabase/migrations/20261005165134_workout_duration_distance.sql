-- Additive explicit workout tracking. Legacy rows retain reps/weight semantics.
-- Rollback: revert application code, KEEP columns and recorded values.
create or replace function public.valid_workout_metric(p_value numeric, p_unit text, p_metric text)
returns boolean language sql immutable security invoker set search_path = '' as $$
  select (p_value is null and p_unit is null) or coalesce(
    p_value > 0 and p_value * case
      when p_metric = 'duration' and p_unit = 's' then 1
      when p_metric = 'duration' and p_unit = 'min' then 60
      when p_metric = 'distance' and p_unit = 'm' then 1
      when p_metric = 'distance' and p_unit = 'km' then 1000
      when p_metric = 'distance' and p_unit = 'mi' then 1609.344
      when p_metric = 'distance' and p_unit = 'yd' then 0.9144
      else null end <= case when p_metric = 'duration' then 86400 else 1000000 end, false);
$$;

alter table public.workout_exercises
  add column tracking_type text not null default 'reps_weight' check (tracking_type in ('reps_weight','duration','distance','duration_distance')),
  add column duration_value numeric,
  add column duration_unit text,
  add column distance_value numeric,
  add column distance_unit text,
  add constraint workout_exercises_duration_check check (public.valid_workout_metric(duration_value, duration_unit, 'duration') and (duration_value is null or tracking_type in ('duration','duration_distance'))),
  add constraint workout_exercises_distance_check check (public.valid_workout_metric(distance_value, distance_unit, 'distance') and (distance_value is null or tracking_type in ('distance','duration_distance')));

alter table public.workout_log_exercises
  add column tracking_type text not null default 'reps_weight' check (tracking_type in ('reps_weight','duration','distance','duration_distance')),
  add column prescribed_duration_value numeric,
  add column prescribed_duration_unit text,
  add column prescribed_distance_value numeric,
  add column prescribed_distance_unit text,
  add constraint workout_log_exercises_duration_check check (public.valid_workout_metric(prescribed_duration_value, prescribed_duration_unit, 'duration') and (prescribed_duration_value is null or tracking_type in ('duration','duration_distance'))),
  add constraint workout_log_exercises_distance_check check (public.valid_workout_metric(prescribed_distance_value, prescribed_distance_unit, 'distance') and (prescribed_distance_value is null or tracking_type in ('distance','duration_distance')));

alter table public.workout_log_sets
  add column actual_duration_value numeric,
  add column actual_duration_unit text,
  add column actual_distance_value numeric,
  add column actual_distance_unit text,
  add constraint workout_log_sets_duration_check check (public.valid_workout_metric(actual_duration_value, actual_duration_unit, 'duration')),
  add constraint workout_log_sets_distance_check check (public.valid_workout_metric(actual_distance_value, actual_distance_unit, 'distance'));

-- INSERT only. Never backfill a historical mode from a mutable source.
-- Current start_workout_log/v2 authorization, locks and idempotency are unchanged.
create or replace function public.fill_workout_log_exercise_metrics()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.source_workout_exercise_id is not null then
    select tracking_type, duration_value, duration_unit, distance_value, distance_unit
      into new.tracking_type, new.prescribed_duration_value, new.prescribed_duration_unit,
           new.prescribed_distance_value, new.prescribed_distance_unit
    from public.workout_exercises where id = new.source_workout_exercise_id;
    if not found then new.tracking_type := 'reps_weight'; end if;
  end if;
  return new;
end;
$$;
create trigger fill_workout_log_exercise_metrics before insert on public.workout_log_exercises
for each row execute function public.fill_workout_log_exercise_metrics();

create or replace function public.check_workout_set_metrics()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_type text;
begin
  select tracking_type into v_type from public.workout_log_exercises where id = new.workout_log_exercise_id;
  if (new.actual_duration_value is not null and v_type not in ('duration','duration_distance'))
     or (new.actual_distance_value is not null and v_type not in ('distance','duration_distance'))
     or (new.actual_reps is not null and v_type <> 'reps_weight') then
    raise exception 'Performed metrics do not match the snapshotted tracking type' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger check_workout_set_metrics before insert or update on public.workout_log_sets
for each row execute function public.check_workout_set_metrics();

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
  v_existing public.workout_exercises%rowtype;
  v_exercise_id uuid;
  v_library_id uuid;
  v_custom_name text;
  v_position integer := 0;
  v_kept_ids uuid[] := array[]::uuid[];
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
    if not found then return null; end if;
  end if;

  for v_exercise in select value from jsonb_array_elements(coalesce(p_exercises, '[]'::jsonb))
  loop
    v_library_id := nullif(v_exercise ->> 'exercise_library_id', '')::uuid;
    v_custom_name := nullif(coalesce(v_exercise ->> 'custom_name', v_exercise ->> 'name'), '');
    if v_library_id is not null or btrim(coalesce(v_custom_name, '')) <> '' then
      v_exercise_id := nullif(v_exercise ->> 'id', '')::uuid;
      v_existing.id := null;
      if v_exercise_id is not null then
        select * into v_existing
        from public.workout_exercises
        where id = v_exercise_id and workout_id = v_workout_id and archived = false;
      end if;

      if v_existing.id is not null and (
        (v_existing.exercise_library_id is not null and v_existing.exercise_library_id = v_library_id)
        or
        (v_existing.exercise_library_id is null and v_library_id is null
          and lower(btrim(coalesce(v_existing.custom_name, ''))) = lower(btrim(coalesce(v_custom_name, ''))))
      ) then
        update public.workout_exercises
        set exercise_library_id = v_library_id,
            custom_name = v_custom_name,
            sets = nullif(v_exercise ->> 'sets', ''),
            reps = nullif(v_exercise ->> 'reps', ''),
            rest = nullif(v_exercise ->> 'rest', ''),
            tempo = nullif(v_exercise ->> 'tempo', ''),
            target_rpe = nullif(v_exercise ->> 'target_rpe', ''),
            default_load_value = nullif(v_exercise ->> 'default_load_value', '')::numeric,
            default_load_unit = case when nullif(v_exercise ->> 'default_load_value', '') is null then null else coalesce(nullif(v_exercise ->> 'default_load_unit', ''), 'lb') end,
            notes = nullif(coalesce(v_exercise ->> 'client_notes', v_exercise ->> 'notes'), ''),
            client_notes = nullif(coalesce(v_exercise ->> 'client_notes', v_exercise ->> 'notes'), ''),
            coach_notes = nullif(v_exercise ->> 'coach_notes', ''),
            video_url = nullif(v_exercise ->> 'video_url', ''),
            superset_group = nullif(btrim(coalesce(v_exercise ->> 'superset_group', '')), ''),
            tracking_type = case when v_exercise ? 'tracking_type' then coalesce(v_exercise ->> 'tracking_type', 'reps_weight') else v_existing.tracking_type end,
            duration_value = case when v_exercise ? 'duration_value' then nullif(v_exercise ->> 'duration_value', '')::numeric else v_existing.duration_value end,
            duration_unit = case when v_exercise ? 'duration_unit' then nullif(v_exercise ->> 'duration_unit', '') else v_existing.duration_unit end,
            distance_value = case when v_exercise ? 'distance_value' then nullif(v_exercise ->> 'distance_value', '')::numeric else v_existing.distance_value end,
            distance_unit = case when v_exercise ? 'distance_unit' then nullif(v_exercise ->> 'distance_unit', '') else v_existing.distance_unit end,
            position = v_position
        where id = v_existing.id;
        v_exercise_id := v_existing.id;
      else
        insert into public.workout_exercises (
          workout_id, exercise_library_id, custom_name, sets, reps, rest, tempo, target_rpe,
          default_load_value, default_load_unit, notes, client_notes, coach_notes, video_url, position,
          superset_group, tracking_type, duration_value, duration_unit, distance_value, distance_unit
        ) values (
          v_workout_id, v_library_id, v_custom_name,
          nullif(v_exercise ->> 'sets', ''), nullif(v_exercise ->> 'reps', ''),
          nullif(v_exercise ->> 'rest', ''), nullif(v_exercise ->> 'tempo', ''),
          nullif(v_exercise ->> 'target_rpe', ''),
          nullif(v_exercise ->> 'default_load_value', '')::numeric,
          case when nullif(v_exercise ->> 'default_load_value', '') is null then null else coalesce(nullif(v_exercise ->> 'default_load_unit', ''), 'lb') end,
          nullif(coalesce(v_exercise ->> 'client_notes', v_exercise ->> 'notes'), ''),
          nullif(coalesce(v_exercise ->> 'client_notes', v_exercise ->> 'notes'), ''),
          nullif(v_exercise ->> 'coach_notes', ''), nullif(v_exercise ->> 'video_url', ''), v_position,
          nullif(btrim(coalesce(v_exercise ->> 'superset_group', '')), ''),
          coalesce(v_exercise ->> 'tracking_type', 'reps_weight'), nullif(v_exercise ->> 'duration_value', '')::numeric, nullif(v_exercise ->> 'duration_unit', ''), nullif(v_exercise ->> 'distance_value', '')::numeric, nullif(v_exercise ->> 'distance_unit', '')
        ) returning id into v_exercise_id;
      end if;
      v_kept_ids := array_append(v_kept_ids, v_exercise_id);
      v_position := v_position + 1;
    end if;
  end loop;

  update public.workout_exercises
  set archived = true
  where workout_id = v_workout_id and archived = false and not (id = any(v_kept_ids));

  update public.program_assignment_exercise_loads l
  set archived = true, updated_at = now()
  where archived = false and exists (
    select 1 from public.workout_exercises we where we.id = l.workout_exercise_id and we.archived = true
  );
  update public.workout_assignment_exercise_loads l
  set archived = true, updated_at = now()
  where archived = false and exists (
    select 1 from public.workout_exercises we where we.id = l.workout_exercise_id and we.archived = true
  );

  return v_workout_id;
end;
$$;

create or replace function public.clone_workout(
  p_workout_id uuid,
  p_coach_id uuid,
  p_client_id uuid,
  p_as_template boolean,
  p_variation_of uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_src public.workouts%rowtype;
  v_new_id uuid;
  v_ex public.workout_exercises%rowtype;
  v_new_ex uuid;
  v_map jsonb := '{}'::jsonb;
  v_strip boolean;
begin
  select * into v_src from public.workouts where id = p_workout_id and archived = false;
  if not found then
    raise exception 'Workout not found';
  end if;
  v_strip := p_as_template and not v_src.is_template;

  if p_as_template then
    insert into public.workouts (
      coach_id, name, description, goal, is_template, client_id,
      source_workout_id, variation_of, hidden, created_by
    ) values (
      p_coach_id, v_src.name, v_src.description, v_src.goal, true, null,
      v_src.id, p_variation_of, true, p_coach_id
    ) returning id into v_new_id;
  else
    insert into public.workouts (
      coach_id, name, description, goal, is_template, client_id, source_workout_id
    ) values (
      p_coach_id, v_src.name, v_src.description, v_src.goal, false, p_client_id, v_src.id
    ) returning id into v_new_id;
  end if;

  for v_ex in
    select * from public.workout_exercises
    where workout_id = p_workout_id and archived = false
    order by position, created_at
  loop
    insert into public.workout_exercises (
      workout_id, exercise_library_id, custom_name, sets, reps, rest, rest_seconds, tempo,
      target_rpe, default_load_value, default_load_unit, notes, client_notes, coach_notes,
      video_url, position, superset_group, tracking_type, duration_value, duration_unit, distance_value, distance_unit
    ) values (
      v_new_id, v_ex.exercise_library_id, v_ex.custom_name, v_ex.sets, v_ex.reps, v_ex.rest,
      v_ex.rest_seconds, v_ex.tempo, v_ex.target_rpe,
      case when v_strip then null else v_ex.default_load_value end,
      case when v_strip then null else v_ex.default_load_unit end,
      v_ex.notes, v_ex.client_notes,
      case when v_strip then null else v_ex.coach_notes end,
      v_ex.video_url, v_ex.position, v_ex.superset_group, v_ex.tracking_type, v_ex.duration_value, v_ex.duration_unit, v_ex.distance_value, v_ex.distance_unit
    ) returning id into v_new_ex;
    v_map := v_map || jsonb_build_object(v_ex.id::text, v_new_ex);
  end loop;

  return jsonb_build_object('workout_id', v_new_id, 'exercise_map', v_map);
end;
$$;

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

  -- Serialize normalized-name lookup/insert so concurrent imports cannot
  -- create duplicate exercise_library rows.
  perform pg_advisory_xact_lock(hashtextextended('cvf_exercise_library', 0));

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
      v_exercise_id := null;
      v_normalized_name := regexp_replace(
        lower(btrim(coalesce(v_exercise ->> 'name', ''))),
        '\s+',
        ' ',
        'g'
      );
      if v_normalized_name = '' then
        raise exception 'Exercise name is required';
      end if;

      if nullif(v_exercise ->> 'exercise_library_id', '') is not null then
        begin
          select id into v_exercise_id
          from public.exercise_library
          where id = (v_exercise ->> 'exercise_library_id')::uuid
            and archived = false;
        exception
          when invalid_text_representation then
            raise exception 'Selected exercise is invalid';
        end;
        if v_exercise_id is null then
          raise exception 'Selected exercise is unavailable';
        end if;
      else
        select id into v_exercise_id
        from public.exercise_library
        where archived = false
          and regexp_replace(lower(btrim(name)), '\s+', ' ', 'g') = v_normalized_name
        order by created_at asc
        limit 1;
      end if;

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
        position, tracking_type, duration_value, duration_unit, distance_value, distance_unit
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
        ), 0),
        coalesce(v_exercise ->> 'tracking_type', 'reps_weight'), nullif(v_exercise ->> 'duration_value', '')::numeric, nullif(v_exercise ->> 'duration_unit', ''), nullif(v_exercise ->> 'distance_value', '')::numeric, nullif(v_exercise ->> 'distance_unit', '')
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

create or replace function public.get_workout_exercise_history_v2(
  p_client_id uuid,
  p_exercise_library_id uuid,
  p_source_workout_exercise_id uuid,
  p_before_completed_at timestamptz default null,
  p_before_log_id uuid default null,
  p_occurrence_limit integer default 11
)
returns table (
  workout_log_id uuid,
  completed_at timestamptz,
  exercise_name text,
  set_number integer,
  actual_load_value numeric,
  actual_load_unit text,
  actual_reps integer,
  actual_rpe numeric,
  tracking_type text,
  actual_duration_value numeric, actual_duration_unit text,
  actual_distance_value numeric, actual_distance_unit text
)
language sql
security invoker
set search_path = ''
as $$
  with occurrences as (
    select l.id, l.completed_at
    from public.workout_logs l
    where l.client_id = p_client_id
      and l.status = 'completed'
      and l.archived = false
      and (p_before_completed_at is null or (l.completed_at, l.id) < (p_before_completed_at, p_before_log_id))
      and exists (
        select 1 from public.workout_log_exercises e
        join public.workout_log_sets s on s.workout_log_exercise_id = e.id
          and s.archived = false and s.status = 'completed'
        where e.workout_log_id = l.id and e.archived = false
          and ((p_exercise_library_id is not null and e.exercise_library_id = p_exercise_library_id)
            or (p_exercise_library_id is null and p_source_workout_exercise_id is not null
              and e.exercise_library_id is null and e.source_workout_exercise_id = p_source_workout_exercise_id))
      )
    order by l.completed_at desc, l.id desc
    limit greatest(1, least(p_occurrence_limit, 11))
  )
  select o.id, o.completed_at, e.exercise_name, s.set_number,
    s.actual_load_value, s.actual_load_unit, s.actual_reps, s.actual_rpe,
    e.tracking_type, s.actual_duration_value, s.actual_duration_unit, s.actual_distance_value, s.actual_distance_unit
  from occurrences o
  join public.workout_log_exercises e on e.workout_log_id = o.id and e.archived = false
    and ((p_exercise_library_id is not null and e.exercise_library_id = p_exercise_library_id)
      or (p_exercise_library_id is null and p_source_workout_exercise_id is not null
        and e.exercise_library_id is null and e.source_workout_exercise_id = p_source_workout_exercise_id))
  join public.workout_log_sets s on s.workout_log_exercise_id = e.id
    and s.archived = false and s.status = 'completed'
  order by o.completed_at desc, o.id desc, s.set_number asc;
$$;

revoke execute on function public.valid_workout_metric(numeric, text, text) from public, anon, authenticated;
grant execute on function public.valid_workout_metric(numeric, text, text) to service_role;
revoke execute on function public.fill_workout_log_exercise_metrics() from public, anon, authenticated;
grant execute on function public.fill_workout_log_exercise_metrics() to service_role;
revoke execute on function public.check_workout_set_metrics() from public, anon, authenticated;
grant execute on function public.check_workout_set_metrics() to service_role;
revoke execute on function public.get_workout_exercise_history_v2(uuid, uuid, uuid, timestamptz, uuid, integer) from public, anon, authenticated;
grant execute on function public.get_workout_exercise_history_v2(uuid, uuid, uuid, timestamptz, uuid, integer) to service_role;
