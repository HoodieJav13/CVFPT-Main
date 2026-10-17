// Exercise media orchestration. Actors always come from req.user (server
// derived); request bodies never supply owner/reviewer/status/storage/hash.
// SQL functions own state transitions and concurrency; this layer validates
// inputs, handles real bytes and maps outcomes to HTTP.
const path = require('node:path');
const fsp = require('node:fs/promises');
const { createHash } = require('node:crypto');
const {
  LIMITS, MediaError, isUuid, sniffImage, assertImageFacts, sniffVideoContainer, normalizeRecipePatch, sanitizeDisplayName, parseRange,
} = require('./validation');
const { mediaMap, coachRevisionDto, libraryStatusDto } = require('./serialization');
const { parseContext, resolveContext, allowedAssets } = require('./authorization');
const { runPhotoJob, needsVideo } = require('../../services/exerciseMedia/photoJob');

// Hosted photo work can spend15s each on source metadata, source bytes,
// decoder scheduling, derivative upload and completion RPC. Keep the lease
// above that75s budget (and failure recording), so Resume cannot steal a
// still-running request. A terminated request recovers after this bounded lease.
const INLINE_LEASE_SECONDS = 120;
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

class HttpError extends Error {
  constructor(status, code, extra = {}) { super(code); this.status = status; this.code = code; this.extra = extra; }
}
const http = (status, code, extra) => new HttpError(status, code, extra);

const OUTCOME_STATUS = {
  not_found: [404, 'not_found'], forbidden: [403, 'forbidden'], stale: [409, 'stale'], processing: [409, 'revision_processing'],
  published_immutable: [409, 'published_immutable'], request_mismatch: [409, 'request_mismatch'], invalid_patch: [400, 'invalid_patch'],
  invalid_asset: [400, 'invalid_asset'], not_ready: [409, 'not_ready'], attestation_required: [422, 'attestation_required'],
  captions_required: [422, 'captions_required'], replace_requires_admin: [403, 'replace_requires_admin'], draft_limit: [409, 'draft_limit'],
  base_not_current: [409, 'base_not_current'], already_published: [409, 'already_published'], invalid_version: [400, 'invalid_version'],
  already_ready: [409, 'already_ready'], alt_text_required: [422, 'alt_text_required'], end_frame_incomplete: [422, 'end_frame_incomplete'],
};
function refuse(result) {
  if (result?.outcome === 'invalid_recipe') throw http(422, result.code || 'invalid_recipe');
  const mapped = OUTCOME_STATUS[result?.outcome];
  if (mapped) throw http(mapped[0], mapped[1], pick(result, ['version', 'current_version']));
  throw http(500, 'unexpected_outcome');
}
function pick(source, keys) { const out = {}; for (const key of keys) if (source && key in source) out[key] = source[key]; return out; }

function requireUuid(value, code = 'invalid_id') { if (!isUuid(value)) throw http(400, code); return value.toLowerCase(); }
function requireVersion(value, code = 'invalid_version') { if (!Number.isInteger(value) || value < 0) throw http(400, code); return value; }

const principalOf = (user) => (user.role === 'client' ? { kind: 'client', id: user.client.id } : { kind: 'coach', id: user.coach.id });

function sourceFacts(assets, revision) {
  const video = assets.find((a) => a.role === 'source_video' && !a.archived);
  const image = assets.find((a) => a.role === 'source_image' && !a.archived);
  return {
    video: video ? { durationMs: video.duration_ms, width: video.width, height: video.height } : undefined,
    image: image ? { width: image.width, height: image.height } : undefined,
    posterMode: revision.poster_mode || undefined,
    videoAsset: video, imageAsset: image,
  };
}

