// Coach-device storage for the shared small-group conductor record.
// Scoped by backend environment and coach, so another coach (or the preview
// demo) on the same browser never resumes this session. Holds no tokens.
import { GROUP_SESSION_VERSION } from './groupSession.js';

export const GROUP_SESSION_PREFIX = 'cvf_group_session:v1:';

export function groupSessionKey({ environment, coachId }) {
  return `${GROUP_SESSION_PREFIX}${environment}:${coachId}`;
}

function readEntry(storage, scope) {
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

// The session as this device last stored it. The mirror bookkeeping kept in
// the same entry (`_mirror`) is never part of the session.
export function loadGroupSession(storage, scope) {
  const entry = readEntry(storage, scope);
  if (!entry) return null;
  const { _mirror: _bookkeeping, ...session } = entry;
  return session;
}

// The session and its raw mirror bookkeeping from ONE read of the stored
// entry, so they always describe the same write (another tab may store a
// newer entry between two separate reads). The bookkeeping is validated by
// groupMirror.restoreMirrorState before any use.
export function loadGroupSessionEntry(storage, scope) {
  const entry = readEntry(storage, scope);
  if (!entry) return { session: null, meta: null };
  const { _mirror: meta = null, ...session } = entry;
  return { session, meta };
}

// The raw mirror bookkeeping stored with that session, or null. It is
// validated by groupMirror.restoreMirrorState before any use.
export function loadMirrorMeta(storage, scope, session) {
  const entry = readEntry(storage, scope);
  if (!entry || !session || entry.id !== session.id) return null;
  return entry._mirror ?? null;
}

// Stores the session and (when given) its mirror bookkeeping in ONE write, so
// they can never disagree after a reload. Returns false when the browser
// refused the write, so the page can warn that a reload would lose unsynced
// entries.
export function saveGroupSession(storage, scope, session, mirrorMeta) {
  try {
    storage.setItem(groupSessionKey(scope), JSON.stringify(mirrorMeta ? { ...session, _mirror: mirrorMeta } : session));
    return true;
  } catch {
    return false;
  }
}

export function clearGroupSession(storage, scope) {
  try { storage.removeItem(groupSessionKey(scope)); } catch { /* nothing stored */ }
}
