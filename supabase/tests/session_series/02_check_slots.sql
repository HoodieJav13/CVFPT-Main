\set ON_ERROR_STOP on
create function pg_temp.slot_of(res jsonb, k text) returns jsonb language sql as
$$ select e from jsonb_array_elements(res->'slots') e where e->>'key' = k $$;
create function pg_temp.alt_of(res jsonb, k text) returns jsonb language sql as
$$ select e from jsonb_array_elements(res->'alternatives') e where e->>'key' = k $$;

do $$
declare
  c1 constant uuid := '10000000-0000-4000-8000-0000000000a1';
  c2 constant uuid := '10000000-0000-4000-8000-0000000000a2';
  k1 constant uuid := '20000000-0000-4000-8000-0000000000b1';
  k2 constant uuid := '20000000-0000-4000-8000-0000000000b2';
  k3 constant uuid := '20000000-0000-4000-8000-0000000000b3';
  t constant timestamptz := '2031-03-04 17:00:00+00';
  e uuid; g uuid;
  res jsonb;
begin
  -- An existing coach-c1 / client-k3 booking at t (60 min).
  insert into public.sessions (client_id, coach_id, scheduled_at, duration_minutes)
  values (k3, c1, t, 60) returning id into e;

  -- 1. coach conflict names the existing session; the back-to-back slot is free.
  res := public.check_session_slots(c1, k1, 60, jsonb_build_array(
    jsonb_build_object('key','a','scheduled_at', t),
    jsonb_build_object('key','b','scheduled_at', t + interval '60 minutes')), null);
  if pg_temp.slot_of(res,'a')->'conflict'->>'scope' <> 'coach' or (pg_temp.slot_of(res,'a')->'conflict'->'session'->>'id')::uuid <> e then
    raise exception 'C1 expected coach conflict on e: %', res;
  end if;
  if jsonb_typeof(pg_temp.slot_of(res,'b')->'conflict') <> 'null' then raise exception 'C1b expected free: %', res; end if;

  -- 2. client conflict when the coach is free (coach c2, client k3).
  res := public.check_session_slots(c2, k3, 60, jsonb_build_array(jsonb_build_object('key','a','scheduled_at', t)), null);
  if pg_temp.slot_of(res,'a')->'conflict'->>'scope' <> 'client' then raise exception 'C2 expected client conflict: %', res; end if;

  -- 3. batch conflicts are reciprocal and reference stable keys, never session ids.
  res := public.check_session_slots(c1, k1, 60, jsonb_build_array(
    jsonb_build_object('key','x','scheduled_at', t + interval '2 hours'),
    jsonb_build_object('key','y','scheduled_at', t + interval '150 minutes')), null);
  if pg_temp.slot_of(res,'x')->'conflict' <> '{"scope":"batch","with_key":"y"}'::jsonb
     or pg_temp.slot_of(res,'y')->'conflict' <> '{"scope":"batch","with_key":"x"}'::jsonb then
    raise exception 'C3 expected reciprocal batch conflicts: %', res;
  end if;

  -- 4. an existing-booking conflict takes priority over a batch conflict.
  res := public.check_session_slots(c1, k1, 60, jsonb_build_array(
    jsonb_build_object('key','p','scheduled_at', t),
    jsonb_build_object('key','q','scheduled_at', t + interval '30 minutes')), null);
  if pg_temp.slot_of(res,'p')->'conflict'->>'scope' <> 'coach' then raise exception 'C4 expected coach priority: %', res; end if;

  -- 5. alternatives: independent, checked against existing bookings; they never block each other.
  res := public.check_session_slots(c1, k1, 60,
    jsonb_build_array(jsonb_build_object('key','r1','scheduled_at', t)),
    jsonb_build_array(
      jsonb_build_object('key','a15','for_key','r1','scheduled_at', t + interval '15 minutes'),   -- overlaps e
      jsonb_build_object('key','a60','for_key','r1','scheduled_at', t + interval '60 minutes'),   -- free (the 10:00 case)
      jsonb_build_object('key','a75','for_key','r1','scheduled_at', t + interval '75 minutes'),   -- free, overlaps a60 but alternatives are independent
      jsonb_build_object('key','am60','for_key','r1','scheduled_at', t - interval '60 minutes'))); -- free
  if (pg_temp.alt_of(res,'a15')->>'free')::boolean then raise exception 'C5 a15 should be blocked by e: %', res; end if;
  if not (pg_temp.alt_of(res,'a60')->>'free')::boolean or not (pg_temp.alt_of(res,'a75')->>'free')::boolean
     or not (pg_temp.alt_of(res,'am60')->>'free')::boolean then
    raise exception 'C5 expected a60/a75/am60 free and independent: %', res;
  end if;

  -- 6. selected rows block alternatives, except the row being replaced.
  res := public.check_session_slots(c1, k1, 60,
    jsonb_build_array(
      jsonb_build_object('key','r1','scheduled_at', t),
      jsonb_build_object('key','r2','scheduled_at', t + interval '2 hours')),
    jsonb_build_array(
      jsonb_build_object('key','into_r2','for_key','r1','scheduled_at', t + interval '2 hours'),   -- blocked by r2
      jsonb_build_object('key','own_slot','for_key','r2','scheduled_at', t + interval '2 hours'))); -- r2's own time: excluded row
  if (pg_temp.alt_of(res,'into_r2')->>'free')::boolean then raise exception 'C6 alternative into another selected row must be blocked: %', res; end if;
  if not (pg_temp.alt_of(res,'own_slot')->>'free')::boolean then raise exception 'C6 the replaced row must not block its own alternative: %', res; end if;

  -- 7. capacity > 1: a group slot with room does not block the coach.
  insert into public.sessions (client_id, coach_id, scheduled_at, duration_minutes, capacity)
  values (k2, c1, t + interval '5 hours', 60, 2) returning id into g;
  res := public.check_session_slots(c1, k1, 60, jsonb_build_array(jsonb_build_object('key','g','scheduled_at', t + interval '5 hours')), null);
  if jsonb_typeof(pg_temp.slot_of(res,'g')->'conflict') <> 'null' then raise exception 'C7 capacity-2 slot with room should not conflict: %', res; end if;

  -- 8. the checker is read-only: it created nothing.
  if (select count(*) from public.sessions where coach_id = c1) <> 2 then raise exception 'C8 checker must not write'; end if;

  -- 9. bad input raises.
  begin
    perform public.check_session_slots(c1, k1, 0, '[]'::jsonb, null);
    raise exception 'C9 expected a duration error';
  exception when others then
    if sqlerrm = 'C9 expected a duration error' then raise; end if;
  end;
end;
$$;

select 'check_session_slots tests passed' as result;
