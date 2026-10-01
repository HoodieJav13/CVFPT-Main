-- Recurring sessions: read-only checker for preview/check. It evaluates the same
-- predicate as the real save by calling find_session_conflict, and additionally
-- compares the selected rows with each other.
--
--   p_slots:        [{ key, scheduled_at }]            -- the selected rows
--   p_alternatives: [{ key, for_key, scheduled_at }]   -- independent candidates
--
-- Selected rows: checked against existing bookings, then against each other
-- (scope 'batch', referencing the other row's KEY, never a session id).
-- Alternatives: each is checked against existing bookings and against every
-- selected row EXCEPT the row it would replace (for_key). Alternatives are never
-- compared with one another, so nearby candidates cannot block each other.

create or replace function public.check_session_slots(
  p_coach_id uuid,
  p_client_id uuid,
  p_duration_minutes integer,
  p_slots jsonb,
  p_alternatives jsonb default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_slots jsonb := coalesce(p_slots, '[]'::jsonb);
  v_alts jsonb := coalesce(p_alternatives, '[]'::jsonb);
  v_slot_results jsonb := '[]'::jsonb;
  v_alt_results jsonb := '[]'::jsonb;
  r record;
  v_found jsonb;
  v_with text;
begin
  if p_duration_minutes is null or p_duration_minutes < 1 then
    raise exception 'Valid duration required';
  end if;
  if jsonb_typeof(v_slots) <> 'array' or jsonb_typeof(v_alts) <> 'array' then
    raise exception 'Slots and alternatives must be arrays';
  end if;

  for r in
    select e->>'key' as key, (e->>'scheduled_at')::timestamptz as at
    from jsonb_array_elements(v_slots) as e
  loop
    v_found := public.find_session_conflict(p_coach_id, p_client_id, r.at, p_duration_minutes, null);
    v_with := null;
    if v_found is null then
      select o.key into v_with
      from (select e->>'key' as key, (e->>'scheduled_at')::timestamptz as at
            from jsonb_array_elements(v_slots) as e) o
      where o.key <> r.key
        and public.session_time_range(o.at, p_duration_minutes) && public.session_time_range(r.at, p_duration_minutes)
      order by o.at, o.key
      limit 1;
    end if;
    v_slot_results := v_slot_results || jsonb_build_array(jsonb_build_object(
      'key', r.key,
      'conflict', case
        when v_found is not null then jsonb_build_object('scope', v_found->>'scope', 'session', v_found->'conflict_session')
        when v_with is not null then jsonb_build_object('scope', 'batch', 'with_key', v_with)
        else null
      end
    ));
  end loop;

  for r in
    select e->>'key' as key, e->>'for_key' as for_key, (e->>'scheduled_at')::timestamptz as at
    from jsonb_array_elements(v_alts) as e
  loop
    v_found := public.find_session_conflict(p_coach_id, p_client_id, r.at, p_duration_minutes, null);
    v_with := null;
    if v_found is null then
      select o.key into v_with
      from (select e->>'key' as key, (e->>'scheduled_at')::timestamptz as at
            from jsonb_array_elements(v_slots) as e) o
      where o.key is distinct from r.for_key
        and public.session_time_range(o.at, p_duration_minutes) && public.session_time_range(r.at, p_duration_minutes)
      limit 1;
    end if;
    v_alt_results := v_alt_results || jsonb_build_array(jsonb_build_object(
      'key', r.key, 'for_key', r.for_key, 'free', (v_found is null and v_with is null)
    ));
  end loop;

  return jsonb_build_object('slots', v_slot_results, 'alternatives', v_alt_results);
end;
$$;

revoke execute on function public.check_session_slots(uuid, uuid, integer, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.check_session_slots(uuid, uuid, integer, jsonb, jsonb) to service_role;

select 'check_session_slots ready' as result;
