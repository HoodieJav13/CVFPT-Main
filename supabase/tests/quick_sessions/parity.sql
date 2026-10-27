-- A10 shared-writer parity fixture. Runs UNCHANGED against the pre-feature schema
-- (reset to 20261005165134) and against the schema with the quick-sessions migration.
-- run.sh captures the relational report printed at the end of each run and diffs the two.
-- Generated ids/timestamps never appear in the report: every workout_exercises row gets a
-- stable label the first time it is seen ("<step>:<position>"), so a row that keeps its id
-- keeps its label and a replaced row gets a new one. Explicit id-retention assertions are
-- separate and fail the run on their own.
-- Synthetic data only, OWNED DISPOSABLE STACK only (see stack.sh).
\set ON_ERROR_STOP on
\pset footer off
\pset format unaligned
\pset tuples_only on
set client_min_messages = warning;

create function pg_temp.assert(ok boolean, name text) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'FAIL: %', name; end if;
  raise notice 'PASS: %', name;
end $$;

create temp table labels (id uuid primary key, label text not null unique);
create temp table ids (name text primary key, id uuid not null);
create function pg_temp.label(p_step text, p_workout uuid) returns void language sql as $$
  insert into labels (id, label)
  select we.id, p_step || ':' || we.position
  from public.workout_exercises we
  where we.workout_id = p_workout and we.archived = false
    and not exists (select 1 from labels l where l.id = we.id);
$$;
create function pg_temp.remember(p_name text, p_id uuid) returns void language sql as $$
  insert into ids (name, id) values (p_name, p_id) on conflict (name) do update set id = excluded.id;
$$;
create function pg_temp.id(p_name text) returns uuid language sql as $$ select id from ids where name = p_name $$;
create function pg_temp.row_id(p_workout uuid, p_position int) returns uuid language sql as $$
  select id from public.workout_exercises where workout_id = p_workout and archived = false and position = p_position
$$;

-- Fixtures.
insert into public.coaches (id, name, email) values
  ('a1000000-0000-4000-8000-000000000001', 'Parity Coach', 'parity-coach@example.invalid');
insert into public.clients (id, coach_id, name, email) values
  ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'Parity Client', 'parity-client@example.invalid');
insert into public.exercise_library (id, name) values
  ('a3000000-0000-4000-8000-000000000001', 'Parity Squat'),
  ('a3000000-0000-4000-8000-000000000002', 'Parity Bench'),
  ('a3000000-0000-4000-8000-000000000003', 'Parity Row');

do $$
declare
  coach uuid := 'a1000000-0000-4000-8000-000000000001';
  client uuid := 'a2000000-0000-4000-8000-000000000001';
  squat uuid := 'a3000000-0000-4000-8000-000000000001';
  bench uuid := 'a3000000-0000-4000-8000-000000000002';
  rowx uuid := 'a3000000-0000-4000-8000-000000000003';
  t uuid; t2 uuid; result uuid; program_id uuid; day_id uuid; pa uuid; wa uuid; private_assignment uuid; private_workout uuid;
  r_squat uuid; r_bench uuid; r_custom uuid; r_row uuid; r_carry uuid;
