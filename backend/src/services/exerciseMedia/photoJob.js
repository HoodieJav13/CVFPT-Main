// One bounded photo render under a leased job (docs/exercise-guides/design.md).
// Runs synchronously inside the coach's request in photos mode: the job was
// claimed with exercise_media_claim_revision_job, so a terminated request leaves
// a recoverable lease and an authorized resume renders the SAME recipe version
// after it expires. No detached promises, no waitUntil. Failures store safe
// codes only; retryable capacity/deadline/storage outcomes requeue the job.
const { createHash } = require('node:crypto');
const { LIMITS, MediaError, sniffImage, assertImageFacts } = require('../../lib/exerciseMedia/validation');

const RETRYABLE = new Set(['processor_busy', 'processor_timeout', 'processor_unavailable', 'storage_unavailable']);
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

function needsVideo(revision, sources) {
  return sources.some((source) => source.role === 'source_video' && !source.archived)
    || revision.poster_mode === 'video_frame' || revision.preview_start_ms != null
    || revision.end_frame_ms != null || revision.include_instruction;
}

async function runPhotoJob({ repo, store, processor, claim, log = () => {} }) {
  const { job, revision, sources = [] } = claim;
  const started = Date.now();
  try {
    if (needsVideo(revision, sources)) throw new MediaError('video_processing_unavailable');
    const image = sources.find((source) => source.role === 'source_image' && !source.archived);
    if (!image) throw new MediaError('source_image_required');
    if (!revision.poster_crop) throw new MediaError('poster_crop_required');
    const buffer = await store.readObject(image.storage_key, { maxBytes: LIMITS.image.maxBytes });
    if (!buffer) throw new MediaError('source_missing');
    // The stored source must still be exactly the recorded, reviewed bytes.
    if (buffer.length !== Number(image.bytes) || sha256(buffer) !== image.sha256) throw new MediaError('source_mismatch');
    const facts = assertImageFacts(sniffImage(buffer), buffer.length);
    const poster = await processor.renderImage({ buffer, facts, crop: revision.poster_crop });
    const key = `derivatives/${revision.id}/${revision.recipe_version}-poster.jpg`;
    const installed = await store.putObject({ key, buffer: poster.buffer, contentType: 'image/jpeg', maxBytes: LIMITS.poster.maxBytes });
    const manifest = [{
      role: 'poster', storage_key: key, mime_type: 'image/jpeg', bytes: installed.bytes, sha256: installed.sha256,
      width: poster.width, height: poster.height, duration_ms: null, has_audio: null,
    }];
    const result = await repo.rpc('exercise_media_complete_job', { p_job_id: job.id, p_lease_token: job.lease_token, p_assets: manifest, p_processor_version: processor.version });
    log('photo job finished', { job: job.id, outcome: result?.outcome, attempt: job.attempts, ms: Date.now() - started, bytes: installed.bytes });
    return { outcome: result?.outcome, manifest, ms: Date.now() - started };
  } catch (error) {
    const code = error instanceof MediaError ? error.code : 'processing_failed';
    const retryable = RETRYABLE.has(code);
    await repo.rpc('exercise_media_fail_job', { p_job_id: job.id, p_lease_token: job.lease_token, p_error_code: code, p_retryable: retryable }).catch(() => {});
    log('photo job failed', { job: job.id, code, retryable, attempt: job.attempts });
    return { outcome: 'failed', code, retryable };
  }
}

module.exports = { runPhotoJob, needsVideo };
