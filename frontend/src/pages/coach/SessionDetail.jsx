// Program 013: the coach's session page — what's planned, whether the
// client has trained, the notes, and the actions that settle it.
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, errMsg } from '@/lib/api';
import { LoadingScreen, LoadErrorState, StatusBadge, SectionLabel } from '@/components/common';
import { WorkoutActivity } from '@/components/WorkoutActivity';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  ArrowLeft, Check, ChevronRight, Dumbbell, Loader2, MapPin, StickyNote, UserX, X,
} from 'lucide-react';
import { fmtDay, fmtTime, fmtDateTime, initials } from '@/lib/format';
import { toast } from 'sonner';

export default function CoachSessionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [acting, setActing] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/sessions/${id}/coach-detail`);
      setSession(data);
      setLoadError(null);
    } catch (e) {
      setLoadError(errMsg(e, 'Failed to load the session'));
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const run = async (key, request, message) => {
    if (acting) return;
    setActing(key);
    try {
      await request();
      toast.success(message);
      await load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setActing(null);
    }
  };

  if (!session && loadError) return <LoadErrorState message={loadError} scope="coach-session-detail" onRetry={() => { setLoadError(null); load(); }} />;
  if (!session) return <LoadingScreen />;

  const started = new Date(session.scheduled_at).getTime() <= Date.now();
  const scheduled = session.status === 'scheduled';

  return (
    <div>
      <button
        type="button"
        onClick={() => navigate('/coach/sessions')}
        className="mb-3 inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground hover:text-foreground"
        data-testid="coach-session-detail-back"
      >
        <ArrowLeft className="h-4 w-4" /> Sessions
      </button>

      <Card className="mb-4 border-primary/40 bg-gradient-to-b from-[hsl(202_35%_13%)] to-[hsl(214_28%_7%)] shadow-[var(--app-elev)]" data-testid="coach-session-detail-card">
        <CardContent className="p-6">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">Session</p>
            <StatusBadge status={session.status} />
          </div>
          <h1 className="mt-1 font-display text-4xl font-semibold tracking-tight">
            {fmtDay(session.scheduled_at)} <span className="text-primary">{fmtTime(session.scheduled_at)}</span>
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
            <Link to={`/coach/clients/${session.client_id}`} className="flex items-center gap-2 hover:text-foreground" data-testid="coach-session-client-link">
              <Avatar className="h-7 w-7">
                <AvatarFallback className="bg-primary/15 text-[10px] font-semibold text-primary">{initials(session.client?.name)}</AvatarFallback>
              </Avatar>
              <span className="font-medium text-foreground">{session.client?.name}</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
            <span>{session.duration_minutes} min</span>
            {session.location && <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {session.location}</span>}
          </div>
          <WorkoutActivity activity={session.workout_activity} className="mt-3 text-xs" />

          <div className="mt-4 flex flex-wrap gap-2">
            {scheduled && (
              <Button
                className="min-h-11 rounded-xl font-semibold"
                disabled={Boolean(acting)}
                onClick={() => run('complete', () => api.patch(`/sessions/${session.id}/complete`), 'Session completed')}
                data-testid="coach-session-complete"
              >
                {acting === 'complete' ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Check className="mr-1.5 h-4 w-4" /> Mark complete</>}
              </Button>
            )}
            {scheduled && started && (
              <Button
                variant="outline"
                className="min-h-11 rounded-xl"
                disabled={Boolean(acting)}
                onClick={() => run('no_show', () => api.patch(`/sessions/${session.id}/no-show`), 'Marked as a no-show')}
                data-testid="coach-session-no-show"
              >
                {acting === 'no_show' ? <Loader2 className="h-4 w-4 animate-spin" /> : <><UserX className="mr-1.5 h-4 w-4" /> No-show</>}
              </Button>
            )}
            {session.status !== 'cancelled' && (
              <Button
                variant="outline"
                className="min-h-11 rounded-xl"
                onClick={() => navigate(`/coach/clients/${session.client_id}?tab=programs&session=${session.id}`)}
                data-testid="coach-session-log-workout"
              >
                <Dumbbell className="mr-1.5 h-4 w-4" /> Log workout
              </Button>
            )}
            {scheduled && (
              <Button
                variant="ghost"
                className="min-h-11 rounded-xl text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                disabled={Boolean(acting)}
                onClick={() => run('cancel', () => api.patch(`/sessions/${session.id}/cancel`), 'Session cancelled')}
                data-testid="coach-session-cancel"
              >
                {acting === 'cancel' ? <Loader2 className="h-4 w-4 animate-spin" /> : <><X className="mr-1.5 h-4 w-4" /> Cancel</>}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="mb-4" data-testid="coach-session-plan">
        <CardContent className="p-5">
          <div className="flex items-center justify-between gap-2">
            <SectionLabel>The plan</SectionLabel>
            {session.workout?.name && (
              <Badge variant="outline" className="shrink-0"><Dumbbell className="mr-1 h-3 w-3" /> {session.workout.name}</Badge>
            )}
          </div>
          {session.workout ? (
            <>
              {session.workout.description && <p className="mt-2 text-sm text-muted-foreground">{session.workout.description}</p>}
              <div className="mt-2 divide-y divide-border/70">
                {session.workout.exercises.map((exercise, index) => (
                  <div key={exercise.id} className="py-2.5" data-testid="coach-session-plan-exercise">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium"><span className="mr-2 text-muted-foreground">{index + 1}.</span>{exercise.name}</p>
                      {(exercise.sets || exercise.reps) && (
                        <Badge variant="outline" className="shrink-0 tabular-nums">{exercise.sets || '?'} x {exercise.reps || '?'}</Badge>
                      )}
                    </div>
                    {exercise.coach_notes && <p className="mt-1 text-xs text-muted-foreground">{exercise.coach_notes}</p>}
                  </div>
                ))}
                {session.workout.exercises.length === 0 && (
                  <p className="py-2 text-sm text-muted-foreground">This workout has no exercises yet.</p>
                )}
              </div>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              No workout attached. Edit the session from Sessions to plan one — the client sees it on their session page.
            </p>
          )}
        </CardContent>
      </Card>

      <Card data-testid="coach-session-notes">
        <CardContent className="p-5">
          <SectionLabel>Notes</SectionLabel>
          {session.notes?.length ? (
            <div className="mt-2 space-y-2">
              {session.notes.map((note) => (
                <div key={note.id} className="rounded-lg border border-border bg-card/60 px-3 py-2">
                  <p className="whitespace-pre-wrap text-sm">{note.content}</p>
                  <p className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <StickyNote className="h-3 w-3" />
                    {fmtDateTime(note.created_at)}
                    {note.shared_with_client && <Badge variant="outline" className="text-[10px]">Shared with client</Badge>}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">No notes yet — add one from the session's menu on Sessions.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
