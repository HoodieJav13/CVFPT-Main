-- Single-session behaviour for two private programs sharing one workout:
-- the second program's earlier preview is stale after the first application;
-- a fresh preview of it is empty, and nothing is replaced twice.
do $$
declare
  w constant uuid := '00000000-0000-4000-8000-000000000005';
  s constant uuid := '00000000-0000-4000-8000-000000000073';
  c constant uuid := '00000000-0000-4000-8000-000000000001';
  ids1 uuid[]; ids2 uuid[]; r jsonb; n integer; failed boolean;
begin
  select array_agg(workout_exercise_id order by day_number) into ids1 from public.program_substitution_targets('00000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000051', 'Original');
  select array_agg(workout_exercise_id order by day_number) into ids2 from public.program_substitution_targets('00000000-0000-4000-8000-000000000017', '00000000-0000-4000-8000-000000000051', 'Original');
  assert array_length(ids1, 1) = 2 and array_length(ids2, 1) = 1 and ids2[1] = ids1[1], format('both programs preview the same physical row: %s / %s', ids1, ids2);
  r := public.apply_program_substitution('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000007', s, c, ids1, '{"sets":2}'::jsonb);
  assert r->>'outcome' = 'applied';
  failed := false;
  begin
    perform public.apply_program_substitution('00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000017', s, c, ids2, '{"sets":2}'::jsonb);
  exception when others then failed := sqlerrm like '%preview_mismatch%';
  end;
  assert failed, 'the second program''s earlier preview must be stale';
  select count(*) into n from public.workout_exercises where workout_id = w and not archived;
  assert n = 1, format('one active row in the shared workout, found %s', n);
  select count(*) into n from public.program_substitution_targets('00000000-0000-4000-8000-000000000017', '00000000-0000-4000-8000-000000000051', 'Original');
  assert n = 0, 'a fresh preview of the second program is empty';
end $$;
