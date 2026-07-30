-- ============================================================
-- PR-A (roadmap Track 1, docs/roadmap.md): per-set actor attribution
-- and optional session linkage for workout logs.
--
-- Schema-only. No behavior change: every mutating workout-log route is
-- requireClient today, so the 'client' default is a factually correct
-- backfill for all existing rows, not an assumption. Coach writes arrive
-- in PR-B (start_workout_log_v2 + actor-aware route guards).
--
-- Decisions implemented (owner, 2026-07-30):
--   D1 per-set attribution, immutable   D3 session -> many workouts
--   D4 workout -> at most one session   D6 linkage optional (nullable)
-- Mirrors the waiver_signatures entered_by / entered_by_coach_id shape.
-- ============================================================

-- ---------- Per-set attribution ----------
alter table public.workout_log_sets
  add column if not exists entered_by text not null default 'client'
    check (entered_by in ('client', 'coach')),
  add column if not exists entered_by_coach_id uuid references public.coaches(id);

-- entered_by = 'coach' iff a coach id is snapshotted (both or neither).
alter table public.workout_log_sets
  drop constraint if exists workout_log_sets_entered_by_pair_check;
alter table public.workout_log_sets
  add constraint workout_log_sets_entered_by_pair_check
    check ((entered_by = 'coach') = (entered_by_coach_id is not null));

-- ---------- Workout start attribution + optional session link ----------
alter table public.workout_logs
  add column if not exists session_id uuid references public.sessions(id),
  add column if not exists started_by text not null default 'client'
    check (started_by in ('client', 'coach')),
  add column if not exists started_by_coach_id uuid references public.coaches(id);

alter table public.workout_logs
  drop constraint if exists workout_logs_started_by_pair_check;
alter table public.workout_logs
  add constraint workout_logs_started_by_pair_check
    check ((started_by = 'coach') = (started_by_coach_id is not null));

create index if not exists idx_workout_logs_session
  on public.workout_logs(session_id)
  where session_id is not null;

-- Existing table-level service_role grants cover the new columns; the
-- prevent_completed_workout_* triggers continue to seal completed logs.

select 'workout set attribution and session link ready' as result;
