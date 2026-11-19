-- Look A shared event lock (local, 2026-11-14; integration review 2).
-- Forward-only; 20261114120000 and 20261114130000 are unchanged.
--
-- One new event id sent at once to two different workouts used to race the
-- ledger / set-event primary keys: the second caller's checks ran before the
-- first committed, and its insert then failed with a duplicate key (a 500).
-- Every Look A writer now takes the same transaction-scoped event lock that
-- Home Quick Complete already takes (quick_complete_workout_v3), as its first
-- statement, before any workout lock. The second caller waits, then its
-- existing checks see the first change and refuse with event_id_reused (409).
-- Lock order is always event, then workout, so no new deadlock is possible
-- between these writers. The bodies are otherwise exactly the current ones.

create or replace function public.apply_workout_set_event_v3(
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
  -- Shared event lock first (20261114140000).
  perform pg_advisory_xact_lock(hashtextextended('cvf:look-a-event:' || p_event_id::text, 0));
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

create or replace function public.mark_workout_exercise_not_set_tracked(
  p_log_id uuid, p_exercise_id uuid, p_event_id uuid, p_actor_role text, p_actor_coach_id uuid
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_request jsonb := jsonb_build_object('exercise_id', p_exercise_id);
  v_replay jsonb;
  v_log public.workout_logs;
  v_ex public.workout_log_exercises;
  v_reason text;
begin
  -- Shared event lock first (20261114140000).
  perform pg_advisory_xact_lock(hashtextextended('cvf:look-a-event:' || p_event_id::text, 0));
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

create or replace function public.skip_workout_exercise_sets(
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
  -- Shared event lock first (20261114140000).
  perform pg_advisory_xact_lock(hashtextextended('cvf:look-a-event:' || p_event_id::text, 0));
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

create or replace function public.finish_workout_log_v3(
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
  -- Shared event lock first (20261114140000).
  perform pg_advisory_xact_lock(hashtextextended('cvf:look-a-event:' || p_event_id::text, 0));
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
  -- Shared event lock first (20261114140000).
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
