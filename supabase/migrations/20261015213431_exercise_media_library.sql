-- LOCAL DRAFT (exercise media local build, 2026-10-15): independent exact-file SQL
-- review and separate hosted approval are required before any hosted application.
-- Additive only. Media binds to the canonical exercise_library id through an
-- immutable revision + current-pointer model, so workout copy/start/log writers
-- never carry media ids. Express (service_role) remains the only boundary:
-- RLS is enabled with no policies and browser roles get no grants.

-- ----- Pure validators used by CHECK constraints ---------------------------
create function public.exercise_media_valid_crop(p jsonb) returns boolean
language plpgsql immutable security invoker set search_path = '' as $$
declare x numeric; y numeric; w numeric; h numeric;
begin
  if p is null then return true; end if;
  if jsonb_typeof(p) <> 'object' then return false; end if;
  if (select array_agg(k order by k) from jsonb_object_keys(p) k) <> array['height','width','x','y'] then return false; end if;
  if jsonb_typeof(p->'x') <> 'number' or jsonb_typeof(p->'y') <> 'number'
    or jsonb_typeof(p->'width') <> 'number' or jsonb_typeof(p->'height') <> 'number' then return false; end if;
  x := (p->>'x')::numeric; y := (p->>'y')::numeric; w := (p->>'width')::numeric; h := (p->>'height')::numeric;
  return x >= 0 and y >= 0 and w > 0 and h > 0 and w <= 1 and h <= 1
    and x + w <= 1.000001 and y + h <= 1.000001;
end $$;

create function public.exercise_media_valid_cues(p text[]) returns boolean
language sql immutable security invoker set search_path = '' as $$
  select coalesce(cardinality(p), 0) <= 3
    and not exists (select 1 from unnest(coalesce(p, '{}'::text[])) c where c is null or char_length(btrim(c)) < 1 or char_length(c) > 160);
$$;

create function public.exercise_media_valid_caption_cues(p jsonb) returns boolean
language plpgsql immutable security invoker set search_path = '' as $$
declare item jsonb; previous_start integer := -1; total integer := 0; s integer; e integer;
begin
  if p is null or jsonb_typeof(p) <> 'array' then return false; end if;
  if jsonb_array_length(p) > 500 then return false; end if;
  for item in select value from jsonb_array_elements(p) loop
    if jsonb_typeof(item) <> 'object'
      or (select array_agg(k order by k) from jsonb_object_keys(item) k) <> array['end_ms','start_ms','text']
      or jsonb_typeof(item->'start_ms') <> 'number' or jsonb_typeof(item->'end_ms') <> 'number'
      or jsonb_typeof(item->'text') <> 'string' then return false; end if;
    if (item->>'start_ms') !~ '^[0-9]{1,6}$' or (item->>'end_ms') !~ '^[0-9]{1,6}$' then return false; end if;
    s := (item->>'start_ms')::integer; e := (item->>'end_ms')::integer;
    if s < previous_start or e <= s or e > 120000 then return false; end if;
    if char_length(btrim(item->>'text')) < 1 or char_length(item->>'text') > 500 then return false; end if;
    total := total + char_length(item->>'text');
    previous_start := s;
  end loop;
  return total <= 12000;
end $$;

