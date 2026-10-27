-- Session-local test helpers (pg_temp): shared by the rolled-back groups and
-- the committed race suite.
create function pg_temp.expect(ok boolean, message text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'EXPECTATION FAILED: %', message; end if;
end $$;

-- Derivative storage key exactly as the worker writes it.
create function pg_temp.dkey(rev uuid, recipe integer, role text) returns text language sql as $$
  select format('derivatives/%s/%s-%s.%s', rev, recipe, role,
    case role when 'preview' then 'mp4' when 'instruction' then 'mp4' when 'captions' then 'vtt' else 'jpg' end);
$$;

-- A valid generated derivative row for complete_job.
create function pg_temp.derivative(rev uuid, recipe integer, role text) returns jsonb language sql as $$
  select jsonb_build_object('role', role, 'storage_key', pg_temp.dkey(rev, recipe, role), 'sha256', repeat('a', 64),
    'mime_type', case role when 'captions' then 'text/vtt' when 'preview' then 'video/mp4' when 'instruction' then 'video/mp4' else 'image/jpeg' end,
    'bytes', case role when 'captions' then 120 when 'preview' then 90000 when 'instruction' then 400000 else 24000 end,
    'width', case when role in ('poster','end_frame') then 640 when role in ('preview','instruction') then 640 end,
    'height', case when role in ('poster','end_frame') then 360 when role in ('preview','instruction') then 360 end,
    'duration_ms', case role when 'preview' then 2000 when 'instruction' then 6000 end,
    'has_audio', case role when 'preview' then false when 'instruction' then false end);
$$;

create function pg_temp.source(asset uuid, role text, request uuid) returns jsonb language sql as $$
  select jsonb_build_object('id', asset, 'role', role, 'upload_request_id', request,
    'storage_key', format('sources/%s.%s', asset, case role when 'source_image' then 'jpg' else 'mp4' end),
    'mime_type', case role when 'source_image' then 'image/jpeg' else 'video/mp4' end,
    'bytes', case role when 'source_image' then 50000 else 900000 end,
    'width', case role when 'source_image' then 1280 else 1280 end,
    'height', case role when 'source_image' then 720 else 720 end,
    'duration_ms', case role when 'source_video' then 6000 end,
    'has_audio', case role when 'source_video' then false end,
    'sha256', repeat(case role when 'source_image' then 'b' else 'c' end, 64),
    'rights_basis', 'owned', 'rights_note', 'Fictional local fixture', 'display_name', 'synthetic.' || case role when 'source_image' then 'jpg' else 'mp4' end);
$$;

-- Photo-only path up to an approved, unpublished revision.
create function pg_temp.ready_photo(actor uuid, exercise uuid, request uuid) returns uuid language plpgsql as $$
declare res jsonb; rev uuid; v integer; job jsonb; asset uuid := gen_random_uuid();
begin
  res := public.exercise_media_create_draft(actor, exercise, request, null);
  rev := (res->>'revision_id')::uuid;
  res := public.exercise_media_attach_source(actor, rev, 1, pg_temp.source(asset, 'source_image', gen_random_uuid()));
  perform pg_temp.expect(res->>'outcome' = 'attached', 'attach image: ' || res::text);
  v := (res->>'version')::integer;
  res := public.exercise_media_update_draft(actor, rev, v, jsonb_build_object('alt_text', 'Synthetic fixture photo',
    'cues', jsonb_build_array('Synthetic cue'), 'poster_crop', jsonb_build_object('x', 0, 'y', 0, 'width', 1, 'height', 1)));
  perform pg_temp.expect(res->>'outcome' = 'updated', 'update recipe: ' || res::text);
  res := public.exercise_media_request_processing(actor, rev, (res->>'version')::integer);
  perform pg_temp.expect(res->>'outcome' = 'queued', 'queue: ' || res::text);
  job := public.exercise_media_claim_job('fixture-worker', 30);
  perform pg_temp.expect(job->>'outcome' = 'claimed' and job->'job'->>'revision_id' = rev::text, 'claim: ' || job::text);
  res := public.exercise_media_complete_job((job->'job'->>'id')::uuid, (job->'job'->>'lease_token')::uuid,
    jsonb_build_array(pg_temp.derivative(rev, (job->'job'->>'recipe_version')::integer, 'poster')), 'fixture-processor');
  perform pg_temp.expect(res->>'outcome' = 'ready', 'complete: ' || res::text);
  res := public.exercise_media_review(actor, rev, (res->>'version')::integer,
    '{"variant_confirmed":true,"rights_confirmed":true,"content_confirmed":true}'::jsonb);
  perform pg_temp.expect(res->>'outcome' = 'approved', 'review: ' || res::text);
  return rev;
end $$;

-- Photo-only happy path, reused by several groups: returns the published revision.
create function pg_temp.publish_photo(actor uuid, exercise uuid, request uuid, expected integer) returns uuid language plpgsql as $$
declare rev uuid := pg_temp.ready_photo(actor, exercise, request); res jsonb;
begin
  res := public.exercise_media_publish(actor, exercise, rev, expected);
  perform pg_temp.expect(res->>'outcome' = 'published', 'publish: ' || res::text);
  return rev;
end $$;
