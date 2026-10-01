// Persists an in-flight recurring save ({ request_id, frozen body }) so closing or
// reloading the app after a timeout cannot lead to a second series: the next load
// finds the pending record and retries the SAME request id. Browser storage can be
// missing, blocked, or full (private windows, site data off), so every access is
// guarded and `save` reports whether it actually persisted.

const PREFIX = 'cvf_series_pending';

function defaultStorage() {
  return typeof window === 'undefined' ? null : window.localStorage;
}

export function newRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function parse(raw) {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && typeof value.request_id === 'string' && value.body && typeof value.body === 'object'
      ? value : null;
  } catch {
    return null;
  }
}

export function createDraftStore({ getStorage = defaultStorage, userId }) {
  const keyFor = (clientId) => `${PREFIX}:${userId}:${clientId}`;
  return {
    save(clientId, record) {
      try {
        const storage = getStorage();
        if (!storage) return false;
        storage.setItem(keyFor(clientId), JSON.stringify({ ...record, saved_at: Date.now() }));
        return true;
      } catch {
        return false;
      }
    },
    load(clientId) {
      try {
        const storage = getStorage();
        return storage ? parse(storage.getItem(keyFor(clientId))) : null;
      } catch {
        return null;
      }
    },
    findPending() {
      try {
        const storage = getStorage();
        if (!storage) return null;
        const prefix = `${PREFIX}:${userId}:`;
        for (let i = 0; i < storage.length; i += 1) {
          const key = storage.key(i);
          if (!key || !key.startsWith(prefix)) continue;
          const record = parse(storage.getItem(key));
          if (record) return { clientId: key.slice(prefix.length), record };
        }
        return null;
      } catch {
        return null;
      }
    },
    clear(clientId) {
      try {
        getStorage()?.removeItem(keyFor(clientId));
      } catch {
        // nothing to clear if storage is unavailable
      }
    },
  };
}
