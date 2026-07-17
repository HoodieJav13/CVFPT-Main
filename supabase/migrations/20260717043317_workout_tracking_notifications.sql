-- Client workout execution, immutable completion history, and in-app receipts.
-- The Express service role remains the only caller for tables and RPCs.

alter table public.workout_exercises
  add column if not exists target_rpe text,
  add column if not exists default_load_value numeric,
  add column if not exists default_load_unit text;

alter table public.workout_exercises
  drop constraint if exists workout_exercises_default_load_value_check,
  add constraint workout_exercises_default_load_value_check
    check (default_load_value is null or default_load_value >= 0),
  drop constraint if exists workout_exercises_default_load_unit_check,
  add constraint workout_exercises_default_load_unit_check
    check (default_load_unit is null or default_load_unit in ('lb', 'kg')),
  drop constraint if exists workout_exercises_default_load_pair_check,
  add constraint workout_exercises_default_load_pair_check
    check ((default_load_value is null) = (default_load_unit is null));

create table if not exists public.program_assignment_exercise_loads (
  id uuid primary key default gen_random_uuid(),
  program_assignment_id uuid not null references public.program_assignments(id),
  program_day_id uuid not null references public.program_days(id),
  workout_exercise_id uuid not null references public.workout_exercises(id),
  load_value numeric not null check (load_value >= 0),
  load_unit text not null check (load_unit in ('lb', 'kg')),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_program_assignment_exercise_loads_active
  on public.program_assignment_exercise_loads(program_assignment_id, program_day_id, workout_exercise_id)
  where archived = false;
create index if not exists idx_program_assignment_exercise_loads_assignment
  on public.program_assignment_exercise_loads(program_assignment_id, archived);

create table if not exists public.workout_assignment_exercise_loads (
  id uuid primary key default gen_random_uuid(),
  workout_assignment_id uuid not null references public.workout_assignments(id),
  workout_exercise_id uuid not null references public.workout_exercises(id),
  load_value numeric not null check (load_value >= 0),
  load_unit text not null check (load_unit in ('lb', 'kg')),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_workout_assignment_exercise_loads_active
  on public.workout_assignment_exercise_loads(workout_assignment_id, workout_exercise_id)
  where archived = false;
create index if not exists idx_workout_assignment_exercise_loads_assignment
  on public.workout_assignment_exercise_loads(workout_assignment_id, archived);

create table if not exists public.workout_logs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  coach_id uuid not null references public.coaches(id),
  program_assignment_id uuid references public.program_assignments(id),
  program_day_id uuid references public.program_days(id),
  workout_assignment_id uuid references public.workout_assignments(id),
  dated_workout_assignment_id uuid references public.workout_assignments(id),
  source_workout_id uuid not null references public.workouts(id),
  workout_name text not null,
  workout_description text,
  workout_goal text,
  status text not null default 'active' check (status in ('active', 'completed', 'abandoned')),
  notes text,
  feedback text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workout_logs_source_check check (
    (program_assignment_id is not null and program_day_id is not null and workout_assignment_id is null)
    or
    (program_assignment_id is null and program_day_id is null and workout_assignment_id is not null)
  ),
  constraint workout_logs_dated_source_check check (
    dated_workout_assignment_id is null or dated_workout_assignment_id = workout_assignment_id
  ),
  constraint workout_logs_completion_check check (
    (status = 'completed' and completed_at is not null)
    or (status <> 'completed' and completed_at is null)
  )
);

create unique index if not exists idx_workout_logs_one_active_per_client
  on public.workout_logs(client_id)
  where status = 'active' and archived = false;
create unique index if not exists idx_workout_logs_one_dated_completion
  on public.workout_logs(dated_workout_assignment_id)
  where dated_workout_assignment_id is not null
    and status in ('active', 'completed')
    and archived = false;
create index if not exists idx_workout_logs_client_history
  on public.workout_logs(client_id, completed_at desc, started_at desc)
  where archived = false;
create index if not exists idx_workout_logs_coach_history
  on public.workout_logs(coach_id, completed_at desc)
  where status = 'completed' and archived = false;

create table if not exists public.workout_log_exercises (
  id uuid primary key default gen_random_uuid(),
  workout_log_id uuid not null references public.workout_logs(id),
  source_workout_exercise_id uuid references public.workout_exercises(id),
  exercise_name text not null,
  prescribed_sets text,
  prescribed_reps text,
  prescribed_rpe text,
  prescribed_rest text,
  prescribed_tempo text,
  prescribed_notes text,
  prescribed_load_value numeric check (prescribed_load_value is null or prescribed_load_value >= 0),
  prescribed_load_unit text check (prescribed_load_unit is null or prescribed_load_unit in ('lb', 'kg')),
  position integer not null default 0,
  client_notes text,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workout_log_exercises_load_pair_check
    check ((prescribed_load_value is null) = (prescribed_load_unit is null))
);

create index if not exists idx_workout_log_exercises_log
  on public.workout_log_exercises(workout_log_id, position)
  where archived = false;

create table if not exists public.workout_log_sets (
  id uuid primary key default gen_random_uuid(),
  workout_log_exercise_id uuid not null references public.workout_log_exercises(id),
  client_operation_id uuid unique,
  set_number integer not null check (set_number between 1 and 50),
  set_origin text not null default 'prescribed' check (set_origin in ('prescribed', 'extra')),
  status text not null default 'pending' check (status in ('pending', 'completed', 'skipped')),
  actual_load_value numeric check (actual_load_value is null or actual_load_value >= 0),
  actual_load_unit text check (actual_load_unit is null or actual_load_unit in ('lb', 'kg')),
  completed_at timestamptz,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workout_log_sets_load_pair_check
    check ((actual_load_value is null) = (actual_load_unit is null)),
  constraint workout_log_sets_completion_check
    check ((status = 'completed' and completed_at is not null) or status <> 'completed')
);

create unique index if not exists idx_workout_log_sets_active_number
  on public.workout_log_sets(workout_log_exercise_id, set_number)
  where archived = false;
create index if not exists idx_workout_log_sets_exercise
  on public.workout_log_sets(workout_log_exercise_id, set_number)
  where archived = false;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_coach_id uuid not null references public.coaches(id),
  event_type text not null check (event_type in ('workout_completed')),
  workout_log_id uuid not null references public.workout_logs(id),
  read_at timestamptz,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(recipient_coach_id, event_type, workout_log_id)
);

