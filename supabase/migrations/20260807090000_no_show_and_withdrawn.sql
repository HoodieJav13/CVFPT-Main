-- Phase 7 product decisions (owner, 2026-08-06):
--   D2a: sessions gain a no_show status so coaches stop misusing
--        cancelled/completed for missed sessions; no-shows count against
--        adherence in analytics.
--   D1b: clients may withdraw their own pending booking requests;
--        'withdrawn' stays distinct from 'declined' for honest history.
-- Widening a CHECK is forward-only and backward-compatible: every
-- existing row and every existing write remains valid.

alter table public.sessions drop constraint sessions_status_check;
alter table public.sessions add constraint sessions_status_check
  check (status in ('scheduled','completed','cancelled','no_show'));

alter table public.booking_requests drop constraint booking_requests_status_check;
alter table public.booking_requests add constraint booking_requests_status_check
  check (status in ('pending','approved','declined','withdrawn'));
