-- ============================================================
-- CVF PT (Core Value Fitness) - Full Database Schema v1
-- Canonical baseline; apply through the versioned Supabase migrations.
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- Coaches (3 at launch; one flagged admin) ----------
create table if not exists coaches (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id),
  name text not null,
  email text not null unique,
  phone text,
  is_admin boolean not null default false,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- Clients (profile is SEPARATE from login account) ----------
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references coaches(id),
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
create index if not exists idx_clients_coach on clients(coach_id);
create index if not exists idx_clients_email on clients(lower(email));

-- ---------- Sessions ----------
create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id),
  coach_id uuid not null references coaches(id),
  scheduled_at timestamptz not null,
  duration_minutes int not null default 60,
  location text,
  status text not null default 'scheduled' check (status in ('scheduled','completed','cancelled')),
  credit_deducted boolean not null default false,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_sessions_coach on sessions(coach_id, scheduled_at);
create index if not exists idx_sessions_client on sessions(client_id, scheduled_at);

-- ---------- Session notes ----------
create table if not exists session_notes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id),
  coach_id uuid not null references coaches(id),
  content text not null,
  shared_with_client boolean not null default false,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_session_notes_session on session_notes(session_id);

-- ---------- Progress: named metrics with dated entries ----------
create table if not exists metrics (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id),
  name text not null,
  unit text,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_metrics_client on metrics(client_id);

