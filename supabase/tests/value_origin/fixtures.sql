-- Set value origin fixtures (fictional). Loaded after ../pr120_repairs/fixtures.sql
-- (coach ...0001, clients ...0011/...0012, active log ...0021). Each 0*.sql file
-- runs inside its own transaction with these rows and is rolled back.
-- Prefill exercise: prescribed 50 lb, five untouched pending sets holding the prefill.
insert into public.workout_log_exercises(id, workout_log_id, exercise_library_id, exercise_name, position, prescribed_load_value, prescribed_load_unit) values
  ('00000000-0000-4000-8000-0000000e0001', '00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000051', 'Prefill Press', 9, 50, 'lb');
insert into public.workout_log_sets(id, workout_log_exercise_id, set_number, status, actual_load_value, actual_load_unit) values
  ('00000000-0000-4000-8000-0000000f0001', '00000000-0000-4000-8000-0000000e0001', 1, 'pending', 50, 'lb'),
  ('00000000-0000-4000-8000-0000000f0002', '00000000-0000-4000-8000-0000000e0001', 2, 'pending', 50, 'lb'),
  ('00000000-0000-4000-8000-0000000f0003', '00000000-0000-4000-8000-0000000e0001', 3, 'pending', 50, 'lb'),
  ('00000000-0000-4000-8000-0000000f0004', '00000000-0000-4000-8000-0000000e0001', 4, 'pending', 50, 'lb'),
  ('00000000-0000-4000-8000-0000000f0005', '00000000-0000-4000-8000-0000000e0001', 5, 'pending', 50, 'lb');
-- A third client whose log is finished with one set (immutability/ordering).
insert into public.clients(id, coach_id, name, email) values
  ('00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000001', 'Fictional Third Client', 'client3@example.invalid');
insert into public.workout_assignments(id, client_id, workout_id) values
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000005');
insert into public.workout_logs(id, client_id, coach_id, source_workout_id, workout_assignment_id, workout_name, status) values
  ('00000000-0000-4000-8000-000000000023', '00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-00000000000a', 'Fictional Done Day', 'active');
insert into public.workout_log_exercises(id, workout_log_id, exercise_library_id, exercise_name, position, prescribed_load_value, prescribed_load_unit) values
  ('00000000-0000-4000-8000-0000000e0002', '00000000-0000-4000-8000-000000000023', '00000000-0000-4000-8000-000000000051', 'Done Press', 0, 50, 'lb');
insert into public.workout_log_sets(id, workout_log_exercise_id, set_number, status, actual_load_value, actual_load_unit) values
  ('00000000-0000-4000-8000-0000000f0101', '00000000-0000-4000-8000-0000000e0002', 1, 'pending', 50, 'lb');
update public.workout_logs set status = 'completed', completed_at = now() where id = '00000000-0000-4000-8000-000000000023';
