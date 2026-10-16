-- Exercise guides: workout demo reference modes (docs/exercise-guides/design.md).
-- Additive migration 20261016170000: nullable workout_exercises.video_link_mode
-- ('inherit' | 'override' | NULL legacy), the shared writer, clones, imports and
-- Quick create. Rolled back. All identities are fictional.
insert into public.clients (id, coach_id, name, email) values
  ('c1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', 'Synthetic Guide Client', 'guide-client@example.invalid');
update public.exercise_library set video_url = 'https://youtu.be/AAAAAAAAAAA' where id = 'e0000000-0000-4000-8000-000000000001';

-- ----- Column and constraints ---------------------------------------------------
do $$
declare w uuid;
begin
  perform pg_temp.expect((select is_nullable = 'YES' and data_type = 'text' from information_schema.columns
    where table_schema = 'public' and table_name = 'workout_exercises' and column_name = 'video_link_mode'), 'nullable text mode column');
  perform pg_temp.expect(not exists (select 1 from public.workout_exercises where video_link_mode is not null), 'existing rows stay unclassified (no bulk rewrite)');
  insert into public.workouts (coach_id, name) values ('a0000000-0000-4000-8000-00000000000a', 'Synthetic constraint workout') returning id into w;
  begin
    insert into public.workout_exercises (workout_id, exercise_library_id, video_link_mode, video_url, position) values (w, 'e0000000-0000-4000-8000-000000000001', 'inherit', 'https://youtu.be/CCCCCCCCCCC', 0);
    raise exception 'inherit with a copied URL was accepted';
  exception when check_violation then null; end;
  begin
    insert into public.workout_exercises (workout_id, custom_name, video_link_mode, position) values (w, 'Synthetic custom', 'inherit', 0);
    raise exception 'inherit on a custom exercise was accepted';
  exception when check_violation then null; end;
  begin
    insert into public.workout_exercises (workout_id, exercise_library_id, video_link_mode, video_url, position) values (w, 'e0000000-0000-4000-8000-000000000001', 'override', '   ', 0);
    raise exception 'override without a link was accepted';
  exception when check_violation then null; end;
  begin
    insert into public.workout_exercises (workout_id, exercise_library_id, video_link_mode, position) values (w, 'e0000000-0000-4000-8000-000000000001', 'library', 0);
    raise exception 'unknown mode was accepted';
  exception when check_violation then null; end;
end $$;

