-- Job/lease lifecycle: one job per recipe, lease recovery, stale tokens, stale
-- recipes, missing outputs, bounded retries; a failed replacement never
-- disturbs the current guide.
do $$
declare A uuid := 'a0000000-0000-4000-8000-00000000000a'; ex uuid := 'e0000000-0000-4000-8000-000000000002';
  cur uuid; rev uuid; res jsonb; job jsonb; job2 jsonb; v integer; rc integer; jid uuid;
begin
  cur := pg_temp.publish_photo(A, ex, gen_random_uuid(), 0);

  rev := (public.exercise_media_create_draft(A, ex, gen_random_uuid(), null)->>'revision_id')::uuid;
  -- Processing refuses an incomplete recipe with a precise code.
  perform pg_temp.expect(public.exercise_media_request_processing(A, rev, 1)->>'code' = 'alt_text_required', 'alt text required');
  res := public.exercise_media_attach_source(A, rev, 1, pg_temp.source(gen_random_uuid(), 'source_video', gen_random_uuid()));
  v := (res->>'version')::int;
  res := public.exercise_media_update_draft(A, rev, v, jsonb_build_object('alt_text', 'Synthetic split squat frames',
    'poster_mode', 'video_frame', 'poster_frame_ms', 7000, 'poster_crop', jsonb_build_object('x', 0, 'y', 0, 'width', 1, 'height', 1)));
  v := (res->>'version')::int;
  perform pg_temp.expect(public.exercise_media_request_processing(A, rev, v)->>'code' = 'poster_frame_out_of_range', 'frame beyond duration');
  res := public.exercise_media_update_draft(A, rev, v, jsonb_build_object('poster_frame_ms', 500, 'end_frame_ms', 5900,
    'end_frame_crop', jsonb_build_object('x', 0, 'y', 0, 'width', 1, 'height', 1)));
  v := (res->>'version')::int;
  perform pg_temp.expect(public.exercise_media_request_processing(A, rev, v)->>'code' = 'end_frame_incomplete', 'end frame needs alt text');
  res := public.exercise_media_update_draft(A, rev, v, '{"end_frame_alt_text":"Synthetic end position"}');
  v := (res->>'version')::int;
  res := public.exercise_media_request_processing(A, rev, v);
  perform pg_temp.expect(res->>'outcome' = 'queued', 'queued: ' || res::text);
  jid := (res->>'job_id')::uuid;
  v := (res->>'version')::int;
  -- Duplicate processing request and edits are refused while processing.
  perform pg_temp.expect(public.exercise_media_request_processing(A, rev, v)->>'outcome' = 'processing', 'duplicate process refused');
  perform pg_temp.expect(public.exercise_media_update_draft(A, rev, v, '{"alt_text":"x"}')->>'outcome' = 'processing', 'edit during processing refused');
  perform pg_temp.expect((select count(*) from public.exercise_media_jobs where revision_id = rev) = 1, 'one job per recipe');

  -- Crash: the first lease expires and a new attempt reclaims the same job.
  job := public.exercise_media_claim_job('worker-1', 5);
  perform pg_temp.expect(job->'job'->>'id' = jid::text and (job->'job'->>'attempts')::int = 1, 'first claim');
  perform pg_temp.expect(public.exercise_media_claim_job('worker-2', 5)->>'outcome' = 'idle', 'leased job not double-claimed');
  update public.exercise_media_jobs set lease_expires_at = clock_timestamp() - interval '1 second' where id = jid;
  job2 := public.exercise_media_claim_job('worker-2', 30);
  perform pg_temp.expect(job2->'job'->>'id' = jid::text and (job2->'job'->>'attempts')::int = 2, 'reclaimed after lease expiry');
  rc := (job2->'job'->>'recipe_version')::int;
  -- The crashed worker's late completion is rejected by its stale token.
  perform pg_temp.expect(public.exercise_media_complete_job(jid, (job->'job'->>'lease_token')::uuid,
    jsonb_build_array(pg_temp.derivative(rev, rc, 'poster'), pg_temp.derivative(rev, rc, 'end_frame')), 'x')->>'outcome' = 'lost', 'stale token lost');
  perform pg_temp.expect(public.exercise_media_extend_lease(jid, (job->'job'->>'lease_token')::uuid, 30)->>'outcome' = 'lost', 'stale heartbeat lost');
  -- Missing required output or a foreign key path is refused (whole call rolls back).
  begin
    perform public.exercise_media_complete_job(jid, (job2->'job'->>'lease_token')::uuid, jsonb_build_array(pg_temp.derivative(rev, rc, 'poster')), 'x');
    raise exception 'ready without end frame';
  exception when check_violation then null; end;
  begin
    perform public.exercise_media_complete_job(jid, (job2->'job'->>'lease_token')::uuid,
      jsonb_build_array(pg_temp.derivative(rev, rc, 'poster') || jsonb_build_object('storage_key', format('derivatives/%s/%s-poster.jpg', cur, rc)),
        pg_temp.derivative(rev, rc, 'end_frame')), 'x');
    raise exception 'foreign derivative key accepted';
  exception when invalid_parameter_value then null; end;
  perform pg_temp.expect((select status from public.exercise_media_revisions where id = rev) = 'processing', 'still processing after refused completions');
  -- Retryable failure re-queues; a final failure marks the revision failed.
  perform pg_temp.expect(public.exercise_media_fail_job(jid, (job2->'job'->>'lease_token')::uuid, 'processor_timeout', true)->>'outcome' = 'requeued', 'retryable requeue');
  job := public.exercise_media_claim_job('worker-3', 30);
  perform pg_temp.expect((job->'job'->>'attempts')::int = 3, 'third attempt');
  perform pg_temp.expect(public.exercise_media_fail_job(jid, (job->'job'->>'lease_token')::uuid, 'processor_timeout', true)->>'outcome' = 'failed', 'attempts exhausted → failed');
  perform pg_temp.expect((select status = 'failed' and failure_code = 'processor_timeout' from public.exercise_media_revisions where id = rev), 'revision failed with safe code');
  perform pg_temp.expect((select revision_id from public.exercise_media_current where exercise_library_id = ex) = cur, 'failed replacement keeps prior current');
  -- Unsafe error text is never stored.
  v := (select version from public.exercise_media_revisions where id = rev);
  res := public.exercise_media_request_processing(A, rev, v);
  perform pg_temp.expect(res->>'outcome' = 'queued' and (res->>'job_id')::uuid = jid, 'retry re-queues the same job, no duplicate');
  job := public.exercise_media_claim_job('worker-4', 30);
  perform pg_temp.expect((job->'job'->>'attempts')::int = 1, 'manual retry resets attempts');
  perform public.exercise_media_fail_job(jid, (job->'job'->>'lease_token')::uuid, 'Error: /tmp/secret path', false);
  perform pg_temp.expect((select failure_code from public.exercise_media_revisions where id = rev) = 'processing_failed', 'unsafe error replaced');

  -- Archiving a processing draft supersedes its job; a late worker cannot resurrect it.
  v := (select version from public.exercise_media_revisions where id = rev);
  res := public.exercise_media_request_processing(A, rev, v);
  job := public.exercise_media_claim_job('worker-5', 30);
  perform pg_temp.expect(public.exercise_media_archive(A, rev, null)->>'outcome' = 'archived', 'archive processing draft');
  perform pg_temp.expect(public.exercise_media_complete_job(jid, (job->'job'->>'lease_token')::uuid,
    jsonb_build_array(pg_temp.derivative(rev, rc, 'poster')), 'x')->>'outcome' = 'lost', 'late completion after archive');
  perform pg_temp.expect((select state = 'failed' and error_code = 'superseded' from public.exercise_media_jobs where id = jid), 'job superseded');

  -- A recipe change after failure creates a new job key; the old job stays history.
  rev := (public.exercise_media_create_draft(A, ex, gen_random_uuid(), cur)->>'revision_id')::uuid;
  perform pg_temp.expect((select based_on_revision_id from public.exercise_media_revisions where id = rev) = cur, 'seeded from current');
  perform pg_temp.expect(public.exercise_media_create_draft(A, ex, gen_random_uuid(), rev)->>'outcome' = 'base_not_current', 'only current can seed');
  res := public.exercise_media_request_processing(A, rev, 1);
  job := public.exercise_media_claim_job('worker-6', 30);
  rc := (job->'job'->>'recipe_version')::int;
  res := public.exercise_media_complete_job((job->'job'->>'id')::uuid, (job->'job'->>'lease_token')::uuid, jsonb_build_array(pg_temp.derivative(rev, rc, 'poster')), 'x');
  perform pg_temp.expect(res->>'outcome' = 'ready', 'seeded draft processes: ' || res::text);
  v := (res->>'version')::int;
  res := public.exercise_media_update_draft(A, rev, v, '{"cues":["Changed synthetic cue"]}');
  perform pg_temp.expect(res->>'outcome' = 'updated' and not (res->>'recipe_changed')::boolean, 'text edit keeps derivatives');
  perform pg_temp.expect((select status = 'ready' and review_status = 'needs_review' from public.exercise_media_revisions where id = rev), 'text edit resets review only');
  res := public.exercise_media_update_draft(A, rev, (res->>'version')::int, '{"poster_crop":{"x":0.1,"y":0.1,"width":0.8,"height":0.8}}');
  perform pg_temp.expect((res->>'recipe_changed')::boolean, 'crop is a recipe change');
  perform pg_temp.expect((select status from public.exercise_media_revisions where id = rev) = 'draft', 'recipe change returns to draft');
  perform pg_temp.expect(not exists (select 1 from public.exercise_media_assets where revision_id = rev and role = 'poster' and not archived), 'stale derivatives archived');
