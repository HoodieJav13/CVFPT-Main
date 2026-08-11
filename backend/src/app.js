const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const Sentry = require('@sentry/node');
const { corsConfiguration, createCorsOriginCheck } = require('./config/cors');
const { requestObservability } = require('./middleware/requestObservability');
const { logError } = require('./utils/logger');
const { configured: emailConfigured } = require('./services/email');

// Inert without a DSN — local dev and CI need no Sentry account. The PII
// discipline from utils/logger.js carries over: no request bodies, headers,
// or user-supplied values leave the server.
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend(event) {
      if (event.request) {
        event.request = { method: event.request.method };
      }
      return event;
    },
  });
}

const isProduction = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
if (isProduction && !emailConfigured()) {
  // Every notification (invites, resets, booking emails, digest) silently
  // no-ops without these vars — make that state loud in the deploy logs.
  console.error('WARNING: email delivery is unconfigured in production — set RESEND_API_KEY, NOTIFY_REPLY_TO, and FRONTEND_URL');
}

const app = express();
const corsConfig = corsConfiguration(process.env);

// Vercel places one trusted proxy hop in front of the Express function.
// A numeric hop count prevents clients from selecting an arbitrary left-most IP.
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({
  origin: createCorsOriginCheck(corsConfig.origins),
  credentials: corsConfig.credentials,
}));

// Capture raw body for Stripe webhook signature verification
app.use(express.json({
  limit: '2mb',
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));
app.use(requestObservability);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'cvf-pt-api' });
});

// Cron authentication lives inside this router. It must be mounted before
// authenticated or parameterized application routes.
app.use('/api/internal', require('./routes/internal').router);

app.use('/api/auth', require('./routes/auth'));
app.use('/api/clients', require('./routes/clients'));
app.use('/api/sessions', require('./routes/sessions'));
app.use('/api/progress', require('./routes/progress'));
app.use('/api/check-ins', require('./routes/checkins'));
app.use('/api/programs', require('./routes/programs'));
app.use('/api/resources', require('./routes/resources'));
app.use('/api/resource-categories', require('./routes/resourceCategories'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/waivers', require('./routes/waivers'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/workout-logs', require('./routes/workoutLogs'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/email-preferences', require('./routes/emailPreferences'));
app.use('/api/availability', require('./routes/availability'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/telemetry', require('./routes/telemetry').router);
app.use('/api/announcements', require('./routes/announcements'));

// Unknown routes answer JSON, not Express's default HTML page.
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// Terminal safety net. Route handlers catch their own errors, so this mostly
// sees body-parser failures — but any future uncaught route error gets a
// masked JSON 500 instead of hanging or leaking an HTML stack page.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large' });
  }
  if (err?.type === 'entity.parse.failed' || err?.status === 400) {
    return res.status(400).json({ error: 'Invalid request body' });
  }
  logError('unhandled request error', err);
  return res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
