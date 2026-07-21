import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { m, useReducedMotion } from 'framer-motion';
import { ArrowLeft, Check, CircleSlash2, Clock3, MessageSquare } from 'lucide-react';
import { api, errMsg } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { fmtDateTime } from '@/lib/format';
import { LoadingScreen, LoadErrorState, PageHeader } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { MOTION_EASINGS, WORKOUT_COMPLETION_MOTION, msToSeconds } from '@/lib/motion';
import { useVisualIntensity } from '@/lib/visualIntensity';
import { useNotifications } from '@/context/NotificationsContext';

export default function WorkoutLogDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [log, setLog] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [readError, setReadError] = useState(null);
  const [responseContent, setResponseContent] = useState('');
  const [responseError, setResponseError] = useState(null);
  const [savingResponse, setSavingResponse] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const readAttemptedFor = useRef(null);
  const isClient = user.role === 'client';
  const isCoach = user.role === 'coach' || user.role === 'admin';
  const { refresh: refreshUnread } = useNotifications();
  const reducedMotion = useReducedMotion();
  const intensity = useVisualIntensity();
  const [completionSignalId, setCompletionSignalId] = useState(() => (
    isClient && location.state?.completedWorkoutId === id ? id : null
  ));
  const celebrateCompletion = isClient && completionSignalId === id;
  const completionRecipe = WORKOUT_COMPLETION_MOTION[intensity];

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/workout-logs/${id}`);
      setLog(data);
      setLoadError(null);
      if (isCoach) {
        const ownResponse = (data.coach_responses || []).find((response) => response.author_coach_id === user.profile?.id);
        setResponseContent(ownResponse?.content || '');
      }
      if (isClient && readAttemptedFor.current !== id && (data.coach_responses || []).some((response) => !response.read_at)) {
        readAttemptedFor.current = id;
        try {
          const { data: readResult } = await api.patch(`/workout-logs/${id}/coach-feedback/read`);
          const readAt = readResult.read_at;
          setLog((current) => ({
            ...current,
            coach_responses: (current.coach_responses || []).map((response) => (
              response.read_at || !readAt ? response : { ...response, read_at: readAt }
            )),
          }));
          setReadError(null);
          setAnnouncement('Coach feedback marked read');
          await refreshUnread();
        } catch {
          setReadError("Couldn't mark coach feedback read. It will stay new until a retry succeeds.");
        }
      } else if (isClient) {
        setReadError(null);
      }
    } catch (error) {
      setLoadError(errMsg(error, 'Failed to load workout'));
    }
  }, [id, isClient, isCoach, refreshUnread, user.profile?.id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    setCompletionSignalId((current) => (current === id ? current : null));
  }, [id]);
  useEffect(() => {
    if (!isClient || !location.state?.completedWorkoutId) return;
    if (location.state.completedWorkoutId === id) setCompletionSignalId(id);
    navigate(
      { pathname: location.pathname, search: location.search, hash: location.hash },
      { replace: true, state: null },
    );
  }, [id, isClient, location.hash, location.pathname, location.search, location.state, navigate]);
  if (!log && loadError) return <LoadErrorState message={loadError} scope="workout-detail" onRetry={load} />;
  if (!log) return <LoadingScreen />;

  const completed = log.exercises.flatMap((exercise) => exercise.sets).filter((set) => set.status === 'completed').length;
  const skipped = log.exercises.flatMap((exercise) => exercise.sets).filter((set) => set.status === 'skipped').length;
  const ownResponse = (log.coach_responses || []).find((response) => response.author_coach_id === user.profile?.id);
  const responseLength = Array.from(responseContent.trim()).length;

  const saveResponse = async (event) => {
    event.preventDefault();
    const content = responseContent.trim();
    if (!content) {
      setResponseError('Enter a response for your client.');
      return;
    }
    if (Array.from(content).length > 4000) {
      setResponseError('Coach response must be 4,000 characters or fewer.');
      return;
    }
    setSavingResponse(true);
    setResponseError(null);
    try {
      const { data } = await api.put(`/workout-logs/${id}/coach-response`, { content });
      await load();
      setAnnouncement(data.outcome === 'created' ? 'Coach response added' : 'Coach response updated');
    } catch (error) {
      setResponseError(errMsg(error, 'Failed to save coach response'));
    } finally {
      setSavingResponse(false);
    }
  };

  const retryMarkRead = () => {
    readAttemptedFor.current = null;
    load();
  };

  return (
    <div>
      <button type="button" onClick={() => navigate(-1)} className="mb-3 inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>
      <m.section
        initial={celebrateCompletion && !reducedMotion
          ? { opacity: 0, transform: `translateY(${completionRecipe.distance}px) scale(${completionRecipe.initialScale})` }
          : false}
        animate={{ opacity: 1, transform: 'translateY(0px) scale(1)' }}
        transition={{ duration: msToSeconds(completionRecipe.durationMs), ease: MOTION_EASINGS.expressiveOut }}
        data-testid="workout-completion-summary"
        data-completion-motion={celebrateCompletion ? 'active' : 'none'}
        data-motion-duration-ms={celebrateCompletion ? completionRecipe.durationMs : undefined}
        data-motion-distance={celebrateCompletion ? completionRecipe.distance : undefined}
        data-motion-initial-scale={celebrateCompletion ? completionRecipe.initialScale : undefined}
        data-motion-reduced={reducedMotion ? 'true' : 'false'}
      >
        {celebrateCompletion && <div className="sr-only" role="status" aria-live="polite">Workout complete</div>}
        <PageHeader title={log.workout_name} subtitle={log.completed_at ? `Completed ${fmtDateTime(log.completed_at)}` : `Started ${fmtDateTime(log.started_at)}`} />
        <div className="mb-4 flex flex-wrap gap-2">
          <Badge variant="outline" className="bg-success/10 text-success-foreground"><Check className="mr-1 h-3.5 w-3.5" /> {completed} completed</Badge>
          {skipped > 0 && <Badge variant="outline"><CircleSlash2 className="mr-1 h-3.5 w-3.5" /> {skipped} skipped</Badge>}
          <Badge variant="outline"><Clock3 className="mr-1 h-3.5 w-3.5" /> {log.status}</Badge>
        </div>
      </m.section>
      <div className="space-y-3">
        {log.exercises.map((exercise) => (
          <Card key={exercise.id}>
            <CardHeader className="pb-2"><CardTitle className="font-display text-lg">{exercise.exercise_name}</CardTitle></CardHeader>
            <CardContent>
              <div className="mb-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                {exercise.prescribed_reps && <span>Reps {exercise.prescribed_reps}</span>}
                {exercise.prescribed_rpe && <span>RPE {exercise.prescribed_rpe}</span>}
                {exercise.prescribed_rest && <span>Rest {exercise.prescribed_rest}</span>}
                {exercise.prescribed_tempo && <span>Tempo {exercise.prescribed_tempo}</span>}
              </div>
              <div className="divide-y divide-border/70">
                {exercise.sets.map((set) => (
                  <div key={set.id} className="grid min-h-11 grid-cols-[2.5rem_1fr_auto] items-center gap-2 py-2 text-sm">
                    <span className="tabular-nums text-muted-foreground">{set.set_number}</span>
                    <span>{set.actual_load_value === null ? 'No weight logged' : `${set.actual_load_value} ${set.actual_load_unit}`}</span>
                    <Badge variant={set.status === 'completed' ? 'default' : 'outline'}>{set.status}</Badge>
                  </div>
                ))}
              </div>
              {exercise.client_notes && <p className="mt-3 rounded-md bg-secondary px-3 py-2 text-sm">{exercise.client_notes}</p>}
            </CardContent>
          </Card>
        ))}
      </div>
      {readError && (
        <div className="mt-4 flex flex-col gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm sm:flex-row sm:items-center sm:justify-between" role="alert" data-testid="coach-feedback-read-error">
          <span>{readError}</span>
          <Button type="button" variant="outline" size="sm" onClick={retryMarkRead}>Retry</Button>
        </div>
      )}
      {(log.feedback || log.notes) && (
        <Card className="mt-4"><CardContent className="space-y-3 p-4">
          {log.feedback && <div><p className="text-xs font-medium uppercase text-muted-foreground">{isClient ? 'Your feedback to your coach' : 'Client feedback'}</p><p className="mt-1 whitespace-pre-wrap text-sm">{log.feedback}</p></div>}
          {log.notes && <div><p className="text-xs font-medium uppercase text-muted-foreground">Workout notes</p><p className="mt-1 text-sm">{log.notes}</p></div>}
        </CardContent></Card>
      )}
      <Card className="mt-4" data-testid="coach-responses-card">
        <CardHeader className="pb-2"><CardTitle className="font-display text-lg">Coach responses</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {(log.coach_responses || []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No coach response yet.</p>
          ) : (log.coach_responses || []).map((response) => (
            <article key={response.id} className="rounded-md border border-border bg-card/60 p-3" data-testid="coach-response">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">{response.author_name_snapshot}</p>
                <p className="text-xs text-muted-foreground">
                  {fmtDateTime(response.created_at)}
                  {response.edited_at && <span className="ml-2" data-testid="coach-response-edited">Edited</span>}
                </p>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm">{response.content}</p>
            </article>
          ))}
          {isCoach && log.status === 'completed' && (
            <form className="space-y-2 border-t border-border pt-4" onSubmit={saveResponse} data-testid="coach-response-form">
              <Label htmlFor="coach-response-content">{ownResponse ? 'Edit your response' : 'Add your response'}</Label>
              <Textarea
                id="coach-response-content"
                rows={4}
                maxLength={4000}
                value={responseContent}
                onChange={(event) => setResponseContent(event.target.value)}
                aria-describedby="coach-response-help"
                aria-invalid={Boolean(responseError)}
                data-testid="coach-response-input"
              />
              <div id="coach-response-help" className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>Visible to this client.</span><span>{responseLength}/4,000</span>
              </div>
              {responseError && <p className="text-sm text-destructive" role="alert">{responseError}</p>}
              <Button type="submit" disabled={savingResponse} className="min-h-11" data-testid="coach-response-save">
                {savingResponse ? 'Saving…' : ownResponse ? 'Update response' : 'Add response'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
      <div className="sr-only" role="status" aria-live="polite" data-testid="coach-feedback-announcement">{announcement}</div>
      {!isClient && log.client && (
        <Button asChild className="mb-16 mt-5 min-h-11 w-full sm:mb-0 sm:w-auto">
          <Link to={`/coach/messages/${log.client.id}`}><MessageSquare className="mr-2 h-4 w-4" /> Message client</Link>
        </Button>
      )}
    </div>
  );
}
