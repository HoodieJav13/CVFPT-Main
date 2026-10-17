// Photo transport + inline processing at the service boundary
// (docs/exercise-guides/design.md). Real LocalMediaStore in a temp dir and the
// real ImageOnlyProcessor (no FFmpeg, no Docker, no worker); a controlled
// repository mirrors the SQL contracts in migration 20261016170000 (intent issue/
// replay/mismatch, attach replay keyed by actor+request, revision-scoped leased
// claim). Real SQL is proven by supabase/tests/exercise_media/06_photo_uploads.sql
// and integration/exercise-guides-local.cjs. Synthetic bytes only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createHash, randomUUID } = require('node:crypto');
const { createCanvas } = require('@napi-rs/canvas');
const { LocalMediaStore } = require('../src/services/exerciseMedia/localStore');
const { ImageOnlyProcessor } = require('../src/services/exerciseMedia/imageProcessor');
const { createCapabilitySigner } = require('../src/services/exerciseMedia/capabilities');
const { createExerciseMediaService } = require('../src/lib/exerciseMedia/service');

const COACH = 'a0000000-0000-4000-8000-00000000000a';
const OTHER = 'b0000000-0000-4000-8000-00000000000b';
const actor = { role: 'coach', coach: { id: COACH } };
const other = { role: 'coach', coach: { id: OTHER } };
const sha = (buffer) => createHash('sha256').update(buffer).digest('hex');
const RIGHTS = { rights_basis: 'owned', rights_confirmed: 'true', original_name: 'synthetic-photo.jpg' };

function photo(width = 1280, height = 720, mime = 'image/jpeg') {
  const canvas = createCanvas(width, height);
  const g = canvas.getContext('2d');
  g.fillStyle = '#1d1a17'; g.fillRect(0, 0, width, height);
  g.fillStyle = '#c0392b'; g.fillRect(width * 0.2, height * 0.2, width * 0.3, height * 0.4);
  g.fillStyle = '#f2efe9'; g.font = '28px sans-serif'; g.fillText('SYNTHETIC TEST MEDIA — NOT INSTRUCTION', 20, height - 30);
  return canvas.toBuffer(mime, mime === 'image/jpeg' ? 88 : undefined);
}