-- ----- Revisions: immutable once published ----------------------------------
create table public.exercise_media_revisions (
  id uuid primary key default gen_random_uuid(),
  exercise_library_id uuid not null references public.exercise_library(id),
  uploaded_by_coach_id uuid not null references public.coaches(id),
  create_request_id uuid not null,
  based_on_revision_id uuid references public.exercise_media_revisions(id),
  status text not null default 'draft' check (status in ('draft','processing','ready','failed')),
  review_status text not null default 'needs_review' check (review_status in ('needs_review','approved')),
  reviewed_by_coach_id uuid references public.coaches(id),
  reviewed_at timestamptz,
  review_attestation jsonb,
  version integer not null default 1 check (version >= 1),
  recipe_version integer not null default 1 check (recipe_version >= 1),
  failure_code text check (failure_code ~ '^[a-z][a-z0-9_]{0,47}$'),
  alt_text text check (char_length(btrim(alt_text)) between 1 and 240 and char_length(alt_text) <= 240),
  end_frame_alt_text text check (char_length(btrim(end_frame_alt_text)) between 1 and 240 and char_length(end_frame_alt_text) <= 240),
  cues text[] not null default '{}'::text[] check (public.exercise_media_valid_cues(cues)),
  transcript text check (char_length(btrim(transcript)) between 1 and 12000 and char_length(transcript) <= 12000),
  caption_language text check (caption_language ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
  caption_cues jsonb not null default '[]'::jsonb check (public.exercise_media_valid_caption_cues(caption_cues)),
  instruction_audio boolean not null default false,
  include_instruction boolean not null default false,
  poster_mode text check (poster_mode in ('uploaded_image','video_frame')),
  poster_frame_ms integer check (poster_frame_ms between 0 and 120000),
  poster_crop jsonb check (public.exercise_media_valid_crop(poster_crop)),
  preview_start_ms integer check (preview_start_ms between 0 and 120000),
  preview_end_ms integer check (preview_end_ms between 0 and 120000),
  preview_crop jsonb check (public.exercise_media_valid_crop(preview_crop)),
  end_frame_ms integer check (end_frame_ms between 0 and 120000),
  end_frame_crop jsonb check (public.exercise_media_valid_crop(end_frame_crop)),
  published_at timestamptz,
  published_by_coach_id uuid references public.coaches(id),
  archived boolean not null default false,
  archived_at timestamptz,
  archived_by_coach_id uuid references public.coaches(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, exercise_library_id),
  check ((preview_start_ms is null) = (preview_end_ms is null)),
  check (preview_start_ms is null or preview_end_ms - preview_start_ms between 1000 and 8000),
  check (review_status = 'needs_review' or (status = 'ready' and reviewed_by_coach_id is not null and reviewed_at is not null and review_attestation is not null)),
  check (published_at is null or (status = 'ready' and review_status = 'approved' and published_by_coach_id is not null)),
  check (archived = (archived_at is not null))
);
create unique index exercise_media_revisions_create_request on public.exercise_media_revisions(uploaded_by_coach_id, create_request_id);
create index exercise_media_revisions_exercise on public.exercise_media_revisions(exercise_library_id, archived, created_at desc);
create index exercise_media_revisions_owner on public.exercise_media_revisions(uploaded_by_coach_id, archived);

-- ----- Assets: sources (private) and generated derivatives --------------------
create table public.exercise_media_assets (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.exercise_media_revisions(id),
  role text not null check (role in ('source_video','source_image','poster','end_frame','preview','instruction','captions')),
  -- Server-generated only. Sources are content blobs that later drafts may
  -- reference again; derivatives are keyed by revision + recipe version.
  storage_key text not null check (storage_key ~ '^(sources/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|mp4|mov|webm)|derivatives/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9]{1,6}-(poster|end_frame|preview|instruction|captions)\.(jpg|mp4|vtt))$'),
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp','video/mp4','video/quicktime','video/webm','text/vtt')),
  bytes bigint not null check (bytes > 0 and bytes <= 104857600),
  width integer check (width between 1 and 8192),
  height integer check (height between 1 and 8192),
  duration_ms integer check (duration_ms between 1 and 120000),
  has_audio boolean,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  rights_basis text check (rights_basis in ('owned','permissioned')),
  rights_note text check (char_length(rights_note) <= 1000),
  display_name text check (char_length(display_name) between 1 and 120),
  upload_request_id uuid,
  uploaded_by_coach_id uuid references public.coaches(id),
  copied_from_asset_id uuid references public.exercise_media_assets(id),
  recipe_version integer check (recipe_version >= 1),
  processor_version text check (char_length(processor_version) <= 120),
  archived boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  check ((role in ('source_video','source_image')) = (rights_basis is not null and uploaded_by_coach_id is not null)),
  check (role in ('source_video','source_image') or (recipe_version is not null and processor_version is not null and upload_request_id is null)),
  check (upload_request_id is null or copied_from_asset_id is null),
  check (role <> 'source_image' or (mime_type in ('image/jpeg','image/png','image/webp') and bytes <= 10485760 and width between 160 and 8192 and height between 160 and 8192)),
  check (role <> 'source_video' or (mime_type in ('video/mp4','video/quicktime','video/webm') and duration_ms is not null and width between 160 and 3840 and height between 160 and 3840)),
  check (role not in ('poster','end_frame') or (mime_type = 'image/jpeg' and width = 640 and height = 360 and bytes <= 163840)),
  check (role <> 'preview' or (mime_type = 'video/mp4' and bytes <= 2097152 and duration_ms between 900 and 8100 and has_audio = false)),
  check (role <> 'instruction' or (mime_type = 'video/mp4' and bytes <= 26214400 and duration_ms is not null)),
  check (role <> 'captions' or (mime_type = 'text/vtt' and bytes <= 65536)),
  check (archived = (archived_at is not null))
);
create unique index exercise_media_assets_active_role on public.exercise_media_assets(revision_id, role) where not archived;
create unique index exercise_media_assets_upload_request on public.exercise_media_assets(uploaded_by_coach_id, upload_request_id) where upload_request_id is not null;
create index exercise_media_assets_revision on public.exercise_media_assets(revision_id);

-- ----- Current pointer: one coherent guide per canonical exercise -------------
create table public.exercise_media_current (
  exercise_library_id uuid primary key references public.exercise_library(id),
  revision_id uuid,
  version integer not null default 0 check (version >= 0),
  updated_by_coach_id uuid references public.coaches(id),
  updated_at timestamptz not null default now(),
  foreign key (revision_id, exercise_library_id) references public.exercise_media_revisions(id, exercise_library_id)
);
create index exercise_media_current_revision on public.exercise_media_current(revision_id);

-- ----- Durable processing jobs (local worker claims with a lease) ------------
create table public.exercise_media_jobs (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.exercise_media_revisions(id),
  recipe_version integer not null check (recipe_version >= 1),
  state text not null default 'queued' check (state in ('queued','running','succeeded','failed')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  lease_token uuid,
  lease_expires_at timestamptz,
  worker_label text check (worker_label ~ '^[a-z0-9_.:-]{1,64}$'),
  error_code text check (error_code ~ '^[a-z][a-z0-9_]{0,47}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  unique (revision_id, recipe_version),
  check ((state = 'running') = (lease_token is not null and lease_expires_at is not null))
);
create index exercise_media_jobs_claim on public.exercise_media_jobs(state, lease_expires_at, created_at) where state in ('queued','running');

alter table public.exercise_media_revisions enable row level security;
alter table public.exercise_media_assets enable row level security;
alter table public.exercise_media_current enable row level security;
alter table public.exercise_media_jobs enable row level security;
revoke all on public.exercise_media_revisions, public.exercise_media_assets, public.exercise_media_current, public.exercise_media_jobs from public, anon, authenticated;
-- No DELETE: business rows are archived, never removed.
grant select, insert, update on public.exercise_media_revisions, public.exercise_media_assets, public.exercise_media_current, public.exercise_media_jobs to service_role;

-- ----- Guards ---------------------------------------------------------------
create function public.exercise_media_revision_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare mutable_after_publish text[] := array['archived','archived_at','archived_by_coach_id','updated_at'];
begin
  if tg_op = 'DELETE' then raise exception 'Exercise media revisions are archived, never deleted' using errcode = '42501'; end if;
  if new.id <> old.id or new.exercise_library_id <> old.exercise_library_id or new.uploaded_by_coach_id <> old.uploaded_by_coach_id
    or new.create_request_id <> old.create_request_id or new.based_on_revision_id is distinct from old.based_on_revision_id
    or new.created_at <> old.created_at then
    raise exception 'Exercise media revision identity is immutable' using errcode = '23514';
  end if;
  if old.archived and not new.archived then raise exception 'Archived revisions stay archived' using errcode = '23514'; end if;
  if old.published_at is not null and (to_jsonb(new) - mutable_after_publish) <> (to_jsonb(old) - mutable_after_publish) then
    raise exception 'Published exercise media revisions are immutable' using errcode = '23514';
  end if;
  if old.archived and (to_jsonb(new) - array['updated_at']) <> (to_jsonb(old) - array['updated_at']) then
    raise exception 'Archived exercise media revisions are immutable' using errcode = '23514';
  end if;
  if new.version <= old.version and (to_jsonb(new) - array['updated_at','archived','archived_at','archived_by_coach_id']) <> (to_jsonb(old) - array['updated_at','archived','archived_at','archived_by_coach_id']) then
    raise exception 'Exercise media revision changes must advance the version' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger exercise_media_revision_guard before update or delete on public.exercise_media_revisions
  for each row execute function public.exercise_media_revision_guard();

create function public.exercise_media_asset_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'Exercise media assets are archived, never deleted' using errcode = '42501'; end if;
  if old.archived and not new.archived then raise exception 'Archived assets stay archived' using errcode = '23514'; end if;
  if (to_jsonb(new) - array['archived','archived_at']) <> (to_jsonb(old) - array['archived','archived_at']) then
    raise exception 'Exercise media assets are immutable' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger exercise_media_asset_guard before update or delete on public.exercise_media_assets
  for each row execute function public.exercise_media_asset_guard();

create function public.exercise_media_current_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare r public.exercise_media_revisions%rowtype;
begin
  if tg_op = 'DELETE' then raise exception 'Exercise media pointers are cleared, never deleted' using errcode = '42501'; end if;
  if tg_op = 'UPDATE' and (new.version <= old.version or new.exercise_library_id <> old.exercise_library_id) then
    raise exception 'Exercise media pointer versions only advance' using errcode = '23514';
  end if;
  if new.revision_id is not null then
    select * into r from public.exercise_media_revisions where id = new.revision_id;
    if r.id is null or r.archived or r.published_at is null or r.status <> 'ready' or r.review_status <> 'approved' then
      raise exception 'Only a published, reviewed, ready revision can be current' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger exercise_media_current_guard before insert or update or delete on public.exercise_media_current
  for each row execute function public.exercise_media_current_guard();

-- ----- Helpers --------------------------------------------------------------
-- 'admin' | 'coach' for an active coach, else null. The caller id always comes
-- from the authenticated Express actor, never a request body.
create function public.exercise_media_actor_role(p_actor uuid) returns text
language sql stable security invoker set search_path = '' as $$
  select case when c.is_admin then 'admin' else 'coach' end
  from public.coaches c where c.id = p_actor and not c.archived;
$$;

create function public.exercise_media_required_roles(r public.exercise_media_revisions) returns text[]
language sql stable security invoker set search_path = '' as $$
  select array_remove(array[
    'poster',
    case when r.end_frame_ms is not null then 'end_frame' end,
    case when r.preview_start_ms is not null then 'preview' end,
    case when r.include_instruction then 'instruction' end,
    case when r.include_instruction and jsonb_array_length(r.caption_cues) > 0 then 'captions' end
  ], null);
$$;

create function public.exercise_media_has_required(r public.exercise_media_revisions) returns boolean
language sql stable security invoker set search_path = '' as $$
  select not exists (
    select 1 from unnest(public.exercise_media_required_roles(r)) need
    where not exists (
      select 1 from public.exercise_media_assets a
      where a.revision_id = r.id and a.role = need and not a.archived and a.recipe_version = r.recipe_version
    )
  );
$$;

create function public.exercise_media_archive_derivatives(p_revision_id uuid) returns void
language sql security invoker set search_path = '' as $$
  update public.exercise_media_assets set archived = true, archived_at = now()
  where revision_id = p_revision_id and not archived and role not in ('source_video','source_image');
$$;

-- Reads the editable revision for an actor, or returns a refusal outcome.
create function public.exercise_media_editable(p_actor uuid, p_revision_id uuid, p_expected_version integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_role text := public.exercise_media_actor_role(p_actor); r public.exercise_media_revisions%rowtype;
begin
  if v_role is null then return jsonb_build_object('outcome', 'forbidden'); end if;
  select * into r from public.exercise_media_revisions where id = p_revision_id for update;
  if r.id is null or r.archived or (v_role <> 'admin' and r.uploaded_by_coach_id <> p_actor) then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if r.published_at is not null then return jsonb_build_object('outcome', 'published_immutable'); end if;
  if p_expected_version is distinct from r.version then return jsonb_build_object('outcome', 'stale', 'version', r.version); end if;
  if r.status = 'processing' then return jsonb_build_object('outcome', 'processing'); end if;
  return jsonb_build_object('outcome', 'ok');
end $$;

-- ----- Draft lifecycle -------------------------------------------------------
create function public.exercise_media_create_draft(p_actor uuid, p_exercise_id uuid, p_request_id uuid, p_base_revision_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_role text := public.exercise_media_actor_role(p_actor); r public.exercise_media_revisions%rowtype;
  b public.exercise_media_revisions%rowtype; v_open integer;
begin
  if v_role is null then return jsonb_build_object('outcome', 'forbidden'); end if;
  if p_request_id is null then raise exception 'Request id required' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('exercise-media-draft/' || p_actor::text || '/' || p_request_id::text, 0));
  select * into r from public.exercise_media_revisions where uploaded_by_coach_id = p_actor and create_request_id = p_request_id;
  if r.id is not null then
    if r.exercise_library_id <> p_exercise_id or r.based_on_revision_id is distinct from p_base_revision_id then
      return jsonb_build_object('outcome', 'request_mismatch');
    end if;
    return jsonb_build_object('outcome', 'created', 'revision_id', r.id, 'replayed', true);
  end if;
  if not exists (select 1 from public.exercise_library where id = p_exercise_id and not archived) then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  select count(*) into v_open from public.exercise_media_revisions
  where exercise_library_id = p_exercise_id and uploaded_by_coach_id = p_actor and not archived and published_at is null;
  if v_open >= 5 then return jsonb_build_object('outcome', 'draft_limit'); end if;
  if p_base_revision_id is not null then
    -- Only the exercise's current published guide can seed a new draft.
    select rev.* into b from public.exercise_media_current c
      join public.exercise_media_revisions rev on rev.id = c.revision_id
      where c.exercise_library_id = p_exercise_id and c.revision_id = p_base_revision_id and not rev.archived;
    if b.id is null then return jsonb_build_object('outcome', 'base_not_current'); end if;
  end if;
  insert into public.exercise_media_revisions (
    exercise_library_id, uploaded_by_coach_id, create_request_id, based_on_revision_id,
    alt_text, end_frame_alt_text, cues, transcript, caption_language, caption_cues, instruction_audio,
    include_instruction, poster_mode, poster_frame_ms, poster_crop, preview_start_ms, preview_end_ms,
    preview_crop, end_frame_ms, end_frame_crop
  ) values (
    p_exercise_id, p_actor, p_request_id, b.id,
    b.alt_text, b.end_frame_alt_text, coalesce(b.cues, '{}'::text[]), b.transcript, b.caption_language,
    coalesce(b.caption_cues, '[]'::jsonb), coalesce(b.instruction_audio, false), coalesce(b.include_instruction, false),
    b.poster_mode, b.poster_frame_ms, b.poster_crop, b.preview_start_ms, b.preview_end_ms,
    b.preview_crop, b.end_frame_ms, b.end_frame_crop
  ) returning * into r;
  if b.id is not null then
    -- Source blobs are immutable and retained; the copy keeps the original
    -- uploader and rights record rather than re-attributing them.
    insert into public.exercise_media_assets (revision_id, role, storage_key, mime_type, bytes, width, height,
      duration_ms, has_audio, sha256, rights_basis, rights_note, display_name, uploaded_by_coach_id, copied_from_asset_id)
    select r.id, a.role, a.storage_key, a.mime_type, a.bytes, a.width, a.height, a.duration_ms, a.has_audio, a.sha256,
      a.rights_basis, a.rights_note, a.display_name, a.uploaded_by_coach_id, a.id
    from public.exercise_media_assets a
    where a.revision_id = b.id and not a.archived and a.role in ('source_video','source_image');
  end if;
  return jsonb_build_object('outcome', 'created', 'revision_id', r.id, 'replayed', false);
end $$;

create function public.exercise_media_update_draft(p_actor uuid, p_revision_id uuid, p_expected_version integer, p_patch jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare gate jsonb; r public.exercise_media_revisions%rowtype; n public.exercise_media_revisions%rowtype;
  allowed text[] := array['alt_text','end_frame_alt_text','cues','transcript','caption_language','caption_cues',
    'instruction_audio','include_instruction','poster_mode','poster_frame_ms','poster_crop','preview_start_ms',
    'preview_end_ms','preview_crop','end_frame_ms','end_frame_crop'];
  recipe_keys text[] := array['caption_language','caption_cues','include_instruction','poster_mode','poster_frame_ms',
    'poster_crop','preview_start_ms','preview_end_ms','preview_crop','end_frame_ms','end_frame_crop'];
  recipe_changed boolean; any_changed boolean;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or exists (select 1 from jsonb_object_keys(p_patch) k where k <> all(allowed)) then
    return jsonb_build_object('outcome', 'invalid_patch');
  end if;
  gate := public.exercise_media_editable(p_actor, p_revision_id, p_expected_version);
  if gate->>'outcome' <> 'ok' then return gate; end if;
  select * into r from public.exercise_media_revisions where id = p_revision_id;
  n := jsonb_populate_record(r, p_patch);
  recipe_changed := (to_jsonb(n) - array(select k from jsonb_object_keys(to_jsonb(n)) k where k <> all(recipe_keys)))
    <> (to_jsonb(r) - array(select k from jsonb_object_keys(to_jsonb(r)) k where k <> all(recipe_keys)));
  any_changed := (to_jsonb(n) - array(select k from jsonb_object_keys(to_jsonb(n)) k where k <> all(allowed)))
    <> (to_jsonb(r) - array(select k from jsonb_object_keys(to_jsonb(r)) k where k <> all(allowed)));
  if not any_changed then return jsonb_build_object('outcome', 'unchanged', 'version', r.version); end if;
  update public.exercise_media_revisions set
    alt_text = n.alt_text, end_frame_alt_text = n.end_frame_alt_text, cues = n.cues, transcript = n.transcript,
    caption_language = n.caption_language, caption_cues = n.caption_cues, instruction_audio = n.instruction_audio,
    include_instruction = n.include_instruction, poster_mode = n.poster_mode, poster_frame_ms = n.poster_frame_ms,
    poster_crop = n.poster_crop, preview_start_ms = n.preview_start_ms, preview_end_ms = n.preview_end_ms,
    preview_crop = n.preview_crop, end_frame_ms = n.end_frame_ms, end_frame_crop = n.end_frame_crop,
    version = r.version + 1,
    recipe_version = r.recipe_version + case when recipe_changed then 1 else 0 end,
    status = case when recipe_changed then 'draft' else r.status end,
    failure_code = case when recipe_changed then null else r.failure_code end,
    review_status = 'needs_review', reviewed_by_coach_id = null, reviewed_at = null, review_attestation = null,
    updated_at = now()
  where id = r.id returning * into n;
  if recipe_changed then perform public.exercise_media_archive_derivatives(r.id); end if;
  return jsonb_build_object('outcome', 'updated', 'version', n.version, 'recipe_changed', recipe_changed);
end $$;

create function public.exercise_media_attach_source(p_actor uuid, p_revision_id uuid, p_expected_version integer, p_asset jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare gate jsonb; r public.exercise_media_revisions%rowtype; existing public.exercise_media_assets%rowtype;
  v_role text := p_asset->>'role'; v_request uuid := (p_asset->>'upload_request_id')::uuid; a public.exercise_media_assets%rowtype;
begin
  if v_role not in ('source_video','source_image') or v_request is null then return jsonb_build_object('outcome', 'invalid_asset'); end if;
  perform pg_advisory_xact_lock(hashtextextended('exercise-media-upload/' || p_actor::text || '/' || v_request::text, 0));
  select * into existing from public.exercise_media_assets where uploaded_by_coach_id = p_actor and upload_request_id = v_request;
  if existing.id is not null then
    if existing.revision_id = p_revision_id and existing.role = v_role and existing.sha256 = p_asset->>'sha256' then
      select * into r from public.exercise_media_revisions where id = p_revision_id;
      return jsonb_build_object('outcome', 'attached', 'asset_id', existing.id, 'version', r.version, 'replayed', true);
    end if;
    return jsonb_build_object('outcome', 'request_mismatch');
  end if;
  gate := public.exercise_media_editable(p_actor, p_revision_id, p_expected_version);
  if gate->>'outcome' <> 'ok' then return gate; end if;
  select * into r from public.exercise_media_revisions where id = p_revision_id;
  update public.exercise_media_assets set archived = true, archived_at = now()
  where revision_id = r.id and role = v_role and not archived;
  insert into public.exercise_media_assets (id, revision_id, role, storage_key, mime_type, bytes, width, height,
    duration_ms, has_audio, sha256, rights_basis, rights_note, display_name, upload_request_id, uploaded_by_coach_id)
  values ((p_asset->>'id')::uuid, r.id, v_role, p_asset->>'storage_key', p_asset->>'mime_type', (p_asset->>'bytes')::bigint,
    (p_asset->>'width')::integer, (p_asset->>'height')::integer, (p_asset->>'duration_ms')::integer,
    (p_asset->>'has_audio')::boolean, p_asset->>'sha256', p_asset->>'rights_basis', nullif(p_asset->>'rights_note', ''),
    nullif(p_asset->>'display_name', ''), v_request, p_actor)
  returning * into a;
  -- A changed source invalidates the recipe parts that depended on it.
  update public.exercise_media_revisions set
    poster_mode = coalesce(r.poster_mode, case when v_role = 'source_image' then 'uploaded_image' else 'video_frame' end),
    poster_crop = case when (v_role = 'source_image' and r.poster_mode = 'uploaded_image') or (v_role = 'source_video' and r.poster_mode = 'video_frame') then null else r.poster_crop end,
    poster_frame_ms = case when v_role = 'source_video' then null else r.poster_frame_ms end,
    preview_start_ms = case when v_role = 'source_video' then null else r.preview_start_ms end,
    preview_end_ms = case when v_role = 'source_video' then null else r.preview_end_ms end,
    preview_crop = case when v_role = 'source_video' then null else r.preview_crop end,
    end_frame_ms = case when v_role = 'source_video' then null else r.end_frame_ms end,
    end_frame_crop = case when v_role = 'source_video' then null else r.end_frame_crop end,
    version = r.version + 1, recipe_version = r.recipe_version + 1, status = 'draft', failure_code = null,
    review_status = 'needs_review', reviewed_by_coach_id = null, reviewed_at = null, review_attestation = null,
    updated_at = now()
  where id = r.id returning * into r;
  perform public.exercise_media_archive_derivatives(r.id);
  return jsonb_build_object('outcome', 'attached', 'asset_id', a.id, 'version', r.version, 'replayed', false);
end $$;

create function public.exercise_media_remove_source(p_actor uuid, p_revision_id uuid, p_expected_version integer, p_role text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare gate jsonb; r public.exercise_media_revisions%rowtype;
begin
  if p_role not in ('source_video','source_image') then return jsonb_build_object('outcome', 'invalid_asset'); end if;
  gate := public.exercise_media_editable(p_actor, p_revision_id, p_expected_version);
  if gate->>'outcome' <> 'ok' then return gate; end if;
  select * into r from public.exercise_media_revisions where id = p_revision_id;
  if not exists (select 1 from public.exercise_media_assets where revision_id = r.id and role = p_role and not archived) then
    return jsonb_build_object('outcome', 'unchanged', 'version', r.version);
  end if;
  update public.exercise_media_assets set archived = true, archived_at = now() where revision_id = r.id and role = p_role and not archived;
  update public.exercise_media_revisions set
    poster_mode = case when (p_role = 'source_image' and r.poster_mode = 'uploaded_image') or (p_role = 'source_video' and r.poster_mode = 'video_frame') then null else r.poster_mode end,
    poster_crop = case when (p_role = 'source_image' and r.poster_mode = 'uploaded_image') or (p_role = 'source_video' and r.poster_mode = 'video_frame') then null else r.poster_crop end,
    poster_frame_ms = case when p_role = 'source_video' then null else r.poster_frame_ms end,
    preview_start_ms = case when p_role = 'source_video' then null else r.preview_start_ms end,
    preview_end_ms = case when p_role = 'source_video' then null else r.preview_end_ms end,
    preview_crop = case when p_role = 'source_video' then null else r.preview_crop end,
    end_frame_ms = case when p_role = 'source_video' then null else r.end_frame_ms end,
    end_frame_crop = case when p_role = 'source_video' then null else r.end_frame_crop end,
    include_instruction = case when p_role = 'source_video' then false else r.include_instruction end,
    version = r.version + 1, recipe_version = r.recipe_version + 1, status = 'draft', failure_code = null,
    review_status = 'needs_review', reviewed_by_coach_id = null, reviewed_at = null, review_attestation = null,
    updated_at = now()
  where id = r.id returning * into r;
  perform public.exercise_media_archive_derivatives(r.id);
  return jsonb_build_object('outcome', 'updated', 'version', r.version);
end $$;

-- Validates the stored recipe against the stored source facts and queues one
-- job per (revision, recipe version). A failed job for the same recipe is
-- re-queued as a new attempt, never duplicated.
create function public.exercise_media_request_processing(p_actor uuid, p_revision_id uuid, p_expected_version integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare gate jsonb; r public.exercise_media_revisions%rowtype; img public.exercise_media_assets%rowtype;
  vid public.exercise_media_assets%rowtype; j public.exercise_media_jobs%rowtype; problem text;
begin
  gate := public.exercise_media_editable(p_actor, p_revision_id, p_expected_version);
  if gate->>'outcome' <> 'ok' then return gate; end if;
  select * into r from public.exercise_media_revisions where id = p_revision_id;
  select * into img from public.exercise_media_assets where revision_id = r.id and role = 'source_image' and not archived;
  select * into vid from public.exercise_media_assets where revision_id = r.id and role = 'source_video' and not archived;
  problem := case
    when r.status = 'ready' then 'already_ready'
    when r.alt_text is null then 'alt_text_required'
    when r.poster_mode is null then 'poster_required'
    when r.poster_crop is null then 'poster_crop_required'
    when r.poster_mode = 'uploaded_image' and img.id is null then 'source_image_required'
    when r.poster_mode = 'video_frame' and (vid.id is null or r.poster_frame_ms is null) then 'poster_frame_required'
    when r.poster_mode = 'video_frame' and r.poster_frame_ms >= vid.duration_ms then 'poster_frame_out_of_range'
    when vid.id is null and (r.preview_start_ms is not null or r.end_frame_ms is not null or r.include_instruction) then 'source_video_required'
    when r.preview_start_ms is not null and r.preview_end_ms > vid.duration_ms then 'preview_out_of_range'
    when r.end_frame_ms is not null and r.end_frame_ms >= vid.duration_ms then 'end_frame_out_of_range'
    when r.end_frame_ms is not null and (r.end_frame_crop is null or r.end_frame_alt_text is null) then 'end_frame_incomplete'
    when r.include_instruction and exists (select 1 from jsonb_array_elements(r.caption_cues) c where (c->>'end_ms')::integer > vid.duration_ms) then 'captions_out_of_range'
    else null end;
  if problem is not null then return jsonb_build_object('outcome', 'invalid_recipe', 'code', problem); end if;
  insert into public.exercise_media_jobs (revision_id, recipe_version) values (r.id, r.recipe_version)
  on conflict (revision_id, recipe_version) do update set
    state = 'queued', attempts = 0, lease_token = null, lease_expires_at = null, worker_label = null,
    error_code = null, finished_at = null, updated_at = now()
  where public.exercise_media_jobs.state = 'failed'
  returning * into j;
  if j.id is null then select * into j from public.exercise_media_jobs where revision_id = r.id and recipe_version = r.recipe_version; end if;
  update public.exercise_media_revisions set status = 'processing', failure_code = null, version = r.version + 1, updated_at = now()
  where id = r.id returning * into r;
  return jsonb_build_object('outcome', 'queued', 'job_id', j.id, 'version', r.version);
end $$;

-- ----- Worker lease protocol ------------------------------------------------
create function public.exercise_media_claim_job(p_worker text, p_lease_seconds integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare j public.exercise_media_jobs%rowtype; r public.exercise_media_revisions%rowtype;
begin
  if p_lease_seconds is null or p_lease_seconds < 5 or p_lease_seconds > 900 then raise exception 'Lease out of range' using errcode = '22023'; end if;
  loop
    select * into j from public.exercise_media_jobs
    where state = 'queued' or (state = 'running' and lease_expires_at < clock_timestamp())
    order by created_at, id for update skip locked limit 1;
    if j.id is null then return jsonb_build_object('outcome', 'idle'); end if;
    select * into r from public.exercise_media_revisions where id = j.revision_id for update;
    if r.archived or r.status <> 'processing' or r.recipe_version <> j.recipe_version then
      update public.exercise_media_jobs set state = 'failed', error_code = 'superseded', lease_token = null,
        lease_expires_at = null, finished_at = now(), updated_at = now() where id = j.id;
      continue;
    end if;
    if j.attempts >= j.max_attempts then
      update public.exercise_media_jobs set state = 'failed', error_code = 'attempts_exhausted', lease_token = null,
        lease_expires_at = null, finished_at = now(), updated_at = now() where id = j.id;
      update public.exercise_media_revisions set status = 'failed', failure_code = 'attempts_exhausted',
        version = r.version + 1, updated_at = now() where id = r.id;
      continue;
    end if;
    update public.exercise_media_jobs set state = 'running', attempts = j.attempts + 1, lease_token = gen_random_uuid(),
      lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds), worker_label = p_worker,
      started_at = coalesce(j.started_at, now()), updated_at = now()
    where id = j.id returning * into j;
    return jsonb_build_object('outcome', 'claimed', 'job', to_jsonb(j), 'revision', to_jsonb(r),
      'sources', coalesce((select jsonb_agg(to_jsonb(a)) from public.exercise_media_assets a
        where a.revision_id = r.id and not a.archived and a.role in ('source_video','source_image')), '[]'::jsonb));
  end loop;
end $$;

create function public.exercise_media_extend_lease(p_job_id uuid, p_lease_token uuid, p_lease_seconds integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare j public.exercise_media_jobs%rowtype;
begin
  update public.exercise_media_jobs set lease_expires_at = clock_timestamp() + make_interval(secs => least(greatest(p_lease_seconds, 5), 900)), updated_at = now()
  where id = p_job_id and state = 'running' and lease_token = p_lease_token returning * into j;
  return jsonb_build_object('outcome', case when j.id is null then 'lost' else 'extended' end);
end $$;

create function public.exercise_media_complete_job(p_job_id uuid, p_lease_token uuid, p_assets jsonb, p_processor_version text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare j public.exercise_media_jobs%rowtype; r public.exercise_media_revisions%rowtype; item jsonb; v_role text; v_ext text;
begin
  select * into j from public.exercise_media_jobs where id = p_job_id for update;
  if j.id is null or j.state <> 'running' or j.lease_token is distinct from p_lease_token then return jsonb_build_object('outcome', 'lost'); end if;
  select * into r from public.exercise_media_revisions where id = j.revision_id for update;
  if r.archived or r.status <> 'processing' or r.recipe_version <> j.recipe_version then
    update public.exercise_media_jobs set state = 'failed', error_code = 'superseded', lease_token = null, lease_expires_at = null,
      finished_at = now(), updated_at = now() where id = j.id;
    return jsonb_build_object('outcome', 'superseded');
  end if;
  if p_assets is null or jsonb_typeof(p_assets) <> 'array' then raise exception 'Derivative manifest required' using errcode = '22023'; end if;
  perform public.exercise_media_archive_derivatives(r.id);
  for item in select value from jsonb_array_elements(p_assets) loop
    v_role := item->>'role';
    v_ext := case v_role when 'preview' then 'mp4' when 'instruction' then 'mp4' when 'captions' then 'vtt' else 'jpg' end;
    if v_role not in ('poster','end_frame','preview','instruction','captions')
      or item->>'storage_key' <> format('derivatives/%s/%s-%s.%s', r.id, r.recipe_version, v_role, v_ext) then
      raise exception 'Unexpected derivative' using errcode = '22023';
    end if;
    insert into public.exercise_media_assets (revision_id, role, storage_key, mime_type, bytes, width, height, duration_ms,
      has_audio, sha256, recipe_version, processor_version)
    values (r.id, v_role, item->>'storage_key', item->>'mime_type', (item->>'bytes')::bigint, (item->>'width')::integer,
      (item->>'height')::integer, (item->>'duration_ms')::integer, (item->>'has_audio')::boolean, item->>'sha256',
      r.recipe_version, p_processor_version);
  end loop;
  if not public.exercise_media_has_required(r) then raise exception 'Required derivatives missing' using errcode = '23514'; end if;
  update public.exercise_media_jobs set state = 'succeeded', error_code = null, lease_token = null, lease_expires_at = null,
    finished_at = now(), updated_at = now() where id = j.id;
  update public.exercise_media_revisions set status = 'ready', failure_code = null, version = r.version + 1, updated_at = now()
  where id = r.id returning * into r;
  return jsonb_build_object('outcome', 'ready', 'version', r.version);
end $$;

create function public.exercise_media_fail_job(p_job_id uuid, p_lease_token uuid, p_error_code text, p_retryable boolean)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare j public.exercise_media_jobs%rowtype; r public.exercise_media_revisions%rowtype;
begin
  if p_error_code !~ '^[a-z][a-z0-9_]{0,47}$' then p_error_code := 'processing_failed'; end if;
  select * into j from public.exercise_media_jobs where id = p_job_id for update;
  if j.id is null or j.state <> 'running' or j.lease_token is distinct from p_lease_token then return jsonb_build_object('outcome', 'lost'); end if;
  if p_retryable and j.attempts < j.max_attempts then
    update public.exercise_media_jobs set state = 'queued', error_code = p_error_code, lease_token = null, lease_expires_at = null, updated_at = now() where id = j.id;
    return jsonb_build_object('outcome', 'requeued');
  end if;
  update public.exercise_media_jobs set state = 'failed', error_code = p_error_code, lease_token = null, lease_expires_at = null,
    finished_at = now(), updated_at = now() where id = j.id;
  select * into r from public.exercise_media_revisions where id = j.revision_id for update;
  if not r.archived and r.status = 'processing' and r.recipe_version = j.recipe_version then
    update public.exercise_media_revisions set status = 'failed', failure_code = p_error_code, version = r.version + 1, updated_at = now() where id = r.id;
  end if;
  return jsonb_build_object('outcome', 'failed');
end $$;

-- ----- Review, publication, withdrawal -----------------------------------------
create function public.exercise_media_review(p_actor uuid, p_revision_id uuid, p_expected_version integer, p_attestation jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_role text := public.exercise_media_actor_role(p_actor); r public.exercise_media_revisions%rowtype; instr public.exercise_media_assets%rowtype;
begin
  if v_role is null then return jsonb_build_object('outcome', 'forbidden'); end if;
  select * into r from public.exercise_media_revisions where id = p_revision_id for update;
  if r.id is null or r.archived or (v_role <> 'admin' and r.uploaded_by_coach_id <> p_actor) then return jsonb_build_object('outcome', 'not_found'); end if;
  if r.published_at is not null then return jsonb_build_object('outcome', 'published_immutable'); end if;
  if p_expected_version is distinct from r.version then return jsonb_build_object('outcome', 'stale', 'version', r.version); end if;
  if r.status <> 'ready' or not public.exercise_media_has_required(r) then return jsonb_build_object('outcome', 'not_ready'); end if;
  if p_attestation is null or jsonb_typeof(p_attestation) <> 'object'
    or (select array_agg(k order by k) from jsonb_object_keys(p_attestation) k) <> array['content_confirmed','rights_confirmed','variant_confirmed']
    or p_attestation->'variant_confirmed' <> 'true'::jsonb or p_attestation->'rights_confirmed' <> 'true'::jsonb
    or p_attestation->'content_confirmed' <> 'true'::jsonb then
    return jsonb_build_object('outcome', 'attestation_required');
  end if;
  select * into instr from public.exercise_media_assets where revision_id = r.id and role = 'instruction' and not archived;
  if instr.id is not null and instr.has_audio and r.instruction_audio
    and (jsonb_array_length(r.caption_cues) = 0 or r.transcript is null) then
    return jsonb_build_object('outcome', 'captions_required');
  end if;
  update public.exercise_media_revisions set review_status = 'approved', reviewed_by_coach_id = p_actor, reviewed_at = now(),
    review_attestation = p_attestation, version = r.version + 1, updated_at = now()
  where id = r.id returning * into r;
  return jsonb_build_object('outcome', 'approved', 'version', r.version);
end $$;

create function public.exercise_media_publish(p_actor uuid, p_exercise_id uuid, p_revision_id uuid, p_expected_current_version integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_role text := public.exercise_media_actor_role(p_actor); r public.exercise_media_revisions%rowtype;
  c public.exercise_media_current%rowtype; cur public.exercise_media_revisions%rowtype;
begin
  if v_role is null then return jsonb_build_object('outcome', 'forbidden'); end if;
  if p_expected_current_version is null or p_expected_current_version < 0 then return jsonb_build_object('outcome', 'invalid_version'); end if;
  -- Lock the exercise first: it serializes the very first publish, when no
  -- pointer row exists yet to lock.
  perform 1 from public.exercise_library where id = p_exercise_id and not archived for update;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  select * into c from public.exercise_media_current where exercise_library_id = p_exercise_id for update;
  if coalesce(c.version, 0) <> p_expected_current_version then
    return jsonb_build_object('outcome', 'stale', 'current_version', coalesce(c.version, 0));
  end if;
  select * into r from public.exercise_media_revisions where id = p_revision_id for update;
  if r.id is null or r.exercise_library_id <> p_exercise_id or r.archived or (v_role <> 'admin' and r.uploaded_by_coach_id <> p_actor) then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if r.published_at is not null then return jsonb_build_object('outcome', 'already_published'); end if;
  if r.status <> 'ready' or r.review_status <> 'approved' or not public.exercise_media_has_required(r) then
    return jsonb_build_object('outcome', 'not_ready');
  end if;
  if c.revision_id is not null and v_role <> 'admin' then
    select * into cur from public.exercise_media_revisions where id = c.revision_id;
    if cur.uploaded_by_coach_id <> p_actor then return jsonb_build_object('outcome', 'replace_requires_admin'); end if;
  end if;
  update public.exercise_media_revisions set published_at = now(), published_by_coach_id = p_actor, version = r.version + 1, updated_at = now()
  where id = r.id;
  if c.exercise_library_id is null then
    insert into public.exercise_media_current (exercise_library_id, revision_id, version, updated_by_coach_id, updated_at)
    values (p_exercise_id, r.id, 1, p_actor, now()) returning * into c;
  else
    update public.exercise_media_current set revision_id = r.id, version = c.version + 1, updated_by_coach_id = p_actor, updated_at = now()
    where exercise_library_id = p_exercise_id returning * into c;
  end if;
  return jsonb_build_object('outcome', 'published', 'current_version', c.version, 'revision_id', r.id);
end $$;

-- Archives a draft, or withdraws the current guide (clearing the pointer; an
-- older revision is never silently resurrected).
create function public.exercise_media_archive(p_actor uuid, p_revision_id uuid, p_expected_current_version integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_role text := public.exercise_media_actor_role(p_actor); r public.exercise_media_revisions%rowtype;
  c public.exercise_media_current%rowtype; was_current boolean := false;
begin
  if v_role is null then return jsonb_build_object('outcome', 'forbidden'); end if;
  select * into r from public.exercise_media_revisions where id = p_revision_id;
  if r.id is null or r.archived or (v_role <> 'admin' and r.uploaded_by_coach_id <> p_actor) then return jsonb_build_object('outcome', 'not_found'); end if;
  -- Lock order everywhere: exercise -> pointer -> jobs -> revision, matching
  -- publish and the worker's job -> revision order.
  perform 1 from public.exercise_library where id = r.exercise_library_id for update;
  select * into c from public.exercise_media_current where exercise_library_id = r.exercise_library_id for update;
  perform 1 from public.exercise_media_jobs where revision_id = p_revision_id and state in ('queued','running') for update;
  select * into r from public.exercise_media_revisions where id = p_revision_id for update;
  if r.archived then return jsonb_build_object('outcome', 'not_found'); end if;
  if c.revision_id = r.id then
    was_current := true;
    if p_expected_current_version is distinct from c.version then
      return jsonb_build_object('outcome', 'stale', 'current_version', c.version);
    end if;
    update public.exercise_media_current set revision_id = null, version = c.version + 1, updated_by_coach_id = p_actor, updated_at = now()
    where exercise_library_id = c.exercise_library_id returning * into c;
  end if;
  update public.exercise_media_revisions set archived = true, archived_at = now(), archived_by_coach_id = p_actor, updated_at = now()
  where id = r.id;
  update public.exercise_media_jobs set state = 'failed', error_code = 'superseded', lease_token = null, lease_expires_at = null,
    finished_at = now(), updated_at = now() where revision_id = r.id and state in ('queued','running');
  return jsonb_build_object('outcome', 'archived', 'was_current', was_current, 'current_version', c.version);
end $$;

-- ----- Batched reads ---------------------------------------------------------
-- Current client-visible guides for up to 500 canonical exercises in one round
-- trip. Archived exercises/revisions and missing derivatives return nothing.
create function public.exercise_media_current_bundle(p_exercise_ids uuid[])
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
begin
  if cardinality(p_exercise_ids) > 500 then raise exception 'Too many exercises' using errcode = '22023'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'exercise_library_id', c.exercise_library_id, 'version', c.version, 'revision_id', r.id,
      'alt_text', r.alt_text, 'end_frame_alt_text', r.end_frame_alt_text, 'cues', to_jsonb(r.cues),
      'transcript_available', r.transcript is not null, 'caption_language', r.caption_language,
      'assets', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'role', a.role, 'width', a.width, 'height', a.height,
          'duration_ms', a.duration_ms, 'has_audio', a.has_audio, 'bytes', a.bytes) order by a.role)
        from public.exercise_media_assets a
        where a.revision_id = r.id and not a.archived and a.recipe_version = r.recipe_version
          and a.role in ('poster','end_frame','preview','instruction','captions')), '[]'::jsonb)
    ) order by c.exercise_library_id)
    from public.exercise_media_current c
    join public.exercise_media_revisions r on r.id = c.revision_id
    join public.exercise_library e on e.id = c.exercise_library_id
    where c.exercise_library_id = any(coalesce(p_exercise_ids, '{}'::uuid[]))
      and not e.archived and not r.archived and r.published_at is not null
      and r.status = 'ready' and r.review_status = 'approved'
  ), '[]'::jsonb);
end $$;

-- Catalog readiness for the coach library, computed in one query. Drafts are
-- counted only where the actor may see them (their own, or all for admin).
create function public.exercise_media_library_status(p_actor uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_role text := public.exercise_media_actor_role(p_actor);
begin
  if v_role is null then return null; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'exercise_library_id', e.id,
      'current_version', coalesce(c.version, 0),
      'current_revision_id', c.revision_id,
      'current_owner_id', cur.uploaded_by_coach_id,
      'current_kind', case
        when cur.id is null then 'none'
        when exists (select 1 from public.exercise_media_assets a where a.revision_id = cur.id and a.role = 'preview' and not a.archived) then 'video'
        when exists (select 1 from public.exercise_media_assets a where a.revision_id = cur.id and a.role = 'end_frame' and not a.archived) then 'frames'
        else 'photo' end,
      'current_has_instruction', cur.id is not null and exists (select 1 from public.exercise_media_assets a where a.revision_id = cur.id and a.role = 'instruction' and not a.archived),
      'drafts_needs_review', (select count(*) from public.exercise_media_revisions d where d.exercise_library_id = e.id and not d.archived
        and d.published_at is null and d.status = 'ready' and d.review_status = 'needs_review' and (v_role = 'admin' or d.uploaded_by_coach_id = p_actor)),
      'drafts_ready_to_publish', (select count(*) from public.exercise_media_revisions d where d.exercise_library_id = e.id and not d.archived
        and d.published_at is null and d.status = 'ready' and d.review_status = 'approved' and (v_role = 'admin' or d.uploaded_by_coach_id = p_actor)),
      'drafts_processing', (select count(*) from public.exercise_media_revisions d where d.exercise_library_id = e.id and not d.archived
        and d.published_at is null and d.status = 'processing' and (v_role = 'admin' or d.uploaded_by_coach_id = p_actor)),
      'drafts_failed', (select count(*) from public.exercise_media_revisions d where d.exercise_library_id = e.id and not d.archived
        and d.published_at is null and d.status = 'failed' and (v_role = 'admin' or d.uploaded_by_coach_id = p_actor)),
      'drafts_open', (select count(*) from public.exercise_media_revisions d where d.exercise_library_id = e.id and not d.archived
        and d.published_at is null and (v_role = 'admin' or d.uploaded_by_coach_id = p_actor))
    ) order by e.id)
    from public.exercise_library e
    left join public.exercise_media_current c on c.exercise_library_id = e.id
    left join public.exercise_media_revisions cur on cur.id = c.revision_id and not cur.archived
    where not e.archived
  ), '[]'::jsonb);
end $$;

-- Every helper is a service-only operation behind Express authorization.
revoke execute on function
  public.exercise_media_valid_crop(jsonb), public.exercise_media_valid_cues(text[]), public.exercise_media_valid_caption_cues(jsonb),
  public.exercise_media_revision_guard(), public.exercise_media_asset_guard(), public.exercise_media_current_guard(),
  public.exercise_media_actor_role(uuid), public.exercise_media_required_roles(public.exercise_media_revisions),
  public.exercise_media_has_required(public.exercise_media_revisions), public.exercise_media_archive_derivatives(uuid),
  public.exercise_media_editable(uuid, uuid, integer), public.exercise_media_create_draft(uuid, uuid, uuid, uuid),
  public.exercise_media_update_draft(uuid, uuid, integer, jsonb), public.exercise_media_attach_source(uuid, uuid, integer, jsonb),
  public.exercise_media_remove_source(uuid, uuid, integer, text), public.exercise_media_request_processing(uuid, uuid, integer),
  public.exercise_media_claim_job(text, integer), public.exercise_media_extend_lease(uuid, uuid, integer),
  public.exercise_media_complete_job(uuid, uuid, jsonb, text), public.exercise_media_fail_job(uuid, uuid, text, boolean),
  public.exercise_media_review(uuid, uuid, integer, jsonb), public.exercise_media_publish(uuid, uuid, uuid, integer),
  public.exercise_media_archive(uuid, uuid, integer), public.exercise_media_current_bundle(uuid[]),
  public.exercise_media_library_status(uuid)
from public, anon, authenticated;
grant execute on function
  public.exercise_media_valid_crop(jsonb), public.exercise_media_valid_cues(text[]), public.exercise_media_valid_caption_cues(jsonb),
  public.exercise_media_revision_guard(), public.exercise_media_asset_guard(), public.exercise_media_current_guard(),
  public.exercise_media_actor_role(uuid), public.exercise_media_required_roles(public.exercise_media_revisions),
  public.exercise_media_has_required(public.exercise_media_revisions), public.exercise_media_archive_derivatives(uuid),
  public.exercise_media_editable(uuid, uuid, integer), public.exercise_media_create_draft(uuid, uuid, uuid, uuid),
  public.exercise_media_update_draft(uuid, uuid, integer, jsonb), public.exercise_media_attach_source(uuid, uuid, integer, jsonb),
  public.exercise_media_remove_source(uuid, uuid, integer, text), public.exercise_media_request_processing(uuid, uuid, integer),
  public.exercise_media_claim_job(text, integer), public.exercise_media_extend_lease(uuid, uuid, integer),
  public.exercise_media_complete_job(uuid, uuid, jsonb, text), public.exercise_media_fail_job(uuid, uuid, text, boolean),
  public.exercise_media_review(uuid, uuid, integer, jsonb), public.exercise_media_publish(uuid, uuid, uuid, integer),
  public.exercise_media_archive(uuid, uuid, integer), public.exercise_media_current_bundle(uuid[]),
  public.exercise_media_library_status(uuid)
to service_role;
