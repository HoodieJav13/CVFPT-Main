alter table public.workout_log_sets
  add column actual_reps integer,
  add column actual_rpe numeric;

alter table public.workout_log_sets
  add constraint workout_log_sets_actual_reps_check
    check (actual_reps is null or actual_reps >= 0),
  add constraint workout_log_sets_actual_rpe_check
    check (actual_rpe is null or (actual_rpe between 1 and 10 and actual_rpe * 2 = trunc(actual_rpe * 2)));

alter table public.workout_log_exercises
  add column exercise_library_id uuid references public.exercise_library(id);

-- This one-time forward-only snapshot recovery is the sole exception to the
-- existing completed-child trigger; the trigger is restored in this migration.
alter table public.workout_log_exercises disable trigger prevent_completed_workout_exercise_change;
update public.workout_log_exercises le
set exercise_library_id = we.exercise_library_id
from public.workout_exercises we
where le.exercise_library_id is null
  and le.source_workout_exercise_id = we.id
  and we.exercise_library_id is not null;
alter table public.workout_log_exercises enable trigger prevent_completed_workout_exercise_change;

create index idx_workout_log_exercises_library_history
  on public.workout_log_exercises(exercise_library_id, workout_log_id)
  where archived = false and exercise_library_id is not null;
create index idx_workout_log_exercises_custom_history
  on public.workout_log_exercises(source_workout_exercise_id, workout_log_id)
  where archived = false and exercise_library_id is null and source_workout_exercise_id is not null;

