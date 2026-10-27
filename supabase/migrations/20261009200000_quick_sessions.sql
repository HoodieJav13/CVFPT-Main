-- Coach-created quick sessions (docs/superpowers/specs/2026-10-09-quick-sessions-design.md).
--
-- LOCAL DRAFT. Not applied to any hosted database. The version prefix is a local
-- placeholder: reserve the final version after a fresh migration inventory and invite
-- coordination, before any migration PR exists. Exact SQL and lock-graph review are required.
--
-- Additive and forward-only. Existing rows keep kind = 'assigned' and every ordinary
-- assignment, workout, start and edit keeps its existing behavior:
--   * save_workout keeps its six-argument signature, uuid/null return and semantics; its
--     exercise-row writing moves verbatim into the internal sync_workout_exercises helper.
--   * save_workout_assignment_with_loads and start_workout_log keep their signatures and
--     behavior; both add a quick-only lock/guard that is a no-op for ordinary sources.
-- Rollback: revert application code first. Leave the columns and data in place (archived
-- receipts are retained by design); if the functions must be reverted, reapply the previous
-- definitions in a NEW migration. Never edit or delete this file once applied.
--
-- Common quick-only lock order (every path below):
--   [create only: advisory (actor, request)] -> advisory (quick workout id)
--   -> client row(s) FOR SHARE in UUID order -> assignment row FOR UPDATE -> workout row FOR UPDATE
--   -> existing workout_logs rows (start only) -> exercise/load rows.
-- No path takes a workout_logs lock and then waits for a quick lock.

-- ---------- Receipt columns ----------
alter table public.workout_assignments
  add column kind text not null default 'assigned',
  add column created_by_coach_id uuid references public.coaches(id),
  add column create_request_id uuid,
  add column create_request_hash text,
  add column library_template_id uuid references public.workouts(id),
  add constraint workout_assignments_kind_check check (kind in ('assigned', 'quick')),
  add constraint workout_assignments_quick_receipt_check check (
    kind <> 'quick' or (
      assignment_mode = 'dated' and assigned_for is not null and created_by_coach_id is not null
      and create_request_id is not null and create_request_hash is not null
    )
  ),
  add constraint workout_assignments_ordinary_receipt_check check (
    kind = 'quick' or (create_request_id is null and create_request_hash is null and library_template_id is null)
  ),
  add constraint workout_assignments_request_hash_check check (
    create_request_hash is null or create_request_hash ~ '^v[0-9]+:[0-9a-f]{64}$'
  );

-- Archived receipts stay in the index: archiving never frees an identity for reuse.
create unique index workout_assignments_quick_request_uidx
  on public.workout_assignments (created_by_coach_id, create_request_id)
  where create_request_id is not null;
-- One quick assignment per private quick workout.
create unique index workout_assignments_quick_workout_uidx
  on public.workout_assignments (workout_id)
  where kind = 'quick';

create or replace function public.enforce_workout_assignment_receipt()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.kind is distinct from old.kind
     or new.created_by_coach_id is distinct from old.created_by_coach_id
     or new.create_request_id is distinct from old.create_request_id
     or new.create_request_hash is distinct from old.create_request_hash then
    raise exception 'Workout assignment receipt fields are immutable' using errcode = '23514';
  end if;
  if old.kind = 'quick'
     and (new.client_id is distinct from old.client_id or new.workout_id is distinct from old.workout_id) then
    raise exception 'Quick session client and workout are immutable' using errcode = '23514';
  end if;
  if old.library_template_id is not null and new.library_template_id is distinct from old.library_template_id then
    raise exception 'Quick session library template is already set' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger enforce_workout_assignment_receipt
before update on public.workout_assignments
for each row execute function public.enforce_workout_assignment_receipt();

