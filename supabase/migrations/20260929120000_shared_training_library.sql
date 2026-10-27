-- Shared training library: templates are shared by all coaches; assigning
-- clones a template into a client-specific instance. See
-- docs/shared-training-library-design.md. Forward-only: no existing rows are
-- rewritten except the created_by backfill, and existing assignments stay
-- live-linked to their (template) rows.

-- ---------- Columns ----------
alter table public.workouts
  add column if not exists is_template boolean not null default true,
  add column if not exists client_id uuid references public.clients(id),
  add column if not exists source_workout_id uuid references public.workouts(id),
  add column if not exists variation_of uuid references public.workouts(id),
  add column if not exists hidden boolean not null default false,
  add column if not exists created_by uuid references public.coaches(id);

alter table public.programs
  add column if not exists is_template boolean not null default true,
  add column if not exists client_id uuid references public.clients(id),
  add column if not exists source_program_id uuid references public.programs(id),
  add column if not exists variation_of uuid references public.programs(id),
  add column if not exists hidden boolean not null default false,
  add column if not exists created_by uuid references public.coaches(id);

alter table public.exercise_library
  add column if not exists hidden boolean not null default false;

alter table public.workouts
  drop constraint if exists workouts_template_or_instance_check,
  add constraint workouts_template_or_instance_check
    check ((is_template and client_id is null) or (not is_template and client_id is not null)),
  drop constraint if exists workouts_variation_on_template_check,
  add constraint workouts_variation_on_template_check
    check (variation_of is null or is_template);

alter table public.programs
  drop constraint if exists programs_template_or_instance_check,
  add constraint programs_template_or_instance_check
    check ((is_template and client_id is null) or (not is_template and client_id is not null)),
  drop constraint if exists programs_variation_on_template_check,
  add constraint programs_variation_on_template_check
    check (variation_of is null or is_template);

create index if not exists idx_workouts_template_list
  on public.workouts(is_template, archived, created_at desc);
create index if not exists idx_workouts_created_by on public.workouts(created_by);
create index if not exists idx_workouts_client on public.workouts(client_id) where client_id is not null;
create index if not exists idx_workouts_variation_of on public.workouts(variation_of) where variation_of is not null;

create index if not exists idx_programs_template_list
  on public.programs(is_template, archived, created_at desc);
create index if not exists idx_programs_created_by on public.programs(created_by);
create index if not exists idx_programs_client on public.programs(client_id) where client_id is not null;
create index if not exists idx_programs_variation_of on public.programs(variation_of) where variation_of is not null;

-- ---------- Publisher attribution ----------
-- Templates only. Backfill from the existing owner; admin-authored shared
-- workouts (coach_id is null) keep a null publisher.
update public.workouts set created_by = coach_id
where is_template and created_by is null and coach_id is not null;
update public.programs set created_by = coach_id
where is_template and created_by is null and coach_id is not null;

create or replace function public.set_template_created_by()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.is_template and new.created_by is null then
    new.created_by := new.coach_id;
  end if;
  return new;
end;
$$;

drop trigger if exists set_workout_created_by on public.workouts;
create trigger set_workout_created_by
before insert on public.workouts
for each row execute function public.set_template_created_by();

drop trigger if exists set_program_created_by on public.programs;
create trigger set_program_created_by
before insert on public.programs
for each row execute function public.set_template_created_by();

-- ---------- Workout cloning ----------
-- One internal helper for both directions.
--   assign:  template -> client instance (everything is copied, including
--            default loads and coach notes, because the coach may tune them)
--   save:    instance or template -> new hidden template. When the source is a
--            client instance, client-specific data is stripped (default load and
--            coach-only notes); duplicating a template keeps the coach's own
--            prescription intact.
-- Returns { workout_id, exercise_map } where exercise_map is
-- { "<source exercise id>": "<cloned exercise id>" }.
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
      video_url, position
    ) values (
      v_new_id, v_ex.exercise_library_id, v_ex.custom_name, v_ex.sets, v_ex.reps, v_ex.rest,
      v_ex.rest_seconds, v_ex.tempo, v_ex.target_rpe,
      case when v_strip then null else v_ex.default_load_value end,
      case when v_strip then null else v_ex.default_load_unit end,
      v_ex.notes, v_ex.client_notes,
      case when v_strip then null else v_ex.coach_notes end,
      v_ex.video_url, v_ex.position
    ) returning id into v_new_ex;
    v_map := v_map || jsonb_build_object(v_ex.id::text, v_new_ex);
  end loop;

  return jsonb_build_object('workout_id', v_new_id, 'exercise_map', v_map);
end;
$$;

