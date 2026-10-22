// Coach-device storage for the shared small-group conductor record.
// Scoped by backend environment and coach, so another coach (or the preview
// demo) on the same browser never resumes this session. Holds no tokens.
import { GROUP_SESSION_VERSION } from './groupSession.js';

export const GROUP_SESSION_PREFIX = 'cvf_group_session:v1:';

export function groupSessionKey({ environment, coachId }) {
  return `${GROUP_SESSION_PREFIX}${environment}:${coachId}`;
}

export function loadGroupSession(storage, scope) {
  try {
    const raw = storage.getItem(groupSessionKey(scope));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.version !== GROUP_SESSION_VERSION || parsed.coachId !== scope.coachId || parsed.environment !== scope.environment) return null;
    return parsed;
  } catch {
    return null;
  }
}

// Returns false when the browser refused the write, so the page can warn
// that a reload would lose unsynced entries.
export function saveGroupSession(storage, scope, session) {
  try {
    storage.setItem(groupSessionKey(scope), JSON.stringify(session));
    return true;
  } catch {
    return false;
  }
}

export function clearGroupSession(storage, scope) {
  try { storage.removeItem(groupSessionKey(scope)); } catch { /* nothing stored */ }
}