create table if not exists metric_entries (
  id uuid primary key default gen_random_uuid(),
  metric_id uuid not null references metrics(id),
  value numeric not null,
  notes text,
  recorded_on date not null default current_date,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_metric_entries_metric on metric_entries(metric_id, recorded_on);

-- ---------- Daily check-ins (non-nutrition self-logging) ----------
create table if not exists check_ins (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id),
  coach_id uuid not null references coaches(id),
  check_in_date date not null default current_date,
  energy int check (energy between 1 and 5),
  soreness int check (soreness between 1 and 5),
  sleep_quality int check (sleep_quality between 1 and 5),
  stress int check (stress between 1 and 5),
  body_notes text,
  training_notes text,
  general_notes text,
  coach_notes text,
  review_status text not null default 'needs_review' check (review_status in ('needs_review','reviewed')),
  created_by_role text not null check (created_by_role in ('coach','client','admin')),
  created_by_id uuid not null,
  updated_by_role text check (updated_by_role in ('coach','client','admin')),
  updated_by_id uuid,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_check_ins_client_date on check_ins(client_id, check_in_date desc);
create index if not exists idx_check_ins_coach_review on check_ins(coach_id, review_status, check_in_date desc);
create unique index if not exists idx_check_ins_one_active_per_day on check_ins(client_id, check_in_date) where archived = false;

-- ---------- Programs / workouts ----------
create table if not exists programs (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references coaches(id),
  name text not null,
  description text,
  frequency_days int check (frequency_days between 1 and 5),
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_programs_coach on programs(coach_id);

alter table programs add column if not exists frequency_days int check (frequency_days between 1 and 5);

-- New structured workout model starts clean; legacy flat programs are archived.
update programs set archived = true where archived = false and frequency_days is null;

-- ---------- Business-wide exercise library ----------
create table if not exists exercise_library (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  equipment text,
  primary_muscle text,
  secondary_muscles text,
  video_url text,
  notes text,
  source text not null default 'manual',
  review_status text not null default 'approved' check (review_status in ('approved','needs_review')),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_exercise_library_name on exercise_library(lower(name));
create index if not exists idx_exercise_library_filters on exercise_library(category, equipment, primary_muscle);

alter table exercise_library add column if not exists source text not null default 'manual';
alter table exercise_library add column if not exists review_status text not null default 'approved';

-- ---------- Reusable workout-day templates ----------
create table if not exists workouts (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid references coaches(id),
  name text not null,
  description text,
  goal text,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_workouts_coach on workouts(coach_id, archived);

create table if not exists workout_exercises (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null references workouts(id),
  exercise_library_id uuid references exercise_library(id),
  custom_name text,
  sets text,
  reps text,
  rest text,
  tempo text,
  notes text,
  client_notes text,
  coach_notes text,
  video_url text,
  position int not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_workout_exercises_workout on workout_exercises(workout_id, position);

alter table workout_exercises add column if not exists client_notes text;
alter table workout_exercises add column if not exists coach_notes text;
update workout_exercises set client_notes = notes where client_notes is null and notes is not null;

create table if not exists program_days (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references programs(id),
  day_number int not null check (day_number between 1 and 5),
  workout_id uuid not null references workouts(id),
  notes text,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique(program_id, day_number)
);
create index if not exists idx_program_days_program on program_days(program_id, day_number);

create table if not exists workout_assignments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id),
  workout_id uuid not null references workouts(id),
  assignment_mode text not null default 'active' check (assignment_mode in ('active','dated')),
  assigned_for date,
  notes text,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_workout_assignments_client on workout_assignments(client_id, assigned_for, archived);

create table if not exists program_exercises (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references programs(id),
  name text not null,
  sets text,
  reps text,
  notes text,
  video_url text,
  position int not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_program_exercises_program on program_exercises(program_id, position);

create table if not exists program_assignments (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references programs(id),
  client_id uuid not null references clients(id),
  notes text,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_program_assignments_client on program_assignments(client_id);

create or replace function commit_program_import(p_coach_id uuid, p_source text, p_draft jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_program_id uuid;
  v_workout_id uuid;
  v_exercise_id uuid;
  v_day jsonb;
  v_exercise jsonb;
  v_created jsonb := '[]'::jsonb;
  v_reused jsonb := '[]'::jsonb;
  v_warnings jsonb := coalesce(p_draft #> '{import_meta,warnings}', '[]'::jsonb);
  v_program_name text := btrim(coalesce(p_draft #>> '{program,name}', ''));
  v_frequency int := (p_draft #>> '{program,frequency_days}')::int;
  v_day_count int := jsonb_array_length(coalesce(p_draft -> 'days', '[]'::jsonb));
  v_normalized_name text;
begin
  if v_program_name = '' then
    raise exception 'Program name is required';
  end if;
  if v_frequency is null or v_frequency < 1 or v_frequency > 5 then
    raise exception 'Program frequency must be between 1 and 5';
  end if;
  if v_day_count <> v_frequency then
    raise exception 'Program day count must match frequency';
  end if;

  insert into public.programs (coach_id, name, description, frequency_days)
  values (
    p_coach_id,
    v_program_name,
    nullif(p_draft #>> '{program,description}', ''),
    v_frequency
  )
  returning id into v_program_id;

  for v_day in select * from jsonb_array_elements(p_draft -> 'days')
  loop
    insert into public.workouts (coach_id, name, description, goal)
    values (
      p_coach_id,
      coalesce(nullif(v_day ->> 'name', ''), 'Day ' || (v_day ->> 'day_number')),
      nullif(v_day ->> 'notes', ''),
      nullif(v_day ->> 'goal', '')
    )
    returning id into v_workout_id;

    for v_exercise in select * from jsonb_array_elements(coalesce(v_day -> 'exercises', '[]'::jsonb))
    loop
      v_normalized_name := regexp_replace(lower(btrim(coalesce(v_exercise ->> 'name', ''))), '\s+', ' ', 'g');
      if v_normalized_name = '' then
        raise exception 'Exercise name is required';
      end if;

      select id into v_exercise_id
      from public.exercise_library
      where archived = false
        and regexp_replace(lower(btrim(name)), '\s+', ' ', 'g') = v_normalized_name
      order by created_at asc
      limit 1;

      if v_exercise_id is null then
        insert into public.exercise_library (
          name, category, equipment, primary_muscle, video_url, notes, source, review_status
        )
        values (
          btrim(v_exercise ->> 'name'),
          nullif(v_exercise ->> 'category', ''),
          nullif(v_exercise ->> 'equipment', ''),
          nullif(v_exercise ->> 'primary_muscle', ''),
          nullif(v_exercise ->> 'video_url', ''),
          nullif(v_exercise ->> 'client_notes', ''),
          p_source,
          'needs_review'
        )
        returning id into v_exercise_id;
        v_created := v_created || jsonb_build_array(jsonb_build_object('id', v_exercise_id, 'name', btrim(v_exercise ->> 'name')));
      else
        v_reused := v_reused || jsonb_build_array(jsonb_build_object('id', v_exercise_id, 'name', btrim(v_exercise ->> 'name')));
      end if;

      insert into public.workout_exercises (
        workout_id, exercise_library_id, custom_name, sets, reps, rest, tempo, notes,
        client_notes, coach_notes, video_url, position
      )
      values (
        v_workout_id,
        v_exercise_id,
        btrim(v_exercise ->> 'name'),
        nullif(v_exercise ->> 'sets', ''),
        nullif(v_exercise ->> 'reps', ''),
        nullif(v_exercise ->> 'rest', ''),
        nullif(v_exercise ->> 'tempo', ''),
        nullif(v_exercise ->> 'client_notes', ''),
        nullif(v_exercise ->> 'client_notes', ''),
        nullif(v_exercise ->> 'coach_notes', ''),
        nullif(v_exercise ->> 'video_url', ''),
        coalesce((select count(*) from public.workout_exercises where workout_id = v_workout_id), 0)
      );
    end loop;

    insert into public.program_days (program_id, day_number, workout_id, notes)
    values (
      v_program_id,
      (v_day ->> 'day_number')::int,
      v_workout_id,
      nullif(v_day ->> 'notes', '')
    );
  end loop;

  return jsonb_build_object(
    'program_id', v_program_id,
    'created_exercises', v_created,
    'reused_exercises', v_reused,
    'warnings', v_warnings
  );
end;
$$;

-- The Express backend is the only caller. Supabase grants function execution
-- broadly by default, so explicitly remove Data API callers and retain only the
-- service role used by the isolated backend.
revoke execute on function public.commit_program_import(uuid, text, jsonb) from public;
revoke execute on function public.commit_program_import(uuid, text, jsonb) from anon, authenticated;
grant execute on function public.commit_program_import(uuid, text, jsonb) to service_role;

-- Protect future functions created by this migration owner from inheriting
-- broad Data API execution grants.
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
alter default privileges in schema public grant execute on functions to service_role;

-- Hosted projects may contain Supabase's RLS auto-enable event-trigger helper.
-- It does not need to be callable through the Data API.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end;
$$;

-- ---------- Messaging (thread = coach + client pair) ----------
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id),
  coach_id uuid not null references coaches(id),
  sender_role text not null check (sender_role in ('coach','client')),
  content text not null,
  read_by_recipient boolean not null default false,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_messages_thread on messages(coach_id, client_id, created_at);

-- ---------- Booking requests (clients request, coach confirms) ----------
create table if not exists booking_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id),
  coach_id uuid not null references coaches(id),
  requested_time timestamptz not null,
  duration_minutes int not null default 60,
  location text,
  note text,
  status text not null default 'pending' check (status in ('pending','approved','declined')),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_booking_requests_coach on booking_requests(coach_id, status);

-- ---------- Waivers (APPEND-ONLY legal records) ----------
create table if not exists waiver_versions (
  id uuid primary key default gen_random_uuid(),
  version_number int not null unique,
  full_text text not null,
  created_at timestamptz not null default now()
);

create table if not exists waiver_signatures (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id),
  waiver_version_id uuid not null references waiver_versions(id),
  signed_at timestamptz not null default now(),
  signed_name text not null,
  ip_address text,
  entered_by text not null default 'client' check (entered_by in ('client','coach')),
  entered_by_coach_id uuid references coaches(id)
);
create index if not exists idx_waiver_signatures_client on waiver_signatures(client_id);

-- ---------- Packages & payments (Stripe TEST mode) ----------
create table if not exists packages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  price numeric(10,2) not null,
  session_credits int not null default 0,
  is_recurring boolean not null default false,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists purchases (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id),
  package_id uuid not null references packages(id),
  amount numeric(10,2) not null,
  credits_granted int not null default 0,
  method text not null check (method in ('stripe','manual')),
  status text not null default 'pending' check (status in ('pending','completed','failed')),
  stripe_session_id text,
  recorded_by_coach_id uuid references coaches(id),
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_purchases_client on purchases(client_id);
create index if not exists idx_purchases_stripe on purchases(stripe_session_id);

create table if not exists client_credits (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null unique references clients(id),
  balance int not null default 0,
  updated_at timestamptz not null default now()
);

-- Future credit ledger model. Current app behavior still uses client_credits;
-- a later migration can backfill opening_balance events per client.
create table if not exists credit_transactions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id),
  coach_id uuid references coaches(id),
  event_type text not null check (event_type in ('opening_balance','purchase_grant','manual_grant','session_use','refund','correction','expiration','admin_adjustment')),
  amount int not null,
  balance_after int,
  note text,
  source_type text,
  source_id uuid,
  created_by_role text not null check (created_by_role in ('coach','client','admin','system')),
  created_by_id uuid,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_credit_transactions_client on credit_transactions(client_id, created_at desc);

-- ---------- Lock everything down with RLS ----------
-- All data access flows through the Express API using the service-role key
-- (which bypasses RLS). Enabling RLS with no policies blocks the anon key
-- from reading anything directly.
alter table coaches enable row level security;
alter table clients enable row level security;
alter table sessions enable row level security;
alter table session_notes enable row level security;
alter table metrics enable row level security;
alter table metric_entries enable row level security;
alter table check_ins enable row level security;
alter table exercise_library enable row level security;
alter table workouts enable row level security;
alter table workout_exercises enable row level security;
alter table program_days enable row level security;
alter table workout_assignments enable row level security;
alter table programs enable row level security;
alter table program_exercises enable row level security;
alter table program_assignments enable row level security;
alter table messages enable row level security;
alter table booking_requests enable row level security;
alter table waiver_versions enable row level security;
alter table waiver_signatures enable row level security;
alter table packages enable row level security;
alter table purchases enable row level security;
alter table client_credits enable row level security;
alter table credit_transactions enable row level security;

-- The Express backend is the only Data API caller. Make table access explicit
-- because Supabase project defaults vary, and intentionally omit DELETE so
-- business records remain soft-delete/archive only.
revoke all privileges on all tables in schema public
  from public, anon, authenticated, service_role;
grant select, insert, update on all tables in schema public to service_role;

revoke all privileges on all sequences in schema public
  from public, anon, authenticated, service_role;
grant usage, select on all sequences in schema public to service_role;

alter default privileges for role postgres in schema public
  revoke all privileges on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant select, insert, update on tables to service_role;

alter default privileges for role postgres in schema public
  revoke all privileges on sequences from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant usage, select on sequences to service_role;

select 'CVF PT schema created successfully' as result;
