// /api/exercise-media — owned exercise media. Default photos mode: identifying
// photo + cues through direct-upload grants and inline leased processing; the
// explicit full-local mode keeps stills, short preview and separate full
// instruction video. Fail-closed: disabled unless the local adapter or hosted-photo opt-in is
// explicitly configured (lib/exerciseMedia/config.js). Every mutation uses
// the server actor; uploads are refused before any byte is accepted unless the
// actor owns the draft (or is admin); bytes reach browsers only through the
// capability content route, which re-authorizes on every request.
const express = require('express');
const multer = require('multer');
const { pipeline } = require('node:stream');
const { logError } = require('../utils/logger');
const { MediaError, LIMITS } = require('../lib/exerciseMedia/validation');
const { HttpError } = require('../lib/exerciseMedia/service');

const MESSAGES = {
  media_unavailable: 'Exercise media is not available in this environment.',
  processor_unavailable: 'Media processing is unavailable right now. Your draft is kept; try again later.',
  not_found: 'Not found.',
  forbidden: 'You do not have access to this media.',
  stale: 'This was changed elsewhere. Reload to see the latest version.',
  revision_processing: 'This draft is processing. Wait for it to finish.',
  published_immutable: 'Published guides cannot be edited. Start a new draft instead.',
  request_mismatch: 'This request was already used for different content.',
  replace_requires_admin: 'Another coach owns the current guide. An admin must approve replacing it.',
  not_ready: 'Process and review this draft before publishing.',
  attestation_required: 'Confirm the exact variant, rights and content before approving.',
  alt_text_required: 'Describe the image in alt text before approving or publishing.',
  end_frame_incomplete: 'Describe the end still in alt text before approving or publishing.',
  captions_required: 'Narrated instruction needs captions and a transcript before review.',
  file_too_large: 'That file is too large.',
  link_expired: 'This media link expired. Retry to refresh it.',
  rate_limited: 'Too many requests. Please try again later.',
  video_sources_disabled: 'Video uploads are off here. Upload a photo, or choose a still from a clip on your device.',
  video_processing_unavailable: 'This draft needs video processing, which is off here. Use a photo instead.',
  upload_incomplete: 'The photo has not finished uploading. Try the upload again.',
  upload_size_mismatch: 'The uploaded file did not match what was selected. Choose the file again.',
  upload_abandoned: 'That upload was cancelled. Start a new upload.',
  staging_conflict: 'A different file was already sent for this upload. Start a new upload.',
  grant_expired: 'The upload link expired. Start the upload again.',
  invalid_grant: 'Not found.',
  processor_busy: 'Photo processing is busy. Try again in a moment.',
  processor_timeout: 'Photo processing took too long. Try again, or use a smaller photo.',
  storage_unavailable: 'Media storage is unavailable right now. Your draft is kept; try again later.',
  upload_grant_required: 'Upload this photo using a direct upload grant.',
  bounded_range_required: 'Read this source photo in bounded ranges.',
  source_mismatch: 'The stored photo no longer matches what was uploaded. Upload it again.',
};
const STAGING_TYPES = new Set(LIMITS.image.mimes);
const message = (code) => MESSAGES[code] || 'This media request could not be completed.';

function sendError(res, error) {
  if (error instanceof HttpError) return res.status(error.status).json({ error: message(error.code), code: error.code, ...error.extra });
  if (error instanceof MediaError) return res.status(error.status).json({ error: message(error.code), code: error.code });
  if (error?.code === 'invalid_context') return res.status(400).json({ error: 'Invalid media context.', code: 'invalid_context' });
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: message('file_too_large'), code: 'file_too_large' });
    return res.status(400).json({ error: 'Invalid upload.', code: 'invalid_upload' });
  }
  if (error?.code === '22P02' || error?.code === '23514') return res.status(400).json({ error: 'Invalid media request.', code: 'invalid_request' });
  logError('exercise media request error', error);
  return res.status(500).json({ error: 'Exercise media request failed. Try again.', code: 'media_request_failed' });
}

const wrap = (handler) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (error) {
    if (!res.headersSent) sendError(res, error);
    else res.destroy();
  }
};

// Read-only discovery the coach library calls on every visit. While media is
// disabled these answer 200 { enabled: false } (still auth- and coach-gated),
// so an environment without media logs no 5xx; every other route fails closed.
const DISCOVERY = new Set(['/capabilities', '/library-status']);

