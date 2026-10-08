import { isPreviewMode } from './previewFlag';
import {
  analyticsMode, coachScreen, createCaptureTransport, createCoachTracker, createCoachVisit, observeSessionSave,
} from './coachAnalyticsCore.js';

const host = import.meta.env.REACT_APP_POSTHOG_HOST || '';
const token = import.meta.env.REACT_APP_POSTHOG_PUBLIC_TOKEN || '';
const mode = analyticsMode({
  allowedBuild: __CVF_POSTHOG_PREVIEW_ALLOWED__, syntheticFixtures: isPreviewMode,
  productionBuild: __CVF_POSTHOG_PRODUCTION_ALLOWED__,
  requestedMode: import.meta.env.REACT_APP_POSTHOG_MODE, host, token,
});
const visit = createCoachVisit();
const getContext = () => coachScreen(globalThis.window?.location?.pathname)
  ? visit.getContext(mode) : null;
const emit = createCoachTracker({ mode, send: mode === 'local'
  ? (payload) => window.dispatchEvent(new CustomEvent('cvfpt:analytics', { detail: payload }))
  : mode === 'synthetic-preview' || mode === 'production-coach'
    ? createCaptureTransport({ host, token, getContext }) : undefined,
  getContext,
});

export { coachScreen };
export function setCoachAnalyticsRole(role) { visit.setRole(role); }

export function observeCoachSessionSave(run, fields) {
  const started = getContext();
  return observeSessionSave(run, fields, (event, properties) => {
    const current = getContext();
    // A delayed result must not be attributed to a new login/role/visit.
    if (started && current && started.generation === current.generation
      && started.distinctId === current.distinctId) emit(event, properties);
  });
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
  if (!getContext()) return () => {};
  const runtime = () => reportCoachError(getPathname(), 'runtime');
  const rejection = () => reportCoachError(getPathname(), 'unhandled_rejection');
  target.addEventListener('error', runtime);
  target.addEventListener('unhandledrejection', rejection);
  return () => {
    target.removeEventListener('error', runtime);
    target.removeEventListener('unhandledrejection', rejection);
  };
}
