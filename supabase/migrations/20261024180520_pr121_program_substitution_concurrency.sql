-- Independent review corrections for program substitution application
-- (forward-only; 20261024144208 and every earlier applied file unchanged).
--
-- apply_program_substitution, same signature and results, now:
-- 1. locks the physical workout_exercises rows it would change (in id order)
--    before validating the preview, so two private programs that share one
--    workout cannot both replace it concurrently: the later one waits, then
--    sees the committed change and is refused as a stale preview;
-- 2. re-reads the application receipt after that wait, so a concurrent retry
--    with the same application id returns 'replayed' instead of a false
--    stale-preview error, and never writes twice.
-- Per-day preview check and audit, replay, client-private scope, soft archive
-- and logged history are unchanged. SECURITY INVOKER, empty search_path,
-- service_role execute only (re-asserted below). No table, RLS or policy change.

create or replace function public.apply_program_substitution(
  p_application_id uuid, p_assignment_id uuid, p_substitution_id uuid, p_coach_id uuid,
  p_expected_ids uuid[], p_targets jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_existing public.program_substitution_applications;
  v_sub public.workout_log_substitutions;
  v_program public.programs;
  v_ids uuid[];
  v_affected jsonb;
  r record;
  v_load numeric;
begin
  select * into v_existing from public.program_substitution_applications where id = p_application_id;
  if found then return jsonb_build_object('outcome', 'replayed', 'application', to_jsonb(v_existing)); end if;
  select * into v_sub from public.workout_log_substitutions where id = p_substitution_id and status = 'active';
  if not found then raise exception 'Substitution not active'; end if;
  select p.* into v_program from public.program_assignments pa join public.programs p on p.id = pa.program_id
  where pa.id = p_assignment_id and pa.client_id = v_sub.client_id and not pa.archived for update of p;
  if not found then raise exception 'Program assignment not found'; end if;
  if v_program.is_template or v_program.client_id is distinct from v_sub.client_id then
    raise exception 'shared_program: this assignment still uses shared template workouts; edit it in the program builder';
  end if;
  -- Serialize on the physical rows this application would change. A private
  -- workout may be shared by several of the client's programs, so the
  -- program lock alone does not cover it. Rows are locked in id order (no
  -- deadlock between applications); a waiter then re-reads committed state.
  perform 1 from public.workout_exercises we where we.id = any(p_expected_ids) order by we.id for update;
  -- The same application may have committed while this one waited: replay it.
  select * into v_existing from public.program_substitution_applications where id = p_application_id;
  if found then return jsonb_build_object('outcome', 'replayed', 'application', to_jsonb(v_existing)); end if;
  -- The preview lists one entry per program day (a reused workout appears
  -- once per day); it must still match exactly.
  select coalesce(array_agg(t.workout_exercise_id order by t.workout_exercise_id), '{}') into v_ids
  from public.program_substitution_targets(p_assignment_id, v_sub.original_exercise_library_id, v_sub.original_name) t;
  if v_ids is distinct from (select coalesce(array_agg(x order by x), '{}') from unnest(p_expected_ids) x) then
    raise exception 'preview_mismatch';
  end if;
  -- Audit every day the change affects, read before anything is archived.
  select coalesce(jsonb_agg(jsonb_build_object('workout_exercise_id', t.workout_exercise_id, 'day_number', t.day_number, 'workout_name', t.workout_name)
           order by t.day_number, t.workout_exercise_id), '[]'::jsonb) into v_affected
  from public.program_substitution_targets(p_assignment_id, v_sub.original_exercise_library_id, v_sub.original_name) t;
  v_load := nullif(p_targets ->> 'load_value', '')::numeric;
  -- Mutate each physical workout exercise exactly once.
  for r in select distinct t.workout_exercise_id
           from public.program_substitution_targets(p_assignment_id, v_sub.original_exercise_library_id, v_sub.original_name) t loop
    insert into public.workout_exercises (workout_id, exercise_library_id, custom_name, sets, reps, rest, tempo,
      default_load_value, default_load_unit, position, superset_group, tracking_type)
    select we.workout_id, v_sub.replacement_exercise_library_id, null,
      nullif(p_targets ->> 'sets', ''), nullif(p_targets ->> 'reps', ''), we.rest, null,
      v_load, case when v_load is null then null else coalesce(nullif(p_targets ->> 'load_unit', ''), 'lb') end,
      we.position, we.superset_group, 'reps_weight'
    from public.workout_exercises we where we.id = r.workout_exercise_id and not we.archived;
    update public.program_assignment_exercise_loads set archived = true where workout_exercise_id = r.workout_exercise_id and not archived;
    update public.workout_exercises set archived = true where id = r.workout_exercise_id;
  end loop;
  insert into public.program_substitution_applications (id, program_assignment_id, substitution_id, coach_id, affected, targets)
  values (p_application_id, p_assignment_id, p_substitution_id, p_coach_id, v_affected, coalesce(p_targets, '{}'::jsonb))
  returning * into v_existing;
  return jsonb_build_object('outcome', 'applied', 'application', to_jsonb(v_existing));
end;
$$;

revoke all on function public.apply_program_substitution(uuid, uuid, uuid, uuid, uuid[], jsonb) from public, anon, authenticated;
grant execute on function public.apply_program_substitution(uuid, uuid, uuid, uuid, uuid[], jsonb) to service_role;