begin
  -- 1. Template create: library + custom rows, alias notes, default load unit, supersets,
  --    every typed mode, and an empty row that the writer skips.
  t := public.save_workout(null, coach, '  Parity Template  ', 'desc', 'goal', jsonb_build_array(
    jsonb_build_object('exercise_library_id', squat, 'sets', '3', 'reps', '8', 'default_load_value', '100', 'notes', 'alias note', 'coach_notes', 'coach only', 'video_url', 'https://example.invalid/v', 'superset_group', 'A', 'rest', '90s', 'tempo', '3-1-1', 'target_rpe', '8'),
    jsonb_build_object('exercise_library_id', bench, 'sets', '3', 'reps', '10', 'superset_group', 'A', 'client_notes', 'cn wins', 'notes', 'ignored alias'),
    jsonb_build_object('custom_name', '', 'name', ''),
    jsonb_build_object('custom_name', '  Squat  ', 'tracking_type', 'duration', 'duration_value', 30, 'duration_unit', 's'),
    jsonb_build_object('exercise_library_id', rowx, 'tracking_type', 'distance', 'distance_value', 400, 'distance_unit', 'm', 'default_load_value', 20, 'default_load_unit', 'kg'),
    jsonb_build_object('name', 'Carry', 'tracking_type', 'duration_distance', 'duration_value', 2, 'duration_unit', 'min', 'distance_value', 100, 'distance_unit', 'yd')
  ));
  perform pg_temp.remember('template', t);
  perform pg_temp.label('create', t);
  r_squat := pg_temp.row_id(t, 0); r_bench := pg_temp.row_id(t, 1); r_custom := pg_temp.row_id(t, 2);
  r_row := pg_temp.row_id(t, 3); r_carry := pg_temp.row_id(t, 4);
  perform pg_temp.remember('r_squat', r_squat); perform pg_temp.remember('r_bench', r_bench);
  perform pg_temp.remember('r_custom', r_custom); perform pg_temp.remember('r_row', r_row);
  perform pg_temp.remember('r_carry', r_carry);
  perform pg_temp.assert((select count(*) = 5 from public.workout_exercises where workout_id = t), 'create skips the empty row');
  perform pg_temp.assert((select is_template and not hidden and client_id is null and created_by = coach and name = 'Parity Template' from public.workouts where id = t), 'create keeps template defaults and trims the title');

  -- 2. Live-linked loads in BOTH families on the template rows.
  insert into public.programs (coach_id, name, frequency_days) values (coach, 'Parity Program', 1) returning id into program_id;
  insert into public.program_days (program_id, day_number, workout_id) values (program_id, 1, t) returning id into day_id;
  insert into public.program_assignments (program_id, client_id) values (program_id, client) returning id into pa;
  insert into public.workout_assignments (client_id, workout_id, assignment_mode) values (client, t, 'active') returning id into wa;
  insert into public.program_assignment_exercise_loads (program_assignment_id, program_day_id, workout_exercise_id, load_value, load_unit)
    values (pa, day_id, r_squat, 105, 'lb'), (pa, day_id, r_custom, 10, 'kg'), (pa, day_id, r_row, 30, 'kg');
  insert into public.workout_assignment_exercise_loads (workout_assignment_id, workout_exercise_id, load_value, load_unit)
    values (wa, r_squat, 110, 'lb'), (wa, r_custom, 12, 'kg'), (wa, r_row, 32, 'kg');
  perform pg_temp.remember('program_assignment', pa); perform pg_temp.remember('workout_assignment', wa);

  -- 3. Update: same-library id kept; custom identity kept under case/trim matching with
  --    omitted typed metrics preserved; identity change replaces; Carry removed; reorder;
  --    empty row skipped; explicit typed clear; a new row inserted.
  result := public.save_workout(t, coach, 'Parity Template v2', null, '', jsonb_build_array(
    jsonb_build_object('id', r_bench, 'exercise_library_id', bench, 'sets', '4', 'reps', '6', 'tracking_type', 'reps_weight'),
    jsonb_build_object('id', r_squat, 'exercise_library_id', squat, 'sets', '5', 'reps', '5', 'default_load_value', 120, 'default_load_unit', 'kg', 'notes', 'new alias'),
    jsonb_build_object('custom_name', '   '),
    jsonb_build_object('id', r_custom, 'custom_name', 'sQUAT', 'sets', '2'),
    jsonb_build_object('id', r_row, 'exercise_library_id', bench, 'tracking_type', 'distance', 'distance_value', 200, 'distance_unit', 'm'),
    jsonb_build_object('custom_name', 'Lunge', 'tracking_type', 'duration', 'duration_value', null, 'duration_unit', null, 'superset_group', 'B'),
    jsonb_build_object('name', 'Hold', 'tracking_type', 'duration', 'duration_value', 1, 'duration_unit', 'min', 'superset_group', 'B')
  ));
  perform pg_temp.assert(result = t, 'update returns the same workout id');
  perform pg_temp.label('update1', t);
  perform pg_temp.assert(pg_temp.row_id(t, 0) = r_bench and pg_temp.row_id(t, 1) = r_squat, 'same-library rows keep ids across a reorder');
  perform pg_temp.assert(pg_temp.row_id(t, 2) = r_custom, 'custom row keeps its id under case-insensitive trimmed matching');
  perform pg_temp.assert(pg_temp.row_id(t, 3) <> r_row, 'library identity change replaces the row id');
  perform pg_temp.assert((select archived from public.workout_exercises where id = r_row) and (select archived from public.workout_exercises where id = r_carry), 'replaced and removed rows are archived');
  perform pg_temp.assert((select tracking_type = 'duration' and duration_value = 30 and duration_unit = 's' and custom_name = 'sQUAT' from public.workout_exercises where id = r_custom), 'omitted typed metrics are preserved on update');
  perform pg_temp.assert((select archived from public.program_assignment_exercise_loads where workout_exercise_id = r_row)
    and (select archived from public.workout_assignment_exercise_loads where workout_exercise_id = r_row), 'replaced-row loads archived in both families');
  perform pg_temp.assert(not (select archived from public.program_assignment_exercise_loads where workout_exercise_id = r_squat)
    and not (select archived from public.workout_assignment_exercise_loads where workout_exercise_id = r_custom), 'retained-row loads preserved');

  -- 4. An invalid update rolls back title, rows, metrics and BOTH load families together.
  --    The failure is raised after save_workout has already archived program loads.
  begin
    create function public.parity_fail_load() returns trigger language plpgsql as 'begin raise exception ''parity injected failure''; end';
    create trigger parity_fail_load before update on public.workout_assignment_exercise_loads
      for each row execute function public.parity_fail_load();
    perform public.save_workout(t, coach, 'Broken', 'x', 'y', jsonb_build_array(
      jsonb_build_object('custom_name', 'Only row', 'tracking_type', 'duration', 'duration_value', 10, 'duration_unit', 's')));
    raise exception 'injected failure did not fire';
  exception when raise_exception then
    if sqlerrm <> 'parity injected failure' then raise; end if;
  end;
  begin
    perform public.save_workout(t, coach, 'Broken metric', null, null, jsonb_build_array(
      jsonb_build_object('id', r_custom, 'custom_name', 'Squat', 'tracking_type', 'duration', 'duration_value', 5, 'duration_unit', 'm')));
    raise exception 'invalid metric unexpectedly saved';
  exception when check_violation then null;
  end;
  perform pg_temp.assert((select name = 'Parity Template v2' from public.workouts where id = t)
    and (select count(*) = 6 from public.workout_exercises where workout_id = t and archived = false)
    and not (select archived from public.program_assignment_exercise_loads where workout_exercise_id = r_squat)
    and not (select archived from public.workout_assignment_exercise_loads where workout_exercise_id = r_squat)
    and (select duration_value = 30 from public.workout_exercises where id = r_custom)
    and not exists (select 1 from pg_trigger where tgname = 'parity_fail_load'), 'failed updates roll back every write');

  -- 5. An archived workout update is a no-op returning null.
  t2 := public.save_workout(null, coach, 'Parity Archived', null, null, '[{"custom_name":"Keep"}]');
  perform pg_temp.remember('archived_template', t2);
  perform pg_temp.label('archived', t2);
  update public.workouts set archived = true where id = t2;
  perform pg_temp.assert(public.save_workout(t2, coach, 'Changed', null, null, '[{"custom_name":"Changed"}]') is null, 'archived update returns null');
  perform pg_temp.assert((select name = 'Parity Archived' from public.workouts where id = t2)
    and (select custom_name = 'Keep' and not archived from public.workout_exercises where workout_id = t2), 'archived update writes nothing');

  -- 6. Private client copy: update keeps private semantics; a previously archived row is
  --    never resurrected by an update that names its id.
  private_assignment := public.assign_workout_clone(t, client, 'dated', '2031-01-06', 'private notes',
    jsonb_build_array(jsonb_build_object('workout_exercise_id', r_squat, 'load_value', 140, 'load_unit', 'lb')));
  select workout_id into private_workout from public.workout_assignments where id = private_assignment;
  perform pg_temp.remember('private_workout', private_workout);
  perform pg_temp.label('private', private_workout);
  result := public.save_workout(private_workout, coach, 'Private v2', null, null, jsonb_build_array(
    jsonb_build_object('id', pg_temp.row_id(private_workout, 1), 'exercise_library_id', squat, 'sets', '6', 'coach_notes', 'private coach note'),
    jsonb_build_object('id', r_row, 'exercise_library_id', bench, 'sets', '1')));
  perform pg_temp.label('private_update', private_workout);
  perform pg_temp.assert(result = private_workout and (select not is_template and client_id = client and name = 'Private v2' from public.workouts where id = private_workout), 'private update keeps private semantics');
  perform pg_temp.assert((select archived from public.workout_exercises where id = r_row) and (select count(*) = 1 from public.workout_exercises where workout_id = t and id = r_row), 'archived template row is not resurrected');
  perform pg_temp.assert((select count(*) = 1 from public.workout_assignment_exercise_loads l join public.workout_exercises we on we.id = l.workout_exercise_id where l.workout_assignment_id = private_assignment and not l.archived and we.exercise_library_id = squat), 'private retained-row load preserved');
