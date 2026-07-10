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

module.exports = {
  RATE_LIMIT_MESSAGE,
  createRateLimiter,
  csvImportLimiter,
  libraryImportLimiter,
  loginLimiter,
  pdfExportLimiter,
  pdfImportLimiter,
  programCommitLimiter,
  refreshLimiter,
  requestKey,
  signupLimiter,
};
