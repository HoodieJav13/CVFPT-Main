-- Coach Notes: private notes on a client for the coaches authorized for that
-- client (the client's coach and admins). They are never part of a client-facing
-- payload: a separate table, so the client's own profile reads (which select
-- the whole clients row) cannot carry them. Express remains the authorization
-- boundary; browsers get no grants and RLS has no policies.

create table if not exists public.client_coach_notes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  author_coach_id uuid not null references public.coaches(id),
  author_name_snapshot text not null check (btrim(author_name_snapshot) <> ''),
  content text not null check (
    content = btrim(content)
    and char_length(content) between 1 and 4000
  ),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_client_coach_notes_client_recent
  on public.client_coach_notes(client_id, created_at desc, id desc)
  where archived = false;

alter table public.client_coach_notes enable row level security;
revoke all privileges on table public.client_coach_notes from public, anon, authenticated, service_role;
-- No DELETE: business rows are archived, never removed.
grant select, insert, update on table public.client_coach_notes to service_role;
