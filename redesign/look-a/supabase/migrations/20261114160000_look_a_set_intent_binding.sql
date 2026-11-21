-- Look A set intent binding (local, 2026-11-14; LOOK-A-INTEGRATION-REVIEW.md
-- residual case 1). Forward-only; earlier migrations are unchanged.
--
-- A set-v3 event id is bound to what it asked for: the set, the actor, the
-- plan revision seen, the declared origin and the values. The base revision
-- is a precondition the page attaches when it rebuilds a queued write on the
-- server's newer row (two tabs, or a lost reply, can rebuild the same write
-- on different revisions); it no longer takes part in the binding, so every
-- such copy of one write replays its first answer instead of being refused.
-- Different values, actor, plan or origin are still refused (event_id_reused).
-- Rows bound by 20261114120000 (with the base) are still accepted. Nothing
-- else in the function changes; the event id is never rotated and the Undo
-- authority stays the first applied write's own record.

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
  -- The intent (20261114160000): no base revision.
  v_request text := md5(jsonb_build_object('set', p_set_id, 'actor', p_actor_role, 'coach', p_actor_coach_id,
    'plan', p_plan_revision_seen, 'origin', p_value_origin,
    'payload', coalesce(p_payload, '{}'::jsonb) - 'completed_at' - 'updated_at')::text);
  -- The earlier binding (20261114120000), still accepted for rows it wrote.
  v_request_with_base text := md5(jsonb_build_object('set', p_set_id, 'actor', p_actor_role, 'coach', p_actor_coach_id,
    'base', p_base_revision, 'plan', p_plan_revision_seen, 'origin', p_value_origin,
    'payload', coalesce(p_payload, '{}'::jsonb) - 'completed_at' - 'updated_at')::text);
  v_bound text;
  v_gate_client uuid;
begin
  -- Shared event lock first (20261114140000).
  perform pg_advisory_xact_lock(hashtextextended('cvf:look-a-event:' || p_event_id::text, 0));
  select e.workout_log_id into v_log_id from public.workout_log_sets s
    join public.workout_log_exercises e on e.id = s.workout_log_exercise_id where s.id = p_set_id;
  if v_log_id is null then raise exception 'Workout set not found'; end if;
  -- Client gate before the workout (20261114150000).
  select l.client_id into v_gate_client from public.workout_logs l where l.id = v_log_id;
  perform 1 from public.clients where id = v_gate_client for key share;
  select * into v_log from public.workout_logs where id = v_log_id for no key update;
  if v_log.client_id is distinct from v_gate_client then
    raise exception using errcode = 'P0409', message = 'This workout is changing right now. Try again.';
  end if;
  select * into v_before from public.workout_log_sets where id = p_set_id for update;
  -- Before anything is written: an id used for another kind of change, or for
  -- a different set write, is refused.
  if exists (select 1 from public.workout_material_changes where id = p_event_id and kind <> 'set') then
    raise exception 'event_id_reused';
  end if;
  select request into v_bound from public.workout_set_event_requests where event_id = p_event_id;
  if found and v_bound <> v_request and v_bound <> v_request_with_base then raise exception 'event_id_reused'; end if;
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
