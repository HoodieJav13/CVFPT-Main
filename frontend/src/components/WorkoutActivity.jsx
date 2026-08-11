// Program 013: the coach-side companion to the workout push/notification —
// a session row says at a glance whether that client is training now or
// already logged the work, so the coach never has to hunt in the
// notifications list to know what happened.
import { Activity, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export function WorkoutActivity({ activity, className }) {
  if (!activity) return null;

  if (activity.status === 'active') {
    return (
      <span
        className={cn('mt-1 inline-flex items-center gap-1.5 text-[11px] font-medium text-primary', className)}
        data-testid="session-workout-activity"
        data-activity="active"
      >
        <span className="relative flex h-2 w-2" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-70 motion-reduce:animate-none" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
        </span>
        Training now{activity.workout_name ? ` · ${activity.workout_name}` : ''}
      </span>
    );
  }

  if (activity.status === 'completed') {
    return (
      <span
        className={cn('mt-1 inline-flex items-center gap-1.5 text-[11px] font-medium text-success-foreground', className)}
        data-testid="session-workout-activity"
        data-activity="completed"
      >
        <CheckCircle2 className="h-3 w-3" aria-hidden />
        Workout logged{activity.quick_completed ? ' · not tracked' : ''}
      </span>
    );
  }

  return (
    <span
      className={cn('mt-1 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground', className)}
      data-testid="session-workout-activity"
      data-activity={activity.status}
    >
      <Activity className="h-3 w-3" aria-hidden />
      Workout {activity.status}
    </span>
  );
}
