\set ON_ERROR_STOP on
do $$
declare
  c1 constant uuid := '10000000-0000-4000-8000-0000000000a1';
  k1 constant uuid := '20000000-0000-4000-8000-0000000000b1';
  k2 constant uuid := '20000000-0000-4000-8000-0000000000b2';
  w1 constant uuid := '30000000-0000-4000-8000-0000000000c1';
  w2 constant uuid := '30000000-0000-4000-8000-0000000000c2';
  p1 constant uuid := '40000000-0000-4000-8000-0000000000d1';
  rq1 constant uuid := 'a0000000-0000-4000-8000-000000000001';
  rq2 constant uuid := 'a0000000-0000-4000-8000-000000000002';
  rq3 constant uuid := 'a0000000-0000-4000-8000-000000000003';
  rq4 constant uuid := 'a0000000-0000-4000-8000-000000000004';
  rq5 constant uuid := 'a0000000-0000-4000-8000-000000000005';
  res jsonb; res2 jsonb; receipt0 jsonb; series_id0 uuid;
  slots jsonb;
begin
  -- Slots deliberately OUT of chronological order: ordinals must follow time.
  slots := jsonb_build_array(
    jsonb_build_object('key','late',  'scheduled_at','2031-03-18T17:00:00Z', 'workout_id', w2),
    jsonb_build_object('key','early', 'scheduled_at','2031-03-04T17:00:00Z', 'workout_id', w1),
    jsonb_build_object('key','mid',   'scheduled_at','2031-03-11T17:00:00Z', 'workout_id', null));

  -- S1: create. Sessions, series, receipt, ordinals and workouts all land together.
  res := public.schedule_session_series(rq1, 'hash-1', c1, k1, 60, 'Studio', '{"label":"Weekly"}'::jsonb, null, false, slots);
  if res->>'outcome' <> 'created' or (res->>'replayed')::boolean then raise exception 'S1 expected fresh creation: %', res; end if;
  series_id0 := (res->'series'->>'id')::uuid;
  receipt0 := res->'receipt';
  if (select count(*) from public.sessions where series_id = series_id0) <> 3 then raise exception 'S1 expected 3 linked sessions'; end if;
  if (res->'series'->>'created_count')::int <> 3 then raise exception 'S1 created_count: %', res; end if;
  if (select string_agg(series_ordinal::text, ',' order by scheduled_at) from public.sessions where series_id = series_id0) <> '1,2,3' then
    raise exception 'S1 ordinals must follow chronology';
  end if;
  if (select workout_id from public.sessions where series_id = series_id0 and series_ordinal = 1) <> w1
     or (select workout_id from public.sessions where series_id = series_id0 and series_ordinal = 3) <> w2
     or (select workout_id from public.sessions where series_id = series_id0 and series_ordinal = 2) is not null then
    raise exception 'S1 workouts not applied as sent';
  end if;
  if jsonb_array_length(receipt0->'slots') <> 3 or (receipt0->'slots'->0->>'key') <> 'early' then raise exception 'S1 receipt: %', receipt0; end if;

  -- S2: identical retry replays the stored receipt and creates nothing.
  res2 := public.schedule_session_series(rq1, 'hash-1', c1, k1, 60, 'Studio', '{"label":"Weekly"}'::jsonb, null, false, slots);
  if res2->>'outcome' <> 'created' or not (res2->>'replayed')::boolean or (res2->'series'->>'id')::uuid <> series_id0 then
    raise exception 'S2 expected replay of the same series: %', res2;
  end if;
  if (select count(*) from public.sessions where coach_id = c1) <> 3 then raise exception 'S2 replay must not create sessions'; end if;

  -- S3: same request id, different hash.
  res2 := public.schedule_session_series(rq1, 'hash-OTHER', c1, k1, 60, 'Studio', '{}'::jsonb, null, false, slots);
  if res2->>'outcome' <> 'request_mismatch' then raise exception 'S3 expected request_mismatch: %', res2; end if;

  -- S4: conflicts (existing bookings) create nothing and report every conflict by key.
  res := public.schedule_session_series(rq2, 'hash-2', c1, k2, 60, null, '{}'::jsonb, null, false, jsonb_build_array(
    jsonb_build_object('key','hit1','scheduled_at','2031-03-04T17:30:00Z'),   -- overlaps 'early' (coach)
    jsonb_build_object('key','ok',  'scheduled_at','2031-03-05T17:00:00Z'),
    jsonb_build_object('key','hit2','scheduled_at','2031-03-18T17:00:00Z'))); -- exactly 'late' (coach)
  if res->>'outcome' <> 'conflicts' or jsonb_array_length(res->'conflicts') <> 2 then raise exception 'S4 expected two conflicts: %', res; end if;
  if (select count(*) from public.sessions where coach_id = c1) <> 3 or exists (select 1 from public.session_series where request_id = rq2) then
    raise exception 'S4 conflicts must write nothing';
  end if;
  if not (res->'conflicts' @> '[{"key":"hit1","scope":"coach"}]'::jsonb) or not (res->'conflicts' @> '[{"key":"hit2","scope":"coach"}]'::jsonb) then
    raise exception 'S4 conflict keys/scopes: %', res;
  end if;

  -- S5: slots that overlap EACH OTHER conflict by key with scope batch; no provisional ids, nothing written.
  res := public.schedule_session_series(rq3, 'hash-3', c1, k2, 60, null, '{}'::jsonb, null, false, jsonb_build_array(
    jsonb_build_object('key','m','scheduled_at','2031-04-01T17:00:00Z'),
    jsonb_build_object('key','n','scheduled_at','2031-04-01T17:30:00Z')));
  if res->>'outcome' <> 'conflicts' or not (res->'conflicts' @> '[{"key":"m","scope":"batch","with_key":"n"}]'::jsonb) then
    raise exception 'S5 expected batch conflicts: %', res;
  end if;
  if (select count(*) from public.sessions where coach_id = c1) <> 3 then raise exception 'S5 must write nothing'; end if;

  -- S6: an unexpected failure (unknown workout -> FK violation) rolls back EVERYTHING.
  begin
    perform public.schedule_session_series(rq4, 'hash-4', c1, k2, 60, null, '{}'::jsonb, null, false, jsonb_build_array(
      jsonb_build_object('key','z1','scheduled_at','2031-05-01T17:00:00Z','workout_id','99999999-9999-4999-8999-999999999999')));
    raise exception 'S6 expected a foreign key failure';
  exception when foreign_key_violation then
    null;
  end;
  if (select count(*) from public.sessions where coach_id = c1) <> 3 or exists (select 1 from public.session_series where request_id = rq4) then
    raise exception 'S6 failure must leave no sessions or series row';
  end if;

  -- S7: program assignment is created once and never duplicated.
  res := public.schedule_session_series(rq5, 'hash-5', c1, k2, 60, null, '{}'::jsonb, p1, true, jsonb_build_array(
    jsonb_build_object('key','p1','scheduled_at','2031-06-03T17:00:00Z')));
  if res->>'outcome' <> 'created' then raise exception 'S7 expected created: %', res; end if;
  if (select count(*) from public.program_assignments where program_id = p1 and client_id = k2 and archived = false) <> 1 then
    raise exception 'S7 expected one assignment';
  end if;
  res := public.schedule_session_series('a0000000-0000-4000-8000-000000000006', 'hash-6', c1, k2, 60, null, '{}'::jsonb, p1, true, jsonb_build_array(
    jsonb_build_object('key','p2','scheduled_at','2031-06-10T17:00:00Z')));
  if (select count(*) from public.program_assignments where program_id = p1 and client_id = k2 and archived = false) <> 1 then
    raise exception 'S7 a second series must not duplicate the assignment';
  end if;

  -- S8: the receipt is immutable even after sessions are rescheduled and cancelled.
  update public.sessions set scheduled_at = scheduled_at + interval '1 day' where series_id = series_id0 and series_ordinal = 1;
  update public.sessions set status = 'cancelled' where series_id = series_id0 and series_ordinal = 3;
  res2 := public.schedule_session_series(rq1, 'hash-1', c1, k1, 60, 'Studio', '{"label":"Weekly"}'::jsonb, null, false, slots);
  if (res2->>'replayed')::boolean is not true or res2->'receipt' <> receipt0 then raise exception 'S8 receipt must be unchanged: %', res2; end if;
  if (select receipt from public.session_series where id = series_id0) <> receipt0 then raise exception 'S8 stored receipt changed'; end if;

  -- S9: input validation.
  begin perform public.schedule_session_series(rq1, 'h', c1, k1, 60, null, '{}'::jsonb, null, false, '[]'::jsonb); raise exception 'S9 empty';
  exception when others then if sqlerrm = 'S9 empty' then raise; end if; end;
end;
$$;

select 'schedule_session_series tests passed' as result;
