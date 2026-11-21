-- Look A: scoped "done, not set-tracked" completion, one strict Undo, and the
-- prescription facts the Focus tracker shows (local only; owner direction
-- 2026-11-14). Forward-only and backward-compatible: every existing function
-- signature, grant and migration byte is kept; new behavior is reached through
-- new functions, two compatible wrappers (section 2) and in-place replacements
-- that only add to existing behavior (set_value_origin_guard,
-- prevent_completed_workout_log_change, program_history_snapshot).
--
-- Mapping of the prototype's x_ fields (see docs/look-a/MAPPING.md):
--   x_prescribed_load_max  -> workout_exercises.prescribed_load_max and the
--                             start snapshot workout_log_exercises.prescribed_load_max
--   x_per_side             -> workout_exercises.per_side / workout_log_exercises.per_side
--   x_not_set_tracked      -> workout_log_exercises.not_set_tracked (exercise
--                             scope) and workout_logs.not_set_tracked (whole
--                             workout). Sets are never written by either.
--   x_swapped_from         -> existing workout_log_substitutions /
--                             substitutes_log_exercise_id (no new storage)
--   x_last_time, x_client_plan, x_rest_over_seconds -> derived or device-local;
--                             no column (documented in MAPPING.md)
--
-- Undo. Every undoable change is recorded once in workout_material_changes with
-- a server-built minimal inverse and the workout's material version right after
-- the change. The version is built from monotonic per-row counters
-- (material_seq) that move only when a row's material content actually
-- changes, by any writer, and never move back (an Undo moves them forward too).
-- An Undo applies only while (a) its change is still the latest applied change
-- in the ledger and (b) the workout's version is exactly the recorded one. So
-- one inverse exists at a time and is retired for good by the next material
-- change; done(A), done(B), Undo(B) cannot revive A, and an edit followed by a
-- restore of the same values cannot revive an older Undo. A write that changes
-- no material content (same values, a read acknowledgement) moves no counter.
--
-- Locking (no parent-revision trigger is added anywhere; counters are bumped
-- only on the row being written, inside its own BEFORE UPDATE trigger). Every
-- new function locks the workout_logs row FOR NO KEY UPDATE first, then only
-- the rows it writes or fences: sets ordered by id, then the one exercise row.
-- Existing writers keep their order: a set event or legacy PATCH locks its set
-- and only takes KEY SHARE (foreign keys) on parents, which NO KEY UPDATE does
-- not block; the metrics trigger's FOR SHARE on the log (extra-set INSERT only)
-- waits for these functions while holding nothing they wait for. Coach
-- responses and cue writes re-read a finished workout under FOR SHARE (section
-- 8b) so a writer that saw "completed" cannot land after an Undo reopened it.

-- ---------- 1. Columns ----------
alter table public.workout_exercises
  add column prescribed_load_max numeric
    constraint workout_exercises_prescribed_load_max_check check (prescribed_load_max is null or prescribed_load_max >= 0),
  add column per_side boolean not null default false;
alter table public.workout_exercises
  add constraint workout_exercises_load_range_check
    check (prescribed_load_max is null or (default_load_value is not null and prescribed_load_max > default_load_value));

alter table public.workout_log_exercises
  add column prescribed_load_max numeric
    constraint workout_log_exercises_prescribed_load_max_check check (prescribed_load_max is null or prescribed_load_max >= 0),
  add column per_side boolean not null default false,
  add column not_set_tracked boolean not null default false,
  add column not_set_tracked_at timestamptz,
  add column not_set_tracked_change_id uuid,
  add column material_seq bigint not null default 0;
alter table public.workout_log_exercises
  add constraint workout_log_exercises_load_range_check
    check (prescribed_load_max is null or (prescribed_load_value is not null and prescribed_load_max > prescribed_load_value)),
  add constraint workout_log_exercises_not_set_tracked_stamp_check
    check (not_set_tracked = (not_set_tracked_at is not null));

alter table public.workout_logs
  add column not_set_tracked boolean not null default false,
  add column not_set_tracked_at timestamptz,
  add column not_set_tracked_change_id uuid,
  add column material_seq bigint not null default 0;
alter table public.workout_logs
  add constraint workout_logs_not_set_tracked_stamp_check
    check (not_set_tracked = (not_set_tracked_at is not null));

alter table public.workout_log_sets add column material_seq bigint not null default 0;
alter table public.workout_log_substitutions add column material_seq bigint not null default 0;

-- ---------- 1b. Monotonic material counters ----------
-- Sets: the existing origin guard is the only BEFORE UPDATE trigger the set
-- table may have (value_origin tests pin the trigger list), so it also keeps
-- the counter. Its origin rules are unchanged, byte for byte, above the added
-- final step. Material = every column except bookkeeping that changes without
-- changing what the set says.
create or replace function public.set_value_origin_guard()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.value_origin_nonce is not distinct from old.value_origin_nonce then
    if new.revision is distinct from old.revision
       or public.set_value_json(new) is distinct from public.set_value_json(old)
       or new.updated_at is distinct from old.updated_at then
      new.value_origin := 'unknown';
      new.prefill_load_value := null;
      new.prefill_load_unit := null;
    else
      new.value_origin := old.value_origin;
      new.prefill_load_value := old.prefill_load_value;
      new.prefill_load_unit := old.prefill_load_unit;
    end if;
  end if;
  -- Look A (20261114120000): the counter moves only on a material change and
  -- can never be set by a writer.
  new.material_seq := old.material_seq + case when
    (to_jsonb(new) - array['updated_at', 'revision', 'value_origin_nonce', 'last_event_id', 'last_actor_role', 'material_seq'])
    is distinct from
    (to_jsonb(old) - array['updated_at', 'revision', 'value_origin_nonce', 'last_event_id', 'last_actor_role', 'material_seq'])
    then 1 else 0 end;
  return new;
end;
$$;

-- Logs, exercises and substitutions: one row-local trigger each. TG_ARGV names
-- the bookkeeping columns left out of the comparison.
create function public.look_a_bump_material_seq() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare v_skip text[] := coalesce(tg_argv::text[], '{}'::text[]) || array['material_seq'];
begin
  new.material_seq := old.material_seq + case when (to_jsonb(new) - v_skip) is distinct from (to_jsonb(old) - v_skip) then 1 else 0 end;
  return new;
end;
$$;
create trigger look_a_material_seq before update on public.workout_logs
  for each row execute function public.look_a_bump_material_seq('updated_at');
create trigger look_a_material_seq before update on public.workout_log_exercises
  for each row execute function public.look_a_bump_material_seq('updated_at', 'plan_revision');
create trigger look_a_material_seq before update on public.workout_log_substitutions
  for each row execute function public.look_a_bump_material_seq('updated_at');

-- ---------- 1c. Load range stays valid through every writer ----------
-- The range is "lower load to upper load" in the lower load's unit. A writer
-- that changes the lower load's value or unit, or clears it, without setting
-- the upper load in the same write (the existing authoring core, a plan edit,
-- an old caller) leaves an upper load that no longer means anything (100-110 lb
-- relabelled as 100 kg-110 kg, or 100-110 moved to 105), so it is cleared: the
-- row becomes the single number it was written as. A writer that sets the upper
-- load itself must give a valid range, or the write is refused. Runs before the
-- CHECK, so the CHECK only ever sees a final, valid row.
create function public.look_a_load_range() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  v_value_key text := case when tg_table_name = 'workout_exercises' then 'default_load_value' else 'prescribed_load_value' end;
  v_unit_key text := case when tg_table_name = 'workout_exercises' then 'default_load_unit' else 'prescribed_load_unit' end;
  v_lower numeric := (to_jsonb(new) ->> v_value_key)::numeric;
  v_max_changed boolean;
  v_context_changed boolean;
