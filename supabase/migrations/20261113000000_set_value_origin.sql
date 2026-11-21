-- Set value origin (local only; cross-device Undo, 2026-11-12).
--
-- Undo of an exercise quick completion returns sets to their untouched
-- prescribed prefill. The revision rule alone cannot tell, on another device
-- or after a reload, whether a pending set's load is that untouched
-- prescription or something a person entered, so a later quick completion
-- could record the prescription as performed (or strip an explicit value).
-- This migration stores what the values mean:
--   legacy   rows written before this migration, or never written since start;
--   prefill  the untouched prescription (plan propagation, or a validated
--            Undo restore);
--   entered  a value a person declared as entered;
--   unknown  written by a writer that did not declare (old RPC callers, the
--            legacy PATCH, finish/complete-all, conflict resolution, old plan
--            propagation). Clients must not treat unknown load-only sets as
--            either untouched or entered.
-- Only writers that change value_origin_nonce in the same UPDATE may set an
-- origin; the guard trigger makes every other value write unknown. Existing
-- authorization, completed-log immutability, metrics checks, FIFO/replay and
-- conflict outcomes are unchanged. Historical intent is not inferred.
-- Forward-only, backward-compatible: apply_workout_set_event keeps its exact
-- signature and grants and becomes a wrapper for v2 with no declaration.

alter table public.workout_log_sets
  add column value_origin text not null default 'legacy'
    constraint workout_log_sets_value_origin_check check (value_origin in ('legacy', 'unknown', 'prefill', 'entered')),
  add column value_origin_nonce uuid,
  add column prefill_load_value numeric
    constraint workout_log_sets_prefill_load_value_check check (prefill_load_value is null or prefill_load_value >= 0),
  add column prefill_load_unit text
    constraint workout_log_sets_prefill_load_unit_check check (prefill_load_unit is null or prefill_load_unit in ('lb', 'kg'));

alter table public.workout_set_events
  add column declared_origin text
    constraint workout_set_events_declared_origin_check check (declared_origin is null or declared_origin in ('prefill', 'entered'));

-- ---------- Guard: undeclared writers cannot keep or claim an origin ----------
-- Named to sort after check_workout_set_metrics and
-- prevent_completed_workout_set_change (BEFORE triggers fire in name order),
-- so it never hides their refusals.
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
  return new;
end;
$$;
create trigger set_value_origin_guard before update on public.workout_log_sets
  for each row execute function public.set_value_origin_guard();

