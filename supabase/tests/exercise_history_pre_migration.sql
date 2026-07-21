\set ON_ERROR_STOP on

insert into public.coaches (id, name, email)
values ('10000000-0000-4000-8000-000000000001', 'History Coach', 'history-coach@example.test');
insert into public.clients (id, coach_id, name)
values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'History Client');
insert into public.exercise_library (id, name)
values ('30000000-0000-4000-8000-000000000001', 'Snapshot Squat');
insert into public.workouts (id, coach_id, name)
values ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'History Workout');
insert into public.workout_exercises (
  id, workout_id, exercise_library_id, sets, reps, target_rpe, default_load_value, default_load_unit
) values (
  '50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001', '1', '99 prescribed', '10 prescribed', 30, 'lb'
);
insert into public.workout_assignments (id, client_id, workout_id, assignment_mode)
values ('60000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'active');
insert into public.workout_logs (
  id, client_id, coach_id, workout_assignment_id, source_workout_id, workout_name, status
) values (
  '70000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001', 'Historical Name', 'active'
);
insert into public.workout_log_exercises (
  id, workout_log_id, source_workout_exercise_id, exercise_name, prescribed_reps, prescribed_rpe
) values (
  '80000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001', 'Historical Renamed Squat', '99 prescribed', '10 prescribed'
);
insert into public.workout_log_sets (
  id, workout_log_exercise_id, set_number, status, actual_load_value, actual_load_unit, completed_at
) values (
  '90000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000001',
  1, 'completed', 42.5, 'lb', '2026-07-01T12:00:00Z'
);
update public.workout_logs
set status = 'completed', completed_at = '2026-07-01T12:00:00Z'
where id = '70000000-0000-4000-8000-000000000001';
