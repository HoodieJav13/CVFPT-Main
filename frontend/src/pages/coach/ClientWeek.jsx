import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { PageHeader } from '@/components/common';
import WholeWeekView from '@/components/context/WholeWeekView';
import { resolveWeekStart } from '@/lib/outsideActivities';

export default function CoachWholeWeek() {
  const { id } = useParams();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [initialWeek] = useState(() => resolveWeekStart(params.get('week')));
  const requested = params.get('week');
  const weekStart = requested && resolveWeekStart(requested) === requested ? requested : initialWeek;
  useEffect(() => {
    if (requested !== weekStart) setParams((current) => { const next = new URLSearchParams(current); next.set('week', weekStart); return next; }, { replace: true });
  }, [requested, weekStart, setParams]);

  return (
    <div>
      <Link to={`/coach/clients/${id}`} className="mb-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary" data-testid="coach-week-back">
        <ArrowLeft className="h-4 w-4" aria-hidden />Back to client
      </Link>
      <PageHeader title="Whole week" subtitle="Client-shared context. Read it alongside your own judgment; nothing here changes the program." testId="coach-week-header" />
      <Link className="mb-3 inline-flex min-h-11 items-center text-sm font-medium text-primary" to={`/coach/clients/${id}/week/review?week=${weekStart}`}>Review this week</Link>
      <WholeWeekView
        key={id}
        clientId={id}
        viewerRole={user?.role === 'admin' ? 'admin' : 'coach'}
        userId={user?.profile?.id}
        weekStart={weekStart}
        onWeekChange={(week) => setParams((current) => { const next = new URLSearchParams(current); next.set('week', week); return next; })}
      />
    </div>
  );
}
