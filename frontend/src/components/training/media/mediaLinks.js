import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { isPreviewMode } from '@/lib/previewFlag';
import { absoluteMediaUrl, actorKey, createLinkCache } from '@/lib/exerciseMedia';

// One in-memory cache per page lifetime, scoped by actor and cleared whenever
// the signed-in actor changes. Links are short-lived capabilities: never
// written to storage, the workout outbox, or any cache keyed by URL.
const cache = createLinkCache({
  request: async (context, assetIds) => {
    const { data } = await api.post('/exercise-media/links', { context, assets: assetIds.map((asset_id) => ({ asset_id })) });
    return data;
  },
});
let cacheActor = null;
function useActor() {
  const { user } = useAuth();
  const actor = actorKey(user);
  if (actor !== cacheActor) {
    cache.clear();
    cacheActor = actor;
  }
  return actor;
}

export function resolveMediaUrl(link) {
  // Preview mode serves in-page synthetic blobs; real builds accept only the
  // API capability path shape.
  if (isPreviewMode && typeof link === 'string' && link.startsWith('blob:')) return link;
  return absoluteMediaUrl(link, api.defaults.baseURL);
}

// Fetches links for the given assets in one batch, only when enabled.
export function useMediaLinks(context, assetIds, enabled = true) {
  const actor = useActor();
  const key = `${context?.type}:${context?.id || context?.exercise_id}:${assetIds.filter(Boolean).join(',')}`;
  const [state, setState] = useState({ status: 'idle', urls: new Map(), key: null });
  const [attempt, setAttempt] = useState(0);
  const ids = useRef(assetIds);
  ids.current = assetIds;
  const contextRef = useRef(context);
  contextRef.current = context;
  const retried = useRef(false);

  useEffect(() => {
    const wanted = ids.current.filter(Boolean);
    if (!enabled || !actor || !wanted.length || !contextRef.current) {
      setState({ status: 'idle', urls: new Map(), key });
      return undefined;
    }
    let live = true;
    if (retried.current) {
      // A retry never shows the failed URL again while the fresh one loads.
      retried.current = false;
      setState({ status: 'loading', urls: new Map(), key });
    } else {
      setState((current) => ({ ...current, status: current.key === key && current.urls.size ? 'ready' : 'loading', key }));
    }
    cache.get({ actor, context: contextRef.current, assetIds: wanted })
      .then((links) => {
        if (!live) return;
        const urls = new Map([...links].map(([assetId, link]) => [assetId, resolveMediaUrl(link)]).filter(([, url]) => url));
        setState({ status: 'ready', urls, key });
      })
      .catch(() => { if (live) setState({ status: 'error', urls: new Map(), key }); });
    return () => { live = false; };
  }, [actor, enabled, key, attempt]);

  // Explicit retry: drop these links and ask once more (bounded by the user).
  const retry = useCallback(() => {
    for (const assetId of ids.current) cache.invalidate(actor, contextRef.current, assetId);
    retried.current = true;
    setAttempt((value) => value + 1);
  }, [actor]);

  return { status: state.key === key ? state.status : 'loading', urls: state.key === key ? state.urls : new Map(), retry };
}

// One preview/instruction player may play at a time.
let activePlayer = null;
export function claimPlayback(element) {
  if (activePlayer && activePlayer !== element) {
    try { activePlayer.pause(); } catch { /* detached */ }
  }
  activePlayer = element;
}
export function releasePlayback(element) {
  if (activePlayer === element) activePlayer = null;
}
