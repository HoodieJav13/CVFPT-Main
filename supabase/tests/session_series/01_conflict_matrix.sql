\set ON_ERROR_STOP on
-- Behavior matrix for schedule_session. Expected outcomes encode the CURRENT
-- (pre-refactor) behavior from 20260730220646_session_conflict_protection.sql,
-- so this file must pass both before and after the find_session_conflict refactor.
do $$
declare
  c1 constant uuid := '10000000-0000-4000-8000-0000000000a1';
  c2 constant uuid := '10000000-0000-4000-8000-0000000000a2';
  k1 constant uuid := '20000000-0000-4000-8000-0000000000b1';
  k2 constant uuid := '20000000-0000-4000-8000-0000000000b2';
  k3 constant uuid := '20000000-0000-4000-8000-0000000000b3';
  t0 constant timestamptz := '2031-03-04 17:00:00+00';
  r jsonb;
  s1 uuid; s7 uuid; g uuid;
begin
  -- M1: empty calendar schedules; location advisory present and zero.
  r := public.schedule_session(null, k1, c1, t0, 60, 'Studio', true);
  if r->>'outcome' <> 'scheduled' then raise exception 'M1 expected scheduled: %', r; end if;
  if (r->>'location_overlaps')::int <> 0 then raise exception 'M1 location_overlaps expected 0: %', r; end if;
  s1 := (r->'session'->>'id')::uuid;

  -- M2: same coach, different client, overlapping -> coach_conflict naming s1.
  r := public.schedule_session(null, k2, c1, t0 + interval '30 minutes', 60, null, true);
  if r->>'outcome' <> 'coach_conflict' or (r->'conflict_session'->>'id')::uuid <> s1 then
    raise exception 'M2 expected coach_conflict on s1: %', r;
  end if;

  -- M3: same client, different coach, overlapping -> client_conflict.
  r := public.schedule_session(null, k1, c2, t0 + interval '30 minutes', 60, null, true);
  if r->>'outcome' <> 'client_conflict' then raise exception 'M3 expected client_conflict: %', r; end if;

  -- M4: back-to-back is allowed (half-open ranges).
  r := public.schedule_session(null, k2, c1, t0 + interval '60 minutes', 60, null, true);
  if r->>'outcome' <> 'scheduled' then raise exception 'M4 expected scheduled (back-to-back): %', r; end if;

  -- M5: a candidate that STARTS BEFORE an existing session but overlaps it conflicts.
  r := public.schedule_session(null, k3, c1, t0 - interval '30 minutes', 60, null, true);
  if r->>'outcome' <> 'coach_conflict' then raise exception 'M5 expected coach_conflict (starts before): %', r; end if;

  -- M6: cancelled sessions free their slot.
  update public.sessions set status = 'cancelled' where id = s1;
  r := public.schedule_session(null, k3, c1, t0, 60, null, true);
  if r->>'outcome' <> 'scheduled' then raise exception 'M6 expected scheduled after cancel: %', r; end if;

  -- M7: archived sessions free their slot.
  update public.sessions set archived = true where id = (r->'session'->>'id')::uuid;
  r := public.schedule_session(null, k1, c1, t0, 60, null, true);
  if r->>'outcome' <> 'scheduled' then raise exception 'M7 expected scheduled after archive: %', r; end if;
  s7 := (r->'session'->>'id')::uuid;

  -- M8: capacity > 1 group slot: first extra booking fits the headcount, the next hits the capacity-1 session.
  insert into public.sessions (client_id, coach_id, scheduled_at, duration_minutes, capacity)
  values (k3, c1, t0 + interval '5 hours', 60, 2) returning id into g;
  r := public.schedule_session(null, k2, c1, t0 + interval '5 hours', 60, null, true);
  if r->>'outcome' <> 'scheduled' then raise exception 'M8a expected scheduled into a capacity-2 slot: %', r; end if;
  r := public.schedule_session(null, k1, c1, t0 + interval '5 hours', 60, null, true);
  if r->>'outcome' <> 'coach_conflict' then raise exception 'M8b expected coach_conflict once a capacity-1 session overlaps: %', r; end if;

  -- M9: rescheduling excludes the session itself (5 minutes earlier overlaps only itself,
  -- and still clears the back-to-back session that starts at t0 + 60 minutes).
  r := public.schedule_session(s7, k1, c1, t0 - interval '5 minutes', 60, null, false);
  if r->>'outcome' <> 'scheduled' then raise exception 'M9 expected reschedule to exclude itself: %', r; end if;

  -- M10: location advisory is case/space-insensitive and never blocks.
  insert into public.sessions (client_id, coach_id, scheduled_at, duration_minutes, location)
  values (k3, c2, t0 + interval '10 hours', 60, 'Studio');
  r := public.schedule_session(null, k2, c1, t0 + interval '10 hours', 60, '  studio ', true);
  if r->>'outcome' <> 'scheduled' or (r->>'location_overlaps')::int <> 1 then
    raise exception 'M10 expected scheduled with one location overlap: %', r;
  end if;
end;
$$;

select 'conflict matrix passed' as result;
