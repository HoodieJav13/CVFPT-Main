-- Recurring sessions: the transactional batch save.
--
-- Order matters:
--   1. take the global scheduling advisory lock (transaction-scoped);
--   2. THEN look up (coach_id, request_id) — so two simultaneous identical
--      requests serialize: the first creates, the second finds the committed
--      series and replays;
--   3. evaluate every slot WITHOUT writing (existing bookings + each other);
--      any conflict returns all of them by key and writes nothing;
--   4. otherwise create sessions (via schedule_session), build the immutable
--      receipt, insert the series row, THEN link the sessions (series_id has a
--      foreign key), then optionally assign the program. One transaction: any
--      unexpected error rolls everything back.

create or replace function public.schedule_session_series(
  p_request_id uuid,
  p_request_hash text,
  p_coach_id uuid,
  p_client_id uuid,
  p_duration_minutes integer,
  p_location text,
  p_rule jsonb,
  p_program_id uuid,
  p_assign_program boolean,
  p_slots jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_series public.session_series%rowtype;
  v_check jsonb;
  v_conflicts jsonb;
  v_result jsonb;
  v_receipt jsonb := '[]'::jsonb;
  v_slot record;
  v_ordinal integer := 0;
  v_count integer;
begin
  if p_slots is null or jsonb_typeof(p_slots) <> 'array' then
    raise exception 'Valid slots required';
  end if;
  v_count := jsonb_array_length(p_slots);
  if v_count < 1 or v_count > 52 then
    raise exception 'A series has between 1 and 52 sessions';
  end if;
  if p_duration_minutes is null or p_duration_minutes < 1 then
    raise exception 'Valid duration required';
  end if;
  if p_request_id is null or p_request_hash is null then
    raise exception 'Request identity required';
  end if;

  -- 1. Lock first.
  perform pg_advisory_xact_lock(hashtext('cvf_session_scheduling'));

  -- 2. Authoritative idempotency lookup, under the lock.
  select * into v_series from public.session_series where coach_id = p_coach_id and request_id = p_request_id;
  if v_series.id is not null then
    if v_series.request_hash <> p_request_hash then
      return jsonb_build_object('outcome', 'request_mismatch');
    end if;
    return jsonb_build_object('outcome', 'created', 'replayed', true, 'series', to_jsonb(v_series), 'receipt', v_series.receipt);
  end if;

  -- 3. Evaluate without writing; report every conflict at once, by stable key.
  v_check := public.check_session_slots(p_coach_id, p_client_id, p_duration_minutes, p_slots, null);
  select coalesce(jsonb_agg(jsonb_build_object('key', e->>'key') || (e->'conflict') order by ord), '[]'::jsonb)
    into v_conflicts
  from jsonb_array_elements(v_check->'slots') with ordinality as t(e, ord)
  where jsonb_typeof(e->'conflict') = 'object';
  if jsonb_array_length(v_conflicts) > 0 then
    return jsonb_build_object('outcome', 'conflicts', 'conflicts', v_conflicts);
  end if;

  -- 4a. Create sessions chronologically. Step 3 found no conflicts and the lock is
  -- held, so any other outcome is unexpected: raise and roll everything back.
  for v_slot in
    select e as slot, (e->>'scheduled_at')::timestamptz as at, e->>'key' as key
    from jsonb_array_elements(p_slots) as e
    order by (e->>'scheduled_at')::timestamptz, e->>'key'
  loop
    v_ordinal := v_ordinal + 1;
    v_result := public.schedule_session(null, p_client_id, p_coach_id, v_slot.at, p_duration_minutes, p_location, true);
    if v_result->>'outcome' <> 'scheduled' then
      raise exception 'Unexpected scheduling outcome % for slot %', v_result->>'outcome', v_slot.key;
    end if;
    v_receipt := v_receipt || jsonb_build_array(jsonb_build_object(
      'key', v_slot.key,
      'session_id', v_result->'session'->>'id',
      'scheduled_at', v_slot.slot->>'scheduled_at',
      'workout_id', v_slot.slot->'workout_id',
      'ordinal', v_ordinal
    ));
  end loop;

  -- 4b/c. Immutable receipt + series row (must exist before sessions point at it).
  insert into public.session_series
    (coach_id, client_id, program_id, rule, created_count, request_id, request_hash, receipt)
  values
    (p_coach_id, p_client_id, p_program_id, coalesce(p_rule, '{}'::jsonb), v_count,
     p_request_id, p_request_hash, jsonb_build_object('slots', v_receipt))
  returning * into v_series;

  -- 4d. Link the sessions and apply the workout mapping exactly as sent.
  update public.sessions s
  set series_id = v_series.id,
      series_ordinal = r.ordinal,
      workout_id = r.workout_id,
      updated_at = now()
  from jsonb_to_recordset(v_receipt) as r(session_id uuid, ordinal integer, workout_id uuid)
  where s.id = r.session_id;

  -- 4e. Optional program assignment (skipped when the client already has it).
  if p_assign_program and p_program_id is not null then
    if not exists (
      select 1 from public.program_assignments a
      join public.programs p on p.id = a.program_id
      where a.client_id = p_client_id and a.archived = false and p.archived = false
        and (a.program_id = p_program_id or p.source_program_id = p_program_id)
    ) then
      perform public.assign_program_clone(p_program_id, p_client_id, null, '[]'::jsonb);
    end if;
  end if;

  return jsonb_build_object('outcome', 'created', 'replayed', false, 'series', to_jsonb(v_series), 'receipt', v_series.receipt);
end;
$$;

revoke execute on function public.schedule_session_series(uuid, text, uuid, uuid, integer, text, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.schedule_session_series(uuid, text, uuid, uuid, integer, text, jsonb, uuid, boolean, jsonb) to service_role;

select 'schedule_session_series ready' as result;
