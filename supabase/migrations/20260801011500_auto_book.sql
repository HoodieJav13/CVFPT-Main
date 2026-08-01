-- ============================================================
-- Auto-book (roadmap v3 Track 1 item 2, decision D3).
--
-- Per-coach opt-in: when enabled, a client picking an offered open
-- slot books instantly through the existing transactional approve
-- path (approve_booking) instead of waiting on manual approval. Each
-- coach flips their own flag behind a confirmation dialog; default off
-- preserves today's request -> approve flow exactly. Inert until a
-- coach opts in. The coaches table already carries RLS and the
-- service-role grant set from the baseline hardening.
-- ============================================================

alter table public.coaches
  add column if not exists auto_book boolean not null default false;

comment on column public.coaches.auto_book is
  'D3: coach-controlled opt-in. True = offered open slots book instantly via the transactional approve path. Default off.';

select 'auto book ready' as result;