create index if not exists idx_notifications_recipient
  on public.notifications(recipient_coach_id, read_at, created_at desc)
  where archived = false;

create or replace function public.validate_assignment_exercise_load()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_table_name = 'program_assignment_exercise_loads' then
    if not exists (
      select 1
      from public.program_assignments pa
      join public.program_days pd on pd.id = new.program_day_id
      join public.workout_exercises we on we.id = new.workout_exercise_id
      where pa.id = new.program_assignment_id
        and pa.program_id = pd.program_id
        and pd.workout_id = we.workout_id
        and pa.archived = false
        and pd.archived = false
        and we.archived = false
    ) then
      raise exception 'Invalid program assignment exercise load';
    end if;
  elsif not exists (
    select 1
    from public.workout_assignments wa
    join public.workout_exercises we on we.workout_id = wa.workout_id
    where wa.id = new.workout_assignment_id
      and we.id = new.workout_exercise_id
      and wa.archived = false
      and we.archived = false
  ) then
    raise exception 'Invalid workout assignment exercise load';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_program_assignment_exercise_load on public.program_assignment_exercise_loads;
create trigger validate_program_assignment_exercise_load
before insert or update on public.program_assignment_exercise_loads
for each row execute function public.validate_assignment_exercise_load();

drop trigger if exists validate_workout_assignment_exercise_load on public.workout_assignment_exercise_loads;
create trigger validate_workout_assignment_exercise_load
before insert or update on public.workout_assignment_exercise_loads
for each row execute function public.validate_assignment_exercise_load();

