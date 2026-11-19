-- Look A swap: fixed backup set count and one-step swap Undo (local,
-- 2026-11-14; LOOK-A-HANDOFF-REVIEW.md items 1-3, owner decisions 2026-11-14).
-- Forward-only; every earlier migration is unchanged.
--
-- create_workout_substitution_v3 is the Look A swap. It is one material
-- change of the ledger (kind 'swap') with one revision-checked inverse, so
-- the latest swap is the workout's one Undo, exactly like a set or Done.
--
-- Coach backup set count, decided in the swap's own transaction:
--   greatest(1, the backup's own target_sets - the completed or skipped,
--   non-archived set rows of the exercise being replaced).
-- Pending sets and the not-set-tracked flag do not count. A backup without
-- its own set count is refused ('missing_prescription'); no count is taken
-- from the replaced exercise or from anything typed. The page sends the
-- count it showed (p_expected_sets); if the workout changed so the count is
-- different, the swap is refused ('count_changed', with the new count) and
-- nothing is written. A refusal is recorded, so the same swap id always gets
-- the same answer; an applied swap replays its recorded answer and never
-- subtracts again.
--
-- The replacement's sets are created in the same transaction with the page's
-- own ids (p_set_ids, one per set), so no later 'add' writes follow a swap.
-- The replaced exercise and its set rows are only read.
--
-- Undo of a swap marks it 'undone' (a new status: no longer open, so the
-- exercise can be swapped again) and archives the replacement rows. It is
-- refused by the shared rule whenever anything changed since (a set on the
-- replacement, a coach decision, another device).
--
-- create_workout_substitution (older queued payloads, coach flows) keeps its
-- behaviour and records no Undo; it now takes the shared event lock first.
--
-- Lock order: event lock, client (key share), workout (look_a_lock_log),
-- then the replaced exercise's set rows (share, never waited on).
--
-- A set added under an archived exercise is refused (P0410) by a trigger
-- that re-reads the exercise under a row lock, so an Add Set that passed its
-- check before a swap Undo cannot land under the archived replacement.

alter table public.workout_material_changes drop constraint workout_material_changes_kind_check;
alter table public.workout_material_changes add constraint workout_material_changes_kind_check
  check (kind in ('set', 'exercise_done', 'exercise_skip', 'finish', 'undo', 'swap'));
alter table public.workout_log_substitutions drop constraint workout_log_substitutions_status_check;
alter table public.workout_log_substitutions add constraint workout_log_substitutions_status_check
  check (status in ('pending_confirmation', 'active', 'declined', 'undone'));

-- The older create, unchanged except that it takes the shared event lock
-- first (LOOK-A-SWAP-LEGACY-COLLISION.md). Without it an older create for
-- another workout could save the same id between a Look A swap's check and
-- its insert. The Look A swap also checks the helper's actual result, so it
-- never builds on a row it did not create.
create or replace function public.create_workout_substitution(p_row jsonb, p_activate boolean)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_existing public.workout_log_substitutions;
  v_sub public.workout_log_substitutions;
  v_status text;
begin
  -- Shared event lock (20261114170000): an older create and a Look A swap
  -- with the same id never interleave; the second sees the first's row.
  perform pg_advisory_xact_lock(hashtextextended('cvf:look-a-event:' || (p_row ->> 'id'), 0));
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

