-- ============================================================
-- Goal measures (round-2 design decision, owner 2026-09-29/30).
--
-- Coaches pick which of a client's existing progress metrics measure that
-- client's goal; those show on the client's home and in the coach's
-- clients-by-goal list. The pick is a flag on the metric itself, so it
-- inherits the metric's ownership and soft-archive rules. Default false:
-- nothing changes for any client until a coach turns a measure on. The
-- limit of three per client is enforced in the API. The optional goal
-- number stays the existing target_value.
-- ============================================================

alter table public.metrics
  add column if not exists is_goal_measure boolean not null default false;

comment on column public.metrics.is_goal_measure is
  'Coach-picked: this metric measures the client''s goal and is shown on their home. Max three per client (API-enforced).';

create index if not exists idx_metrics_client_goal_measure
  on public.metrics(client_id)
  where is_goal_measure = true and archived = false;

select 'metric goal measures ready' as result;
