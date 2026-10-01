-- ============================================================
-- Supersets and giant sets.
--
-- Coaches can link consecutive exercises in a workout into a superset
-- (two exercises) or a giant set (three or more). A group is stored as a
-- short letter label on each member row ("A", "B", ...); consecutive
-- rows sharing a label form one group, and a null label is a straight
-- set. The backend normalizes labels before every save (contiguous runs
-- of two or more get sequential letters; singletons become null), so the
-- column never carries a one-member group.
--
--   1. workout_exercises.superset_group + workout_log_exercises
--      .superset_group, both constrained to 1-2 uppercase letters.
--   2. A fill trigger copies the source exercise's group into the
--      start_workout_log snapshot, so the tracker sees the grouping the
--      coach authored without redefining start_workout_log (same pattern
--      as structured rest). Completed snapshots are untouched.
--   3. save_workout and clone_workout are redefined (forward-only) to
--      write and copy the label. Every other line is unchanged from their
--      latest definitions (20260717043317 and 20260929120000).
--
-- Additive only: existing rows keep a null label and behave exactly as
-- before.
-- ============================================================

alter table public.workout_exercises
  add column if not exists superset_group text
  check (superset_group is null or superset_group ~ '^[A-Z]{1,2}$');

alter table public.workout_log_exercises
  add column if not exists superset_group text
  check (superset_group is null or superset_group ~ '^[A-Z]{1,2}$');

-- ---------- Snapshot fill trigger ----------
-- Insert only: an explicitly provided label wins; otherwise the snapshot
-- inherits the source workout exercise's label.
create or replace function public.fill_workout_log_exercise_superset()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.superset_group is null and new.source_workout_exercise_id is not null then
    select superset_group into new.superset_group
    from public.workout_exercises
    where id = new.source_workout_exercise_id;
  end if;
  return new;
end;
$$;

drop trigger if exists fill_workout_log_exercise_superset on public.workout_log_exercises;
create trigger fill_workout_log_exercise_superset
before insert on public.workout_log_exercises
for each row execute function public.fill_workout_log_exercise_superset();

-- ---------- save_workout: write the group label ----------
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
            position = v_position
        where id = v_existing.id;
        v_exercise_id := v_existing.id;
      else
        insert into public.workout_exercises (
          workout_id, exercise_library_id, custom_name, sets, reps, rest, tempo, target_rpe,
          default_load_value, default_load_unit, notes, client_notes, coach_notes, video_url, position,
          superset_group
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
          nullif(btrim(coalesce(v_exercise ->> 'superset_group', '')), '')
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

-- ---------- clone_workout: copy the group label ----------
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
      video_url, position, superset_group
    ) values (
      v_new_id, v_ex.exercise_library_id, v_ex.custom_name, v_ex.sets, v_ex.reps, v_ex.rest,
      v_ex.rest_seconds, v_ex.tempo, v_ex.target_rpe,
      case when v_strip then null else v_ex.default_load_value end,
      case when v_strip then null else v_ex.default_load_unit end,
      v_ex.notes, v_ex.client_notes,
      case when v_strip then null else v_ex.coach_notes end,
      v_ex.video_url, v_ex.position, v_ex.superset_group
    ) returning id into v_new_ex;
    v_map := v_map || jsonb_build_object(v_ex.id::text, v_new_ex);
  end loop;

  return jsonb_build_object('workout_id', v_new_id, 'exercise_map', v_map);
end;
$$;

revoke execute on function public.fill_workout_log_exercise_superset() from public, anon, authenticated;
grant execute on function public.fill_workout_log_exercise_superset() to service_role;