create function public.create_workout_substitution_v3(
  p_row jsonb, p_activate boolean, p_expected_sets integer, p_set_ids uuid[]
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid := (p_row ->> 'id')::uuid;
  v_log_id uuid := (p_row ->> 'workout_log_id')::uuid;
  v_actor text := p_row ->> 'actor_role';
  v_coach uuid := nullif(p_row ->> 'actor_coach_id', '')::uuid;
  -- What this swap asked for: the person's own choice, not names or targets
  -- the server derived from the catalog or the backup (which may change
  -- later) and not transport details (when, whether offline). A retry must
  -- ask for exactly this; the same id with anything else is refused.
  v_request jsonb := jsonb_build_object('log', p_row ->> 'workout_log_id', 'original', p_row ->> 'original_log_exercise_id',
    'replacement', p_row ->> 'replacement_log_exercise_id', 'library', p_row ->> 'replacement_exercise_library_id',
    'source', p_row ->> 'source', 'backup', nullif(p_row ->> 'backup_id', ''), 'trigger', p_row ->> 'trigger',
    'reason', nullif(p_row ->> 'reason', ''), 'targets', coalesce(p_row -> 'client_targets', p_row -> 'targets', '{}'::jsonb),
    'actor', p_row ->> 'actor_role', 'coach', nullif(p_row ->> 'actor_coach_id', ''),
    'activate', p_activate, 'expected_sets', p_expected_sets, 'set_ids', to_jsonb(p_set_ids));
  v_log public.workout_logs;
  v_replay jsonb;
  v_existing public.workout_log_substitutions;
  v_original public.workout_log_exercises;
  v_backup public.workout_exercise_backups;
  v_targets jsonb := coalesce(p_row -> 'targets', '{}'::jsonb);
  v_count integer;
  v_touched integer;
  v_created jsonb;
  v_sub public.workout_log_substitutions;
  v_load numeric;
  v_unit text;
  i integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('cvf:look-a-event:' || v_id::text, 0));
  if v_actor is null or v_actor not in ('client', 'coach') then raise exception 'invalid actor'; end if;
  if jsonb_typeof(v_targets) <> 'object' then raise exception 'targets must be an object'; end if;
  v_log := public.look_a_lock_log(v_log_id);
  v_replay := public.look_a_replay(v_id, v_log_id, 'swap', v_actor, v_coach, v_request);
  if v_replay is not null then
    select * into v_existing from public.workout_log_substitutions where id = v_id;
    return v_replay || case when found then jsonb_build_object('substitution', to_jsonb(v_existing)) else '{}'::jsonb end;
  end if;
  -- A swap first saved by the older function keeps its old replay, only for
  -- the same workout, exercise and replacement; never another workout's row.
  select * into v_existing from public.workout_log_substitutions where id = v_id;
  if found then
    if v_existing.workout_log_id <> v_log_id
       or v_existing.original_log_exercise_id::text <> p_row ->> 'original_log_exercise_id'
       or v_existing.replacement_log_exercise_id::text <> p_row ->> 'replacement_log_exercise_id'
       or v_existing.actor_role <> v_actor then
      raise exception 'event_id_reused';
    end if;
    return jsonb_build_object('outcome', 'replayed', 'substitution', to_jsonb(v_existing));
  end if;
  if v_log.status <> 'active' then raise exception 'Completed workouts cannot be changed'; end if;
  if v_log.client_id is distinct from (p_row ->> 'client_id')::uuid then raise exception 'Workout log not found'; end if;

  select * into v_original from public.workout_log_exercises
  where id = (p_row ->> 'original_log_exercise_id')::uuid and workout_log_id = v_log.id and not archived;
  if not found then raise exception 'Exercise not found'; end if;
  -- The replaced exercise's sets are read, never changed; a writer holding
  -- one is never waited on (retry with the same id).
  begin
    perform 1 from public.workout_log_sets where workout_log_exercise_id = v_original.id order by id for share nowait;
  exception when lock_not_available then
    raise exception using errcode = 'P0409', message = 'This workout is changing right now. Try again.';
  end;

  if p_row ->> 'source' = 'coach_backup' then
    select * into v_backup from public.workout_exercise_backups
    where id = nullif(p_row ->> 'backup_id', '')::uuid and not archived
      and workout_exercise_id is not distinct from v_original.source_workout_exercise_id;
    if not found or v_original.source_workout_exercise_id is null then
      return public.look_a_record(v_id, v_log, 'swap', v_actor, v_coach, v_request, 'refused', 'backup_unavailable',
        jsonb_build_object('message', 'That backup is no longer available. Pick another option.'), null, null, false);
    end if;
    if v_backup.target_sets is null or v_backup.target_sets < 1 then
      return public.look_a_record(v_id, v_log, 'swap', v_actor, v_coach, v_request, 'refused', 'missing_prescription',
        jsonb_build_object('message', 'Your coach has not set how many sets this backup has, so it was not swapped in. Ask your coach, or pick another option.'),
        null, null, false);
    end if;
    select count(*) into v_touched from public.workout_log_sets
    where workout_log_exercise_id = v_original.id and not archived and status in ('completed', 'skipped');
    v_count := greatest(1, v_backup.target_sets - v_touched);
    if p_expected_sets is distinct from v_count then
      return public.look_a_record(v_id, v_log, 'swap', v_actor, v_coach, v_request, 'refused', 'count_changed',
        jsonb_build_object('sets', v_count, 'message', format('This workout changed, so the backup now has %s %s. Check and swap again.',
          v_count, case when v_count = 1 then 'set' else 'sets' end)), null, null, false);
    end if;
  else
    v_count := nullif(v_targets ->> 'sets', '')::integer;
    if p_expected_sets is distinct from v_count then raise exception 'expected sets must match the requested sets'; end if;
  end if;
  if p_activate then
    if v_count is null or v_count < 1 or v_count > 10 or coalesce(cardinality(p_set_ids), 0) <> v_count
       or (select count(distinct x) from unnest(p_set_ids) x) <> v_count then
      raise exception 'set ids must match the set count';
    end if;
  elsif p_set_ids is not null then
    raise exception 'set ids are only for a swap made now';
  end if;

  v_targets := v_targets || case when v_count is null then '{}'::jsonb else jsonb_build_object('sets', v_count) end;
  v_created := public.create_workout_substitution(jsonb_set(p_row - 'client_targets', '{targets}', v_targets) || '{"create_target_sets": false}'::jsonb, p_activate);
  select * into v_sub from public.workout_log_substitutions where id = v_id;
  -- Only a row this call created is built on. If another writer saved this id
  -- first (the helper answered with its replay), nothing is added or recorded:
  -- a matching same-workout swap replays; anything else is refused.
  if v_created ->> 'outcome' is distinct from 'created' or v_sub.id is null
     or v_sub.workout_log_id <> v_log.id or v_sub.client_id <> v_log.client_id
     or v_sub.original_log_exercise_id <> v_original.id
     or v_sub.replacement_log_exercise_id::text <> p_row ->> 'replacement_log_exercise_id'
     or v_sub.actor_role <> v_actor or v_sub.actor_coach_id is distinct from v_coach then
    if v_sub.id is not null and v_sub.workout_log_id = v_log.id and v_sub.original_log_exercise_id = v_original.id
       and v_sub.replacement_log_exercise_id::text = p_row ->> 'replacement_log_exercise_id' and v_sub.actor_role = v_actor then
      return jsonb_build_object('outcome', 'replayed', 'substitution', to_jsonb(v_sub));
    end if;
    raise exception 'event_id_reused';
  end if;
  if p_activate and not exists (select 1 from public.workout_log_exercises
      where id = v_sub.replacement_log_exercise_id and workout_log_id = v_log.id and substitution_id = v_sub.id and not archived) then
    raise exception 'event_id_reused';
  end if;
  if p_activate then
    v_load := nullif(v_targets ->> 'load_value', '')::numeric;
    v_unit := case when v_load is null then null else coalesce(nullif(v_targets ->> 'load_unit', ''), 'lb') end;
    for i in 1..v_count loop
      insert into public.workout_log_sets (id, workout_log_exercise_id, set_number, set_origin, status, actual_load_value, actual_load_unit)
      values (p_set_ids[i], v_sub.replacement_log_exercise_id, i, 'prescribed', 'pending', v_load, v_unit);
    end loop;
  end if;
  return public.look_a_record(v_id, v_log, 'swap', v_actor, v_coach, v_request, 'applied', null,
    jsonb_build_object('outcome_kind', v_created ->> 'outcome', 'sets', v_count, 'set_ids', to_jsonb(p_set_ids),
      'replacement_log_exercise_id', v_sub.replacement_log_exercise_id, 'original_log_exercise_id', v_sub.original_log_exercise_id),
    jsonb_build_object('swap', jsonb_build_object('substitution_id', v_sub.id, 'replacement_log_exercise_id', v_sub.replacement_log_exercise_id)),
    null, false)
    || jsonb_build_object('outcome', 'created', 'substitution', to_jsonb(v_sub));