begin
  if new.prescribed_load_max is null then return new; end if;
  v_max_changed := tg_op = 'INSERT' or new.prescribed_load_max is distinct from old.prescribed_load_max;
  v_context_changed := tg_op = 'UPDATE' and ((to_jsonb(new) ->> v_value_key)::numeric is distinct from (to_jsonb(old) ->> v_value_key)::numeric
    or (to_jsonb(new) ->> v_unit_key) is distinct from (to_jsonb(old) ->> v_unit_key));
  if not v_max_changed and v_context_changed then
    new.prescribed_load_max := null;
    return new;
  end if;
  if v_lower is not null and new.prescribed_load_max > v_lower then return new; end if;
  if v_max_changed then
    raise exception using errcode = '22023',
      message = 'The upper load must be higher than the load it starts from.';
  end if;
  new.prescribed_load_max := null;
  return new;
end;
$$;
create trigger look_a_load_range before insert or update on public.workout_exercises
  for each row execute function public.look_a_load_range();
create trigger look_a_load_range before insert or update on public.workout_log_exercises
  for each row execute function public.look_a_load_range();

-- ---------- 1d. Start snapshot ----------
-- The log exercise copies per-side and the load range from the workout
-- exercise it was started from. The range applies only when the started load
-- really is the authored load: no active per-client override exists for this
-- assignment and exercise, and the load and unit equal the authored ones. An
-- override is a single number, so no range is invented for it, even when the
-- override happens to equal the authored lower load.
create function public.snapshot_look_a_prescription() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  v_src public.workout_exercises;
  v_log public.workout_logs;
  v_override boolean;
begin
  if new.source_workout_exercise_id is null then return new; end if;
  select * into v_src from public.workout_exercises where id = new.source_workout_exercise_id;
  if not found then return new; end if;
  new.per_side := new.per_side or v_src.per_side;
  if new.prescribed_load_max is not null or v_src.prescribed_load_max is null then return new; end if;
  select * into v_log from public.workout_logs where id = new.workout_log_id;
  if v_log.program_assignment_id is not null then
    select exists (select 1 from public.program_assignment_exercise_loads
      where program_assignment_id = v_log.program_assignment_id and program_day_id = v_log.program_day_id
        and workout_exercise_id = v_src.id and archived = false) into v_override;
  elsif v_log.workout_assignment_id is not null then
    select exists (select 1 from public.workout_assignment_exercise_loads
      where workout_assignment_id = v_log.workout_assignment_id and workout_exercise_id = v_src.id and archived = false) into v_override;
  else
    v_override := false;
  end if;
  if not v_override
     and new.prescribed_load_value = v_src.default_load_value
     and new.prescribed_load_unit is not distinct from v_src.default_load_unit then
    new.prescribed_load_max := v_src.prescribed_load_max;
  end if;
  return new;
end;
$$;
create trigger snapshot_look_a_prescription before insert on public.workout_log_exercises
for each row execute function public.snapshot_look_a_prescription();

-- ---------- 2. Authoring and copies carry the two prescription facts ----------
-- The existing functions keep their bytes; they are renamed and wrapped so every
-- existing caller (save_workout, history saves, templates, Quick saves) gets the
-- new fields through the same name and signature.
--
-- A payload that leaves out prescribed_load_max or per_side keeps the stored
-- value (callers that predate them never erase them); a payload that includes
-- the key sets it, and null or "" clears the upper load. An upper load equal to
-- the lower load is the single number and is stored as no range. Range
-- validity is enforced by look_a_load_range (section 1c), after the core's own
-- update of the lower load in the same statement sequence, so a valid shift
-- (100-110 to 120-130) or clear succeeds and an invalid range is refused with
-- nothing saved.
alter function public.sync_workout_exercises(uuid, jsonb) rename to sync_workout_exercises_core_20261016;
revoke execute on function public.sync_workout_exercises_core_20261016(uuid, jsonb) from public, anon, authenticated;

create function public.sync_workout_exercises(p_workout_id uuid, p_exercises jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_exercise jsonb;
  v_position integer := 0;
  v_row public.workout_exercises;
  v_max numeric;
  v_side boolean;
begin
  perform public.sync_workout_exercises_core_20261016(p_workout_id, p_exercises);
  -- Same row selection and position numbering as the core function.
  for v_exercise in select value from jsonb_array_elements(coalesce(p_exercises, '[]'::jsonb)) loop
    if nullif(v_exercise ->> 'exercise_library_id', '') is not null
       or btrim(coalesce(nullif(coalesce(v_exercise ->> 'custom_name', v_exercise ->> 'name'), ''), '')) <> '' then
      if v_exercise ? 'prescribed_load_max' or v_exercise ? 'per_side' then
        select * into v_row from public.workout_exercises
        where workout_id = p_workout_id and archived = false and position = v_position;
        if found then
          if v_exercise ? 'prescribed_load_max' then
            begin
              v_max := nullif(btrim(coalesce(v_exercise ->> 'prescribed_load_max', '')), '')::numeric;
            exception when invalid_text_representation then
              raise exception using errcode = '22023', message = 'Enter the upper load as a number.';
            end;
            if v_max is not null and v_row.default_load_value is not null and v_max = v_row.default_load_value then v_max := null; end if;
          else
            v_max := v_row.prescribed_load_max;
          end if;
          v_side := case when v_exercise ? 'per_side' then coalesce((v_exercise ->> 'per_side')::boolean, false) else v_row.per_side end;
          if v_max is distinct from v_row.prescribed_load_max or v_side is distinct from v_row.per_side then
            update public.workout_exercises set prescribed_load_max = v_max, per_side = v_side where id = v_row.id;
          end if;
        end if;
      end if;
      v_position := v_position + 1;
    end if;
  end loop;
end;
$$;
revoke execute on function public.sync_workout_exercises(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.sync_workout_exercises(uuid, jsonb) to service_role;

alter function public.clone_workout(uuid, uuid, uuid, boolean, uuid) rename to clone_workout_core_20261016;
revoke execute on function public.clone_workout_core_20261016(uuid, uuid, uuid, boolean, uuid) from public, anon, authenticated;

create function public.clone_workout(p_workout_id uuid, p_coach_id uuid, p_client_id uuid, p_as_template boolean, p_variation_of uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_result jsonb;
  v_strip boolean;
begin
  select p_as_template and not is_template into v_strip from public.workouts where id = p_workout_id;
  v_result := public.clone_workout_core_20261016(p_workout_id, p_coach_id, p_client_id, p_as_template, p_variation_of);
  -- Loads are stripped from a client copy saved as a template; its range goes with them.
  update public.workout_exercises n
  set per_side = s.per_side,
      prescribed_load_max = case when coalesce(v_strip, false) then null else s.prescribed_load_max end
  from jsonb_each_text(coalesce(v_result -> 'exercise_map', '{}'::jsonb)) m
  join public.workout_exercises s on s.id = m.key::uuid
  where n.id = m.value::uuid and (s.per_side or s.prescribed_load_max is not null);
  return v_result;
end;
$$;
revoke execute on function public.clone_workout(uuid, uuid, uuid, boolean, uuid) from public, anon, authenticated;
grant execute on function public.clone_workout(uuid, uuid, uuid, boolean, uuid) to service_role;

-- Program history shows a change to either fact. The keys are added only when
-- set, so every snapshot recorded before this migration still compares equal
-- to an unchanged program.
create or replace function public.program_history_snapshot(p_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',p.id,'name',p.name,'description',p.description,'frequency_days',p.frequency_days,'days',
 coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'day_number',d.day_number,'notes',d.notes,'workout',
 jsonb_build_object('id',w.id,'name',w.name,'description',w.description,'goal',w.goal,'exercises',
 coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'name',coalesce(nullif(e.custom_name,''),l.name,'Exercise'),'exercise_library_id',e.exercise_library_id,'sets',e.sets,'reps',e.reps,'rest',e.rest,'rest_seconds',e.rest_seconds,'tempo',e.tempo,'target_rpe',e.target_rpe,'tracking_type',e.tracking_type,'duration_value',e.duration_value,'duration_unit',e.duration_unit,'distance_value',e.distance_value,'distance_unit',e.distance_unit,'default_load_value',e.default_load_value,'default_load_unit',e.default_load_unit,'notes',e.notes,'client_notes',e.client_notes,'coach_notes',e.coach_notes,'video_url',e.video_url,'video_link_mode',e.video_link_mode,'superset_group',e.superset_group)
   || case when e.prescribed_load_max is not null then jsonb_build_object('prescribed_load_max',e.prescribed_load_max) else '{}'::jsonb end
   || case when e.per_side then jsonb_build_object('per_side',true) else '{}'::jsonb end
   order by e.position,e.id) from public.workout_exercises e
 left join public.exercise_library l on l.id=e.exercise_library_id where e.workout_id=w.id and not e.archived),'[]'::jsonb))) order by d.day_number,d.id)
 from public.program_days d join public.workouts w on w.id=d.workout_id where d.program_id=p.id and not d.archived),'[]'::jsonb))
 from public.programs p where p.id=p_id;
