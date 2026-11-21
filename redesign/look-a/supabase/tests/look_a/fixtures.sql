-- Look A fixtures (fictional). Loaded after ../pr120_repairs/fixtures.sql
-- (coach ...0001, workout ...0005). Each 0*.sql file runs in its own
-- transaction with these rows and is rolled back.
insert into public.clients(id, coach_id, name, email) values
  ('00000000-0000-4000-8000-000000000014', '00000000-0000-4000-8000-000000000001', 'Fictional Look A Client', 'looka@example.invalid');
insert into public.workout_assignments(id, client_id, workout_id) values
  ('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-000000000014', '00000000-0000-4000-8000-000000000005'),
  ('00000000-0000-4000-8000-00000000000c', '00000000-0000-4000-8000-000000000014', '00000000-0000-4000-8000-000000000005');
insert into public.workout_logs(id, client_id, coach_id, source_workout_id, workout_assignment_id, workout_name, status, started_at) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000014', '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-00000000000b', 'Fictional Lower A', 'active', now() - interval '1 hour');
-- Squat (lb, partially logged: completed / skipped / pending prefill / pending prefill)
-- Plank (timed), Row (distance), Press (kg, nothing logged).
insert into public.workout_log_exercises(id, workout_log_id, exercise_library_id, exercise_name, position, tracking_type,
  prescribed_load_value, prescribed_load_unit, prescribed_duration_value, prescribed_duration_unit, prescribed_distance_value, prescribed_distance_unit) values
  ('00000000-0000-4000-8000-0000000a0001', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000051', 'Fictional Squat', 0, 'reps_weight', 170, 'lb', null, null, null, null),
  ('00000000-0000-4000-8000-0000000a0002', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000051', 'Fictional Plank', 1, 'duration', null, null, 40, 's', null, null),
  ('00000000-0000-4000-8000-0000000a0003', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000051', 'Fictional Row', 2, 'distance', null, null, null, null, 500, 'm'),
  ('00000000-0000-4000-8000-0000000a0004', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000051', 'Fictional Press', 3, 'reps_weight', 40, 'kg', null, null, null, null);
insert into public.workout_log_sets(id, workout_log_exercise_id, set_number, status, actual_reps, actual_load_value, actual_load_unit,
  actual_duration_value, actual_duration_unit, actual_distance_value, actual_distance_unit, completed_at) values
  ('00000000-0000-4000-8000-0000000b0001', '00000000-0000-4000-8000-0000000a0001', 1, 'completed', 5, 170, 'lb', null, null, null, null, now() - interval '50 minutes'),
  ('00000000-0000-4000-8000-0000000b0002', '00000000-0000-4000-8000-0000000a0001', 2, 'skipped', null, 170, 'lb', null, null, null, null, null),
  ('00000000-0000-4000-8000-0000000b0003', '00000000-0000-4000-8000-0000000a0001', 3, 'pending', null, 170, 'lb', null, null, null, null, null),
  ('00000000-0000-4000-8000-0000000b0004', '00000000-0000-4000-8000-0000000a0001', 4, 'pending', 4, 175, 'lb', null, null, null, null, null),
  ('00000000-0000-4000-8000-0000000b0011', '00000000-0000-4000-8000-0000000a0002', 1, 'completed', null, null, null, 40, 's', null, null, now() - interval '40 minutes'),
  ('00000000-0000-4000-8000-0000000b0012', '00000000-0000-4000-8000-0000000a0002', 2, 'pending', null, null, null, null, null, null, null, null),
  ('00000000-0000-4000-8000-0000000b0021', '00000000-0000-4000-8000-0000000a0003', 1, 'pending', null, null, null, null, null, 450, 'm', null),
  ('00000000-0000-4000-8000-0000000b0031', '00000000-0000-4000-8000-0000000a0004', 1, 'pending', null, 40, 'kg', null, null, null, null, null),
  ('00000000-0000-4000-8000-0000000b0032', '00000000-0000-4000-8000-0000000a0004', 2, 'pending', null, 40, 'kg', null, null, null, null, null);
-- Exact full rows of every set of the fixture log, for deep-equality checks.
create temporary table look_a_rows on commit drop as
  select s.id, to_jsonb(s) as row from public.workout_log_sets s
  join public.workout_log_exercises e on e.id = s.workout_log_exercise_id where e.workout_log_id = '00000000-0000-4000-8000-0000000000a1';
create function pg_temp.look_a_sets_unchanged(p_ids uuid[]) returns boolean language sql as $$
  select coalesce(bool_and(to_jsonb(s) = r.row), true) from look_a_rows r join public.workout_log_sets s on s.id = r.id where r.id = any(p_ids);
$$;
