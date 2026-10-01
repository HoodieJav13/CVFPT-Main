import { useCallback, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { appendHistoryPage, HISTORY_PAGE_SIZE } from '@/lib/historyPaging';

/**
 * Completed-workout history in pages of 12 (GET <path>?paged=1). The page
 * fetches the first page in its own Promise.all via fetchFirst and hands
 * that response to setFirstPage; "Show more" fetches the next page.
 *
 * Every first-page fetch starts a new generation. A response from an older
 * generation (a slow "Show more", or an earlier reload) is discarded, so a
 * refresh can never be overwritten by a page cut from the previous list —
 * which could skip or repeat workouts.
 */
export function useHistoryPages(path) {
  const [items, setItems] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(null);
  const generation = useRef(0);
  const moreRequest = useRef(0);

  const fetchFirst = useCallback(async () => {
    const issued = ++generation.current;
    const response = await api.get(path, { params: { paged: 1, limit: HISTORY_PAGE_SIZE } });
    return { ...response, historyGeneration: issued };
  }, [path]);

  const setFirstPage = useCallback((response) => {
    if (response.historyGeneration !== generation.current) return;
    setItems(response.data.logs);
    setCursor(response.data.next_cursor || null);
    setMoreError(null);
    setLoadingMore(false);
  }, []);

  const showMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    const issued = generation.current;
    const request = ++moreRequest.current;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const { data } = await api.get(path, { params: { paged: 1, limit: HISTORY_PAGE_SIZE, cursor } });
      if (issued !== generation.current) return;
      setItems((current) => appendHistoryPage(current || [], data.logs));
      setCursor(data.next_cursor || null);
    } catch {
      if (issued === generation.current) setMoreError('Could not load more workouts. Try again.');
    } finally {
      if (request === moreRequest.current) setLoadingMore(false);
    }
  }, [cursor, loadingMore, path]);

  return {
    items,
    canShowMore: Boolean(items) && Boolean(cursor),
    showMore,
    loadingMore,
    moreError,
    fetchFirst,
    setFirstPage,
  };
}
