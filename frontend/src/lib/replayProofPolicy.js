// Offline proposal only. Deliberately not imported by the application and no SDK is installed.
// Options were checked against PostHog docs on 2026-10-05; a future pinned SDK must
// pass raw-packet inspection locally before ANY cloud recording is permitted.
export const REPLAY_PROOF_POLICY = Object.freeze({
  projectId: 509463,
  maxSessions: 1,
  maxDurationMs: 120000,
  maxBytes: 2 * 1024 * 1024,
  allowedPaths: Object.freeze(['/coach', '/coach/sessions', '/coach/programs', '/coach/resources']),
  options: Object.freeze({
    autocapture: false, rageclick: false, capture_pageview: false, capture_pageleave: false,
    capture_exceptions: false, disable_session_recording: true,
    enable_recording_console_log: false, capture_performance: false,
    disable_persistence: true, person_profiles: 'never',
    opt_out_capturing_by_default: true,
    // Ordinary SDK events are discarded; snapshot packets still need independent local inspection.
    before_send: () => null,
    session_recording: Object.freeze({
      maskAllInputs: true, maskTextSelector: '*', maskAllElementAttributes: true,
      // Keep only shell geometry/navigation; page data, portals and media are blocked.
      blockSelector: 'main, [role="dialog"], [role="listbox"], [role="menu"], img, svg, canvas, video, audio, iframe, [data-testid="user-menu-trigger"]',
      recordCanvas: false, recordCrossOriginIframes: false,
      recordHeaders: false, recordBody: false, recordPerformance: false,
      maskCapturedNetworkRequestFn: () => undefined,
    }),
  }),
});

// Eligibility for a FUTURE test runner; this does not initialize or start replay.
// Route rejection must occur before SPA navigation. Stopping after a URL change
// risks capturing one sensitive snapshot, so a recording must be destroyed first.
export function eligibleReplayProof({ approved, fixturesOnly, production, origin, allowedOrigin, pathname, search = '', hash = '', sessionsUsed = 0, elapsedMs = 0, bytes = 0 }) {
  if (!approved || !fixturesOnly || production || !allowedOrigin || origin !== allowedOrigin
      || search || hash || !REPLAY_PROOF_POLICY.allowedPaths.includes(pathname)) return false;
  try {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;
    if (url.hostname === 'app.corevaluefit.com') return false;
  } catch { return false; }
  return Number.isInteger(sessionsUsed) && sessionsUsed === 0
    && Number.isFinite(elapsedMs) && elapsedMs >= 0 && elapsedMs < REPLAY_PROOF_POLICY.maxDurationMs
    && Number.isFinite(bytes) && bytes >= 0 && bytes < REPLAY_PROOF_POLICY.maxBytes;
}
