-- Fixtures shared by the rolled-back SQL tests (the runner wraps each test file
-- in begin/rollback). Fixed ids; nothing here persists.
insert into public.coaches (id, name, email) values
  ('10000000-0000-4000-8000-0000000000a1', 'Series Coach One', 'series-coach-1@example.invalid'),
  ('10000000-0000-4000-8000-0000000000a2', 'Series Coach Two', 'series-coach-2@example.invalid');

insert into public.clients (id, coach_id, name, email) values
  ('20000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000a1', 'Series Client One', 'series-client-1@example.invalid'),
  ('20000000-0000-4000-8000-0000000000b2', '10000000-0000-4000-8000-0000000000a1', 'Series Client Two', 'series-client-2@example.invalid'),
  ('20000000-0000-4000-8000-0000000000b3', '10000000-0000-4000-8000-0000000000a2', 'Series Client Three', 'series-client-3@example.invalid');

insert into public.workouts (id, coach_id, name) values
  ('30000000-0000-4000-8000-0000000000c1', '10000000-0000-4000-8000-0000000000a1', 'Series Workout One'),
  ('30000000-0000-4000-8000-0000000000c2', '10000000-0000-4000-8000-0000000000a1', 'Series Workout Two');

insert into public.programs (id, coach_id, name, frequency_days) values
  ('40000000-0000-4000-8000-0000000000d1', '10000000-0000-4000-8000-0000000000a1', 'Series Program', 2);

insert into public.program_days (program_id, day_number, workout_id) values
  ('40000000-0000-4000-8000-0000000000d1', 1, '30000000-0000-4000-8000-0000000000c1'),
  ('40000000-0000-4000-8000-0000000000d1', 2, '30000000-0000-4000-8000-0000000000c2');