// mode: 'photos' (default runtime: image-only processor, direct-upload grants,
// inline leased processing, no video sources) or 'full' (the accepted owned
// FFmpeg pipeline with a background worker, kept for future private needs).
function createExerciseMediaService({ repo, store, processor, signer, processorAvailable = () => ({ ok: true }), mode = 'full', maxContentBytes = null, now = Date.now, inlineLabel = `inline-${process.pid}` }) {
  const photosOnly = mode === 'photos';
  async function revisionView(actor, revision) {
    const [assets, current, job, names] = await Promise.all([
      repo.assetsFor([revision.id]), repo.current(revision.exercise_library_id), repo.latestJob(revision.id),
      repo.coachNames([revision.uploaded_by_coach_id]),
    ]);
    return coachRevisionDto(revision, { assets, actor, current, job, ownerName: names.get(revision.uploaded_by_coach_id) || null });
  }

  // The attach call failed in transit, so it may or may not have committed.
  // Only the recorded row (keyed by this upload's own asset id) can tell; if
  // it cannot be read, the caller keeps the bytes and reports the failure.
  async function reconcileAttach(uploadId, error) {
    const recorded = await repo.asset(uploadId).catch(() => undefined);
    if (!recorded) throw error;
    return { outcome: 'attached', asset_id: recorded.id, replayed: false };
  }

  // A same-request retry: the database already records an asset and key for
  // this request. Install THAT asset from a verified copy (the original staged
  // bytes when still present and intact, otherwise this retry's identical
  // bytes re-filed under the recorded id); an already-installed matching file
  // is left untouched. The retry's own staging key is never recorded or used.
  async function finishReplay(assetId, staged) {
    const recorded = await repo.asset(assetId);
    if (!recorded) throw http(500, 'source_record_missing');
    const expected = { bytes: recorded.bytes, sha256: recorded.sha256 };
    if (staged.uploadId !== recorded.id) {
      if (staged.sha256 !== recorded.sha256 || staged.bytes !== Number(recorded.bytes)) {
        await store.discardUpload(staged.uploadId).catch(() => {});
        throw http(409, 'request_mismatch');
      }
      const original = await store.checkStaged(recorded.id, expected);
      if (original === 'match') await store.discardUpload(staged.uploadId);
      else {
        if (original === 'mismatch') await store.discardUpload(recorded.id);
        await store.adoptStaged(staged.uploadId, recorded.id);
      }
    }
    await store.commitUpload(recorded.id, recorded.storage_key, expected);
  }

  async function ownedRevision(actor, id) {
    const revision = await repo.revision(requireUuid(id));
    if (!revision || revision.archived || (actor.role !== 'admin' && revision.uploaded_by_coach_id !== actor.coach.id)) throw http(404, 'not_found');
    return revision;
  }

  function rightsFields(fields) {
    if (!['owned', 'permissioned'].includes(fields.rights_basis)) throw http(422, 'rights_basis_required');
    if (fields.rights_confirmed !== 'true' && fields.rights_confirmed !== true) throw http(422, 'rights_confirmation_required');
    const note = typeof fields.rights_note === 'string' ? fields.rights_note.trim() : '';
    if (note.length > LIMITS.text.rightsNoteMax) throw http(422, 'rights_note_too_long');
    return { basis: fields.rights_basis, note };
  }

  async function ownIntent(actor, revision, intentId) {
    const intent = await repo.uploadIntent(requireUuid(intentId, 'invalid_upload'));
    if (!intent || intent.revision_id !== revision.id || intent.actor_coach_id !== actor.coach.id) throw http(404, 'not_found');
    return intent;
  }

  // Claims this revision's current job under a lease and renders it in-request.
  // Returns the claim outcome ('claimed' | 'busy' | 'idle' | 'ready' | 'failed').
  async function processInline(actor, revisionId) {
    const claim = await repo.rpc('exercise_media_claim_revision_job', { p_actor: actor.coach.id, p_revision_id: revisionId, p_worker: inlineLabel, p_lease_seconds: INLINE_LEASE_SECONDS });
    if (claim?.outcome !== 'claimed') return claim?.outcome;
    await runPhotoJob({ repo, store, processor, claim });
    return 'claimed';
  }

  return {
    HttpError,

    capabilities() {
      const available = processorAvailable();
      return {
        mode,
        video_sources: !photosOnly,
        upload_transport: photosOnly ? 'grant' : 'multipart',
        processing: photosOnly ? 'inline' : 'worker',
        // Optional browser-only still selection from a local clip (only the image is uploaded).
        local_still_selection: true,
        processing_available: Boolean(available.ok),
        limits: {
          image: { max_bytes: LIMITS.image.maxBytes, min_edge: LIMITS.image.minEdge, max_edge: LIMITS.image.maxEdge, max_pixels: LIMITS.image.maxPixels, mime_types: LIMITS.image.mimes },
          video: { max_bytes: LIMITS.video.maxBytes, max_duration_ms: LIMITS.video.maxDurationMs, max_edge: LIMITS.video.maxEdge, max_fps: LIMITS.video.maxFps, mime_types: LIMITS.video.mimes, codecs: LIMITS.video.codecs },
          preview: { min_ms: LIMITS.preview.minMs, max_ms: LIMITS.preview.maxMs, max_bytes: LIMITS.preview.maxBytes },
          poster: { width: LIMITS.poster.width, height: LIMITS.poster.height, max_bytes: LIMITS.poster.maxBytes },
          instruction: { max_bytes: LIMITS.instruction.maxBytes },
          text: { alt_max: LIMITS.text.altMax, cue_max: LIMITS.text.cueMax, cues_max: LIMITS.text.cuesMax, transcript_max: LIMITS.text.transcriptMax, rights_note_max: LIMITS.text.rightsNoteMax },
          captions: { max_cues: LIMITS.captions.maxCues, max_text_chars: LIMITS.captions.maxTextChars },
          crop_aspect: '16:9',
          uploads_per_window: LIMITS.uploads.perWindow,
        },
        ownership_policy: 'Drafts and sources belong to their uploader (or admin). Replacing or withdrawing another coach\'s current guide requires admin. Approval is a deliberate review, never upload success.',
      };
    },

    async libraryStatus(actor) {
      return libraryStatusDto(await repo.libraryStatus(actor.coach.id), actor);
    },

    async createDraft(actor, exerciseId, body = {}) {
      const id = requireUuid(exerciseId);
      if (body.confirm_exercise_id !== id) throw http(400, 'exercise_confirmation_required');
      const requestId = requireUuid(body.request_id, 'invalid_request_id');
      const base = body.base_revision_id == null ? null : requireUuid(body.base_revision_id, 'invalid_base_revision');
      const result = await repo.rpc('exercise_media_create_draft', { p_actor: actor.coach.id, p_exercise_id: id, p_request_id: requestId, p_base_revision_id: base });
      if (result?.outcome !== 'created') refuse(result);
      return { status: result.replayed ? 200 : 201, body: { revision: await revisionView(actor, await repo.revision(result.revision_id)), replayed: Boolean(result.replayed) } };
    },

    async listRevisions(actor, exerciseId, query = {}) {
      const id = requireUuid(exerciseId);
      const exercise = await repo.exercise(id);
      if (!exercise || exercise.archived) throw http(404, 'not_found');
      const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || LIMITS.drafts.pageDefault, 1), LIMITS.drafts.pageMax);
      const before = typeof query.before === 'string' && !Number.isNaN(Date.parse(query.before)) ? new Date(query.before).toISOString() : null;
      const drafts = await repo.revisionsForExercise(id, { ownerId: actor.role === 'admin' ? null : actor.coach.id, limit, before });
      const page = drafts.slice(0, limit);
      const current = await repo.current(id);
      const currentRevision = current.revision_id ? await repo.revision(current.revision_id) : null;
      const rows = [...(currentRevision ? [currentRevision] : []), ...page];
      const [assets, names] = await Promise.all([repo.assetsFor(rows.map((r) => r.id)), repo.coachNames(rows.map((r) => r.uploaded_by_coach_id))]);
      const view = (revision) => coachRevisionDto(revision, { assets, actor, current, job: null, ownerName: names.get(revision.uploaded_by_coach_id) || null });
      return {
        exercise: { id: exercise.id, name: exercise.name, equipment: exercise.equipment, category: exercise.category, primary_muscle: exercise.primary_muscle, hidden: Boolean(exercise.hidden) },
        current: currentRevision ? view(currentRevision) : null,
        current_version: current.version,
        drafts: page.map(view),
        next_before: drafts.length > limit ? page[page.length - 1].created_at : null,
      };
    },

    async getRevision(actor, id) {
      const revision = await repo.revision(requireUuid(id));
      if (!revision || revision.archived) throw http(404, 'not_found');
      const isOwner = actor.role === 'admin' || revision.uploaded_by_coach_id === actor.coach.id;
      if (!isOwner) {
        // Other coaches may read only the approved current guide.
        const current = await repo.current(revision.exercise_library_id);
        if (current.revision_id !== revision.id) throw http(404, 'not_found');
      }
      return revisionView(actor, revision);
    },

    // Called BEFORE any upload bytes are accepted.
    async prepareUpload(actor, id, role) {
      if (!['source_image', 'source_video'].includes(role)) throw http(400, 'invalid_role');
      const revision = await ownedRevision(actor, id);
      if (photosOnly && role === 'source_video') throw http(409, 'video_sources_disabled');
      if (typeof store.stageUpload !== 'function') throw http(409, 'upload_grant_required');
      if (revision.published_at) throw http(409, 'published_immutable');
      if (revision.status === 'processing') throw http(409, 'revision_processing');
      return revision;
    },

    // Staged bytes are disposable only until the database records this upload.
    // Once the attach committed (or its outcome is unknown) they stay in
    // quarantine under the recorded asset id, where a same-request retry or
    // the worker's recovery pass can still install them; success is reported
    // only once the recorded file is in place and verified.
    async attachSource(actor, revision, role, staged, fields) {
      let disposable = true;
      try {
        const requestId = requireUuid(fields.request_id, 'invalid_request_id');
        const expected = requireVersion(Number(fields.expected_version));
        if (!['owned', 'permissioned'].includes(fields.rights_basis)) throw http(422, 'rights_basis_required');
        if (fields.rights_confirmed !== 'true') throw http(422, 'rights_confirmation_required');
        const note = typeof fields.rights_note === 'string' ? fields.rights_note.trim() : '';
        if (note.length > LIMITS.text.rightsNoteMax) throw http(422, 'rights_note_too_long');
        const head = await store.readHead(staged.path, LIMITS.request.sniffBytes);
        let descriptor;
        if (role === 'source_image') {
          const facts = assertImageFacts(sniffImage(head), staged.bytes);
          if (!processorAvailable().ok) throw http(503, 'processor_unavailable');
          await processor.verifyImage({ sourcePath: staged.path, facts });
          descriptor = { mime_type: facts.mime, ext: facts.ext, width: facts.width, height: facts.height, duration_ms: null, has_audio: null };
        } else {
          if (staged.bytes > LIMITS.video.maxBytes) throw new MediaError('file_too_large');
          const container = sniffVideoContainer(head);
          if (!processorAvailable().ok) throw http(503, 'processor_unavailable');
          const facts = await processor.probe({ sourcePath: staged.path, container: container.container });
          descriptor = { mime_type: container.mime, ext: container.ext, width: facts.width, height: facts.height, duration_ms: facts.durationMs, has_audio: facts.hasAudio };
        }
        const key = `sources/${staged.uploadId}.${descriptor.ext}`;
        let result;
        try {
          result = await repo.rpc('exercise_media_attach_source', {
            p_actor: actor.coach.id, p_revision_id: revision.id, p_expected_version: expected,
            p_asset: {
              id: staged.uploadId, role, storage_key: key, mime_type: descriptor.mime_type, bytes: staged.bytes, width: descriptor.width,
              height: descriptor.height, duration_ms: descriptor.duration_ms, has_audio: descriptor.has_audio, sha256: staged.sha256,
              rights_basis: fields.rights_basis, rights_note: note, display_name: sanitizeDisplayName(fields.original_name),
              upload_request_id: requestId,
            },
          });
        } catch (error) {
          disposable = false;
          result = await reconcileAttach(staged.uploadId, error);
        }
        if (result?.outcome !== 'attached') refuse(result);
        disposable = false;
        if (result.replayed) await finishReplay(result.asset_id, staged);
        else await store.commitUpload(staged.uploadId, key, { bytes: staged.bytes, sha256: staged.sha256 });
        return { status: result.replayed ? 200 : 201, body: { revision: await revisionView(actor, await repo.revision(revision.id)), replayed: Boolean(result.replayed) } };
      } catch (error) {
        if (disposable) await store.discardUpload(staged.uploadId).catch(() => {});
        throw error;
      }
    },

    // ----- Photo direct-upload transport (docs/exercise-guides/design.md) -----
    // 1) issueUpload persists a durable intent (actor + request) BEFORE any
    //    grant, then returns a short-lived grant for its app-issued staging key.
    async issueUpload(actor, id, body = {}) {
      const revision = await ownedRevision(actor, id);
      if (body.role === 'source_video' && photosOnly) throw http(409, 'video_sources_disabled');
      if (body.role !== 'source_image') throw http(400, 'invalid_role');
      if (body.rights_confirmed !== true && body.rights_confirmed !== 'true') throw http(422, 'rights_confirmation_required');
      const requestId = requireUuid(body.request_id, 'invalid_request_id');
      const bytes = Number(body.bytes);
      if (!Number.isInteger(bytes) || bytes < 1) throw http(400, 'invalid_upload');
      if (bytes > LIMITS.image.maxBytes) throw new MediaError('file_too_large');
      if (!LIMITS.image.mimes.includes(body.mime_type)) throw http(400, 'unsupported_image_type');
      const expected = requireVersion(Number(body.expected_version));
      const result = await repo.rpc('exercise_media_issue_upload_intent', {
        p_actor: actor.coach.id, p_revision_id: revision.id, p_request_id: requestId, p_role: 'source_image',
        p_bytes: bytes, p_mime: body.mime_type, p_expected_version: expected,
      });
      if (result?.outcome !== 'issued') refuse(result);
      const intent = { id: result.intent_id, state: result.state, request_id: requestId };
      if (result.state !== 'issued') return { intent, upload: null, replayed: Boolean(result.replayed) };
      const upload = await store.createUploadGrant({ key: result.staging_key, contentType: body.mime_type });
      return { intent, upload, replayed: Boolean(result.replayed) };
    },

    // 2) finalizeUpload re-authorizes the actor/draft, re-reads the staged bytes
    //    and decides everything from them (length, sniffed format, full decode,
    //    digest); nothing the browser claimed is trusted. The accepted attach
    //    contract records the asset under the intent id (same-request replays
    //    finish the same attachment). Staged bytes are never deleted, so an
    //    unknown database outcome stays recoverable.
    async finalizeUpload(actor, id, intentId, body = {}) {
      const revision = await ownedRevision(actor, id);
      const intent = await ownIntent(actor, revision, intentId);
      if (intent.state === 'abandoned') throw http(409, 'upload_abandoned');
      const expected = requireVersion(Number(body.expected_version));
      const rights = rightsFields(body);
      const staged = await store.readStaged(intent.staging_key, { maxBytes: LIMITS.image.maxBytes });
      if (!staged) throw http(409, 'upload_incomplete');
      if (staged.length !== Number(intent.declared_bytes)) throw http(400, 'upload_size_mismatch');
      const facts = assertImageFacts(sniffImage(staged), staged.length);
      if (!processorAvailable().ok) throw http(503, 'processor_unavailable');
      await processor.verifyImage({ buffer: staged, facts });
      const digest = sha256(staged);
      const key = `sources/${intent.id}.${facts.ext}`;
      let result;
      try {
        result = await repo.rpc('exercise_media_attach_source', {
          p_actor: actor.coach.id, p_revision_id: revision.id, p_expected_version: expected,
          p_asset: {
            id: intent.id, role: 'source_image', storage_key: key, mime_type: facts.mime, bytes: staged.length, width: facts.width,
            height: facts.height, duration_ms: null, has_audio: null, sha256: digest, rights_basis: rights.basis, rights_note: rights.note,
            display_name: sanitizeDisplayName(body.original_name), upload_request_id: intent.request_id,
          },
        });
      } catch (error) {
        result = await reconcileAttach(intent.id, error);
      }
      if (result?.outcome !== 'attached') refuse(result);
      await store.installStagedSource(intent.staging_key, key, { bytes: staged.length, sha256: digest });
      await repo.rpc('exercise_media_mark_upload_intent', { p_actor: actor.coach.id, p_intent_id: intent.id, p_state: 'attached' });
      return { status: result.replayed ? 200 : 201, body: { revision: await revisionView(actor, await repo.revision(revision.id)), replayed: Boolean(result.replayed) } };
    },

    // Explicit cancel of an unfinished upload: state only, bytes are kept.
    async abandonUpload(actor, id, intentId) {
      const revision = await ownedRevision(actor, id);
      const intent = await ownIntent(actor, revision, intentId);
      const result = await repo.rpc('exercise_media_mark_upload_intent', { p_actor: actor.coach.id, p_intent_id: intent.id, p_state: 'abandoned' });
      if (!['abandoned', 'attached'].includes(result?.outcome)) refuse(result);
      return { id: intent.id, state: result.outcome };
    },

    async removeSource(actor, id, body = {}) {
      const revision = await ownedRevision(actor, id);
      const result = await repo.rpc('exercise_media_remove_source', { p_actor: actor.coach.id, p_revision_id: revision.id, p_expected_version: requireVersion(body.expected_version), p_role: body.role });
      if (!['updated', 'unchanged'].includes(result?.outcome)) refuse(result);
      return revisionView(actor, await repo.revision(revision.id));
    },

    async updateRecipe(actor, id, body = {}) {
      const revision = await ownedRevision(actor, id);
      const { expected_version: expectedVersion, ...rest } = body || {};
      const expected = requireVersion(expectedVersion);
      const assets = await repo.assetsFor([revision.id]);
      const patch = normalizeRecipePatch(rest, sourceFacts(assets, revision));
      if (!Object.keys(patch).length) throw http(400, 'empty_patch');
      const result = await repo.rpc('exercise_media_update_draft', { p_actor: actor.coach.id, p_revision_id: revision.id, p_expected_version: expected, p_patch: patch });
      if (!['updated', 'unchanged'].includes(result?.outcome)) refuse(result);
      return revisionView(actor, await repo.revision(revision.id));
    },

    async requestProcessing(actor, id, body = {}) {
      const revision = await ownedRevision(actor, id);
      if (photosOnly && needsVideo(revision, await repo.assetsFor([revision.id]))) throw http(503, 'video_processing_unavailable');
      if (!processorAvailable().ok) throw http(503, 'processor_unavailable');
      const result = await repo.rpc('exercise_media_request_processing', { p_actor: actor.coach.id, p_revision_id: revision.id, p_expected_version: requireVersion(body.expected_version) });
      if (result?.outcome !== 'queued') refuse(result);
      if (photosOnly) await processInline(actor, revision.id);
      return revisionView(actor, await repo.revision(revision.id));
    },

    // Explicit recovery (e.g. after a closed tab or a terminated request): an
    // expired lease or a requeued job is processed again as the same version;
    // a live lease is left alone.
    async resumeProcessing(actor, id) {
      const revision = await ownedRevision(actor, id);
      if (photosOnly && revision.status === 'processing') await processInline(actor, revision.id);
      return revisionView(actor, await repo.revision(revision.id));
    },

    async framePreview(actor, id, body = {}) {
      const revision = await ownedRevision(actor, id);
      if (photosOnly) throw http(503, 'video_processing_unavailable');
      const time = body.time_ms;
      if (!Number.isInteger(time) || time < 0) throw http(422, 'invalid_time');
      const video = (await repo.assetsFor([revision.id])).find((a) => a.role === 'source_video');
      if (!video) throw http(422, 'source_video_required');
      if (time >= video.duration_ms) throw http(422, 'time_out_of_range');
      if (!processorAvailable().ok) throw http(503, 'processor_unavailable');
      const dir = store.workDir(`frame-${revision.id}-${now()}`);
      try {
        const output = path.join(dir, 'frame.jpg');
        const container = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' }[video.mime_type];
        await processor.renderFramePreview({ sourcePath: store.pathFor(video.storage_key), facts: { width: video.width, height: video.height }, timeMs: time, outputPath: output, container });
        return await fsp.readFile(output);
      } finally { await store.removeWorkDir(dir); }
    },

    async review(actor, id, body = {}) {
      const revision = await ownedRevision(actor, id);
      const attestation = {
        variant_confirmed: body.variant_confirmed === true, rights_confirmed: body.rights_confirmed === true, content_confirmed: body.content_confirmed === true,
      };
      const result = await repo.rpc('exercise_media_review', { p_actor: actor.coach.id, p_revision_id: revision.id, p_expected_version: requireVersion(body.expected_version), p_attestation: attestation });
      if (result?.outcome !== 'approved') refuse(result);
      return revisionView(actor, await repo.revision(revision.id));
    },

    async publish(actor, exerciseId, body = {}) {
      const id = requireUuid(exerciseId);
      const revisionId = requireUuid(body.revision_id, 'invalid_revision');
      const result = await repo.rpc('exercise_media_publish', { p_actor: actor.coach.id, p_exercise_id: id, p_revision_id: revisionId, p_expected_current_version: requireVersion(body.expected_current_version) });
      if (result?.outcome !== 'published') refuse(result);
      return { current_version: result.current_version, revision: await revisionView(actor, await repo.revision(revisionId)) };
    },

    async archive(actor, id, body = {}) {
      const revisionId = requireUuid(id);
      const expected = body.expected_current_version === undefined || body.expected_current_version === null ? null : requireVersion(body.expected_current_version);
      const result = await repo.rpc('exercise_media_archive', { p_actor: actor.coach.id, p_revision_id: revisionId, p_expected_current_version: expected });
      if (result?.outcome !== 'archived') refuse(result);
      return { archived: true, was_current: Boolean(result.was_current), current_version: result.current_version ?? null };
    },

    async links(user, body = {}) {
      const context = parseContext(body.context);
      const requested = body.assets;
      if (!Array.isArray(requested) || !requested.length || requested.length > LIMITS.links.maxAssets) throw http(400, 'invalid_assets');
      const ids = requested.map((item) => requireUuid(item?.asset_id, 'invalid_asset'));
      const resolved = await resolveContext(repo, user, context);
      if (!resolved) throw http(404, 'not_found');
      const allowed = await allowedAssets(repo, resolved);
      const links = [];
      const missing = [];
      for (const assetId of [...new Set(ids)]) {
        const entry = allowed.get(assetId);
        if (!entry) { missing.push(assetId); continue; }
        const ttlSeconds = ['instruction', 'source_video', 'source_image'].includes(entry.asset.role) ? LIMITS.links.instructionTtlSeconds : LIMITS.links.ttlSeconds;
        const issued = signer.issue({ assetId, revisionId: entry.revisionId, principal: principalOf(user), context, ttlSeconds });
        links.push({ asset_id: assetId, url: `/api/exercise-media/content/${issued.token}`, expires_at: issued.expiresAt });
      }
      return { links, missing };
    },

    async resolve(user, body = {}) {
      const context = parseContext(body.context);
      if (context.type === 'revision') throw http(400, 'invalid_context');
      const resolved = await resolveContext(repo, user, context);
      if (!resolved) throw http(404, 'not_found');
      const map = mediaMap(await repo.bundle([...resolved.exerciseIds]));
      return { media: [...map.values()] };
    },

    async text(user, body = {}) {
      const context = parseContext(body.context);
      const exerciseId = requireUuid(body.exercise_id, 'invalid_exercise');
      const resolved = await resolveContext(repo, user, context);
      if (!resolved || resolved.kind !== 'current' || !resolved.exerciseIds.has(exerciseId)) throw http(404, 'not_found');
      const [item] = await repo.bundle([exerciseId]);
      if (!item) throw http(404, 'not_found');
      const revision = await repo.revision(item.revision_id);
      return { exercise_id: exerciseId, revision_id: item.revision_id, transcript: revision?.transcript || null, caption_language: revision?.caption_language || null, cues: item.cues || [] };
    },

    // Re-authorizes EVERY byte request against current access and version.
    async openContent(token, rangeHeader, { head = false } = {}) {
      const verified = signer.verify(token);
      if (!verified.ok) throw verified.reason === 'expired' ? http(403, 'link_expired') : http(404, 'not_found');
      const { payload } = verified;
      let user = null;
      if (payload.p.k === 'coach') {
        const coach = await repo.coach(payload.p.id);
        if (coach) user = { role: coach.is_admin ? 'admin' : 'coach', coach };
      } else if (payload.p.k === 'client') {
        const client = await repo.client(payload.p.id);
        if (client?.auth_user_id) user = { role: 'client', client };
      }
      if (!user) throw http(404, 'not_found');
      let context;
      try { context = parseContext(payload.c); } catch { throw http(404, 'not_found'); }
      const resolved = await resolveContext(repo, user, context);
      const entry = resolved ? (await allowedAssets(repo, resolved)).get(payload.a) : null;
      if (!entry || entry.revisionId !== payload.r) throw http(404, 'not_found');
      const asset = await repo.asset(payload.a);
      if (!asset || asset.archived || asset.revision_id !== payload.r) throw http(404, 'not_found');
      const { size } = await store.stat(asset.storage_key);
      const range = parseRange(rangeHeader, size);
      if (range === 'unsatisfiable') return { status: 416, size };
      const responseBytes = range ? range.end - range.start + 1 : size;
      if (!head && maxContentBytes && responseBytes > maxContentBytes) throw http(413, 'bounded_range_required');
      const opened = head ? null : await store.open({ key: asset.storage_key, range: range || null });
      const remaining = Math.max(0, Math.min(LIMITS.links.ttlSeconds, payload.e - Math.floor(now() / 1000)));
      return {
        status: range ? 206 : 200, stream: opened?.stream || null, size, range,
        contentType: asset.mime_type === 'text/vtt' ? 'text/vtt; charset=utf-8' : asset.mime_type,
        ext: path.extname(asset.storage_key).slice(1), maxAge: remaining,
      };
    },

    async mediaForExercises(exerciseIds) {
      return mediaMap(await repo.bundle(exerciseIds));
    },
  };
}

module.exports = { createExerciseMediaService, HttpError };