-- ----- Shared writer: explicit new modes, untouched legacy shapes ------------------
do $$
declare w uuid; rows jsonb; ids uuid[];
begin
  w := public.save_workout(null, 'a0000000-0000-4000-8000-00000000000a', 'Synthetic writer workout', null, null, jsonb_build_array(
    jsonb_build_object('exercise_library_id', 'e0000000-0000-4000-8000-000000000001', 'video_link_mode', 'inherit', 'video_url', ''),
    jsonb_build_object('exercise_library_id', 'e0000000-0000-4000-8000-000000000001', 'video_link_mode', 'override', 'video_url', 'https://youtu.be/CCCCCCCCCCC'),
    jsonb_build_object('custom_name', 'Synthetic custom', 'video_url', 'https://example.com/legacy-demo'),
    jsonb_build_object('exercise_library_id', 'e0000000-0000-4000-8000-000000000003', 'video_url', '')));
  select jsonb_agg(jsonb_build_array(video_link_mode, video_url) order by position), array_agg(id order by position) into rows, ids
  from public.workout_exercises where workout_id = w and not archived;
  perform pg_temp.expect(rows = '[["inherit", null], ["override", "https://youtu.be/CCCCCCCCCCC"], [null, "https://example.com/legacy-demo"], [null, null]]'::jsonb, 'insert modes: ' || rows::text);

  -- Old request shapes (no key) on update keep consistent modes; a copied link on
  -- an inheriting row becomes unclassified legacy, never an inferred override.
  perform public.save_workout(w, 'a0000000-0000-4000-8000-00000000000a', 'Synthetic writer workout', null, null, jsonb_build_array(
    jsonb_build_object('id', ids[1], 'exercise_library_id', 'e0000000-0000-4000-8000-000000000001', 'video_url', ''),
    jsonb_build_object('id', ids[2], 'exercise_library_id', 'e0000000-0000-4000-8000-000000000001', 'video_url', 'https://youtu.be/DDDDDDDDDDD'),
    jsonb_build_object('id', ids[3], 'custom_name', 'Synthetic custom', 'video_url', 'https://example.com/legacy-demo'),
    jsonb_build_object('id', ids[4], 'exercise_library_id', 'e0000000-0000-4000-8000-000000000003', 'video_url', 'https://youtu.be/AAAAAAAAAAA')));
  select jsonb_agg(jsonb_build_array(video_link_mode, video_url) order by position) into rows from public.workout_exercises where workout_id = w and not archived;
  perform pg_temp.expect(rows = '[["inherit", null], ["override", "https://youtu.be/DDDDDDDDDDD"], [null, "https://example.com/legacy-demo"], [null, "https://youtu.be/AAAAAAAAAAA"]]'::jsonb, 'legacy-shape update: ' || rows::text);

  -- Explicit new-shape choices replace the stored mode deliberately.
  perform public.save_workout(w, 'a0000000-0000-4000-8000-00000000000a', 'Synthetic writer workout', null, null, jsonb_build_array(
    jsonb_build_object('id', ids[1], 'exercise_library_id', 'e0000000-0000-4000-8000-000000000001', 'video_link_mode', 'override', 'video_url', 'https://youtu.be/EEEEEEEEEEE'),
    jsonb_build_object('id', ids[2], 'exercise_library_id', 'e0000000-0000-4000-8000-000000000001', 'video_link_mode', 'inherit', 'video_url', ''),
    jsonb_build_object('id', ids[3], 'custom_name', 'Synthetic custom', 'video_link_mode', null, 'video_url', 'https://example.com/legacy-demo'),
    jsonb_build_object('id', ids[4], 'exercise_library_id', 'e0000000-0000-4000-8000-000000000003', 'video_link_mode', 'inherit', 'video_url', '')));
  select jsonb_agg(jsonb_build_array(video_link_mode, video_url) order by position) into rows from public.workout_exercises where workout_id = w and not archived;
  perform pg_temp.expect(rows = '[["override", "https://youtu.be/EEEEEEEEEEE"], ["inherit", null], [null, "https://example.com/legacy-demo"], ["inherit", null]]'::jsonb, 'explicit update: ' || rows::text);
  perform pg_temp.expect((select count(*) from public.workout_exercises where workout_id = w and not archived) = 4, 'rows updated in place');

  begin
    perform public.save_workout(w, 'a0000000-0000-4000-8000-00000000000a', 'Synthetic writer workout', null, null, jsonb_build_array(
      jsonb_build_object('id', ids[1], 'exercise_library_id', 'e0000000-0000-4000-8000-000000000001', 'video_link_mode', 'sometimes', 'video_url', '')));
    raise exception 'invalid writer mode accepted';
  exception when invalid_parameter_value or check_violation then null; end;
end $$;

-- ----- Copies preserve the mode exactly (templates, client clones, Quick library) -------
do $$
declare src uuid; tpl uuid; clone jsonb; assignment uuid; rows_src jsonb; rows_copy jsonb;
begin
  src := public.save_workout(null, 'a0000000-0000-4000-8000-00000000000a', 'Synthetic copy source', null, null, jsonb_build_array(
    jsonb_build_object('exercise_library_id', 'e0000000-0000-4000-8000-000000000001', 'video_link_mode', 'inherit', 'video_url', ''),
    jsonb_build_object('exercise_library_id', 'e0000000-0000-4000-8000-000000000001', 'video_link_mode', 'override', 'video_url', 'https://youtu.be/CCCCCCCCCCC'),
    jsonb_build_object('exercise_library_id', 'e0000000-0000-4000-8000-000000000002', 'video_url', 'https://example.com/legacy-demo')));
  select jsonb_agg(jsonb_build_array(exercise_library_id, video_link_mode, video_url) order by position) into rows_src from public.workout_exercises where workout_id = src and not archived;

  tpl := public.save_workout_as_template(src, 'a0000000-0000-4000-8000-00000000000a', 'Synthetic copy template', null);
  select jsonb_agg(jsonb_build_array(exercise_library_id, video_link_mode, video_url) order by position) into rows_copy from public.workout_exercises where workout_id = tpl and not archived;
  perform pg_temp.expect(rows_copy = rows_src, 'save-as-template preserves modes: ' || rows_copy::text);

  update public.workouts set hidden = false where id = tpl;
  assignment := public.assign_workout_clone(tpl, 'c1000000-0000-4000-8000-000000000001', 'active', null, null, '[]'::jsonb);
  select jsonb_agg(jsonb_build_array(we.exercise_library_id, we.video_link_mode, we.video_url) order by we.position) into rows_copy
  from public.workout_assignments wa join public.workout_exercises we on we.workout_id = wa.workout_id and not we.archived where wa.id = assignment;
  perform pg_temp.expect(rows_copy = rows_src, 'assign clone preserves modes: ' || rows_copy::text);

  clone := public.clone_workout(src, 'a0000000-0000-4000-8000-00000000000a', 'c1000000-0000-4000-8000-000000000001', false, null);
  select jsonb_agg(jsonb_build_array(exercise_library_id, video_link_mode, video_url) order by position) into rows_copy from public.workout_exercises where workout_id = (clone->>'workout_id')::uuid and not archived;
  perform pg_temp.expect(rows_copy = rows_src, 'clone preserves modes: ' || rows_copy::text);
