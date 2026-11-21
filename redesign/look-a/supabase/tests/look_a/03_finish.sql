-- Finish: with nothing logged the workout is done, not set-tracked and NO set
-- row changes; with logged sets, the existing finish rule applies except to an
-- exercise marked done, not set-tracked. Notification created once; Undo
-- reopens exactly; re-finish never notifies again; dependent records and a
-- second active workout block the reopen; direct edits stay refused.
do $$
declare
  log constant uuid := '00000000-0000-4000-8000-0000000000a1';
  client constant uuid := '00000000-0000-4000-8000-000000000014';
  squat constant uuid := '00000000-0000-4000-8000-0000000a0001';
  press constant uuid := '00000000-0000-4000-8000-0000000a0004';
  all_sets uuid[]; untracked uuid[]; others uuid[];
  r jsonb; u jsonb; failed boolean; msg text; n integer;
begin
  select array_agg(id) into all_sets from look_a_rows;
  -- Make the fixture "nothing logged": revert the two completed sets to pending.
  update public.workout_log_sets set status = 'pending', completed_at = null, actual_reps = null
    where id in ('00000000-0000-4000-8000-0000000b0001', '00000000-0000-4000-8000-0000000b0011');
  update public.workout_log_sets set actual_duration_value = null, actual_duration_unit = null where id = '00000000-0000-4000-8000-0000000b0011';
  delete from look_a_rows;
  insert into look_a_rows select s.id, to_jsonb(s) from public.workout_log_sets s join public.workout_log_exercises e on e.id = s.workout_log_exercise_id where e.workout_log_id = log;

  -- Normal Finish keeps its rule: nothing logged is refused, nothing written.
  r := public.finish_workout_log_v3(log, client, '00000000-0000-4000-8000-0000000e0000', 'client', null, 'finish', '', '', null);
  assert r->>'outcome' = 'refused' and r->>'reason' = 'complete_at_least_one_set', format('normal finish needs a set %s', r);
  assert pg_temp.look_a_sets_unchanged(all_sets) and (select status from public.workout_logs where id = log) = 'active', 'refused finish wrote nothing';
  r := public.finish_workout_log_v3(log, client, '00000000-0000-4000-8000-0000000e0001', 'client', null, 'not_set_tracked', '', '', null);
  assert r->>'outcome' = 'applied' and (r->>'quick_completed')::boolean and (r->>'not_set_tracked')::boolean and (r->>'notified')::boolean, format('quick finish %s', r);
  assert pg_temp.look_a_sets_unchanged(all_sets), 'quick finish leaves every set row exactly as it was';
  assert (select status = 'completed' and quick_completed and not_set_tracked and not_set_tracked_change_id = '00000000-0000-4000-8000-0000000e0001'
          from public.workout_logs where id = log), 'log done, not set-tracked';
  select count(*) into n from public.notifications where workout_log_id = log and event_type = 'workout_completed';
  assert n >= 1, 'notification created';
  -- Replay: same answer, never "notified" again.
  r := public.finish_workout_log_v3(log, client, '00000000-0000-4000-8000-0000000e0001', 'client', null, 'not_set_tracked', '', '', null);
  assert r->>'outcome' = 'replayed' and not (r->>'notified')::boolean, format('replay %s', r);
  -- Direct edits of the finished workout stay refused.
  failed := false;
  begin update public.workout_logs set status = 'active' where id = log;
  exception when others then failed := true; msg := sqlerrm; end;
  assert failed and msg = 'Completed workout logs are immutable', format('immutable %s', msg);

  -- Undo reopens it exactly.
  u := public.undo_workout_material_change(log, '00000000-0000-4000-8000-0000000e0001', '00000000-0000-4000-8000-0000000e0011', 'client', null);
  assert u->>'outcome' = 'applied' and (u->>'reopened')::boolean, format('undo finish %s', u);
  assert (select status = 'active' and not quick_completed and not not_set_tracked and not_set_tracked_at is null and completed_at is null
          from public.workout_logs where id = log), 'reopened';
  assert pg_temp.look_a_sets_unchanged(all_sets), 'sets unchanged through reopen';
  assert current_setting('cvf.workout_reopen', true) = '', 'reopen flag cleared';
  -- Re-finish: the coach is not notified a second time.
  r := public.finish_workout_log_v3(log, client, '00000000-0000-4000-8000-0000000e0002', 'client', null, 'not_set_tracked', '', '', null);
  assert r->>'outcome' = 'applied' and not (r->>'notified')::boolean, format('re-finish %s', r);
  assert (select count(*) from public.notifications where workout_log_id = log and event_type = 'workout_completed') = n, 'no duplicate notification';
  -- A finish of a finished workout is refused, not re-applied.
  r := public.finish_workout_log_v3(log, client, '00000000-0000-4000-8000-0000000e0003', 'client', null, 'not_set_tracked', '', '', null);
  assert r->>'outcome' = 'refused' and r->>'reason' = 'already_completed', format('second finish %s', r);

  -- A coach response blocks the reopen.
  insert into public.workout_coach_responses(workout_log_id, client_id, author_coach_id, author_name_snapshot, content)
    values (log, client, '00000000-0000-4000-8000-000000000001', 'Fictional Repair Coach', 'Fictional reply');
  u := public.undo_workout_material_change(log, '00000000-0000-4000-8000-0000000e0002', '00000000-0000-4000-8000-0000000e0012', 'client', null);
  assert u->>'outcome' = 'refused' and u->>'reason' like 'Your coach already responded%', format('coach response %s', u);
  update public.workout_coach_responses set archived = true where workout_log_id = log;
  -- Another active workout blocks the reopen (one active workout per client).
  insert into public.workout_logs(id, client_id, coach_id, source_workout_id, workout_assignment_id, workout_name, status) values
    ('00000000-0000-4000-8000-0000000000a2', client, '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000005',
     '00000000-0000-4000-8000-00000000000c', 'Fictional Next', 'active');
  u := public.undo_workout_material_change(log, '00000000-0000-4000-8000-0000000e0002', '00000000-0000-4000-8000-0000000e0013', 'client', null);
  assert u->>'outcome' = 'refused' and u->>'reason' like 'Another workout%', format('other active %s', u);
  update public.workout_logs set archived = true where id = '00000000-0000-4000-8000-0000000000a2';
  u := public.undo_workout_material_change(log, '00000000-0000-4000-8000-0000000e0002', '00000000-0000-4000-8000-0000000e0014', 'client', null);
  assert u->>'outcome' = 'applied', format('reopen after blockers clear %s', u);

  -- Partial log: one set logged, Squat marked done, not set-tracked.
  perform public.apply_workout_set_event_v3('00000000-0000-4000-8000-0000000b0031', '00000000-0000-4000-8000-0000000e0020', 'client', null, 0, 1, false, 0,
    '{"status":"completed","actual_reps":8,"actual_load_value":40,"actual_load_unit":"kg"}', 'entered');
  perform public.mark_workout_exercise_not_set_tracked(log, squat, '00000000-0000-4000-8000-0000000e0021', 'client', null);
  select array_agg(s.id) into untracked from public.workout_log_sets s where s.workout_log_exercise_id = squat;
  delete from look_a_rows;
  insert into look_a_rows select s.id, to_jsonb(s) from public.workout_log_sets s join public.workout_log_exercises e on e.id = s.workout_log_exercise_id where e.workout_log_id = log;
  select array_agg(s.id) into others from public.workout_log_sets s join public.workout_log_exercises e on e.id = s.workout_log_exercise_id
    where e.workout_log_id = log and e.id <> squat and s.status = 'pending';
  r := public.finish_workout_log_v3(log, client, '00000000-0000-4000-8000-0000000e0022', 'client', null, 'finish', 'fictional note', '', null);
  assert r->>'outcome' = 'applied' and not (r->>'quick_completed')::boolean and (r->>'skipped')::integer = array_length(others, 1), format('finish %s', r);
  assert pg_temp.look_a_sets_unchanged(untracked), 'done, not set-tracked exercise untouched by finish';
  assert (select bool_and(status = 'skipped') from public.workout_log_sets where id = any(others)), 'other pending sets skipped (existing rule)';
  assert (select bool_and(s.value_origin = (r2.row->>'value_origin')) from public.workout_log_sets s join look_a_rows r2 on r2.id = s.id where s.id = any(others)), 'skip keeps origin';
  u := public.undo_workout_material_change(log, '00000000-0000-4000-8000-0000000e0022', '00000000-0000-4000-8000-0000000e0023', 'client', null);
  assert u->>'outcome' = 'applied', format('undo partial finish %s', u);
  assert (select bool_and(s.status = 'pending' and s.value_origin = (r2.row->>'value_origin') and s.actual_load_value is not distinct from (r2.row->>'actual_load_value')::numeric)
          from public.workout_log_sets s join look_a_rows r2 on r2.id = s.id where s.id = any(others)), 'skipped sets restored to pending exactly';
  assert (select notes is null from public.workout_logs where id = log), 'notes restored';
  assert pg_temp.look_a_sets_unchanged(untracked), 'untracked still untouched';

  -- Whole workout done, not set-tracked, on a PARTIALLY logged workout: a
  -- distinct operation from Finish. Every set row stays exactly as it is
  -- (the logged set, the flagged exercise, every pending set).
  select array_agg(s.id) into all_sets from public.workout_log_sets s join public.workout_log_exercises e on e.id = s.workout_log_exercise_id where e.workout_log_id = log;
  delete from look_a_rows;
  insert into look_a_rows select s.id, to_jsonb(s) from public.workout_log_sets s where s.id = any(all_sets);
  assert (select count(*) from public.workout_log_sets where id = any(all_sets) and status = 'completed') >= 1, 'partially logged';
  r := public.finish_workout_log_v3(log, client, '00000000-0000-4000-8000-0000000e0024', 'client', null, 'not_set_tracked', '', '', null);
  assert r->>'outcome' = 'applied' and (r->>'not_set_tracked')::boolean and not (r->>'quick_completed')::boolean and (r->>'skipped')::integer = 0, format('partial flag-only %s', r);
  assert pg_temp.look_a_sets_unchanged(all_sets), 'partial whole-workout completion writes no set';
  assert (select status = 'completed' and not_set_tracked and not quick_completed from public.workout_logs where id = log), 'flag only';
  -- Request identity: the same event id with a different requested time or mode is a different change.
  failed := false;
  begin perform public.finish_workout_log_v3(log, client, '00000000-0000-4000-8000-0000000e0024', 'client', null, 'not_set_tracked', '', '', now() - interval '5 minutes');
  exception when others then failed := true; msg := sqlerrm; end;
  assert failed and msg = 'event_id_reused', format('completed_at bound %s', msg);
  failed := false;
  begin perform public.finish_workout_log_v3(log, client, '00000000-0000-4000-8000-0000000e0024', 'client', null, 'finish', '', '', null);
  exception when others then failed := true; msg := sqlerrm; end;
  assert failed and msg = 'event_id_reused', format('mode bound %s', msg);
  r := public.finish_workout_log_v3(log, client, '00000000-0000-4000-8000-0000000e0024', 'client', null, 'not_set_tracked', '', '', null);
  assert r->>'outcome' = 'replayed', format('exact retry replays %s', r);
  u := public.undo_workout_material_change(log, '00000000-0000-4000-8000-0000000e0024', '00000000-0000-4000-8000-0000000e0025', 'client', null);
  assert u->>'outcome' = 'applied', format('undo partial flag-only %s', u);
  assert pg_temp.look_a_sets_unchanged(all_sets), 'sets unchanged through Undo';
  assert (select status = 'active' and not not_set_tracked from public.workout_logs where id = log), 'reopened, flag cleared';
end $$;
