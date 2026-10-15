const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

const RATE_LIMIT_MESSAGE = 'Too many requests. Please try again later.';

function requestKey(req) {
  if (req.user?.authUserId) return `user:${req.user.authUserId}`;
  return `ip:${ipKeyGenerator(req.ip || req.socket?.remoteAddress || '127.0.0.1')}`;
}

function createRateLimiter({ identifier, windowMs, limit, skipSuccessfulRequests = false }) {
  return rateLimit({
    identifier,
    windowMs,
    limit,
    keyGenerator: requestKey,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests,
    handler: (_req, res) => res.status(429).json({ error: RATE_LIMIT_MESSAGE }),
  });
}

const loginLimiter = createRateLimiter({
  identifier: 'auth-login',
  windowMs: 15 * 60 * 1000,
  limit: 15,
  skipSuccessfulRequests: true,
});

const signupLimiter = createRateLimiter({
  identifier: 'auth-signup',
  windowMs: 60 * 60 * 1000,
  limit: 10,
});

const forgotPasswordLimiter = createRateLimiter({
  identifier: 'auth-forgot-password',
  windowMs: 60 * 60 * 1000,
  limit: 5,
});

const resetPasswordLimiter = createRateLimiter({
  identifier: 'auth-reset-password',
  windowMs: 60 * 60 * 1000,
  limit: 10,
});

const changePasswordLimiter = createRateLimiter({
  identifier: 'auth-change-password',
  windowMs: 15 * 60 * 1000,
  limit: 10,
});

const refreshLimiter = createRateLimiter({
  identifier: 'auth-refresh',
  windowMs: 5 * 60 * 1000,
  limit: 30,
  skipSuccessfulRequests: true,
});

const csvImportLimiter = createRateLimiter({
  identifier: 'program-import-csv',
  windowMs: 15 * 60 * 1000,
  limit: 30,
});

const pdfImportLimiter = createRateLimiter({
  identifier: 'program-import-pdf',
  windowMs: 15 * 60 * 1000,
  limit: 5,
});

const programCommitLimiter = createRateLimiter({
  identifier: 'program-import-commit',
  windowMs: 15 * 60 * 1000,
  limit: 20,
});

const clientImportLimiter = createRateLimiter({
  identifier: 'client-roster-import',
  windowMs: 15 * 60 * 1000,
  limit: 10,
});

const libraryImportLimiter = createRateLimiter({
  identifier: 'exercise-library-import',
  windowMs: 15 * 60 * 1000,
  limit: 10,
});

const pdfExportLimiter = createRateLimiter({
  identifier: 'program-export-pdf',
  windowMs: 15 * 60 * 1000,
  limit: 30,
});

const resourceUploadLimiter = createRateLimiter({
  identifier: 'resource-upload-pdf',
  windowMs: 15 * 60 * 1000,
  limit: 10,
});

// Exercise media: 10 admitted uploads per coach per 15 minutes (counted only
// after the draft ownership check), bounded processing/frame requests, and a
// generous link budget that still stops a polling storm.
// Default 10. A bounded override exists only for the owned local harness
// (media is disabled outside the local adapter); it is read per request.
function exerciseMediaUploadsPerWindow(env = process.env) {
  const value = Number.parseInt(env.EXERCISE_MEDIA_UPLOADS_PER_WINDOW, 10);
  return Number.isInteger(value) && value >= 1 && value <= 1000 ? value : 10;
}

const exerciseMediaUploadLimiter = createRateLimiter({
  identifier: 'exercise-media-upload',
  windowMs: 15 * 60 * 1000,
  limit: () => exerciseMediaUploadsPerWindow(),
});

const exerciseMediaProcessLimiter = createRateLimiter({
  identifier: 'exercise-media-process',
  windowMs: 15 * 60 * 1000,
  limit: 30,
});

const exerciseMediaFrameLimiter = createRateLimiter({
  identifier: 'exercise-media-frame-preview',
  windowMs: 15 * 60 * 1000,
  limit: 120,
});

const exerciseMediaLinkLimiter = createRateLimiter({
  identifier: 'exercise-media-links',
  windowMs: 5 * 60 * 1000,
  limit: 300,
});

const telemetryLimiter = createRateLimiter({
  identifier: 'product-telemetry',
  windowMs: 15 * 60 * 1000,
  limit: 300,
});

module.exports = {
  RATE_LIMIT_MESSAGE,
  changePasswordLimiter,
  clientImportLimiter,
  createRateLimiter,
  csvImportLimiter,
  exerciseMediaFrameLimiter,
  exerciseMediaLinkLimiter,
  exerciseMediaProcessLimiter,
  exerciseMediaUploadLimiter,
  exerciseMediaUploadsPerWindow,
  forgotPasswordLimiter,
  resetPasswordLimiter,
  libraryImportLimiter,
  loginLimiter,
  pdfExportLimiter,
  pdfImportLimiter,
  programCommitLimiter,
  refreshLimiter,
  resourceUploadLimiter,
  requestKey,
  signupLimiter,
  telemetryLimiter,
};
