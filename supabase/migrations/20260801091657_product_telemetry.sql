-- First-party operational telemetry. Express remains the only write/read
-- boundary: RLS is enabled with no policies and only service_role receives
-- grants. Properties are constrained to a JSON object and filtered again by
-- the mounted route before insert; message content, notes, email, and health
-- data are never accepted.
create table public.product_events (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null unique,
  event_name text not null check (event_name in (
    'workout_started',
    'workout_completed',
    'workout_abandoned',
    'booking_requested',
    'booking_outcome_viewed',
    'message_replied',
    'check_in_submitted',
    'check_in_reviewed',
    'pwa_install_requested',
    'pwa_install_accepted',
    'frontend_error',
    'training_plan_viewed'
  )),
  actor_role text not null check (actor_role in ('client', 'coach', 'admin')),
  coach_id uuid references public.coaches(id),
  client_id uuid references public.clients(id),
  occurred_at timestamptz not null,
  properties jsonb not null default '{}'::jsonb check (jsonb_typeof(properties) = 'object'),
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create index idx_product_events_name_time
  on public.product_events(event_name, occurred_at desc)
  where archived = false;
create index idx_product_events_client_time
  on public.product_events(client_id, occurred_at desc)
  where archived = false and client_id is not null;
create index idx_product_events_coach_time
  on public.product_events(coach_id, occurred_at desc)
  where archived = false and coach_id is not null;

alter table public.product_events enable row level security;
grant select, insert, update on table public.product_events to service_role;

comment on table public.product_events is
  'Privacy-filtered product and reliability events written only by the Express service-role boundary.';

select 'product telemetry ready' as result;
