import { Zap } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { QUICK_SESSION_LABEL } from '@/lib/quickSessions';

// The one semantic type label for coach-created quick sessions. Existing Badge and
// primary-accent tokens only; no new visual direction.
export function QuickSessionBadge({ className = '', testId = 'quick-session-badge' }) {
  return (
    <Badge variant="outline" className={`w-fit border-primary/40 text-primary ${className}`} data-testid={testId}>
      <Zap className="mr-1 h-3.5 w-3.5" aria-hidden /> {QUICK_SESSION_LABEL}
    </Badge>
  );
}
