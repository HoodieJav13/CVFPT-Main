\set ON_ERROR_STOP on

do $$
declare
  v_started jsonb;
  v_new_log uuid;
  v_count integer;
begin
  if (select exercise_library_id from public.workout_log_exercises where id = '80000000-0000-4000-8000-000000000001')
      <> '30000000-0000-4000-8000-000000000001'::uuid then
    raise exception 'legacy identity backfill failed';
  end if;

  v_started := public.start_workout_log(
    '20000000-0000-4000-8000-000000000001', null, null,
    '60000000-0000-4000-8000-000000000001'
  );
  v_new_log := (v_started ->> 'workout_log_id')::uuid;
  if (select exercise_library_id from public.workout_log_exercises where workout_log_id = v_new_log)
      <> '30000000-0000-4000-8000-000000000001'::uuid then
    raise exception 'current start snapshot failed';
  end if;

  select count(*) into v_count
  from public.get_workout_exercise_history(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001', null, null, null, 11
  );
  if v_count <> 1 then raise exception 'completed-only history expected 1 row, got %', v_count; end if;

  begin
    update public.workout_log_sets set actual_reps = -1
    where workout_log_exercise_id in (select id from public.workout_log_exercises where workout_log_id = v_new_log);
    raise exception 'negative reps unexpectedly accepted';
  exception when check_violation then null;
  end;
  begin
    update public.workout_log_sets set actual_rpe = 7.25
    where workout_log_exercise_id in (select id from public.workout_log_exercises where workout_log_id = v_new_log);
    raise exception 'quarter-step RPE unexpectedly accepted';
  exception when check_violation then null;
  end;
  begin
    update public.workout_log_exercises set exercise_name = 'Mutated'
    where id = '80000000-0000-4000-8000-000000000001';
    raise exception 'completed exercise unexpectedly mutable';
  exception when raise_exception then
    if sqlerrm <> 'Completed workout logs are immutable' then raise; end if;
  end;

  if has_function_privilege('authenticated', 'public.get_workout_exercise_history(uuid,uuid,uuid,timestamptz,uuid,integer)', 'execute') then
    raise exception 'authenticated unexpectedly has history execute';
  end if;
  if not has_function_privilege('service_role', 'public.get_workout_exercise_history(uuid,uuid,uuid,timestamptz,uuid,integer)', 'execute') then
    raise exception 'service_role missing history execute';
  end if;
end;
$$;

-- Runtime identity/filter fixtures after migration 15. Each log is populated
-- while active and then completed so the immutable-child trigger stays real.
update public.workout_logs set status = 'abandoned'
where client_id = '20000000-0000-4000-8000-000000000001' and status = 'active';

insert into public.workout_exercises (id, workout_id, exercise_library_id, custom_name, sets)
values
  ('50000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', null, '1'),
  ('50000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000001', null, 'Same Custom Name', '1'),
  ('50000000-0000-4000-8000-000000000004', '40000000-0000-4000-8000-000000000001', null, 'Same Custom Name', '1');

insert into public.clients (id, coach_id, name)
values ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'Foreign History Client');
insert into public.workout_assignments (id, client_id, workout_id, assignment_mode)
values ('60000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000001', 'active');

