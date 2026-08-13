// Coach session detail: everything a coach works from for one session —
// when/where/who, the planned workout, live linked workout state, session
// notes, and every session action as a real button instead of a hidden menu.
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, errMsg } from '@/lib/api';
import { LoadingScreen, LoadErrorState, StatusBadge, SectionLabel } from '@/components/common';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SessionEditorDrawer } from '@/components/SessionEditorDrawer';
import { SessionNotesDialog } from '@/components/SessionNotesDialog';
import {
  ArrowLeft, Check, Dumbbell, Loader2, MapPin, Pencil, StickyNote, UserX, X,
} from 'lucide-react';
import { fmtDay, fmtTime, fmtDateTime, initials } from '@/lib/format';
import { toast } from 'sonner';

export default function CoachSessionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [acting, setActing] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

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

  const act = async (run, successMessage) => {
    setActing(true);
    try {
      await run();
      if (successMessage) toast.success(successMessage);
      await load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setActing(false);
      setConfirmingCancel(false);
    }
  };

  const complete = () => act(() => api.patch(`/sessions/${session.id}/complete`), 'Session completed');
  const markNoShow = () => act(() => api.patch(`/sessions/${session.id}/no-show`), 'Marked as a no-show');
  const cancel = () => {
    if (!confirmingCancel) { setConfirmingCancel(true); return; }
    act(() => api.patch(`/sessions/${session.id}/cancel`), 'Session cancelled');
  };

  if (!session && loadError) return <LoadErrorState message={loadError} scope="coach-session-detail" onRetry={() => { setLoadError(null); load(); }} />;
  if (!session) return <LoadingScreen />;

  const liveLog = (session.linked_workout_logs || []).find((log) => log.status === 'active')
    || (session.linked_workout_logs || []).find((log) => log.status === 'completed')
    || null;
  const started = new Date(session.scheduled_at).getTime() <= Date.now();
  // Server-authoritative guard mirrored for the UI: approving a future
  // day's session is always a mis-tap, so don't offer it.
  const futureDay = new Date(session.scheduled_at).setHours(0, 0, 0, 0) > new Date().setHours(0, 0, 0, 0);

  return (
    <div>
      <button
        type="button"
        onClick={() => navigate('/coach/sessions')}
        className="mb-3 inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground hover:text-foreground"
        data-testid="session-detail-back"
      >
        <ArrowLeft className="h-4 w-4" /> Sessions
      </button>

      <Card className="mb-4 border-primary/40 bg-card shadow-[var(--app-elev)]" data-testid="coach-session-detail-card">
        <CardContent className="p-6">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">Session</p>
            <StatusBadge status={session.status} testId="coach-session-detail-status" />
          </div>
          <h1 className="mt-1 font-display text-4xl font-semibold tracking-tight">
            {fmtDay(session.scheduled_at)} <span className="text-primary">{fmtTime(session.scheduled_at)}</span>
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
            {session.client?.name && (
              <Link
                to={`/coach/clients/${session.client_id}`}
                className="flex items-center gap-1.5 rounded-md hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid="session-detail-client-link"
              >
                <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">
                  {initials(session.client.name)}
                </span>
                {session.duration_minutes} min with {session.client.name}
              </Link>
            )}
            {session.location && <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {session.location}</span>}
          </div>
          {session.status === 'scheduled' && liveLog?.status === 'active' && (
            <p className="mt-3 flex items-center gap-1.5 text-sm font-medium text-primary" data-testid="session-live-chip">
              <span aria-hidden className="h-2 w-2 rounded-full bg-primary motion-safe:animate-pulse" /> In the gym now
            </p>
          )}
          {session.status === 'scheduled' && liveLog?.status === 'completed' && (
            <p className="mt-3 flex items-center gap-1.5 text-sm font-medium text-gold" data-testid="session-workout-done-chip">
              <Dumbbell className="h-4 w-4" /> Workout done{liveLog.quick_completed ? ' (not tracked)' : ''} — confirm below
            </p>
          )}
          {session.status === 'scheduled' && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {!futureDay && (
                <Button className="min-h-11 rounded-xl font-semibold" disabled={acting} onClick={complete} data-testid="session-detail-complete">
                  {acting ? <><Loader2 className="h-4 w-4 animate-spin" /><span className="sr-only">Working</span></> : <><Check className="mr-1.5 h-4 w-4" /> Complete</>}
                </Button>
              )}
              {started && (
                <Button variant="outline" className="min-h-11 rounded-xl" disabled={acting} onClick={markNoShow} data-testid="session-detail-no-show">
                  <UserX className="mr-1.5 h-4 w-4" /> No-show
                </Button>
              )}
              <Button variant="outline" className="min-h-11 rounded-xl" onClick={() => setEditOpen(true)} data-testid="session-detail-edit">
                <Pencil className="mr-1.5 h-4 w-4" /> Edit
              </Button>
              <Button
                variant="ghost"
                className={`min-h-11 rounded-xl ${confirmingCancel ? 'bg-destructive/10 text-destructive' : 'text-muted-foreground hover:bg-destructive/10 hover:text-destructive'}`}
                disabled={acting}
                onClick={cancel}
                data-testid="session-detail-cancel"
              >
                {confirmingCancel ? 'Tap to confirm' : <><X className="mr-1.5 h-4 w-4" /> Cancel</>}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {(session.linked_workout_logs || []).length > 0 && (
        <Card className="mb-4" data-testid="session-detail-linked-logs">
          <CardContent className="p-5">
            <SectionLabel>Workout activity</SectionLabel>
            <div className="mt-2 divide-y divide-border/70">
              {session.linked_workout_logs.map((log) => (
                <Link
                  key={log.id}
                  to={`/coach/workouts/${log.id}`}
                  className="flex min-h-11 items-center justify-between gap-2 py-2.5 rounded-md hover:bg-card/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  data-testid="session-linked-log-row"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{log.workout_name || 'Workout'}</span>
                    <span className="block text-xs text-muted-foreground">
                      {log.status === 'active'
                        ? `Started ${fmtDateTime(log.started_at)}`
                        : `Completed ${fmtDateTime(log.completed_at)}${log.quick_completed ? ' (not tracked)' : ''}`}
                    </span>
                  </span>
                  {log.status === 'active' ? (
                    <Badge variant="outline" className="shrink-0 bg-primary/15 text-primary border-primary/25">In progress</Badge>
                  ) : (
                    <StatusBadge status={log.status} />
                  )}
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

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
                <p className="py-2 text-sm text-muted-foreground">No exercises in this workout yet.</p>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="mb-4" data-testid="session-detail-no-workout">
          <CardContent className="p-5">
            <SectionLabel>The plan</SectionLabel>
            <p className="mt-2 text-sm text-muted-foreground">
              No workout attached. {session.status === 'scheduled' ? 'Attach one with Edit so the client sees the plan.' : ''}
            </p>
          </CardContent>
        </Card>
      )}

      <Card data-testid="session-detail-notes">
        <CardContent className="p-5">
          <div className="flex items-center justify-between gap-2">
            <SectionLabel>Session notes</SectionLabel>
            <Button size="sm" variant="outline" className="min-h-11 rounded-lg" onClick={() => setNotesOpen(true)} data-testid="session-detail-notes-button">
              <StickyNote className="mr-1.5 h-3.5 w-3.5" /> Notes
            </Button>
          </div>
          {(session.notes || []).length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No notes yet.</p>
          ) : (
            <div className="mt-2 space-y-1.5">
              {session.notes.map((note) => (
                <div key={note.id} className="rounded-lg border border-border bg-card/60 px-3 py-2" data-testid="session-detail-note-row">
                  <p className="whitespace-pre-wrap text-xs">{note.content}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {fmtDateTime(note.created_at)}{note.shared_with_client ? ' · shared with client' : ' · private'}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {session.status !== 'cancelled' && (
        <div className="mt-3">
          <Button
            variant="outline"
            className="min-h-11 rounded-xl"
            onClick={() => navigate(`/coach/clients/${session.client_id}?tab=programs&session=${session.id}`)}
            data-testid="session-detail-log-workout"
          >
            <Dumbbell className="mr-1.5 h-4 w-4" /> Log workout for this session
          </Button>
        </div>
      )}

      <SessionEditorDrawer
        open={editOpen}
        onOpenChange={setEditOpen}
        clients={session.client ? [session.client] : []}
        editing={editOpen ? session : null}
        onSaved={() => { setEditOpen(false); load(); }}
      />
      <SessionNotesDialog session={notesOpen ? session : null} onClose={() => { setNotesOpen(false); load(); }} />
    </div>
  );
}
