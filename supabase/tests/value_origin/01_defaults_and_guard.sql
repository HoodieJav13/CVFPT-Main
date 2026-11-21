-- Defaults and the guard: every writer that does not declare an origin (old
-- RPC, legacy PATCH, finish/complete-all, plan propagation without a nonce)
-- leaves a changed set as 'unknown', never as a stale 'prefill'.
do $$
declare
  s1 constant uuid := '00000000-0000-4000-8000-0000000f0001';
  s2 constant uuid := '00000000-0000-4000-8000-0000000f0002';
  s3 constant uuid := '00000000-0000-4000-8000-0000000f0003';
  s4 constant uuid := '00000000-0000-4000-8000-0000000f0004';
  s5 constant uuid := '00000000-0000-4000-8000-0000000f0005';
  r jsonb; v text; n uuid;
begin
  select value_origin, value_origin_nonce into v, n from public.workout_log_sets where id = s1;
  assert v = 'legacy' and n is null, format('default origin %s nonce %s', v, n);
  assert (select prefill_load_value is null and prefill_load_unit is null from public.workout_log_sets where id = s1), 'default snapshot';

  -- Old RPC (v1, unchanged signature) applies the write; origin becomes unknown.
  r := public.apply_workout_set_event(s1, '00000000-0000-4000-8000-0000000a0001', 'client', null, 0, 1, false, 0, '{"actual_load_value":50,"actual_load_unit":"lb"}');
  assert r->>'outcome' = 'applied', format('v1 outcome %s', r);
  select value_origin into v from public.workout_log_sets where id = s1;
  assert v = 'unknown', format('v1 origin %s', v);
  assert r->'set'->>'value_origin' = 'unknown', format('v1 response row %s', r->'set');

  -- Legacy no-event PATCH style write.
  update public.workout_log_sets set actual_load_value = 55, entered_by = 'client', updated_at = now() where id = s2;
  select value_origin into v from public.workout_log_sets where id = s2;
  assert v = 'unknown', format('legacy patch origin %s', v);

  -- An undeclared writer cannot claim an origin by itself (nonce unchanged).
  update public.workout_log_sets set value_origin = 'prefill' where id = s3;
  select value_origin into v from public.workout_log_sets where id = s3;
  assert v = 'legacy', format('self-claimed origin kept: %s', v);
  update public.workout_log_sets set value_origin = 'entered', prefill_load_value = 1, prefill_load_unit = 'lb' where id = s3;
  assert (select value_origin = 'legacy' and prefill_load_value is null from public.workout_log_sets where id = s3), 'self-claimed snapshot kept';

  -- Finish / complete-all style status change.
  update public.workout_log_sets set status = 'completed', completed_at = now(), updated_at = now() where id = s4;
  select value_origin into v from public.workout_log_sets where id = s4;
  assert v = 'unknown', format('complete-all origin %s', v);

  -- Old plan propagation (no nonce) on an untouched row.
  update public.workout_log_sets set actual_load_value = 60, actual_load_unit = 'lb', updated_at = now()
  where id = s5 and status = 'pending' and revision = 0 and not archived;
  select value_origin into v from public.workout_log_sets where id = s5;
  assert v = 'unknown', format('old propagation origin %s', v);

  -- Archive-only (rescue) does not touch values or updated_at: origin unchanged.
  update public.workout_log_sets set archived = true where id = s3;
  select value_origin into v from public.workout_log_sets where id = s3;
  assert v = 'legacy', format('archive-only origin %s', v);
end $$;