$$;

-- ---------- 3. Undo ledger ----------
create table public.workout_material_changes (
  id uuid primary key,
  seq bigint generated always as identity,
  workout_log_id uuid not null references public.workout_logs(id),
  client_id uuid not null references public.clients(id),
  actor_role text not null check (actor_role in ('client', 'coach')),
  actor_coach_id uuid references public.coaches(id),
  kind text not null check (kind in ('set', 'exercise_done', 'exercise_skip', 'finish', 'undo')),
  request jsonb not null default '{}'::jsonb,
  outcome text not null check (outcome in ('applied', 'refused')),
  reason text,
  result jsonb not null default '{}'::jsonb,
  inverse jsonb,
  fingerprint_after text,
  undoes uuid references public.workout_material_changes(id),
  undone_by uuid,
  notified boolean not null default false,
  created_at timestamptz not null default now(),
  constraint workout_material_changes_undo_shape check ((kind = 'undo') = (undoes is not null) or outcome = 'refused')
);
create unique index idx_workout_material_changes_one_undo
  on public.workout_material_changes(undoes) where outcome = 'applied' and undoes is not null;
create unique index idx_workout_material_changes_seq on public.workout_material_changes(seq);
create index idx_workout_material_changes_log on public.workout_material_changes(workout_log_id, seq);
alter table public.workout_material_changes enable row level security;
revoke all privileges on table public.workout_material_changes from public, anon, authenticated, service_role;
grant select, insert, update on table public.workout_material_changes to service_role;

-- The workout's material version: every row's id and material counter (log,
-- exercises, sets, substitutions). Rows added or removed change it; counters
-- only grow, so a version once left is never seen again.
create function public.workout_log_material_fingerprint(p_log_id uuid) returns text
language sql stable security invoker set search_path = '' as $$
  select md5(
    coalesce((select l.id::text || ':' || l.material_seq from public.workout_logs l where l.id = p_log_id), '')
    || '|' || coalesce((select string_agg(e.id::text || ':' || e.material_seq, ',' order by e.id)
         from public.workout_log_exercises e where e.workout_log_id = p_log_id), '')
    || '|' || coalesce((select string_agg(s.id::text || ':' || s.material_seq, ',' order by s.id)
         from public.workout_log_sets s join public.workout_log_exercises e on e.id = s.workout_log_exercise_id
         where e.workout_log_id = p_log_id), '')
    || '|' || coalesce((select string_agg(x.id::text || ':' || x.material_seq, ',' order by x.id)
         from public.workout_log_substitutions x where x.workout_log_id = p_log_id), ''));
$$;

-- The set fields an inverse restores, from a full row.
create function public.look_a_set_restore(s public.workout_log_sets) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('id', s.id, 'status', s.status, 'actual_reps', s.actual_reps, 'actual_load_value', s.actual_load_value,
    'actual_load_unit', s.actual_load_unit, 'actual_rpe', s.actual_rpe, 'actual_duration_value', s.actual_duration_value,
    'actual_duration_unit', s.actual_duration_unit, 'actual_distance_value', s.actual_distance_value,
    'actual_distance_unit', s.actual_distance_unit, 'completed_at', s.completed_at, 'completed_plan_revision', s.completed_plan_revision,
    'entered_by', s.entered_by, 'entered_by_coach_id', s.entered_by_coach_id, 'value_origin', s.value_origin,
    'prefill_load_value', s.prefill_load_value, 'prefill_load_unit', s.prefill_load_unit);
$$;

-- Locks the workout row (always first), returns it. Raises for an unknown log.
create function public.look_a_lock_log(p_log_id uuid) returns public.workout_logs
language plpgsql security invoker set search_path = '' as $$
declare v_log public.workout_logs;
begin
  select * into v_log from public.workout_logs where id = p_log_id and archived = false for no key update;
  if not found then raise exception 'Workout log not found'; end if;
  return v_log;
end;
$$;

