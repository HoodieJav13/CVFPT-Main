import { Link } from 'react-router';
import { CalendarRange, ChevronRight } from 'lucide-react';

// Quiet link into the whole-week view. Makes no request of its own, so the
// screens it sits on load exactly as before.
export default function WholeWeekEntry({ to, description, className = '', testId = 'whole-week-entry' }) {
  return (
    <Link
      to={to}
      className={`flex min-h-11 items-center justify-between gap-3 rounded-2xl border border-border bg-card/40 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`}
      data-testid={testId}
    >
      <span className="flex min-w-0 items-center gap-3">
        <CalendarRange className="h-5 w-5 shrink-0 text-primary" aria-hidden />
        <span className="min-w-0">
          <span className="block text-sm font-semibold">Whole week</span>
          <span className="block text-xs text-muted-foreground">{description}</span>
        </span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}