create or replace function public.start_workout_log(
  p_client_id uuid,
  p_program_assignment_id uuid,
  p_program_day_id uuid,
  p_workout_assignment_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_active public.workout_logs%rowtype;
  v_client public.clients%rowtype;
  v_workout public.workouts%rowtype;
  v_log_id uuid;
  v_log_exercise_id uuid;
  v_dated_assignment_id uuid;
  v_exercise record;
  v_set_count integer;
  v_load_value numeric;
  v_load_unit text;
  v_existing_dated uuid;
begin
  select * into v_client from public.clients
  where id = p_client_id and archived = false;
  if v_client.id is null then raise exception 'Client not found'; end if;

  select * into v_active from public.workout_logs
  where client_id = p_client_id and status = 'active' and archived = false
  for update;
  if v_active.id is not null then
    if (p_program_assignment_id is not null and v_active.program_assignment_id = p_program_assignment_id and v_active.program_day_id = p_program_day_id)
      or (p_workout_assignment_id is not null and v_active.workout_assignment_id = p_workout_assignment_id) then
      return jsonb_build_object('outcome', 'resumed', 'workout_log_id', v_active.id);
    end if;
    return jsonb_build_object('outcome', 'conflict', 'workout_log_id', v_active.id);
  end if;

  if p_program_assignment_id is not null then
    select w.* into v_workout
    from public.program_assignments pa
    join public.program_days pd on pd.program_id = pa.program_id
    join public.workouts w on w.id = pd.workout_id
    where pa.id = p_program_assignment_id and pd.id = p_program_day_id
      and pa.client_id = p_client_id and pa.archived = false and pd.archived = false and w.archived = false;
    if v_workout.id is null then raise exception 'Assigned workout not found'; end if;
  elsif p_workout_assignment_id is not null then
    select w.* into v_workout
    from public.workout_assignments wa
    join public.workouts w on w.id = wa.workout_id
    where wa.id = p_workout_assignment_id and wa.client_id = p_client_id
      and wa.archived = false and w.archived = false;
    if v_workout.id is null then raise exception 'Assigned workout not found'; end if;
    select case when assignment_mode = 'dated' then id else null end
      into v_dated_assignment_id
    from public.workout_assignments
    where id = p_workout_assignment_id and client_id = p_client_id and archived = false;
    if v_dated_assignment_id is not null then
      select id into v_existing_dated from public.workout_logs
      where dated_workout_assignment_id = v_dated_assignment_id
        and status = 'completed' and archived = false;
      if v_existing_dated is not null then
        return jsonb_build_object('outcome', 'already_completed', 'workout_log_id', v_existing_dated);
      end if;
    end if;
  else
    raise exception 'Workout assignment is required';
  end if;

  begin
    insert into public.workout_logs (
      client_id, coach_id, program_assignment_id, program_day_id, workout_assignment_id,
      dated_workout_assignment_id, source_workout_id, workout_name, workout_description, workout_goal
    ) values (
      p_client_id, v_client.coach_id, p_program_assignment_id, p_program_day_id, p_workout_assignment_id,
      v_dated_assignment_id, v_workout.id, v_workout.name, v_workout.description, v_workout.goal
    ) returning id into v_log_id;
  exception when unique_violation then
    select * into v_active from public.workout_logs
    where client_id = p_client_id and status = 'active' and archived = false;
    if v_active.id is not null then
      if (p_program_assignment_id is not null and v_active.program_assignment_id = p_program_assignment_id and v_active.program_day_id = p_program_day_id)
        or (p_workout_assignment_id is not null and v_active.workout_assignment_id = p_workout_assignment_id) then
        return jsonb_build_object('outcome', 'resumed', 'workout_log_id', v_active.id);
      end if;
      return jsonb_build_object('outcome', 'conflict', 'workout_log_id', v_active.id);
    end if;
    if v_dated_assignment_id is not null then
      select id into v_existing_dated from public.workout_logs
      where dated_workout_assignment_id = v_dated_assignment_id
        and status = 'completed' and archived = false;
      if v_existing_dated is not null then
        return jsonb_build_object('outcome', 'already_completed', 'workout_log_id', v_existing_dated);
      end if;
    end if;
    raise;
  end;

  for v_exercise in
    select we.*, coalesce(el.name, we.custom_name, 'Exercise') as resolved_name
    from public.workout_exercises we
    left join public.exercise_library el on el.id = we.exercise_library_id
    where we.workout_id = v_workout.id and we.archived = false
    order by we.position
  loop
    v_load_value := null;
    v_load_unit := null;
    if p_program_assignment_id is not null then
      select load_value, load_unit into v_load_value, v_load_unit
      from public.program_assignment_exercise_loads
      where program_assignment_id = p_program_assignment_id
        and program_day_id = p_program_day_id
        and workout_exercise_id = v_exercise.id
        and archived = false;
    else
      select load_value, load_unit into v_load_value, v_load_unit
      from public.workout_assignment_exercise_loads
      where workout_assignment_id = p_workout_assignment_id
        and workout_exercise_id = v_exercise.id
        and archived = false;
    end if;
    if v_load_value is null then
      v_load_value := v_exercise.default_load_value;
      v_load_unit := v_exercise.default_load_unit;
    end if;

    insert into public.workout_log_exercises (
      workout_log_id, source_workout_exercise_id, exercise_library_id, exercise_name, prescribed_sets,
      prescribed_reps, prescribed_rpe, prescribed_rest, prescribed_tempo, prescribed_notes,
      prescribed_load_value, prescribed_load_unit, position
    ) values (
      v_log_id, v_exercise.id, v_exercise.exercise_library_id, v_exercise.resolved_name, v_exercise.sets,
      v_exercise.reps, v_exercise.target_rpe, v_exercise.rest, v_exercise.tempo,
      coalesce(v_exercise.client_notes, v_exercise.notes), v_load_value, v_load_unit, v_exercise.position
    ) returning id into v_log_exercise_id;

    v_set_count := least(20, greatest(1, coalesce(((regexp_match(coalesce(v_exercise.sets, ''), '([0-9]+)'))[1])::integer, 1)));
    insert into public.workout_log_sets (
      workout_log_exercise_id, set_number, set_origin, actual_load_value, actual_load_unit
    )
    select v_log_exercise_id, n, 'prescribed', v_load_value, v_load_unit
    from generate_series(1, v_set_count) n;
  end loop;

  return jsonb_build_object('outcome', 'started', 'workout_log_id', v_log_id);
end;
$$;

create or replace function public.get_workout_exercise_history(
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
  actual_rpe numeric
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
    s.actual_load_value, s.actual_load_unit, s.actual_reps, s.actual_rpe
  from occurrences o
  join public.workout_log_exercises e on e.workout_log_id = o.id and e.archived = false
    and ((p_exercise_library_id is not null and e.exercise_library_id = p_exercise_library_id)
      or (p_exercise_library_id is null and p_source_workout_exercise_id is not null
        and e.exercise_library_id is null and e.source_workout_exercise_id = p_source_workout_exercise_id))
  join public.workout_log_sets s on s.workout_log_exercise_id = e.id
    and s.archived = false and s.status = 'completed'
  order by o.completed_at desc, o.id desc, s.set_number asc;
$$;

revoke execute on function public.get_workout_exercise_history(uuid, uuid, uuid, timestamptz, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.get_workout_exercise_history(uuid, uuid, uuid, timestamptz, uuid, integer)
  to service_role;

revoke execute on function public.start_workout_log(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.start_workout_log(uuid, uuid, uuid, uuid) to service_role;
