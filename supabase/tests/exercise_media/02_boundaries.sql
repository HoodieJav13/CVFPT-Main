-- Ownership policy (proposed build default, see docs/exercise-media/design.md):
-- drafts/sources belong to their uploader or admin; another coach cannot edit,
-- review, publish, replace or withdraw them; admin can. Server-derived actors only.
do $$
declare A uuid := 'a0000000-0000-4000-8000-00000000000a'; B uuid := 'b0000000-0000-4000-8000-00000000000b';
  ADM uuid := 'ad000000-0000-4000-8000-0000000000ad'; ARCH uuid := 'c0000000-0000-4000-8000-00000000000c';
  ex uuid := 'e0000000-0000-4000-8000-000000000003'; res jsonb; a_rev uuid; b_rev uuid; draft uuid; req uuid := gen_random_uuid();
begin
  -- Unknown/archived actors are refused outright.
  perform pg_temp.expect(public.exercise_media_create_draft(ARCH, ex, gen_random_uuid(), null)->>'outcome' = 'forbidden', 'archived coach refused');
  perform pg_temp.expect(public.exercise_media_create_draft(gen_random_uuid(), ex, gen_random_uuid(), null)->>'outcome' = 'forbidden', 'unknown actor refused');
  perform pg_temp.expect(public.exercise_media_create_draft(A, 'e0000000-0000-4000-8000-000000000006', gen_random_uuid(), null)->>'outcome' = 'not_found', 'archived exercise refused');
  perform pg_temp.expect(public.exercise_media_create_draft(A, gen_random_uuid(), gen_random_uuid(), null)->>'outcome' = 'not_found', 'unknown exercise refused');

  -- Idempotent draft creation; a reused request id for something else is a mismatch.
  res := public.exercise_media_create_draft(A, ex, req, null);
  draft := (res->>'revision_id')::uuid;
  res := public.exercise_media_create_draft(A, ex, req, null);
  perform pg_temp.expect(res->>'revision_id' = draft::text and (res->>'replayed')::boolean, 'draft replay');
  perform pg_temp.expect(public.exercise_media_create_draft(A, 'e0000000-0000-4000-8000-000000000004', req, null)->>'outcome' = 'request_mismatch', 'draft mismatch');

  -- Coach B cannot see/edit/review/process/archive A's draft.
  perform pg_temp.expect(public.exercise_media_update_draft(B, draft, 1, '{"alt_text":"hijack"}')->>'outcome' = 'not_found', 'B edit refused');
  perform pg_temp.expect(public.exercise_media_attach_source(B, draft, 1, pg_temp.source(gen_random_uuid(), 'source_image', gen_random_uuid()))->>'outcome' = 'not_found', 'B upload refused');
  perform pg_temp.expect(public.exercise_media_request_processing(B, draft, 1)->>'outcome' = 'not_found', 'B process refused');
  perform pg_temp.expect(public.exercise_media_archive(B, draft, null)->>'outcome' = 'not_found', 'B archive refused');
  perform pg_temp.expect(public.exercise_media_update_draft(ADM, draft, 1, '{"alt_text":"Admin edit"}')->>'outcome' = 'updated', 'admin may edit');
  perform pg_temp.expect(public.exercise_media_update_draft(A, draft, 1, '{"alt_text":"stale"}')->>'outcome' = 'stale', 'CAS stale version');

  -- A publishes first; B's alternative never overwrites it.
  a_rev := pg_temp.publish_photo(A, ex, gen_random_uuid(), 0);
  perform pg_temp.expect(public.exercise_media_publish(B, ex, a_rev, 1)->>'outcome' = 'not_found', 'B cannot publish A revision');
  perform pg_temp.expect(public.exercise_media_review(B, a_rev, 1, '{"variant_confirmed":true,"rights_confirmed":true,"content_confirmed":true}')->>'outcome' = 'not_found', 'B cannot review A revision');
  perform pg_temp.expect(public.exercise_media_archive(B, a_rev, 1)->>'outcome' = 'not_found', 'B cannot withdraw A current');
  b_rev := pg_temp.ready_photo(B, ex, gen_random_uuid());
  res := public.exercise_media_publish(B, ex, b_rev, 1);
  perform pg_temp.expect(res->>'outcome' = 'replace_requires_admin', 'B replace refused: ' || res::text);
  perform pg_temp.expect((select revision_id from public.exercise_media_current where exercise_library_id = ex) = a_rev, 'A current intact');
  perform pg_temp.expect((select status = 'ready' and review_status = 'approved' and published_at is null from public.exercise_media_revisions where id = b_rev), 'B alternative retained as reviewed draft');
  res := public.exercise_media_publish(ADM, ex, b_rev, 1);
  perform pg_temp.expect(res->>'outcome' = 'published' and (res->>'current_version')::int = 2, 'admin replaces: ' || res::text);

  -- Stale expected version, wrong exercise and archived exercise are refused.
  perform pg_temp.expect(public.exercise_media_publish(ADM, ex, a_rev, 1)->>'outcome' = 'stale', 'stale publish');
  perform pg_temp.expect(public.exercise_media_publish(ADM, 'e0000000-0000-4000-8000-000000000004', b_rev, 0)->>'outcome' = 'not_found', 'wrong exercise');
  perform pg_temp.expect(public.exercise_media_publish(ADM, 'e0000000-0000-4000-8000-000000000006', b_rev, 0)->>'outcome' = 'not_found', 'archived exercise publish refused');

  -- Withdrawal clears the pointer and never resurrects an older revision.
  perform pg_temp.expect(public.exercise_media_archive(B, b_rev, 1)->>'outcome' = 'stale', 'withdraw needs current version');
  res := public.exercise_media_archive(B, b_rev, 2);
  perform pg_temp.expect(res->>'outcome' = 'archived' and (res->>'was_current')::boolean, 'owner withdraws own current: ' || res::text);
  perform pg_temp.expect((select revision_id is null and version = 3 from public.exercise_media_current where exercise_library_id = ex), 'pointer cleared, version advanced');
  perform pg_temp.expect(jsonb_array_length(public.exercise_media_current_bundle(array[ex])) = 0, 'no current after withdrawal');

  -- Archiving an exercise hides its current guide from bundles.
  perform pg_temp.publish_photo(A, 'e0000000-0000-4000-8000-000000000005', gen_random_uuid(), 0);
  perform pg_temp.expect(jsonb_array_length(public.exercise_media_current_bundle(array['e0000000-0000-4000-8000-000000000005'::uuid])) = 1, 'bundle before archive');
  update public.exercise_library set archived = true where id = 'e0000000-0000-4000-8000-000000000005';
  perform pg_temp.expect(jsonb_array_length(public.exercise_media_current_bundle(array['e0000000-0000-4000-8000-000000000005'::uuid])) = 0, 'archived exercise hidden');

  -- Narrated instruction requires captions + transcript before review.
  declare rev uuid; v integer; job jsonb; rc integer;
  begin
    rev := (public.exercise_media_create_draft(A, 'e0000000-0000-4000-8000-000000000004', gen_random_uuid(), null)->>'revision_id')::uuid;
    res := public.exercise_media_attach_source(A, rev, 1, pg_temp.source(gen_random_uuid(), 'source_video', gen_random_uuid()));
    res := public.exercise_media_update_draft(A, rev, (res->>'version')::int, jsonb_build_object('alt_text', 'Synthetic plank still',
      'poster_mode', 'video_frame', 'poster_frame_ms', 1000, 'poster_crop', jsonb_build_object('x', 0, 'y', 0, 'width', 1, 'height', 1),
      'include_instruction', true, 'instruction_audio', true));
    res := public.exercise_media_request_processing(A, rev, (res->>'version')::int);
    job := public.exercise_media_claim_job('fixture-worker', 30);
    rc := (job->'job'->>'recipe_version')::int;
    res := public.exercise_media_complete_job((job->'job'->>'id')::uuid, (job->'job'->>'lease_token')::uuid, jsonb_build_array(
      pg_temp.derivative(rev, rc, 'poster'), pg_temp.derivative(rev, rc, 'instruction') || '{"has_audio":true}'::jsonb), 'fixture');
    v := (res->>'version')::int;
    perform pg_temp.expect(public.exercise_media_review(A, rev, v, '{"variant_confirmed":true,"rights_confirmed":true}')->>'outcome' = 'attestation_required', 'partial attestation refused');
    perform pg_temp.expect(public.exercise_media_review(A, rev, v, '{"variant_confirmed":true,"rights_confirmed":true,"content_confirmed":false}')->>'outcome' = 'attestation_required', 'false attestation refused');
    perform pg_temp.expect(public.exercise_media_review(A, rev, v, '{"variant_confirmed":true,"rights_confirmed":true,"content_confirmed":true}')->>'outcome' = 'captions_required', 'narration needs captions');
  end;
end $$;
