// Quick-session display helpers shared by coach and client surfaces.
// The server supplies `kind` / `quick_session_completed` on assignments and the safe
// `workout_assignment_kind` enum on logs; these helpers only read them.
import { isPreviewMode } from '@/lib/previewFlag';

export const QUICK_SESSION_LABEL = 'Quick session';

export function isQuickAssignment(assignment) {
  return assignment?.kind === 'quick';
}

// A completed quick session drops off active cards. The underlying assignment is never
// archived, and ordinary active/dated assignments keep their existing behavior.
export function isCompletedQuickSession(assignment) {
  return isQuickAssignment(assignment) && assignment.quick_session_completed === true;
}

export function activeCardAssignments(assignments) {
  return (assignments || []).filter((assignment) => !isCompletedQuickSession(assignment));
}

// History/detail provenance; distinct from `quick_completed` (untracked completion).
export function isQuickSessionLog(log) {
  return log?.workout_assignment_kind === 'quick';
}

// Public environment scope for recovery keys: no secrets, just which backend this is.
export function quickSessionEnvironment() {
  if (isPreviewMode) return 'preview';
  const backend = import.meta.env.REACT_APP_BACKEND_URL || '';
  try {
    return backend ? new URL(backend).host.replace(/[^A-Za-z0-9._-]/g, '_') : 'same-origin';
  } catch {
    return 'same-origin';
  }
}
