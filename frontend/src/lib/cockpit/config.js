// Coaching cockpit configuration. Every product default the brief left open
// lives here, so a QUESTIONS.md answer is a one-line change. No '@/' imports:
// Node unit tests load these modules directly.

// Q1 (session size): 1 to 3 coaches and up to 12 clients. The backend
// enforces the same limits (backend/src/lib/groupSessionLimits.js, which an
// environment may lower, never raise); GET /group-sessions/:id returns the
// effective limits and the cockpit shows those. These are the defaults.
// The station-rotation mode keeps its own 6-trainee cap (groupSession.js).
export const LIVE_MAX_PARTICIPANTS = 12;
export const REPLAY_MAX_PARTICIPANTS = 12;
export const MAX_COACHES_TARGET = 3;

// The cockpit's inline header button opens and closes the preview toolbar
// through this window event (preview builds only), so no collapsed control
// floats over cockpit content.
export const PREVIEW_CONTROLS_TOGGLE_EVENT = 'cvf-preview-controls-toggle';

// Scoped attention colour for the cockpit and its phone views only. The
// global --gold token (achievement accents) renders as a bright lime-yellow
// on these large surfaces; round-1 feedback ruled that out ("no loud lime").
// A calm warm amber, inside the warm brand band, applied as a CSS variable on
// the cockpit roots: no global token or other page changes.
export const COCKPIT_SCOPE_STYLE = Object.freeze({
  '--attention': '33 55% 60%',
  '--attention-foreground': '30 35% 9%',
});

// Same cadence as the existing participant conductor (ParticipantConductor
// GROUP_REFRESH_SECONDS). There is no live push: the cockpit says "not live".
export const COCKPIT_REFRESH_SECONDS = 5;

// Ten-second coach Undo, the same contract as the rehearsal coach Undo
// (trainingCycleFixtures.js COACH_UNDO_MS) and the correction03 coach model.
// Defined here rather than imported, so the cockpit never depends on the
// rehearsal's modules or storage.
export const COCKPIT_COACH_UNDO_MS = 10_000;

// Heat-map pace rule (TBD, owner-tunable). A participant is "behind" when
// their recorded share of sets trails the share of planned time elapsed since
// they joined by more than PACE_TOLERANCE. Times are always server times.
export const PLANNED_SESSION_MINUTES = 50;
export const PACE_TOLERANCE = 0.15;
// No set recorded for this long while active: worth a look. Round-1 render
// feedback: 6 minutes flagged most of a strength floor (2–3 min rests plus a
// station change) as "quiet", which buried the real items. 10 minutes is the
// default (TBD, owner-tunable).
export const IDLE_AFTER_MS = 10 * 60 * 1000;
// A participant who joined this recently is "just arrived".
export const JUST_ARRIVED_MS = 3 * 60 * 1000;

// Attention ranking weights (higher first). Reasons are always shown, so the
// ranking is explainable; ties break by longest waiting, then name.
export const ATTENTION_WEIGHTS = Object.freeze({
  conflict: 100,
  swap_waiting: 90,
  pain: 85,
  idle: 60,
  swap_review: 55,
  notice: 50,
  behind: 40,
  arrived: 25,
});

export const HEAT_STATES = Object.freeze(['needs_cue', 'behind', 'on_pace', 'done', 'not_started']);
export const HEAT_LABELS = Object.freeze({
  needs_cue: 'Needs a cue',
  behind: 'Behind',
  on_pace: 'On pace',
  done: 'Done',
  not_started: 'Not started',
});

// Q2 (template propagation). Preview only; the coach confirms each client.
// Confirming records a local receipt; it never edits a program (no general
// template-propagation endpoint exists).
export const TEMPLATE_APPLY_MODE = 'preview_only';

// Device-local storage. A distinct namespace: the cockpit never reads or
// writes the rehearsal (cvf_preview_training_cycle:v1:), weekly review
// (cvf_weekly_review_local:v2:), group conductor (cvf_group_session:v1:) or
// workout outbox keys.
export const COCKPIT_NOTES_PREFIX = 'cvf_cockpit_notes:v1:';
export const COCKPIT_RECEIPTS_PREFIX = 'cvf_cockpit_template_receipts:v1:';