end;
$$;
revoke execute on function public.create_workout_substitution_v3(jsonb, boolean, integer, uuid[]) from public, anon, authenticated;
grant execute on function public.create_workout_substitution_v3(jsonb, boolean, integer, uuid[]) to service_role;

-- A set is only added (or brought back) under an exercise that is still in
-- the workout. Add Set checks the exercise and then inserts in another
-- statement; a swap Undo in between archives the replacement. The row lock
-- here waits for that Undo to commit and re-reads the exercise, so the late
-- insert is refused instead of landing under an archived exercise. Archiving
-- and every other set update are unchanged.
create function public.look_a_require_live_exercise() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare v_archived boolean;
begin
  if new.archived then return new; end if;
  if tg_op = 'UPDATE' and not old.archived and new.workout_log_exercise_id = old.workout_log_exercise_id then return new; end if;
  select archived into v_archived from public.workout_log_exercises where id = new.workout_log_exercise_id for share;
  if v_archived then
    raise exception using errcode = 'P0410', message = 'This exercise is no longer in the workout.';
  end if;
  return new;
end;
$$;
revoke execute on function public.look_a_require_live_exercise() from public, anon, authenticated;
create trigger look_a_require_live_exercise before insert or update of archived, workout_log_exercise_id on public.workout_log_sets
  for each row execute function public.look_a_require_live_exercise();

