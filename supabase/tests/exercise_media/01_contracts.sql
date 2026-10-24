-- Photo-only first, then the same exercise gains video through a draft seeded
-- from the current guide. Exercise identity never changes; published revisions
-- are immutable; validators reject malformed shapes.
do $$
declare A uuid := 'a0000000-0000-4000-8000-00000000000a'; ex uuid := 'e0000000-0000-4000-8000-000000000001';
  photo uuid; res jsonb; rev uuid; v integer; job jsonb; bundle jsonb; vid uuid := gen_random_uuid(); recipe integer;
begin
  photo := pg_temp.publish_photo(A, ex, gen_random_uuid(), 0);
  bundle := public.exercise_media_current_bundle(array[ex]);
  perform pg_temp.expect(jsonb_array_length(bundle) = 1 and bundle->0->>'revision_id' = photo::text and (bundle->0->>'version')::int = 1, 'photo-only current: ' || bundle::text);
  perform pg_temp.expect((select count(*) from jsonb_array_elements(bundle->0->'assets')) = 1 and bundle->0->'assets'->0->>'role' = 'poster', 'photo-only exposes only the poster');
  perform pg_temp.expect(not (bundle->0 ? 'storage_key') and bundle->0->'assets'->0 ? 'id' and not (bundle->0->'assets'->0 ? 'storage_key'), 'bundle never carries storage keys');
  perform pg_temp.expect(not exists (select 1 from public.exercise_media_assets where revision_id = photo and role like 'source_video'), 'no video row needed');

  -- Later: add video to the current photo without re-uploading it.
  res := public.exercise_media_create_draft(A, ex, gen_random_uuid(), photo);
  perform pg_temp.expect(res->>'outcome' = 'created', 'seeded draft: ' || res::text);
  rev := (res->>'revision_id')::uuid;
  perform pg_temp.expect((select count(*) from public.exercise_media_assets where revision_id = rev and role = 'source_image' and copied_from_asset_id is not null) = 1, 'source image reference copied');
  perform pg_temp.expect((select alt_text from public.exercise_media_revisions where id = rev) = 'Synthetic fixture photo', 'text copied');
  res := public.exercise_media_attach_source(A, rev, 1, pg_temp.source(vid, 'source_video', gen_random_uuid()));
  perform pg_temp.expect(res->>'outcome' = 'attached', 'attach video: ' || res::text);
  -- Custom uploaded thumbnail stays the poster; preview + instruction come from the video.
  res := public.exercise_media_update_draft(A, rev, (res->>'version')::int, jsonb_build_object(
    'poster_mode', 'uploaded_image', 'poster_crop', jsonb_build_object('x', 0, 'y', 0, 'width', 1, 'height', 1),
    'preview_start_ms', 500, 'preview_end_ms', 2500, 'include_instruction', true));
  perform pg_temp.expect(res->>'outcome' = 'updated' and (res->>'recipe_changed')::boolean, 'video recipe: ' || res::text);
  res := public.exercise_media_request_processing(A, rev, (res->>'version')::int);
  perform pg_temp.expect(res->>'outcome' = 'queued', 'queue video: ' || res::text);
  job := public.exercise_media_claim_job('fixture-worker', 30);
  recipe := (job->'job'->>'recipe_version')::int;
  perform pg_temp.expect(jsonb_array_length(job->'sources') = 2, 'worker sees both sources');
  res := public.exercise_media_complete_job((job->'job'->>'id')::uuid, (job->'job'->>'lease_token')::uuid, jsonb_build_array(
    pg_temp.derivative(rev, recipe, 'poster'), pg_temp.derivative(rev, recipe, 'preview'), pg_temp.derivative(rev, recipe, 'instruction')), 'fixture');
  perform pg_temp.expect(res->>'outcome' = 'ready', 'video ready: ' || res::text);
  -- Upload success is never approval.
  perform pg_temp.expect((select review_status from public.exercise_media_revisions where id = rev) = 'needs_review', 'ready is not approved');
  res := public.exercise_media_publish(A, ex, rev, 1);
  perform pg_temp.expect(res->>'outcome' = 'not_ready', 'unreviewed publish refused: ' || res::text);
  res := public.exercise_media_review(A, rev, (select version from public.exercise_media_revisions where id = rev),
    '{"variant_confirmed":true,"rights_confirmed":true,"content_confirmed":true}'::jsonb);
  res := public.exercise_media_publish(A, ex, rev, 1);
  perform pg_temp.expect(res->>'outcome' = 'published' and (res->>'current_version')::int = 2, 'video replaces photo: ' || res::text);
  bundle := public.exercise_media_current_bundle(array[ex]);
  perform pg_temp.expect(bundle->0->>'revision_id' = rev::text and bundle->0->>'exercise_library_id' = ex::text, 'same exercise id, new current');
  perform pg_temp.expect((select count(*) from jsonb_array_elements(bundle->0->'assets')) = 3, 'poster+preview+instruction exposed');

  -- Published revisions are immutable; archive is the only change.
  begin
    update public.exercise_media_revisions set alt_text = 'changed', version = version + 1 where id = photo;
    raise exception 'published revision changed';
  exception when check_violation then null; end;
  begin
    delete from public.exercise_media_revisions where id = photo;
    raise exception 'revision deleted';
  exception when insufficient_privilege then null; end;
  begin
    update public.exercise_media_assets set sha256 = repeat('f', 64) where revision_id = photo;
    raise exception 'asset changed';
  exception when check_violation then null; end;
  res := public.exercise_media_update_draft(A, photo, (select version from public.exercise_media_revisions where id = photo), '{"alt_text":"x"}');
  perform pg_temp.expect(res->>'outcome' = 'published_immutable', 'published edit refused: ' || res::text);
