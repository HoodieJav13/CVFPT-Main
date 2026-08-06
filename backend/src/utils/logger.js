function safeCode(value) {
  const text = typeof value === 'string' ? value : '';
  return /^[A-Za-z0-9_.-]{1,64}$/.test(text) ? text : undefined;
}

function safeStatus(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 400 && number <= 599 ? number : undefined;
}

function logError(context, error) {
  const metadata = {
    name: safeCode(error?.name),
    code: safeCode(error?.code),
    status: safeStatus(error?.status || error?.statusCode),
  };
  const safeMetadata = Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined));
  console.error(String(context || 'application error'), safeMetadata);

  // Routes catch their own errors and report through this chokepoint, so
  // Sentry capture belongs here — an Express error handler would see almost
  // nothing. Inert without SENTRY_DSN. The console line above stays
  // redacted; Sentry receives the exception with beforeSend scrubbing
  // (configured in app.js) and never request bodies or headers.
  if (process.env.SENTRY_DSN) {
    try {
      // eslint-disable-next-line global-require
      const Sentry = require('@sentry/node');
      Sentry.captureException(error instanceof Error ? error : new Error(String(context || 'application error')), {
        tags: { context: String(context || 'application error').slice(0, 100) },
      });
      if (process.env.VERCEL) {
        // eslint-disable-next-line global-require
        const { waitUntil } = require('@vercel/functions');
        waitUntil(Sentry.flush(2000).catch(() => {}));
      }
    } catch {
      // Reporting must never break the request path.
    }
  }
}

module.exports = { logError };