-- ---------- Set write with a declared origin ----------
create or replace function public.apply_workout_set_event_v2(
  p_set_id uuid, p_event_id uuid, p_actor_role text, p_actor_coach_id uuid,
  p_base_revision integer, p_local_seq integer, p_offline boolean, p_plan_revision_seen integer,
  p_payload jsonb, p_value_origin text
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
  -- Value origin (20261113000000): what the stored values mean, so Undo can
  -- restore an untouched prescription on any device without inventing one.
  v_untouched boolean;
  v_origin text;
  v_new_status text;
  v_new_load numeric;
  v_new_unit text;
  v_snap_value numeric;
  v_snap_unit text;
begin
  if p_actor_role not in ('client', 'coach') then raise exception 'invalid actor'; end if;
  if p_value_origin is not null and p_value_origin not in ('prefill', 'entered') then raise exception 'invalid value origin'; end if;
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
  -- Effectively untouched: pending, no performed metric, and either restored
  -- prefill or a legacy row nobody has written since the workout started.
  v_untouched := v_set.status = 'pending' and v_set.actual_reps is null and v_set.actual_rpe is null
    and v_set.actual_duration_value is null and v_set.actual_distance_value is null
    and (v_set.value_origin = 'prefill' or (v_set.value_origin = 'legacy' and v_set.revision = 0 and v_set.last_actor_role is null));
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
    -- A prefill claim is accepted only when the result is exactly the load the
    -- server saw untouched before the action it reverses (the snapshot taken
    -- when an untouched set was last written) and nothing performed is set.
    -- Anything else keeps the written values but is unknown, never prefill.
    v_new_status := coalesce(p_payload ->> 'status', v_set.status);
    v_new_load := case when p_payload ? 'actual_load_value' then (p_payload ->> 'actual_load_value')::numeric else v_set.actual_load_value end;
    v_new_unit := case when p_payload ? 'actual_load_unit' then p_payload ->> 'actual_load_unit' else v_set.actual_load_unit end;
    v_origin := case
      when p_value_origin = 'entered' then 'entered'
      when p_value_origin = 'prefill'
        and v_new_status = 'pending'
        and (case when p_payload ? 'actual_reps' then p_payload ->> 'actual_reps' else v_set.actual_reps::text end) is null
        and (case when p_payload ? 'actual_rpe' then p_payload ->> 'actual_rpe' else v_set.actual_rpe::text end) is null
        and (case when p_payload ? 'actual_duration_value' then p_payload ->> 'actual_duration_value' else v_set.actual_duration_value::text end) is null
        and (case when p_payload ? 'actual_distance_value' then p_payload ->> 'actual_distance_value' else v_set.actual_distance_value::text end) is null
        and v_set.prefill_load_value is not null
        and v_new_load = v_set.prefill_load_value and v_new_unit is not distinct from v_set.prefill_load_unit then 'prefill'
      when p_value_origin = 'prefill' then 'unknown'
      else null
    end;
    -- The snapshot follows only a write to an untouched set; any other write
    -- clears it, so a later prefill claim cannot reach past an explicit value.
    v_snap_value := case when v_untouched then v_set.actual_load_value else null end;
    v_snap_unit := case when v_untouched then v_set.actual_load_unit else null end;
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
      updated_at = now(),
      -- Undeclared (v1 callers): the nonce is unchanged, so the guard trigger
      -- marks the set unknown and clears the snapshot.
      value_origin = coalesce(v_origin, value_origin),
      value_origin_nonce = case when v_origin is null then value_origin_nonce else p_event_id end,
      prefill_load_value = v_snap_value,
      prefill_load_unit = v_snap_unit
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
    local_seq, offline, plan_revision_seen, payload, outcome, conflict_id, declared_origin
  ) values (
    p_event_id, v_log_id, p_set_id, v_client_id, p_actor_role, p_actor_coach_id, p_base_revision,
    case when v_outcome = 'applied' then v_set.revision else null end,
    p_local_seq, coalesce(p_offline, false), p_plan_revision_seen, v_incoming, v_outcome, v_conflict_id, p_value_origin
  );
  return jsonb_build_object('outcome', v_outcome, 'conflict_id', v_conflict_id, 'set', to_jsonb(v_set));
end;
$$;

-- ---------- The original entry point: unchanged signature, no declaration ----------
create or replace function public.apply_workout_set_event(
  p_set_id uuid, p_event_id uuid, p_actor_role text, p_actor_coach_id uuid,
  p_base_revision integer, p_local_seq integer, p_offline boolean, p_plan_revision_seen integer,
  p_payload jsonb
) returns jsonb
language sql security invoker set search_path = '' as $$
  select public.apply_workout_set_event_v2(p_set_id, p_event_id, p_actor_role, p_actor_coach_id,
    p_base_revision, p_local_seq, p_offline, p_plan_revision_seen, p_payload, null);
$$;

revoke all on function public.apply_workout_set_event_v2(uuid, uuid, text, uuid, integer, integer, boolean, integer, jsonb, text) from public, anon, authenticated;
revoke all on function public.set_value_origin_guard() from public, anon, authenticated;
revoke all on function public.apply_workout_set_event(uuid, uuid, text, uuid, integer, integer, boolean, integer, jsonb) from public, anon, authenticated;
grant execute on function public.apply_workout_set_event_v2(uuid, uuid, text, uuid, integer, integer, boolean, integer, jsonb, text) to service_role;
grant execute on function public.apply_workout_set_event(uuid, uuid, text, uuid, integer, integer, boolean, integer, jsonb) to service_role;