end $$;

-- Relational report (ids replaced by labels; no timestamps).
select 'workout|' || coalesce(n.name, '?') || '|' || w.name || '|' || coalesce(w.description, '∅') || '|' || coalesce(w.goal, '∅')
  || '|archived=' || w.archived || '|template=' || w.is_template || '|hidden=' || w.hidden
  || '|client=' || (w.client_id is not null) || '|created_by=' || (w.created_by is not null)
from public.workouts w left join ids n on n.id = w.id
where w.coach_id = 'a1000000-0000-4000-8000-000000000001'
order by coalesce(n.name, '~'), w.name;

select 'exercise|' || coalesce(o.name, '?') || '|' || coalesce(l.label, 'UNLABELED') || '|pos=' || we.position || '|archived=' || we.archived
  || '|lib=' || coalesce(el.name, '∅') || '|custom=' || coalesce(we.custom_name, '∅')
  || '|sets=' || coalesce(we.sets, '∅') || '|reps=' || coalesce(we.reps, '∅') || '|rest=' || coalesce(we.rest, '∅')
  || '|tempo=' || coalesce(we.tempo, '∅') || '|rpe=' || coalesce(we.target_rpe, '∅')
  || '|load=' || coalesce(we.default_load_value::text, '∅') || ' ' || coalesce(we.default_load_unit, '∅')
  || '|notes=' || coalesce(we.notes, '∅') || '|client_notes=' || coalesce(we.client_notes, '∅')
  || '|coach_notes=' || coalesce(we.coach_notes, '∅') || '|video=' || coalesce(we.video_url, '∅')
  || '|superset=' || coalesce(we.superset_group, '∅') || '|tracking=' || we.tracking_type
  || '|duration=' || coalesce(we.duration_value::text, '∅') || ' ' || coalesce(we.duration_unit, '∅')
  || '|distance=' || coalesce(we.distance_value::text, '∅') || ' ' || coalesce(we.distance_unit, '∅')