-- Variations always attach to the root template (one level only).
create or replace function public.resolve_variation_root(
  p_kind text,
  p_variation_of uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_root uuid;
begin
  if p_variation_of is null then
    return null;
  end if;
  if p_kind = 'program' then
    select coalesce(variation_of, id) into v_root
    from public.programs where id = p_variation_of and is_template and archived = false;
  else
    select coalesce(variation_of, id) into v_root
    from public.workouts where id = p_variation_of and is_template and archived = false;
  end if;
  if v_root is null then
    raise exception 'Variation parent not found';
  end if;
  return v_root;
end;
$$;

-- ---------- Assign: template -> instance ----------
create or replace function public.assign_workout_clone(
  p_workout_id uuid,
  p_client_id uuid,
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
  v_template public.workouts%rowtype;
  v_client public.clients%rowtype;
  v_clone jsonb;
  v_map jsonb;
  v_load jsonb;
  v_loads jsonb := '[]'::jsonb;
  v_new_ex text;
begin
  select * into v_template from public.workouts
  where id = p_workout_id and archived = false and is_template and not hidden;
  if not found then
    raise exception 'Workout not found';
  end if;
  select * into v_client from public.clients where id = p_client_id and archived = false;
  if not found or v_client.coach_id is null then
    raise exception 'Client not found';
  end if;

  v_clone := public.clone_workout(v_template.id, v_client.coach_id, v_client.id, false, null);
  v_map := v_clone -> 'exercise_map';

  for v_load in select value from jsonb_array_elements(coalesce(p_loads, '[]'::jsonb))
  loop
    v_new_ex := v_map ->> (v_load ->> 'workout_exercise_id');
    if v_new_ex is null then
      raise exception 'Invalid workout assignment exercise load';
    end if;
    v_loads := v_loads || jsonb_build_array(
      jsonb_set(v_load, '{workout_exercise_id}', to_jsonb(v_new_ex))
    );
  end loop;

  return public.save_workout_assignment_with_loads(
    null, v_client.id, (v_clone ->> 'workout_id')::uuid,
    p_assignment_mode, p_assigned_for, p_notes, v_loads
  );
end;
$$;

create or replace function public.assign_program_clone(
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
  v_template public.programs%rowtype;
  v_client public.clients%rowtype;
  v_new_program_id uuid;
  v_day public.program_days%rowtype;
  v_clone jsonb;
  v_new_day_id uuid;
  v_day_map jsonb := '{}'::jsonb;
  v_ex_map jsonb := '{}'::jsonb;
  v_pair record;
  v_load jsonb;
  v_loads jsonb := '[]'::jsonb;
  v_new_day text;
  v_new_ex text;
begin
  select * into v_template from public.programs
  where id = p_program_id and archived = false and is_template and not hidden;
  if not found then
    raise exception 'Program not found';
  end if;
  select * into v_client from public.clients where id = p_client_id and archived = false;
  if not found or v_client.coach_id is null then
    raise exception 'Client not found';
  end if;

  insert into public.programs (
    coach_id, name, description, frequency_days, is_template, client_id, source_program_id
  ) values (
    v_client.coach_id, v_template.name, v_template.description, v_template.frequency_days,
    false, v_client.id, v_template.id
  ) returning id into v_new_program_id;

  for v_day in
    select * from public.program_days
    where program_id = v_template.id and archived = false
    order by day_number
  loop
    v_clone := public.clone_workout(v_day.workout_id, v_client.coach_id, v_client.id, false, null);
    insert into public.program_days (program_id, day_number, workout_id, notes)
    values (v_new_program_id, v_day.day_number, (v_clone ->> 'workout_id')::uuid, v_day.notes)
    returning id into v_new_day_id;
    v_day_map := v_day_map || jsonb_build_object(v_day.id::text, v_new_day_id);
    -- Key exercise clones by "<day id>:<exercise id>" because one workout may
    -- serve several days of the same template.
    for v_pair in select key, value from jsonb_each_text(v_clone -> 'exercise_map')
    loop
      v_ex_map := v_ex_map || jsonb_build_object(v_day.id::text || ':' || v_pair.key, v_pair.value);
    end loop;
  end loop;

  for v_load in select value from jsonb_array_elements(coalesce(p_loads, '[]'::jsonb))
  loop
    v_new_day := v_day_map ->> (v_load ->> 'program_day_id');
    v_new_ex := v_ex_map ->> ((v_load ->> 'program_day_id') || ':' || (v_load ->> 'workout_exercise_id'));
    if v_new_day is null or v_new_ex is null then
      raise exception 'Invalid program assignment exercise load';
    end if;
    v_loads := v_loads || jsonb_build_array(
      jsonb_set(jsonb_set(v_load, '{program_day_id}', to_jsonb(v_new_day)),
                '{workout_exercise_id}', to_jsonb(v_new_ex))
    );
  end loop;

  return public.save_program_assignment_with_loads(
    null, v_new_program_id, v_client.id, p_notes, v_loads
  );
end;
$$;

-- ---------- Save instance as template / variation ----------
create or replace function public.save_workout_as_template(
  p_workout_id uuid,
  p_coach_id uuid,
  p_name text,
  p_variation_of uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_src public.workouts%rowtype;
  v_root uuid;
  v_clone jsonb;
  v_new_id uuid;
begin
  select * into v_src from public.workouts
  where id = p_workout_id and archived = false;
  if not found then
    raise exception 'Workout not found';
  end if;
  v_root := public.resolve_variation_root('workout', p_variation_of);
  v_clone := public.clone_workout(v_src.id, p_coach_id, null, true, v_root);
  v_new_id := (v_clone ->> 'workout_id')::uuid;
  if nullif(btrim(coalesce(p_name, '')), '') is not null then
    update public.workouts set name = btrim(p_name) where id = v_new_id;
  end if;
  return v_new_id;
end;
$$;

create or replace function public.save_program_as_template(
  p_program_id uuid,
  p_coach_id uuid,
  p_name text,
  p_variation_of uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_src public.programs%rowtype;
  v_root uuid;
  v_new_program_id uuid;
  v_day public.program_days%rowtype;
  v_clone jsonb;
begin
  select * into v_src from public.programs
  where id = p_program_id and archived = false;
  if not found then
    raise exception 'Program not found';
  end if;
  v_root := public.resolve_variation_root('program', p_variation_of);

  insert into public.programs (
    coach_id, name, description, frequency_days, is_template, client_id,
    source_program_id, variation_of, hidden, created_by
  ) values (
    p_coach_id, coalesce(nullif(btrim(coalesce(p_name, '')), ''), v_src.name),
    v_src.description, v_src.frequency_days, true, null,
    v_src.id, v_root, true, p_coach_id
  ) returning id into v_new_program_id;

  for v_day in
    select * from public.program_days
    where program_id = v_src.id and archived = false
    order by day_number
  loop
    v_clone := public.clone_workout(v_day.workout_id, p_coach_id, null, true, null);
    -- Day notes on a client instance may be client-specific, so only a template's are kept.
    insert into public.program_days (program_id, day_number, workout_id, notes)
    values (
      v_new_program_id, v_day.day_number, (v_clone ->> 'workout_id')::uuid,
      case when v_src.is_template then v_day.notes else null end
    );
  end loop;

  return v_new_program_id;
end;
$$;

-- ---------- save_program: shared-template composition rules ----------
-- Same signature as before (p_is_admin is retained but no longer gates
-- anything: templates are shared by every coach). A template program may only
-- use template workouts; a client's program instance may only use workouts
-- that belong to that same client, so an instance can never be re-linked to a
-- shared template. Grants are unchanged (create or replace keeps them).
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
  v_is_template boolean := true;
  v_client_id uuid := null;
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

  if p_program_id is not null then
    select is_template, client_id into v_is_template, v_client_id
    from public.programs where id = p_program_id and archived = false;
    if not found then
      return null;
    end if;
  end if;

  for v_day in select value from jsonb_array_elements(p_days)
  loop
    v_workout_id := nullif(v_day ->> 'workout_id', '')::uuid;
    if not exists (
      select 1 from public.workouts
      where id = v_workout_id
        and archived = false
        and case
          when v_is_template then is_template
          else client_id = v_client_id
        end
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

-- ---------- Fix: removing an exercise that has an assigned load ----------
-- save_workout archives dropped exercises and then archives their loads, but
-- the load validation trigger rejected that update because the exercise was
-- already archived, so any workout edit that removed a loaded exercise failed.
-- Client instances make that edit routine. Archiving a load must never be
-- blocked by the state of its exercise; only live loads are validated.
create or replace function public.validate_assignment_exercise_load()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.archived then
    return new;
  end if;
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

-- ---------- Grants ----------
revoke execute on function public.set_template_created_by() from public, anon, authenticated;
revoke execute on function public.clone_workout(uuid, uuid, uuid, boolean, uuid)
  from public, anon, authenticated;
revoke execute on function public.resolve_variation_root(text, uuid)
  from public, anon, authenticated;
revoke execute on function public.assign_workout_clone(uuid, uuid, text, date, text, jsonb)
  from public, anon, authenticated;
revoke execute on function public.assign_program_clone(uuid, uuid, text, jsonb)
  from public, anon, authenticated;
revoke execute on function public.save_workout_as_template(uuid, uuid, text, uuid)
  from public, anon, authenticated;
revoke execute on function public.save_program_as_template(uuid, uuid, text, uuid)
  from public, anon, authenticated;

grant execute on function public.set_template_created_by() to service_role;
grant execute on function public.clone_workout(uuid, uuid, uuid, boolean, uuid) to service_role;
grant execute on function public.resolve_variation_root(text, uuid) to service_role;
grant execute on function public.assign_workout_clone(uuid, uuid, text, date, text, jsonb) to service_role;
grant execute on function public.assign_program_clone(uuid, uuid, text, jsonb) to service_role;
grant execute on function public.save_workout_as_template(uuid, uuid, text, uuid) to service_role;
grant execute on function public.save_program_as_template(uuid, uuid, text, uuid) to service_role;