// Mirrors the SQL contracts the service depends on.
function sqlLikeRepo() {
  const revision = {
    id: randomUUID(), exercise_library_id: randomUUID(), uploaded_by_coach_id: COACH, status: 'draft', review_status: 'needs_review',
    version: 1, recipe_version: 1, cues: [], caption_cues: [], archived: false, published_at: null, poster_mode: null, poster_crop: null,
    alt_text: null, preview_start_ms: null, end_frame_ms: null, include_instruction: false, created_at: new Date().toISOString(),
  };
  const intents = new Map();
  const assets = new Map();
  const jobs = new Map();
  const calls = [];
  const faults = { attachThrowsAfterCommit: false, assetLookupFails: false };
  const gate = (actorId, expected) => {
    if (actorId !== revision.uploaded_by_coach_id) return { outcome: 'not_found' };
    if (expected !== revision.version) return { outcome: 'stale', version: revision.version };
    if (revision.status === 'processing') return { outcome: 'processing' };
    return { outcome: 'ok' };
  };
  const rpc = {
    exercise_media_issue_upload_intent(p) {
      const existing = [...intents.values()].find((i) => i.actor_coach_id === p.p_actor && i.request_id === p.p_request_id);
      if (existing) {
        if (existing.revision_id === p.p_revision_id && existing.declared_bytes === p.p_bytes && existing.declared_mime === p.p_mime) {
          return { outcome: 'issued', intent_id: existing.id, staging_key: existing.staging_key, state: existing.state, replayed: true };
        }
        return { outcome: 'request_mismatch' };
      }
      const g = gate(p.p_actor, p.p_expected_version);
      if (g.outcome !== 'ok') return g;
      if (p.p_role !== 'source_image' || p.p_bytes < 1 || p.p_bytes > 10485760 || !['image/jpeg', 'image/png', 'image/webp'].includes(p.p_mime)) return { outcome: 'invalid_asset' };
      const id = randomUUID();
      intents.set(id, { id, revision_id: p.p_revision_id, actor_coach_id: p.p_actor, request_id: p.p_request_id, role: p.p_role, declared_bytes: p.p_bytes, declared_mime: p.p_mime, staging_key: `staging/${id}`, state: 'issued', created_at: new Date().toISOString() });
      return { outcome: 'issued', intent_id: id, staging_key: `staging/${id}`, state: 'issued', replayed: false };
    },
    exercise_media_attach_source(p) {
      const a = p.p_asset;
      const existing = [...assets.values()].find((row) => row.uploaded_by_coach_id === p.p_actor && row.upload_request_id === a.upload_request_id);
      if (existing) {
        if (existing.revision_id === p.p_revision_id && existing.role === a.role && existing.sha256 === a.sha256) return { outcome: 'attached', asset_id: existing.id, version: revision.version, replayed: true };
        return { outcome: 'request_mismatch' };
      }
      const g = gate(p.p_actor, p.p_expected_version);
      if (g.outcome !== 'ok') return g;
      assets.set(a.id, { ...a, revision_id: p.p_revision_id, uploaded_by_coach_id: p.p_actor, archived: false });
      revision.version += 1; revision.recipe_version += 1; revision.poster_mode ||= 'uploaded_image'; revision.poster_crop = null;
      if (faults.attachThrowsAfterCommit) { faults.attachThrowsAfterCommit = false; throw Object.assign(new Error('simulated transport error after commit'), { code: 'ECONNRESET' }); }
      return { outcome: 'attached', asset_id: a.id, version: revision.version, replayed: false };
    },
    exercise_media_mark_upload_intent(p) {
      const intent = intents.get(p.p_intent_id);
      if (!intent || intent.actor_coach_id !== p.p_actor) return { outcome: 'not_found' };
      if (p.p_state === 'attached') {
        if (!assets.has(intent.id)) return { outcome: 'not_attached' };
        intent.state = 'attached'; intent.asset_id = intent.id; return { outcome: 'attached', asset_id: intent.id };
      }
      if (intent.state === 'attached') return { outcome: 'attached', asset_id: intent.id };
      intent.state = 'abandoned'; return { outcome: 'abandoned' };
    },
    exercise_media_update_draft(p) {
      const g = gate(p.p_actor, p.p_expected_version);
      if (g.outcome !== 'ok') return g;
      Object.assign(revision, p.p_patch); revision.version += 1; if ('poster_crop' in p.p_patch) revision.recipe_version += 1;
      return { outcome: 'updated', version: revision.version };
    },
    exercise_media_request_processing(p) {
      const g = gate(p.p_actor, p.p_expected_version);
      if (g.outcome !== 'ok') return g;
      const key = `${revision.id}:${revision.recipe_version}`;
      if (!jobs.has(key) || jobs.get(key).state === 'failed') jobs.set(key, { id: randomUUID(), revision_id: revision.id, recipe_version: revision.recipe_version, state: 'queued', attempts: 0, max_attempts: 3 });
      revision.status = 'processing'; revision.version += 1;
      return { outcome: 'queued', job_id: jobs.get(key).id, version: revision.version };
    },
    exercise_media_claim_revision_job(p) {
      if (p.p_actor !== revision.uploaded_by_coach_id) return { outcome: 'not_found' };
      const job = jobs.get(`${revision.id}:${revision.recipe_version}`);
      if (!job) return { outcome: 'idle' };
      if (job.state === 'succeeded') return { outcome: 'ready' };
      if (job.state === 'failed') return { outcome: 'failed', code: job.error_code };
      if (job.state === 'running' && job.lease_expires_at > Date.now()) return { outcome: 'busy' };
      if (job.attempts >= job.max_attempts) { job.state = 'failed'; job.error_code = 'attempts_exhausted'; revision.status = 'failed'; return { outcome: 'failed', code: 'attempts_exhausted' }; }
      Object.assign(job, { state: 'running', attempts: job.attempts + 1, lease_token: randomUUID(), lease_expires_at: Date.now() + p.p_lease_seconds * 1000 });
      return { outcome: 'claimed', job: { ...job }, revision: { ...revision }, sources: [...assets.values()].filter((a) => a.revision_id === revision.id && !a.archived) };
    },
    exercise_media_complete_job(p) {
      const job = [...jobs.values()].find((j) => j.id === p.p_job_id);
      if (!job || job.state !== 'running' || job.lease_token !== p.p_lease_token) return { outcome: 'lost' };
      for (const item of p.p_assets) assets.set(randomUUID(), { ...item, revision_id: revision.id, recipe_version: revision.recipe_version, archived: false });
      job.state = 'succeeded'; revision.status = 'ready'; revision.version += 1;
      return { outcome: 'ready', version: revision.version };
    },
    exercise_media_fail_job(p) {
      const job = [...jobs.values()].find((j) => j.id === p.p_job_id);
      if (!job || job.lease_token !== p.p_lease_token) return { outcome: 'lost' };
      if (p.p_retryable && job.attempts < job.max_attempts) { job.state = 'queued'; job.error_code = p.p_error_code; return { outcome: 'requeued' }; }
      job.state = 'failed'; job.error_code = p.p_error_code; revision.status = 'failed'; revision.failure_code = p.p_error_code; revision.version += 1;
      return { outcome: 'failed' };
    },
  };
  return {
    rev: revision, intents, assets, jobs, calls, faults,
    async rpc(name, args) { calls.push(name); if (!rpc[name]) throw new Error(`unexpected rpc ${name}`); return rpc[name](args); },
    async revision() { return { ...revision }; },
    async uploadIntent(id) { return intents.get(id) || null; },
    async uploadIntentsFor() { return [...intents.values()]; },
    async asset(id) { if (faults.assetLookupFails) throw new Error('simulated lookup failure'); return assets.get(id) || null; },
    async assetsFor() { return [...assets.values()].filter((a) => !a.archived); },
    async current() { return { revision_id: null, version: 0, owner_id: null }; },
    async latestJob() { return null; },
    async coachNames() { return new Map([[COACH, 'Synthetic Coach']]); },
  };
}

