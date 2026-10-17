// Source upload commit/recovery boundary (P2 correction R1). Uses the real
// LocalMediaStore in a temporary directory, a labelled synthetic JPEG and a
// controlled repository that mirrors exercise_media_attach_source's
// commit/replay rules (insert + version bump, same-request replay when role,
// revision and sha256 match, request_mismatch otherwise). Image decoding is
// stubbed; real SQL behavior is proven by the integration lane. Faults are
// injected only here, at the post-database file-install boundary.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createHash } = require('node:crypto');
const { createCanvas } = require('@napi-rs/canvas');
const { LocalMediaStore } = require('../src/services/exerciseMedia/localStore');
const { MediaWorker } = require('../src/services/exerciseMedia/worker');
const { createExerciseMediaService } = require('../src/lib/exerciseMedia/service');

const id = (n) => `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const COACH = id(1);
const actor = { role: 'coach', coach: { id: COACH } };
const sha = (buffer) => createHash('sha256').update(buffer).digest('hex');

// Synthetic geometry only (no person, no exercise demonstration).
function syntheticJpeg(seed = 1) {
  const canvas = createCanvas(640, 360);
  const g = canvas.getContext('2d');
  g.fillStyle = '#1d1a17'; g.fillRect(0, 0, 640, 360);
  g.fillStyle = `hsl(${seed * 47 % 360}, 70%, 55%)`; g.fillRect(40 + seed * 10, 60, 180, 120);
  g.fillStyle = '#f2efe9'; g.font = '20px sans-serif'; g.fillText('SYNTHETIC TEST MEDIA — NOT INSTRUCTION', 20, 340);
  return canvas.toBuffer('image/jpeg', 85);
}

function sqlLikeRepo() {
  const revision = { id: id(2), exercise_library_id: id(3), uploaded_by_coach_id: COACH, status: 'draft', review_status: 'needs_review', version: 1, recipe_version: 1, cues: [], caption_cues: [], archived: false };
  const assets = new Map();
  const byRequest = new Map();
  const state = { versionBumps: 0, transportErrorAfterCommit: false, assetLookupFails: false };
  const current = { revision_id: id(90), version: 4 };
  return {
    rev: revision, assets, state, currentPointer: current,
    async rpc(name, p) {
      assert.equal(name, 'exercise_media_attach_source');
      const a = p.p_asset;
      if (p.p_actor !== revision.uploaded_by_coach_id) return { outcome: 'not_found' };
      const existingId = byRequest.get(a.upload_request_id);
      if (existingId) {
        const existing = assets.get(existingId);
        if (existing.revision_id === p.p_revision_id && existing.role === a.role && existing.sha256 === a.sha256) {
          return { outcome: 'attached', asset_id: existing.id, version: revision.version, replayed: true };
        }
        return { outcome: 'request_mismatch' };
      }
      if (p.p_expected_version !== revision.version) return { outcome: 'stale', version: revision.version };
      assets.set(a.id, { ...a, revision_id: p.p_revision_id, uploaded_by_coach_id: p.p_actor, archived: false });
      byRequest.set(a.upload_request_id, a.id);
      revision.version += 1;
      state.versionBumps += 1;
      if (state.transportErrorAfterCommit) {
        state.transportErrorAfterCommit = false;
        throw Object.assign(new Error('simulated transport error after the commit'), { code: 'ECONNRESET' });
      }
      return { outcome: 'attached', asset_id: a.id, version: revision.version, replayed: false };
    },
    async asset(assetId) {
      if (state.assetLookupFails) throw Object.assign(new Error('simulated lookup failure'), { code: 'ECONNRESET' });
      return assets.get(assetId) || null;
    },
    revision: async () => revision,
    assetsFor: async () => [...assets.values()],
    current: async () => current,
    latestJob: async () => null,
    coachNames: async () => new Map([[COACH, 'Synthetic Coach']]),
  };
}

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cvf-upload-recovery-'));
  const store = new LocalMediaStore({ root });
  const repo = sqlLikeRepo();
  const service = createExerciseMediaService({ repo, store, processor: { verifyImage: async () => true }, signer: null });
  const stage = (bytes) => store.stageUpload({ stream: Readable.from([bytes]), maxBytes: 10 * 1024 * 1024 });
  const fields = (requestId = id(4)) => ({ request_id: requestId, expected_version: '1', rights_basis: 'owned', rights_confirmed: 'true', original_name: 'synthetic.jpg' });
  // Test-only fault at the post-DB install boundary: the next `times` installs fail with EIO.
  const failInstalls = (times = 1) => {
    const original = store.commitUpload.bind(store);
    let left = times;
    store.commitUpload = async (...args) => {
      if (left > 0) { left -= 1; throw Object.assign(new Error('simulated install I/O failure after the database attach'), { code: 'EIO' }); }
      return original(...args);
    };
    return () => { store.commitUpload = original; };
  };
  const recorded = () => [...repo.assets.values()];
  const objectFile = (asset) => fs.readFileSync(store.pathFor(asset.storage_key));
  return { root, store, repo, service, stage, fields, failInstalls, recorded, objectFile, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('R1: a committed attachment whose file install fails keeps the validated bytes and never reports success', async () => {
  const t = setup();
  try {
    const bytes = syntheticJpeg(1);
    const first = await t.stage(bytes);
    t.failInstalls(1);
    await assert.rejects(t.service.attachSource(actor, t.repo.rev, 'source_image', first, t.fields()), /install I\/O failure/);
    const [asset] = t.recorded();
    assert.equal(t.recorded().length, 1, 'the database attachment committed');
    assert.equal(asset.id, first.uploadId);
    assert.equal(await t.store.exists(asset.storage_key), false, 'file not installed yet');
    assert.deepEqual(await t.store.listStagedUploads(), [asset.id], 'validated bytes kept under the recorded asset id for recovery');
    assert.equal(sha(fs.readFileSync(t.store.stagedPath(asset.id))), asset.sha256);
  } finally { t.cleanup(); }
});

test('R1: the same request retry finalizes the ORIGINAL recorded asset/key, once, with matching size and hash', async () => {
  const t = setup();
  try {
    const bytes = syntheticJpeg(2);
    const first = await t.stage(bytes);
    const restore = t.failInstalls(1);
    await assert.rejects(t.service.attachSource(actor, t.repo.rev, 'source_image', first, t.fields()));
    restore();
    const second = await t.stage(bytes);
    assert.notEqual(second.uploadId, first.uploadId);
    const retry = await t.service.attachSource(actor, t.repo.rev, 'source_image', second, t.fields());
    assert.equal(retry.status, 200);
    assert.equal(retry.body.replayed, true);
    const [asset] = t.recorded();
    assert.equal(t.recorded().length, 1, 'no second source record');
    assert.equal(asset.id, first.uploadId);
    assert.equal(asset.storage_key, `sources/${first.uploadId}.jpg`, 'recorded key, not the retry staging id');
    const installed = t.objectFile(asset);
    assert.equal(installed.length, asset.bytes);
    assert.equal(sha(installed), asset.sha256);
    assert.equal(await t.store.exists(`sources/${second.uploadId}.jpg`), false, 'retry staging key never installed');
    assert.equal(t.repo.state.versionBumps, 1, 'replay does not advance the draft again');
    assert.deepEqual(await t.store.listStagedUploads(), [], 'both staged copies consumed or discarded');
  } finally { t.cleanup(); }
});

test('R1: a replay when the recorded file is already installed and valid leaves it untouched', async () => {
  const t = setup();
  try {
    const bytes = syntheticJpeg(3);
    const created = await t.service.attachSource(actor, t.repo.rev, 'source_image', await t.stage(bytes), t.fields());
    assert.equal(created.status, 201);
    const [asset] = t.recorded();
    const before = fs.statSync(t.store.pathFor(asset.storage_key));
    const replay = await t.service.attachSource(actor, t.repo.rev, 'source_image', await t.stage(bytes), t.fields());
    assert.equal(replay.status, 200);
    const after = fs.statSync(t.store.pathFor(asset.storage_key));
    assert.equal(after.ino, before.ino, 'same file, not replaced');
    assert.equal(after.mtimeMs, before.mtimeMs);
    assert.equal(sha(t.objectFile(asset)), asset.sha256);
    assert.equal(t.recorded().length, 1);
    assert.deepEqual(await t.store.listStagedUploads(), []);
  } finally { t.cleanup(); }
});

test('R1: repeated install failures keep a recoverable copy, fail every time, and recovery finishes later', async () => {
  const t = setup();
  try {
    const bytes = syntheticJpeg(4);
    const first = await t.stage(bytes);
    const restore = t.failInstalls(Infinity);
    await assert.rejects(t.service.attachSource(actor, t.repo.rev, 'source_image', first, t.fields()));
    await assert.rejects(t.service.attachSource(actor, t.repo.rev, 'source_image', await t.stage(bytes), t.fields()), /install I\/O failure/, 'no false success');
    const [asset] = t.recorded();
    assert.deepEqual(await t.store.listStagedUploads(), [asset.id], 'exactly one recoverable copy, under the recorded id');
    const worker = new MediaWorker({ repo: t.repo, store: t.store, processor: {} });
    // While installs keep failing, recovery keeps the committed bytes even past the sweep age.
    const failed = await worker.recover({ olderThanMs: 0 });
    assert.equal(failed.recovered, 0);
    assert.deepEqual(await t.store.listStagedUploads(), [asset.id]);
    restore();
    const done = await worker.recover({ olderThanMs: 0 });
    assert.equal(done.recovered, 1);
    assert.equal(sha(t.objectFile(asset)), asset.sha256);
    assert.deepEqual(await t.store.listStagedUploads(), []);
    assert.equal(t.repo.state.versionBumps, 1);
  } finally { t.cleanup(); }
});

test('R1: definite rejections still clean disposable bytes and leave the attachment and current guide unchanged', async () => {
  const t = setup();
  try {
    const bytes = syntheticJpeg(5);
    // Validation: missing rights confirmation.
    await assert.rejects(t.service.attachSource(actor, t.repo.rev, 'source_image', await t.stage(bytes), { ...t.fields(), rights_confirmed: 'false' }), (e) => e.code === 'rights_confirmation_required');
    assert.deepEqual(await t.store.listStagedUploads(), []);
    // Ownership: another coach's request is refused by the database layer.
    const other = { role: 'coach', coach: { id: id(77) } };
    await assert.rejects(t.service.attachSource(other, t.repo.rev, 'source_image', await t.stage(bytes), t.fields()), (e) => e.status === 404);
    assert.deepEqual(await t.store.listStagedUploads(), []);
    assert.equal(t.recorded().length, 0);
    // Request mismatch: the same request id with different bytes.
    const created = await t.service.attachSource(actor, t.repo.rev, 'source_image', await t.stage(bytes), t.fields());
    assert.equal(created.status, 201);
    const [asset] = t.recorded();
    const original = t.objectFile(asset);
    await assert.rejects(t.service.attachSource(actor, t.repo.rev, 'source_image', await t.stage(syntheticJpeg(6)), t.fields()), (e) => e.code === 'request_mismatch');
    assert.deepEqual(await t.store.listStagedUploads(), []);
    assert.equal(t.recorded().length, 1);
    assert.deepEqual(t.objectFile(asset), original, 'recorded file unchanged');
    assert.deepEqual(await t.repo.current(), { revision_id: id(90), version: 4 }, 'current guide untouched');
  } finally { t.cleanup(); }
});

test('R1: existing crash recovery still installs an interrupted upload and sweeps only uncommitted parts', async () => {
  const t = setup();
  try {
    const bytes = syntheticJpeg(7);
    const committed = await t.stage(bytes);
    // Crash between the database attach and the install: row recorded, file still staged.
    t.repo.assets.set(committed.uploadId, { id: committed.uploadId, role: 'source_image', storage_key: `sources/${committed.uploadId}.jpg`, bytes: committed.bytes, sha256: committed.sha256, revision_id: t.repo.rev.id });
    const orphan = await t.stage(syntheticJpeg(8));
    const worker = new MediaWorker({ repo: t.repo, store: t.store, processor: {} });
    const result = await worker.recover({ olderThanMs: 0 });
    assert.equal(result.recovered, 1);
    assert.equal(sha(fs.readFileSync(t.store.pathFor(`sources/${committed.uploadId}.jpg`))), committed.sha256);
    assert.equal(result.quarantine, 1, 'only the uncommitted orphan part is swept');
    assert.equal(fs.existsSync(t.store.stagedPath(orphan.uploadId)), false);
    assert.deepEqual(await t.store.listStagedUploads(), []);
  } finally { t.cleanup(); }
});

test('R1: an uncertain attach outcome is reconciled by the recorded asset; never lost, never duplicated', async () => {
  const t = setup();
  try {
    const bytes = syntheticJpeg(9);
    // Commit lands, then the transport fails: the service reads the recorded row and finishes.
    t.repo.state.transportErrorAfterCommit = true;
    const first = await t.stage(bytes);
    const reconciled = await t.service.attachSource(actor, t.repo.rev, 'source_image', first, t.fields(id(5)));
    assert.equal(reconciled.status, 201);
    const [asset] = t.recorded();
    assert.equal(asset.id, first.uploadId);
    assert.equal(sha(t.objectFile(asset)), asset.sha256);
    assert.deepEqual(await t.store.listStagedUploads(), []);

    // Commit lands, transport fails AND the reconciliation read fails: outcome unknown.
    t.repo.state.transportErrorAfterCommit = true;
    t.repo.state.assetLookupFails = true;
    const second = await t.stage(syntheticJpeg(10));
    await assert.rejects(t.service.attachSource(actor, t.repo.rev, 'source_image', second, { ...t.fields(id(6)), expected_version: String(t.repo.rev.version) }), /transport error/);
    assert.deepEqual(await t.store.listStagedUploads(), [second.uploadId], 'bytes kept while the outcome is unknown');
    t.repo.state.assetLookupFails = false;
    // The same request later finds its committed record and finalizes the original key once.
    const retry = await t.service.attachSource(actor, t.repo.rev, 'source_image', await t.stage(syntheticJpeg(10)), { ...t.fields(id(6)), expected_version: String(t.repo.rev.version) });
    assert.equal(retry.status, 200);
    const recordedSecond = t.repo.assets.get(second.uploadId);
    assert.equal(sha(t.objectFile(recordedSecond)), recordedSecond.sha256);
    assert.equal(t.recorded().length, 2, 'one record per request');
    assert.equal(t.repo.state.versionBumps, 2);
    assert.deepEqual(await t.store.listStagedUploads(), []);
  } finally { t.cleanup(); }
});
