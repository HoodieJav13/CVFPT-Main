-- A7 (SQL half): authoritative, non-paginated completion read.
do $$
declare
  c1 uuid := 'b1000000-0000-4000-8000-000000000001';
  k1 uuid := 'b2000000-0000-4000-8000-000000000001';
  k3 uuid := 'b2000000-0000-4000-8000-000000000003';
  q_none uuid; q_active uuid; q_abandoned uuid; q_tracked uuid; q_quick uuid; q_archived uuid; ordinary uuid; tmpl uuid;
  w uuid; logs_before int; assignments_before text; result jsonb;
begin
  q_none := (public.create_quick_session(c1, k1, 'c3000000-0000-4000-8000-000000000001', pg_temp.h('r1'), '2031-01-01', 'None', null, pg_temp.body('A')) ->> 'assignment_id')::uuid;
  q_active := (public.create_quick_session(c1, k1, 'c3000000-0000-4000-8000-000000000002', pg_temp.h('r2'), '2031-01-02', 'Active', null, pg_temp.body('B')) ->> 'assignment_id')::uuid;
  q_abandoned := (public.create_quick_session(c1, k1, 'c3000000-0000-4000-8000-000000000003', pg_temp.h('r3'), '2031-01-03', 'Abandoned', null, pg_temp.body('C')) ->> 'assignment_id')::uuid;
  q_tracked := (public.create_quick_session(c1, k1, 'c3000000-0000-4000-8000-000000000004', pg_temp.h('r4'), '2031-01-04', 'Tracked', null, pg_temp.body('D')) ->> 'assignment_id')::uuid;
  q_quick := (public.create_quick_session(c1, k1, 'c3000000-0000-4000-8000-000000000005', pg_temp.h('r5'), '2031-01-05', 'Quick done', null, pg_temp.body('E')) ->> 'assignment_id')::uuid;
  q_archived := (public.create_quick_session(c1, k1, 'c3000000-0000-4000-8000-000000000006', pg_temp.h('r6'), '2031-01-06', 'Archived log', null, pg_temp.body('F')) ->> 'assignment_id')::uuid;
  tmpl := public.save_workout(null, c1, 'Ordinary', null, null, '[{"custom_name":"Row"}]');
  ordinary := public.assign_workout_clone(tmpl, k1, 'active', null, null, '[]');

  perform public.start_workout_log_v2(k1, null, null, q_abandoned, 'client', null, null);
  update public.workout_logs set status = 'abandoned' where workout_assignment_id = q_abandoned;
  -- Tracked completion through the real RPCs.
  perform public.start_workout_log_v2(k1, null, null, q_tracked, 'client', null, null);
  perform public.complete_all_workout_sets_v2((select id from public.workout_logs where workout_assignment_id = q_tracked), k1, 'client', null);
  perform public.complete_workout_log_v2((select id from public.workout_logs where workout_assignment_id = q_tracked), k1, '', '', null);
  -- Untracked quick completion through the real RPC.
  perform public.start_workout_log_v2(k1, null, null, q_quick, 'client', null, null);
  perform public.quick_complete_workout_log_v2((select id from public.workout_logs where workout_assignment_id = q_quick), k1);
  perform pg_temp.assert((select quick_completed from public.workout_logs where workout_assignment_id = q_quick), 'fixture: quick-completed log is flagged quick_completed');
  -- A completed log that was archived (inserted directly; completed logs are immutable).
  select workout_id into w from public.workout_assignments where id = q_archived;
  insert into public.workout_logs (client_id, coach_id, workout_assignment_id, source_workout_id, workout_name, status, completed_at, archived)
  values (k1, c1, q_archived, w, 'Archived log', 'completed', '2030-12-31T12:00:00Z', true);
  -- More than a page of NEWER completed history (ordinary active repeats).
  select workout_id into w from public.workout_assignments where id = ordinary;
  insert into public.workout_logs (client_id, coach_id, workout_assignment_id, source_workout_id, workout_name, status, completed_at)
  select k1, c1, ordinary, w, 'Ordinary repeat ' || i, 'completed', '2031-02-01T00:00:00Z'::timestamptz + i * interval '1 minute'
  from generate_series(1, 60) i;
  perform public.start_workout_log_v2(k1, null, null, q_active, 'client', null, null);
  perform pg_temp.assert((select count(*) > 50 from public.workout_logs where client_id = k1 and status = 'completed' and not archived
    and completed_at > (select completed_at from public.workout_logs where workout_assignment_id = q_tracked)), 'A7 more than 50 newer completed logs exist');

  select count(*) into logs_before from public.workout_logs;
  select string_agg(id::text || archived, ',' order by id) into assignments_before from public.workout_assignments where client_id = k1;
  select jsonb_object_agg(assignment_id, completed) into result
  from public.get_quick_session_completion(k1, array[q_none, q_active, q_abandoned, q_tracked, q_quick, q_archived, ordinary, 'c3000000-0000-4000-8000-0000000000ff'::uuid]);
  perform pg_temp.assert(result = jsonb_build_object(q_none, false, q_active, false, q_abandoned, false, q_tracked, true, q_quick, true, q_archived, false),
    'A7 completion: tracked and quick-completed only; active/abandoned/archived logs do not count; ordinary and unknown ids omitted');
  perform pg_temp.assert(not exists (select 1 from public.get_quick_session_completion(
    'b2000000-0000-4000-8000-000000000003', array[q_tracked])), 'A7 another client''s assignment ids are never returned');
  perform pg_temp.assert((select count(*) = logs_before from public.workout_logs)
    and (select string_agg(id::text || archived, ',' order by id) = assignments_before from public.workout_assignments where client_id = k1), 'A7 the read archives or changes nothing');
  perform pg_temp.assert((select provolatile = 's' and not prosecdef and proconfig @> array['search_path=""']
    from pg_proc where oid = 'public.get_quick_session_completion(uuid,uuid[])'::regprocedure), 'A7 completion read is stable, invoker, empty search_path');
  -- A8 (SQL half): kind is immutable and stays readable for an archived source.
  update public.workout_assignments set archived = true where id = q_tracked;
  perform pg_temp.assert((select kind = 'quick' from public.workout_assignments where id = q_tracked)
    and (select kind = 'assigned' from public.workout_assignments where id = ordinary), 'A8 archived quick source keeps its kind for history labels');
end $$;
