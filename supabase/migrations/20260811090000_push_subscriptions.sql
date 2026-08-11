-- Program 012: web-push device subscriptions. Keyed by auth_user_id (only
-- logged-in coaches and claimed clients can subscribe); one row per device
-- endpoint; soft-archived — including automatically when the push provider
-- reports the endpoint gone (404/410). Device artifacts, not business
-- records, but the soft-delete model is kept anyway.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_push_subscriptions_user
  on public.push_subscriptions(auth_user_id) where archived = false;

alter table public.push_subscriptions enable row level security;
grant select, insert, update on table public.push_subscriptions to service_role;
