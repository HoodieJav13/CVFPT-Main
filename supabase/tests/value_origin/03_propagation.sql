-- New plan propagation (the backend's filter): only untouched rows (prefill,
-- or legacy at revision 0 with no actor) take the new prescription and stay
-- prefill under a fresh nonce; entered and unknown rows are never overwritten.
do $$
declare
  ex constant uuid := '00000000-0000-4000-8000-0000000e0001';
  s1 constant uuid := '00000000-0000-4000-8000-0000000f0001';
  s2 constant uuid := '00000000-0000-4000-8000-0000000f0002';
  s3 constant uuid := '00000000-0000-4000-8000-0000000f0003';
  s4 constant uuid := '00000000-0000-4000-8000-0000000f0004';
  r jsonb; k integer;
begin
  -- s1 entered (explicit 50), s2 unknown (old writer), s3 prefill (restored), s4 legacy untouched.
  r := public.apply_workout_set_event_v2(s1, '00000000-0000-4000-8000-0000000c0001', 'client', null, 0, 1, false, 0, '{"actual_load_value":50,"actual_load_unit":"lb"}', 'entered');
  r := public.apply_workout_set_event(s2, '00000000-0000-4000-8000-0000000c0002', 'client', null, 0, 2, false, 0, '{"actual_load_value":50,"actual_load_unit":"lb"}');
  r := public.apply_workout_set_event_v2(s3, '00000000-0000-4000-8000-0000000c0003', 'client', null, 0, 3, false, 0, '{"status":"completed","actual_load_value":null,"actual_load_unit":null}', 'entered');
  r := public.apply_workout_set_event_v2(s3, '00000000-0000-4000-8000-0000000c0004', 'client', null, 1, 4, false, 0, '{"status":"pending","actual_load_value":50,"actual_load_unit":"lb"}', 'prefill');
  assert (select value_origin from public.workout_log_sets where id = s3) = 'prefill', 'setup prefill';

  update public.workout_log_sets set actual_load_value = 60, actual_load_unit = 'lb', value_origin = 'prefill', value_origin_nonce = gen_random_uuid(), updated_at = now()
  where workout_log_exercise_id = ex and status = 'pending' and not archived
    and (value_origin = 'prefill' or (value_origin = 'legacy' and revision = 0 and last_actor_role is null));
  get diagnostics k = row_count;
  assert k = 3, format('propagated rows %s (s3, s4, s5 expected)', k);
  assert (select actual_load_value = 50 and value_origin = 'entered' from public.workout_log_sets where id = s1), 'entered kept';
  assert (select actual_load_value = 50 and value_origin = 'unknown' from public.workout_log_sets where id = s2), 'unknown kept';
  assert (select actual_load_value = 60 and value_origin = 'prefill' and revision = 2 from public.workout_log_sets where id = s3), 'prefill propagated, revision kept';
  assert (select actual_load_value = 60 and value_origin = 'prefill' and revision = 0 from public.workout_log_sets where id = s4), 'legacy untouched propagated';
end $$;
