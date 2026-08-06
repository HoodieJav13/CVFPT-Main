-- Pre-launch integrity hardening (2026-08-06 review findings).
-- Five independent protections, all forward-only:
--   1. Denver-local date defaults for metric entries and check-ins
--   2. Database-enforced append-only waiver records
--   3. Bounded session durations (an empty tstzrange evades conflict checks)
--   4. Indexes for client-keyed hot paths (messages, booking requests)
--   5. Advisory lock serializing exercise-library creation during imports

-- 1. Evening entries were bucketed to tomorrow's UTC date. Route code now
-- stamps Denver-local dates; these defaults are the backstop. Existing rows
-- are left untouched (original local dates are not recoverable).
alter table public.metric_entries
  alter column recorded_on set default ((now() at time zone 'America/Denver')::date);
alter table public.check_ins
  alter column check_in_date set default ((now() at time zone 'America/Denver')::date);

-- 2. Waivers are a locked append-only invariant, but until now only route
-- discipline enforced it. Same trigger pattern as
-- prevent_completed_workout_log_change (20260717043317).
create or replace function public.prevent_waiver_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Waiver records are append-only';
end;
$$;

drop trigger if exists waiver_versions_append_only on public.waiver_versions;
create trigger waiver_versions_append_only
  before update or delete on public.waiver_versions
  for each row execute function public.prevent_waiver_mutation();

drop trigger if exists waiver_signatures_append_only on public.waiver_signatures;
create trigger waiver_signatures_append_only
  before update or delete on public.waiver_signatures
  for each row execute function public.prevent_waiver_mutation();

-- 3. duration_minutes = 0 yields an empty session_time_range that overlaps
-- nothing, silently bypassing the exclusion constraints from
-- 20260730220646; negative values raise an opaque reversed-range error.
-- NOT VALID + VALIDATE so the ALTER never blocks on existing rows.
alter table public.sessions
  add constraint sessions_duration_minutes_check
  check (duration_minutes between 1 and 480) not valid;
alter table public.sessions validate constraint sessions_duration_minutes_check;

alter table public.booking_requests
  add constraint booking_requests_duration_minutes_check
  check (duration_minutes between 1 and 480) not valid;
alter table public.booking_requests validate constraint booking_requests_duration_minutes_check;

-- 4. The client thread/unread-count queries filter messages by client_id
-- alone; the only existing index leads with coach_id. booking_requests
-- likewise only had (coach_id, status).
create index if not exists idx_messages_client_created
  on public.messages (client_id, created_at) where archived = false;
create index if not exists idx_booking_requests_client_created
  on public.booking_requests (client_id, created_at desc);

-- 5. commit_program_import's normalized-name lookup/insert had no unique
-- index and no lock, so two concurrent imports could both create "Goblet
-- Squat" and permanently split its history. Body is identical to
-- 20260715005846 except for the advisory lock taken before any library
-- lookup (same pattern as create_waiver_version's cvf_pt_waiver_version
-- lock). A unique index on the normalized name is deferred until hosted
-- data is audited for pre-existing near-duplicates.
create or replace function public.commit_program_import(
  p_coach_id uuid,
  p_source text,
  p_draft jsonb
)
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
  v_frequency integer := (p_draft #>> '{program,frequency_days}')::integer;
  v_day_count integer := jsonb_array_length(coalesce(p_draft -> 'days', '[]'::jsonb));
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

  -- Serialize normalized-name lookup/insert so concurrent imports cannot
  -- create duplicate exercise_library rows.
  perform pg_advisory_xact_lock(hashtextextended('cvf_exercise_library', 0));

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

    for v_exercise in
      select * from jsonb_array_elements(coalesce(v_day -> 'exercises', '[]'::jsonb))
    loop
      v_exercise_id := null;
      v_normalized_name := regexp_replace(
        lower(btrim(coalesce(v_exercise ->> 'name', ''))),
        '\s+',
        ' ',
        'g'
      );
      if v_normalized_name = '' then
        raise exception 'Exercise name is required';
      end if;

      if nullif(v_exercise ->> 'exercise_library_id', '') is not null then
        begin
          select id into v_exercise_id
          from public.exercise_library
          where id = (v_exercise ->> 'exercise_library_id')::uuid
            and archived = false;
        exception
          when invalid_text_representation then
            raise exception 'Selected exercise is invalid';
        end;
        if v_exercise_id is null then
          raise exception 'Selected exercise is unavailable';
        end if;
      else
        select id into v_exercise_id
        from public.exercise_library
        where archived = false
          and regexp_replace(lower(btrim(name)), '\s+', ' ', 'g') = v_normalized_name
        order by created_at asc
        limit 1;
      end if;

      if v_exercise_id is null then
        insert into public.exercise_library (
          name,
          category,
          equipment,
          primary_muscle,
          video_url,
          notes,
          source,
          review_status
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
        v_created := v_created || jsonb_build_array(
          jsonb_build_object('id', v_exercise_id, 'name', btrim(v_exercise ->> 'name'))
        );
      else
        v_reused := v_reused || jsonb_build_array(
          jsonb_build_object('id', v_exercise_id, 'name', btrim(v_exercise ->> 'name'))
        );
      end if;

      insert into public.workout_exercises (
        workout_id,
        exercise_library_id,
        custom_name,
        sets,
        reps,
        rest,
        tempo,
        notes,
        client_notes,
        coach_notes,
        video_url,
        position
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
        coalesce((
          select count(*)
          from public.workout_exercises
          where workout_id = v_workout_id
        ), 0)
      );
    end loop;

    insert into public.program_days (program_id, day_number, workout_id, notes)
    values (
      v_program_id,
      (v_day ->> 'day_number')::integer,
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

revoke execute on function public.commit_program_import(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.commit_program_import(uuid, text, jsonb) to service_role;