function setup({ processor = new ImageOnlyProcessor(), shared = null } = {}) {
  const root = shared ? shared.root : fs.mkdtempSync(path.join(os.tmpdir(), 'cvf-photo-uploads-'));
  const store = shared ? shared.store : new LocalMediaStore({ root, grantSecret: 'synthetic-local-grant-secret-0123456789abcdef' });
  const repo = shared ? shared.repo : sqlLikeRepo();
  const order = [];
  // Trace grant issuance without breaking the store's private fields.
  const issueGrant = store.createUploadGrant.bind(store);
  store.createUploadGrant = (args) => { order.push('grant'); return issueGrant(args); };
  const tracedStore = store;
  const tracedRepo = { ...repo, rpc: async (name, args) => { order.push(name); return repo.rpc(name, args); } };
  const service = createExerciseMediaService({
    repo: tracedRepo, store: tracedStore, processor, mode: 'photos', processorAvailable: () => ({ ok: true }),
    signer: createCapabilitySigner({ secret: 'synthetic-capability-secret-0123456789abcdef' }),
  });
  const upload = async (bytes, intentResult) => {
    const token = intentResult.upload.url.split('/').pop();
    const grant = store.verifyUploadGrant(token);
    return store.receiveStaged({ key: grant.key, stream: Readable.from([bytes]), maxBytes: grant.maxBytes });
  };
  return { root, store, repo, service, order, upload };
}

const issue = (service, repo, bytes, overrides = {}) => service.issueUpload(actor, repo.rev.id, {
  request_id: overrides.request_id || randomUUID(), role: 'source_image', bytes: bytes.length, mime_type: 'image/jpeg',
  expected_version: repo.rev.version, rights_confirmed: true, ...overrides,
});