end $$;

-- Validators: malformed crops, cues, captions, keys and roles never store.
do $$
declare rev uuid; A uuid := 'a0000000-0000-4000-8000-00000000000a';
begin
  perform pg_temp.expect(public.exercise_media_valid_crop('{"x":0,"y":0,"width":1,"height":1}'), 'full crop ok');
  perform pg_temp.expect(public.exercise_media_valid_crop('{"x":0.25,"y":0.1,"width":0.5,"height":0.5}'), 'inner crop ok');
  perform pg_temp.expect(not public.exercise_media_valid_crop('{"x":0.6,"y":0,"width":0.5,"height":1}'), 'overflow rejected');
  perform pg_temp.expect(not public.exercise_media_valid_crop('{"x":0,"y":0,"width":0,"height":1}'), 'zero size rejected');
  perform pg_temp.expect(not public.exercise_media_valid_crop('{"x":-0.1,"y":0,"width":0.5,"height":1}'), 'negative rejected');
  perform pg_temp.expect(not public.exercise_media_valid_crop('{"x":"0","y":0,"width":1,"height":1}'), 'string coercion rejected');
  perform pg_temp.expect(not public.exercise_media_valid_crop('{"x":0,"y":0,"width":1,"height":1,"z":1}'), 'extra key rejected');
  perform pg_temp.expect(not public.exercise_media_valid_crop('[0,0,1,1]'), 'array rejected');
  perform pg_temp.expect(public.exercise_media_valid_cues(array['a','b','c']) and not public.exercise_media_valid_cues(array['a','b','c','d']), 'cue count');
  perform pg_temp.expect(not public.exercise_media_valid_cues(array[repeat('x', 161)]) and not public.exercise_media_valid_cues(array[' ']), 'cue length/blank');
  perform pg_temp.expect(public.exercise_media_valid_caption_cues('[{"start_ms":0,"end_ms":1000,"text":"One"},{"start_ms":1000,"end_ms":2000,"text":"Two"}]'), 'captions ok');
  perform pg_temp.expect(not public.exercise_media_valid_caption_cues('[{"start_ms":1000,"end_ms":2000,"text":"Two"},{"start_ms":0,"end_ms":1000,"text":"One"}]'), 'unordered captions rejected');
  perform pg_temp.expect(not public.exercise_media_valid_caption_cues('[{"start_ms":0,"end_ms":0,"text":"Zero"}]'), 'zero-length caption rejected');
  perform pg_temp.expect(not public.exercise_media_valid_caption_cues('[{"start_ms":1.5,"end_ms":2,"text":"Frac"}]'), 'fractional ms rejected');
  perform pg_temp.expect(not public.exercise_media_valid_caption_cues('[{"start_ms":0,"end_ms":130000,"text":"Long"}]'), 'beyond 120s rejected');

  rev := (public.exercise_media_create_draft(A, 'e0000000-0000-4000-8000-000000000002', gen_random_uuid(), null)->>'revision_id')::uuid;
  perform pg_temp.expect(public.exercise_media_update_draft(A, rev, 1, '{"status":"ready"}')->>'outcome' = 'invalid_patch', 'status not patchable');
  perform pg_temp.expect(public.exercise_media_update_draft(A, rev, 1, '{"uploaded_by_coach_id":"b0000000-0000-4000-8000-00000000000b"}')->>'outcome' = 'invalid_patch', 'owner not patchable');
  begin
    perform public.exercise_media_update_draft(A, rev, 1, '{"preview_start_ms":0,"preview_end_ms":9000}');
    raise exception 'long preview stored';
  exception when check_violation then null; end;
  begin
    perform public.exercise_media_update_draft(A, rev, 1, jsonb_build_object('alt_text', repeat('x', 241)));
    raise exception 'long alt stored';
  exception when check_violation then null; end;
  begin
    insert into public.exercise_media_assets (revision_id, role, storage_key, mime_type, bytes, sha256, rights_basis, uploaded_by_coach_id, width, height)
    values (rev, 'source_image', '../../etc/passwd', 'image/jpeg', 10, repeat('a', 64), 'owned', A, 200, 200);
    raise exception 'path key stored';
  exception when check_violation then null; end;
  begin
    insert into public.exercise_media_assets (revision_id, role, storage_key, mime_type, bytes, sha256, rights_basis, uploaded_by_coach_id, width, height)
    values (rev, 'source_image', format('sources/%s.svg', gen_random_uuid()), 'image/svg+xml', 10, repeat('a', 64), 'owned', A, 200, 200);
    raise exception 'svg stored';
  exception when check_violation then null; end;
  begin
    insert into public.exercise_media_assets (revision_id, role, storage_key, mime_type, bytes, sha256, uploaded_by_coach_id, width, height)
    values (rev, 'source_image', format('sources/%s.jpg', gen_random_uuid()), 'image/jpeg', 10, repeat('a', 64), A, 200, 200);
    raise exception 'source without rights stored';
  exception when check_violation then null; end;
  begin
    insert into public.exercise_media_assets (revision_id, role, storage_key, mime_type, bytes, sha256, recipe_version, processor_version, width, height)
    values (rev, 'poster', pg_temp.dkey(rev, 1, 'poster'), 'image/jpeg', 200000, repeat('a', 64), 1, 'x', 640, 360);
    raise exception 'oversized poster stored';
  exception when check_violation then null; end;
end $$;
