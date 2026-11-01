// Guarded network-required activity saves. The private frozen operation stays
// in memory only. A content-free marker warns after an interrupted reload;
// it never recovers or automatically resends private data.
const PREFIX = 'cvf_outside_activity_interrupted:v1';
export const CAPABILITY_PATH = '/whole-week/capability';

export function newRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

/** Freezes a copy; later form edits can never change what is (re)sent. */
export function freezeRequest({ kind, method, url, body, activityId = null, summary = '' }) {
  return deepFreeze(JSON.parse(JSON.stringify({ kind, method, url, body, activity_id: activityId, summary })));
}

function defaultStorage() {
  return typeof window === 'undefined' ? null : window.localStorage;
}

/** One in-memory frozen operation per mounted profile/client store. */
export function createPendingStore({ getStorage = defaultStorage, scope }) {
  const key = `${PREFIX}:${scope}`;
  let pending = null;
  // Retire this unreleased draft format without reading its private body.
  try { getStorage()?.removeItem(`cvf_outside_activity_pending:v1:${scope}`); } catch { /* unavailable */ }
  return {
    key,
    save(record) {
      pending = record;
      try { getStorage()?.setItem(key, '1'); } catch { /* memory retry remains available */ }
      return true;
    },
    load() { return pending; },
    interrupted() {
      try { return !pending && getStorage()?.getItem(key) === '1'; } catch { return false; }
    },
    clear() {
      pending = null;
      try { getStorage()?.removeItem(key); } catch { /* unavailable */ }
    },
  };
}

export function validCommit(result, frozen) {
  const row = result?.resource;
  return result?.request_id === frozen.body.request_id && result.action === frozen.kind
    && typeof result.replayed === 'boolean'
    && Number.isInteger(result.committed_revision) && result.committed_revision > 0
    && row && typeof row.id === 'string' && row.id.length > 0
    && Number.isInteger(row.revision) && row.revision >= result.committed_revision
    && typeof row.archived === 'boolean'
    && (!frozen.activity_id || row.id === frozen.activity_id)
    && (frozen.kind !== 'archive' || row.archived);
}

export function validPreferenceCommit(result, revision, patch) {
  const preferences = result?.preferences;
  return preferences && preferences.revision === revision + 1
    && Object.entries(patch).every(([key, value]) => preferences[key] === value);
}

/** true = guarded writes supported; false = older/other backend; 'offline' = unknown. */
export async function probeCapability(api) {
  try {
    const { data } = await api.get(CAPABILITY_PATH);
    return data?.feature === 'whole_week' && data?.contract === 1 && data?.outside_activity_writes === 'guarded';
  } catch (error) {
    if (!error?.response || error.response.status >= 500) return 'offline';
    return false;
  }
}

const message = (error, fallback) => error?.response?.data?.error || fallback;

/**
 * Classifies one HTTP outcome. Only "confirmed", "conflict", "rejected" and
 * "denied" are authoritative (the frozen request may be cleared).
 */
export function classifyFailure(error) {
  const status = error?.response?.status;
  if (!error?.response || status >= 500 || status === 401 || status === 408) {
    return { state: 'unknown', message: 'Saved status unknown. Retry sends the same save; it will not be added twice.' };
  }
  if (status === 403 || status === 404) {
    return { state: 'denied', message: 'You no longer have access to this week. Nothing more can be saved here.' };
  }
  if (status === 409) {
    const code = error.response.data?.code || null;
    return { state: 'conflict', code, message: message(error, 'This changed elsewhere. Reload before saving.') };
  }
  if (status === 429) return { state: 'rejected', message: 'Too many saves right now. Wait a moment and save again.' };
  return { state: 'rejected', message: message(error, 'This could not be saved. Check the entry and try again.') };
}

/**
 * Sends (or re-sends, retry=true) exactly the frozen in-memory request. It is
 * cleared only on an authoritative committed outcome; a fresh
 * save that never left the device stays editable ("not_sent").
 */
export async function submitFrozen({ api, frozen, store, retry = false, isCurrent = () => true }) {
  const capable = await probeCapability(api);
  if (!isCurrent()) return { state: 'superseded' };
  if (capable === 'offline') {
    return retry
      ? { state: 'unknown', message: 'Still offline. Saved status unknown; retry when connected.' }
      : { state: 'not_sent', message: 'You appear to be offline. Nothing was sent; try again when connected.' };
  }
  if (!capable) {
    return retry
      ? { state: 'unknown', message: 'This server cannot confirm outside activities right now. Saved status unknown; nothing new was sent.' }
      : { state: 'unsupported', message: 'This server cannot save outside activities yet. Nothing was sent.' };
  }
  store?.save(frozen);
  try {
    const response = await api.request({ method: frozen.method, url: frozen.url, data: frozen.body });
    if (!isCurrent()) return { state: 'superseded' };
    if (!validCommit(response.data, frozen)) {
      return { state: 'unknown', message: 'Saved status unknown. The response did not confirm this save. Retry the same save.' };
    }
    store?.clear();
    return { state: 'confirmed', data: response.data };
  } catch (error) {
    if (!isCurrent()) return { state: 'superseded' };
    const outcome = classifyFailure(error);
    // A pre-RPC rejection of a retry cannot settle an earlier ambiguous save.
    if (retry && outcome.state === 'rejected') return { state: 'unknown', message: 'Saved status unknown. This retry could not confirm the earlier save; keep the same save and try again.' };
    if (outcome.state !== 'unknown') store?.clear();
    return outcome;
  }
}

/** A replayed receipt may be older than the row now stored. */
export function replayNotice(result) {
  if (!result?.replayed) return null;
  const latest = result.resource?.revision;
  if (Number.isInteger(latest) && latest > result.committed_revision) {
    return `This save had already finished (version ${result.committed_revision}). The activity has changed since; showing the newest version.`;
  }
  return 'This save had already finished. Nothing was added twice.';
}

/** Installs an authoritative row without ever replacing a newer one. */
export function mergeActivity(rows, resource) {
  if (!resource?.id) return rows;
  const existing = rows.find((row) => row.id === resource.id);
  if (existing && Number.isInteger(existing.revision) && existing.revision > resource.revision) return rows;
  const rest = rows.filter((row) => row.id !== resource.id);
  if (resource.archived) return rest;
  return [...rest, resource].sort((a, b) => String(a.occurred_on).localeCompare(String(b.occurred_on))
    || String(a.id).localeCompare(String(b.id)));
}
