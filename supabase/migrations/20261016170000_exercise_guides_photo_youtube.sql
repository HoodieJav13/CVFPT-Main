-- LOCAL DRAFT (exercise guides: photo + YouTube, 2026-10-16). Not applied to any
-- hosted database. Independent exact-file SQL review, a fresh hosted ledger/version
-- reconciliation and separate owner authorization (Development, then Production)
-- are required before any hosted application. Never edit an applied migration;
-- once applied, later changes need a NEW migration.
--
-- Additive and forward-only (docs/exercise-guides/design.md):
--   1. workout_exercises.video_link_mode: 'inherit' (follow the library exercise's
--      current demo live; no copied URL is stored), 'override' (an explicit
--      per-workout link) or NULL (unclassified legacy, NOT an inferred intention).
--      Existing rows are left NULL; no URL bytes are rewritten.
--   2. The shared exercise writer, clone_workout and commit_program_import carry
--      the mode; create_quick_session derives it for its freshly inserted rows only
--      from the already-hashed v1 facts. The Quick wire schema, canonical payload,
--      v1 hash and replay path are unchanged.
--   3. Photo transport: a service-only durable upload intent per actor+request,
--      persisted BEFORE any direct-upload grant; finalize reuses the accepted
--      exercise_media_attach_source recovery contract with the intent id as the
--      asset id. No deletion or purge is added.
--   4. exercise_media_claim_revision_job: a revision-scoped leased claim so a
--      bounded photo render can run synchronously in the request while a
--      terminated request leaves a recoverable lease (resume after expiry).
-- Every replaced function keeps its signature, return contract, security invoker
-- mode, empty search_path and service-role-only execution.
-- Rollback: revert application code first; leave the column (NULL-tolerant) and data
-- in place. To revert a function, reapply its previous definition in a NEW migration.

-- ---------- Reference mode column ----------
alter table public.workout_exercises
  add column video_link_mode text,
  add constraint workout_exercises_video_link_mode_check check (video_link_mode in ('inherit', 'override')),
  -- Inheritance stores no copied URL and needs a library exercise to follow.
  add constraint workout_exercises_video_link_inherit_check check (
    video_link_mode is distinct from 'inherit' or (video_url is null and exercise_library_id is not null)
  ),
  add constraint workout_exercises_video_link_override_check check (
    video_link_mode is distinct from 'override' or nullif(btrim(coalesce(video_url, '')), '') is not null
  );

