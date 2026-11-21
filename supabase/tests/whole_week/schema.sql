-- Standalone fixture schema for the whole-week SQL tests: Supabase-like roles,
-- auth.users and the baseline coaches/clients columns copied from
-- supabase/migrations/20260710151327_baseline_schema.sql. Fictional/local only;
-- no hosted identifiers, URLs or credentials. Used by pglite-check.mjs
-- (standalone mode) and concurrency.sh before the whole-week migration.
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role bypassrls; exception when duplicate_object then null; end $$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);

create table if not exists public.coaches (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id),
  name text not null,
  email text not null unique,
  phone text,
  is_admin boolean not null default false,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.coaches(id),
  name text not null,
  email text,
  phone text,
  goals text,
  health_notes text,
  invited boolean not null default false,
  auth_user_id uuid unique references auth.users(id),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Mirrors the existing service-only data API: RLS on, no browser grants.
-- The feature reads completed workout counts in its authorized transaction.
alter table public.coaches enable row level security;
alter table public.clients enable row level security;
revoke all on public.coaches, public.clients from public, anon, authenticated;
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update on public.coaches, public.clients to service_role;

create table if not exists public.workout_logs (id uuid primary key default gen_random_uuid(),client_id uuid references public.clients(id),completed_at timestamptz,status text,archived boolean not null default false);
alter table public.workout_logs enable row level security;
revoke all on public.workout_logs from public,anon,authenticated;
grant select,insert,update on public.workout_logs to service_role;
