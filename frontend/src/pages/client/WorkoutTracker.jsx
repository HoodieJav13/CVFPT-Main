import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Bell, BellOff, Check, ChevronDown, CircleAlert, Clock3, History, Loader2, Plus, Save, Trash2, WifiOff } from 'lucide-react';
import { api, errMsg } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { LoadingScreen, LoadErrorState, PageHeader } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { ATTENTION_FEEDBACK_MOTION } from '@/lib/motion';
import { useVisualIntensity } from '@/lib/visualIntensity';
import { makeId, updateExercise, useWorkoutOutbox } from '@/lib/workoutOutbox';
import { formatRestSeconds } from '@/lib/rest';

// The rest timer reads prescribed_rest_seconds — the structured column the
// database parses and backfills. The old runtime text parser is gone; text
// only survives as a display fallback for legacy completed snapshots.

function formatTimer(seconds) {
  const safe = Math.max(0, seconds);
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

function displayPerformed(value, suffix = '') {
  return value === null || value === undefined ? 'Not recorded' : `${value}${suffix}`;
}

function isBlank(value) {
  return value === '' || value === null || value === undefined;
}

function ExerciseHistory({ logId, exercise }) {
  const [open, setOpen] = useState(false);
  const [occurrences, setOccurrences] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [attempted, setAttempted] = useState(false);

  const loadHistory = async (cursor = null) => {
    setAttempted(true);
    if (!navigator.onLine) {
      setError('You are offline. Reconnect to load exercise history.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get(`/workout-logs/${logId}/exercises/${exercise.id}/history`, {
        params: cursor ? { cursor } : undefined,
      });
      setOccurrences((current) => cursor ? [...current, ...data.occurrences] : data.occurrences);
      setNextCursor(data.next_cursor);
    } catch (requestError) {
      setError(errMsg(requestError, 'Failed to load exercise history'));
    } finally {
      setLoading(false);
    }
  };

  const toggle = () => {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen && !attempted) loadHistory();
  };

  return (
    <div className="border-t border-border/70 pt-3" data-testid="exercise-history">
      <Button type="button" variant="ghost" size="sm" className="min-h-11 px-2" onClick={toggle} aria-expanded={open}>
        <History className="mr-1.5 h-4 w-4" /> Exercise history
        <ChevronDown className={`ml-1.5 h-4 w-4 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
      </Button>
      {open && (
        <div className="mt-2 space-y-3 rounded-lg bg-secondary/40 p-3" aria-live="polite">
          {loading && !occurrences.length && <p className="text-sm text-muted-foreground"><Loader2 className="mr-1.5 inline h-4 w-4 animate-spin motion-reduce:animate-none" />Loading history…</p>}
          {error && <div role="alert" className="space-y-2 text-sm"><p>{error}</p><Button type="button" size="sm" variant="outline" onClick={() => loadHistory(nextCursor && occurrences.length ? nextCursor : null)}>Retry</Button></div>}
          {!loading && !error && attempted && occurrences.length === 0 && <p className="text-sm text-muted-foreground">No completed history yet.</p>}
          {occurrences.map((occurrence) => (
            <section key={occurrence.workout_log_id} className="space-y-2" data-testid="history-occurrence">
              <div><p className="text-sm font-medium">{occurrence.exercise_name}</p><p className="text-xs text-muted-foreground">{new Date(occurrence.completed_at).toLocaleDateString()}</p></div>
              <div className="space-y-1">
                {occurrence.sets.map((set) => (
                  <div key={set.set_number} className="grid grid-cols-[2rem_repeat(3,minmax(0,1fr))] gap-2 text-xs">
                    <span>Set {set.set_number}</span>
                    <span>Weight: {displayPerformed(set.actual_load_value, set.actual_load_unit ? ` ${set.actual_load_unit}` : '')}</span>
                    <span>Reps: {displayPerformed(set.actual_reps)}</span>
                    <span>RPE: {displayPerformed(set.actual_rpe)}</span>
                  </div>
                ))}
              </div>
            </section>
          ))}
          {nextCursor && !error && <Button type="button" size="sm" variant="outline" disabled={loading} onClick={() => loadHistory(nextCursor)}>{loading ? 'Loading…' : 'Load more'}</Button>}
        </div>
      )}
    </div>
  );
}

export default function WorkoutTracker() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isCoach = user.role === 'coach' || user.role === 'admin';
  const basePath = isCoach ? '/coach' : '/client';
  const [log, setLog] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [finishOpen, setFinishOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [workoutNotes, setWorkoutNotes] = useState('');
  const [finishing, setFinishing] = useState(false);
  const [restEndsAt, setRestEndsAt] = useState(null);
  const [timerNow, setTimerNow] = useState(Date.now());
  const [lastTimeLoading, setLastTimeLoading] = useState(null);
  const [restAlerts, setRestAlerts] = useState(() => localStorage.getItem('cvf_rest_alerts') === 'on');
  const lastTimeCache = useRef({});
  const restAnnouncedRef = useRef(false);
  const intensity = useVisualIntensity();
  const outbox = useWorkoutOutbox(id, setLog);
  const hydratePending = outbox.hydrate;
  const restStorageKey = `cvf_rest_timer_${id}`;

  // A running rest timer survives reloads and app switches: the end
  // timestamp persists per log and is restored while still in the future.
  const startRest = (seconds) => {
    const endsAt = Date.now() + (seconds * 1000);
    localStorage.setItem(restStorageKey, String(endsAt));
    setTimerNow(Date.now());
    setRestEndsAt(endsAt);
  };
  const clearRest = () => {
    localStorage.removeItem(restStorageKey);
    setRestEndsAt(null);
  };
  useEffect(() => {
    const stored = Number(localStorage.getItem(restStorageKey));
    if (stored && stored > Date.now()) {
      setTimerNow(Date.now());
      setRestEndsAt(stored);
    } else if (stored) {
      localStorage.removeItem(restStorageKey);
    }
  }, [restStorageKey]);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/workout-logs/${id}`);
      if (data.status !== 'active') {
        navigate(`${basePath}/workouts/${id}`, { replace: true });
        return;
      }
      setLog(hydratePending(data));
      setLoadError(null);
    } catch (error) {
      setLoadError(errMsg(error, 'Failed to load workout'));
    }
  }, [basePath, hydratePending, id, navigate]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!restEndsAt) return undefined;
    let timer;
    const tick = () => {
      const now = Date.now();
      setTimerNow(now);
      if (now >= restEndsAt) window.clearInterval(timer);
    };
    timer = window.setInterval(tick, 250);
    tick();
    return () => window.clearInterval(timer);
  }, [restEndsAt]);

  // Opt-in end-of-rest cue: fires once per timer, only when enabled, and
  // only through capabilities the device actually has.
  const restIsComplete = Boolean(restEndsAt && timerNow >= restEndsAt);
  useEffect(() => {
    if (!restIsComplete) {
      restAnnouncedRef.current = false;
      return;
    }
    if (restAnnouncedRef.current || !restAlerts) return;
    restAnnouncedRef.current = true;
    try {
      if (typeof navigator.vibrate === 'function') navigator.vibrate(200);
    } catch { /* capability declined */ }
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        const context = new AudioCtx();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.frequency.value = 880;
        gain.gain.value = 0.05;
        oscillator.start();
        oscillator.stop(context.currentTime + 0.18);
        oscillator.onended = () => context.close();
      }
    } catch { /* audio unavailable or blocked */ }
  }, [restIsComplete, restAlerts]);

  const toggleRestAlerts = () => {
    setRestAlerts((current) => {
      localStorage.setItem('cvf_rest_alerts', current ? 'off' : 'on');
      return !current;
    });
  };

  if (!log && loadError) return <LoadErrorState message={loadError} scope="workout-tracker" onRetry={load} />;
  if (!log) return <LoadingScreen />;

  const allSets = log.exercises.flatMap((exercise) => exercise.sets);
  const completedCount = allSets.filter((set) => set.status === 'completed').length;
  const remainingCount = allSets.filter((set) => set.status === 'pending').length;
  const restSeconds = restEndsAt ? Math.max(0, Math.ceil((restEndsAt - timerNow) / 1000)) : 0;
  const restComplete = Boolean(restEndsAt && timerNow >= restEndsAt);
  const sealed = outbox.queuedComplete;
  const attentionRecipe = ATTENTION_FEEDBACK_MOTION[intensity];

  const setLocalValue = (exerciseId, setId, key, value) => {
    setLog((current) => updateExercise(current, exerciseId, (exercise) => ({
      ...exercise,
      sets: exercise.sets.map((set) => set.id === setId ? { ...set, [key]: value } : set),
    })));
    outbox.markDirty();
  };

  const saveSet = (exercise, set) => {
    const blank = set.actual_load_value === '' || set.actual_load_value === null;
    outbox.enqueue({
      kind: 'set', exerciseId: exercise.id, setId: set.id,
      method: 'patch', url: `/workout-logs/${id}/sets/${set.id}`,
      data: {
        actual_load_value: blank ? null : Number(set.actual_load_value),
        actual_load_unit: blank ? null : (set.actual_load_unit || 'lb'),
        actual_reps: set.actual_reps === '' || set.actual_reps == null ? null : Number(set.actual_reps),
        actual_rpe: set.actual_rpe === '' || set.actual_rpe == null ? null : Number(set.actual_rpe),
        status: set.status,
      },
    });
  };

  const toggleSet = (exercise, set) => {
    const status = set.status === 'completed' ? 'pending' : 'completed';
    outbox.enqueue({
      kind: 'set', exerciseId: exercise.id, setId: set.id,
      method: 'patch', url: `/workout-logs/${id}/sets/${set.id}`,
      data: { status, actual_load_value: set.actual_load_value, actual_load_unit: set.actual_load_unit,
        actual_reps: set.actual_reps === '' || set.actual_reps == null ? null : Number(set.actual_reps),
        actual_rpe: set.actual_rpe === '' || set.actual_rpe == null ? null : Number(set.actual_rpe) },
    });
    if (status === 'completed' && exercise.prescribed_rest_seconds > 0) {
      startRest(exercise.prescribed_rest_seconds);
    }
  };

  const addSet = (exercise) => {
    const operationId = makeId();
    outbox.enqueue({
      kind: 'add', exerciseId: exercise.id, clientOperationId: operationId,
      method: 'post', url: `/workout-logs/${id}/exercises/${exercise.id}/sets`,
      data: { client_operation_id: operationId },
    });
  };

  const removeSet = (exercise, set) => {
    outbox.enqueue({
      kind: 'archive', exerciseId: exercise.id, setId: set.id,
      method: 'patch', url: `/workout-logs/${id}/sets/${set.id}/archive`, data: {},
    });
  };

  const saveNotes = (exercise) => {
    outbox.enqueue({
      kind: 'note', exerciseId: exercise.id,
      method: 'patch', url: `/workout-logs/${id}/exercises/${exercise.id}/notes`,
      data: { client_notes: exercise.client_notes || '' },
    });
  };

  // One tap fills blank fields from the most recent completed occurrence of
  // this exercise; typed values are never overwritten.
  const applyLastTime = async (exercise) => {
    if (sealed || lastTimeLoading) return;
    let occurrence = lastTimeCache.current[exercise.id];
    if (occurrence === undefined) {
      if (!navigator.onLine) {
        toast.error('You are offline. Reconnect to copy last time.');
        return;
      }
      setLastTimeLoading(exercise.id);
      try {
        const { data } = await api.get(`/workout-logs/${id}/exercises/${exercise.id}/history`);
        occurrence = data.occurrences[0] || null;
        lastTimeCache.current[exercise.id] = occurrence;
      } catch (error) {
        toast.error(errMsg(error, 'Failed to load last time'));
        return;
      } finally {
        setLastTimeLoading(null);
      }
    }
    if (!occurrence) {
      toast.info('No completed history yet for this exercise.');
      return;
    }
    const bySetNumber = new Map(occurrence.sets.map((row) => [row.set_number, row]));
    let filledCount = 0;
    for (const set of exercise.sets) {
      const last = bySetNumber.get(set.set_number);
      if (!last) continue;
      const fillLoad = isBlank(set.actual_load_value) && last.actual_load_value != null;
      const fillReps = isBlank(set.actual_reps) && last.actual_reps != null;
      const fillRpe = isBlank(set.actual_rpe) && last.actual_rpe != null;
      if (!fillLoad && !fillReps && !fillRpe) continue;
      filledCount += 1;
      const loadValue = fillLoad ? last.actual_load_value : set.actual_load_value;
      outbox.enqueue({
        kind: 'set', exerciseId: exercise.id, setId: set.id,
        method: 'patch', url: `/workout-logs/${id}/sets/${set.id}`,
        data: {
          actual_load_value: isBlank(loadValue) ? null : Number(loadValue),
          actual_load_unit: isBlank(loadValue) ? null : ((fillLoad ? last.actual_load_unit : set.actual_load_unit) || 'lb'),
          actual_reps: fillReps ? last.actual_reps : (isBlank(set.actual_reps) ? null : Number(set.actual_reps)),
          actual_rpe: fillRpe ? last.actual_rpe : (isBlank(set.actual_rpe) ? null : Number(set.actual_rpe)),
          status: set.status,
        },
      });
    }
    if (!filledCount) {
      toast.info('Nothing blank to fill — your entries are kept.');
      return;
    }
    toast.success(`Filled ${filledCount} set${filledCount === 1 ? '' : 's'} from ${new Date(occurrence.completed_at).toLocaleDateString()}`);
  };

  const completeAll = async () => {
    if (!outbox.online || outbox.saveState !== 'saved') return;
    try {
      const { data } = await api.post(`/workout-logs/${id}/complete-all`);
      setLog(data);
      toast.success('Remaining sets completed');
    } catch (error) {
      toast.error(errMsg(error));
    }
  };

  const finish = async () => {
    setFinishing(true);
    try {
      // Queue the completion behind any pending set writes (FIFO). The
      // performance timestamp is captured at confirmation, not at sync
      // (docs/offline-workout-completion.md).
      outbox.enqueue({
        kind: 'complete',
        method: 'post',
        url: `/workout-logs/${id}/complete`,
        data: {
          notes: workoutNotes,
          feedback: isCoach ? '' : feedback,
          completed_at_local: new Date().toISOString(),
        },
      });
      const flushed = await outbox.flush();
      localStorage.removeItem(restStorageKey);
      navigate(`${basePath}/workouts/${id}`, {
        replace: true,
        state: flushed ? { completedWorkoutId: id } : { finishedLocally: true },
      });
    } finally {
      setFinishing(false);
    }
  };

  const abandon = async () => {
    if (!window.confirm('Abandon this workout? Saved progress will remain out of the completed history.')) return;
    try {
      await api.post(`/workout-logs/${id}/abandon`);
      localStorage.removeItem(`cvf_workout_outbox_${id}`);
      localStorage.removeItem(restStorageKey);
      navigate(isCoach ? `/coach/clients/${log.client_id}` : '/client/programs', { replace: true });
    } catch (error) {
      toast.error(errMsg(error));
    }
  };

  return (
    <div data-testid="workout-tracker">
      <PageHeader
        title={log.workout_name}
        subtitle={`${completedCount} of ${allSets.length} sets complete${isCoach && log.client?.name ? ` — logging for ${log.client.name}` : ''}`}
        action={<Button variant="ghost" size="sm" onClick={abandon}>Abandon</Button>}
      />
      {outbox.queuedComplete && (
        <div className="mb-4 flex flex-col gap-2 rounded-xl border border-gold/35 bg-gold/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between" data-testid="finished-locally-banner">
          <p className="text-sm font-medium">Finished on this phone — waiting to sync. Editing is locked so the finished workout stays exactly as you left it.</p>
          <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={outbox.removeQueuedComplete} data-testid="keep-editing-button">
            Keep editing instead
          </Button>
        </div>
      )}
      <div className="mb-4 flex items-center gap-2 text-xs" aria-live="polite" data-testid="workout-save-state">
        {outbox.saveState === 'saved' && <><Save className="h-3.5 w-3.5 text-success" /> Saved</>}
        {outbox.saveState === 'saving' && <><Loader2 className="h-3.5 w-3.5 animate-spin text-primary motion-reduce:animate-none" /> Saving</>}
        {outbox.saveState === 'not_saved' && <><CircleAlert className="h-3.5 w-3.5 text-gold" /> Not saved yet</>}
        {!outbox.online && <Badge variant="outline"><WifiOff className="mr-1 h-3.5 w-3.5" /> Offline</Badge>}
        <Button
          type="button" variant="ghost" size="sm"
          className="ml-auto min-h-11 px-2 text-xs text-muted-foreground"
          onClick={toggleRestAlerts}
          aria-pressed={restAlerts}
          aria-label={restAlerts ? 'Turn rest alerts off' : 'Turn rest alerts on'}
          data-testid="rest-alerts-toggle"
          data-rest-alerts={restAlerts ? 'on' : 'off'}
        >
          {restAlerts ? <Bell className="mr-1 h-3.5 w-3.5 text-primary" /> : <BellOff className="mr-1 h-3.5 w-3.5" />}
          Rest alerts {restAlerts ? 'on' : 'off'}
        </Button>
      </div>

      <div className="space-y-4">
        {log.exercises.map((exercise) => (
          <Card key={exercise.id} data-testid="tracker-exercise-card">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="font-display text-lg">{exercise.exercise_name}</CardTitle>
                <Badge
                  variant="outline"
                  className={`shrink-0 tabular-nums ${exercise.sets.length && exercise.sets.every((set) => set.status === 'completed') ? 'border-success/40 bg-success/10 text-success' : 'text-muted-foreground'}`}
                  aria-label={`${exercise.sets.filter((set) => set.status === 'completed').length} of ${exercise.sets.length} sets complete`}
                  data-testid="exercise-done-chip"
                >
                  {exercise.sets.filter((set) => set.status === 'completed').length}/{exercise.sets.length}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {exercise.prescribed_reps && <span>Reps {exercise.prescribed_reps}</span>}
                {exercise.prescribed_rpe && <span>RPE {exercise.prescribed_rpe}</span>}
                {(exercise.prescribed_rest_seconds != null || exercise.prescribed_rest) && (
                  <span>Rest {exercise.prescribed_rest_seconds != null ? formatRestSeconds(exercise.prescribed_rest_seconds) : exercise.prescribed_rest}</span>
                )}
                {exercise.prescribed_tempo && <span>Tempo {exercise.prescribed_tempo}</span>}
              </div>
              {exercise.prescribed_notes && <p className="text-xs text-muted-foreground">{exercise.prescribed_notes}</p>}
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-[1.75rem_minmax(5.5rem,1fr)_3.5rem_3.5rem_2.75rem] gap-1 px-1 text-xs font-medium text-muted-foreground">
                <span>Set</span><span>Weight</span><span>Reps</span><span>RPE</span><span className="sr-only">Complete</span>
              </div>
              {exercise.sets.map((set) => (
                <div key={set.id} className={`grid min-h-12 grid-cols-[1.75rem_minmax(5.5rem,1fr)_3.5rem_3.5rem_2.75rem] items-center gap-1 rounded-md px-1 ${set.status === 'completed' ? 'bg-success/10' : 'bg-secondary/50'}`}>
                  <span className="text-center text-sm tabular-nums">{set.set_number}</span>
                  <div className="flex min-w-0 gap-1">
                    <Input
                      type="number" min="0" step="0.5" inputMode="decimal" className="h-10 min-w-0 px-2 text-sm tabular-nums"
                      value={set.actual_load_value ?? ''}
                      placeholder={exercise.prescribed_load_value != null ? String(exercise.prescribed_load_value) : undefined}
                      onChange={(event) => setLocalValue(exercise.id, set.id, 'actual_load_value', event.target.value)}
                      onBlur={() => saveSet(exercise, set)}
                      disabled={sealed}
                      aria-label={`${exercise.exercise_name} set ${set.set_number} weight`}
                    />
                    <Select value={set.actual_load_unit || exercise.prescribed_load_unit || 'lb'} onValueChange={(value) => {
                      setLocalValue(exercise.id, set.id, 'actual_load_unit', value);
                      outbox.enqueue({
                        kind: 'set', exerciseId: exercise.id, setId: set.id,
                        method: 'patch', url: `/workout-logs/${id}/sets/${set.id}`,
                        data: {
                          actual_load_value: set.actual_load_value === '' || set.actual_load_value == null ? null : Number(set.actual_load_value),
                          actual_load_unit: set.actual_load_value === '' || set.actual_load_value == null ? null : value,
                          actual_reps: set.actual_reps === '' || set.actual_reps == null ? null : Number(set.actual_reps),
                          actual_rpe: set.actual_rpe === '' || set.actual_rpe == null ? null : Number(set.actual_rpe),
                          status: set.status,
                        },
                      });
                    }}>
                      <SelectTrigger
                        className="h-10 w-14 shrink-0 px-1.5"
                        aria-label={`${exercise.exercise_name} set ${set.set_number} weight unit`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent><SelectItem value="lb">lb</SelectItem><SelectItem value="kg">kg</SelectItem></SelectContent>
                    </Select>
                  </div>
                  <Input type="number" min="0" step="1" inputMode="numeric" className="h-10 px-2 text-sm tabular-nums" value={set.actual_reps ?? ''}
                    placeholder={exercise.prescribed_reps || undefined}
                    onChange={(event) => setLocalValue(exercise.id, set.id, 'actual_reps', event.target.value)} onBlur={() => saveSet(exercise, set)} disabled={sealed}
                    aria-label={`${exercise.exercise_name} set ${set.set_number} performed reps`} />
                  <Input type="number" min="1" max="10" step="0.5" inputMode="decimal" className="h-10 px-2 text-sm tabular-nums" value={set.actual_rpe ?? ''}
                    placeholder={exercise.prescribed_rpe || undefined}
                    onChange={(event) => setLocalValue(exercise.id, set.id, 'actual_rpe', event.target.value)} onBlur={() => saveSet(exercise, set)} disabled={sealed}
                    aria-label={`${exercise.exercise_name} set ${set.set_number} performed RPE`} />
                  <Button
                    type="button" size="icon" variant={set.status === 'completed' ? 'default' : 'outline'}
                    className="h-11 w-11" disabled={sealed} onClick={() => toggleSet(exercise, set)}
                    aria-label={`${set.status === 'completed' ? 'Mark incomplete' : 'Complete'} set ${set.set_number}`}
                  >
                    <Check className="h-5 w-5" />
                  </Button>
                  {set.set_origin === 'extra' && (
                    <Button type="button" size="sm" variant="ghost" className="col-start-2 w-fit text-muted-foreground" onClick={() => removeSet(exercise, set)}>
                      <Trash2 className="mr-1 h-3.5 w-3.5" /> Remove extra set
                    </Button>
                  )}
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" disabled={sealed} onClick={() => addSet(exercise)}>
                  <Plus className="mr-1.5 h-4 w-4" /> Add set
                </Button>
                <Button
                  type="button" variant="outline" size="sm"
                  disabled={sealed || lastTimeLoading === exercise.id}
                  onClick={() => applyLastTime(exercise)}
                  data-testid="same-as-last-time"
                >
                  {lastTimeLoading === exercise.id
                    ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin motion-reduce:animate-none" />
                    : <History className="mr-1.5 h-4 w-4" />}
                  Same as last time
                </Button>
              </div>
              <ExerciseHistory logId={id} exercise={exercise} />
              <div className="space-y-1.5">
                <Label htmlFor={`notes-${exercise.id}`}>Exercise notes</Label>
                <Textarea
                  id={`notes-${exercise.id}`} rows={2} value={exercise.client_notes || ''}
                  onChange={(event) => {
                    setLog((current) => updateExercise(current, exercise.id, (row) => ({ ...row, client_notes: event.target.value })));
                    outbox.markDirty();
                  }}
                  onBlur={() => saveNotes(exercise)}
                />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div
        className="signature-glass sticky bottom-20 z-30 mt-5 flex flex-col gap-2 rounded-2xl p-2.5 lg:bottom-4"
        data-testid="workout-control-dock"
      >
        <div className="flex items-center gap-2 px-1">
          <div
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary"
            role="progressbar"
            aria-label="Sets completed"
            aria-valuemin={0}
            aria-valuemax={allSets.length}
            aria-valuenow={completedCount}
            data-testid="workout-progress-bar"
          >
            <div
              className={`h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none ${allSets.length && completedCount === allSets.length ? 'bg-success' : 'bg-primary'}`}
              style={{ width: `${allSets.length ? Math.round((completedCount / allSets.length) * 100) : 0}%` }}
            />
          </div>
          <span className="text-xs tabular-nums text-muted-foreground">{completedCount}/{allSets.length}</span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="min-h-11 flex-1" disabled={sealed || !remainingCount || !outbox.online || outbox.saveState !== 'saved'} onClick={completeAll}>
            Complete all remaining
          </Button>
          <Button className="min-h-11 flex-1" disabled={sealed || !completedCount} onClick={() => setFinishOpen(true)}>
            Finish workout
          </Button>
        </div>
      </div>

      {restEndsAt && (
        <>
          <Button
            type="button"
            onClick={clearRest}
            className={`signature-glass fixed bottom-40 right-4 z-40 h-14 min-w-28 rounded-full px-4 font-display text-base font-semibold lg:bottom-24 ${restComplete ? 'signature-glass-success motion-attention-pop-once hover:bg-success/90' : 'text-foreground hover:bg-card/80'}`}
            style={restComplete ? { '--motion-attention-scale': attentionRecipe.scale } : undefined}
            aria-label={restComplete ? 'Rest complete, tap to dismiss' : `Rest timer ${formatTimer(restSeconds)}, tap to stop`}
            data-testid="rest-timer"
            data-rest-state={restComplete ? 'complete' : 'running'}
          >
            <Clock3 className="h-5 w-5" /> {restComplete ? 'Rest complete' : formatTimer(restSeconds)}
          </Button>
          <div className="sr-only" role="status" aria-live="assertive" aria-atomic="true" data-testid="rest-complete-announcement">
            {restComplete ? 'Rest complete' : ''}
          </div>
        </>
      )}

      <Dialog open={finishOpen} onOpenChange={setFinishOpen}>
        <DialogContent className="signature-glass bg-card/80 sm:rounded-2xl" data-testid="workout-completion-dialog">
          <DialogHeader>
            <DialogTitle>Finish workout?</DialogTitle>
            <DialogDescription>{completedCount} completed and {remainingCount} remaining sets. Remaining sets will be recorded as skipped.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {!isCoach && <div className="space-y-1.5"><Label htmlFor="workout-feedback">Feedback for your coach</Label><Textarea id="workout-feedback" rows={4} value={feedback} onChange={(event) => setFeedback(event.target.value)} /></div>}
            <div className="space-y-1.5"><Label htmlFor="workout-notes">Workout notes</Label><Textarea id="workout-notes" rows={3} value={workoutNotes} onChange={(event) => setWorkoutNotes(event.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFinishOpen(false)}>Keep tracking</Button>
            <Button onClick={finish} disabled={finishing}>{finishing ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirm completion'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
