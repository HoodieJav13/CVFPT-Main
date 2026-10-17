// Persisted local media worker. Claims one job at a time with a lease, renders
// derivatives with the real processor, installs them under deterministic keys,
// and only then asks the database to mark the revision ready. A crash leaves
// the lease to expire; the next claim is a new attempt of the SAME job, never a
// duplicate revision. Failures store safe codes only.
const fsp = require('node:fs/promises');
const path = require('node:path');
const { LIMITS, MediaError, sniffImage, captionsToWebVtt } = require('../../lib/exerciseMedia/validation');

const CONTAINERS = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' };
const EXT = { poster: 'jpg', end_frame: 'jpg', preview: 'mp4', instruction: 'mp4', captions: 'vtt' };
const MAX_BYTES = { poster: LIMITS.poster.maxBytes, end_frame: LIMITS.poster.maxBytes, preview: LIMITS.preview.maxBytes, instruction: LIMITS.instruction.maxBytes, captions: LIMITS.captions.maxVttBytes };
const RETRYABLE = new Set(['processor_timeout', 'processor_unavailable']);

const sleep = (ms, signal) => new Promise((resolve) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
});

class MediaWorker {
  constructor({ repo, store, processor, label = 'local-worker', leaseSeconds = 120, pollMs = 1000, log = () => {} }) {
    Object.assign(this, { repo, store, processor, label, leaseSeconds, pollMs, log });
  }

  // Finish uploads interrupted between their DB row and the final rename, then
  // sweep expired quarantine parts and stale scratch directories.
  // A staged part whose asset row exists is committed source bytes: it is
  // installed (verified against the recorded size/hash) or, if that fails or
  // the row cannot be read, kept out of the age-based sweep.
  async recover({ olderThanMs = 60 * 60 * 1000 } = {}) {
    let recovered = 0;
    const keep = new Set();
    for (const uploadId of await this.store.listStagedUploads()) {
      let asset;
      try { asset = await this.repo.asset(uploadId); } catch { keep.add(uploadId); continue; }
      if (!asset) continue;
      try {
        const { installed } = await this.store.commitUpload(uploadId, asset.storage_key, { bytes: asset.bytes, sha256: asset.sha256 });
        if (installed) recovered += 1;
      } catch (error) {
        keep.add(uploadId);
        this.log('source recovery deferred', { asset: uploadId, code: error.code || 'error' });
      }
    }
    const swept = await this.store.removeTemporary({ olderThanMs, keep });
    return { recovered, ...swept };
  }

  async runOnce() {
    const claim = await this.repo.rpc('exercise_media_claim_job', { p_worker: this.label, p_lease_seconds: this.leaseSeconds });
    if (claim?.outcome !== 'claimed') return null;
    return this.process(claim);
  }

  async process({ job, revision, sources }) {
    const dir = this.store.workDir(`job-${job.id}-a${job.attempts}`);
    const heartbeat = setInterval(() => {
      this.repo.rpc('exercise_media_extend_lease', { p_job_id: job.id, p_lease_token: job.lease_token, p_lease_seconds: this.leaseSeconds }).catch(() => {});
    }, Math.max(1000, (this.leaseSeconds * 1000) / 3));
    const started = Date.now();
    try {
      const outputs = await this.render(revision, sources, dir);
      const manifest = [];
      for (const output of outputs) {
        const key = `derivatives/${revision.id}/${revision.recipe_version}-${output.role}.${EXT[output.role]}`;
        const installed = await this.store.putFile({ key, sourcePath: output.path, maxBytes: MAX_BYTES[output.role] });
        manifest.push({
          role: output.role, storage_key: key, mime_type: output.mime_type, bytes: installed.bytes, sha256: installed.sha256,
          width: output.width ?? null, height: output.height ?? null, duration_ms: output.duration_ms ?? null,
          has_audio: output.role === 'preview' ? false : (output.has_audio ?? null),
        });
      }
      const result = await this.repo.rpc('exercise_media_complete_job', { p_job_id: job.id, p_lease_token: job.lease_token, p_assets: manifest, p_processor_version: this.processor.version });
      this.log('job finished', { job: job.id, outcome: result?.outcome, attempt: job.attempts, ms: Date.now() - started, outputs: manifest.map((m) => `${m.role}:${m.bytes}`) });
      return { outcome: result?.outcome, manifest, ms: Date.now() - started };
    } catch (error) {
      const code = error instanceof MediaError ? error.code : 'processing_failed';
      const retryable = RETRYABLE.has(code);
      await this.repo.rpc('exercise_media_fail_job', { p_job_id: job.id, p_lease_token: job.lease_token, p_error_code: code, p_retryable: retryable }).catch(() => {});
      this.log('job failed', { job: job.id, code, retryable, attempt: job.attempts });
      return { outcome: 'failed', code };
    } finally {
      clearInterval(heartbeat);
      await this.store.removeWorkDir(dir).catch(() => {});
    }
  }

  async render(revision, sources, dir) {
    const image = sources.find((s) => s.role === 'source_image');
    const video = sources.find((s) => s.role === 'source_video');
    for (const source of [image, video].filter(Boolean)) {
      if (!(await this.store.exists(source.storage_key))) throw new MediaError('source_missing');
    }
    const outputs = [];
    if (revision.poster_mode === 'uploaded_image') {
      if (!image) throw new MediaError('source_image_required');
      const sourcePath = this.store.pathFor(image.storage_key);
      const facts = sniffImage(await this.store.readHead(sourcePath, LIMITS.request.sniffBytes));
      const outputPath = path.join(dir, 'poster.jpg');
      outputs.push({ role: 'poster', path: outputPath, ...(await this.processor.renderImage({ sourcePath, facts, crop: revision.poster_crop, outputPath })) });
    }
    if (video) {
      const container = CONTAINERS[video.mime_type];
      const sourcePath = this.store.pathFor(video.storage_key);
      // Re-probe: the stored facts are a hint; the processor is authoritative.
      const facts = await this.processor.probe({ sourcePath, container });
      outputs.push(...(await this.processor.renderVideo({ sourcePath, facts, outputDir: dir, recipe: revision, container })));
    }
    if (revision.include_instruction && Array.isArray(revision.caption_cues) && revision.caption_cues.length) {
      const vtt = captionsToWebVtt(revision.caption_cues, revision.caption_language);
      const file = path.join(dir, 'captions.vtt');
      await fsp.writeFile(file, vtt, { mode: 0o600 });
      outputs.push({ role: 'captions', path: file, mime_type: 'text/vtt', bytes: Buffer.byteLength(vtt) });
    }
    return outputs;
  }

  async loop({ signal } = {}) {
    while (!signal?.aborted) {
      let busy = false;
      try { busy = Boolean(await this.runOnce()); } catch (error) { this.log('claim error', { code: error?.code || 'unknown' }); }
      if (!busy) await sleep(this.pollMs, signal);
    }
  }
}

module.exports = { MediaWorker };