-- Why a recorded change cannot be undone NOW, or null when it can. The one
-- rule both the Undo itself and every report of the current Undo use, so a
-- page is never offered an Undo the database would refuse: the change must be
-- applied, not undone, not an Undo, made by this actor, still the latest
-- applied change of its workout, the workout still at the exact version
-- recorded right after it, and, for a Finish, nothing that depends on the
-- finished workout yet (a coach response, a cue made or used from it, or
-- another workout in progress). Replays report this current answer, never the
-- answer that was true when the change was first applied.
create function public.look_a_undo_blocker(p_change public.workout_material_changes, p_actor_role text, p_actor_coach_id uuid)
returns text language plpgsql stable security invoker set search_path = '' as $$
begin
  if p_change.id is null or p_change.kind = 'undo' then return 'There is nothing to undo.'; end if;
  if p_change.actor_role <> p_actor_role or p_change.actor_coach_id is distinct from p_actor_coach_id then
    return 'Only the person who made this change can undo it.';
  end if;
  if p_change.outcome <> 'applied' or p_change.inverse is null then return 'That change was not saved, so there is nothing to undo.'; end if;
  if p_change.undone_by is not null then return 'That change was already undone.'; end if;
  if exists (select 1 from public.workout_material_changes c
      where c.workout_log_id = p_change.workout_log_id and c.outcome = 'applied' and c.seq > p_change.seq) then
    return 'A later change replaced this Undo.';
  end if;
  if public.workout_log_material_fingerprint(p_change.workout_log_id) is distinct from p_change.fingerprint_after then
    return 'This workout changed since (on another device, by your coach, or a later change), so it was not undone.';
  end if;
  if p_change.kind = 'finish' then
    if exists (select 1 from public.workout_coach_responses r where r.workout_log_id = p_change.workout_log_id and not r.archived) then
      return 'Your coach already responded to this workout, so it stays finished.';
    end if;
    if exists (select 1 from public.exercise_attempt_cues q
        where (q.source_log_id = p_change.workout_log_id or q.retry_log_id = p_change.workout_log_id)
          and greatest(q.created_at, q.updated_at, coalesce(q.rechecked_at, q.created_at), coalesce(q.linked_at, q.created_at)) >= p_change.created_at) then
      return 'Your coach already used this finished workout, so it stays finished.';
    end if;
    if exists (select 1 from public.workout_logs l
        where l.client_id = p_change.client_id and l.status = 'active' and not l.archived and l.id <> p_change.workout_log_id) then
      return 'Another workout is in progress, so this one cannot be reopened.';
    end if;
  end if;
  return null;
end;
$$;

create function public.look_a_change_undoable(p_change public.workout_material_changes) returns boolean
language sql stable security invoker set search_path = '' as $$
  select public.look_a_undo_blocker(p_change, p_change.actor_role, p_change.actor_coach_id) is null;
$$;