-- ---------- Shared exercise writer (extracted verbatim from save_workout) ----------
create or replace function public.sync_workout_exercises(p_workout_id uuid, p_exercises jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_exercise jsonb;
  v_existing public.workout_exercises%rowtype;
  v_exercise_id uuid;
  v_library_id uuid;
  v_custom_name text;
  v_position integer := 0;
  v_kept_ids uuid[] := array[]::uuid[];
begin
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
        where id = v_exercise_id and workout_id = p_workout_id and archived = false;
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
          p_workout_id, v_library_id, v_custom_name,
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
  where workout_id = p_workout_id and archived = false and not (id = any(v_kept_ids));

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
end;
$$;

-- ---------- Quick-only lock and pre-start guard ----------
-- No-op for ordinary workouts. For a quick private workout: advisory lock on the workout id,
-- then client (share), assignment and workout row locks. The initial lookup is advisory only;
-- quick client_id/workout_id are immutable, and callers revalidate state after this returns.
create or replace function public.lock_quick_session_for_write(p_workout_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_assignment_id uuid;
  v_client_id uuid;
begin
  select wa.id, wa.client_id into v_assignment_id, v_client_id
  from public.workout_assignments wa
  where wa.workout_id = p_workout_id and wa.kind = 'quick';
  if v_assignment_id is null then
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('cvf_quick_session_workout:' || p_workout_id::text, 0));
  perform 1 from public.clients where id = v_client_id for share;
  perform 1 from public.workout_assignments where id = v_assignment_id for update;
  perform 1 from public.workouts where id = p_workout_id for update;
  if not found then
    raise exception 'Workout not found';
  end if;
end;
$$;

-- Quick prescriptions and assignment loads are editable only before ANY log has ever been
-- started for the session, including abandoned, completed or archived logs.
create or replace function public.assert_quick_session_not_started(p_workout_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_assignment_id uuid;
begin
  select wa.id into v_assignment_id
  from public.workout_assignments wa
  where wa.workout_id = p_workout_id and wa.kind = 'quick';
  if v_assignment_id is null then
    return;
  end if;
  if exists (
    select 1 from public.workout_logs l
    where l.workout_assignment_id = v_assignment_id or l.source_workout_id = p_workout_id
  ) then
    raise exception 'quick_session_started' using errcode = 'P0001',
      detail = 'This quick session has already been started; its prescription can no longer change.';
  end if;
end;
$$;

-- ---------- save_workout: same signature/return/semantics, shared writer + quick guard ----------
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
begin
  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'Workout name is required';
  end if;

  if p_workout_id is null then
    insert into public.workouts (coach_id, name, description, goal)
    values (p_coach_id, btrim(p_name), nullif(p_description, ''), nullif(p_goal, ''))
    returning id into v_workout_id;
  else
    perform public.lock_quick_session_for_write(p_workout_id);
    perform public.assert_quick_session_not_started(p_workout_id);
    update public.workouts
    set name = btrim(p_name),
        description = nullif(p_description, ''),
        goal = nullif(p_goal, ''),
        updated_at = now()
    where id = p_workout_id and archived = false
    returning id into v_workout_id;
    if not found then return null; end if;
  end if;

  perform public.sync_workout_exercises(v_workout_id, p_exercises);
  return v_workout_id;
end;
$$;

-- ---------- Assignment notes/loads writer: same contract, quick guard on updates ----------
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
  v_quick_workout_id uuid;
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
    select wa.workout_id into v_quick_workout_id
    from public.workout_assignments wa
    where wa.id = p_assignment_id and wa.kind = 'quick';
    if v_quick_workout_id is not null then
      perform public.lock_quick_session_for_write(v_quick_workout_id);
      perform public.assert_quick_session_not_started(v_quick_workout_id);
    end if;
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

-- ---------- Start core: unchanged except the quick-only lock before any log lock ----------
-- Body identical to 20260720173000_exercise_performance_history.sql apart from the marked block.
-- start_workout_log_v2 and quick completion delegate here, so they inherit the lock.
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
  v_quick_workout_id uuid;
begin
  -- Quick sources only: serialize with quick edits/library copies before any log lock.
  if p_workout_assignment_id is not null then
    select wa.workout_id into v_quick_workout_id
    from public.workout_assignments wa
    where wa.id = p_workout_assignment_id and wa.kind = 'quick';
    if v_quick_workout_id is not null then
      perform public.lock_quick_session_for_write(v_quick_workout_id);
    end if;
  end if;
  -- End quick-only block; everything below revalidates the source as before.

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

-- ---------- Access helper (internal) ----------
-- Current access for an ACTIVE acting coach/admin to an ACTIVE client: admin, or the client's
-- current coach. Callers lock the client row first so ownership is stable for the transaction.
create or replace function public.quick_session_can_access_client(p_actor uuid, p_client_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.coaches c
    join public.clients k on k.id = p_client_id
    where c.id = p_actor and c.archived = false
      and k.archived = false
      and (c.is_admin or k.coach_id = c.id)
  );
$$;

-- ---------- Atomic create with an immutable per-actor receipt ----------
-- Returns {state: created|replayed, assignment_id, workout_id} or {state: request_mismatch}
-- or {state: not_found}. Mismatch and not_found carry no receipt details.
create or replace function public.create_quick_session(
  p_actor uuid,
  p_client_id uuid,
  p_request_id uuid,
  p_hash text,
  p_assigned_for date,
  p_name text,
  p_notes text,
  p_exercises jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_receipt public.workout_assignments%rowtype;
  v_client public.clients%rowtype;
  v_workout_id uuid;
  v_assignment_id uuid;
  v_hidden text;
  v_kept integer;
begin
  if p_actor is null or p_request_id is null or p_client_id is null then
    raise exception 'Quick session actor, request and client are required';
  end if;
  if p_hash is null or p_hash !~ '^v[0-9]+:[0-9a-f]{64}$' then
    raise exception 'Quick session request fingerprint is invalid';
  end if;
  if p_assigned_for is null then
    raise exception 'Choose a date for dated workouts';
  end if;
  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'Workout name is required';
  end if;
  if jsonb_typeof(p_exercises) is distinct from 'array' then
    raise exception 'Add at least one exercise';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'cvf_quick_session_request:' || p_actor::text || ':' || p_request_id::text, 0));

  -- Advisory lookup (archived receipts included); rechecked after the quick locks.
  select * into v_receipt from public.workout_assignments
  where created_by_coach_id = p_actor and create_request_id = p_request_id;

  if v_receipt.id is not null then
    perform pg_advisory_xact_lock(hashtextextended('cvf_quick_session_workout:' || v_receipt.workout_id::text, 0));
    perform 1 from public.clients
    where id in (v_receipt.client_id, p_client_id)
    order by id
    for share;
    select * into v_receipt from public.workout_assignments where id = v_receipt.id for update;
    perform 1 from public.workouts where id = v_receipt.workout_id for update;

    -- Both the ORIGINAL client and the newly supplied target must be currently accessible.
    if not public.quick_session_can_access_client(p_actor, v_receipt.client_id)
       or not public.quick_session_can_access_client(p_actor, p_client_id)
       or v_receipt.archived
       or v_receipt.kind <> 'quick'
       or not exists (select 1 from public.workouts w where w.id = v_receipt.workout_id and w.archived = false) then
      return jsonb_build_object('state', 'not_found');
    end if;
    -- Replay never repeats exercise admission or writes. The fingerprint already covers the
    -- client; the explicit comparison keeps a forged equal hash from retargeting a replay.
    if v_receipt.create_request_hash = p_hash and v_receipt.client_id = p_client_id then
      return jsonb_build_object('state', 'replayed', 'assignment_id', v_receipt.id, 'workout_id', v_receipt.workout_id);
    end if;
    return jsonb_build_object('state', 'request_mismatch');
  end if;

  select * into v_client from public.clients where id = p_client_id for share;
  if not public.quick_session_can_access_client(p_actor, p_client_id) then
    return jsonb_build_object('state', 'not_found');
  end if;

  -- Fresh hidden-exercise admission, atomic with the create: hold the picked library rows so a
  -- concurrent hide commits either before (rejected here) or after this create.
  perform 1 from public.exercise_library el
  where el.id in (
    select (e.value ->> 'exercise_library_id')::uuid
    from jsonb_array_elements(p_exercises) e
    where nullif(e.value ->> 'exercise_library_id', '') is not null
  )
  order by el.id
  for share;
  select string_agg(el.name, ', ' order by el.name) into v_hidden
  from public.exercise_library el
  where el.hidden and el.id in (
    select (e.value ->> 'exercise_library_id')::uuid
    from jsonb_array_elements(p_exercises) e
    where nullif(e.value ->> 'exercise_library_id', '') is not null
  );
  if v_hidden is not null then
    raise exception 'Hidden exercises cannot be added: %', v_hidden using errcode = 'P0001';
  end if;

  insert into public.workouts (coach_id, name, description, goal, is_template, client_id, hidden)
  values (v_client.coach_id, btrim(p_name), null, null, false, v_client.id, false)
  returning id into v_workout_id;
  perform public.sync_workout_exercises(v_workout_id, p_exercises);
  select count(*) into v_kept from public.workout_exercises where workout_id = v_workout_id and archived = false;
  if v_kept = 0 then
    raise exception 'Add at least one exercise';
  end if;

  insert into public.workout_assignments (
    client_id, workout_id, assignment_mode, assigned_for, notes,
    kind, created_by_coach_id, create_request_id, create_request_hash
  ) values (
    v_client.id, v_workout_id, 'dated', p_assigned_for, nullif(btrim(coalesce(p_notes, '')), ''),
    'quick', p_actor, p_request_id, p_hash
  ) returning id into v_assignment_id;

  return jsonb_build_object('state', 'created', 'assignment_id', v_assignment_id, 'workout_id', v_workout_id);
end;
$$;

-- ---------- Authorized status lookup for an uncertain create ----------
-- {state: committed, assignment_id} only for the acting coach's own live receipt whose ORIGINAL
-- client is still accessible; every other case is {state: not_found} with no receipt data.
create or replace function public.get_quick_session_request(p_actor uuid, p_request_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_receipt public.workout_assignments%rowtype;
begin
  select * into v_receipt from public.workout_assignments
  where created_by_coach_id = p_actor and create_request_id = p_request_id and kind = 'quick';
  if v_receipt.id is null
     or v_receipt.archived
     or not public.quick_session_can_access_client(p_actor, v_receipt.client_id)
     or not exists (select 1 from public.workouts w where w.id = v_receipt.workout_id and w.archived = false) then
    return jsonb_build_object('state', 'not_found');
  end if;
  return jsonb_build_object('state', 'committed', 'assignment_id', v_receipt.id, 'workout_id', v_receipt.workout_id);
end;
$$;

-- ---------- Generic template copy also serializes quick sources ----------
-- Preserve ordinary template/private copy semantics and the existing service-only interface.
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
  -- Acquire the SAME quick lock before the first source read. Ordinary sources are a no-op.
  -- The dedicated library wrapper may already hold it; transaction locks are reentrant.
  perform public.lock_quick_session_for_write(p_workout_id);
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

-- ---------- Independent, idempotent shared-studio-library save ----------
-- One hidden shared template per quick assignment, cloned from one coherent prescription
-- under the common quick lock; client-specific loads and coach notes are stripped by the
-- existing save_workout_as_template/clone_workout behavior.
create or replace function public.save_quick_session_to_library(p_actor uuid, p_assignment_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_assignment public.workout_assignments%rowtype;
  v_template_id uuid;
begin
  select * into v_assignment from public.workout_assignments
  where id = p_assignment_id and kind = 'quick';
  if v_assignment.id is null then
    return jsonb_build_object('state', 'not_found');
  end if;
  perform public.lock_quick_session_for_write(v_assignment.workout_id);
  select * into v_assignment from public.workout_assignments where id = p_assignment_id;
  -- Recheck the ACTUAL assignment's current access before reading or returning its pointer,
  -- including on replay.
  if v_assignment.archived
     or not public.quick_session_can_access_client(p_actor, v_assignment.client_id)
     or not exists (select 1 from public.workouts w where w.id = v_assignment.workout_id and w.archived = false) then
    return jsonb_build_object('state', 'not_found');
  end if;
  if v_assignment.library_template_id is not null then
    return jsonb_build_object('state', 'replayed', 'template_id', v_assignment.library_template_id);
  end if;
  v_template_id := public.save_workout_as_template(v_assignment.workout_id, p_actor, null, null);
  update public.workout_assignments set library_template_id = v_template_id where id = v_assignment.id;
  return jsonb_build_object('state', 'saved', 'template_id', v_template_id);
end;
$$;

-- ---------- Authoritative, non-paginated completion read ----------
-- One row per requested quick assignment of this client: completed when ANY non-archived
-- completed log (tracked or quick-completed) exists for it. Active/abandoned logs do not count.
-- Express authorizes the client before calling.
create or replace function public.get_quick_session_completion(p_client_id uuid, p_assignment_ids uuid[])
returns table (assignment_id uuid, completed boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  select wa.id, exists (
    select 1 from public.workout_logs l
    where l.client_id = p_client_id and l.workout_assignment_id = wa.id
      and l.status = 'completed' and l.archived = false
  )
  from public.workout_assignments wa
  where wa.id = any(coalesce(p_assignment_ids, array[]::uuid[]))
    and wa.client_id = p_client_id and wa.kind = 'quick';
$$;

-- ---------- Grants: service role only, outer RPCs AND every internal helper ----------
revoke execute on function public.enforce_workout_assignment_receipt() from public, anon, authenticated;
revoke execute on function public.sync_workout_exercises(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.lock_quick_session_for_write(uuid) from public, anon, authenticated;
revoke execute on function public.assert_quick_session_not_started(uuid) from public, anon, authenticated;
revoke execute on function public.save_workout(uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.save_workout_assignment_with_loads(uuid, uuid, uuid, text, date, text, jsonb) from public, anon, authenticated;
revoke execute on function public.start_workout_log(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.quick_session_can_access_client(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.create_quick_session(uuid, uuid, uuid, text, date, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.get_quick_session_request(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.save_workout_as_template(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke execute on function public.save_quick_session_to_library(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.get_quick_session_completion(uuid, uuid[]) from public, anon, authenticated;

grant execute on function public.enforce_workout_assignment_receipt() to service_role;
grant execute on function public.sync_workout_exercises(uuid, jsonb) to service_role;
grant execute on function public.lock_quick_session_for_write(uuid) to service_role;
grant execute on function public.assert_quick_session_not_started(uuid) to service_role;
grant execute on function public.save_workout(uuid, uuid, text, text, text, jsonb) to service_role;
grant execute on function public.save_workout_assignment_with_loads(uuid, uuid, uuid, text, date, text, jsonb) to service_role;
grant execute on function public.start_workout_log(uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.quick_session_can_access_client(uuid, uuid) to service_role;
grant execute on function public.create_quick_session(uuid, uuid, uuid, text, date, text, text, jsonb) to service_role;
grant execute on function public.get_quick_session_request(uuid, uuid) to service_role;
grant execute on function public.save_workout_as_template(uuid, uuid, text, uuid) to service_role;
grant execute on function public.save_quick_session_to_library(uuid, uuid) to service_role;
grant execute on function public.get_quick_session_completion(uuid, uuid[]) to service_role;
