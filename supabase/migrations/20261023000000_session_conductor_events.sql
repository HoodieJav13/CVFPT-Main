-- L12 multi-device session conductor + PT-Sub exercise substitution
-- (contract pt-session-events/v1, L12/CONTRACT.md).
--
-- LOCAL DRAFT. Applied only to the owned loopback fixture stack. Not applied to
-- any hosted database; the version prefix is a local placeholder to be reserved
-- after a fresh migration inventory before any migration PR exists.
--
-- Additive. Existing rows get revision 0 / plan_revision 0. Express remains the
-- authorization boundary: every new table has RLS on, no policies and grants
-- for service_role only (the Coach Notes pattern). The only change to an
-- existing guarantee is a transaction-scoped exception in the completed-log
-- immutability trigger, used solely by resolve_workout_set_conflict() for an
-- explicit, recorded coach resolution of a retained conflict.

-- ---------- Revisions on existing log rows ----------
alter table public.workout_log_sets
  add column revision integer not null default 0 check (revision >= 0),
  add column last_actor_role text check (last_actor_role is null or last_actor_role in ('client', 'coach')),
  add column last_event_id uuid,
  add column completed_plan_revision integer;

alter table public.workout_log_exercises
  add column plan_revision integer not null default 0 check (plan_revision >= 0),
  add column substitutes_log_exercise_id uuid references public.workout_log_exercises(id),
  add column substitution_id uuid;

-- ---------- Set events (idempotent, append-only) ----------
create table public.workout_set_events (
  id uuid primary key,
  workout_log_id uuid not null references public.workout_logs(id),
  workout_log_set_id uuid not null references public.workout_log_sets(id),
  client_id uuid not null references public.clients(id),
  actor_role text not null check (actor_role in ('client', 'coach')),
  actor_coach_id uuid references public.coaches(id),
  base_revision integer,
  applied_revision integer,
  local_seq integer,
  offline boolean not null default false,
  plan_revision_seen integer,
  payload jsonb not null,
  outcome text not null check (outcome in ('applied', 'unchanged', 'conflict', 'resolution')),
  conflict_id uuid,
  created_at timestamptz not null default now()
);
create index idx_workout_set_events_set on public.workout_set_events(workout_log_set_id, created_at);

