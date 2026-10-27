-- A1/A2/A3 (sequential): receipts, replay, mismatch, masking, immutability, admission.
do $$
declare
  c1 uuid := 'b1000000-0000-4000-8000-000000000001';
  c2 uuid := 'b1000000-0000-4000-8000-000000000002';
  adm uuid := 'b1000000-0000-4000-8000-0000000000ad';
  k1 uuid := 'b2000000-0000-4000-8000-000000000001';
  k2 uuid := 'b2000000-0000-4000-8000-000000000002';
  k3 uuid := 'b2000000-0000-4000-8000-000000000003';
  squat uuid := 'b3000000-0000-4000-8000-000000000001';
  hidden_press uuid := 'b3000000-0000-4000-8000-000000000002';
  rq uuid := 'c0000000-0000-4000-8000-000000000001';
  r jsonb; r2 jsonb; a uuid; w uuid; templates_before int; n int;
begin
  select count(*) into templates_before from public.workouts where is_template and not archived;

  r := public.create_quick_session(c1, k1, rq, pg_temp.h('one'), '2031-03-04', 'Quick one', '  Notes  ', pg_temp.body('Plank'));
  a := (r ->> 'assignment_id')::uuid; w := (r ->> 'workout_id')::uuid;
  perform pg_temp.assert(r ->> 'state' = 'created', 'A1 new create returns created');
  perform pg_temp.assert((select kind = 'quick' and assignment_mode = 'dated' and assigned_for = '2031-03-04' and notes = 'Notes'
    and created_by_coach_id = c1 and create_request_id = rq and create_request_hash = pg_temp.h('one') and library_template_id is null
    and client_id = k1 and workout_id = w from public.workout_assignments where id = a), 'A1 quick dated receipt stored with authenticated actor');
  perform pg_temp.assert((select not is_template and client_id = k1 and coach_id = c1 and name = 'Quick one' and not hidden
    from public.workouts where id = w), 'A1 private client workout, no template');
  perform pg_temp.assert((select count(*) = 2 from public.workout_exercises where workout_id = w and not archived), 'A1 prescription rows written');
  perform pg_temp.assert((select tracking_type = 'duration' and duration_value = 45 and custom_name = 'Plank' and position = 1
    from public.workout_exercises where workout_id = w and exercise_library_id is null), 'A1 typed custom row written in position');
  perform pg_temp.assert((select count(*) = templates_before from public.workouts where is_template and not archived), 'A1 shared template library unchanged by create');

  r2 := public.create_quick_session(c1, k1, rq, pg_temp.h('one'), '2031-03-04', 'Quick one', 'Notes', pg_temp.body('Plank'));
  perform pg_temp.assert(r2 ->> 'state' = 'replayed' and (r2 ->> 'assignment_id')::uuid = a and (r2 ->> 'workout_id')::uuid = w, 'A1 same actor/request/hash replays the same assignment and workout');
  perform pg_temp.assert((select count(*) = 1 from public.workout_assignments where create_request_id = rq), 'A1 replay writes nothing');

  r2 := public.create_quick_session(c1, k1, rq, pg_temp.h('changed'), '2031-03-04', 'Quick one', 'Notes', pg_temp.body('Plank'));
  perform pg_temp.assert(r2 = jsonb_build_object('state', 'request_mismatch'), 'A1 different fingerprint mismatches with no assignment details');
  r2 := public.create_quick_session(c1, k2, rq, pg_temp.h('one'), '2031-03-04', 'Quick one', 'Notes', pg_temp.body('Plank'));
  perform pg_temp.assert(r2 = jsonb_build_object('state', 'request_mismatch'), 'A1 target client change mismatches while both clients are authorized');

  -- A2: other actors never recover the original receipt.
  r2 := public.create_quick_session(c2, k1, rq, pg_temp.h('one'), '2031-03-04', 'Quick one', 'Notes', pg_temp.body('Plank'));
  perform pg_temp.assert(r2 = jsonb_build_object('state', 'not_found'), 'A2 other coach for an inaccessible client is masked');
  r2 := public.create_quick_session(c2, k3, rq, pg_temp.h('one'), '2031-03-04', 'Theirs', null, pg_temp.body('Plank'));
  perform pg_temp.assert(r2 ->> 'state' = 'created' and (r2 ->> 'assignment_id')::uuid <> a, 'A2 the same request id under another actor is that actor''s own receipt');
  perform pg_temp.assert(public.get_quick_session_request(c2, rq) ->> 'assignment_id' = r2 ->> 'assignment_id'
    and public.get_quick_session_request(c1, rq) ->> 'assignment_id' = a::text, 'A2 status is scoped to the authenticated actor');
  r2 := public.create_quick_session(adm, k1, 'c0000000-0000-4000-8000-0000000000a1', pg_temp.h('admin'), '2031-03-04', 'Admin', null, pg_temp.body('Plank'));
  perform pg_temp.assert(r2 ->> 'state' = 'created', 'A2 admin may create for any active client');

  -- A2: null actor / retargeting / immutable receipt fields.
  begin
    perform public.create_quick_session(null, k1, 'c0000000-0000-4000-8000-0000000000b1', pg_temp.h('x'), '2031-03-04', 'x', null, pg_temp.body('Plank'));
    raise exception 'null actor accepted';
  exception when raise_exception then if sqlerrm = 'null actor accepted' then raise; end if; end;
  begin
    insert into public.workout_assignments (client_id, workout_id, assignment_mode, assigned_for, kind, create_request_id, create_request_hash)
    values (k1, w, 'dated', '2031-03-04', 'quick', 'c0000000-0000-4000-8000-0000000000b2', pg_temp.h('x'));
    raise exception 'quick row without actor accepted';
  exception when check_violation then null; end;
  begin update public.workout_assignments set client_id = k2 where id = a; raise exception 'retarget client accepted';
  exception when check_violation then null; end;
  begin update public.workout_assignments set workout_id = (select id from public.workouts where id <> w order by created_at limit 1) where id = a; raise exception 'retarget workout accepted';
  exception when check_violation then null; end;
  begin update public.workout_assignments set created_by_coach_id = c2 where id = a; raise exception 'actor change accepted';
  exception when check_violation then null; end;
  begin update public.workout_assignments set create_request_hash = pg_temp.h('other') where id = a; raise exception 'hash change accepted';
  exception when check_violation then null; end;
  begin update public.workout_assignments set kind = 'assigned' where id = a; raise exception 'kind change accepted';
  exception when check_violation then null; end;
  begin update public.workout_assignments set create_request_id = 'c0000000-0000-4000-8000-0000000000b3' where id = a; raise exception 'request change accepted';
  exception when check_violation then null; end;
  perform pg_temp.assert((select client_id = k1 and workout_id = w and created_by_coach_id = c1 from public.workout_assignments where id = a), 'A2 receipt identity unchanged after rejected updates');
  -- Ordinary assignments keep their existing update contract.
  update public.workout_assignments set notes = 'still editable' where id = a;

  -- A3: fresh hidden admission is rejected atomically; replay after hiding succeeds.
  begin
    perform public.create_quick_session(c1, k1, 'c0000000-0000-4000-8000-0000000000c1', pg_temp.h('hidden'), '2031-03-04', 'Hidden', null,
      jsonb_build_array(jsonb_build_object('exercise_library_id', hidden_press, 'sets', '3')));
    raise exception 'hidden admitted';
  exception when raise_exception then if sqlerrm not like 'Hidden exercises cannot be added: Quick Hidden Press%' then raise; end if; end;
  perform pg_temp.assert(not exists (select 1 from public.workout_assignments where create_request_id = 'c0000000-0000-4000-8000-0000000000c1')
    and not exists (select 1 from public.workouts where name = 'Hidden'), 'A3 rejected admission leaves no workout or receipt');
  update public.exercise_library set hidden = true where id = squat;
  r2 := public.create_quick_session(c1, k1, rq, pg_temp.h('one'), '2031-03-04', 'Quick one', 'Notes', pg_temp.body('Plank'));
  perform pg_temp.assert(r2 ->> 'state' = 'replayed', 'A3 replay after the library exercise was hidden succeeds without new admission');
  update public.exercise_library set hidden = false where id = squat;

  -- A2: masking after access loss; archived receipts are never recreated.
  update public.clients set coach_id = c2 where id = k1;
  r2 := public.create_quick_session(c1, k2, rq, pg_temp.h('one'), '2031-03-04', 'Quick one', 'Notes', pg_temp.body('Plank'));
  perform pg_temp.assert(r2 = jsonb_build_object('state', 'not_found'), 'A2 lost original access masks replay even when the new target is accessible');
  r2 := public.create_quick_session(c1, k2, rq, pg_temp.h('different'), '2031-03-04', 'Quick one', 'Notes', pg_temp.body('Plank'));
  perform pg_temp.assert(r2 = jsonb_build_object('state', 'not_found'), 'A2 lost original access masks mismatch too');
  perform pg_temp.assert(public.get_quick_session_request(c1, rq) = jsonb_build_object('state', 'not_found'), 'A2 lost original access masks status');
  perform pg_temp.assert(public.save_quick_session_to_library(c1, a) = jsonb_build_object('state', 'not_found'), 'A2 lost original access masks library save');
  update public.clients set coach_id = c1 where id = k1;
  perform pg_temp.assert(public.get_quick_session_request(c1, rq) ->> 'state' = 'committed', 'A2 restored access makes the receipt recoverable');

  update public.workout_assignments set archived = true where id = a;
  select count(*) into n from public.workout_assignments;
  r2 := public.create_quick_session(c1, k1, rq, pg_temp.h('one'), '2031-03-04', 'Quick one', 'Notes', pg_temp.body('Plank'));
  perform pg_temp.assert(r2 = jsonb_build_object('state', 'not_found') and (select count(*) = n from public.workout_assignments), 'A2 archived receipt is never replaced by a fresh create');
  perform pg_temp.assert(public.get_quick_session_request(c1, rq) = jsonb_build_object('state', 'not_found'), 'A2 archived receipt status is masked');
  update public.workout_assignments set archived = false where id = a;
  update public.workouts set archived = true where id = w;
  perform pg_temp.assert(public.create_quick_session(c1, k1, rq, pg_temp.h('one'), '2031-03-04', 'Quick one', 'Notes', pg_temp.body('Plank')) = jsonb_build_object('state', 'not_found'), 'A2 archived workout masks replay');
  update public.workouts set archived = false where id = w;
  update public.clients set archived = true where id = k1;
  perform pg_temp.assert(public.create_quick_session(c1, k1, rq, pg_temp.h('one'), '2031-03-04', 'Quick one', 'Notes', pg_temp.body('Plank')) = jsonb_build_object('state', 'not_found'), 'A2 archived client masks replay');
  update public.clients set archived = false where id = k1;
  update public.coaches set archived = true where id = c1;
  perform pg_temp.assert(public.create_quick_session(c1, k1, rq, pg_temp.h('one'), '2031-03-04', 'Quick one', 'Notes', pg_temp.body('Plank')) = jsonb_build_object('state', 'not_found'), 'A2 inactive actor masks replay');
  perform pg_temp.assert(public.get_quick_session_request(c1, rq) = jsonb_build_object('state', 'not_found'), 'A2 inactive actor masks status');
  update public.coaches set archived = false where id = c1;

  -- Shape guards inside the RPC (the route normalizes first).
  begin perform public.create_quick_session(c1, k1, 'c0000000-0000-4000-8000-0000000000d1', 'nothex', '2031-03-04', 'x', null, pg_temp.body('P')); raise exception 'bad hash accepted';
  exception when raise_exception then if sqlerrm = 'bad hash accepted' then raise; end if; end;
  begin perform public.create_quick_session(c1, k1, 'c0000000-0000-4000-8000-0000000000d2', pg_temp.h('e'), '2031-03-04', 'x', null, '[{"custom_name":""}]'); raise exception 'empty accepted';
  exception when raise_exception then if sqlerrm = 'empty accepted' then raise; end if; end;
  perform pg_temp.assert(not exists (select 1 from public.workout_assignments where create_request_id in ('c0000000-0000-4000-8000-0000000000d1', 'c0000000-0000-4000-8000-0000000000d2')), 'invalid creates roll back fully');
end $$;