from public.workout_exercises we
join public.workouts w on w.id = we.workout_id
left join ids o on o.id = we.workout_id
left join labels l on l.id = we.id
left join public.exercise_library el on el.id = we.exercise_library_id
where w.coach_id = 'a1000000-0000-4000-8000-000000000001'
order by coalesce(o.name, '~'), we.archived, we.position, coalesce(l.label, '~');

select 'load|program|' || coalesce(l.label, 'UNLABELED') || '|' || x.load_value || ' ' || x.load_unit || '|archived=' || x.archived
from public.program_assignment_exercise_loads x left join labels l on l.id = x.workout_exercise_id
where x.program_assignment_id = (select id from ids where name = 'program_assignment')
order by l.label, x.load_value;
select 'load|workout|' || coalesce(a.name, 'private') || '|' || coalesce(l.label, 'UNLABELED') || '|' || x.load_value || ' ' || x.load_unit || '|archived=' || x.archived
from public.workout_assignment_exercise_loads x
join public.workout_assignments wa on wa.id = x.workout_assignment_id
left join ids a on a.id = wa.id
left join labels l on l.id = x.workout_exercise_id
where wa.client_id = 'a2000000-0000-4000-8000-000000000001'
order by coalesce(a.name, 'private'), l.label, x.load_value;