create or replace function public.undo_workout_material_change(
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
  -- Shared event lock first (20261114140000); client gate in look_a_lock_log (20261114150000).
  perform pg_advisory_xact_lock(hashtextextended('cvf:look-a-event:' || p_event_id::text, 0));
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
      -- A swap's Undo touches only the swap row and its replacement (20261114170000).
      if v_target.kind = 'swap' then
        perform 1 from public.workout_log_substitutions where id = (v_target.inverse -> 'swap' ->> 'substitution_id')::uuid
          and workout_log_id = p_log_id for no key update nowait;
        perform 1 from public.workout_log_exercises where id = (v_target.inverse -> 'swap' ->> 'replacement_log_exercise_id')::uuid
          and workout_log_id = p_log_id for no key update nowait;
        perform 1 from public.workout_log_sets where workout_log_exercise_id in (select e.id from public.workout_log_exercises e
            join public.workout_log_substitutions x on x.id = e.substitution_id
            where e.id = (v_target.inverse -> 'swap' ->> 'replacement_log_exercise_id')::uuid and e.workout_log_id = p_log_id
              and x.id = (v_target.inverse -> 'swap' ->> 'substitution_id')::uuid and x.workout_log_id = p_log_id)
          order by id for no key update nowait;
      end if;
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

  -- Undo a swap: the swap is withdrawn ('undone') and its replacement rows
  -- are archived (soft state). The replaced exercise and its sets are never
  -- touched, so they read exactly as before the swap.
  if v_target.kind = 'swap' then
    v_item := v_target.inverse -> 'swap';
    update public.workout_log_substitutions set status = 'undone'
    where id = (v_item ->> 'substitution_id')::uuid and workout_log_id = v_log.id and status in ('pending_confirmation', 'active');
    -- Only through a replacement verified to be this swap's, in this workout.
    update public.workout_log_sets set archived = true, updated_at = now()
    where not archived and workout_log_exercise_id in (select e.id from public.workout_log_exercises e
      join public.workout_log_substitutions x on x.id = e.substitution_id
      where e.id = (v_item ->> 'replacement_log_exercise_id')::uuid and e.workout_log_id = v_log.id
        and x.id = (v_item ->> 'substitution_id')::uuid and x.workout_log_id = v_log.id);
    update public.workout_log_exercises set archived = true, updated_at = now()
    where id = (v_item ->> 'replacement_log_exercise_id')::uuid and workout_log_id = v_log.id
      and substitution_id = (v_item ->> 'substitution_id')::uuid and not archived;
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
