-- Program 011 Phase A: signals for the daily-rhythm Home.
--   * workout_started notification type (in-app; coach sees "in the gym now")
--   * quick_completed flag distinguishing one-tap "done, not tracked" logs
--     from fully-tracked ones, so adherence counts both but coaches can see
--     who is actually logging detail.
-- Forward-only and backward-compatible: widening a CHECK and adding a
-- defaulted boolean leave every existing row and write valid. Started
-- notifications and their reconciliation on completion live in the Express
-- boundary (routes/workoutLogs.js), so no applied RPC is edited here.

alter table public.notifications drop constraint notifications_event_type_check;
alter table public.notifications add constraint notifications_event_type_check
  check (event_type in ('workout_completed', 'workout_started'));

alter table public.workout_logs
  add column if not exists quick_completed boolean not null default false;
