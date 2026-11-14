-- New functions and the ledger are service-role only.
do $$
declare f text;
begin
  foreach f in array array['apply_workout_set_event_v3','mark_workout_exercise_not_set_tracked','skip_workout_exercise_sets',
    'finish_workout_log_v3','undo_workout_material_change','workout_log_material_fingerprint','sync_workout_exercises','clone_workout',
    'sync_workout_exercises_core_20261016','clone_workout_core_20261016'] loop
    assert not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = f and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))), format('%s not for browsers', f);
  end loop;
  assert has_function_privilege('service_role', 'public.undo_workout_material_change(uuid, uuid, uuid, text, uuid)', 'execute'), 'service role';
  assert not has_table_privilege('anon', 'public.workout_material_changes', 'select'), 'ledger closed to anon';
  assert not has_table_privilege('authenticated', 'public.workout_material_changes', 'select'), 'ledger closed to authenticated';
  assert (select relrowsecurity from pg_class where oid = 'public.workout_material_changes'::regclass), 'rls on';
  assert not has_table_privilege('service_role', 'public.workout_material_changes', 'delete'), 'append-only for service';
end $$;
