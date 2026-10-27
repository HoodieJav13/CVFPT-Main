import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** "Show more workouts" for paged history (see useHistoryPages). */
export function HistoryShowMore({ pages, testId = 'history-show-more' }) {
  if (!pages.canShowMore && !pages.moreError) return null;
  return (
    <div className="flex flex-col items-center gap-1 pt-1">
      {pages.canShowMore && (
        <Button type="button" variant="outline" className="min-h-11 rounded-xl" disabled={pages.loadingMore} onClick={pages.showMore} data-testid={testId}>
          {pages.loadingMore && <Loader2 className="mr-1.5 h-4 w-4 animate-spin motion-reduce:animate-none" />}
          Show more workouts
        </Button>
      )}
      {pages.moreError && <p role="alert" className="text-xs text-destructive">{pages.moreError}</p>}
    </div>
  );
}