-- Same library, distinct source, renamed snapshot. Archived/skipped children
-- coexist but must not appear beside the one completed active set.
insert into public.workout_logs (id, client_id, coach_id, workout_assignment_id, source_workout_id, workout_name, status)
values ('70000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'Cross-source library', 'active');
insert into public.workout_log_exercises (id, workout_log_id, source_workout_exercise_id, exercise_library_id, exercise_name)
values ('80000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', 'Renamed Library Snapshot');
insert into public.workout_log_sets (id, workout_log_exercise_id, set_number, status, actual_reps, completed_at, archived)
values
  ('90000000-0000-4000-8000-000000000002', '80000000-0000-4000-8000-000000000002', 1, 'completed', 8, '2026-07-02T12:00:00Z', false),
  ('90000000-0000-4000-8000-000000000003', '80000000-0000-4000-8000-000000000002', 2, 'skipped', 99, null, false),
  ('90000000-0000-4000-8000-000000000004', '80000000-0000-4000-8000-000000000002', 3, 'completed', 99, '2026-07-02T12:00:00Z', true);
update public.workout_logs set status = 'completed', completed_at = '2026-07-02T12:00:00Z'
where id = '70000000-0000-4000-8000-000000000002';

-- A completed log with no completed set must not become an occurrence.
insert into public.workout_logs (id, client_id, coach_id, workout_assignment_id, source_workout_id, workout_name, status)
values ('70000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'Pending only', 'active');
insert into public.workout_log_exercises (id, workout_log_id, source_workout_exercise_id, exercise_library_id, exercise_name)
values ('80000000-0000-4000-8000-000000000003', '70000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', 'Pending only');
insert into public.workout_log_sets (id, workout_log_exercise_id, set_number, status)
values ('90000000-0000-4000-8000-000000000005', '80000000-0000-4000-8000-000000000003', 1, 'pending');
update public.workout_logs set status = 'completed', completed_at = '2026-07-03T12:00:00Z'
where id = '70000000-0000-4000-8000-000000000003';

-- Archived completed log must not appear.
insert into public.workout_logs (id, client_id, coach_id, workout_assignment_id, source_workout_id, workout_name, status)
values ('70000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'Archived completed', 'active');
insert into public.workout_log_exercises (id, workout_log_id, source_workout_exercise_id, exercise_library_id, exercise_name)
values ('80000000-0000-4000-8000-000000000004', '70000000-0000-4000-8000-000000000004', '50000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', 'Archived completed');
insert into public.workout_log_sets (id, workout_log_exercise_id, set_number, status, completed_at)
values ('90000000-0000-4000-8000-000000000006', '80000000-0000-4000-8000-000000000004', 1, 'completed', '2026-07-04T12:00:00Z');
update public.workout_logs set status = 'completed', completed_at = '2026-07-04T12:00:00Z', archived = true
where id = '70000000-0000-4000-8000-000000000004';

-- Same library for another client must not leak.
insert into public.workout_logs (id, client_id, coach_id, workout_assignment_id, source_workout_id, workout_name, status)
values ('70000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000001', 'Foreign client', 'active');
insert into public.workout_log_exercises (id, workout_log_id, source_workout_exercise_id, exercise_library_id, exercise_name)
values ('80000000-0000-4000-8000-000000000005', '70000000-0000-4000-8000-000000000005', '50000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', 'Foreign client');
insert into public.workout_log_sets (id, workout_log_exercise_id, set_number, status, completed_at)
values ('90000000-0000-4000-8000-000000000007', '80000000-0000-4000-8000-000000000005', 1, 'completed', '2026-07-05T12:00:00Z');
update public.workout_logs set status = 'completed', completed_at = '2026-07-05T12:00:00Z'
where id = '70000000-0000-4000-8000-000000000005';

-- Two custom sources and one unrecoverable null source share the same name.
insert into public.workout_logs (id, client_id, coach_id, workout_assignment_id, source_workout_id, workout_name, status, completed_at)
values
  ('70000000-0000-4000-8000-000000000006', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'Custom A', 'completed', '2026-07-06T12:00:00Z'),
  ('70000000-0000-4000-8000-000000000007', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'Custom B', 'completed', '2026-07-07T12:00:00Z'),
  ('70000000-0000-4000-8000-000000000008', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'Unrecoverable', 'completed', '2026-07-08T12:00:00Z');

-- The completed custom fixtures are test setup; restore both immutable-child
-- triggers immediately after inserting their pre-existing child snapshots.
alter table public.workout_log_exercises disable trigger prevent_completed_workout_exercise_change;
alter table public.workout_log_sets disable trigger prevent_completed_workout_set_change;
insert into public.workout_log_exercises (id, workout_log_id, source_workout_exercise_id, exercise_library_id, exercise_name)
values
  ('80000000-0000-4000-8000-000000000006', '70000000-0000-4000-8000-000000000006', '50000000-0000-4000-8000-000000000003', null, 'Same Custom Name'),
  ('80000000-0000-4000-8000-000000000007', '70000000-0000-4000-8000-000000000007', '50000000-0000-4000-8000-000000000004', null, 'Same Custom Name'),
  ('80000000-0000-4000-8000-000000000008', '70000000-0000-4000-8000-000000000008', null, null, 'Same Custom Name');
insert into public.workout_log_sets (id, workout_log_exercise_id, set_number, status, completed_at)
values
  ('90000000-0000-4000-8000-000000000008', '80000000-0000-4000-8000-000000000006', 1, 'completed', '2026-07-06T12:00:00Z'),
  ('90000000-0000-4000-8000-000000000009', '80000000-0000-4000-8000-000000000007', 1, 'completed', '2026-07-07T12:00:00Z'),
  ('90000000-0000-4000-8000-000000000010', '80000000-0000-4000-8000-000000000008', 1, 'completed', '2026-07-08T12:00:00Z');
alter table public.workout_log_sets enable trigger prevent_completed_workout_set_change;
alter table public.workout_log_exercises enable trigger prevent_completed_workout_exercise_change;

do $$
declare v_count integer;
begin
  select count(*) into v_count from public.get_workout_exercise_history(
    '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', null, null, null, 11);
  if v_count <> 2 then raise exception 'library identity/filter expected 2 rows, got %', v_count; end if;
  if not exists (select 1 from public.get_workout_exercise_history(
      '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', null, null, null, 11)
      where exercise_name = 'Renamed Library Snapshot') then
    raise exception 'cross-source library snapshot missing';
  end if;
  select count(*) into v_count from public.get_workout_exercise_history(
    '20000000-0000-4000-8000-000000000001', null, '50000000-0000-4000-8000-000000000003', null, null, 11);
  if v_count <> 1 then raise exception 'exact custom source A expected 1 row, got %', v_count; end if;
  select count(*) into v_count from public.get_workout_exercise_history(
    '20000000-0000-4000-8000-000000000001', null, '50000000-0000-4000-8000-000000000004', null, null, 11);
  if v_count <> 1 then raise exception 'exact custom source B expected 1 row, got %', v_count; end if;
end;
$$;

select 'exercise history migration assertions passed' as result;
