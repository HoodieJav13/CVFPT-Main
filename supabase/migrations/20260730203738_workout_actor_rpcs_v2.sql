-- ============================================================
-- PR-A part 2 (roadmap Track 1): actor-aware v2 RPCs.
--
-- Inert until the follow-up route work calls them. v1 functions are left
-- untouched and dormant per the standing no-cleanup rule; do not drop
-- them without an explicit decision.
--
-- start_workout_log_v2 wraps v1 (no logic duplication): validates the
-- actor pair and optional session link, delegates, then stamps
-- started_by / started_by_coach_id / session_id only on a fresh start.
-- complete_all_workout_sets_v2 mirrors v1's small body and additionally
-- stamps entered_by on the sets it flips to completed.
-- ============================================================

create or replace function public.start_workout_log_v2(
  p_client_id uuid,
  p_program_assignment_id uuid,
  p_program_day_id uuid,
  p_workout_assignment_id uuid,
  p_started_by text,
  p_started_by_coach_id uuid,
  p_session_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
  v_session_client uuid;
begin
  if p_started_by is null or p_started_by not in ('client', 'coach') then
    raise exception 'Invalid starting actor';
  end if;
  if (p_started_by = 'coach') <> (p_started_by_coach_id is not null) then
    raise exception 'Starting actor and coach snapshot are inconsistent';
  end if;
  if p_session_id is not null then
    select client_id into v_session_client from public.sessions
    where id = p_session_id and archived = false;
    if v_session_client is null or v_session_client <> p_client_id then
      raise exception 'Session not found for this client';
    end if;
  end if;

  v_result := public.start_workout_log(
    p_client_id, p_program_assignment_id, p_program_day_id, p_workout_assignment_id
  );

  if v_result->>'outcome' = 'started' then
    update public.workout_logs
    set started_by = p_started_by,
        started_by_coach_id = p_started_by_coach_id,
        session_id = p_session_id,
        updated_at = now()
    where id = (v_result->>'workout_log_id')::uuid;
  end if;

  return v_result;
end;
$$;

create or replace function public.complete_all_workout_sets_v2(
  p_workout_log_id uuid,
  p_client_id uuid,
  p_entered_by text,
  p_entered_by_coach_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_log public.workout_logs%rowtype;
begin
  if p_entered_by is null or p_entered_by not in ('client', 'coach') then
    raise exception 'Invalid entering actor';
  end if;
  if (p_entered_by = 'coach') <> (p_entered_by_coach_id is not null) then
    raise exception 'Entering actor and coach snapshot are inconsistent';
  end if;

  select * into v_log from public.workout_logs
  where id = p_workout_log_id and client_id = p_client_id and archived = false
  for update;
  if v_log.id is null then raise exception 'Workout log not found'; end if;
  if v_log.status <> 'active' then raise exception 'Workout log is not active'; end if;

  update public.workout_log_sets s
  set status = 'completed', completed_at = now(), updated_at = now(),
      entered_by = p_entered_by, entered_by_coach_id = p_entered_by_coach_id
  from public.workout_log_exercises e
  where s.workout_log_exercise_id = e.id
    and e.workout_log_id = v_log.id
    and e.archived = false and s.archived = false and s.status = 'pending';
  update public.workout_logs set updated_at = now() where id = v_log.id;
  return v_log.id;
end;
$$;

revoke execute on function public.start_workout_log_v2(uuid, uuid, uuid, uuid, text, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.complete_all_workout_sets_v2(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.start_workout_log_v2(uuid, uuid, uuid, uuid, text, uuid, uuid) to service_role;
grant execute on function public.complete_all_workout_sets_v2(uuid, uuid, text, uuid) to service_role;

select 'workout actor rpcs v2 ready' as result;
