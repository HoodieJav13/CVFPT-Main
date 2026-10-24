// Coach-account mirror of a station session (pt-session-events/v1 §4), kept
// apart from the page so its timing rules can be tested directly.
//
// One mirror state per session id. Updates for a session go one at a time; a
// change made while one is in flight is sent next. A request whose outcome is
// unknown (no answer, or a transient 5xx/408/429) is kept exactly as sent and
// re-sent first, unchanged, before any newer copy: a create replays by id, an
// update with its original base revision either applies or meets a conflict
// carrying exactly what it sent (its earlier attempt committed). Only then is
// the newest local copy sent, from the confirmed revision. A conflict that
// carries a different copy is another coach device's change and is adopted by
// the caller's existing policy, which keeps this device's unsaved entries.
// Transient failures retry on their own with bounded backoff; refused
// requests (other 4xx) are never repeated automatically.
//
// Durable provenance: the confirmed revision and any unanswered request are
// stored with the session in the same storage write (ctx.persist), BEFORE a
// request is sent and again when its answer is applied, so a reload resumes
// exactly where it stopped. A session stored without that bookkeeping
// ("legacy") cannot tell whether a different account copy is this device's
// older copy or another device's newer one: both are kept, nothing is sent,
// and the page asks for an explicit choice (resolveDivergence).

import { sameSessionState } from './groupSession.js';

export const MIRROR_DEBOUNCE_MS = 600;
export const MIRROR_PASS_LIMIT = 5;
export const MIRROR_RETRY = { firstDelayMs: 2000, maxDelayMs: 60000, maxAttempts: 10 };
// A conflict answer may carry a copy read before a concurrent commit (the
// route reads, then updates conditionally). Such a copy is asked for again,
// at most this many times per pass, before falling back to the retry backoff.
export const MIRROR_STALE_CHECKS = 3;
export const MIRROR_META_VERSION = 1;

// provenance: 'known' (this device has followed the account copy) or 'legacy'
// (stored without bookkeeping; a differing account copy is ambiguous).
export function createMirrorState(sessionId, revision = null, provenance = 'known') {
  return { sessionId, revision, provenance, timer: null, inFlight: false, again: false, unresolved: null, failures: 0, diverged: null };
}

// What is stored with the session (never credentials). While diverged no
// revision is stored, so a reload cannot turn the ambiguity into an overwrite.
export function mirrorMeta(m, session) {
  if (!m?.sessionId || (session && session.id !== m.sessionId)) return undefined;
  const unresolved = m.unresolved ? { kind: m.unresolved.kind, sessionId: m.unresolved.sessionId, body: m.unresolved.body, snapshot: m.unresolved.snapshot } : null;
  return { v: MIRROR_META_VERSION, sessionId: m.sessionId, provenance: m.provenance, revision: m.diverged ? null : m.revision, unresolved: m.diverged ? null : unresolved };
}

function validRequest(request, sessionId) {
  if (!request || typeof request !== 'object' || request.sessionId !== sessionId) return false;
  if (!request.body || typeof request.body !== 'object' || request.snapshot?.id !== sessionId) return false;
  if (request.kind === 'create') return request.body.id === sessionId;
  if (request.kind === 'update') return Number.isInteger(request.body.base_revision) && request.body.base_revision >= 0;
  return false;
}

// Mount: resume from stored bookkeeping when it belongs to this session and is
// well formed; otherwise treat the stored session as legacy (never trust part).
export function restoreMirrorState(session, meta) {
  const valid = meta && typeof meta === 'object' && meta.v === MIRROR_META_VERSION && meta.sessionId === session.id
    && ['known', 'legacy'].includes(meta.provenance)
    && (meta.revision === null || (Number.isInteger(meta.revision) && meta.revision >= 0))
    && (meta.unresolved === null || validRequest(meta.unresolved, session.id));
  if (!valid) return createMirrorState(session.id, null, 'legacy');
  return { ...createMirrorState(session.id, meta.revision, meta.provenance), unresolved: meta.unresolved };
}

