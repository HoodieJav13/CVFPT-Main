// Program 011 B: everything a client may see about one session — when and
// where, with whom, the shared coach notes, and the planned workout when
// the coach attached one ("what we'll do").
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, errMsg } from '@/lib/api';
import { LoadingScreen, LoadErrorState, StatusBadge, SectionLabel } from '@/components/common';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, CalendarPlus, Dumbbell, Loader2, MapPin, StickyNote } from 'lucide-react';
import { fmtDay, fmtTime } from '@/lib/format';
import { initials } from '@/lib/format';
import { toast } from 'sonner';

export default function ClientSessionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/sessions/${id}/client-detail`);
      setSession(data);
      setLoadError(null);
    } catch (e) {
      setLoadError(errMsg(e, 'Failed to load the session'));
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const cancellable = session
    && session.status === 'scheduled'
    && new Date(session.scheduled_at).getTime() - Date.now() >= 24 * 60 * 60 * 1000;
  const [asked, setAsked] = useState(false);
  const [confirmingAsk, setConfirmingAsk] = useState(false);

  const askCancel = async () => {
    if (!confirmingAsk) { setConfirmingAsk(true); return; }
    setActing(true);
    try {
      await api.patch(`/sessions/${session.id}/ask-cancel`);
      setAsked(true);
      toast.success('Sent — your coach will take it from here');
      requestAnimationFrame(() => document.querySelector('[data-ask-sent]')?.focus());
    } catch (e) {
      toast.error(errMsg(e, 'Could not send the request'));
    } finally {
      setActing(false);
      setConfirmingAsk(false);
    }
  };

  const cancelSession = async () => {
    if (!confirmingCancel) { setConfirmingCancel(true); return; }
    setActing(true);
    try {
      await api.patch(`/sessions/${session.id}/client-cancel`);
      toast.success('Session cancelled — your coach has been notified');
      navigate('/client/sessions');
    } catch (e) {
      toast.error(errMsg(e, 'Could not cancel the session'));
    } finally {
      setActing(false);
      setConfirmingCancel(false);
    }
  };

  const downloadIcs = async () => {
    try {
      const { data } = await api.get(`/sessions/${session.id}/ics`, { responseType: 'blob' });
      const url = URL.createObjectURL(data);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'cvf-session.ics';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(errMsg(e, 'Could not build the calendar file'));
    }
  };

  if (!session && loadError) return <LoadErrorState message={loadError} scope="client-session-detail" onRetry={() => { setLoadError(null); load(); }} />;
  if (!session) return <LoadingScreen />;

  return (
    <div>
      <button
        type="button"
        onClick={() => navigate('/client/sessions')}
        className="mb-3 inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground hover:text-foreground"
        data-testid="session-detail-back"
      >
        <ArrowLeft className="h-4 w-4" /> Sessions
      </button>

      <Card className="mb-4 border-primary/40 bg-gradient-to-b from-[hsl(202_35%_13%)] to-[hsl(214_28%_7%)] shadow-[var(--app-elev)]" data-testid="session-detail-card">
        <CardContent className="p-6">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">Session</p>
            <StatusBadge status={session.status} />
          </div>
          <h1 className="mt-1 font-display text-4xl font-semibold tracking-tight">
            {fmtDay(session.scheduled_at)} <span className="text-primary">{fmtTime(session.scheduled_at)}</span>
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
            {session.coach?.name && (
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">
                  {initials(session.coach.name)}
                </span>
                {session.duration_minutes} min with {session.coach.name.split(' ')[0]}
              </span>
            )}
            {session.location && <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {session.location}</span>}
          </div>
          {session.status === 'scheduled' && (
            <div className="mt-4 flex items-center gap-2">
              <Button variant="outline" className="min-h-11 flex-1 rounded-xl" onClick={downloadIcs} data-testid="session-detail-ics">
                <CalendarPlus className="mr-1.5 h-4 w-4" /> Add to calendar
              </Button>
              {cancellable ? (
                <Button
                  variant="ghost"
                  className={`min-h-11 rounded-xl ${confirmingCancel ? 'bg-destructive/10 text-destructive' : 'text-muted-foreground hover:bg-destructive/10 hover:text-destructive'}`}
                  disabled={acting}
                  onClick={cancelSession}
                  data-testid="session-detail-cancel"
                >
                  {acting ? <><Loader2 className="h-4 w-4 animate-spin" /><span className="sr-only">Cancelling</span></> : (confirmingCancel ? 'Tap to confirm' : 'Cancel')}
                </Button>
              ) : (asked || session.cancel_requested) ? (
                <p role="status" tabIndex={-1} data-ask-sent className="text-[11px] text-muted-foreground" data-testid="ask-cancel-sent">Asked — your coach will confirm.</p>
              ) : (
                <Button
                  variant="ghost"
                  className={`min-h-11 rounded-xl ${confirmingAsk ? 'bg-destructive/10 text-destructive' : 'text-muted-foreground hover:bg-destructive/10 hover:text-destructive'}`}
                  disabled={acting}
                  onClick={askCancel}
                  data-testid="session-detail-ask-cancel"
                >
                  {acting ? <><Loader2 className="h-4 w-4 animate-spin" /><span className="sr-only">Sending</span></> : (confirmingAsk ? 'Tap to confirm' : 'Ask to cancel')}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {session.workout ? (
        <Card className="mb-4" data-testid="session-detail-workout">
          <CardContent className="p-5">
            <div className="flex items-center justify-between gap-2">
              <SectionLabel>The plan</SectionLabel>
              <Badge variant="outline" className="shrink-0"><Dumbbell className="mr-1 h-3 w-3" /> {session.workout.name}</Badge>
            </div>
            {session.workout.description && <p className="mt-2 text-sm text-muted-foreground">{session.workout.description}</p>}
            <div className="mt-2 divide-y divide-border/70">
              {session.workout.exercises.map((exercise, index) => (
                <div key={exercise.id} className="flex items-center justify-between gap-2 py-2.5" data-testid="session-plan-exercise">
                  <p className="text-sm font-medium"><span className="mr-2 text-muted-foreground">{index + 1}.</span>{exercise.name}</p>
                  {(exercise.sets || exercise.reps) && (
                    <Badge variant="outline" className="shrink-0 tabular-nums">{exercise.sets || '?'} x {exercise.reps || '?'}</Badge>
                  )}
                </div>
              ))}
              {session.workout.exercises.length === 0 && (
                <p className="py-2 text-sm text-muted-foreground">Your coach will walk you through it.</p>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="mb-4" data-testid="session-detail-no-workout">
          <CardContent className="p-5">
            <SectionLabel>The plan</SectionLabel>
            <p className="mt-2 text-sm text-muted-foreground">Your coach hasn't attached a workout — come ready and they'll take it from there.</p>
          </CardContent>
        </Card>
      )}

      {session.shared_notes?.length > 0 && (
        <Card data-testid="session-detail-notes">
          <CardContent className="p-5">
            <SectionLabel>Coach notes</SectionLabel>
            <div className="mt-2 space-y-1.5">
              {session.shared_notes.map((note) => (
                <div key={note.id} className="flex gap-2 rounded-lg border border-primary/20 bg-primary/10 px-3 py-2">
                  <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <p className="whitespace-pre-wrap text-xs">{note.content}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        Need a different time? <Link to="/client/sessions" className="font-medium text-primary hover:underline">Rebook from Sessions</Link> or message your coach.
      </p>
    </div>
  );
}
