-- Coach-managed PDF handouts. Express remains the authorization boundary;
-- application tables are reachable only through the backend service-role client.

create table if not exists public.resource_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now(),
  constraint resource_categories_name_not_blank check (btrim(name) <> '')
);

-- The ordinary UNIQUE constraint preserves the requested schema contract; this
-- expression index also closes case/whitespace duplicate races.
create unique index if not exists idx_resource_categories_name_ci
  on public.resource_categories (lower(btrim(name)));

create table if not exists public.resource_library (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  category_id uuid references public.resource_categories(id),
  storage_path text not null,
  file_name text not null,
  file_size_bytes integer,
  is_public boolean not null default false,
  archived boolean not null default false,
  uploaded_by_coach_id uuid not null references public.coaches(id),
  created_at timestamptz not null default now(),
  constraint resource_library_title_not_blank check (btrim(title) <> ''),
  constraint resource_library_storage_path_not_blank check (btrim(storage_path) <> ''),
  constraint resource_library_file_name_not_blank check (btrim(file_name) <> ''),
  constraint resource_library_file_size_nonnegative check (
    file_size_bytes is null or file_size_bytes >= 0
  )
);

create index if not exists idx_resource_library_category
  on public.resource_library(category_id);
create index if not exists idx_resource_library_uploader
  on public.resource_library(uploaded_by_coach_id);
create index if not exists idx_resource_library_active_visibility
  on public.resource_library(archived, is_public);

create table if not exists public.resource_assignments (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.resource_library(id),
  client_id uuid not null references public.clients(id),
  active boolean not null default true,
  assigned_at timestamptz not null default now(),
  unique(resource_id, client_id)
);

create index if not exists idx_resource_assignments_client_active
  on public.resource_assignments(client_id, active);

alter table public.resource_categories enable row level security;
alter table public.resource_library enable row level security;
alter table public.resource_assignments enable row level security;

revoke all privileges on table public.resource_categories
  from public, anon, authenticated, service_role;
revoke all privileges on table public.resource_library
  from public, anon, authenticated, service_role;
revoke all privileges on table public.resource_assignments
  from public, anon, authenticated, service_role;

grant select, insert, update on table public.resource_categories to service_role;
grant select, insert, update on table public.resource_library to service_role;
grant select, insert, update on table public.resource_assignments to service_role;

insert into public.resource_categories (name)
values
  ('General Info'),
  ('Injury & Recovery'),
  ('Nutrition')
on conflict do nothing;

-- Storage buckets are Postgres-backed and can be created in the versioned
-- migration. Keep the bucket private and enforce PDF/10 MB limits at Storage in
-- addition to the backend's multer and PDF-signature checks.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'resource-library',
  'resource-library',
  false,
  10485760,
  array['application/pdf']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