-- ---------- Shared exercise writer (save_workout, create_quick_session) ----------
create or replace function public.sync_workout_exercises(p_workout_id uuid, p_exercises jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_exercise jsonb;
  v_existing public.workout_exercises%rowtype;
  v_exercise_id uuid;
  v_library_id uuid;
  v_custom_name text;
  v_position integer := 0;
  v_kept_ids uuid[] := array[]::uuid[];
  v_has_mode boolean;
  v_mode text;
  v_video_url text;
begin
  for v_exercise in select value from jsonb_array_elements(coalesce(p_exercises, '[]'::jsonb))
  loop
    v_library_id := nullif(v_exercise ->> 'exercise_library_id', '')::uuid;
    v_custom_name := nullif(coalesce(v_exercise ->> 'custom_name', v_exercise ->> 'name'), '');
    if v_library_id is not null or btrim(coalesce(v_custom_name, '')) <> '' then
      v_exercise_id := nullif(v_exercise ->> 'id', '')::uuid;
      v_existing.id := null;
      -- Demo reference: a present key is an explicit new-shape choice (validated
      -- here and by the table CHECKs); an absent key is an old request shape.
      v_has_mode := v_exercise ? 'video_link_mode';
      v_mode := nullif(v_exercise ->> 'video_link_mode', '');
      v_video_url := nullif(v_exercise ->> 'video_url', '');
      if v_has_mode and v_mode is not null and v_mode not in ('inherit', 'override') then
        raise exception 'Invalid demo link mode' using errcode = '22023';
      end if;
      if v_exercise_id is not null then
        select * into v_existing
        from public.workout_exercises
        where id = v_exercise_id and workout_id = p_workout_id and archived = false;
      end if;

      if v_existing.id is not null and (
        (v_existing.exercise_library_id is not null and v_existing.exercise_library_id = v_library_id)
        or
        (v_existing.exercise_library_id is null and v_library_id is null
          and lower(btrim(coalesce(v_existing.custom_name, ''))) = lower(btrim(coalesce(v_custom_name, ''))))
      ) then
        update public.workout_exercises
        set exercise_library_id = v_library_id,
            custom_name = v_custom_name,
            sets = nullif(v_exercise ->> 'sets', ''),
            reps = nullif(v_exercise ->> 'reps', ''),
            rest = nullif(v_exercise ->> 'rest', ''),
            tempo = nullif(v_exercise ->> 'tempo', ''),
            target_rpe = nullif(v_exercise ->> 'target_rpe', ''),
            default_load_value = nullif(v_exercise ->> 'default_load_value', '')::numeric,
            default_load_unit = case when nullif(v_exercise ->> 'default_load_value', '') is null then null else coalesce(nullif(v_exercise ->> 'default_load_unit', ''), 'lb') end,
            notes = nullif(coalesce(v_exercise ->> 'client_notes', v_exercise ->> 'notes'), ''),
            client_notes = nullif(coalesce(v_exercise ->> 'client_notes', v_exercise ->> 'notes'), ''),
            coach_notes = nullif(v_exercise ->> 'coach_notes', ''),
            video_url = v_video_url,
            -- Old shapes keep a still-consistent explicit mode; anything else
            -- (e.g. an old client copying a library link) is unclassified legacy.
            video_link_mode = case
              when v_has_mode then v_mode
              when v_existing.video_link_mode = 'inherit' and v_video_url is null then 'inherit'
              when v_existing.video_link_mode = 'override' and nullif(btrim(coalesce(v_video_url, '')), '') is not null then 'override'
              else null end,
            superset_group = nullif(btrim(coalesce(v_exercise ->> 'superset_group', '')), ''),
            tracking_type = case when v_exercise ? 'tracking_type' then coalesce(v_exercise ->> 'tracking_type', 'reps_weight') else v_existing.tracking_type end,
            duration_value = case when v_exercise ? 'duration_value' then nullif(v_exercise ->> 'duration_value', '')::numeric else v_existing.duration_value end,
            duration_unit = case when v_exercise ? 'duration_unit' then nullif(v_exercise ->> 'duration_unit', '') else v_existing.duration_unit end,
            distance_value = case when v_exercise ? 'distance_value' then nullif(v_exercise ->> 'distance_value', '')::numeric else v_existing.distance_value end,
            distance_unit = case when v_exercise ? 'distance_unit' then nullif(v_exercise ->> 'distance_unit', '') else v_existing.distance_unit end,
            position = v_position
        where id = v_existing.id;
        v_exercise_id := v_existing.id;
      else
        insert into public.workout_exercises (
          workout_id, exercise_library_id, custom_name, sets, reps, rest, tempo, target_rpe,
          default_load_value, default_load_unit, notes, client_notes, coach_notes, video_url, position,
          superset_group, tracking_type, duration_value, duration_unit, distance_value, distance_unit, video_link_mode
        ) values (
          p_workout_id, v_library_id, v_custom_name,
          nullif(v_exercise ->> 'sets', ''), nullif(v_exercise ->> 'reps', ''),
          nullif(v_exercise ->> 'rest', ''), nullif(v_exercise ->> 'tempo', ''),
          nullif(v_exercise ->> 'target_rpe', ''),
          nullif(v_exercise ->> 'default_load_value', '')::numeric,
          case when nullif(v_exercise ->> 'default_load_value', '') is null then null else coalesce(nullif(v_exercise ->> 'default_load_unit', ''), 'lb') end,
          nullif(coalesce(v_exercise ->> 'client_notes', v_exercise ->> 'notes'), ''),
          nullif(coalesce(v_exercise ->> 'client_notes', v_exercise ->> 'notes'), ''),
          nullif(v_exercise ->> 'coach_notes', ''), v_video_url, v_position,
          nullif(btrim(coalesce(v_exercise ->> 'superset_group', '')), ''),
          coalesce(v_exercise ->> 'tracking_type', 'reps_weight'), nullif(v_exercise ->> 'duration_value', '')::numeric, nullif(v_exercise ->> 'duration_unit', ''), nullif(v_exercise ->> 'distance_value', '')::numeric, nullif(v_exercise ->> 'distance_unit', ''),
          case when v_has_mode then v_mode else null end
        ) returning id into v_exercise_id;
      end if;
      v_kept_ids := array_append(v_kept_ids, v_exercise_id);
      v_position := v_position + 1;
    end if;
  end loop;

  update public.workout_exercises
  set archived = true
  where workout_id = p_workout_id and archived = false and not (id = any(v_kept_ids));

  update public.program_assignment_exercise_loads l
  set archived = true, updated_at = now()
  where archived = false and exists (
    select 1 from public.workout_exercises we where we.id = l.workout_exercise_id and we.archived = true
  );
  update public.workout_assignment_exercise_loads l
  set archived = true, updated_at = now()
  where archived = false and exists (
    select 1 from public.workout_exercises we where we.id = l.workout_exercise_id and we.archived = true
  );
end;
$$;

-- ---------- Copies (templates, client clones, Quick library saves) ----------
create or replace function public.clone_workout(
  p_workout_id uuid,
  p_coach_id uuid,
  p_client_id uuid,
  p_as_template boolean,
  p_variation_of uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_src public.workouts%rowtype;
  v_new_id uuid;
  v_ex public.workout_exercises%rowtype;
  v_new_ex uuid;
  v_map jsonb := '{}'::jsonb;
  v_strip boolean;
begin
  select * into v_src from public.workouts where id = p_workout_id and archived = false;
  if not found then
    raise exception 'Workout not found';
  end if;
  v_strip := p_as_template and not v_src.is_template;

  if p_as_template then
    insert into public.workouts (
      coach_id, name, description, goal, is_template, client_id,
      source_workout_id, variation_of, hidden, created_by
    ) values (
      p_coach_id, v_src.name, v_src.description, v_src.goal, true, null,
      v_src.id, p_variation_of, true, p_coach_id
    ) returning id into v_new_id;
  else
    insert into public.workouts (
      coach_id, name, description, goal, is_template, client_id, source_workout_id
    ) values (
      p_coach_id, v_src.name, v_src.description, v_src.goal, false, p_client_id, v_src.id
    ) returning id into v_new_id;
  end if;

  for v_ex in
    select * from public.workout_exercises
    where workout_id = p_workout_id and archived = false
    order by position, created_at
  loop
    insert into public.workout_exercises (
      workout_id, exercise_library_id, custom_name, sets, reps, rest, rest_seconds, tempo,
      target_rpe, default_load_value, default_load_unit, notes, client_notes, coach_notes,
      video_url, position, superset_group, tracking_type, duration_value, duration_unit, distance_value, distance_unit,
      video_link_mode
    ) values (
      v_new_id, v_ex.exercise_library_id, v_ex.custom_name, v_ex.sets, v_ex.reps, v_ex.rest,
      v_ex.rest_seconds, v_ex.tempo, v_ex.target_rpe,
      case when v_strip then null else v_ex.default_load_value end,
      case when v_strip then null else v_ex.default_load_unit end,
      v_ex.notes, v_ex.client_notes,
      case when v_strip then null else v_ex.coach_notes end,
      v_ex.video_url, v_ex.position, v_ex.superset_group, v_ex.tracking_type, v_ex.duration_value, v_ex.duration_unit, v_ex.distance_value, v_ex.distance_unit,
      -- Copied exactly: inheritance stays live, overrides and NULL legacy stay as they were.
      v_ex.video_link_mode
    ) returning id into v_new_ex;
    v_map := v_map || jsonb_build_object(v_ex.id::text, v_new_ex);
  end loop;

  return jsonb_build_object('workout_id', v_new_id, 'exercise_map', v_map);
end;
$$;

-- ---------- Program import commit ----------
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
  v_video_url text;
  v_mode text;
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

      -- Demo reference: an explicit draft mode is kept (NULL = an unclassified
      -- legacy copy); an old draft shape treats a per-row link as an explicit
      -- override and no link as inheriting the (always linked) library demo.
      v_video_url := nullif(v_exercise ->> 'video_url', '');
      v_mode := case
        when v_exercise ? 'video_link_mode' then nullif(v_exercise ->> 'video_link_mode', '')
        when nullif(btrim(coalesce(v_video_url, '')), '') is not null then 'override'
        when v_video_url is null then 'inherit'
        else null end;
      if v_mode is not null and v_mode not in ('inherit', 'override') then
        raise exception 'Invalid demo link mode' using errcode = '22023';
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
        position, tracking_type, duration_value, duration_unit, distance_value, distance_unit,
        video_link_mode
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
        v_video_url,
        coalesce((
          select count(*)
          from public.workout_exercises
          where workout_id = v_workout_id
        ), 0),
        coalesce(v_exercise ->> 'tracking_type', 'reps_weight'), nullif(v_exercise ->> 'duration_value', '')::numeric, nullif(v_exercise ->> 'duration_unit', ''), nullif(v_exercise ->> 'distance_value', '')::numeric, nullif(v_exercise ->> 'distance_unit', ''),
        v_mode
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

-- ---------- Quick create: v1 contract unchanged; fresh-row mode derivation only ----------
create or replace function public.create_quick_session(
  p_actor uuid,
  p_client_id uuid,
  p_request_id uuid,
  p_hash text,
  p_assigned_for date,
  p_name text,
  p_notes text,
  p_exercises jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_receipt public.workout_assignments%rowtype;
  v_client public.clients%rowtype;
  v_workout_id uuid;
  v_assignment_id uuid;
  v_hidden text;
  v_kept integer;
begin
  if p_actor is null or p_request_id is null or p_client_id is null then
    raise exception 'Quick session actor, request and client are required';
  end if;
  if p_hash is null or p_hash !~ '^v[0-9]+:[0-9a-f]{64}$' then
    raise exception 'Quick session request fingerprint is invalid';
  end if;
  if p_assigned_for is null then
    raise exception 'Choose a date for dated workouts';
  end if;
  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'Workout name is required';
  end if;
  if jsonb_typeof(p_exercises) is distinct from 'array' then
    raise exception 'Add at least one exercise';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'cvf_quick_session_request:' || p_actor::text || ':' || p_request_id::text, 0));

  -- Advisory lookup (archived receipts included); rechecked after the quick locks.
  select * into v_receipt from public.workout_assignments
  where created_by_coach_id = p_actor and create_request_id = p_request_id;

  if v_receipt.id is not null then
    perform pg_advisory_xact_lock(hashtextextended('cvf_quick_session_workout:' || v_receipt.workout_id::text, 0));
    perform 1 from public.clients
    where id in (v_receipt.client_id, p_client_id)
    order by id
    for share;
    select * into v_receipt from public.workout_assignments where id = v_receipt.id for update;
    perform 1 from public.workouts where id = v_receipt.workout_id for update;

    -- Both the ORIGINAL client and the newly supplied target must be currently accessible.
    if not public.quick_session_can_access_client(p_actor, v_receipt.client_id)
       or not public.quick_session_can_access_client(p_actor, p_client_id)
       or v_receipt.archived
       or v_receipt.kind <> 'quick'
       or not exists (select 1 from public.workouts w where w.id = v_receipt.workout_id and w.archived = false) then
      return jsonb_build_object('state', 'not_found');
    end if;
    -- Replay never repeats exercise admission or writes. The fingerprint already covers the
    -- client; the explicit comparison keeps a forged equal hash from retargeting a replay.
    if v_receipt.create_request_hash = p_hash and v_receipt.client_id = p_client_id then
      return jsonb_build_object('state', 'replayed', 'assignment_id', v_receipt.id, 'workout_id', v_receipt.workout_id);
    end if;
    return jsonb_build_object('state', 'request_mismatch');
  end if;

  select * into v_client from public.clients where id = p_client_id for share;
  if not public.quick_session_can_access_client(p_actor, p_client_id) then
    return jsonb_build_object('state', 'not_found');
  end if;

  -- Fresh hidden-exercise admission, atomic with the create: hold the picked library rows so a
  -- concurrent hide commits either before (rejected here) or after this create.
  perform 1 from public.exercise_library el
  where el.id in (
    select (e.value ->> 'exercise_library_id')::uuid
    from jsonb_array_elements(p_exercises) e
    where nullif(e.value ->> 'exercise_library_id', '') is not null
  )
  order by el.id
  for share;
  select string_agg(el.name, ', ' order by el.name) into v_hidden
  from public.exercise_library el
  where el.hidden and el.id in (
    select (e.value ->> 'exercise_library_id')::uuid
    from jsonb_array_elements(p_exercises) e
    where nullif(e.value ->> 'exercise_library_id', '') is not null
  );
  if v_hidden is not null then
    raise exception 'Hidden exercises cannot be added: %', v_hidden using errcode = 'P0001';
  end if;

  insert into public.workouts (coach_id, name, description, goal, is_template, client_id, hidden)
  values (v_client.coach_id, btrim(p_name), null, null, false, v_client.id, false)
  returning id into v_workout_id;
  perform public.sync_workout_exercises(v_workout_id, p_exercises);
  -- Demo reference for these FRESHLY inserted rows only, derived from the
  -- already-hashed v1 facts (no new input crosses the Quick boundary): a
  -- nonempty link is an override, a linked exercise with no link inherits the
  -- library demo, a custom exercise with no link has none. Replays returned
  -- above, so committed receipts and existing rows are never reclassified.
  update public.workout_exercises
  set video_link_mode = case
    when nullif(btrim(coalesce(video_url, '')), '') is not null then 'override'
    when exercise_library_id is not null and video_url is null then 'inherit'
    else null end
  where workout_id = v_workout_id;
  select count(*) into v_kept from public.workout_exercises where workout_id = v_workout_id and archived = false;
  if v_kept = 0 then
    raise exception 'Add at least one exercise';
  end if;

  insert into public.workout_assignments (
    client_id, workout_id, assignment_mode, assigned_for, notes,
    kind, created_by_coach_id, create_request_id, create_request_hash
  ) values (
    v_client.id, v_workout_id, 'dated', p_assigned_for, nullif(btrim(coalesce(p_notes, '')), ''),
    'quick', p_actor, p_request_id, p_hash
  ) returning id into v_assignment_id;

  return jsonb_build_object('state', 'created', 'assignment_id', v_assignment_id, 'workout_id', v_workout_id);
end;
$$;

-- ---------- Grants: unchanged service-role-only execution, restated ----------
revoke execute on function public.sync_workout_exercises(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.clone_workout(uuid, uuid, uuid, boolean, uuid) from public, anon, authenticated;
revoke execute on function public.commit_program_import(uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.create_quick_session(uuid, uuid, uuid, text, date, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.sync_workout_exercises(uuid, jsonb) to service_role;
grant execute on function public.clone_workout(uuid, uuid, uuid, boolean, uuid) to service_role;
grant execute on function public.commit_program_import(uuid, text, jsonb) to service_role;
grant execute on function public.create_quick_session(uuid, uuid, uuid, text, date, text, text, jsonb) to service_role;

-- ---------- Photo transport: durable upload intents (service-only) ----------
create table public.exercise_media_upload_intents (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.exercise_media_revisions(id),
  actor_coach_id uuid not null references public.coaches(id),
  request_id uuid not null,
  role text not null check (role = 'source_image'),
  declared_bytes bigint not null check (declared_bytes between 1 and 10485760),
  declared_mime text not null check (declared_mime in ('image/jpeg', 'image/png', 'image/webp')),
  staging_key text not null,
  state text not null default 'issued' check (state in ('issued', 'attached', 'abandoned')),
  asset_id uuid references public.exercise_media_assets(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (actor_coach_id, request_id),
  unique (staging_key),
  check (staging_key = 'staging/' || id::text),
  check ((state = 'attached') = (asset_id is not null)),
  check (asset_id is null or asset_id = id)
);
create index exercise_media_upload_intents_revision on public.exercise_media_upload_intents(revision_id, state);

create function public.exercise_media_upload_intent_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.id <> old.id or new.revision_id <> old.revision_id or new.actor_coach_id <> old.actor_coach_id
    or new.request_id <> old.request_id or new.role <> old.role or new.declared_bytes <> old.declared_bytes
    or new.declared_mime <> old.declared_mime or new.staging_key <> old.staging_key or new.created_at <> old.created_at then
    raise exception 'Upload intent identity is immutable' using errcode = '23514';
  end if;
  if new.state is distinct from old.state and not (
    (old.state = 'issued' and new.state in ('attached', 'abandoned')) or (old.state = 'abandoned' and new.state = 'attached')
  ) then
    raise exception 'Invalid upload intent transition' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger exercise_media_upload_intent_guard before update on public.exercise_media_upload_intents
  for each row execute function public.exercise_media_upload_intent_guard();

alter table public.exercise_media_upload_intents enable row level security;
revoke all on public.exercise_media_upload_intents from public, anon, authenticated;
-- No DELETE: intents are history, never removed.
grant select, insert, update on public.exercise_media_upload_intents to service_role;

-- Issues (or replays) the intent for one actor+request. Same advisory key as
-- exercise_media_attach_source, so issue and attach of one request serialize.
create function public.exercise_media_issue_upload_intent(p_actor uuid, p_revision_id uuid, p_request_id uuid,
  p_role text, p_bytes bigint, p_mime text, p_expected_version integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare i public.exercise_media_upload_intents%rowtype; gate jsonb;
begin
  if p_request_id is null then raise exception 'Request id required' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('exercise-media-upload/' || p_actor::text || '/' || p_request_id::text, 0));
  select * into i from public.exercise_media_upload_intents where actor_coach_id = p_actor and request_id = p_request_id;
  if i.id is not null then
    if i.revision_id = p_revision_id and i.role = p_role and i.declared_bytes = p_bytes and i.declared_mime = p_mime then
      return jsonb_build_object('outcome', 'issued', 'intent_id', i.id, 'staging_key', i.staging_key, 'state', i.state, 'replayed', true);
    end if;
    return jsonb_build_object('outcome', 'request_mismatch');
  end if;
  -- A request id already spent on a multipart upload cannot become an intent.
  if exists (select 1 from public.exercise_media_assets where uploaded_by_coach_id = p_actor and upload_request_id = p_request_id) then
    return jsonb_build_object('outcome', 'request_mismatch');
  end if;
  gate := public.exercise_media_editable(p_actor, p_revision_id, p_expected_version);
  if gate->>'outcome' <> 'ok' then return gate; end if;
  if p_role is distinct from 'source_image' or p_bytes is null or p_bytes < 1 or p_bytes > 10485760
    or p_mime is null or p_mime not in ('image/jpeg', 'image/png', 'image/webp') then
    return jsonb_build_object('outcome', 'invalid_asset');
  end if;
  insert into public.exercise_media_upload_intents (id, revision_id, actor_coach_id, request_id, role, declared_bytes, declared_mime, staging_key)
  select n.id, p_revision_id, p_actor, p_request_id, p_role, p_bytes, p_mime, 'staging/' || n.id::text
  from (select gen_random_uuid() as id) n
  returning * into i;
  return jsonb_build_object('outcome', 'issued', 'intent_id', i.id, 'staging_key', i.staging_key, 'state', i.state, 'replayed', false);
end $$;

-- 'attached' only once the accepted attach contract recorded the asset under the
-- intent id for this request; 'abandoned' only before that. Never deletes bytes.
create function public.exercise_media_mark_upload_intent(p_actor uuid, p_intent_id uuid, p_state text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare i public.exercise_media_upload_intents%rowtype; v_asset uuid;
begin
  select * into i from public.exercise_media_upload_intents where id = p_intent_id for update;
  if i.id is null or i.actor_coach_id <> p_actor then return jsonb_build_object('outcome', 'not_found'); end if;
  if p_state = 'attached' then
    if i.state = 'attached' then return jsonb_build_object('outcome', 'attached', 'asset_id', i.asset_id); end if;
    select a.id into v_asset from public.exercise_media_assets a
    where a.id = i.id and a.upload_request_id = i.request_id and a.uploaded_by_coach_id = p_actor and a.revision_id = i.revision_id;
    if v_asset is null then return jsonb_build_object('outcome', 'not_attached'); end if;
    update public.exercise_media_upload_intents set state = 'attached', asset_id = v_asset, updated_at = now() where id = i.id;
    return jsonb_build_object('outcome', 'attached', 'asset_id', v_asset);
  elsif p_state = 'abandoned' then
    if i.state = 'attached' then return jsonb_build_object('outcome', 'attached', 'asset_id', i.asset_id); end if;
    if i.state = 'issued' then
      update public.exercise_media_upload_intents set state = 'abandoned', updated_at = now() where id = i.id;
    end if;
    return jsonb_build_object('outcome', 'abandoned');
  end if;
  raise exception 'Invalid intent state' using errcode = '22023';
end $$;

-- ---------- Inline photo processing: revision-scoped leased claim ----------
-- Same lock order and lease protocol as exercise_media_claim_job (job, then
-- revision), restricted to the CURRENT recipe job of one revision the actor owns
-- (or admin). A live lease is never stolen; an expired one resumes the same job
-- as a new attempt. complete/fail use the existing lease-token functions.
create function public.exercise_media_claim_revision_job(p_actor uuid, p_revision_id uuid, p_worker text, p_lease_seconds integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_role text := public.exercise_media_actor_role(p_actor); j public.exercise_media_jobs%rowtype; r public.exercise_media_revisions%rowtype;
begin
  if p_lease_seconds is null or p_lease_seconds < 5 or p_lease_seconds > 900 then raise exception 'Lease out of range' using errcode = '22023'; end if;
  if v_role is null then return jsonb_build_object('outcome', 'forbidden'); end if;
  select * into r from public.exercise_media_revisions where id = p_revision_id;
  if r.id is null or r.archived or (v_role <> 'admin' and r.uploaded_by_coach_id <> p_actor) then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  select * into j from public.exercise_media_jobs
  where revision_id = r.id and recipe_version = r.recipe_version for update skip locked;
  if j.id is null then
    if exists (select 1 from public.exercise_media_jobs where revision_id = r.id and recipe_version = r.recipe_version) then
      return jsonb_build_object('outcome', 'busy');
    end if;
    return jsonb_build_object('outcome', 'idle');
  end if;
  if j.state = 'succeeded' then return jsonb_build_object('outcome', 'ready'); end if;
  if j.state = 'failed' then return jsonb_build_object('outcome', 'failed', 'code', j.error_code); end if;
  if j.state = 'running' and j.lease_expires_at >= clock_timestamp() then
    return jsonb_build_object('outcome', 'busy', 'lease_expires_at', j.lease_expires_at);
  end if;
  select * into r from public.exercise_media_revisions where id = j.revision_id for update;
  if r.archived or r.status <> 'processing' or r.recipe_version <> j.recipe_version then
    update public.exercise_media_jobs set state = 'failed', error_code = 'superseded', lease_token = null,
      lease_expires_at = null, finished_at = now(), updated_at = now() where id = j.id;
    return jsonb_build_object('outcome', 'failed', 'code', 'superseded');
  end if;
  if j.attempts >= j.max_attempts then
    update public.exercise_media_jobs set state = 'failed', error_code = 'attempts_exhausted', lease_token = null,
      lease_expires_at = null, finished_at = now(), updated_at = now() where id = j.id;
    update public.exercise_media_revisions set status = 'failed', failure_code = 'attempts_exhausted',
      version = r.version + 1, updated_at = now() where id = r.id;
    return jsonb_build_object('outcome', 'failed', 'code', 'attempts_exhausted');
  end if;
  update public.exercise_media_jobs set state = 'running', attempts = j.attempts + 1, lease_token = gen_random_uuid(),
    lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds), worker_label = p_worker,
    started_at = coalesce(j.started_at, now()), updated_at = now()
  where id = j.id returning * into j;
  return jsonb_build_object('outcome', 'claimed', 'job', to_jsonb(j), 'revision', to_jsonb(r),
    'sources', coalesce((select jsonb_agg(to_jsonb(a)) from public.exercise_media_assets a
      where a.revision_id = r.id and not a.archived and a.role in ('source_video', 'source_image')), '[]'::jsonb));
end $$;

revoke execute on function
  public.exercise_media_upload_intent_guard(),
  public.exercise_media_issue_upload_intent(uuid, uuid, uuid, text, bigint, text, integer),
  public.exercise_media_mark_upload_intent(uuid, uuid, text),
  public.exercise_media_claim_revision_job(uuid, uuid, text, integer)
from public, anon, authenticated;
grant execute on function
  public.exercise_media_upload_intent_guard(),
  public.exercise_media_issue_upload_intent(uuid, uuid, uuid, text, bigint, text, integer),
  public.exercise_media_mark_upload_intent(uuid, uuid, text),
  public.exercise_media_claim_revision_job(uuid, uuid, text, integer)
to service_role;
