-- Program 011 Phase C: one-way coach announcements (owner decisions,
-- design-plans/011): coach → their clients, admin may go studio-wide,
-- replies impossible by design, never a standalone email (a digest line
-- only), coach sees a seen-count. Soft-delete via archived; reads are
-- insert-only per (announcement, client).

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.coaches(id),
  content text not null check (btrim(content) <> ''),
  studio_wide boolean not null default false,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_announcements_coach
  on public.announcements(coach_id, archived, created_at desc);

create table if not exists public.announcement_reads (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.announcements(id),
  client_id uuid not null references public.clients(id),
  read_at timestamptz not null default now(),
  unique(announcement_id, client_id)
);

create index if not exists idx_announcement_reads_client
  on public.announcement_reads(client_id);

alter table public.announcements enable row level security;
alter table public.announcement_reads enable row level security;

grant select, insert, update on table public.announcements to service_role;
grant select, insert on table public.announcement_reads to service_role;
