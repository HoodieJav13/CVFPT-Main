import { useCallback, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { appendHistoryPage, HISTORY_PAGE_SIZE } from '@/lib/historyPaging';

/**
 * Completed-workout history in pages of 12 (GET <path>?paged=1). The page
 * fetches the first page in its own Promise.all via fetchFirst and hands
 * that response to setFirstPage; "Show more" fetches the next page.
 *
 * Two guards keep pages from different lists apart (mixing them could skip
 * or repeat workouts):
 * - generation: every first-page fetch starts one; only the newest first
 *   page may install, so an earlier reload can't overwrite a later one.
 * - listVersion: bumped whenever a first page is installed. "Show more"
 *   applies only to the list it was cut from, so one started before (or
 *   during) a refresh is discarded once the refreshed list is on screen.
 */
export function useHistoryPages(path) {
  const [items, setItems] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(null);
  const generation = useRef(0);
  const listVersion = useRef(0);
  const moreRequest = useRef(0);

  const fetchFirst = useCallback(async () => {
    const issued = ++generation.current;
    const response = await api.get(path, { params: { paged: 1, limit: HISTORY_PAGE_SIZE } });
    return { ...response, historyGeneration: issued };
  }, [path]);

  const setFirstPage = useCallback((response) => {
    if (response.historyGeneration !== generation.current) return;
    listVersion.current += 1;
    setItems(response.data.logs);
    setCursor(response.data.next_cursor || null);
    setMoreError(null);
    setLoadingMore(false);
  }, []);

  const showMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    const version = listVersion.current;
    const request = ++moreRequest.current;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const { data } = await api.get(path, { params: { paged: 1, limit: HISTORY_PAGE_SIZE, cursor } });
      if (version !== listVersion.current) return;
      setItems((current) => appendHistoryPage(current || [], data.logs));
      setCursor(data.next_cursor || null);
    } catch {
      if (version === listVersion.current) setMoreError('Could not load more workouts. Try again.');
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