function transient(error) {
  const status = error?.response?.status ?? null;
  return status === null || status === 408 || status === 429 || status >= 500;
}
const backoff = (failures) => Math.min(MIRROR_RETRY.maxDelayMs, MIRROR_RETRY.firstDelayMs * 2 ** (failures - 1));

function requestFor(m, session) {
  const ids = [...new Set(session.slots.flatMap((slot) => slot.occupants.map((row) => row.traineeId)))].slice(0, 6);
  if (m.revision === null) {
    return { kind: 'create', sessionId: session.id, snapshot: session, body: { id: session.id, title: session.title, mode: 'stations', participant_ids: ids, station_state: session } };
  }
  return {
    kind: 'update', sessionId: session.id, snapshot: session,
    body: { base_revision: m.revision, station_state: session, participant_ids: ids, ...(session.status === 'finished' ? { status: 'finished' } : {}) },
  };
}

// ctx: { mirror: { current }, sessionRef: { current }, api, clock: { setTimeout, clearTimeout },
//        onState(state), adopt(remoteStationState) -> adopted copy | null,
//        persist() -> boolean (stores the current session with mirrorMeta) }
export async function runMirror(ctx) {
  const { mirror, sessionRef, api, clock, onState, adopt } = ctx;
  const m = mirror.current;
  if (!m) return;
  if (m.inFlight) { m.again = true; return; }
  if (m.diverged) { onState('diverged'); return; } // waits for an explicit choice
  m.inFlight = true;
  const stillCurrent = () => mirror.current === m && sessionRef.current?.id === m.sessionId;
  const persist = () => (ctx.persist ? ctx.persist() !== false : true);
  const isCurrentCopy = (snapshot) => sessionRef.current === snapshot || sameSessionState(sessionRef.current, snapshot);
  let replaced = false; // keeps "changed on another device" visible after re-sending kept entries
  let retryAfter = null;
  let staleChecks = 0;
  const transientFailure = () => {
    m.failures += 1;
    onState('local');
    if (m.failures < MIRROR_RETRY.maxAttempts) retryAfter = backoff(m.failures);
  };
  // Another coach device changed the plan: adopt it rather than overwrite
  // (the caller keeps this device's unsaved entries). True when kept entries
  // still need to be mirrored on top of the adopted copy.
  const adoptRemote = (remote) => {
    m.revision = remote.revision;
    m.provenance = 'known';
    const adopted = remote.station_state ? adopt(remote.station_state) : null;
    persist();
    onState('replaced');
    replaced = true;
    return Boolean(adopted) && adopted !== remote.station_state;
  };
  try {
    for (let pass = 0; pass < MIRROR_PASS_LIMIT && stillCurrent(); pass += 1) {
      m.again = false;
      // An earlier request with an unknown outcome is re-sent exactly, first.
      const previous = m.unresolved;
      const request = previous || requestFor(m, sessionRef.current);
      // Write-ahead: the request is stored with the session before it is sent.
      m.unresolved = request;
      if (!persist()) { m.unresolved = previous; transientFailure(); return; }
      try {
        const { data } = request.kind === 'create'
          ? await api.post('/group-sessions', request.body)
          : await api.patch(`/group-sessions/${request.sessionId}`, request.body);
        if (!stillCurrent()) return;
        m.unresolved = null;
        m.failures = 0;
        if (request.kind === 'create' && data.outcome !== 'created') {
          // The group already existed: this device's own earlier create, or
          // another device has changed it since (never overwrite that copy).
          if (data.session.station_state && !sameSessionState(data.session.station_state, request.snapshot)) {
            if (m.provenance === 'legacy') {
              // Stored without bookkeeping: older copy of this device or a newer
              // one from another device cannot be told apart. Keep both; ask.
              m.diverged = { revision: data.session.revision, remote: data.session.station_state };
              persist();
              onState('diverged');
              return;
            }
            if (!adoptRemote(data.session)) return;
            continue;
          }
          m.revision = data.session.revision;
          m.provenance = 'known';
          persist();
          if (isCurrentCopy(request.snapshot) && !m.again) { onState(replaced ? 'replaced' : 'saved'); return; }
          pass -= 1;
          continue; // its own create: send the current copy next
        }
        m.revision = data.session.revision;
        m.provenance = 'known';
        persist();
        if (isCurrentCopy(request.snapshot) && !m.again) { onState(replaced ? 'replaced' : 'saved'); return; }
        onState('pending'); // a newer copy is queued; not saved yet
      } catch (error) {
        if (!stillCurrent()) return;
        const remote = error?.response?.status === 409 ? error.response.data?.session : null;
        if (remote && request.kind === 'update' && remote.revision <= request.body.base_revision) {
          // A copy read before a concurrent commit: not the current state.
          // The same request is asked again (its conditional update cannot
          // apply) so the next answer carries the current copy.
          staleChecks += 1;
          if (staleChecks <= MIRROR_STALE_CHECKS) { pass -= 1; continue; }
          transientFailure();
          return;
        }
        if (remote) {
          m.unresolved = null;
          m.failures = 0;
          // The server already holds exactly what this request carried: an
          // earlier attempt of it committed and only its reply was lost.
          if (remote.station_state && sameSessionState(remote.station_state, request.snapshot)) {
            m.revision = remote.revision;
            m.provenance = 'known';
            persist();
            if (isCurrentCopy(request.snapshot) && !m.again) { onState(replaced ? 'replaced' : 'saved'); return; }
            continue;
          }
          if (!adoptRemote(remote)) return;
          continue; // mirror the kept entries on top of the adopted copy
        }
        if (transient(error)) {
          // Outcome unknown: keep this exact request (stored) for the next attempt.
          transientFailure();
          return;
        }
        // Refused (validation, sign-in, access, not found): nothing committed.
        m.unresolved = null;
        persist();
        onState('local');
        return;
      }
    }
    // Each pass is bounded; newer work still queued gets another pass.
    if (stillCurrent()) retryAfter = MIRROR_DEBOUNCE_MS;
  } finally {
    m.inFlight = false;
    if (retryAfter !== null && stillCurrent()) {
      clock.clearTimeout(m.timer);
      m.timer = clock.setTimeout(() => { if (mirror.current === m) runMirror(ctx); }, retryAfter);
    }
  }
}

