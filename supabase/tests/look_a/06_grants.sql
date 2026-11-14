-- New functions and the ledger are service-role only.
do $$
declare f text;
begin
  foreach f in array array['apply_workout_set_event_v3','mark_workout_exercise_not_set_tracked','skip_workout_exercise_sets',
    'finish_workout_log_v3','undo_workout_material_change','workout_log_material_fingerprint','sync_workout_exercises','clone_workout',
    'sync_workout_exercises_core_20261016','clone_workout_core_20261016','workout_current_undo','look_a_change_undoable',
    'look_a_require_completed_log','look_a_load_range','look_a_bump_material_seq','look_a_undo_blocker','quick_complete_workout_v3','get_workout_exercise_history_v3','commit_program_import','workout_rescue_original','read_workout_rescue','activate_workout_substitution','apply_program_substitution','create_workout_substitution_v3'] loop
    assert not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = f and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))), format('%s not for browsers', f);
  end loop;
  assert has_function_privilege('service_role', 'public.undo_workout_material_change(uuid, uuid, uuid, text, uuid)', 'execute'), 'service role';
  assert not has_table_privilege('anon', 'public.workout_material_changes', 'select'), 'ledger closed to anon';
  assert not has_table_privilege('authenticated', 'public.workout_material_changes', 'select'), 'ledger closed to authenticated';
  assert (select relrowsecurity from pg_class where oid = 'public.workout_material_changes'::regclass), 'rls on';
  assert not has_table_privilege('service_role', 'public.workout_material_changes', 'delete'), 'append-only for service';
  assert not has_table_privilege('anon', 'public.workout_set_event_requests', 'select'), 'event requests closed to anon';
  assert not has_table_privilege('authenticated', 'public.workout_set_event_requests', 'select'), 'event requests closed to authenticated';
  assert (select relrowsecurity from pg_class where oid = 'public.workout_set_event_requests'::regclass), 'rls on requests';
  assert not has_table_privilege('service_role', 'public.workout_set_event_requests', 'update'), 'requests append-only';
end $$;
