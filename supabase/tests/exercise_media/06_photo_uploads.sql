-- Exercise guides photo transport (docs/exercise-guides/design.md), additive
-- migration 20261016170000: durable upload intents persisted before any grant,
-- reuse of the accepted attach_source recovery contract, and a revision-scoped
-- leased claim for inline photo processing. Rolled back; fictional identities.

-- ----- Intents: persisted before a grant, idempotent per actor+request ----------
do $$
declare res jsonb; again jsonb; rev uuid; v integer; req uuid := gen_random_uuid(); intent uuid; attach jsonb;
begin
  res := public.exercise_media_create_draft('a0000000-0000-4000-8000-00000000000a', 'e0000000-0000-4000-8000-000000000001', gen_random_uuid(), null);
  rev := (res->>'revision_id')::uuid;
  v := (select version from public.exercise_media_revisions where id = rev);

  res := public.exercise_media_issue_upload_intent('a0000000-0000-4000-8000-00000000000a', rev, req, 'source_image', 50000, 'image/jpeg', v);
  perform pg_temp.expect(res->>'outcome' = 'issued' and (res->>'replayed')::boolean = false, 'issued: ' || res::text);
  intent := (res->>'intent_id')::uuid;
  perform pg_temp.expect(res->>'staging_key' = 'staging/' || intent::text and res->>'state' = 'issued', 'app-issued staging key: ' || res::text);
  perform pg_temp.expect((select version from public.exercise_media_revisions where id = rev) = v, 'issuing an intent does not touch the draft version');

  again := public.exercise_media_issue_upload_intent('a0000000-0000-4000-8000-00000000000a', rev, req, 'source_image', 50000, 'image/jpeg', v);
  perform pg_temp.expect(again->>'intent_id' = intent::text and (again->>'replayed')::boolean, 'same request replays the same intent: ' || again::text);
  again := public.exercise_media_issue_upload_intent('a0000000-0000-4000-8000-00000000000a', rev, req, 'source_image', 50001, 'image/jpeg', v);
  perform pg_temp.expect(again->>'outcome' = 'request_mismatch', 'different declared bytes mismatch: ' || again::text);
  perform pg_temp.expect((select count(*) from public.exercise_media_upload_intents where request_id = req) = 1, 'one intent per request');

  -- Other coaches, stale versions and invalid declarations are refused without a row.
  again := public.exercise_media_issue_upload_intent('b0000000-0000-4000-8000-00000000000b', rev, gen_random_uuid(), 'source_image', 50000, 'image/jpeg', v);
  perform pg_temp.expect(again->>'outcome' = 'not_found', 'other coach: ' || again::text);
  again := public.exercise_media_issue_upload_intent('a0000000-0000-4000-8000-00000000000a', rev, gen_random_uuid(), 'source_image', 50000, 'image/jpeg', v + 7);
  perform pg_temp.expect(again->>'outcome' = 'stale', 'stale: ' || again::text);
  again := public.exercise_media_issue_upload_intent('a0000000-0000-4000-8000-00000000000a', rev, gen_random_uuid(), 'source_video', 50000, 'video/mp4', v);
  perform pg_temp.expect(again->>'outcome' = 'invalid_asset', 'video is not a photo intent: ' || again::text);
  again := public.exercise_media_issue_upload_intent('a0000000-0000-4000-8000-00000000000a', rev, gen_random_uuid(), 'source_image', 10485761, 'image/jpeg', v);
  perform pg_temp.expect(again->>'outcome' = 'invalid_asset', 'over the existing 10 MiB limit: ' || again::text);
  again := public.exercise_media_issue_upload_intent('a0000000-0000-4000-8000-00000000000a', rev, gen_random_uuid(), 'source_image', 50000, 'image/svg+xml', v);
  perform pg_temp.expect(again->>'outcome' = 'invalid_asset', 'svg refused: ' || again::text);
  perform pg_temp.expect((select count(*) from public.exercise_media_upload_intents where revision_id = rev) = 1, 'refusals wrote nothing');

  -- Not attached yet: marking attached is refused; the accepted attach contract records the asset under the intent id.
  res := public.exercise_media_mark_upload_intent('a0000000-0000-4000-8000-00000000000a', intent, 'attached');
  perform pg_temp.expect(res->>'outcome' = 'not_attached', 'nothing recorded yet: ' || res::text);
  attach := public.exercise_media_attach_source('a0000000-0000-4000-8000-00000000000a', rev, v,
    pg_temp.source(intent, 'source_image', req));
  perform pg_temp.expect(attach->>'outcome' = 'attached' and attach->>'asset_id' = intent::text, 'attach under the intent id: ' || attach::text);
  attach := public.exercise_media_attach_source('a0000000-0000-4000-8000-00000000000a', rev, v,
    pg_temp.source(intent, 'source_image', req));
  perform pg_temp.expect((attach->>'replayed')::boolean, 'double finalize replays: ' || attach::text);
  res := public.exercise_media_mark_upload_intent('a0000000-0000-4000-8000-00000000000a', intent, 'attached');
  perform pg_temp.expect(res->>'outcome' = 'attached', 'marked attached: ' || res::text);
  res := public.exercise_media_mark_upload_intent('a0000000-0000-4000-8000-00000000000a', intent, 'abandoned');
  perform pg_temp.expect(res->>'outcome' = 'attached', 'an attached upload cannot be abandoned: ' || res::text);
  again := public.exercise_media_issue_upload_intent('a0000000-0000-4000-8000-00000000000a', rev, req, 'source_image', 50000, 'image/jpeg', v);
  perform pg_temp.expect(again->>'state' = 'attached', 'replay reports the attached state: ' || again::text);
  res := public.exercise_media_mark_upload_intent('b0000000-0000-4000-8000-00000000000b', intent, 'abandoned');
  perform pg_temp.expect(res->>'outcome' = 'not_found', 'only the issuing actor marks an intent: ' || res::text);
