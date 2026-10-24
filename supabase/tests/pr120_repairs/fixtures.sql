-- PR120 repair fixtures (fictional). Each 0*.sql file runs inside its own
-- transaction with these rows and is rolled back.
insert into public.coaches(id, name, email) values ('00000000-0000-4000-8000-000000000001', 'Fictional Repair Coach', 'coach@example.invalid');
insert into public.clients(id, coach_id, name, email) values
  ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001', 'Fictional Repair Client', 'client@example.invalid'),
  ('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000001', 'Fictional Second Client', 'client2@example.invalid');
insert into public.exercise_library(id, name, review_status) values
  ('00000000-0000-4000-8000-000000000051', 'Original', 'approved'),
  ('00000000-0000-4000-8000-000000000052', 'Replacement', 'approved');
-- One client-private workout, reused on program days 1 and 2.
insert into public.workouts(id, coach_id, name, is_template, client_id) values ('00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000001', 'Private Reused Workout', false, '00000000-0000-4000-8000-000000000011');
insert into public.workout_exercises(id, workout_id, exercise_library_id, sets, reps, position) values ('00000000-0000-4000-8000-000000000061', '00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000051', '2', '8', 0);
insert into public.programs(id, coach_id, name, frequency_days, is_template, client_id) values ('00000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000001', 'Private Program', 2, false, '00000000-0000-4000-8000-000000000011');
insert into public.program_assignments(id, program_id, client_id) values ('00000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000011');
insert into public.workout_assignments(id, client_id, workout_id) values
  ('00000000-0000-4000-8000-000000000008', '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000005'),
  ('00000000-0000-4000-8000-000000000009', '00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000005');
select public.save_program('00000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000001', false, 'Private Program', null, 2,
  '[{"day_number":1,"workout_id":"00000000-0000-4000-8000-000000000005"},{"day_number":2,"workout_id":"00000000-0000-4000-8000-000000000005"}]'::jsonb);
-- Active log with one original exercise per swap (one open swap per exercise).
insert into public.workout_logs(id, client_id, coach_id, source_workout_id, workout_assignment_id, workout_name, status) values
  ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000008', 'Fictional Day', 'active');
insert into public.workout_log_exercises(id, workout_log_id, exercise_library_id, exercise_name, position, source_workout_exercise_id) values
  ('00000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000051', 'Original', 0, '00000000-0000-4000-8000-000000000061'),
  ('00000000-0000-4000-8000-000000000033', '00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000051', 'Original B', 1, null),
  ('00000000-0000-4000-8000-000000000034', '00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000051', 'Original C', 2, null),
  ('00000000-0000-4000-8000-000000000036', '00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000051', 'Original D', 3, null);
insert into public.workout_log_substitutions(id, workout_log_id, client_id, original_log_exercise_id, original_exercise_library_id, original_name,
  replacement_log_exercise_id, replacement_exercise_library_id, replacement_name, source, trigger, targets, status, actor_role) values
  ('00000000-0000-4000-8000-000000000071', '00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-000000000051', 'Original',
   '00000000-0000-4000-8000-000000000041', '00000000-0000-4000-8000-000000000052', 'Replacement', 'catalog_suggestion', 'equipment_busy', '{"sets":2,"reps":"8"}', 'pending_confirmation', 'client'),
  ('00000000-0000-4000-8000-000000000072', '00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000033', '00000000-0000-4000-8000-000000000051', 'Original',
   '00000000-0000-4000-8000-000000000043', '00000000-0000-4000-8000-000000000052', 'Replacement', 'catalog_suggestion', 'equipment_busy', '{"sets":2,"reps":"8"}', 'pending_confirmation', 'client'),
  -- Targets that make activation fail mid-transaction (sets is not a number).
  ('00000000-0000-4000-8000-000000000074', '00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000034', '00000000-0000-4000-8000-000000000051', 'Original',
   '00000000-0000-4000-8000-000000000044', '00000000-0000-4000-8000-000000000052', 'Replacement', 'catalog_suggestion', 'equipment_busy', '{"sets":"x"}', 'pending_confirmation', 'client'),
  -- An already active swap, used for the program application.
  ('00000000-0000-4000-8000-000000000073', '00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000036', '00000000-0000-4000-8000-000000000051', 'Original',
   '00000000-0000-4000-8000-000000000046', '00000000-0000-4000-8000-000000000052', 'Replacement', 'catalog_suggestion', 'equipment_busy', '{"sets":2,"reps":"8"}', 'active', 'client');
-- A second client's finished log, with a pending swap (one active log per client).
insert into public.workout_logs(id, client_id, coach_id, source_workout_id, workout_assignment_id, workout_name, status) values
  ('00000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000009', 'Fictional Finished Day', 'active');
insert into public.workout_log_exercises(id, workout_log_id, exercise_library_id, exercise_name, position) values
  ('00000000-0000-4000-8000-000000000037', '00000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-000000000051', 'Original', 0);
insert into public.workout_log_substitutions(id, workout_log_id, client_id, original_log_exercise_id, original_exercise_library_id, original_name,
  replacement_log_exercise_id, replacement_exercise_library_id, replacement_name, source, trigger, targets, status, actor_role) values
  ('00000000-0000-4000-8000-000000000075', '00000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000037', '00000000-0000-4000-8000-000000000051', 'Original',
   '00000000-0000-4000-8000-000000000047', '00000000-0000-4000-8000-000000000052', 'Replacement', 'catalog_suggestion', 'equipment_busy', '{"sets":2,"reps":"8"}', 'pending_confirmation', 'client');
update public.workout_logs set status = 'completed', completed_at = now() where id = '00000000-0000-4000-8000-000000000022';