end $$;

-- ----- Import commit: explicit or derived modes, no materialized library links ------
do $$
declare res jsonb; rows jsonb;
begin
  res := public.commit_program_import('a0000000-0000-4000-8000-00000000000a', 'manual', jsonb_build_object(
    'program', jsonb_build_object('name', 'Synthetic import', 'frequency_days', 1),
    'days', jsonb_build_array(jsonb_build_object('day_number', 1, 'name', 'Day 1', 'exercises', jsonb_build_array(
      jsonb_build_object('name', 'Synthetic Goblet Squat', 'video_link_mode', 'inherit', 'video_url', ''),
      jsonb_build_object('name', 'Synthetic Goblet Squat', 'video_link_mode', 'override', 'video_url', 'https://youtu.be/CCCCCCCCCCC'),
      jsonb_build_object('name', 'Synthetic Split Squat', 'video_link_mode', null, 'video_url', 'https://example.com/legacy-demo'),
      -- Old draft shapes (no key): a link is an explicit override, no link inherits.
      jsonb_build_object('name', 'Synthetic Band Row', 'video_url', 'https://youtu.be/DDDDDDDDDDD'),
      jsonb_build_object('name', 'Synthetic Plank', 'video_url', ''))))));
  select jsonb_agg(jsonb_build_array(we.video_link_mode, we.video_url) order by we.position) into rows
  from public.program_days pd join public.workout_exercises we on we.workout_id = pd.workout_id
  where pd.program_id = (res->>'program_id')::uuid;
  perform pg_temp.expect(rows = '[["inherit", null], ["override", "https://youtu.be/CCCCCCCCCCC"], [null, "https://example.com/legacy-demo"], ["override", "https://youtu.be/DDDDDDDDDDD"], ["inherit", null]]'::jsonb, 'import modes: ' || rows::text);
end $$;

-- ----- Quick create: hashed v1 facts only; derived mode on fresh rows only -----------
do $$
declare request uuid := gen_random_uuid(); res jsonb; replay jsonb; rows jsonb; rows_after jsonb; count_before bigint;
  legacy_before jsonb; legacy_after jsonb; tpl jsonb; hash text := 'v1:' || repeat('5', 64);
  exercises jsonb := jsonb_build_array(
    jsonb_build_object('exercise_library_id', 'e0000000-0000-4000-8000-000000000001', 'custom_name', null, 'sets', '3', 'video_url', null),
    jsonb_build_object('exercise_library_id', 'e0000000-0000-4000-8000-000000000001', 'custom_name', null, 'sets', '3', 'video_url', 'https://youtu.be/CCCCCCCCCCC'),
    jsonb_build_object('exercise_library_id', null, 'custom_name', 'Synthetic custom', 'sets', '1', 'video_url', null),
    jsonb_build_object('exercise_library_id', null, 'custom_name', 'Synthetic custom link', 'sets', '1', 'video_url', 'https://example.com/legacy-demo'));
