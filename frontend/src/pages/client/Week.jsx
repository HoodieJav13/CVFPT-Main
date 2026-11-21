import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useAuth } from '@/context/AuthContext';
import { PageHeader } from '@/components/common';
import WholeWeekView from '@/components/context/WholeWeekView';
import { resolveWeekStart } from '@/lib/outsideActivities';

export default function ClientWeek() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  // The week is chosen once and kept in the URL, so crossing Denver midnight
  // or a DST change never silently moves the screen to another week.
  const [initialWeek] = useState(() => resolveWeekStart(params.get('week')));
  const requested = params.get('week');
  const weekStart = requested && resolveWeekStart(requested) === requested ? requested : initialWeek;
  useEffect(() => {
    if (requested !== weekStart) setParams((current) => { const next = new URLSearchParams(current); next.set('week', weekStart); return next; }, { replace: true });
  }, [requested, weekStart, setParams]);

  return (
    <div>
      <PageHeader title="Whole week" subtitle="PT workouts, outside activity and check-ins together" testId="client-week-header" />
      <WholeWeekView
        viewerRole="client"
        userId={user?.profile?.id}
        weekStart={weekStart}
        onWeekChange={(week) => setParams((current) => { const next = new URLSearchParams(current); next.set('week', week); return next; })}
      />
    </div>
  );
}
