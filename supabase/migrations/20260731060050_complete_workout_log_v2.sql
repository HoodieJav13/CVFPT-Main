-- ============================================================
-- Offline completion groundwork (docs/offline-workout-completion.md,
-- approved via PR #16): performance-time completion timestamps.
--
-- Owner decision 2026-07-31: completed_at records when the user confirmed
-- the finish, not when the queued sync landed. v2 mirrors v1's body with a
-- clamped p_completed_at; v1 stays untouched and dormant per the standing
-- no-cleanup rule. Inert until the offline-completion frontend sends the
-- timestamp.
-- ============================================================

create or replace function public.complete_workout_log_v2(
  p_workout_log_id uuid,
  p_client_id uuid,
  p_notes text,
  p_feedback text,
  p_completed_at timestamptz
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_log public.workout_logs%rowtype;
  v_completed_count integer;
  v_completed_at timestamptz;
begin
  select * into v_log from public.workout_logs
  where id = p_workout_log_id and client_id = p_client_id and archived = false
  for update;
  if v_log.id is null then raise exception 'Workout log not found'; end if;
  if v_log.status = 'completed' then return v_log.id; end if;
  if v_log.status <> 'active' then raise exception 'Workout log is not active'; end if;

  -- Performance time, clamped to (started_at, now()]: a missing, malformed,
  -- or out-of-bounds value (wrong device clock) falls back to sync time so
  -- an impossible history can never be written.
  v_completed_at := case
    when p_completed_at is null or p_completed_at <= v_log.started_at or p_completed_at > now()
      then now()
    else p_completed_at
  end;

  select count(*) into v_completed_count
  from public.workout_log_sets s
  join public.workout_log_exercises e on e.id = s.workout_log_exercise_id
  where e.workout_log_id = v_log.id and e.archived = false
    and s.archived = false and s.status = 'completed';
  if v_completed_count < 1 then raise exception 'Complete at least one set'; end if;

  update public.workout_log_sets s
  set status = 'skipped', completed_at = null, updated_at = now()
  from public.workout_log_exercises e
  where s.workout_log_exercise_id = e.id and e.workout_log_id = v_log.id
    and e.archived = false and s.archived = false and s.status = 'pending';

  update public.workout_logs
  set status = 'completed', notes = nullif(btrim(coalesce(p_notes, '')), ''),
      feedback = nullif(btrim(coalesce(p_feedback, '')), ''), completed_at = v_completed_at, updated_at = now()
  where id = v_log.id;

  insert into public.notifications (recipient_coach_id, event_type, workout_log_id)
  select c.id, 'workout_completed', v_log.id
  from public.coaches c
  where c.archived = false and (c.id = v_log.coach_id or c.is_admin = true)
  on conflict (recipient_coach_id, event_type, workout_log_id) do nothing;

  return v_log.id;
end;
$$;

revoke execute on function public.complete_workout_log_v2(uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.complete_workout_log_v2(uuid, uuid, text, text, timestamptz) to service_role;

select 'complete workout log v2 ready' as result;
