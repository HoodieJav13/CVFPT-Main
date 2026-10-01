import { useCallback, useState } from 'react';
import { api } from '@/lib/api';
import { appendHistoryPage, HISTORY_PAGE_SIZE } from '@/lib/historyPaging';

/**
 * Completed-workout history in pages of 12 (GET <path>?paged=1). The page
 * fetches the first page in its own Promise.all via fetchFirst and hands
 * the response to setFirstPage; "Show more" fetches the next page.
 */
export function useHistoryPages(path) {
  const [items, setItems] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(null);

  const fetchFirst = useCallback(() => api.get(path, { params: { paged: 1, limit: HISTORY_PAGE_SIZE } }), [path]);

  const setFirstPage = useCallback((data) => {
    setItems(data.logs);
    setCursor(data.next_cursor || null);
    setMoreError(null);
  }, []);

  const showMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const { data } = await api.get(path, { params: { paged: 1, limit: HISTORY_PAGE_SIZE, cursor } });
      setItems((current) => appendHistoryPage(current || [], data.logs));
      setCursor(data.next_cursor || null);
    } catch {
      setMoreError('Could not load more workouts. Try again.');
    } finally {
      setLoadingMore(false);
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
