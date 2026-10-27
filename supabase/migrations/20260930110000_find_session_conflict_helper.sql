-- Recurring sessions: ONE conflict predicate. The coach/client blocker queries
-- from schedule_session (20260730220646_session_conflict_protection.sql) are
-- extracted verbatim into a read-only function that schedule_session, the new
-- check_session_slots, and schedule_session_series all call, so a preview and the
-- real save cannot disagree.
--
-- schedule_session keeps its signature, advisory lock, return shapes and
-- location-advisory behavior. approve_booking / request_booking are untouched.

create or replace function public.find_session_conflict(
  p_coach_id uuid,
  p_client_id uuid,
  p_scheduled_at timestamptz,
  p_duration_minutes integer,
  p_exclude_session_id uuid default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_range tstzrange;
  v_conflict public.sessions%rowtype;
begin
  if p_scheduled_at is null or p_duration_minutes is null or p_duration_minutes < 1 then
    raise exception 'Valid schedule required';
  end if;
  v_range := public.session_time_range(p_scheduled_at, p_duration_minutes);

  -- Coach hard block. Overlapping a capacity-1 session is a conflict; capacity > 1
  -- group slots are governed by their remaining headcount.
  select s.* into v_conflict
  from public.sessions s
  where s.coach_id = p_coach_id
    and s.status <> 'cancelled' and s.archived = false
    and (p_exclude_session_id is null or s.id <> p_exclude_session_id)
    and public.session_time_range(s.scheduled_at, s.duration_minutes) && v_range
    and (s.capacity = 1 or (
      select count(*) from public.sessions o
      where o.coach_id = p_coach_id and o.status <> 'cancelled' and o.archived = false
        and (p_exclude_session_id is null or o.id <> p_exclude_session_id)
        and public.session_time_range(o.scheduled_at, o.duration_minutes) && v_range
    ) >= s.capacity)
  order by s.scheduled_at
  limit 1;
  if v_conflict.id is not null then
    return jsonb_build_object('scope', 'coach', 'conflict_session', to_jsonb(v_conflict));
  end if;

  -- Client hard block: a client cannot be in two places at once.
  select s.* into v_conflict
  from public.sessions s
  where s.client_id = p_client_id
    and s.status <> 'cancelled' and s.archived = false
    and (p_exclude_session_id is null or s.id <> p_exclude_session_id)
    and public.session_time_range(s.scheduled_at, s.duration_minutes) && v_range
  order by s.scheduled_at
  limit 1;
  if v_conflict.id is not null then
    return jsonb_build_object('scope', 'client', 'conflict_session', to_jsonb(v_conflict));
  end if;

  return null;
end;
$$;

-- Same signature, lock and results as before; the two blocker queries now live in
-- find_session_conflict.
create or replace function public.schedule_session(
  p_session_id uuid,
  p_client_id uuid,
  p_coach_id uuid,
  p_scheduled_at timestamptz,
  p_duration_minutes integer,
  p_location text,
  p_set_location boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_range tstzrange;
  v_found jsonb;
  v_session public.sessions%rowtype;
  v_location_overlaps integer := 0;
begin
  if p_scheduled_at is null or p_duration_minutes is null or p_duration_minutes < 1 then
    raise exception 'Valid schedule required';
  end if;
  v_range := public.session_time_range(p_scheduled_at, p_duration_minutes);

  -- Serialize all scheduling so concurrent requests cannot both pass the
  -- read check (three coaches: contention is negligible).
  perform pg_advisory_xact_lock(hashtext('cvf_session_scheduling'));

  v_found := public.find_session_conflict(p_coach_id, p_client_id, p_scheduled_at, p_duration_minutes, p_session_id);
  if v_found is not null then
    return jsonb_build_object(
      'outcome', (v_found->>'scope') || '_conflict',
      'conflict_session', v_found->'conflict_session'
    );
  end if;

  -- Location advisory (free text; case/space-insensitive; never blocks).
  if p_location is not null and btrim(p_location) <> '' then
    select count(*) into v_location_overlaps
    from public.sessions s
    where s.status <> 'cancelled' and s.archived = false
      and (p_session_id is null or s.id <> p_session_id)
      and s.location is not null
      and lower(btrim(s.location)) = lower(btrim(p_location))
      and public.session_time_range(s.scheduled_at, s.duration_minutes) && v_range;
  end if;

  if p_session_id is null then
    insert into public.sessions (client_id, coach_id, scheduled_at, duration_minutes, location)
    values (p_client_id, p_coach_id, p_scheduled_at, p_duration_minutes, p_location)
    returning * into v_session;
  else
    update public.sessions
    set scheduled_at = p_scheduled_at,
        duration_minutes = p_duration_minutes,
        location = case when p_set_location then p_location else location end,
        updated_at = now()
    where id = p_session_id and archived = false
    returning * into v_session;
    if v_session.id is null then
      raise exception 'Session not found';
    end if;
  end if;

  return jsonb_build_object(
    'outcome', 'scheduled',
    'session', to_jsonb(v_session),
    'location_overlaps', v_location_overlaps
  );
end;
$$;

revoke execute on function public.find_session_conflict(uuid, uuid, timestamptz, integer, uuid) from public, anon, authenticated;
grant execute on function public.find_session_conflict(uuid, uuid, timestamptz, integer, uuid) to service_role;
-- schedule_session keeps the privileges set when it was first created.

select 'find_session_conflict helper ready' as result;
