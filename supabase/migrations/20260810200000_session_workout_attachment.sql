-- Program 011 Phase B: a session can carry the workout the coach plans to
-- run, so clients see "what we'll do" ahead of time on the session detail
-- page. Nullable and optional — nothing existing changes behavior. The
-- attachment is written by the Express boundary after schedule_session
-- returns (no applied RPC is edited). Soft-delete model unchanged.

alter table public.sessions
  add column if not exists workout_id uuid references public.workouts(id);

create index if not exists idx_sessions_workout on public.sessions(workout_id)
  where workout_id is not null;
