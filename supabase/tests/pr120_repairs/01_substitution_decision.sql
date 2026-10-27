-- Review 4366537631: one atomic, first-wins, replayable swap decision.
do $$
declare
  c constant uuid := '00000000-0000-4000-8000-000000000001';
  log_a constant uuid := '00000000-0000-4000-8000-000000000021';
  r jsonb; n integer; v text; failed boolean;
begin
  -- Approve first: activation and decision commit together.
  r := public.decide_workout_substitution(log_a, '00000000-0000-4000-8000-000000000071', 'approve', '00000000-0000-4000-8000-000000000101', c);
  assert r->>'outcome' = 'approve', format('approve outcome %s', r);
  select status into v from public.workout_log_substitutions where id = '00000000-0000-4000-8000-000000000071';
  assert v = 'active', format('approved status %s', v);
  select count(*) into n from public.workout_log_exercises where id = '00000000-0000-4000-8000-000000000041' and substitution_id = '00000000-0000-4000-8000-000000000071';
  assert n = 1, format('replacement rows %s', n);
  select count(*) into n from public.workout_log_sets where workout_log_exercise_id = '00000000-0000-4000-8000-000000000041';
  assert n = 2, format('target sets %s', n);
  -- A competing decline sees the decision and changes nothing.
  r := public.decide_workout_substitution(log_a, '00000000-0000-4000-8000-000000000071', 'decline', '00000000-0000-4000-8000-000000000102', c);
  assert r->>'outcome' = 'already_decided', format('competing decline %s', r);
  select status into v from public.workout_log_substitutions where id = '00000000-0000-4000-8000-000000000071';
  assert v = 'active';
  -- The same event replays without a second activation.
  r := public.decide_workout_substitution(log_a, '00000000-0000-4000-8000-000000000071', 'approve', '00000000-0000-4000-8000-000000000101', c);
  assert r->>'outcome' = 'replayed', format('replay %s', r);
  select count(*) into n from public.workout_log_exercises where substitution_id = '00000000-0000-4000-8000-000000000071';
  assert n = 1;

  -- Decline first: the workout is never changed, a later approve is refused.
  r := public.decide_workout_substitution(log_a, '00000000-0000-4000-8000-000000000072', 'decline', '00000000-0000-4000-8000-000000000103', c);
  assert r->>'outcome' = 'decline', format('decline %s', r);
  r := public.decide_workout_substitution(log_a, '00000000-0000-4000-8000-000000000072', 'approve', '00000000-0000-4000-8000-000000000104', c);
  assert r->>'outcome' = 'already_decided', format('approve after decline %s', r);
  select count(*) into n from public.workout_log_exercises where id = '00000000-0000-4000-8000-000000000043' or substitution_id = '00000000-0000-4000-8000-000000000072';
  assert n = 0, format('declined swap changed the workout: %s rows', n);
  select status into v from public.workout_log_substitutions where id = '00000000-0000-4000-8000-000000000072';
  assert v = 'declined';

  -- An activation failure rolls back the whole decision.
  failed := false;
  begin
    perform public.decide_workout_substitution(log_a, '00000000-0000-4000-8000-000000000074', 'approve', '00000000-0000-4000-8000-000000000105', c);
  exception when others then failed := true;
  end;
  assert failed, 'activation with invalid targets should fail';
  select status into v from public.workout_log_substitutions where id = '00000000-0000-4000-8000-000000000074';
  assert v = 'pending_confirmation', format('failed approval left status %s', v);
  select count(*) into n from public.workout_log_exercises where id = '00000000-0000-4000-8000-000000000044';
  assert n = 0, 'failed approval left a replacement exercise';
  -- ... and the swap can still be decided afterwards.
  r := public.decide_workout_substitution(log_a, '00000000-0000-4000-8000-000000000074', 'decline', '00000000-0000-4000-8000-000000000106', c);
  assert r->>'outcome' = 'decline';

  -- A finished workout refuses approval and keeps its history.
  r := public.decide_workout_substitution('00000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-000000000075', 'approve', '00000000-0000-4000-8000-000000000107', c);
  assert r->>'outcome' = 'log_not_active', format('completed approve %s', r);
  select count(*) into n from public.workout_log_exercises where workout_log_id = '00000000-0000-4000-8000-000000000022';
  assert n = 1, 'completed log exercises changed';
  select status into v from public.workout_log_substitutions where id = '00000000-0000-4000-8000-000000000075';
  assert v = 'pending_confirmation';

  -- Scope: a swap is only decided through its own log; unknown ids are not found.
  r := public.decide_workout_substitution('00000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-000000000071', 'decline', '00000000-0000-4000-8000-000000000108', c);
  assert r->>'outcome' = 'not_found', format('cross-log %s', r);
  failed := false;
  begin
    perform public.decide_workout_substitution(log_a, '00000000-0000-4000-8000-000000000072', 'maybe', '00000000-0000-4000-8000-000000000109', c);
  exception when others then failed := sqlerrm like '%invalid_decision%';
  end;
  assert failed, 'invalid decision value must raise';

  -- The original logged exercise is retained unchanged.
  select count(*) into n from public.workout_log_exercises where id = '00000000-0000-4000-8000-000000000031' and not archived and exercise_library_id = '00000000-0000-4000-8000-000000000051';
  assert n = 1, 'original exercise changed';
end $$;
