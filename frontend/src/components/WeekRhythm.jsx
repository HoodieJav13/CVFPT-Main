// Program 011 A: the week at a glance. Day states are opportunity-framed —
// a missed day reads "to make up", never failure — and the streak counts
// morale-safe weeks (see backend/src/lib/rhythm.js for the rules).
import { useEffect, useState } from 'react';
import { Check, Flame } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function dayCellClass(state) {
  switch (state) {
    case 'done': return 'border-primary bg-primary text-primary-foreground';
    case 'today': return 'border-primary/70 bg-primary/15 text-primary';
    case 'to_make_up': return 'border-achievement/60 bg-achievement/10 text-achievement';
    case 'upcoming': return 'border-border bg-card/60 text-muted-foreground';
    default: return 'border-border/40 bg-transparent text-muted-foreground/50';
  }
}

export function StreakPill({ count, className }) {
  if (!count) return null;
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-full bg-achievement px-2.5 py-1 font-display text-xs font-semibold text-achievement-foreground', className)}
      data-testid="week-streak-pill"
    >
      <Flame className="h-3.5 w-3.5" aria-hidden />
      {count}-week streak
    </span>
  );
}

export function WeekStrip({ rhythm, className }) {
  if (!rhythm) return null;
  return (
    <div className={cn('flex items-center justify-between gap-1', className)} data-testid="week-strip" aria-label="This week's assigned workouts">
      {rhythm.days.map((day, index) => (
        <div key={day.date} className="flex flex-col items-center gap-1">
          <span className="text-[10px] font-medium text-muted-foreground">{DAY_LETTERS[index]}</span>
          <span
            className={cn('flex h-8 w-8 items-center justify-center rounded-full border text-[11px] font-semibold tabular-nums', dayCellClass(day.state))}
            title={day.assignments.map((a) => a.workout_name).filter(Boolean).join(', ') || undefined}
            data-day-state={day.state}
          >
            {day.state === 'done' ? <Check className="h-4 w-4" aria-hidden /> : day.assignments.length || ''}
            <span className="sr-only">
              {day.date}: {day.state === 'rest' ? 'rest day' : day.state.replace('_', ' ')}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

/** Self-contained coach-side week view for ClientDetail — quiet on failure. */
export function CoachClientWeek({ clientId }) {
  const [rhythm, setRhythm] = useState(null);
  useEffect(() => {
    let cancelled = false;
    api.get(`/workout-logs/clients/${clientId}/week-rhythm`)
      .then(({ data }) => { if (!cancelled) setRhythm(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [clientId]);
  if (!rhythm || rhythm.week_total === 0) return null;
  return (
    <div className="rounded-xl border border-border bg-card/40 px-4 py-3" data-testid="coach-client-week">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">This week</p>
        <div className="flex items-center gap-2">
          <p className="text-xs tabular-nums text-muted-foreground">{rhythm.week_done} of {rhythm.week_total} done</p>
          <StreakPill count={rhythm.week_streak} />
        </div>
      </div>
      <WeekStrip rhythm={rhythm} />
    </div>
  );
}