create or replace function public.prevent_completed_workout_log_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status = 'completed' then
    raise exception 'Completed workout logs are immutable';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists prevent_completed_workout_log_change on public.workout_logs;
create trigger prevent_completed_workout_log_change
before update or delete on public.workout_logs
for each row execute function public.prevent_completed_workout_log_change();

create or replace function public.prevent_completed_workout_child_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_log_id uuid;
  v_status text;
begin
  if tg_table_name = 'workout_log_exercises' then
    v_log_id := coalesce(new.workout_log_id, old.workout_log_id);
  else
    select workout_log_id into v_log_id
    from public.workout_log_exercises
    where id = coalesce(new.workout_log_exercise_id, old.workout_log_exercise_id);
  end if;
  select status into v_status from public.workout_logs where id = v_log_id;
  if v_status = 'completed' then
    raise exception 'Completed workout logs are immutable';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists prevent_completed_workout_exercise_change on public.workout_log_exercises;
create trigger prevent_completed_workout_exercise_change
before insert or update or delete on public.workout_log_exercises
for each row execute function public.prevent_completed_workout_child_change();

drop trigger if exists prevent_completed_workout_set_change on public.workout_log_sets;
create trigger prevent_completed_workout_set_change
before insert or update or delete on public.workout_log_sets
for each row execute function public.prevent_completed_workout_child_change();

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
            position = v_position
        where id = v_existing.id;
        v_exercise_id := v_existing.id;
      else
        insert into public.workout_exercises (
          workout_id, exercise_library_id, custom_name, sets, reps, rest, tempo, target_rpe,
          default_load_value, default_load_unit, notes, client_notes, coach_notes, video_url, position
        ) values (
          v_workout_id, v_library_id, v_custom_name,
          nullif(v_exercise ->> 'sets', ''), nullif(v_exercise ->> 'reps', ''),
          nullif(v_exercise ->> 'rest', ''), nullif(v_exercise ->> 'tempo', ''),
          nullif(v_exercise ->> 'target_rpe', ''),
          nullif(v_exercise ->> 'default_load_value', '')::numeric,
          case when nullif(v_exercise ->> 'default_load_value', '') is null then null else coalesce(nullif(v_exercise ->> 'default_load_unit', ''), 'lb') end,
          nullif(coalesce(v_exercise ->> 'client_notes', v_exercise ->> 'notes'), ''),
          nullif(coalesce(v_exercise ->> 'client_notes', v_exercise ->> 'notes'), ''),
          nullif(v_exercise ->> 'coach_notes', ''), nullif(v_exercise ->> 'video_url', ''), v_position
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

create or replace function public.save_program_assignment_with_loads(
  p_assignment_id uuid,
  p_program_id uuid,
  p_client_id uuid,
  p_notes text,
  p_loads jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_assignment_id uuid;
  v_load jsonb;
begin
  if p_assignment_id is null then
    insert into public.program_assignments (program_id, client_id, notes)
    values (p_program_id, p_client_id, nullif(btrim(coalesce(p_notes, '')), ''))
    returning id into v_assignment_id;
  else
    update public.program_assignments
    set notes = nullif(btrim(coalesce(p_notes, '')), '')
    where id = p_assignment_id and program_id = p_program_id
      and client_id = p_client_id and archived = false
    returning id into v_assignment_id;
    if v_assignment_id is null then raise exception 'Program assignment not found'; end if;
    update public.program_assignment_exercise_loads
    set archived = true, updated_at = now()
    where program_assignment_id = v_assignment_id and archived = false;
  end if;

  for v_load in select value from jsonb_array_elements(coalesce(p_loads, '[]'::jsonb))
  loop
    if nullif(v_load ->> 'load_value', '') is not null then
      insert into public.program_assignment_exercise_loads (
        program_assignment_id, program_day_id, workout_exercise_id, load_value, load_unit
      ) values (
        v_assignment_id,
        (v_load ->> 'program_day_id')::uuid,
        (v_load ->> 'workout_exercise_id')::uuid,
        (v_load ->> 'load_value')::numeric,
        coalesce(nullif(v_load ->> 'load_unit', ''), 'lb')
      );
    end if;
  end loop;
  return v_assignment_id;
end;
$$;

create or replace function public.save_workout_assignment_with_loads(
  p_assignment_id uuid,
  p_client_id uuid,
  p_workout_id uuid,
  p_assignment_mode text,
  p_assigned_for date,
  p_notes text,
  p_loads jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_assignment_id uuid;
  v_mode text := case when p_assignment_mode = 'dated' then 'dated' else 'active' end;
  v_load jsonb;
begin
  if v_mode = 'dated' and p_assigned_for is null then
    raise exception 'Choose a date for dated workouts';
  end if;
  if p_assignment_id is null then
    insert into public.workout_assignments (
      client_id, workout_id, assignment_mode, assigned_for, notes
    ) values (
      p_client_id, p_workout_id, v_mode,
      case when v_mode = 'dated' then p_assigned_for else null end,
      nullif(btrim(coalesce(p_notes, '')), '')
    ) returning id into v_assignment_id;
  else
    update public.workout_assignments
    set assignment_mode = v_mode,
        assigned_for = case when v_mode = 'dated' then p_assigned_for else null end,
        notes = nullif(btrim(coalesce(p_notes, '')), '')
    where id = p_assignment_id and client_id = p_client_id
      and workout_id = p_workout_id and archived = false
    returning id into v_assignment_id;
    if v_assignment_id is null then raise exception 'Workout assignment not found'; end if;
    update public.workout_assignment_exercise_loads
    set archived = true, updated_at = now()
    where workout_assignment_id = v_assignment_id and archived = false;
  end if;

  for v_load in select value from jsonb_array_elements(coalesce(p_loads, '[]'::jsonb))
  loop
    if nullif(v_load ->> 'load_value', '') is not null then
      insert into public.workout_assignment_exercise_loads (
        workout_assignment_id, workout_exercise_id, load_value, load_unit
      ) values (
        v_assignment_id,
        (v_load ->> 'workout_exercise_id')::uuid,
        (v_load ->> 'load_value')::numeric,
        coalesce(nullif(v_load ->> 'load_unit', ''), 'lb')
      );
    end if;
  end loop;
  return v_assignment_id;
end;
$$;

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
      workout_log_id, source_workout_exercise_id, exercise_name, prescribed_sets,
      prescribed_reps, prescribed_rpe, prescribed_rest, prescribed_tempo, prescribed_notes,
      prescribed_load_value, prescribed_load_unit, position
    ) values (
      v_log_id, v_exercise.id, v_exercise.resolved_name, v_exercise.sets,
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

create or replace function public.complete_all_workout_sets(
  p_workout_log_id uuid,
  p_client_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_log public.workout_logs%rowtype;
begin
  select * into v_log from public.workout_logs
  where id = p_workout_log_id and client_id = p_client_id and archived = false
  for update;
  if v_log.id is null then raise exception 'Workout log not found'; end if;
  if v_log.status <> 'active' then raise exception 'Workout log is not active'; end if;

  update public.workout_log_sets s
  set status = 'completed', completed_at = now(), updated_at = now()
  from public.workout_log_exercises e
  where s.workout_log_exercise_id = e.id
    and e.workout_log_id = v_log.id
    and e.archived = false and s.archived = false and s.status = 'pending';
  update public.workout_logs set updated_at = now() where id = v_log.id;
  return v_log.id;
end;
$$;

create or replace function public.complete_workout_log(
  p_workout_log_id uuid,
  p_client_id uuid,
  p_notes text,
  p_feedback text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_log public.workout_logs%rowtype;
  v_completed_count integer;
begin
  select * into v_log from public.workout_logs
  where id = p_workout_log_id and client_id = p_client_id and archived = false
  for update;
  if v_log.id is null then raise exception 'Workout log not found'; end if;
  if v_log.status = 'completed' then return v_log.id; end if;
  if v_log.status <> 'active' then raise exception 'Workout log is not active'; end if;

  select count(*) into v_completed_count
  from public.workout_log_sets s
  join public.workout_log_exercises e on e.id = s.workout_log_exercise_id
  where e.workout_log_id = v_log.id and e.archived = false
    and s.archived = false and s.status = 'completed';
  if v_completed_count < 1 then raise exception 'Complete at least one set'; end if;

  update public.workout_log_sets s
  set status = 'skipped', completed_at = null, updated_at = now()
  from public.workout_log_exercises e
  where s.workout_log_exercise_id = e.id and e.workout_log_id = v_log.id
    and e.archived = false and s.archived = false and s.status = 'pending';

  update public.workout_logs
  set status = 'completed', notes = nullif(btrim(coalesce(p_notes, '')), ''),
      feedback = nullif(btrim(coalesce(p_feedback, '')), ''), completed_at = now(), updated_at = now()
  where id = v_log.id;

  insert into public.notifications (recipient_coach_id, event_type, workout_log_id)
  select c.id, 'workout_completed', v_log.id
  from public.coaches c
  where c.archived = false and (c.id = v_log.coach_id or c.is_admin = true)
  on conflict (recipient_coach_id, event_type, workout_log_id) do nothing;

  return v_log.id;
end;
$$;

alter table public.program_assignment_exercise_loads enable row level security;
alter table public.workout_assignment_exercise_loads enable row level security;
alter table public.workout_logs enable row level security;
alter table public.workout_log_exercises enable row level security;
alter table public.workout_log_sets enable row level security;
alter table public.notifications enable row level security;

revoke all privileges on table public.program_assignment_exercise_loads from public, anon, authenticated, service_role;
revoke all privileges on table public.workout_assignment_exercise_loads from public, anon, authenticated, service_role;
revoke all privileges on table public.workout_logs from public, anon, authenticated, service_role;
revoke all privileges on table public.workout_log_exercises from public, anon, authenticated, service_role;
revoke all privileges on table public.workout_log_sets from public, anon, authenticated, service_role;
revoke all privileges on table public.notifications from public, anon, authenticated, service_role;
grant select, insert, update on table public.program_assignment_exercise_loads to service_role;
grant select, insert, update on table public.workout_assignment_exercise_loads to service_role;
grant select, insert, update on table public.workout_logs to service_role;
grant select, insert, update on table public.workout_log_exercises to service_role;
grant select, insert, update on table public.workout_log_sets to service_role;
grant select, insert, update on table public.notifications to service_role;

revoke execute on function public.validate_assignment_exercise_load() from public, anon, authenticated;
revoke execute on function public.prevent_completed_workout_log_change() from public, anon, authenticated;
revoke execute on function public.prevent_completed_workout_child_change() from public, anon, authenticated;
revoke execute on function public.save_workout(uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.save_program_assignment_with_loads(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.save_workout_assignment_with_loads(uuid, uuid, uuid, text, date, text, jsonb) from public, anon, authenticated;
revoke execute on function public.start_workout_log(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.complete_all_workout_sets(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.complete_workout_log(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.validate_assignment_exercise_load() to service_role;
grant execute on function public.prevent_completed_workout_log_change() to service_role;
grant execute on function public.prevent_completed_workout_child_change() to service_role;
grant execute on function public.save_workout(uuid, uuid, text, text, text, jsonb) to service_role;
grant execute on function public.save_program_assignment_with_loads(uuid, uuid, uuid, text, jsonb) to service_role;
grant execute on function public.save_workout_assignment_with_loads(uuid, uuid, uuid, text, date, text, jsonb) to service_role;
grant execute on function public.start_workout_log(uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.complete_all_workout_sets(uuid, uuid) to service_role;
grant execute on function public.complete_workout_log(uuid, uuid, text, text) to service_role;
