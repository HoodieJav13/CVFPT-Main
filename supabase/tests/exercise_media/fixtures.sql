-- Fictional actors and synthetic exercise identities (rolled back per group).
insert into public.coaches (id, name, email, is_admin, archived) values
  ('a0000000-0000-4000-8000-00000000000a', 'Fixture Coach A', 'media-coach-a@example.invalid', false, false),
  ('b0000000-0000-4000-8000-00000000000b', 'Fixture Coach B', 'media-coach-b@example.invalid', false, false),
  ('ad000000-0000-4000-8000-0000000000ad', 'Fixture Admin', 'media-admin@example.invalid', true, false),
  ('c0000000-0000-4000-8000-00000000000c', 'Fixture Archived Coach', 'media-archived@example.invalid', false, true);

insert into public.exercise_library (id, name, category, equipment, source, review_status, archived) values
  ('e0000000-0000-4000-8000-000000000001', 'Synthetic Goblet Squat', 'Synthetic', 'Kettlebell', 'manual', 'approved', false),
  ('e0000000-0000-4000-8000-000000000002', 'Synthetic Split Squat', 'Synthetic', 'Dumbbell', 'manual', 'approved', false),
  ('e0000000-0000-4000-8000-000000000003', 'Synthetic Band Row', 'Synthetic', 'Band', 'manual', 'approved', false),
  ('e0000000-0000-4000-8000-000000000004', 'Synthetic Plank', 'Synthetic', 'Bodyweight', 'manual', 'approved', false),
  ('e0000000-0000-4000-8000-000000000005', 'Synthetic Shuttle Walk', 'Synthetic', 'None', 'manual', 'approved', false),
  ('e0000000-0000-4000-8000-000000000006', 'Synthetic Archived Exercise', 'Synthetic', 'None', 'manual', 'approved', true);

