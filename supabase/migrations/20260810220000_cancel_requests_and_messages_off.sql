-- Program 011 Phase D (owner decisions, design-plans/011):
--   * Ask-to-cancel replaces the inside-24h dead-end for every coach: the
--     client's request becomes an in-app notification (+ email) and the
--     coach cancels from it.
--   * coaches.messages_disabled lets a coach pause client messages safely —
--     announcements and the ask-to-cancel path keep working.
-- Notifications gain a session-scoped event: workout_log_id relaxes to
-- nullable with a per-event integrity CHECK, and cancel requests dedupe
-- via a partial unique index (the original unique constraint ignores rows
-- whose workout_log_id is null). Forward-only; every existing row and
-- write remains valid.

alter table public.coaches
  add column if not exists messages_disabled boolean not null default false;

alter table public.notifications alter column workout_log_id drop not null;
alter table public.notifications
  add column if not exists session_id uuid references public.sessions(id);

alter table public.notifications drop constraint notifications_event_type_check;
alter table public.notifications add constraint notifications_event_type_check
  check (event_type in ('workout_completed', 'workout_started', 'cancel_requested'));

alter table public.notifications add constraint notifications_event_target_check
  check (
    (event_type in ('workout_completed', 'workout_started') and workout_log_id is not null)
    or (event_type = 'cancel_requested' and session_id is not null)
  ) not valid;
alter table public.notifications validate constraint notifications_event_target_check;

create unique index if not exists uq_notifications_cancel_request
  on public.notifications(recipient_coach_id, event_type, session_id)
  where session_id is not null;
