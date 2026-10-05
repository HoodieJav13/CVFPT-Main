import { isPreviewMode } from './previewFlag';
import {
  analyticsMode, coachScreen, createCaptureTransport, createCoachTracker, observeSessionSave,
} from './coachAnalyticsCore.js';

const host = import.meta.env.REACT_APP_POSTHOG_HOST || '';
const token = import.meta.env.REACT_APP_POSTHOG_PUBLIC_TOKEN || '';
const mode = analyticsMode({
  allowedBuild: __CVF_POSTHOG_PREVIEW_ALLOWED__, syntheticFixtures: isPreviewMode,
  requestedMode: import.meta.env.REACT_APP_POSTHOG_MODE, host, token,
});
const emit = createCoachTracker({ mode, send: mode === 'local'
  ? (payload) => window.dispatchEvent(new CustomEvent('cvfpt:analytics', { detail: payload }))
  : mode === 'synthetic-preview' ? createCaptureTransport({ host, token }) : undefined,
});

export { coachScreen };

export function observeCoachSessionSave(run, fields) {
  return observeSessionSave(run, fields, emit);
}

export function reportCoachError(pathname, source) {
  const screen = coachScreen(pathname);
  if (screen) emit('$exception', { screen, source, failure_kind: 'unknown' });
}

export function trackCoachScreen(pathname) {
  const screen = coachScreen(pathname);
  if (screen) emit('cvfpt_coach_screen_viewed', { screen });
}

// Scoped to the authenticated coach shell; listeners never inspect Error/Event data.
export function listenForCoachErrors(target, getPathname) {
  if (mode === 'off') return () => {};
  const runtime = () => reportCoachError(getPathname(), 'runtime');
  const rejection = () => reportCoachError(getPathname(), 'unhandled_rejection');
  target.addEventListener('error', runtime);
  target.addEventListener('unhandledrejection', rejection);
  return () => {
    target.removeEventListener('error', runtime);
    target.removeEventListener('unhandledrejection', rejection);
  };
}