test('the intent is persisted before any grant; the grant names only its app-issued staging key', async () => {
  const { service, repo, order } = setup();
  const bytes = photo();
  const result = await issue(service, repo, bytes);
  assert.deepEqual(order, ['exercise_media_issue_upload_intent', 'grant']);
  assert.equal(result.intent.state, 'issued');
  assert.equal(result.upload.method, 'PUT');
  assert.match(result.upload.url, /^\/api\/exercise-media\/staging\//);
  assert.equal(JSON.stringify(result).includes(repo.rev.id) && JSON.stringify(result).includes('sources/'), false, 'no source key leaks');
  await assert.rejects(issue(service, repo, bytes, { rights_confirmed: false }), (error) => error.status === 422 && error.code === 'rights_confirmation_required');
  await assert.rejects(issue(service, repo, bytes, { mime_type: 'image/svg+xml' }), (error) => error.status === 400);
  await assert.rejects(issue(service, repo, bytes, { role: 'source_video' }), (error) => error.status === 409 && error.code === 'video_sources_disabled');
  await assert.rejects(service.issueUpload(other, repo.rev.id, { request_id: randomUUID(), role: 'source_image', bytes: 10, mime_type: 'image/jpeg', expected_version: 1, rights_confirmed: true }), (error) => error.status === 404);
});

test('finalize trusts no client facts: it re-reads, sniffs, fully decodes and hashes the staged bytes', async () => {
  const { service, repo, store, upload } = setup();
  const bytes = photo(1600, 900, 'image/png');
  // The client claims JPEG; the server records what the bytes are.
  const issued = await issue(service, repo, bytes);
  await assert.rejects(service.finalizeUpload(actor, repo.rev.id, issued.intent.id, { expected_version: repo.rev.version, ...RIGHTS }), (error) => error.status === 409 && error.code === 'upload_incomplete');
  await upload(bytes, issued);
  const done = await service.finalizeUpload(actor, repo.rev.id, issued.intent.id, { expected_version: repo.rev.version, ...RIGHTS });
  assert.equal(done.status, 201);
  const asset = repo.assets.get(issued.intent.id);
  assert.equal(asset.mime_type, 'image/png');
  assert.equal(asset.sha256, sha(bytes));
  assert.equal(Number(asset.bytes), bytes.length);
  assert.equal(asset.storage_key, `sources/${issued.intent.id}.png`);
  assert.deepEqual([asset.width, asset.height], [1600, 900]);
  assert.deepEqual(await store.readObject(asset.storage_key, { maxBytes: 10 * 1024 * 1024 }), bytes);
  assert.equal(repo.intents.get(issued.intent.id).state, 'attached');
  assert.deepEqual(await store.readStaged(`staging/${issued.intent.id}`, { maxBytes: 10 * 1024 * 1024 }), bytes, 'staged copy kept');
});

test('forged, oversize-declared and undecodable uploads never attach', async () => {
  const cases = [
    ['html disguised as jpeg', Buffer.from('<!doctype html><script>alert(1)</script>'), 415],
    ['svg disguised as jpeg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 415],
    ['truncated jpeg', photo().subarray(0, 4000), 422],
  ];
  for (const [name, bytes, status] of cases) {
    const { service, repo, upload } = setup();
    const issued = await issue(service, repo, bytes);
    await upload(bytes, issued);
    await assert.rejects(service.finalizeUpload(actor, repo.rev.id, issued.intent.id, { expected_version: repo.rev.version, ...RIGHTS }), (error) => error.status === status, name);
    assert.equal(repo.assets.size, 0, name);
  }
  const { service, repo, upload } = setup();
  const bytes = photo();
  const issued = await issue(service, repo, bytes, { bytes: bytes.length + 10 });
  await upload(bytes, issued);
  await assert.rejects(service.finalizeUpload(actor, repo.rev.id, issued.intent.id, { expected_version: repo.rev.version, ...RIGHTS }), (error) => error.status === 400 && error.code === 'upload_size_mismatch');
  assert.equal(repo.assets.size, 0);
});

test('double finalize and unknown attach outcomes complete the SAME attachment without deleting bytes', async () => {
  const { service, repo, store, upload } = setup();
  const bytes = photo();
  const issued = await issue(service, repo, bytes);
  await upload(bytes, issued);
  repo.faults.attachThrowsAfterCommit = true;
  const first = await service.finalizeUpload(actor, repo.rev.id, issued.intent.id, { expected_version: repo.rev.version, ...RIGHTS });
  assert.ok([200, 201].includes(first.status), 'committed attach reconciled from the recorded row');
  const versionAfter = repo.rev.version;
  const second = await service.finalizeUpload(actor, repo.rev.id, issued.intent.id, { expected_version: versionAfter, ...RIGHTS });
  assert.equal(second.status, 200);
  assert.equal(second.body.replayed, true);
  assert.equal(repo.assets.size, 1);
  assert.equal(repo.rev.version, versionAfter, 'replay bumps nothing');

  // Unknown outcome AND an unreadable row: report the failure, keep the staged bytes.
  const again = setup();
  const issuedAgain = await issue(again.service, again.repo, bytes);
  await again.upload(bytes, issuedAgain);
  again.repo.faults.attachThrowsAfterCommit = true;
  again.repo.faults.assetLookupFails = true;
  await assert.rejects(again.service.finalizeUpload(actor, again.repo.rev.id, issuedAgain.intent.id, { expected_version: again.repo.rev.version, ...RIGHTS }));
  assert.ok(await again.store.readStaged(`staging/${issuedAgain.intent.id}`, { maxBytes: 10 * 1024 * 1024 }), 'staged bytes retained');
  again.repo.faults.assetLookupFails = false;
  const recovered = await again.service.finalizeUpload(actor, again.repo.rev.id, issuedAgain.intent.id, { expected_version: again.repo.rev.version, ...RIGHTS });
  assert.equal(recovered.body.replayed, true, 'a same-intent retry finishes the recorded attachment');
  assert.ok(await again.store.exists(`sources/${issuedAgain.intent.id}.jpg`));
  assert.ok(store);
});

test('same-request reissue replays the intent; a different file under it mismatches; abandon keeps history', async () => {
  const { service, repo, upload } = setup();
  const bytes = photo();
  const requestId = randomUUID();
  const first = await issue(service, repo, bytes, { request_id: requestId });
  const replay = await issue(service, repo, bytes, { request_id: requestId });
  assert.equal(replay.intent.id, first.intent.id);
  assert.equal(replay.replayed, true);
  await assert.rejects(issue(service, repo, photo(800, 450), { request_id: requestId }), (error) => error.status === 409 && error.code === 'request_mismatch');
  const abandoned = await service.abandonUpload(actor, repo.rev.id, first.intent.id);
  assert.equal(abandoned.state, 'abandoned');
  await upload(bytes, first);
  await assert.rejects(service.finalizeUpload(actor, repo.rev.id, first.intent.id, { expected_version: repo.rev.version, ...RIGHTS }), (error) => error.status === 409 && error.code === 'upload_abandoned');
  await assert.rejects(service.abandonUpload(other, repo.rev.id, first.intent.id), (error) => error.status === 404);
});

test('photos mode processes inline under a durable lease without any worker or FFmpeg', async () => {
  const { service, repo, upload } = setup();
  const bytes = photo(1920, 1080);
  const issued = await issue(service, repo, bytes);
  await upload(bytes, issued);
  await service.finalizeUpload(actor, repo.rev.id, issued.intent.id, { expected_version: repo.rev.version, ...RIGHTS });
  await service.updateRecipe(actor, repo.rev.id, { expected_version: repo.rev.version, alt_text: 'Synthetic photo', poster_crop: { x: 0, y: 0, width: 1, height: 1 } });
  const view = await service.requestProcessing(actor, repo.rev.id, { expected_version: repo.rev.version });
  assert.equal(view.status, 'ready');
  const poster = [...repo.assets.values()].find((a) => a.role === 'poster');
  assert.equal(poster.mime_type, 'image/jpeg');
  assert.ok(poster.bytes <= 160 * 1024);
  assert.match(poster.storage_key, new RegExp(`^derivatives/${repo.rev.id}/\\d+-poster\\.jpg$`));
  const job = [...repo.jobs.values()][0];
  assert.equal(job.state, 'succeeded');
  assert.equal(job.attempts, 1);
});

test('a terminated in-request render leaves a recoverable lease; resume processes the same version', async () => {
  // Process A dies mid-render: its render never settles and no failure is ever
  // recorded. Process B (a fresh service on the same database and store) resumes.
  const real = new ImageOnlyProcessor();
  const dying = { version: real.version, verifyImage: (args) => real.verifyImage(args), renderImage: () => new Promise(() => {}) };
  const a = setup({ processor: dying });
  const bytes = photo();
  const issued = await issue(a.service, a.repo, bytes);
  await a.upload(bytes, issued);
  await a.service.finalizeUpload(actor, a.repo.rev.id, issued.intent.id, { expected_version: a.repo.rev.version, ...RIGHTS });
  await a.service.updateRecipe(actor, a.repo.rev.id, { expected_version: a.repo.rev.version, alt_text: 'Synthetic photo', poster_crop: { x: 0, y: 0, width: 1, height: 1 } });
  a.service.requestProcessing(actor, a.repo.rev.id, { expected_version: a.repo.rev.version });
  for (let i = 0; i < 200 && ![...a.repo.jobs.values()].some((j) => j.state === 'running'); i += 1) await new Promise((resolve) => setImmediate(resolve));
  const job = [...a.repo.jobs.values()][0];
  assert.equal(job.state, 'running');
  assert.equal(a.repo.rev.status, 'processing');

  const b = setup({ shared: a });
  const busy = await b.service.resumeProcessing(actor, a.repo.rev.id);
  assert.equal(busy.status, 'processing', 'a live lease is not stolen');
  job.lease_expires_at = Date.now() - 1;
  const resumed = await b.service.resumeProcessing(actor, a.repo.rev.id);
  assert.equal(resumed.status, 'ready');
  assert.equal(job.attempts, 2, 'the same job, as a new attempt');
  await assert.rejects(b.service.resumeProcessing(other, a.repo.rev.id), (error) => error.status === 404);
});

test('a decode failure during inline processing fails the revision truthfully with a safe code', async () => {
  const { service, repo, upload, store } = setup();
  const bytes = photo();
  const issued = await issue(service, repo, bytes);
  await upload(bytes, issued);
  await service.finalizeUpload(actor, repo.rev.id, issued.intent.id, { expected_version: repo.rev.version, ...RIGHTS });
  await service.updateRecipe(actor, repo.rev.id, { expected_version: repo.rev.version, alt_text: 'Synthetic photo', poster_crop: { x: 0, y: 0, width: 1, height: 1 } });
  // The stored source no longer matches its recorded digest.
  const asset = repo.assets.get(issued.intent.id);
  fs.writeFileSync(store.pathFor(asset.storage_key), photo(1280, 720, 'image/png'));
  const view = await service.requestProcessing(actor, repo.rev.id, { expected_version: repo.rev.version });
  assert.equal(view.status, 'failed');
  assert.equal(repo.rev.failure_code, 'source_mismatch');
});

test('video work is refused in photos mode before anything is queued', async () => {
  const { service, repo } = setup();
  repo.assets.set(randomUUID(), { id: randomUUID(), role: 'source_video', revision_id: repo.rev.id, archived: false, duration_ms: 6000, mime_type: 'video/mp4', storage_key: `sources/${randomUUID()}.mp4` });
  await assert.rejects(service.requestProcessing(actor, repo.rev.id, { expected_version: repo.rev.version }), (error) => error.status === 503 && error.code === 'video_processing_unavailable');
  assert.equal(repo.jobs.size, 0);
  await assert.rejects(service.prepareUpload(actor, repo.rev.id, 'source_video'), (error) => error.status === 409 && error.code === 'video_sources_disabled');
  const caps = service.capabilities();
  assert.equal(caps.mode, 'photos');
  assert.equal(caps.video_sources, false);
  assert.equal(caps.upload_transport, 'grant');
  assert.equal(caps.processing, 'inline');
  assert.equal(caps.processing_available, true);
});
