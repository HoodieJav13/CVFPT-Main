-- Look A only. Save numbers on a pending set without replacing the previous
-- set's Undo. Preserve existing locks, v2 conflict checks, event registration,
-- strict material counters, and the previous action's original inverse.
-- Earlier overlay migration bytes remain unchanged; the main chain is untouched.

-- Build the same workout fingerprint, optionally substituting one known set
-- counter. This lets the draft write atomically compare the material version
-- it alone would have changed, without accepting concurrent/legacy writes.
create function public.look_a_material_fingerprint_with_set(p_log_id uuid, p_set_id uuid, p_set_seq bigint)
returns text
language sql stable security invoker set search_path = '' as $$
  select md5(
    coalesce((select l.id::text || ':' || l.material_seq from public.workout_logs l where l.id = p_log_id), '')
    || '|' || coalesce((select string_agg(e.id::text || ':' || e.material_seq, ',' order by e.id)
         from public.workout_log_exercises e where e.workout_log_id = p_log_id), '')
    || '|' || coalesce((select string_agg(s.id::text || ':' || (case when s.id = p_set_id then p_set_seq else s.material_seq end), ',' order by s.id)
         from public.workout_log_sets s join public.workout_log_exercises e on e.id = s.workout_log_exercise_id
         where e.workout_log_id = p_log_id), '')
    || '|' || coalesce((select string_agg(x.id::text || ':' || x.material_seq, ',' order by x.id)
         from public.workout_log_substitutions x where x.workout_log_id = p_log_id), ''));
$$;

revoke all on function public.look_a_material_fingerprint_with_set(uuid, uuid, bigint) from public, anon, authenticated, service_role;
grant execute on function public.look_a_material_fingerprint_with_set(uuid, uuid, bigint) to service_role;

create or replace function public.workout_log_material_fingerprint(p_log_id uuid) returns text
language sql stable security invoker set search_path = '' as $$
  select public.look_a_material_fingerprint_with_set(p_log_id, null, null);
$$;

-- Set inverses already carry the exact target in request. Expose it in
-- current Undo too, even for set events logged before this correction.
create or replace function public.workout_current_undo(p_log_id uuid, p_actor_role text, p_actor_coach_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select case when c.actor_role = p_actor_role and c.actor_coach_id is not distinct from p_actor_coach_id
                and public.look_a_change_undoable(c)
              then jsonb_build_object('change_id', c.id, 'kind', c.kind, 'created_at', c.created_at,
                'result', case when c.kind = 'set' then c.result || jsonb_build_object('set_id', c.request -> 'set_id')
                               else c.result end) end
  from public.workout_material_changes c
  where c.workout_log_id = p_log_id and c.outcome = 'applied'
  order by c.seq desc limit 1;
$$;

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
      -- Save/resynchronize unlogged client input as before; it is not a new
      -- Undo action. A different set's last valid inverse can survive this
      -- exact draft write, but never an unrelated edit, actor, or status change.
      if p_actor_role = 'client' and p_actor_coach_id is null and p_value_origin = 'entered'
         and v_before.status = 'pending' and v_result -> 'set' ->> 'status' = 'pending' then
        -- Both fingerprints use the same command snapshot; the before side
        -- replaces only this locked draft row's counter with its previous
        -- value. A legacy/concurrent edit to any other row cannot be absorbed.
        -- Only the latest applied row is eligible; no earlier inverse revives.
        update public.workout_material_changes as c
        set fingerprint_after = public.workout_log_material_fingerprint(v_log_id)
        where c.id = (select last_change.id from public.workout_material_changes last_change
          where last_change.workout_log_id = v_log_id and last_change.outcome = 'applied'
          order by last_change.seq desc limit 1)
          and c.kind = 'set' and c.actor_role = p_actor_role
          and c.actor_coach_id is not distinct from p_actor_coach_id
          and c.undone_by is null and c.inverse is not null
          and c.request ->> 'set_id' <> p_set_id::text
          and c.fingerprint_after = public.look_a_material_fingerprint_with_set(v_log_id, p_set_id, v_before.material_seq);
        return v_result || jsonb_build_object('change', null,
          'undo', public.workout_current_undo(v_log_id, p_actor_role, p_actor_coach_id));
      end if;
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
    if found then
      return v_result || jsonb_build_object('change', jsonb_build_object('id', v_change.id,
        'undoable', public.look_a_change_undoable(v_change)));
    end if;
    if v_result ->> 'original_outcome' = 'applied' and p_actor_role = 'client'
       and p_actor_coach_id is null and p_value_origin = 'entered' then
      -- Lost draft/no-op response: report the current inverse, not a guessed
      -- inverse of the replay and never a new ledger row.
      return v_result || jsonb_build_object('change', null,
        'undo', public.workout_current_undo(v_log_id, p_actor_role, p_actor_coach_id));
    end if;
    return v_result || jsonb_build_object('change', null);
  end if;
  return v_result;
end;
$$;