-- ---------- Retained conflicts ----------
create table public.workout_set_conflicts (
  id uuid primary key default gen_random_uuid(),
  workout_log_id uuid not null references public.workout_logs(id),
  workout_log_set_id uuid not null references public.workout_log_sets(id),
  client_id uuid not null references public.clients(id),
  kept_value jsonb not null,
  kept_actor_role text,
  kept_event_id uuid,
  kept_at timestamptz,
  incoming_value jsonb not null,
  incoming_actor_role text not null check (incoming_actor_role in ('client', 'coach')),
  incoming_event_id uuid not null unique,
  incoming_offline boolean not null default false,
  incoming_at timestamptz not null default now(),
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolution_choice text check (resolution_choice is null or resolution_choice in ('current', 'incoming', 'custom')),
  resolved_value jsonb,
  resolved_by_coach_id uuid references public.coaches(id),
  resolved_event_id uuid unique,
  resolved_at timestamptz,
  client_note text check (client_note is null or char_length(client_note) between 1 and 500),
  client_note_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_workout_set_conflicts_log on public.workout_set_conflicts(workout_log_id, status);

-- ---------- In-app coach notices (one per trigger) ----------
create table public.coach_notices (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.coaches(id),
  client_id uuid not null references public.clients(id),
  kind text not null check (kind in ('set_conflict', 'substitution_request', 'substitution_used', 'substitution_offline')),
  dedupe_key text not null unique,
  workout_log_id uuid references public.workout_logs(id),
  ref_id uuid,
  summary text not null check (char_length(summary) between 1 and 300),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index idx_coach_notices_coach on public.coach_notices(coach_id, created_at desc);

-- ---------- Group conductor record (coach-only, off the single device) ----------
create table public.group_sessions (
  id uuid primary key,
  coach_id uuid not null references public.coaches(id),
  title text not null check (char_length(title) between 1 and 80),
  session_date date not null,
  mode text not null check (mode in ('participants', 'stations')),
  participants jsonb not null default '[]'::jsonb,
  station_state jsonb,
  status text not null default 'open' check (status in ('open', 'finished')),
  revision integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_group_sessions_coach on public.group_sessions(coach_id, status, updated_at desc);

-- ---------- PT-Sub: coach-planned backups ----------
create table public.workout_exercise_backups (
  id uuid primary key default gen_random_uuid(),
  workout_exercise_id uuid not null references public.workout_exercises(id),
  backup_exercise_library_id uuid not null references public.exercise_library(id),
  target_sets integer check (target_sets is null or target_sets between 1 and 10),
  target_reps text check (target_reps is null or char_length(target_reps) between 1 and 20),
  target_load_value numeric check (target_load_value is null or target_load_value >= 0),
  target_load_unit text check (target_load_unit is null or target_load_unit in ('lb', 'kg')),
  client_note text check (client_note is null or char_length(client_note) between 1 and 300),
  created_by_coach_id uuid not null references public.coaches(id),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  constraint workout_exercise_backups_load_pair check ((target_load_value is null) = (target_load_unit is null))
);
create unique index idx_workout_exercise_backups_active
  on public.workout_exercise_backups(workout_exercise_id, backup_exercise_library_id) where archived = false;

-- ---------- PT-Sub: substitutions on a log (this workout only) ----------
create table public.workout_log_substitutions (
  id uuid primary key,
  workout_log_id uuid not null references public.workout_logs(id),
  client_id uuid not null references public.clients(id),
  original_log_exercise_id uuid not null references public.workout_log_exercises(id),
  original_exercise_library_id uuid,
  original_name text not null,
  replacement_log_exercise_id uuid not null unique,
  replacement_exercise_library_id uuid not null references public.exercise_library(id),
  replacement_name text not null,
  source text not null check (source in ('coach_backup', 'catalog_suggestion')),
  backup_id uuid references public.workout_exercise_backups(id),
  trigger text not null check (trigger in ('equipment_busy', 'equipment_missing', 'cannot_do', 'location', 'other')),
  reason text check (reason is null or char_length(reason) between 1 and 200),
  targets jsonb not null default '{}'::jsonb,
  status text not null check (status in ('pending_confirmation', 'active', 'declined')),
  offline boolean not null default false,
  chosen_at timestamptz,
  actor_role text not null check (actor_role in ('client', 'coach')),
  actor_coach_id uuid references public.coaches(id),
  coach_review_status text not null default 'none' check (coach_review_status in ('none', 'pending', 'reviewed')),
  decided_by_coach_id uuid references public.coaches(id),
  decided_at timestamptz,
  decision_event_id uuid unique,
  reviewed_by_coach_id uuid references public.coaches(id),
  reviewed_at timestamptz,
  review_event_id uuid unique,
  created_at timestamptz not null default now()
);
create unique index idx_workout_log_substitutions_open
  on public.workout_log_substitutions(original_log_exercise_id) where status in ('pending_confirmation', 'active');

-- ---------- PT-Sub: explicit coach program application (audit) ----------
create table public.program_substitution_applications (
  id uuid primary key,
  program_assignment_id uuid not null references public.program_assignments(id),
  substitution_id uuid not null references public.workout_log_substitutions(id),
  coach_id uuid not null references public.coaches(id),
  affected jsonb not null,
  targets jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['workout_set_events', 'workout_set_conflicts', 'coach_notices', 'group_sessions',
    'workout_exercise_backups', 'workout_log_substitutions', 'program_substitution_applications'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all privileges on table public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select, insert, update on table public.%I to service_role', t);
  end loop;
end $$;

-- ---------- Completed-log immutability: one recorded exception ----------
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
    -- Only resolve_workout_set_conflict() sets this transaction-local flag, and
    -- only for a set with a retained conflict; everything else stays immutable.
    if tg_table_name = 'workout_log_sets' and tg_op = 'UPDATE'
       and current_setting('cvf.set_conflict_resolution', true) = new.id::text then
      return new;
    end if;
    raise exception 'Completed workout logs are immutable';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- ---------- Atomic set write (idempotent; retains conflicts) ----------
create or replace function public.set_value_json(s public.workout_log_sets)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'status', s.status, 'actual_reps', s.actual_reps, 'actual_load_value', s.actual_load_value,
    'actual_load_unit', s.actual_load_unit, 'actual_rpe', s.actual_rpe,
    'actual_duration_value', s.actual_duration_value, 'actual_duration_unit', s.actual_duration_unit,
    'actual_distance_value', s.actual_distance_value, 'actual_distance_unit', s.actual_distance_unit);
$$;

create or replace function public.apply_workout_set_event(
  p_set_id uuid, p_event_id uuid, p_actor_role text, p_actor_coach_id uuid,
  p_base_revision integer, p_local_seq integer, p_offline boolean, p_plan_revision_seen integer,
  p_payload jsonb
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_event public.workout_set_events;
  v_set public.workout_log_sets;
  v_log_id uuid;
  v_client_id uuid;
  v_coach_id uuid;
  v_incoming jsonb;
  v_current jsonb;
  v_outcome text;
  v_conflict_id uuid;
  v_same_actor boolean;
  v_log_status text;
begin
  if p_actor_role not in ('client', 'coach') then raise exception 'invalid actor'; end if;
  select * into v_event from public.workout_set_events where id = p_event_id;
  if found then
    if v_event.workout_log_set_id <> p_set_id then raise exception 'event_id_reused'; end if;
    select * into v_set from public.workout_log_sets where id = p_set_id;
    return jsonb_build_object('outcome', 'replayed', 'original_outcome', v_event.outcome, 'conflict_id', v_event.conflict_id, 'set', to_jsonb(v_set));
  end if;

  select s.* into v_set from public.workout_log_sets s where s.id = p_set_id and not s.archived for update;
  if not found then raise exception 'Workout set not found'; end if;
  select e.workout_log_id, l.client_id, c.coach_id, l.status into v_log_id, v_client_id, v_coach_id, v_log_status
  from public.workout_log_exercises e
  join public.workout_logs l on l.id = e.workout_log_id
  join public.clients c on c.id = l.client_id
  where e.id = v_set.workout_log_exercise_id;

  v_current := public.set_value_json(v_set);
  v_incoming := v_current || (p_payload - 'completed_at' - 'updated_at');
  v_same_actor := v_set.last_actor_role = p_actor_role
    and (p_actor_role = 'client' or v_set.entered_by_coach_id is not distinct from p_actor_coach_id);

  if v_log_status <> 'active' then
    -- The workout was finished (or abandoned) before this write arrived, e.g. a
    -- coach finished it while the client was offline. Completed history stays
    -- immutable; a different value is kept as a disagreement for the coach,
    -- resolvable only through resolve_workout_set_conflict (review P2-1).
    v_outcome := case when v_incoming = v_current then 'unchanged' else 'conflict' end;
  elsif p_base_revision is null or p_base_revision = v_set.revision or v_same_actor or v_set.last_actor_role is null and v_set.revision = 0 then
    v_outcome := 'applied';
  elsif v_incoming = v_current then
    v_outcome := 'unchanged';
  else
    v_outcome := 'conflict';
  end if;

  if v_outcome = 'applied' then
    update public.workout_log_sets set
      status = coalesce(p_payload ->> 'status', status),
      actual_reps = case when p_payload ? 'actual_reps' then (p_payload ->> 'actual_reps')::integer else actual_reps end,
      actual_load_value = case when p_payload ? 'actual_load_value' then (p_payload ->> 'actual_load_value')::numeric else actual_load_value end,
      actual_load_unit = case when p_payload ? 'actual_load_unit' then p_payload ->> 'actual_load_unit' else actual_load_unit end,
      actual_rpe = case when p_payload ? 'actual_rpe' then (p_payload ->> 'actual_rpe')::numeric else actual_rpe end,
      actual_duration_value = case when p_payload ? 'actual_duration_value' then (p_payload ->> 'actual_duration_value')::numeric else actual_duration_value end,
      actual_duration_unit = case when p_payload ? 'actual_duration_unit' then p_payload ->> 'actual_duration_unit' else actual_duration_unit end,
      actual_distance_value = case when p_payload ? 'actual_distance_value' then (p_payload ->> 'actual_distance_value')::numeric else actual_distance_value end,
      actual_distance_unit = case when p_payload ? 'actual_distance_unit' then p_payload ->> 'actual_distance_unit' else actual_distance_unit end,
      completed_at = case when coalesce(p_payload ->> 'status', status) = 'completed' then coalesce((p_payload ->> 'completed_at')::timestamptz, completed_at, now()) else null end,
      completed_plan_revision = case when coalesce(p_payload ->> 'status', status) = 'completed' then coalesce(p_plan_revision_seen, completed_plan_revision) else null end,
      entered_by = p_actor_role,
      entered_by_coach_id = p_actor_coach_id,
      revision = revision + 1,
      last_actor_role = p_actor_role,
      last_event_id = p_event_id,
      updated_at = now()
    where id = p_set_id
    returning * into v_set;
  elsif v_outcome = 'conflict' then
    -- One open disagreement per set per side: a later edit from the same side
    -- (e.g. an offline client's weight, then reps, then "done") updates that
    -- side's value in the existing disagreement; every event stays in history.
    select id into v_conflict_id from public.workout_set_conflicts
    where workout_log_set_id = p_set_id and status = 'open' and incoming_actor_role = p_actor_role
    for update;
    if v_conflict_id is not null then
      update public.workout_set_conflicts
      set incoming_value = v_incoming, incoming_offline = incoming_offline or coalesce(p_offline, false), incoming_at = now()
      where id = v_conflict_id;
    else
    insert into public.workout_set_conflicts (
      workout_log_id, workout_log_set_id, client_id, kept_value, kept_actor_role, kept_event_id, kept_at,
      incoming_value, incoming_actor_role, incoming_event_id, incoming_offline
    ) values (
      v_log_id, p_set_id, v_client_id, v_current, coalesce(v_set.last_actor_role, v_set.entered_by), v_set.last_event_id, v_set.updated_at,
      v_incoming, p_actor_role, p_event_id, coalesce(p_offline, false)
    ) returning id into v_conflict_id;
    insert into public.coach_notices (coach_id, client_id, kind, dedupe_key, workout_log_id, ref_id, summary)
    select v_coach_id, v_client_id, 'set_conflict', 'conflict:' || v_conflict_id, v_log_id, v_conflict_id,
      left(c.name || ': two different values for ' || e.exercise_name || ' set ' || v_set.set_number || '. Both are kept; choose the final value.', 300)
    from public.clients c, public.workout_log_exercises e
    where c.id = v_client_id and e.id = v_set.workout_log_exercise_id
    on conflict (dedupe_key) do nothing;
    end if;
  end if;

  insert into public.workout_set_events (
    id, workout_log_id, workout_log_set_id, client_id, actor_role, actor_coach_id, base_revision, applied_revision,
    local_seq, offline, plan_revision_seen, payload, outcome, conflict_id
  ) values (
    p_event_id, v_log_id, p_set_id, v_client_id, p_actor_role, p_actor_coach_id, p_base_revision,
    case when v_outcome = 'applied' then v_set.revision else null end,
    p_local_seq, coalesce(p_offline, false), p_plan_revision_seen, v_incoming, v_outcome, v_conflict_id
  );
  return jsonb_build_object('outcome', v_outcome, 'conflict_id', v_conflict_id, 'set', to_jsonb(v_set));
end;
$$;

-- ---------- Explicit coach resolution (also on a completed log) ----------
create or replace function public.resolve_workout_set_conflict(
  p_conflict_id uuid, p_event_id uuid, p_choice text, p_value jsonb, p_coach_id uuid
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_conflict public.workout_set_conflicts;
  v_value jsonb;
  v_set public.workout_log_sets;
begin
  select * into v_conflict from public.workout_set_conflicts where id = p_conflict_id for update;
  if not found then raise exception 'Conflict not found'; end if;
  if v_conflict.status = 'resolved' then
    if v_conflict.resolved_event_id = p_event_id then
      select * into v_set from public.workout_log_sets where id = v_conflict.workout_log_set_id;
      return jsonb_build_object('outcome', 'replayed', 'conflict', to_jsonb(v_conflict), 'set', to_jsonb(v_set));
    end if;
    raise exception 'Conflict already resolved';
  end if;
  if p_choice = 'current' then v_value := v_conflict.kept_value;
  elsif p_choice = 'incoming' then v_value := v_conflict.incoming_value;
  elsif p_choice = 'custom' then v_value := v_conflict.kept_value || coalesce(p_value, '{}'::jsonb);
  else raise exception 'invalid choice';
  end if;
  perform set_config('cvf.set_conflict_resolution', v_conflict.workout_log_set_id::text, true);
  update public.workout_log_sets set
    status = v_value ->> 'status',
    actual_reps = (v_value ->> 'actual_reps')::integer,
    actual_load_value = (v_value ->> 'actual_load_value')::numeric,
    actual_load_unit = v_value ->> 'actual_load_unit',
    actual_rpe = (v_value ->> 'actual_rpe')::numeric,
    actual_duration_value = (v_value ->> 'actual_duration_value')::numeric,
    actual_duration_unit = v_value ->> 'actual_duration_unit',
    actual_distance_value = (v_value ->> 'actual_distance_value')::numeric,
    actual_distance_unit = v_value ->> 'actual_distance_unit',
    completed_at = case when v_value ->> 'status' = 'completed' then coalesce(completed_at, now()) else null end,
    entered_by = 'coach', entered_by_coach_id = p_coach_id,
    revision = revision + 1, last_actor_role = 'coach', last_event_id = p_event_id, updated_at = now()
  where id = v_conflict.workout_log_set_id
  returning * into v_set;
  perform set_config('cvf.set_conflict_resolution', '', true);
  update public.workout_set_conflicts set status = 'resolved', resolution_choice = p_choice, resolved_value = v_value,
    resolved_by_coach_id = p_coach_id, resolved_event_id = p_event_id, resolved_at = now()
  where id = p_conflict_id returning * into v_conflict;
  insert into public.workout_set_events (id, workout_log_id, workout_log_set_id, client_id, actor_role, actor_coach_id,
    applied_revision, payload, outcome, conflict_id)
  values (p_event_id, v_conflict.workout_log_id, v_conflict.workout_log_set_id, v_conflict.client_id, 'coach', p_coach_id,
    v_set.revision, v_value, 'resolution', p_conflict_id);
  return jsonb_build_object('outcome', 'resolved', 'conflict', to_jsonb(v_conflict), 'set', to_jsonb(v_set));
end;
$$;

-- ---------- PT-Sub: substitution create / activate ----------
create or replace function public.activate_workout_substitution(p_sub_id uuid, p_create_sets boolean default true)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_sub public.workout_log_substitutions;
  v_original public.workout_log_exercises;
  v_sets integer;
  v_load numeric;
  v_unit text;
  i integer;
begin
  select * into v_sub from public.workout_log_substitutions where id = p_sub_id for update;
  if exists (select 1 from public.workout_log_exercises where id = v_sub.replacement_log_exercise_id) then return; end if;
  select * into v_original from public.workout_log_exercises where id = v_sub.original_log_exercise_id;
  v_sets := nullif(v_sub.targets ->> 'sets', '')::integer;
  v_load := nullif(v_sub.targets ->> 'load_value', '')::numeric;
  v_unit := case when v_load is null then null else coalesce(nullif(v_sub.targets ->> 'load_unit', ''), 'lb') end;
  insert into public.workout_log_exercises (
    id, workout_log_id, source_workout_exercise_id, exercise_library_id, exercise_name,
    prescribed_sets, prescribed_reps, prescribed_load_value, prescribed_load_unit, position,
    superset_group, tracking_type, substitutes_log_exercise_id, substitution_id
  ) values (
    v_sub.replacement_log_exercise_id, v_sub.workout_log_id, null, v_sub.replacement_exercise_library_id, v_sub.replacement_name,
    v_sets::text, nullif(v_sub.targets ->> 'reps', ''), v_load, v_unit, v_original.position,
    null, 'reps_weight', v_original.id, v_sub.id
  );
  -- A client that logs offline adds its own sets (client_operation_id), so it asks
  -- for none here; coach approvals create the confirmed target sets.
  if v_sets is not null and p_create_sets then
    for i in 1..v_sets loop
      insert into public.workout_log_sets (workout_log_exercise_id, set_number, set_origin, status, actual_load_value, actual_load_unit)
      values (v_sub.replacement_log_exercise_id, i, 'prescribed', 'pending', v_load, v_unit);
    end loop;
  end if;
end;
$$;

create or replace function public.create_workout_substitution(p_row jsonb, p_activate boolean)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_existing public.workout_log_substitutions;
  v_sub public.workout_log_substitutions;
  v_status text;
begin
  select * into v_existing from public.workout_log_substitutions where id = (p_row ->> 'id')::uuid;
  if found then return jsonb_build_object('outcome', 'replayed', 'substitution', to_jsonb(v_existing)); end if;
  perform 1 from public.workout_logs where id = (p_row ->> 'workout_log_id')::uuid and status = 'active' for update;
  if not found then raise exception 'Completed workouts cannot be changed'; end if;
  v_status := case when p_activate then 'active' else 'pending_confirmation' end;
  insert into public.workout_log_substitutions (
    id, workout_log_id, client_id, original_log_exercise_id, original_exercise_library_id, original_name,
    replacement_log_exercise_id, replacement_exercise_library_id, replacement_name, source, backup_id, trigger, reason,
    targets, status, offline, chosen_at, actor_role, actor_coach_id, coach_review_status
  ) values (
    (p_row ->> 'id')::uuid, (p_row ->> 'workout_log_id')::uuid, (p_row ->> 'client_id')::uuid,
    (p_row ->> 'original_log_exercise_id')::uuid, nullif(p_row ->> 'original_exercise_library_id', '')::uuid, p_row ->> 'original_name',
    (p_row ->> 'replacement_log_exercise_id')::uuid, (p_row ->> 'replacement_exercise_library_id')::uuid, p_row ->> 'replacement_name',
    p_row ->> 'source', nullif(p_row ->> 'backup_id', '')::uuid, p_row ->> 'trigger', nullif(p_row ->> 'reason', ''),
    coalesce(p_row -> 'targets', '{}'::jsonb), v_status, coalesce((p_row ->> 'offline')::boolean, false),
    nullif(p_row ->> 'chosen_at', '')::timestamptz, p_row ->> 'actor_role', nullif(p_row ->> 'actor_coach_id', '')::uuid,
    coalesce(p_row ->> 'coach_review_status', 'none')
  ) returning * into v_sub;
  if p_activate then perform public.activate_workout_substitution(v_sub.id, coalesce((p_row ->> 'create_target_sets')::boolean, true)); end if;
  return jsonb_build_object('outcome', 'created', 'substitution', to_jsonb(v_sub));
exception when unique_violation then
  select * into v_existing from public.workout_log_substitutions where id = (p_row ->> 'id')::uuid;
  if found then return jsonb_build_object('outcome', 'replayed', 'substitution', to_jsonb(v_existing)); end if;
  raise exception 'substitution_exists';
end;
$$;

-- ---------- PT-Sub: explicit program application (client's own program copy) ----------
create or replace function public.program_substitution_targets(p_assignment_id uuid, p_original_library_id uuid, p_original_name text)
returns table (workout_exercise_id uuid, program_day_id uuid, day_number integer, workout_id uuid, workout_name text,
  sets text, reps text, default_load_value numeric, default_load_unit text)
language sql stable security invoker set search_path = '' as $$
  select we.id, pd.id, pd.day_number, w.id, w.name, we.sets, we.reps, we.default_load_value, we.default_load_unit
  from public.program_assignments pa
  join public.programs p on p.id = pa.program_id and not p.archived
  join public.program_days pd on pd.program_id = p.id and not pd.archived
  join public.workouts w on w.id = pd.workout_id and not w.archived
  join public.workout_exercises we on we.workout_id = w.id and not we.archived
  where pa.id = p_assignment_id and not pa.archived
    and (case when p_original_library_id is not null then we.exercise_library_id = p_original_library_id
              else we.exercise_library_id is null and lower(btrim(we.custom_name)) = lower(btrim(p_original_name)) end)
  order by pd.day_number, we.position;
$$;

create or replace function public.apply_program_substitution(
  p_application_id uuid, p_assignment_id uuid, p_substitution_id uuid, p_coach_id uuid,
  p_expected_ids uuid[], p_targets jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_existing public.program_substitution_applications;
  v_sub public.workout_log_substitutions;
  v_program public.programs;
  v_ids uuid[];
  v_affected jsonb := '[]'::jsonb;
  r record;
  v_load numeric;
begin
  select * into v_existing from public.program_substitution_applications where id = p_application_id;
  if found then return jsonb_build_object('outcome', 'replayed', 'application', to_jsonb(v_existing)); end if;
  select * into v_sub from public.workout_log_substitutions where id = p_substitution_id and status = 'active';
  if not found then raise exception 'Substitution not active'; end if;
  select p.* into v_program from public.program_assignments pa join public.programs p on p.id = pa.program_id
  where pa.id = p_assignment_id and pa.client_id = v_sub.client_id and not pa.archived for update of p;
  if not found then raise exception 'Program assignment not found'; end if;
  if v_program.is_template or v_program.client_id is distinct from v_sub.client_id then
    raise exception 'shared_program: this assignment still uses shared template workouts; edit it in the program builder';
  end if;
  select coalesce(array_agg(t.workout_exercise_id order by t.workout_exercise_id), '{}') into v_ids
  from public.program_substitution_targets(p_assignment_id, v_sub.original_exercise_library_id, v_sub.original_name) t;
  if v_ids is distinct from (select coalesce(array_agg(x order by x), '{}') from unnest(p_expected_ids) x) then
    raise exception 'preview_mismatch';
  end if;
  v_load := nullif(p_targets ->> 'load_value', '')::numeric;
  for r in select * from public.program_substitution_targets(p_assignment_id, v_sub.original_exercise_library_id, v_sub.original_name) loop
    insert into public.workout_exercises (workout_id, exercise_library_id, custom_name, sets, reps, rest, tempo,
      default_load_value, default_load_unit, position, superset_group, tracking_type)
    select we.workout_id, v_sub.replacement_exercise_library_id, null,
      nullif(p_targets ->> 'sets', ''), nullif(p_targets ->> 'reps', ''), we.rest, null,
      v_load, case when v_load is null then null else coalesce(nullif(p_targets ->> 'load_unit', ''), 'lb') end,
      we.position, we.superset_group, 'reps_weight'
    from public.workout_exercises we where we.id = r.workout_exercise_id;
    update public.program_assignment_exercise_loads set archived = true where workout_exercise_id = r.workout_exercise_id and not archived;
    update public.workout_exercises set archived = true where id = r.workout_exercise_id;
    v_affected := v_affected || jsonb_build_object('workout_exercise_id', r.workout_exercise_id, 'day_number', r.day_number, 'workout_name', r.workout_name);
  end loop;
  insert into public.program_substitution_applications (id, program_assignment_id, substitution_id, coach_id, affected, targets)
  values (p_application_id, p_assignment_id, p_substitution_id, p_coach_id, v_affected, coalesce(p_targets, '{}'::jsonb))
  returning * into v_existing;
  return jsonb_build_object('outcome', 'applied', 'application', to_jsonb(v_existing));
end;
$$;

revoke all on function public.apply_workout_set_event(uuid, uuid, text, uuid, integer, integer, boolean, integer, jsonb) from public, anon, authenticated;
revoke all on function public.resolve_workout_set_conflict(uuid, uuid, text, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.create_workout_substitution(jsonb, boolean) from public, anon, authenticated;
revoke all on function public.activate_workout_substitution(uuid, boolean) from public, anon, authenticated;
revoke all on function public.apply_program_substitution(uuid, uuid, uuid, uuid, uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.program_substitution_targets(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.set_value_json(public.workout_log_sets) from public, anon, authenticated;
grant execute on function public.apply_workout_set_event(uuid, uuid, text, uuid, integer, integer, boolean, integer, jsonb) to service_role;
grant execute on function public.resolve_workout_set_conflict(uuid, uuid, text, jsonb, uuid) to service_role;
grant execute on function public.create_workout_substitution(jsonb, boolean) to service_role;
grant execute on function public.activate_workout_substitution(uuid, boolean) to service_role;
grant execute on function public.apply_program_substitution(uuid, uuid, uuid, uuid, uuid[], jsonb) to service_role;
grant execute on function public.program_substitution_targets(uuid, uuid, text) to service_role;
grant execute on function public.set_value_json(public.workout_log_sets) to service_role;
