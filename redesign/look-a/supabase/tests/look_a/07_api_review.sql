-- API review findings (LOOK-A-API-REVIEW.md): current Undo uses the same
-- rule as Undo itself; set-v3 events are bound to what they asked for; one
-- event id names one change across kinds; exercise done keeps the baseline
-- open-disagreement policy; Home Quick Complete keeps its untouched guard and
-- replays before any start runs again.
do $$
declare
  log constant uuid := '00000000-0000-4000-8000-0000000000a1';
  client constant uuid := '00000000-0000-4000-8000-000000000014';
  coach constant uuid := '00000000-0000-4000-8000-000000000001';
  squat constant uuid := '00000000-0000-4000-8000-0000000a0001';
  press constant uuid := '00000000-0000-4000-8000-0000000a0004';
  s3 constant uuid := '00000000-0000-4000-8000-0000000b0003';
  p1 constant uuid := '00000000-0000-4000-8000-0000000b0031';
  auth_id constant uuid := '00000000-0000-4000-8000-0000000000f4';
  r jsonb; u jsonb; failed boolean; msg text; started uuid; n integer;
begin
  -- 1. Set-v3 binding. Same id, different values or actor: refused before any write.
  r := public.apply_workout_set_event_v3(s3, '00000000-0000-4000-8000-0000000c7001', 'client', null, 0, 1, false, 0,
    '{"status":"completed","actual_reps":6}', 'entered');
  assert r->>'outcome' = 'applied', format('first %s', r);
  failed := false;
  begin perform public.apply_workout_set_event_v3(s3, '00000000-0000-4000-8000-0000000c7001', 'client', null, 0, 1, false, 0,
    '{"status":"completed","actual_reps":9}', 'entered');
  exception when others then failed := true; msg := sqlerrm; end;
  assert failed and msg = 'event_id_reused', format('different values refused %s', msg);
  failed := false;
  begin perform public.apply_workout_set_event_v3(s3, '00000000-0000-4000-8000-0000000c7001', 'coach', coach, 0, 1, false, 0,
    '{"status":"completed","actual_reps":6}', 'entered');
  exception when others then failed := true; msg := sqlerrm; end;
  assert failed and msg = 'event_id_reused', format('different actor refused %s', msg);
  failed := false;
  begin perform public.apply_workout_set_event_v3(s3, '00000000-0000-4000-8000-0000000c7001', 'client', null, 0, 1, false, 0,
    '{"status":"completed","actual_reps":6}', 'prefill');
  exception when others then failed := true; msg := sqlerrm; end;
  assert failed and msg = 'event_id_reused', format('different origin refused %s', msg);
  -- Transport details (offline flag, local sequence) are not identity: replays.
  r := public.apply_workout_set_event_v3(s3, '00000000-0000-4000-8000-0000000c7001', 'client', null, 0, 7, true, 0,
    '{"status":"completed","actual_reps":6}', 'entered');
  assert r->>'outcome' = 'replayed', format('transport retry replays %s', r);
  assert (select actual_reps from public.workout_log_sets where id = s3) = 6, 'refusals wrote nothing';
  -- An event written by the older function keeps its old replay through v3.
  r := public.apply_workout_set_event_v2('00000000-0000-4000-8000-0000000b0004', '00000000-0000-4000-8000-0000000c7002', 'client', null, null, 2, false, 0,
    '{"actual_reps":5}', 'entered');
  r := public.apply_workout_set_event_v3('00000000-0000-4000-8000-0000000b0004', '00000000-0000-4000-8000-0000000c7002', 'client', null, null, 2, false, 0,
    '{"actual_reps":5}', 'entered');
  assert r->>'outcome' = 'replayed', format('legacy event replays %s', r);

  -- 2. Cross-kind reuse: refused as event_id_reused before mutation, never a key violation.
  r := public.mark_workout_exercise_not_set_tracked(log, press, '00000000-0000-4000-8000-0000000c7010', 'client', null);
  assert r->>'outcome' = 'applied', format('press done %s', r);
  failed := false;
  begin perform public.apply_workout_set_event_v3(p1, '00000000-0000-4000-8000-0000000c7010', 'client', null, 0, 3, false, 0,
    '{"status":"completed","actual_reps":5}', 'entered');
  exception when others then failed := true; msg := sqlerrm; end;
  assert failed and msg = 'event_id_reused', format('done id reused for a set %s', msg);
  assert (select status from public.workout_log_sets where id = p1) = 'pending', 'set untouched';
  failed := false;
  begin perform public.mark_workout_exercise_not_set_tracked(log, squat, '00000000-0000-4000-8000-0000000c7001', 'client', null);
  exception when others then failed := true; msg := sqlerrm; end;
  assert failed and msg = 'event_id_reused', format('set id reused for exercise done %s', msg);
  failed := false;
  begin perform public.finish_workout_log_v3(log, client, '00000000-0000-4000-8000-0000000c7002', 'client', null, 'finish', '', '', null);
  exception when others then failed := true; msg := sqlerrm; end;
  assert failed and msg = 'event_id_reused', format('no-op set id reused for finish %s', msg);
  u := public.undo_workout_material_change(log, '00000000-0000-4000-8000-0000000c7010', '00000000-0000-4000-8000-0000000c7011', 'client', null);
  assert u->>'outcome' = 'applied', format('undo press done %s', u);

  -- 3. Exercise done and skip keep the baseline policy: an open disagreement blocks them.
  insert into public.workout_set_conflicts(workout_log_id, workout_log_set_id, client_id, kept_value, incoming_value, incoming_actor_role, incoming_event_id)
    values (log, p1, client, '{}', '{"actual_reps":3}', 'coach', '00000000-0000-4000-8000-0000000c7020');
  r := public.mark_workout_exercise_not_set_tracked(log, press, '00000000-0000-4000-8000-0000000c7021', 'client', null);
  assert r->>'outcome' = 'refused' and r->>'reason' like 'A set here has a disagreement%', format('conflict blocks done %s', r);
  r := public.skip_workout_exercise_sets(log, press, '00000000-0000-4000-8000-0000000c7022', 'client', null,
    (select jsonb_agg(jsonb_build_object('id', id, 'revision', revision)) from public.workout_log_sets where workout_log_exercise_id = press and status = 'pending'));
  assert r->>'outcome' = 'refused' and r->>'reason' like 'A set here has a disagreement%', format('conflict blocks skip %s', r);
  assert not (select not_set_tracked from public.workout_log_exercises where id = press), 'nothing written';
  update public.workout_set_conflicts set status = 'resolved' where incoming_event_id = '00000000-0000-4000-8000-0000000c7020';

  -- 4. Current Undo of a Finish follows every dependency Undo checks.
  r := public.finish_workout_log_v3(log, client, '00000000-0000-4000-8000-0000000c7030', 'client', null, 'finish', '', '', null);
  assert r->>'outcome' = 'applied', format('finish %s', r);
  assert (public.workout_current_undo(log, 'client', null)->>'change_id')::uuid = '00000000-0000-4000-8000-0000000c7030', 'offered after finish';
  assert public.workout_current_undo(log, 'coach', coach) is null, 'never offered to another actor';
  insert into public.workout_coach_responses(workout_log_id, client_id, author_coach_id, author_name_snapshot, content)
    values (log, client, coach, 'Fictional Repair Coach', 'Fictional reply');
  assert public.workout_current_undo(log, 'client', null) is null, 'coach response: not offered';
  r := public.finish_workout_log_v3(log, client, '00000000-0000-4000-8000-0000000c7030', 'client', null, 'finish', '', '', null);
  assert r->>'outcome' = 'replayed' and not (r->>'undoable')::boolean, format('replay reports the same rule %s', r);
  update public.workout_coach_responses set archived = true where workout_log_id = log;
  assert public.workout_current_undo(log, 'client', null) is not null, 'offered again once the reply is withdrawn';
  insert into public.workout_logs(id, client_id, coach_id, source_workout_id, workout_assignment_id, workout_name, status) values
    ('00000000-0000-4000-8000-0000000000a3', client, coach, '00000000-0000-4000-8000-000000000005',
     '00000000-0000-4000-8000-00000000000c', 'Fictional Next', 'active');
  assert public.workout_current_undo(log, 'client', null) is null, 'another active workout: not offered';
  u := public.undo_workout_material_change(log, '00000000-0000-4000-8000-0000000c7030', '00000000-0000-4000-8000-0000000c7031', 'client', null);
  assert u->>'outcome' = 'refused' and u->>'reason' like 'Another workout%', format('and Undo agrees %s', u);
  delete from public.workout_logs where id = '00000000-0000-4000-8000-0000000000a3';

  -- 5. Home guard (finish mode home_quick): any recorded data refuses, even a
  -- value typed into a still-pending set; the workout stays active.
  u := public.undo_workout_material_change(log, '00000000-0000-4000-8000-0000000c7030', '00000000-0000-4000-8000-0000000c7032', 'client', null);
  assert u->>'outcome' = 'applied', format('reopen %s', u);
  r := public.finish_workout_log_v3(log, client, '00000000-0000-4000-8000-0000000c7040', 'client', null, 'home_quick', '', '', null);
  assert r->>'outcome' = 'refused' and r->>'reason' = 'logged_changes', format('logged workout refused %s', r);
  assert (select status from public.workout_logs where id = log) = 'active', 'stays active';

  -- 6. Home Quick Complete in one transaction.
  insert into auth.users(id, email) values (auth_id, 'looka@example.invalid');
  update public.clients set auth_user_id = auth_id where id = client;
  -- With another workout active, nothing starts and nothing is recorded.
  r := public.quick_complete_workout_v3(client, '00000000-0000-4000-8000-0000000c7050', null, null, '00000000-0000-4000-8000-00000000000c', auth_id, null);
  assert r->>'outcome' = 'not_started', format('other active %s', r);
  assert not exists (select 1 from public.workout_material_changes where id = '00000000-0000-4000-8000-0000000c7050'), 'nothing recorded';
  update public.workout_logs set status = 'abandoned' where id = log;
  select count(*) into n from public.workout_logs where client_id = client;
  r := public.quick_complete_workout_v3(client, '00000000-0000-4000-8000-0000000c7051', null, null, '00000000-0000-4000-8000-00000000000c', auth_id, null);
  assert r->>'outcome' = 'applied' and r->>'start_outcome' = 'started' and (r->>'quick_completed')::boolean and (r->>'notified')::boolean, format('home quick %s', r);
  started := (r->>'workout_log_id')::uuid;
  assert (select status = 'completed' and quick_completed and not_set_tracked from public.workout_logs where id = started), 'done, not set-tracked';
  assert not exists (select 1 from public.workout_log_sets s join public.workout_log_exercises e on e.id = s.workout_log_exercise_id
    where e.workout_log_id = started and (s.status <> 'pending' or s.updated_at <> s.created_at)), 'no set written';
  -- Retry with the same id: replays the first answer; no second start, no notice.
  r := public.quick_complete_workout_v3(client, '00000000-0000-4000-8000-0000000c7051', null, null, '00000000-0000-4000-8000-00000000000c', auth_id, null);
  assert r->>'outcome' = 'replayed' and r->>'original_outcome' = 'applied' and (r->>'workout_log_id')::uuid = started and not (r->>'notified')::boolean, format('replay %s', r);
  assert (select count(*) from public.workout_logs where client_id = client) = n + 1, 'one start only';
  -- The same id for another workout is refused before any start.
  failed := false;
  begin perform public.quick_complete_workout_v3(client, '00000000-0000-4000-8000-0000000c7051', null, null, '00000000-0000-4000-8000-00000000000b', auth_id, null);
  exception when others then failed := true; msg := sqlerrm; end;
  assert failed and msg = 'event_id_reused', format('other target refused %s', msg);
  assert (select count(*) from public.workout_logs where client_id = client) = n + 1, 'still one start';
  -- An id used for a tracker change is refused too.
  failed := false;
  begin perform public.quick_complete_workout_v3(client, '00000000-0000-4000-8000-0000000c7030', null, null, '00000000-0000-4000-8000-00000000000b', auth_id, null);
  exception when others then failed := true; msg := sqlerrm; end;
  assert failed and msg = 'event_id_reused', format('tracker id refused %s', msg);
end $$;
