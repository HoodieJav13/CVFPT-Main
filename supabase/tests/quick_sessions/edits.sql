-- A9 (sequential half; committed two-connection races live in concurrency.sh):
-- quick-only pre-start edit guard across every writer; ordinary behavior unchanged.
do $$
declare
  c1 uuid := 'b1000000-0000-4000-8000-000000000001';
  k1 uuid := 'b2000000-0000-4000-8000-000000000001';
  k2 uuid := 'b2000000-0000-4000-8000-000000000002';
  r jsonb; a uuid; w uuid; ex uuid; log_id uuid; start jsonb; before_rows text; before_loads text;
  tmpl uuid; ordinary uuid; ordinary_w uuid;
begin
  r := public.create_quick_session(c1, k1, 'c2000000-0000-4000-8000-000000000001', pg_temp.h('edit'), '2031-03-06', 'Edit me', null, pg_temp.body('Hollow hold'));
  a := (r ->> 'assignment_id')::uuid; w := (r ->> 'workout_id')::uuid;
  select id into ex from public.workout_exercises where workout_id = w and exercise_library_id is not null;

  -- Before any start: generic writers are allowed and fully applied.
  perform public.save_workout(w, c1, 'Edited before start', null, null, jsonb_build_array(
    jsonb_build_object('id', ex, 'exercise_library_id', 'b3000000-0000-4000-8000-000000000001', 'sets', '5', 'reps', '5')));
  perform public.save_workout_assignment_with_loads(a, k1, w, 'dated', '2031-03-06', 'Load notes',
    jsonb_build_array(jsonb_build_object('workout_exercise_id', ex, 'load_value', 155, 'load_unit', 'lb')));
  perform pg_temp.assert((select name = 'Edited before start' from public.workouts where id = w)
    and (select sets = '5' from public.workout_exercises where id = ex)
    and (select notes = 'Load notes' from public.workout_assignments where id = a)
    and (select count(*) = 1 from public.workout_assignment_exercise_loads where workout_assignment_id = a and not archived), 'A9 quick edits allowed before any start');
  perform pg_temp.assert((select create_request_hash = pg_temp.h('edit') from public.workout_assignments where id = a), 'A9 receipt fingerprint is not recalculated after an allowed edit');

  start := public.start_workout_log_v2(k1, null, null, a, 'coach', c1, null);
  log_id := (start ->> 'workout_log_id')::uuid;
  perform pg_temp.assert(start ->> 'outcome' = 'started', 'A6 coach start of a quick session uses the existing start core');
  perform pg_temp.assert((select prescribed_sets = '5' and prescribed_load_value = 155 from public.workout_log_exercises where workout_log_id = log_id and source_workout_exercise_id = ex), 'start snapshots the edited prescription and assignment load');
  perform pg_temp.assert(public.start_workout_log_v2(k1, null, null, a, 'coach', c1, null) = jsonb_build_object('outcome', 'resumed', 'workout_log_id', log_id), 'A6 lost-start retry resumes the same active log');

  select string_agg(id::text || sets || coalesce(reps, ''), ',' order by id) into before_rows from public.workout_exercises where workout_id = w;
  select string_agg(id::text || load_value || archived, ',' order by id) into before_loads from public.workout_assignment_exercise_loads where workout_assignment_id = a;
  begin
    perform public.save_workout(w, c1, 'After start', null, null, '[{"custom_name":"Nope"}]');
    raise exception 'started edit accepted';
  exception when raise_exception then if sqlerrm <> 'quick_session_started' then raise; end if; end;
  begin
    perform public.save_workout_assignment_with_loads(a, k1, w, 'dated', '2031-03-06', 'After start', '[]');
    raise exception 'started load edit accepted';
  exception when raise_exception then if sqlerrm <> 'quick_session_started' then raise; end if; end;
  perform pg_temp.assert((select name = 'Edited before start' from public.workouts where id = w)
    and (select string_agg(id::text || sets || coalesce(reps, ''), ',' order by id) = before_rows from public.workout_exercises where workout_id = w)
    and (select string_agg(id::text || load_value || archived, ',' order by id) = before_loads from public.workout_assignment_exercise_loads where workout_assignment_id = a)
    and (select notes = 'Load notes' from public.workout_assignments where id = a), 'A9 begun quick session rejects generic and load edits with no partial change');

  -- Abandon and archive never restore pre-start editing rights.
  update public.workout_logs set status = 'abandoned' where id = log_id;
  begin perform public.save_workout(w, c1, 'After abandon', null, null, '[{"custom_name":"Nope"}]'); raise exception 'abandoned edit accepted';
  exception when raise_exception then if sqlerrm <> 'quick_session_started' then raise; end if; end;
  update public.workout_logs set archived = true where id = log_id;
  begin perform public.save_workout_assignment_with_loads(a, k1, w, 'dated', '2031-03-06', 'x', '[]'); raise exception 'archived-log edit accepted';
  exception when raise_exception then if sqlerrm <> 'quick_session_started' then raise; end if; end;
  start := public.start_workout_log_v2(k1, null, null, a, 'client', null, null);
  perform pg_temp.assert(start ->> 'outcome' = 'started' and (start ->> 'workout_log_id')::uuid <> log_id, 'abandon permits another start under existing rules');
  update public.workout_logs set status = 'completed', completed_at = now() where id = (start ->> 'workout_log_id')::uuid;
  perform pg_temp.assert(public.start_workout_log_v2(k1, null, null, a, 'client', null, null) ->> 'outcome' = 'already_completed', 'A6 completed dated quick source refuses another start');

  -- A different active log conflicts (existing rule).
  r := public.create_quick_session(c1, k2, 'c2000000-0000-4000-8000-000000000002', pg_temp.h('edit2'), '2031-03-06', 'Second', null, pg_temp.body('Bird dog'));
  perform public.start_workout_log_v2(k2, null, null, (r ->> 'assignment_id')::uuid, 'client', null, null);
  tmpl := public.save_workout(null, c1, 'Ordinary', null, null, '[{"custom_name":"Row","sets":"3"}]');
  ordinary := public.assign_workout_clone(tmpl, k2, 'active', null, null, '[]');
  perform pg_temp.assert(public.start_workout_log_v2(k2, null, null, ordinary, 'client', null, null) ->> 'outcome' = 'conflict', 'A6 a different active log conflicts');

  -- Ordinary private copies keep editing after a start (baseline behavior).
  select workout_id into ordinary_w from public.workout_assignments where id = ordinary;
  update public.workout_logs set status = 'abandoned' where client_id = k2 and status = 'active';
  perform public.start_workout_log_v2(k2, null, null, ordinary, 'client', null, null);
  -- (Write and read in separate statements: one statement's snapshot cannot see its own call's writes.)
  perform pg_temp.assert(public.save_workout(ordinary_w, c1, 'Ordinary edited', null, null, '[{"custom_name":"Row","sets":"4"}]') = ordinary_w, 'A9 ordinary private copy save returns its id after a start');
  perform pg_temp.assert((select name = 'Ordinary edited' from public.workouts where id = ordinary_w)
    and (select sets = '4' from public.workout_exercises where workout_id = ordinary_w and not archived), 'A9 ordinary private copy edits are unchanged after a start');
  perform pg_temp.assert(public.save_workout_assignment_with_loads(ordinary, k2, ordinary_w, 'active', null, 'ordinary notes', '[]') = ordinary, 'A9 ordinary assignment-load edits unchanged after a start');
  perform pg_temp.assert(public.save_workout(tmpl, c1, 'Ordinary template v2', null, null, '[{"custom_name":"Row"}]') = tmpl, 'A9 template edits unchanged');
end $$;