-- The one Undo a workout offers right now, for one actor, or null: the latest
-- applied change, only while it is still undoable and was made by that actor.
-- Lets a reloaded page or another device of the same person show the same
-- Undo, and never an older or someone else's.
create function public.workout_current_undo(p_log_id uuid, p_actor_role text, p_actor_coach_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select case when c.actor_role = p_actor_role and c.actor_coach_id is not distinct from p_actor_coach_id
                and public.look_a_change_undoable(c)
              then jsonb_build_object('change_id', c.id, 'kind', c.kind, 'result', c.result, 'created_at', c.created_at) end
  from public.workout_material_changes c
  where c.workout_log_id = p_log_id and c.outcome = 'applied'
  order by c.seq desc limit 1;
$$;

-- An event id seen before: the same change replays its recorded answer; a
-- different change (any recorded request field differs) with the same id is
-- refused.
create function public.look_a_replay(p_id uuid, p_log_id uuid, p_kind text, p_actor_role text, p_actor_coach_id uuid, p_request jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_row public.workout_material_changes;
begin
  select * into v_row from public.workout_material_changes where id = p_id;
  if not found then
    -- An id already used for a set event (which may have recorded nothing
    -- here) is refused too: one event id names one change.
    if exists (select 1 from public.workout_set_events where id = p_id) then raise exception 'event_id_reused'; end if;
    return null;
  end if;
  if v_row.workout_log_id <> p_log_id or v_row.kind <> p_kind or v_row.actor_role <> p_actor_role
     or v_row.actor_coach_id is distinct from p_actor_coach_id or v_row.request <> p_request then
    raise exception 'event_id_reused';
  end if;
  return v_row.result || jsonb_build_object('change_id', v_row.id, 'outcome', 'replayed', 'original_outcome', v_row.outcome,
    'reason', v_row.reason, 'undone', v_row.undone_by is not null, 'undoable', public.look_a_change_undoable(v_row));
end;
$$;

create function public.look_a_record(p_id uuid, p_log public.workout_logs, p_kind text, p_actor_role text, p_actor_coach_id uuid,
  p_request jsonb, p_outcome text, p_reason text, p_result jsonb, p_inverse jsonb, p_undoes uuid, p_notified boolean)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.workout_material_changes(id, workout_log_id, client_id, actor_role, actor_coach_id, kind, request, outcome, reason,
    result, inverse, fingerprint_after, undoes, notified)
  values (p_id, p_log.id, p_log.client_id, p_actor_role, p_actor_coach_id, p_kind, coalesce(p_request, '{}'::jsonb), p_outcome, p_reason,
    coalesce(p_result, '{}'::jsonb), p_inverse,
    case when p_outcome = 'applied' then public.workout_log_material_fingerprint(p_log.id) end, p_undoes, coalesce(p_notified, false));
  return coalesce(p_result, '{}'::jsonb) || jsonb_build_object('change_id', p_id, 'outcome', p_outcome, 'reason', p_reason,
    'undoable', p_outcome = 'applied' and p_inverse is not null);
end;
$$;

-- ---------- 4. Set events with an Undo record ----------
-- What a v3 set event asked for: the set, the actor, the revisions it was
-- based on, the values and the declared origin (not transport details such as
-- the offline flag or local sequence). A retry must ask for exactly this; the
-- same id with anything else is refused (event_id_reused). Events first
-- written by the older functions have no row here and keep their old replay.
create table public.workout_set_event_requests (
  event_id uuid primary key references public.workout_set_events(id),
  request text not null,
  created_at timestamptz not null default now()
);
alter table public.workout_set_event_requests enable row level security;
revoke all privileges on table public.workout_set_event_requests from public, anon, authenticated, service_role;
grant select, insert on table public.workout_set_event_requests to service_role;

-- Same parameters and outcomes as apply_workout_set_event_v2 (which it calls
-- unchanged), plus the workout lock first and, for an applied write that
-- changed the set's material content, the recorded inverse (the set's exact
-- restorable fields before the write). An applied write that changed nothing
-- material records nothing, so it neither offers nor takes away an Undo.
create function public.apply_workout_set_event_v3(
  p_set_id uuid, p_event_id uuid, p_actor_role text, p_actor_coach_id uuid,
  p_base_revision integer, p_local_seq integer, p_offline boolean, p_plan_revision_seen integer,
  p_payload jsonb, p_value_origin text
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_log_id uuid;
  v_log public.workout_logs;
  v_before public.workout_log_sets;
  v_after_seq bigint;
  v_result jsonb;
  v_change public.workout_material_changes;
  v_request text := md5(jsonb_build_object('set', p_set_id, 'actor', p_actor_role, 'coach', p_actor_coach_id,
    'base', p_base_revision, 'plan', p_plan_revision_seen, 'origin', p_value_origin,
    'payload', coalesce(p_payload, '{}'::jsonb) - 'completed_at' - 'updated_at')::text);
  v_bound text;
begin
  select e.workout_log_id into v_log_id from public.workout_log_sets s
    join public.workout_log_exercises e on e.id = s.workout_log_exercise_id where s.id = p_set_id;
  if v_log_id is null then raise exception 'Workout set not found'; end if;
  select * into v_log from public.workout_logs where id = v_log_id for no key update;
  select * into v_before from public.workout_log_sets where id = p_set_id for update;
  -- Before anything is written: an id used for another kind of change, or for
  -- a different set write, is refused.
  if exists (select 1 from public.workout_material_changes where id = p_event_id and kind <> 'set') then
    raise exception 'event_id_reused';
  end if;
  select request into v_bound from public.workout_set_event_requests where event_id = p_event_id;
  if found and v_bound <> v_request then raise exception 'event_id_reused'; end if;
  if not found and exists (select 1 from public.workout_set_events where id = p_event_id
      and (workout_log_set_id <> p_set_id or actor_role <> p_actor_role or actor_coach_id is distinct from p_actor_coach_id)) then
    raise exception 'event_id_reused';
  end if;
  v_result := public.apply_workout_set_event_v2(p_set_id, p_event_id, p_actor_role, p_actor_coach_id, p_base_revision,
    p_local_seq, p_offline, p_plan_revision_seen, p_payload, p_value_origin);
  if v_result ->> 'outcome' <> 'replayed' then
    insert into public.workout_set_event_requests(event_id, request) values (p_event_id, v_request);
  end if;
  if v_result ->> 'outcome' = 'applied' then
    select material_seq into v_after_seq from public.workout_log_sets where id = p_set_id;
    if v_after_seq is distinct from v_before.material_seq then
      perform public.look_a_record(p_event_id, v_log, 'set', p_actor_role, p_actor_coach_id,
        jsonb_build_object('set_id', p_set_id), 'applied', null, '{}'::jsonb,
        jsonb_build_object('sets', jsonb_build_array(public.look_a_set_restore(v_before))), null, false);
      return v_result || jsonb_build_object('change', jsonb_build_object('id', p_event_id, 'undoable', true));
    end if;
    return v_result || jsonb_build_object('change', null);
  end if;
  if v_result ->> 'outcome' = 'replayed' then
    -- The original applied write's own record decides Undo, never the current
    -- row, and only while it is still the current Undo (look_a_change_undoable).
    select * into v_change from public.workout_material_changes where id = p_event_id;
    return v_result || jsonb_build_object('change', case when found then jsonb_build_object('id', v_change.id,
      'undoable', public.look_a_change_undoable(v_change)) else null end);
  end if;
  return v_result;
end;
$$;

-- ---------- 5. Exercise done, not set-tracked ----------
create function public.mark_workout_exercise_not_set_tracked(
  p_log_id uuid, p_exercise_id uuid, p_event_id uuid, p_actor_role text, p_actor_coach_id uuid
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_request jsonb := jsonb_build_object('exercise_id', p_exercise_id);
  v_replay jsonb;
  v_log public.workout_logs;
  v_ex public.workout_log_exercises;
  v_reason text;
begin
  if p_actor_role not in ('client', 'coach') then raise exception 'invalid actor'; end if;
  v_log := public.look_a_lock_log(p_log_id);
  v_replay := public.look_a_replay(p_event_id, p_log_id, 'exercise_done', p_actor_role, p_actor_coach_id, v_request);
  if v_replay is not null then return v_replay; end if;
  -- A finished workout is refused before any exercise lock is taken.
  if v_log.status <> 'active' then
    return public.look_a_record(p_event_id, v_log, 'exercise_done', p_actor_role, p_actor_coach_id, v_request, 'refused',
      'This workout is already finished.', null, null, null, false);
  end if;
  select * into v_ex from public.workout_log_exercises where id = p_exercise_id and workout_log_id = p_log_id for no key update;
  if not found or v_ex.archived then raise exception 'Workout exercise not found'; end if;
  if v_ex.not_set_tracked then v_reason := 'This exercise is already done.';
  elsif exists (select 1 from public.workout_set_conflicts c join public.workout_log_sets s on s.id = c.workout_log_set_id
      where s.workout_log_exercise_id = v_ex.id and c.status = 'open') then
    v_reason := 'A set here has a disagreement waiting for your coach. Record sets one at a time.';
  elsif not exists (select 1 from public.workout_log_sets where workout_log_exercise_id = v_ex.id and not archived and status = 'pending') then
    v_reason := 'Every set of this exercise is already logged or skipped.';
  end if;
  if v_reason is not null then
    return public.look_a_record(p_event_id, v_log, 'exercise_done', p_actor_role, p_actor_coach_id, v_request, 'refused', v_reason, null, null, null, false);
  end if;
  -- Only the exercise row changes. No set is read for writing or written.
  update public.workout_log_exercises
  set not_set_tracked = true, not_set_tracked_at = now(), not_set_tracked_change_id = p_event_id, updated_at = now()
  where id = v_ex.id;
  return public.look_a_record(p_event_id, v_log, 'exercise_done', p_actor_role, p_actor_coach_id, v_request, 'applied', null,
    jsonb_build_object('exercise_id', v_ex.id, 'not_set_tracked', true),
    jsonb_build_object('exercise', jsonb_build_object('id', v_ex.id, 'not_set_tracked', v_ex.not_set_tracked,
      'not_set_tracked_at', v_ex.not_set_tracked_at, 'not_set_tracked_change_id', v_ex.not_set_tracked_change_id)),
    null, false);
end;
$$;

-- ---------- 6. Skip the rest of an exercise ----------
-- p_sets: [{ id, revision }] exactly the pending sets the person saw. Any
-- difference (a set added, logged or changed elsewhere) refuses the whole skip.
create function public.skip_workout_exercise_sets(
  p_log_id uuid, p_exercise_id uuid, p_event_id uuid, p_actor_role text, p_actor_coach_id uuid, p_sets jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_request jsonb := jsonb_build_object('exercise_id', p_exercise_id, 'sets', coalesce(p_sets, '[]'::jsonb));
  v_replay jsonb;
  v_log public.workout_logs;
  v_ex public.workout_log_exercises;
  v_expected jsonb;
  v_actual jsonb;
  v_before jsonb;
begin
  if p_actor_role not in ('client', 'coach') then raise exception 'invalid actor'; end if;
  v_log := public.look_a_lock_log(p_log_id);
  v_replay := public.look_a_replay(p_event_id, p_log_id, 'exercise_skip', p_actor_role, p_actor_coach_id, v_request);
  if v_replay is not null then return v_replay; end if;
  if v_log.status <> 'active' then
    return public.look_a_record(p_event_id, v_log, 'exercise_skip', p_actor_role, p_actor_coach_id, v_request, 'refused', 'This workout is already finished.', null, null, null, false);
  end if;
  select * into v_ex from public.workout_log_exercises where id = p_exercise_id and workout_log_id = p_log_id;
  if not found or v_ex.archived then raise exception 'Workout exercise not found'; end if;
  perform 1 from public.workout_log_sets where workout_log_exercise_id = v_ex.id and not archived
    order by id for no key update;
  select coalesce(jsonb_agg(jsonb_build_object('id', x ->> 'id', 'revision', (x ->> 'revision')::integer) order by x ->> 'id'), '[]'::jsonb)
    into v_expected from jsonb_array_elements(coalesce(p_sets, '[]'::jsonb)) x;
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id::text, 'revision', s.revision) order by s.id::text), '[]'::jsonb),
         coalesce(jsonb_agg(public.look_a_set_restore(s) order by s.id), '[]'::jsonb)
    into v_actual, v_before
  from public.workout_log_sets s where s.workout_log_exercise_id = v_ex.id and not s.archived and s.status = 'pending';
  if exists (select 1 from public.workout_set_conflicts c join public.workout_log_sets s on s.id = c.workout_log_set_id
      where s.workout_log_exercise_id = v_ex.id and c.status = 'open') then
    return public.look_a_record(p_event_id, v_log, 'exercise_skip', p_actor_role, p_actor_coach_id, v_request, 'refused',
      'A set here has a disagreement waiting for your coach. Record sets one at a time.', null, null, null, false);
  end if;
  if v_expected = '[]'::jsonb or v_expected <> v_actual then
    return public.look_a_record(p_event_id, v_log, 'exercise_skip', p_actor_role, p_actor_coach_id, v_request, 'refused',
      'These sets changed since you looked. Check them and try again.', jsonb_build_object('current', v_actual), null, null, false);
  end if;
  -- Status only; values and origin stay (the nonce keeps the origin as it is).
  update public.workout_log_sets s
  set status = 'skipped', completed_at = null, completed_plan_revision = null, revision = s.revision + 1,
      last_actor_role = p_actor_role, last_event_id = p_event_id, value_origin_nonce = p_event_id, updated_at = now()
  where s.workout_log_exercise_id = v_ex.id and not s.archived and s.status = 'pending';
  return public.look_a_record(p_event_id, v_log, 'exercise_skip', p_actor_role, p_actor_coach_id, v_request, 'applied', null,
    jsonb_build_object('exercise_id', v_ex.id, 'skipped', jsonb_array_length(v_before)), jsonb_build_object('sets', v_before), null, false);
end;
$$;

-- ---------- 7. Finish, and whole-workout done, not set-tracked ----------
-- p_mode 'finish': the existing normal Finish rule (at least one logged set;
-- every other pending set becomes skipped), except that sets of an exercise
-- marked done, not set-tracked, stay exactly as they are.
-- p_mode 'not_set_tracked': the whole workout is done, not set-tracked. It may
-- already have logged sets; no set is written at all, whatever its state.
-- quick_completed (the existing column) is also set when nothing was logged,
-- so existing readers keep their meaning.
-- p_mode 'home_quick': Home's one-tap Quick Complete. The same flag, no set
-- written, but only for an untouched workout: the original Home guard
-- (quick_complete_workout_log_v2) refuses any recorded data, including a
-- value typed into a still-pending set, and the workout stays active for the
-- person to resume. It is never a way to finish a workout someone is
-- recording. p_target (Home's assignment/day) is part of the event identity.
-- Both modes lock every exercise and then every set of the workout (after the
-- workout) before classifying, so an exercise or set write already in flight
-- lands first and is counted, and one that arrives later finds the workout
-- finished. Every request field that
-- changes the outcome (mode, notes, feedback, requested completion time) is
-- part of the event's identity. notified is true only when this call created
-- the coach's completion notification (a replay, an Undo and a later re-finish
-- never do).
create function public.finish_workout_log_v3(
  p_log_id uuid, p_client_id uuid, p_event_id uuid, p_actor_role text, p_actor_coach_id uuid,
  p_mode text, p_notes text, p_feedback text, p_completed_at timestamptz, p_target jsonb default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_request jsonb := jsonb_build_object('mode', p_mode, 'notes', coalesce(p_notes, ''), 'feedback', coalesce(p_feedback, ''),
    'completed_at', p_completed_at)
    || case when p_target is not null then jsonb_build_object('target', p_target) else '{}'::jsonb end;
  v_replay jsonb;
  v_log public.workout_logs;
  v_completed integer;
  v_flag boolean := p_mode in ('not_set_tracked', 'home_quick');
  v_before jsonb := '[]'::jsonb;
  v_at timestamptz;
  v_new integer := 0;
begin
  if p_actor_role not in ('client', 'coach') then raise exception 'invalid actor'; end if;
  if p_mode is null or p_mode not in ('finish', 'not_set_tracked', 'home_quick') then raise exception 'invalid finish mode'; end if;
  v_log := public.look_a_lock_log(p_log_id);
  if v_log.client_id <> p_client_id then raise exception 'Workout log not found'; end if;
  v_replay := public.look_a_replay(p_event_id, p_log_id, 'finish', p_actor_role, p_actor_coach_id, v_request);
  if v_replay is not null then return v_replay || jsonb_build_object('notified', false); end if;
  if v_log.status = 'completed' then
    return public.look_a_record(p_event_id, v_log, 'finish', p_actor_role, p_actor_coach_id, v_request, 'refused', 'already_completed', null, null, null, false);
  end if;
  if v_log.status <> 'active' then raise exception 'Workout log is not active'; end if;

  -- Fence: exercises, then sets (the order a plan edit uses: its exercise row,
  -- then that exercise's sets). An exercise note or plan edit already holding
  -- its row lands first; a later one waits and then finds the workout finished.
  -- Set writers hold only KEY SHARE on their exercise, which this does not block.
  perform 1 from public.workout_log_exercises e where e.workout_log_id = v_log.id order by e.id for no key update;
  perform 1 from public.workout_log_sets s join public.workout_log_exercises e on e.id = s.workout_log_exercise_id
    where e.workout_log_id = v_log.id and not s.archived order by s.id for no key update of s;
  select count(*) into v_completed from public.workout_log_sets s
    join public.workout_log_exercises e on e.id = s.workout_log_exercise_id
    where e.workout_log_id = v_log.id and not e.archived and not s.archived and s.status = 'completed';
  if p_mode = 'home_quick' and (coalesce(v_log.notes, '') <> '' or coalesce(v_log.feedback, '') <> '' or exists (
      select 1 from public.workout_log_exercises e
      left join public.workout_log_sets s on s.workout_log_exercise_id = e.id
      where e.workout_log_id = v_log.id and (
        e.archived or e.not_set_tracked or coalesce(e.client_notes, '') <> '' or e.updated_at <> e.created_at
        or s.archived or s.status <> 'pending' or s.set_origin <> 'prescribed' or s.updated_at <> s.created_at
        or s.actual_reps is not null or s.actual_rpe is not null
        or s.actual_duration_value is not null or s.actual_distance_value is not null
        or s.actual_load_value is distinct from e.prescribed_load_value
        or s.actual_load_unit is distinct from e.prescribed_load_unit))) then
    return public.look_a_record(p_event_id, v_log, 'finish', p_actor_role, p_actor_coach_id, v_request, 'refused',
      'logged_changes', null, null, null, false);
  end if;
  if not v_flag and v_completed = 0 then
    return public.look_a_record(p_event_id, v_log, 'finish', p_actor_role, p_actor_coach_id, v_request, 'refused',
      'complete_at_least_one_set', null, null, null, false);
  end if;

  v_at := case when p_completed_at is null or p_completed_at <= v_log.started_at or p_completed_at > now() then now() else p_completed_at end;
  if not v_flag then
    select coalesce(jsonb_agg(public.look_a_set_restore(s) order by s.id), '[]'::jsonb) into v_before
    from public.workout_log_sets s join public.workout_log_exercises e on e.id = s.workout_log_exercise_id
    where e.workout_log_id = v_log.id and not e.archived and not e.not_set_tracked and not s.archived and s.status = 'pending';
    update public.workout_log_sets s
    set status = 'skipped', completed_at = null, value_origin_nonce = p_event_id, updated_at = now()
    from public.workout_log_exercises e
    where s.workout_log_exercise_id = e.id and e.workout_log_id = v_log.id and not e.archived and not e.not_set_tracked
      and not s.archived and s.status = 'pending';
  end if;

  update public.workout_logs
  set status = 'completed',
      quick_completed = quick_completed or (v_flag and v_completed = 0),
      not_set_tracked = v_flag,
      not_set_tracked_at = case when v_flag then v_at end,
      not_set_tracked_change_id = case when v_flag then p_event_id end,
      notes = nullif(btrim(coalesce(p_notes, '')), ''), feedback = nullif(btrim(coalesce(p_feedback, '')), ''),
      completed_at = v_at, updated_at = now()
  where id = v_log.id;

  insert into public.notifications (recipient_coach_id, event_type, workout_log_id)
  select c.id, 'workout_completed', v_log.id from public.coaches c
  where c.archived = false and (c.id = v_log.coach_id or c.is_admin = true)
  on conflict (recipient_coach_id, event_type, workout_log_id) do nothing;
  get diagnostics v_new = row_count;

  return public.look_a_record(p_event_id, v_log, 'finish', p_actor_role, p_actor_coach_id, v_request, 'applied', null,
    jsonb_build_object('mode', p_mode, 'not_set_tracked', v_flag, 'quick_completed', v_flag and v_completed = 0,
      'skipped', jsonb_array_length(v_before), 'notified', v_new > 0),
    jsonb_build_object('log', jsonb_build_object('quick_completed', v_log.quick_completed, 'notes', v_log.notes, 'feedback', v_log.feedback,
      'not_set_tracked', v_log.not_set_tracked, 'not_set_tracked_at', v_log.not_set_tracked_at,
      'not_set_tracked_change_id', v_log.not_set_tracked_change_id),
      'sets', v_before),
    null, v_new > 0);
end;
$$;

-- ---------- 7b. Home Quick Complete, one transaction ----------
-- A retry with the same event id replays the first answer before any start
-- runs again; the id is bound to this client and this assignment/day, so it
-- can never finish a different workout. Concurrent duplicates serialize on
-- the event id. A start that resumed or found a finished workout returns that
-- outcome and records nothing.
create function public.quick_complete_workout_v3(
  p_client_id uuid, p_event_id uuid, p_program_assignment_id uuid, p_program_day_id uuid, p_workout_assignment_id uuid,
  p_auth_user_id uuid, p_session_id uuid
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_target jsonb := jsonb_build_object('program_assignment_id', p_program_assignment_id, 'program_day_id', p_program_day_id,
    'workout_assignment_id', p_workout_assignment_id);
  v_row public.workout_material_changes;
  v_start jsonb;
begin
  if p_event_id is null then raise exception 'event id required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('cvf:look-a-event:' || p_event_id::text, 0));
  select * into v_row from public.workout_material_changes where id = p_event_id;
  if found then
    if v_row.client_id <> p_client_id or v_row.kind <> 'finish' or v_row.actor_role <> 'client'
       or v_row.request ->> 'mode' is distinct from 'home_quick' or v_row.request -> 'target' is distinct from v_target then
      raise exception 'event_id_reused';
    end if;
    return v_row.result || jsonb_build_object('change_id', v_row.id, 'outcome', 'replayed', 'original_outcome', v_row.outcome,
      'reason', v_row.reason, 'undone', v_row.undone_by is not null, 'undoable', public.look_a_change_undoable(v_row),
      'notified', false, 'workout_log_id', v_row.workout_log_id);
  end if;
  if exists (select 1 from public.workout_set_events where id = p_event_id) then raise exception 'event_id_reused'; end if;
  v_start := public.start_workout_log_with_cues(p_client_id, p_program_assignment_id, p_program_day_id, p_workout_assignment_id,
    'client', null, p_session_id, p_auth_user_id);
  if v_start ->> 'outcome' is distinct from 'started' then
    return jsonb_build_object('outcome', 'not_started', 'start_outcome', v_start ->> 'outcome', 'workout_log_id', v_start ->> 'workout_log_id');
  end if;
  return public.finish_workout_log_v3((v_start ->> 'workout_log_id')::uuid, p_client_id, p_event_id, 'client', null,
      'home_quick', '', '', null, v_target)
    || jsonb_build_object('workout_log_id', v_start ->> 'workout_log_id', 'start_outcome', 'started');
end;
$$;

-- ---------- 8. The one Undo ----------
-- Completed workouts stay immutable except through this function (and the
-- existing conflict resolution): it sets a transaction-local flag naming the
-- one workout it reopens, and only after every check below passed.
create or replace function public.prevent_completed_workout_log_change()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.status = 'completed' then
    if tg_op = 'UPDATE' and new.status = 'active' and new.id = old.id
       and current_setting('cvf.workout_reopen', true) = old.id::text then
      return new;
    end if;
    raise exception 'Completed workout logs are immutable';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create function public.undo_workout_material_change(
  p_log_id uuid, p_target_id uuid, p_event_id uuid, p_actor_role text, p_actor_coach_id uuid
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_request jsonb := jsonb_build_object('target', p_target_id);
  v_replay jsonb;
  v_log public.workout_logs;
  v_target public.workout_material_changes;
  v_reason text;
  v_item jsonb;
  v_found boolean;
  v_busy boolean := false;
begin
  if p_actor_role not in ('client', 'coach') then raise exception 'invalid actor'; end if;
  v_log := public.look_a_lock_log(p_log_id);
  v_replay := public.look_a_replay(p_event_id, p_log_id, 'undo', p_actor_role, p_actor_coach_id, v_request);
  if v_replay is not null then return v_replay; end if;
  select * into v_target from public.workout_material_changes where id = p_target_id for update;
  v_found := found;
  if v_found and v_target.workout_log_id = p_log_id then
    -- Reopening a finished workout takes the workout FOR UPDATE: new rows that
    -- reference it wait, and coach responses and cue writes re-read its status
    -- after this transaction (section 8b).
    if v_target.kind = 'finish' then perform 1 from public.workout_logs where id = p_log_id for update; end if;
    -- A writer that already holds one of these rows (a legacy PATCH, a conflict
    -- resolution, a cue write) may be waiting for this workout; never wait on
    -- it: refuse and let the person try again.
    begin
      perform 1 from public.workout_log_sets where id in (select (x ->> 'id')::uuid
        from jsonb_array_elements(coalesce(v_target.inverse -> 'sets', '[]'::jsonb)) x) order by id for no key update nowait;
      perform 1 from public.workout_log_exercises where id = (v_target.inverse -> 'exercise' ->> 'id')::uuid
        and workout_log_id = p_log_id for no key update nowait;
    exception when lock_not_available then v_busy := true;
    end;
  end if;
  if not v_found or v_target.workout_log_id <> p_log_id then
    v_reason := 'There is nothing to undo.';
  else
    v_reason := public.look_a_undo_blocker(v_target, p_actor_role, p_actor_coach_id);
    if v_reason is null and v_busy then v_reason := 'This workout is saving another change. Try Undo again.'; end if;
  end if;
  if v_reason is not null then
    return public.look_a_record(p_event_id, v_log, 'undo', p_actor_role, p_actor_coach_id, v_request, 'refused', v_reason,
      jsonb_build_object('target', p_target_id), null, null, false);
  end if;

  if v_target.kind = 'finish' then
    v_item := v_target.inverse -> 'log';
    perform set_config('cvf.workout_reopen', v_log.id::text, true);
    update public.workout_logs
    set status = 'active', completed_at = null,
        quick_completed = (v_item ->> 'quick_completed')::boolean,
        not_set_tracked = coalesce((v_item ->> 'not_set_tracked')::boolean, false),
        not_set_tracked_at = (v_item ->> 'not_set_tracked_at')::timestamptz,
        not_set_tracked_change_id = (v_item ->> 'not_set_tracked_change_id')::uuid,
        notes = v_item ->> 'notes', feedback = v_item ->> 'feedback', updated_at = now()
    where id = v_log.id;
    perform set_config('cvf.workout_reopen', '', true);
  end if;

  if v_target.inverse ? 'exercise' then
    v_item := v_target.inverse -> 'exercise';
    update public.workout_log_exercises
    set not_set_tracked = (v_item ->> 'not_set_tracked')::boolean, not_set_tracked_at = (v_item ->> 'not_set_tracked_at')::timestamptz,
        not_set_tracked_change_id = (v_item ->> 'not_set_tracked_change_id')::uuid, updated_at = now()
    where id = (v_item ->> 'id')::uuid and workout_log_id = v_log.id;
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(v_target.inverse -> 'sets', '[]'::jsonb)) loop
    update public.workout_log_sets s set
      status = v_item ->> 'status',
      actual_reps = (v_item ->> 'actual_reps')::integer,
      actual_load_value = (v_item ->> 'actual_load_value')::numeric,
      actual_load_unit = v_item ->> 'actual_load_unit',
      actual_rpe = (v_item ->> 'actual_rpe')::numeric,
      actual_duration_value = (v_item ->> 'actual_duration_value')::numeric,
      actual_duration_unit = v_item ->> 'actual_duration_unit',
      actual_distance_value = (v_item ->> 'actual_distance_value')::numeric,
      actual_distance_unit = v_item ->> 'actual_distance_unit',
      completed_at = (v_item ->> 'completed_at')::timestamptz,
      completed_plan_revision = (v_item ->> 'completed_plan_revision')::integer,
      entered_by = v_item ->> 'entered_by',
      entered_by_coach_id = (v_item ->> 'entered_by_coach_id')::uuid,
      value_origin = v_item ->> 'value_origin',
      prefill_load_value = (v_item ->> 'prefill_load_value')::numeric,
      prefill_load_unit = v_item ->> 'prefill_load_unit',
      value_origin_nonce = p_event_id,
      revision = s.revision + 1, last_actor_role = p_actor_role, last_event_id = p_event_id, updated_at = now()
    where s.id = (v_item ->> 'id')::uuid;
  end loop;

  update public.workout_material_changes set undone_by = p_event_id where id = v_target.id;
  return public.look_a_record(p_event_id, v_log, 'undo', p_actor_role, p_actor_coach_id, v_request, 'applied', null,
    jsonb_build_object('target', p_target_id, 'kind', v_target.kind, 'reopened', v_target.kind = 'finish'), null, p_target_id, false);
end;
$$;

-- ---------- 8b. Writers that depend on a finished workout ----------
-- A coach response, and a cue's text or recheck, belong to a finished
-- workout. Their existing functions check the status without a lock, so a
-- writer that read "completed" could otherwise land after an Undo reopened the
-- workout. These triggers re-read the workout under FOR SHARE (which waits for
-- a reopening Undo's FOR UPDATE) and refuse unless it is still completed. A
-- workout that is not completed is refused without taking any lock, so no
-- finished-workout writer waits on an active workout's writers.
-- A cue write already holds its exercise row (FOR SHARE) when this runs. A
-- Finish of a reopened workout holds the workout and then waits for that
-- exercise row, so a cue waiting here for the workout could deadlock with it.
-- Cue writes therefore never wait (p_nowait): a busy workout refuses them
-- with a retryable message. Coach responses hold no exercise row and wait.
create function public.look_a_require_completed_log(p_log_id uuid, p_message text, p_nowait boolean default false) returns void
language plpgsql security invoker set search_path = '' as $$
declare v_status text;
begin
  select status into v_status from public.workout_logs where id = p_log_id;
  if v_status is distinct from 'completed' then raise exception '%', p_message; end if;
  if p_nowait then
    begin
      select status into v_status from public.workout_logs where id = p_log_id for share nowait;
    exception when lock_not_available then
      raise exception using errcode = 'P0409', message = 'This workout is changing right now. Try again.';
    end;
  else
    select status into v_status from public.workout_logs where id = p_log_id for share;
  end if;
  if v_status is distinct from 'completed' then raise exception '%', p_message; end if;
end;
$$;

create function public.look_a_coach_response_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if not new.archived then
    perform public.look_a_require_completed_log(new.workout_log_id, 'Only completed workouts accept coach responses');
  end if;
  return new;
end;
$$;
create trigger look_a_completed_log_guard before insert or update on public.workout_coach_responses
  for each row execute function public.look_a_coach_response_guard();

create function public.look_a_cue_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.text is distinct from old.text or new.source_version is distinct from old.source_version then
    perform public.look_a_require_completed_log(new.source_log_id, 'Choose a completed performed attempt', true);
  end if;
  if tg_op = 'UPDATE' and (new.verdict is distinct from old.verdict or new.rechecked_at is distinct from old.rechecked_at) then
    perform public.look_a_require_completed_log(new.retry_log_id, 'Complete a performed retry before recording a verdict', true);
  end if;
  return new;
end;
$$;
create trigger look_a_completed_log_guard before insert or update on public.exercise_attempt_cues
  for each row execute function public.look_a_cue_guard();

-- ---------- 9. Grants ----------
do $$
declare f text;
begin
  foreach f in array array[
    'look_a_bump_material_seq()',
    'look_a_load_range()',
    'snapshot_look_a_prescription()',
    'workout_log_material_fingerprint(uuid)',
    'look_a_set_restore(public.workout_log_sets)',
    'look_a_lock_log(uuid)',
    'look_a_change_undoable(public.workout_material_changes)',
    'look_a_replay(uuid, uuid, text, text, uuid, jsonb)',
    'workout_current_undo(uuid, text, uuid)',
    'look_a_record(uuid, public.workout_logs, text, text, uuid, jsonb, text, text, jsonb, jsonb, uuid, boolean)',
    'apply_workout_set_event_v3(uuid, uuid, text, uuid, integer, integer, boolean, integer, jsonb, text)',
    'mark_workout_exercise_not_set_tracked(uuid, uuid, uuid, text, uuid)',
    'skip_workout_exercise_sets(uuid, uuid, uuid, text, uuid, jsonb)',
    'finish_workout_log_v3(uuid, uuid, uuid, text, uuid, text, text, text, timestamptz, jsonb)',
    'quick_complete_workout_v3(uuid, uuid, uuid, uuid, uuid, uuid, uuid)',
    'look_a_undo_blocker(public.workout_material_changes, text, uuid)',
    'undo_workout_material_change(uuid, uuid, uuid, text, uuid)',
    'look_a_require_completed_log(uuid, text, boolean)',
    'look_a_coach_response_guard()',
    'look_a_cue_guard()'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
