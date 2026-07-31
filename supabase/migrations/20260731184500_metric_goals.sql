-- ============================================================
-- Metric goals (roadmap Track 6, item 16).
--
-- Coach-set target per metric, client-visible as a goal line on the
-- progress chart (owner ballot decision 1: goal semantics are coach-set,
-- client-visible). Null means no goal; no backfill is needed and no
-- existing behavior changes until a coach sets a target.
-- ============================================================

alter table public.metrics
  add column if not exists target_value numeric;

comment on column public.metrics.target_value is
  'Coach-set goal for this metric; rendered as a goal line on progress charts. Null = no goal.';

select 'metric goals ready' as result;
