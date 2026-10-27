-- Added on top of ../pr120_repairs/fixtures.sql (fictional). A second
-- client-private program for the same client uses the SAME private workout
-- (00…05) on its only day — an arrangement save_program accepts today.
insert into public.programs(id, coach_id, name, frequency_days, is_template, client_id) values
  ('00000000-0000-4000-8000-000000000016', '00000000-0000-4000-8000-000000000001', 'Second Private Program', 1, false, '00000000-0000-4000-8000-000000000011');
insert into public.program_assignments(id, program_id, client_id) values
  ('00000000-0000-4000-8000-000000000017', '00000000-0000-4000-8000-000000000016', '00000000-0000-4000-8000-000000000011');
select public.save_program('00000000-0000-4000-8000-000000000016', '00000000-0000-4000-8000-000000000001', false, 'Second Private Program', null, 1,
  '[{"day_number":1,"workout_id":"00000000-0000-4000-8000-000000000005"}]'::jsonb);
