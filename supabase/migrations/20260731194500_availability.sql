-- ============================================================
-- Coach availability & client slot-picking (roadmap Track 6, item 18).
--
-- Implements the availability docket as accepted on 2026-07-31 (all nine
-- recommendations, owner + partners):
--   A1  weekly recurring template + per-date overrides
--   A2  time off as timestamptz ranges; never auto-cancels sessions
--   A3  session types seeded 30/45/60 client-requestable; 90 and
--       assessment (90 min) coach-initiated only
--   A4  clients pick from open slots; request -> approve unchanged
--   A5  12 hour minimum lead, 21 day booking horizon
--   A6  cancellation stays advisory (policy copy only — no schema)
--   A7  hours are per coach
--   A8  group slots deferred; capacity modeled on windows, default 1
--
-- Slot derivation lives in get_open_slots (service-role only), the same
-- transactional-RPC pattern as schedule_session. Times in the template
-- and overrides are local Albuquerque wall-clock times; the RPC converts
-- through America/Denver so slots survive DST transitions.
-- ============================================================

create table if not exists public.session_types (
  key text primary key,
  label text not null,
  duration_minutes integer not null check (duration_minutes between 15 and 240),
  client_requestable boolean not null default false,
  created_at timestamptz not null default now()
);

insert into public.session_types (key, label, duration_minutes, client_requestable) values
  ('30min', '30 minutes', 30, true),
  ('45min', '45 minutes', 45, true),
  ('60min', '60 minutes', 60, true),
  ('90min', '90 minutes', 90, false),
  ('assessment', 'Assessment', 90, false)
on conflict (key) do nothing;

create table if not exists public.coach_availability (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.coaches(id),
  weekday integer not null check (weekday between 0 and 6), -- 0 = Sunday
  start_time time not null,
  end_time time not null check (end_time > start_time),
  capacity integer not null default 1 check (capacity between 1 and 10),
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_coach_availability_coach on public.coach_availability(coach_id, weekday);

create table if not exists public.coach_availability_overrides (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.coaches(id),
  on_date date not null,
  start_time time not null,
  end_time time not null check (end_time > start_time),
  capacity integer not null default 1 check (capacity between 1 and 10),
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_coach_availability_overrides_coach on public.coach_availability_overrides(coach_id, on_date);

create table if not exists public.coach_time_off (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.coaches(id),
  span tstzrange not null check (not isempty(span)),
  reason text,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_coach_time_off_coach on public.coach_time_off using gist (span);

-- The Express backend (service role) is the only caller: RLS on with no
-- client policies, and grants without DELETE — rows are archived, never
-- hard-deleted (locked repository invariants).
alter table public.session_types enable row level security;
alter table public.coach_availability enable row level security;
alter table public.coach_availability_overrides enable row level security;
alter table public.coach_time_off enable row level security;
grant select, insert, update on table public.session_types to service_role;
grant select, insert, update on table public.coach_availability to service_role;
grant select, insert, update on table public.coach_availability_overrides to service_role;
grant select, insert, update on table public.coach_time_off to service_role;

-- ---------- Atomic weekly-template replacement ----------
-- Archive-then-insert in one transaction, so a failed insert can never
-- leave a coach with an erased schedule. Element validation is the table
-- constraints; any bad element aborts the whole call.
create or replace function public.replace_coach_availability(
  p_coach_id uuid,
  p_windows jsonb
)
returns setof public.coach_availability
language plpgsql
set search_path = ''
as $$
begin
  if p_windows is null or jsonb_typeof(p_windows) <> 'array' then
    raise exception 'windows must be a JSON array';
  end if;
  update public.coach_availability
  set archived = true
  where coach_id = p_coach_id and not archived;
  return query
  insert into public.coach_availability (coach_id, weekday, start_time, end_time, capacity)
  select
    p_coach_id,
    (w->>'weekday')::integer,
    (w->>'start_time')::time,
    (w->>'end_time')::time,
    coalesce((w->>'capacity')::integer, 1)
  from jsonb_array_elements(p_windows) w
  returning *;
end;
$$;

revoke execute on function public.replace_coach_availability(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.replace_coach_availability(uuid, jsonb) to service_role;

-- ---------- Open-slot derivation ----------
-- Candidate starts every 30 minutes inside the day's windows (per-date
-- overrides replace the weekly template for that date entirely), minus
-- time off, minus starts inside the 12h lead window or past the 21-day
-- horizon, minus starts where overlapping booked sessions already fill
-- the window's capacity. Cancelled and archived sessions free their
-- slot (S3).
create or replace function public.get_open_slots(
  p_coach_id uuid,
  p_duration_minutes integer,
  p_from date,
  p_to date
)
returns table (starts_at timestamptz, ends_at timestamptz)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_tz text := 'America/Denver';
  v_day date;
  v_first date;
  v_last date;
  v_window record;
  v_slot_start timestamptz;
  v_slot_end timestamptz;
  v_cursor time;
  v_lead timestamptz := now() + interval '12 hours';
  v_horizon date := (now() at time zone v_tz)::date + 21;
  v_busy integer;
begin
  if p_duration_minutes is null or p_duration_minutes < 15 or p_duration_minutes > 240 then
    return;
  end if;
  v_first := greatest(coalesce(p_from, (now() at time zone v_tz)::date), (now() at time zone v_tz)::date);
  v_last := least(coalesce(p_to, v_horizon), v_horizon);
  v_day := v_first;
  while v_day <= v_last loop
    for v_window in
      select o.start_time, o.end_time, o.capacity
      from public.coach_availability_overrides o
      where o.coach_id = p_coach_id and o.on_date = v_day and not o.archived
      union all
      select a.start_time, a.end_time, a.capacity
      from public.coach_availability a
      where a.coach_id = p_coach_id
        and a.weekday = extract(dow from v_day)::integer
        and not a.archived
        and not exists (
          select 1 from public.coach_availability_overrides o2
          where o2.coach_id = p_coach_id and o2.on_date = v_day and not o2.archived
        )
    loop
      v_cursor := v_window.start_time;
      while v_cursor + make_interval(mins => p_duration_minutes) <= v_window.end_time loop
        v_slot_start := (v_day::text || ' ' || v_cursor::text)::timestamp at time zone v_tz;
        v_slot_end := v_slot_start + make_interval(mins => p_duration_minutes);
        if v_slot_start >= v_lead then
          if not exists (
            select 1 from public.coach_time_off t
            where t.coach_id = p_coach_id
              and not t.archived
              and t.span && tstzrange(v_slot_start, v_slot_end, '[)')
          ) then
            select count(*) into v_busy
            from public.sessions s
            where s.coach_id = p_coach_id
              and s.status <> 'cancelled'
              and s.archived = false
              and public.session_time_range(s.scheduled_at, s.duration_minutes)
                  && tstzrange(v_slot_start, v_slot_end, '[)');
            if v_busy < v_window.capacity then
              starts_at := v_slot_start;
              ends_at := v_slot_end;
              return next;
            end if;
          end if;
        end if;
        v_cursor := v_cursor + interval '30 minutes';
      end loop;
    end loop;
    v_day := v_day + 1;
  end loop;
  return;
end;
$$;

revoke execute on function public.get_open_slots(uuid, integer, date, date) from public, anon, authenticated;
grant execute on function public.get_open_slots(uuid, integer, date, date) to service_role;

select 'availability ready' as result;
