// Sentry loads dynamically and only when a DSN is configured, so the SDK
// costs the bundle nothing in dev/preview or for deploys without an account.
// Errors only — no tracing, no replay, no PII.
const DSN = import.meta.env.REACT_APP_SENTRY_DSN || '';

let sentryRef = null;

export function initErrorReporting() {
  if (!DSN) return;
  import('@sentry/react')
    .then((Sentry) => {
      Sentry.init({
        dsn: DSN,
        environment: import.meta.env.MODE,
        sendDefaultPii: false,
        tracesSampleRate: 0,
      });
      sentryRef = Sentry;
    })
    .catch(() => {});
}

export function reportError(error) {
  if (sentryRef) {
    try {
      sentryRef.captureException(error);
    } catch {
      // Reporting must never take the app down with it.
    }
  }
}