function createExerciseMediaRouter({ getRuntime, requireAuth, requireCoach, limiters }) {
  const router = express.Router();

  router.use((req, res, next) => {
    const runtime = getRuntime();
    if (!runtime && !(req.method === 'GET' && DISCOVERY.has(req.path))) return res.status(503).json({ error: message('media_unavailable'), code: 'media_unavailable' });
    req.media = runtime;
    return next();
  });

  // Capability content: no bearer header (img/video elements cannot send one);
  // the signed token names principal+context and is re-authorized here.
  router.get('/content/:capability', wrap(async (req, res) => {
    const result = await req.media.service.openContent(req.params.capability, req.headers.range, { head: req.method === 'HEAD' });
    res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'bytes', 'Access-Control-Expose-Headers': 'Content-Range' });
    if (result.status === 416) {
      res.set('Content-Range', `bytes */${result.size}`);
      return res.status(416).end();
    }
    res.set({
      'Content-Type': result.contentType,
      'Content-Disposition': `inline; filename="exercise-media.${result.ext}"`,
      'Cache-Control': `private, max-age=${result.maxAge}`,
      'Content-Length': String(result.range ? result.range.end - result.range.start + 1 : result.size),
    });
    if (result.range) res.set('Content-Range', `bytes ${result.range.start}-${result.range.end}/${result.size}`);
    res.status(result.status);
    if (req.method === 'HEAD') { result.stream?.destroy(); return res.end(); }
    // pipeline releases the opened file if the client already left (for
    // example while this request was being re-authorized) or leaves mid-body;
    // a stalled, unreleased file handle is fatal on current Node runtimes.
    if (res.destroyed || req.destroyed) { result.stream.destroy(); return undefined; }
    return pipeline(result.stream, res, () => {});
  }));

  // Local direct-upload target (the hosted adapter uses the provider's signed
  // upload URL instead). Authorized by its short-lived grant alone, like a
  // signed upload URL: no bearer session, one app-issued staging key, bounded
  // size, image content types only, never overwriting. Bytes stay unpublished
  // until an authorized finalize re-verifies them.
  router.put('/staging/:grant', wrap(async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    const store = req.media.store;
    if (typeof store.verifyUploadGrant !== 'function') return res.status(404).json({ error: 'Not found', code: 'not_found' });
    const grant = store.verifyUploadGrant(req.params.grant);
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!STAGING_TYPES.has(type)) throw new MediaError('unsupported_image_type');
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > grant.maxBytes) throw new MediaError('file_too_large');
    const result = await store.receiveStaged({ key: grant.key, stream: req, maxBytes: grant.maxBytes });
    return res.status(result.status === 'stored' ? 201 : 200).json({ status: result.status, bytes: result.bytes });
  }));

  router.use(requireAuth);
  const noStore = (_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); };
  router.use(noStore);

  router.get('/capabilities', requireCoach, wrap(async (req, res) => {
    if (!req.media) return res.json({ enabled: false, processing_available: false });
    return res.json({ enabled: true, ...req.media.service.capabilities() });
  }));
  router.get('/library-status', requireCoach, wrap(async (req, res) => {
    if (!req.media) return res.json({ enabled: false, items: [], summary: null });
    return res.json({ enabled: true, ...await req.media.service.libraryStatus(req.user) });
  }));
  router.post('/exercises/:exerciseId/drafts', requireCoach, wrap(async (req, res) => {
    const result = await req.media.service.createDraft(req.user, req.params.exerciseId, req.body);
    res.status(result.status).json(result.body);
  }));
  router.get('/exercises/:exerciseId/revisions', requireCoach, wrap(async (req, res) => res.json(await req.media.service.listRevisions(req.user, req.params.exerciseId, req.query))));
  router.get('/revisions/:id', requireCoach, wrap(async (req, res) => res.json(await req.media.service.getRevision(req.user, req.params.id))));

  router.post('/revisions/:id/sources', requireCoach, wrap(async (req, res) => {
    const role = req.query.role;
    const maxBytes = role === 'source_image' ? LIMITS.image.maxBytes : LIMITS.video.maxBytes;
    // Authorization and ownership BEFORE reading any upload bytes.
    const revision = await req.media.service.prepareUpload(req.user, req.params.id, role);
    if (!String(req.headers['content-type'] || '').startsWith('multipart/form-data')) throw new HttpError(400, 'invalid_upload');
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes + 64 * 1024) throw new MediaError('file_too_large');
    await new Promise((resolve, reject) => limiters.upload(req, res, (error) => (error ? reject(error) : resolve())));
    if (res.headersSent) return undefined;
    const store = req.media.store;
    const upload = multer({
      storage: {
        _handleFile(request, file, callback) {
          store.stageUpload({ stream: file.stream, maxBytes }).then((staged) => {
            request.mediaStaged = staged;
            callback(null, { size: staged.bytes });
          }).catch(callback);
        },
        _removeFile(request, _file, callback) {
          const staged = request.mediaStaged;
          request.mediaStaged = null;
          if (!staged) return callback(null);
          return store.discardUpload(staged.uploadId).then(() => callback(null), () => callback(null));
        },
      },
      limits: { fileSize: maxBytes, files: LIMITS.request.maxFiles, fields: LIMITS.request.maxFields, fieldSize: LIMITS.request.maxFieldBytes, parts: LIMITS.request.maxParts, fieldNameSize: 64 },
    }).single('file');
    await new Promise((resolve, reject) => upload(req, res, (error) => (error ? reject(error) : resolve())));
    if (!req.mediaStaged || !req.file) throw new HttpError(400, 'file_required');
    const result = await req.media.service.attachSource(req.user, revision, role, req.mediaStaged, { ...req.body, original_name: req.file.originalname });
    return res.status(result.status).json(result.body);
  }));

  // Photo direct-upload transport: durable intent + grant, then authorized finalize.
  router.post('/revisions/:id/uploads', requireCoach, wrap(async (req, res) => {
    await new Promise((resolve, reject) => limiters.upload(req, res, (error) => (error ? reject(error) : resolve())));
    if (res.headersSent) return undefined;
    const result = await req.media.service.issueUpload(req.user, req.params.id, req.body);
    return res.status(result.replayed ? 200 : 201).json(result);
  }));
  router.post('/revisions/:id/uploads/:intentId/finalize', requireCoach, wrap(async (req, res) => {
    const result = await req.media.service.finalizeUpload(req.user, req.params.id, req.params.intentId, req.body);
    return res.status(result.status).json(result.body);
  }));
  router.post('/revisions/:id/uploads/:intentId/abandon', requireCoach, wrap(async (req, res) => res.json(await req.media.service.abandonUpload(req.user, req.params.id, req.params.intentId))));
  router.post('/revisions/:id/process/resume', requireCoach, limiters.process, wrap(async (req, res) => res.json(await req.media.service.resumeProcessing(req.user, req.params.id))));

  router.post('/revisions/:id/sources/remove', requireCoach, wrap(async (req, res) => res.json(await req.media.service.removeSource(req.user, req.params.id, req.body))));
  router.patch('/revisions/:id/recipe', requireCoach, wrap(async (req, res) => res.json(await req.media.service.updateRecipe(req.user, req.params.id, req.body))));
  router.post('/revisions/:id/process', requireCoach, limiters.process, wrap(async (req, res) => res.json(await req.media.service.requestProcessing(req.user, req.params.id, req.body))));
  router.post('/revisions/:id/frame-preview', requireCoach, limiters.frame, wrap(async (req, res) => {
    const bytes = await req.media.service.framePreview(req.user, req.params.id, req.body);
    res.set({ 'Content-Type': 'image/jpeg', 'Content-Disposition': 'inline; filename="frame-preview.jpg"' });
    res.send(bytes);
  }));
  router.post('/revisions/:id/review', requireCoach, wrap(async (req, res) => res.json(await req.media.service.review(req.user, req.params.id, req.body))));
  router.post('/exercises/:exerciseId/publish', requireCoach, wrap(async (req, res) => res.json(await req.media.service.publish(req.user, req.params.exerciseId, req.body))));
  router.post('/revisions/:id/archive', requireCoach, wrap(async (req, res) => res.json(await req.media.service.archive(req.user, req.params.id, req.body))));

  // Any authenticated actor; authorization is the named workout context.
  router.post('/links', limiters.links, wrap(async (req, res) => res.json(await req.media.service.links(req.user, req.body))));
  router.post('/resolve', limiters.links, wrap(async (req, res) => res.json(await req.media.service.resolve(req.user, req.body))));
  router.post('/text', limiters.links, wrap(async (req, res) => res.json(await req.media.service.text(req.user, req.body))));

  router.use((_req, res) => res.status(404).json({ error: 'Not found', code: 'not_found' }));
  return router;
}

// ----- Default wiring (real auth + the shared lazily-built runtime) ----------
const { defaultRuntime } = require('../lib/exerciseMedia/runtime');

function defaultRouter() {
  const { requireAuth, requireCoach } = require('../middleware/auth');
  const { exerciseMediaUploadLimiter, exerciseMediaProcessLimiter, exerciseMediaFrameLimiter, exerciseMediaLinkLimiter } = require('../middleware/rateLimits');
  return createExerciseMediaRouter({
    getRuntime: defaultRuntime,
    requireAuth,
    requireCoach,
    limiters: { upload: exerciseMediaUploadLimiter, process: exerciseMediaProcessLimiter, frame: exerciseMediaFrameLimiter, links: exerciseMediaLinkLimiter },
  });
}

module.exports = defaultRouter();
module.exports.createExerciseMediaRouter = createExerciseMediaRouter;
module.exports.defaultRuntime = defaultRuntime;
