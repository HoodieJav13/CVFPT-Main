import { Repeat } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { badgeLabel } from '@/lib/seriesPlan';

export function SeriesBadge({ session, className = '' }) {
  if (!session?.series || !session.series_ordinal) return null;
  return (
    <Badge variant="outline" className={`gap-1 text-[10px] font-medium text-muted-foreground ${className}`} data-testid="series-badge">
      <Repeat className="h-3 w-3" aria-hidden />
      {badgeLabel(session.series, session.series_ordinal)}
    </Badge>
  );
}
