import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { api, errMsg } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { PageHeader, ListSkeleton, LoadErrorState, IconButton } from '@/components/common';
import { Button } from '@/components/ui/button';
import { fmtTime } from '@/lib/format';
import { cn } from '@/lib/utils';

// Training weeks run Monday–Sunday.
function startOfWeek(date) {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return day;
}

// Calendar-day arithmetic, never fixed 24h milliseconds: with DST a local
// "day" can be 23 or 25 hours, so millisecond math lands a week jump on
// Sunday 11 PM across the fall transition.
function addDays(date, count) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + count);
}

const STATUS_STYLES = {
  scheduled: 'border-l-primary/70 bg-primary/10',
  completed: 'border-l-success/70 bg-success/10',
  cancelled: 'border-l-border bg-secondary/40',
};

export default function CoachCalendar() {
  const { user } = useAuth();
  const isAdmin = user.role === 'admin';
  const [sessions, setSessions] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/sessions');
      setSessions(data);
      setLoadError(null);
    } catch (error) {
      setLoadError(errMsg(error, 'Failed to load sessions'));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)),
    [weekStart],
  );
  const byDay = useMemo(() => {
    const map = new Map(days.map((day) => [day.toDateString(), []]));
    for (const session of sessions || []) {
      const key = new Date(session.scheduled_at).toDateString();
      if (map.has(key)) map.get(key).push(session);
    }
    for (const rows of map.values()) {
      rows.sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
    }
    return map;
  }, [days, sessions]);

  if (!sessions && loadError) return <LoadErrorState message={loadError} scope="coach-calendar" onRetry={load} />;
  if (!sessions) return <ListSkeleton rows={5} />;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const fmtShort = (day) => day.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const dayKeys = new Set(days.map((day) => day.toDateString()));
  const weekCount = (sessions || []).filter((session) => (
    dayKeys.has(new Date(session.scheduled_at).toDateString()) && session.status !== 'cancelled'
  )).length;

  return (
    <div data-testid="coach-calendar">
      <PageHeader
        title="Calendar"
        subtitle={`${fmtShort(days[0])} – ${fmtShort(days[6])} · ${weekCount} session${weekCount === 1 ? '' : 's'}`}
        action={
          <div className="flex items-center gap-1.5">
            <IconButton
              label="Previous week" variant="outline" size="touchIcon" className="rounded-xl"
              onClick={() => setWeekStart((current) => addDays(current, -7))}
              data-testid="calendar-prev-week"
            >
              <ChevronLeft className="h-4 w-4" />
            </IconButton>
            <Button
              variant="outline" className="min-h-11 rounded-xl"
              onClick={() => setWeekStart(startOfWeek(new Date()))}
              data-testid="calendar-today-button"
            >
              Today
            </Button>
            <IconButton
              label="Next week" variant="outline" size="touchIcon" className="rounded-xl"
              onClick={() => setWeekStart((current) => addDays(current, 7))}
              data-testid="calendar-next-week"
            >
              <ChevronRight className="h-4 w-4" />
            </IconButton>
          </div>
        }
      />
      <div className="grid gap-2 lg:grid-cols-7" data-testid="calendar-week-grid">
        {days.map((day) => {
          const rows = byDay.get(day.toDateString()) || [];
          const isToday = day.getTime() === today.getTime();
          return (
            <section
              key={day.toISOString()}
              className={cn('rounded-xl border border-border bg-card/50 p-2.5', isToday && 'border-primary/50')}
              data-testid="calendar-day"
              data-today={isToday || undefined}
            >
              <p className={cn(
                'mb-2 flex items-baseline justify-between gap-1 lg:flex-col lg:items-start lg:gap-0',
                isToday ? 'text-primary' : 'text-muted-foreground',
              )}
              >
                <span className="text-xs font-semibold uppercase tracking-wide">
                  {day.toLocaleDateString(undefined, { weekday: 'short' })}
                </span>
                <span className="font-display text-base font-semibold tabular-nums text-foreground lg:text-lg">
                  {fmtShort(day)}
                </span>
              </p>
              {rows.length === 0 && <p className="py-1 text-xs text-muted-foreground/60">No sessions</p>}
              <div className="space-y-1.5">
                {rows.map((session) => (
                  <div
                    key={session.id}
                    className={cn('rounded-lg border-l-2 px-2 py-1.5 text-xs', STATUS_STYLES[session.status] || 'border-l-border bg-secondary/40')}
                    data-testid="calendar-session-chip"
                    data-status={session.status}
                  >
                    <p className={cn('font-medium tabular-nums', session.status === 'cancelled' && 'line-through opacity-70')}>
                      {fmtTime(session.scheduled_at)} · {session.duration_minutes}m
                    </p>
                    <p className={cn('truncate', session.status === 'cancelled' && 'opacity-70')}>{session.client?.name || 'Client'}</p>
                    {isAdmin && session.coach?.name && <p className="truncate text-muted-foreground">{session.coach.name}</p>}
                    {session.location && <p className="truncate text-muted-foreground">{session.location}</p>}
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