end $$;

-- A published guide always carries its alt text (clients get no media without
-- it): a ready draft whose alt text, or end-still alt text, was cleared cannot
-- be approved, and publish re-checks the same invariant.
do $$
declare A uuid := 'a0000000-0000-4000-8000-00000000000a'; ex uuid := 'e0000000-0000-4000-8000-000000000003';
  rev uuid; res jsonb; job jsonb; v integer; rc integer;
  attest jsonb := '{"variant_confirmed":true,"rights_confirmed":true,"content_confirmed":true}';
  full_crop jsonb := '{"x":0,"y":0,"width":1,"height":1}';
begin
  rev := pg_temp.ready_photo(A, ex, gen_random_uuid());
  v := (select version from public.exercise_media_revisions where id = rev);
  res := public.exercise_media_update_draft(A, rev, v, '{"alt_text":null}');
  perform pg_temp.expect(res->>'outcome' = 'updated', 'clearing alt text is a text edit: ' || res::text);
  res := public.exercise_media_review(A, rev, (res->>'version')::int, attest);
  perform pg_temp.expect(res->>'outcome' = 'alt_text_required', 'review refuses missing alt text: ' || res::text);
  -- Defense in depth: an approved revision that somehow lost its alt text is not publishable.
  update public.exercise_media_revisions set alt_text = 'Synthetic band row photo', version = version + 1 where id = rev;
  v := (select version from public.exercise_media_revisions where id = rev);
  perform pg_temp.expect(public.exercise_media_review(A, rev, v, attest)->>'outcome' = 'approved', 're-approve with alt text');
  update public.exercise_media_revisions set alt_text = null, version = version + 1 where id = rev;
  res := public.exercise_media_publish(A, ex, rev, 0);
  perform pg_temp.expect(res->>'outcome' = 'alt_text_required', 'publish refuses missing alt text: ' || res::text);
  perform pg_temp.expect(not exists (select 1 from public.exercise_media_current where exercise_library_id = ex), 'nothing became current');

  -- End still: cleared end-still alt text blocks approval.
  rev := (public.exercise_media_create_draft(A, ex, gen_random_uuid(), null)->>'revision_id')::uuid;
  res := public.exercise_media_attach_source(A, rev, 1, pg_temp.source(gen_random_uuid(), 'source_video', gen_random_uuid()));
  res := public.exercise_media_update_draft(A, rev, (res->>'version')::int, jsonb_build_object('alt_text', 'Synthetic band row start',
    'poster_mode', 'video_frame', 'poster_frame_ms', 500, 'poster_crop', full_crop,
    'end_frame_ms', 4000, 'end_frame_crop', full_crop, 'end_frame_alt_text', 'Synthetic band row finish'));
  res := public.exercise_media_request_processing(A, rev, (res->>'version')::int);
  perform pg_temp.expect(res->>'outcome' = 'queued', 'frames queued: ' || res::text);
  job := public.exercise_media_claim_job('worker-alt', 30);
  rc := (job->'job'->>'recipe_version')::int;
  res := public.exercise_media_complete_job((job->'job'->>'id')::uuid, (job->'job'->>'lease_token')::uuid,
    jsonb_build_array(pg_temp.derivative(rev, rc, 'poster'), pg_temp.derivative(rev, rc, 'end_frame')), 'x');
  perform pg_temp.expect(res->>'outcome' = 'ready', 'frames ready: ' || res::text);
  res := public.exercise_media_update_draft(A, rev, (res->>'version')::int, '{"end_frame_alt_text":null}');
  perform pg_temp.expect(res->>'outcome' = 'updated' and not (res->>'recipe_changed')::boolean, 'end-still alt is text: ' || res::text);
  res := public.exercise_media_review(A, rev, (res->>'version')::int, attest);
  perform pg_temp.expect(res->>'outcome' = 'end_frame_incomplete', 'review refuses missing end-still alt text: ' || res::text);
end $$;
