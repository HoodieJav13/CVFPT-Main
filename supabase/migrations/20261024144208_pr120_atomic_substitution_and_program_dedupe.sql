-- PR120 review repairs (forward-only; the applied 20261023000000 file is unchanged).
--
-- 1. decide_workout_substitution (review 4366537631): a coach's approve or
--    decline of a pending swap is one transaction. The workout log and the swap
--    are row-locked, so the first decision wins and a competing one sees it;
--    the same decision event replays; an approval activates the replacement
--    and records the decision together, so any failure rolls both back and a
--    declined swap can never have changed the workout. Approval needs an active
--    workout (unchanged rule). Express keeps authorization: the route checks
--    the coach and the log before calling this.
--
-- 2. apply_program_substitution (review 4366537642): a private workout reused
--    on several program days is one physical row per exercise, so it is now
--    replaced once. The preview comparison (one entry per day) and the per-day
--    audit are unchanged; replay by application id and stale-preview refusal
--    are unchanged.
--
-- Both functions are SECURITY INVOKER with an empty search_path, callable only
-- by service_role (no public/anon/authenticated execute), matching the
-- existing conductor functions. No table, RLS or setting changes.

create or replace function public.decide_workout_substitution(
  p_log_id uuid, p_sub_id uuid, p_decision text, p_event_id uuid, p_coach_id uuid
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_log public.workout_logs;
  v_sub public.workout_log_substitutions;
begin
  if p_decision not in ('approve', 'decline') then raise exception 'invalid_decision'; end if;
  -- Lock order matches create_workout_substitution: the log, then the swap.
  select * into v_log from public.workout_logs where id = p_log_id for update;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  select * into v_sub from public.workout_log_substitutions where id = p_sub_id and workout_log_id = p_log_id for update;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  if v_sub.decision_event_id = p_event_id then
    return jsonb_build_object('outcome', 'replayed', 'substitution', to_jsonb(v_sub));
  end if;
  if v_sub.status <> 'pending_confirmation' then
    return jsonb_build_object('outcome', 'already_decided', 'substitution', to_jsonb(v_sub));
  end if;
  if p_decision = 'approve' then
    if v_log.status <> 'active' then return jsonb_build_object('outcome', 'log_not_active', 'substitution', to_jsonb(v_sub)); end if;
    perform public.activate_workout_substitution(v_sub.id);
  end if;
  update public.workout_log_substitutions
  set status = case when p_decision = 'approve' then 'active' else 'declined' end,
      decided_by_coach_id = p_coach_id, decided_at = now(), decision_event_id = p_event_id
  where id = v_sub.id
  returning * into v_sub;
  return jsonb_build_object('outcome', p_decision, 'substitution', to_jsonb(v_sub));
end;
$$;

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

revoke all on function public.decide_workout_substitution(uuid, uuid, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.apply_program_substitution(uuid, uuid, uuid, uuid, uuid[], jsonb) from public, anon, authenticated;
grant execute on function public.decide_workout_substitution(uuid, uuid, text, uuid, uuid) to service_role;
grant execute on function public.apply_program_substitution(uuid, uuid, uuid, uuid, uuid[], jsonb) to service_role;