end $$;

-- ----- Abandon keeps bytes and history; identity fields are immutable ------------
do $$
declare res jsonb; rev uuid; intent uuid;
begin
  res := public.exercise_media_create_draft('a0000000-0000-4000-8000-00000000000a', 'e0000000-0000-4000-8000-000000000002', gen_random_uuid(), null);
  rev := (res->>'revision_id')::uuid;
  res := public.exercise_media_issue_upload_intent('a0000000-0000-4000-8000-00000000000a', rev, gen_random_uuid(), 'source_image', 1234, 'image/png', 1);
  intent := (res->>'intent_id')::uuid;
  res := public.exercise_media_mark_upload_intent('a0000000-0000-4000-8000-00000000000a', intent, 'abandoned');
  perform pg_temp.expect(res->>'outcome' = 'abandoned', 'abandoned: ' || res::text);
  perform pg_temp.expect(exists (select 1 from public.exercise_media_upload_intents where id = intent and state = 'abandoned'), 'the row is kept (no deletion)');
  begin
    update public.exercise_media_upload_intents set staging_key = 'staging/' || gen_random_uuid() where id = intent;
    raise exception 'staging key changed';
  exception when check_violation then null; end;
  begin
    update public.exercise_media_upload_intents set request_id = gen_random_uuid() where id = intent;
    raise exception 'request id changed';
  exception when check_violation then null; end;
  begin
    update public.exercise_media_upload_intents set state = 'issued' where id = intent;
    raise exception 'abandoned intent reopened';
  exception when check_violation then null; end;
end $$;

-- ----- Revision-scoped leased claim for inline photo processing ------------------
do $$
declare res jsonb; rev uuid; v integer; claim jsonb; again jsonb; asset uuid := gen_random_uuid();
begin
  res := public.exercise_media_create_draft('a0000000-0000-4000-8000-00000000000a', 'e0000000-0000-4000-8000-000000000003', gen_random_uuid(), null);
  rev := (res->>'revision_id')::uuid;
  res := public.exercise_media_attach_source('a0000000-0000-4000-8000-00000000000a', rev, 1, pg_temp.source(asset, 'source_image', gen_random_uuid()));
  res := public.exercise_media_update_draft('a0000000-0000-4000-8000-00000000000a', rev, (res->>'version')::integer,
    jsonb_build_object('alt_text', 'Synthetic photo', 'poster_crop', jsonb_build_object('x', 0, 'y', 0, 'width', 1, 'height', 1)));
  claim := public.exercise_media_claim_revision_job('a0000000-0000-4000-8000-00000000000a', rev, 'inline-test', 30);
  perform pg_temp.expect(claim->>'outcome' = 'idle', 'nothing queued yet: ' || claim::text);
  res := public.exercise_media_request_processing('a0000000-0000-4000-8000-00000000000a', rev, (res->>'version')::integer);
  perform pg_temp.expect(res->>'outcome' = 'queued', 'queued: ' || res::text);

  again := public.exercise_media_claim_revision_job('b0000000-0000-4000-8000-00000000000b', rev, 'inline-test', 30);
  perform pg_temp.expect(again->>'outcome' = 'not_found', 'other coach cannot claim: ' || again::text);
  claim := public.exercise_media_claim_revision_job('a0000000-0000-4000-8000-00000000000a', rev, 'inline-test', 30);
  perform pg_temp.expect(claim->>'outcome' = 'claimed' and claim->'job'->>'revision_id' = rev::text and (claim->'job'->>'attempts')::integer = 1, 'claimed: ' || claim::text);
  perform pg_temp.expect(jsonb_array_length(claim->'sources') = 1, 'sources included');
  again := public.exercise_media_claim_revision_job('a0000000-0000-4000-8000-00000000000a', rev, 'inline-test', 30);
  perform pg_temp.expect(again->>'outcome' = 'busy', 'a live lease is not stolen: ' || again::text);
  perform pg_temp.expect((public.exercise_media_claim_job('fixture-worker', 30))->>'outcome' = 'idle', 'the general claimer does not steal it either');

  -- A terminated request leaves the lease; after it expires the same version resumes.
  update public.exercise_media_jobs set lease_expires_at = clock_timestamp() - interval '1 second' where id = (claim->'job'->>'id')::uuid;
  again := public.exercise_media_claim_revision_job('a0000000-0000-4000-8000-00000000000a', rev, 'inline-resume', 30);
  perform pg_temp.expect(again->>'outcome' = 'claimed' and again->'job'->>'id' = claim->'job'->>'id' and (again->'job'->>'attempts')::integer = 2, 'resumed same job: ' || again::text);
  res := public.exercise_media_complete_job((claim->'job'->>'id')::uuid, (claim->'job'->>'lease_token')::uuid,
    jsonb_build_array(pg_temp.derivative(rev, (claim->'job'->>'recipe_version')::integer, 'poster')), 'stale-lease');
  perform pg_temp.expect(res->>'outcome' = 'lost', 'the expired lease cannot complete: ' || res::text);
  res := public.exercise_media_complete_job((again->'job'->>'id')::uuid, (again->'job'->>'lease_token')::uuid,
    jsonb_build_array(pg_temp.derivative(rev, (again->'job'->>'recipe_version')::integer, 'poster')), 'sharp test');
  perform pg_temp.expect(res->>'outcome' = 'ready', 'ready: ' || res::text);
  again := public.exercise_media_claim_revision_job('a0000000-0000-4000-8000-00000000000a', rev, 'inline-test', 30);
  perform pg_temp.expect(again->>'outcome' = 'ready', 'ready reported: ' || again::text);
  begin
    perform public.exercise_media_claim_revision_job('a0000000-0000-4000-8000-00000000000a', rev, 'inline-test', 1);
    raise exception 'lease out of range accepted';
  exception when invalid_parameter_value then null; end;
