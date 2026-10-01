-- Recurring sessions: schema. Additive and backward-compatible — a new table
-- plus two nullable columns on sessions. Existing callers are unaffected.
--
-- A series is a batch of ordinary sessions linked by sessions.series_id.
-- `rule` is display-only (never used to regenerate). `receipt` is the
-- immutable creation record (original slot keys, session ids, times) that makes
-- a retried request recoverable. (coach_id, request_id) is the idempotency key.

create table if not exists public.session_series (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.coaches(id),
  client_id uuid not null references public.clients(id),
  program_id uuid references public.programs(id),
  rule jsonb not null,
  created_count integer not null check (created_count between 1 and 52),
  request_id uuid not null,
  request_hash text not null,
  receipt jsonb not null,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (coach_id, request_id)
);

create index if not exists idx_session_series_client on public.session_series(client_id);

alter table public.session_series enable row level security;
grant select, insert, update on table public.session_series to service_role;

alter table public.sessions
  add column if not exists series_id uuid references public.session_series(id);
alter table public.sessions
  add column if not exists series_ordinal integer check (series_ordinal is null or series_ordinal >= 1);

create index if not exists idx_sessions_series
  on public.sessions(series_id) where series_id is not null;

select 'session series schema ready' as result;
