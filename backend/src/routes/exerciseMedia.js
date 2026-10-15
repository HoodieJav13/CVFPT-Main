// /api/exercise-media — owned exercise media (photo, stills, short preview,
// separate full instruction). Fail-closed: disabled unless the LOCAL adapter
// is explicitly configured (lib/exerciseMedia/config.js). Every mutation uses
// the server actor; uploads are refused before any byte is accepted unless the
// actor owns the draft (or is admin); bytes reach browsers only through the
// capability content route, which re-authorizes on every request.
const express = require('express');
const multer = require('multer');
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
  captions_required: 'Narrated instruction needs captions and a transcript before review.',
  file_too_large: 'That file is too large.',
  link_expired: 'This media link expired. Retry to refresh it.',
  rate_limited: 'Too many requests. Please try again later.',
};
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

function createExerciseMediaRouter({ getRuntime, requireAuth, requireCoach, limiters }) {
  const router = express.Router();

  router.use((req, res, next) => {
    const runtime = getRuntime();
    if (!runtime) return res.status(503).json({ error: message('media_unavailable'), code: 'media_unavailable' });
    req.media = runtime;
    return next();
  });

  // Capability content: no bearer header (img/video elements cannot send one);
  // the signed token names principal+context and is re-authorized here.
  router.get('/content/:capability', wrap(async (req, res) => {
    const result = await req.media.service.openContent(req.params.capability, req.headers.range);
    res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'bytes' });
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
    if (req.method === 'HEAD') { result.stream.destroy(); return res.end(); }
    result.stream.on('error', () => res.destroy());
    req.on('close', () => result.stream.destroy());
    return result.stream.pipe(res);
  }));

  router.use(requireAuth);
  const noStore = (_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); };
  router.use(noStore);

  router.get('/capabilities', requireCoach, wrap(async (req, res) => res.json(req.media.service.capabilities())));
  router.get('/library-status', requireCoach, wrap(async (req, res) => res.json(await req.media.service.libraryStatus(req.user))));
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