end $$;

-- ----- Exhausted attempts fail the revision truthfully --------------------------
do $$
declare res jsonb; rev uuid; claim jsonb;
begin
  res := public.exercise_media_create_draft('a0000000-0000-4000-8000-00000000000a', 'e0000000-0000-4000-8000-000000000004', gen_random_uuid(), null);
  rev := (res->>'revision_id')::uuid;
  res := public.exercise_media_attach_source('a0000000-0000-4000-8000-00000000000a', rev, 1, pg_temp.source(gen_random_uuid(), 'source_image', gen_random_uuid()));
  res := public.exercise_media_update_draft('a0000000-0000-4000-8000-00000000000a', rev, (res->>'version')::integer,
    jsonb_build_object('alt_text', 'Synthetic photo', 'poster_crop', jsonb_build_object('x', 0, 'y', 0, 'width', 1, 'height', 1)));
  res := public.exercise_media_request_processing('a0000000-0000-4000-8000-00000000000a', rev, (res->>'version')::integer);
  update public.exercise_media_jobs set attempts = max_attempts where revision_id = rev;
  claim := public.exercise_media_claim_revision_job('a0000000-0000-4000-8000-00000000000a', rev, 'inline-test', 30);
  perform pg_temp.expect(claim->>'outcome' = 'failed' and claim->>'code' = 'attempts_exhausted', 'exhausted: ' || claim::text);
  perform pg_temp.expect((select status = 'failed' and failure_code = 'attempts_exhausted' from public.exercise_media_revisions where id = rev), 'revision failed truthfully');
end $$;

-- ----- Grants: the new table is service-only with no browser access or deletes ----
do $$
declare r text;
begin
  perform pg_temp.expect((select relrowsecurity from pg_class where oid = 'public.exercise_media_upload_intents'::regclass), 'intents RLS enabled');
  perform pg_temp.expect(not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'exercise_media_upload_intents'), 'no policies');
  foreach r in array array['anon','authenticated'] loop
    perform pg_temp.expect(not has_table_privilege(r, 'public.exercise_media_upload_intents', 'SELECT')
      and not has_table_privilege(r, 'public.exercise_media_upload_intents', 'INSERT')
      and not has_table_privilege(r, 'public.exercise_media_upload_intents', 'UPDATE')
      and not has_table_privilege(r, 'public.exercise_media_upload_intents', 'DELETE'), r || ' denied on intents');
  end loop;
  perform pg_temp.expect(has_table_privilege('service_role', 'public.exercise_media_upload_intents', 'INSERT'), 'service_role inserts intents');
  perform pg_temp.expect(not has_table_privilege('service_role', 'public.exercise_media_upload_intents', 'DELETE'), 'service_role cannot delete intents');
end $$;
