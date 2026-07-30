-- ============================================================
-- PR-E (roadmap Track 3): transactional session conflict protection.
--
-- Decisions implemented (owner, 2026-07-30):
--   S1 coach + client overlaps are hard blocks; location is advisory only
--      (free text — two spellings of one room must not read as different
--      rooms, so it can never be a reliable hard constraint)
--   S2 back-to-back sessions allowed (ranges are half-open: [start, end))
--   S3 cancelled sessions free their slot (excluded everywhere below)
--   S4 capacity modeled now, default 1; the exclusion backstop covers
--      capacity = 1 rows (every session today) — capacity > 1 rows are
--      RPC-enforced only, a documented ceiling of exclusion constraints
--
-- Enforcement layers:
--   1. schedule_session / approve_booking RPCs — transactional check,
--      serialized by an advisory xact lock so two concurrent bookings
--      cannot both read "no conflict".
--   2. Partial exclusion constraints — database-level backstop that holds
--      even if a future code path bypasses the RPCs.
-- ============================================================

create extension if not exists btree_gist;

alter table public.sessions
  add column if not exists capacity integer not null default 1 check (capacity >= 1);

-- Half-open range: a session ending at 10:00 does not overlap one
-- starting at 10:00 (S2).
create or replace function public.session_time_range(p_scheduled_at timestamptz, p_duration_minutes integer)
returns tstzrange
language sql
immutable
set search_path = ''
as $$
  select tstzrange(p_scheduled_at, p_scheduled_at + make_interval(mins => p_duration_minutes), '[)');
$$;

-- ---------- Pre-flight: refuse to enable over already-conflicting data ----------
-- Exclusion constraints cannot be added while violating rows exist. Fail
-- loudly with a count so the owner can resolve (cancel/reschedule one of
-- each pair) and re-apply, instead of a cryptic constraint error.
do $$
declare
  v_coach_overlaps integer;
  v_client_overlaps integer;
begin
  select count(*) into v_coach_overlaps
  from public.sessions a
  join public.sessions b on a.id < b.id and a.coach_id = b.coach_id
  where a.status <> 'cancelled' and b.status <> 'cancelled'
    and a.archived = false and b.archived = false
    and public.session_time_range(a.scheduled_at, a.duration_minutes)
        && public.session_time_range(b.scheduled_at, b.duration_minutes);

  select count(*) into v_client_overlaps
  from public.sessions a
  join public.sessions b on a.id < b.id and a.client_id = b.client_id
  where a.status <> 'cancelled' and b.status <> 'cancelled'
    and a.archived = false and b.archived = false
    and public.session_time_range(a.scheduled_at, a.duration_minutes)
        && public.session_time_range(b.scheduled_at, b.duration_minutes);

  if v_coach_overlaps > 0 or v_client_overlaps > 0 then
    raise exception using message = format(
      'Cannot enable session conflict protection: %s coach and %s client overlapping session pair(s) already exist. Cancel or reschedule one session in each pair, then re-run this migration.',
      v_coach_overlaps, v_client_overlaps);
  end if;
end;
$$;

-- ---------- Backstop exclusion constraints ----------
alter table public.sessions drop constraint if exists sessions_no_coach_overlap;
alter table public.sessions add constraint sessions_no_coach_overlap
  exclude using gist (
    coach_id with =,
    public.session_time_range(scheduled_at, duration_minutes) with &&
  ) where (status <> 'cancelled' and archived = false and capacity = 1);

alter table public.sessions drop constraint if exists sessions_no_client_overlap;
alter table public.sessions add constraint sessions_no_client_overlap
  exclude using gist (
    client_id with =,
    public.session_time_range(scheduled_at, duration_minutes) with &&
  ) where (status <> 'cancelled' and archived = false);

-- ---------- Transactional scheduling RPC ----------
-- p_session_id null = create; non-null = reschedule that session (which is
-- excluded from its own conflict scan). Returns jsonb:
--   { outcome: 'scheduled', session, location_overlaps }
--   { outcome: 'coach_conflict' | 'client_conflict', conflict_session }
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
  v_conflict public.sessions%rowtype;
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

  -- Coach hard block. Capacity semantics: overlapping a capacity-1 session
  -- (or when the new slot itself is capacity 1) is a conflict; capacity > 1
  -- group slots are governed by their remaining headcount, enforced here
  -- (the exclusion backstop only covers capacity = 1).
  select s.* into v_conflict
  from public.sessions s
  where s.coach_id = p_coach_id
    and s.status <> 'cancelled' and s.archived = false
    and (p_session_id is null or s.id <> p_session_id)
    and public.session_time_range(s.scheduled_at, s.duration_minutes) && v_range
    and (s.capacity = 1 or (
      select count(*) from public.sessions o
      where o.coach_id = p_coach_id and o.status <> 'cancelled' and o.archived = false
        and (p_session_id is null or o.id <> p_session_id)
        and public.session_time_range(o.scheduled_at, o.duration_minutes) && v_range
    ) >= s.capacity)
  order by s.scheduled_at
  limit 1;
  if v_conflict.id is not null then
    return jsonb_build_object('outcome', 'coach_conflict', 'conflict_session', to_jsonb(v_conflict));
  end if;

  -- Client hard block: a client cannot be in two places at once.
  select s.* into v_conflict
  from public.sessions s
  where s.client_id = p_client_id
    and s.status <> 'cancelled' and s.archived = false
    and (p_session_id is null or s.id <> p_session_id)
    and public.session_time_range(s.scheduled_at, s.duration_minutes) && v_range
  order by s.scheduled_at
  limit 1;
  if v_conflict.id is not null then
    return jsonb_build_object('outcome', 'client_conflict', 'conflict_session', to_jsonb(v_conflict));
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

-- ---------- approve_booking now refuses conflicting approvals ----------
-- Same signature, redefined: the booking stays pending on conflict so the
-- coach can decline or pick a new time instead of silently double-booking.
create or replace function public.approve_booking(p_booking_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_booking public.booking_requests%rowtype;
  v_result jsonb;
begin
  select * into v_booking
  from public.booking_requests
  where id = p_booking_id and status = 'pending' and archived = false
  for update;

  if v_booking.id is null then
    return null;
  end if;

  v_result := public.schedule_session(
    null,
    v_booking.client_id,
    v_booking.coach_id,
    v_booking.requested_time,
    v_booking.duration_minutes,
    v_booking.location,
    true
  );

  if v_result->>'outcome' <> 'scheduled' then
    return v_result;
  end if;

  update public.booking_requests
  set status = 'approved', updated_at = now()
  where id = v_booking.id
  returning * into v_booking;

  return jsonb_build_object(
    'outcome', 'approved',
    'booking', to_jsonb(v_booking),
    'session', v_result->'session',
    'location_overlaps', v_result->'location_overlaps'
  );
end;
$$;

revoke execute on function public.session_time_range(timestamptz, integer) from public, anon, authenticated;
revoke execute on function public.schedule_session(uuid, uuid, uuid, timestamptz, integer, text, boolean) from public, anon, authenticated;
grant execute on function public.session_time_range(timestamptz, integer) to service_role;
grant execute on function public.schedule_session(uuid, uuid, uuid, timestamptz, integer, text, boolean) to service_role;
-- approve_booking grants carry over from its original definition.

select 'session conflict protection ready' as result;