begin
  -- An unrelated pre-existing legacy row must never be reclassified.
  select jsonb_agg(to_jsonb(we) order by we.id) into legacy_before from public.workout_exercises we where we.video_link_mode is null;
  res := public.create_quick_session('a0000000-0000-4000-8000-00000000000a', 'c1000000-0000-4000-8000-000000000001', request, hash,
    current_date, 'Synthetic quick', null, exercises);
  perform pg_temp.expect(res->>'state' = 'created', 'quick created: ' || res::text);
  select jsonb_agg(jsonb_build_array(video_link_mode, video_url) order by position) into rows from public.workout_exercises where workout_id = (res->>'workout_id')::uuid;
  perform pg_temp.expect(rows = '[["inherit", null], ["override", "https://youtu.be/CCCCCCCCCCC"], [null, null], ["override", "https://example.com/legacy-demo"]]'::jsonb, 'quick derived modes: ' || rows::text);
  perform pg_temp.expect((select create_request_hash from public.workout_assignments where id = (res->>'assignment_id')::uuid) = hash, 'receipt hash stored as sent');

  -- Library replacement, then a committed same-request replay: same receipt, no writes.
  update public.exercise_library set video_url = 'https://www.youtube.com/watch?v=BBBBBBBBBBB' where id = 'e0000000-0000-4000-8000-000000000001';
  select count(*) into count_before from public.workout_exercises;
  select jsonb_agg(to_jsonb(we) order by we.position) into rows from public.workout_exercises we where we.workout_id = (res->>'workout_id')::uuid;
  replay := public.create_quick_session('a0000000-0000-4000-8000-00000000000a', 'c1000000-0000-4000-8000-000000000001', request, hash,
    current_date, 'Synthetic quick', null, exercises);
  perform pg_temp.expect(replay->>'state' = 'replayed' and replay->>'assignment_id' = res->>'assignment_id' and replay->>'workout_id' = res->>'workout_id', 'replayed: ' || replay::text);
  perform pg_temp.expect((select count(*) from public.workout_exercises) = count_before, 'replay inserted no rows');
  select jsonb_agg(to_jsonb(we) order by we.position) into rows_after from public.workout_exercises we where we.workout_id = (res->>'workout_id')::uuid;
  perform pg_temp.expect(rows_after = rows, 'replay rewrote no rows');
  replay := public.create_quick_session('a0000000-0000-4000-8000-00000000000a', 'c1000000-0000-4000-8000-000000000001', request, 'v1:' || repeat('6', 64),
    current_date, 'Synthetic quick', null, exercises);
  perform pg_temp.expect(replay->>'state' = 'request_mismatch', 'different fingerprint mismatches: ' || replay::text);

  select jsonb_agg(to_jsonb(we) order by we.id) into legacy_after from public.workout_exercises we
  where we.video_link_mode is null and we.workout_id <> (res->>'workout_id')::uuid;
  perform pg_temp.expect(legacy_after is not distinct from legacy_before, 'pre-existing legacy rows untouched');

  -- Quick -> shared library copy keeps inheritance live.
  tpl := public.save_quick_session_to_library('a0000000-0000-4000-8000-00000000000a', (res->>'assignment_id')::uuid);
  perform pg_temp.expect(tpl->>'state' = 'saved', 'quick saved to library: ' || tpl::text);
  select jsonb_agg(jsonb_build_array(video_link_mode, video_url) order by position) into rows from public.workout_exercises where workout_id = (tpl->>'template_id')::uuid;
  perform pg_temp.expect(rows = '[["inherit", null], ["override", "https://youtu.be/CCCCCCCCCCC"], [null, null], ["override", "https://example.com/legacy-demo"]]'::jsonb, 'quick library copy modes: ' || rows::text);
end $$;

-- ----- A library link replacement never touches workout rows --------------------
do $$
declare w uuid; before jsonb; after jsonb;
begin
  w := public.save_workout(null, 'a0000000-0000-4000-8000-00000000000a', 'Synthetic replacement workout', null, null, jsonb_build_array(
    jsonb_build_object('exercise_library_id', 'e0000000-0000-4000-8000-000000000004', 'video_link_mode', 'inherit', 'video_url', '')));
  select jsonb_agg(to_jsonb(we)) into before from public.workout_exercises we where we.workout_id = w;
  update public.exercise_library set video_url = 'https://youtu.be/FFFFFFFFFFF' where id = 'e0000000-0000-4000-8000-000000000004';
  select jsonb_agg(to_jsonb(we)) into after from public.workout_exercises we where we.workout_id = w;
  perform pg_temp.expect(after = before, 'library replacement wrote no workout row');
end $$;
