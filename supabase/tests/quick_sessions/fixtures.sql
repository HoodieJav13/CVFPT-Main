-- Synthetic fixtures for the quick-sessions behavior files. run.sh wraps each file as
--   begin; fixtures.sql; <file>; rollback;
-- so nothing here is ever committed. OWNED DISPOSABLE STACK only (stack.sh).
\set ON_ERROR_STOP on
set client_min_messages = notice;

create function pg_temp.assert(ok boolean, name text) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'FAIL: %', name; end if;
  raise notice 'PASS: %', name;
end $$;

-- Hashes are opaque to SQL; any well-formed v1 value works.
create function pg_temp.h(p_seed text) returns text language sql immutable as $$
  select 'v1:' || encode(sha256(convert_to(p_seed, 'UTF8')), 'hex')
$$;

create function pg_temp.body(p_name text) returns jsonb language sql immutable as $$
  select jsonb_build_array(
    jsonb_build_object('exercise_library_id', 'b3000000-0000-4000-8000-000000000001', 'custom_name', null, 'sets', '3', 'reps', '8',
      'default_load_value', 100, 'default_load_unit', 'lb', 'rest', null, 'tempo', null, 'target_rpe', null,
      'client_notes', 'Brace', 'coach_notes', 'Coach only', 'video_url', null, 'superset_group', null,
      'tracking_type', 'reps_weight', 'duration_value', null, 'duration_unit', null, 'distance_value', null, 'distance_unit', null),
    jsonb_build_object('exercise_library_id', null, 'custom_name', p_name, 'sets', '2', 'reps', null,
      'default_load_value', null, 'default_load_unit', null, 'rest', null, 'tempo', null, 'target_rpe', null,
      'client_notes', null, 'coach_notes', null, 'video_url', null, 'superset_group', null,
      'tracking_type', 'duration', 'duration_value', 45, 'duration_unit', 's', 'distance_value', null, 'distance_unit', null))
$$;

insert into public.coaches (id, name, email, is_admin) values
  ('b1000000-0000-4000-8000-000000000001', 'Quick Coach One', 'quick-coach-1@example.invalid', false),
  ('b1000000-0000-4000-8000-000000000002', 'Quick Coach Two', 'quick-coach-2@example.invalid', false),
  ('b1000000-0000-4000-8000-0000000000ad', 'Quick Admin', 'quick-admin@example.invalid', true);
insert into public.clients (id, coach_id, name, email) values
  ('b2000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Quick Client One', 'quick-client-1@example.invalid'),
  ('b2000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000001', 'Quick Client Two', 'quick-client-2@example.invalid'),
  ('b2000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000002', 'Quick Client Three', 'quick-client-3@example.invalid');
insert into public.exercise_library (id, name, hidden) values
  ('b3000000-0000-4000-8000-000000000001', 'Quick Squat', false),
  ('b3000000-0000-4000-8000-000000000002', 'Quick Hidden Press', true);