// The coach's explicit choice for a legacy divergence: 'local' sends this
// device's plan as a conditional update on the account revision just seen
// (a still newer change from another device is then adopted as usual);
// 'remote' adopts the account copy, keeping this device's unsaved entries.
export async function resolveDivergence(ctx, choice) {
  const m = ctx.mirror.current;
  if (!m?.diverged || !['local', 'remote'].includes(choice)) return;
  const { revision, remote } = m.diverged;
  m.diverged = null;
  m.revision = revision;
  m.provenance = 'known';
  if (choice === 'remote') {
    const adopted = ctx.adopt(remote);
    if (ctx.persist) ctx.persist();
    ctx.onState('replaced');
    if (!adopted || adopted === remote) return;
  } else if (ctx.persist) {
    ctx.persist();
  }
  await runMirror(ctx);
}

// After every local change: debounce, then mirror (resetting transient retries).
export function scheduleMirror(ctx) {
  const { mirror, sessionRef, clock } = ctx;
  clock.clearTimeout(mirror.current?.timer);
  const timer = clock.setTimeout(() => {
    const current = sessionRef.current;
    if (!current) return;
    if (mirror.current?.sessionId !== current.id) mirror.current = { ...createMirrorState(current.id), timer };
    mirror.current.failures = 0;
    runMirror(ctx);
  }, MIRROR_DEBOUNCE_MS);
  if (mirror.current) mirror.current.timer = timer;
}
