alter table public.metrics
  add column if not exists improvement_direction text not null default 'neutral';

alter table public.metrics
  drop constraint if exists metrics_improvement_direction_check;

alter table public.metrics
  add constraint metrics_improvement_direction_check
  check (improvement_direction in ('higher', 'lower', 'neutral'));

comment on column public.metrics.improvement_direction is
  'Defines whether higher or lower values represent improvement; neutral metrics never produce personal-record celebrations.';
