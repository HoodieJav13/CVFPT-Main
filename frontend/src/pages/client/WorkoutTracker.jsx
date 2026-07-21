import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Check, ChevronDown, CircleAlert, Clock3, History, Loader2, Plus, Save, Trash2, WifiOff } from 'lucide-react';
import { api, errMsg } from '@/lib/api';
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

function makeId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const value = Math.random() * 16 | 0;
    return (char === 'x' ? value : (value & 0x3) | 0x8).toString(16);
  });
}

function updateExercise(log, exerciseId, updater) {
  if (!log) return log;
  return { ...log, exercises: log.exercises.map((exercise) => exercise.id === exerciseId ? updater(exercise) : exercise) };
}

function applyOptimistic(log, operation) {
  if (!log) return log;
  if (operation.kind === 'set') {
    return updateExercise(log, operation.exerciseId, (exercise) => ({
      ...exercise,
      sets: exercise.sets.map((set) => set.id === operation.setId ? { ...set, ...operation.data } : set),
    }));
  }
  if (operation.kind === 'note') {
    return updateExercise(log, operation.exerciseId, (exercise) => ({ ...exercise, client_notes: operation.data.client_notes }));
  }
  if (operation.kind === 'add') {
    return updateExercise(log, operation.exerciseId, (exercise) => {
      if (exercise.sets.some((set) => set.client_operation_id === operation.clientOperationId)) return exercise;
      const setNumber = Math.max(0, ...exercise.sets.map((set) => set.set_number)) + 1;
      return {
        ...exercise,
        sets: [...exercise.sets, {
          id: `pending-${operation.clientOperationId}`,
          client_operation_id: operation.clientOperationId,
          workout_log_exercise_id: exercise.id,
          set_number: setNumber,
          set_origin: 'extra',
          status: 'pending',
          actual_load_value: exercise.prescribed_load_value,
          actual_load_unit: exercise.prescribed_load_unit,
          actual_reps: null,
          actual_rpe: null,
          archived: false,
        }],
      };
    });
  }
  if (operation.kind === 'archive') {
    return updateExercise(log, operation.exerciseId, (exercise) => ({
      ...exercise,
      sets: exercise.sets.filter((set) => set.id !== operation.setId),
    }));
  }
  return log;
}

function useWorkoutOutbox(logId, setLog) {
  const storageKey = `cvf_workout_outbox_${logId}`;
  const initial = useMemo(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch { return []; }
  }, [storageKey]);
  const queueRef = useRef(initial);
  const processingRef = useRef(false);
  const retryRef = useRef(null);
  const [saveState, setSaveState] = useState(initial.length ? 'not_saved' : 'saved');
  const [online, setOnline] = useState(navigator.onLine);

  const persist = useCallback((queue) => {
    queueRef.current = queue;
    if (queue.length) localStorage.setItem(storageKey, JSON.stringify(queue));
    else localStorage.removeItem(storageKey);
  }, [storageKey]);

  const flush = useCallback(async () => {
    if (processingRef.current || !navigator.onLine) {
      setSaveState('not_saved');
      return false;
    }
    processingRef.current = true;
    window.clearTimeout(retryRef.current);
    try {
      while (queueRef.current.length) {
        setSaveState('saving');
        const operation = queueRef.current[0];
        try {
          const { data } = await api.request({ method: operation.method, url: operation.url, data: operation.data });
          if (operation.kind === 'add') {
            const pendingId = `pending-${operation.clientOperationId}`;
            setLog((current) => updateExercise(current, operation.exerciseId, (exercise) => ({
              ...exercise,
              sets: exercise.sets.map((set) => set.client_operation_id === operation.clientOperationId ? data : set),
            })));
            queueRef.current = queueRef.current.map((queued) => queued.setId === pendingId ? {
              ...queued,
              setId: data.id,
              url: queued.url.replace(pendingId, data.id),
            } : queued);
          }
          persist(queueRef.current.filter((queued) => queued.id !== operation.id));
        } catch (error) {
          const status = error?.response?.status;
          if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
            const remaining = queueRef.current.filter((queued) => queued.id !== operation.id);
            persist(remaining);
            try {
              const { data } = await api.get(`/workout-logs/${logId}`);
              setLog(remaining.reduce((current, queued) => applyOptimistic(current, queued), data));
            } catch {
              // The failed write is still removed; a later page reload reconciles server state.
            }
            toast.error(error?.response?.data?.error || 'A workout change was rejected. Check the value and try again.');
            continue;
          }
          const attempts = (operation.attempts || 0) + 1;
          const updated = queueRef.current.map((queued) => queued.id === operation.id ? { ...queued, attempts } : queued);
          persist(updated);
          setSaveState('not_saved');
          const delay = Math.min(30_000, 1000 * (2 ** Math.min(attempts - 1, 5)));
          retryRef.current = window.setTimeout(() => flush(), delay);
          return false;
        }
      }
      setSaveState('saved');
      return true;
    } finally {
      processingRef.current = false;
    }
  }, [logId, persist, setLog]);

  const enqueue = useCallback((operation) => {
    const queued = { id: makeId(), attempts: 0, ...operation };
    persist([...queueRef.current, queued]);
    setLog((current) => applyOptimistic(current, queued));
    setSaveState('saving');
    window.setTimeout(() => flush(), 0);
  }, [flush, persist, setLog]);

  useEffect(() => {
    const onOnline = () => { setOnline(true); flush(); };
    const onOffline = () => { setOnline(false); setSaveState('not_saved'); };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    if (initial.length) window.setTimeout(() => flush(), 0);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.clearTimeout(retryRef.current);
    };
  }, [flush, initial.length]);

  const hydrate = useCallback((log) => queueRef.current.reduce(
    (current, operation) => applyOptimistic(current, operation),
    log,
  ), []);

  return {
    enqueue,
    flush,
    hydrate,
    saveState,
    online,
    markDirty: () => setSaveState('not_saved'),
  };
}

function parseRest(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return null;
  const clock = text.match(/^(\d+):(\d{1,2})$/);
  if (clock) return (Number(clock[1]) * 60) + Number(clock[2]);
  const minutes = text.match(/([\d.]+)\s*(?:m|min|mins|minute|minutes)/);
  const seconds = text.match(/([\d.]+)\s*(?:s|sec|secs|second|seconds)/);
  if (minutes || seconds) return Math.round((Number(minutes?.[1] || 0) * 60) + Number(seconds?.[1] || 0));
  if (/^\d+$/.test(text)) return Number(text);
  return null;
}

function formatTimer(seconds) {
  const safe = Math.max(0, seconds);
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

function displayPerformed(value, suffix = '') {
  return value === null || value === undefined ? 'Not recorded' : `${value}${suffix}`;
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
  const [log, setLog] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [finishOpen, setFinishOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [workoutNotes, setWorkoutNotes] = useState('');
  const [finishing, setFinishing] = useState(false);
  const [restEndsAt, setRestEndsAt] = useState(null);
  const [timerNow, setTimerNow] = useState(Date.now());
  const intensity = useVisualIntensity();
  const outbox = useWorkoutOutbox(id, setLog);
  const hydratePending = outbox.hydrate;

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/workout-logs/${id}`);
      if (data.status !== 'active') {
        navigate(`/client/workouts/${id}`, { replace: true });
        return;
      }
      setLog(hydratePending(data));
      setLoadError(null);
    } catch (error) {
      setLoadError(errMsg(error, 'Failed to load workout'));
    }
  }, [hydratePending, id, navigate]);

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

  if (!log && loadError) return <LoadErrorState message={loadError} scope="workout-tracker" onRetry={load} />;
  if (!log) return <LoadingScreen />;

  const allSets = log.exercises.flatMap((exercise) => exercise.sets);
  const completedCount = allSets.filter((set) => set.status === 'completed').length;
  const remainingCount = allSets.filter((set) => set.status === 'pending').length;
  const restSeconds = restEndsAt ? Math.max(0, Math.ceil((restEndsAt - timerNow) / 1000)) : 0;
  const restComplete = Boolean(restEndsAt && timerNow >= restEndsAt);
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
    if (status === 'completed') {
      const seconds = parseRest(exercise.prescribed_rest);
      if (seconds) {
        setTimerNow(Date.now());
        setRestEndsAt(Date.now() + (seconds * 1000));
      }
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
      const flushed = await outbox.flush();
      if (!flushed || !navigator.onLine) {
        toast.error('Reconnect and wait for your workout to save before finishing.');
        return;
      }
      await api.post(`/workout-logs/${id}/complete`, { notes: workoutNotes, feedback });
      navigate(`/client/workouts/${id}`, {
        replace: true,
        state: { completedWorkoutId: id },
      });
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setFinishing(false);
    }
  };

  const abandon = async () => {
    if (!window.confirm('Abandon this workout? Saved progress will remain out of your completed history.')) return;
    try {
      await api.post(`/workout-logs/${id}/abandon`);
      localStorage.removeItem(`cvf_workout_outbox_${id}`);
      navigate('/client/programs', { replace: true });
    } catch (error) {
      toast.error(errMsg(error));
    }
  };

  return (
    <div data-testid="workout-tracker">
      <PageHeader
        title={log.workout_name}
        subtitle={`${completedCount} of ${allSets.length} sets complete`}
        action={<Button variant="ghost" size="sm" onClick={abandon}>Abandon</Button>}
      />
      <div className="mb-4 flex items-center gap-2 text-xs" aria-live="polite" data-testid="workout-save-state">
        {outbox.saveState === 'saved' && <><Save className="h-3.5 w-3.5 text-success" /> Saved</>}
        {outbox.saveState === 'saving' && <><Loader2 className="h-3.5 w-3.5 animate-spin text-primary motion-reduce:animate-none" /> Saving</>}
        {outbox.saveState === 'not_saved' && <><CircleAlert className="h-3.5 w-3.5 text-gold" /> Not saved yet</>}
        {!outbox.online && <Badge variant="outline"><WifiOff className="mr-1 h-3.5 w-3.5" /> Offline</Badge>}
      </div>

      <div className="space-y-4">
        {log.exercises.map((exercise) => (
          <Card key={exercise.id} data-testid="tracker-exercise-card">
            <CardHeader className="pb-3">
              <CardTitle className="font-display text-lg">{exercise.exercise_name}</CardTitle>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {exercise.prescribed_reps && <span>Reps {exercise.prescribed_reps}</span>}
                {exercise.prescribed_rpe && <span>RPE {exercise.prescribed_rpe}</span>}
                {exercise.prescribed_rest && <span>Rest {exercise.prescribed_rest}</span>}
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
                      type="number" min="0" step="0.5" inputMode="decimal" className="h-10 min-w-0 tabular-nums"
                      value={set.actual_load_value ?? ''}
                      onChange={(event) => setLocalValue(exercise.id, set.id, 'actual_load_value', event.target.value)}
                      onBlur={() => saveSet(exercise, set)}
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
                        className="h-10 w-[68px] px-2"
                        aria-label={`${exercise.exercise_name} set ${set.set_number} weight unit`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent><SelectItem value="lb">lb</SelectItem><SelectItem value="kg">kg</SelectItem></SelectContent>
                    </Select>
                  </div>
                  <Input type="number" min="0" step="1" inputMode="numeric" className="h-10 px-2 tabular-nums" value={set.actual_reps ?? ''}
                    onChange={(event) => setLocalValue(exercise.id, set.id, 'actual_reps', event.target.value)} onBlur={() => saveSet(exercise, set)}
                    aria-label={`${exercise.exercise_name} set ${set.set_number} performed reps`} />
                  <Input type="number" min="1" max="10" step="0.5" inputMode="decimal" className="h-10 px-2 tabular-nums" value={set.actual_rpe ?? ''}
                    onChange={(event) => setLocalValue(exercise.id, set.id, 'actual_rpe', event.target.value)} onBlur={() => saveSet(exercise, set)}
                    aria-label={`${exercise.exercise_name} set ${set.set_number} performed RPE`} />
                  <Button
                    type="button" size="icon" variant={set.status === 'completed' ? 'default' : 'outline'}
                    className="h-11 w-11" onClick={() => toggleSet(exercise, set)}
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
              <Button type="button" variant="outline" size="sm" onClick={() => addSet(exercise)}>
                <Plus className="mr-1.5 h-4 w-4" /> Add set
              </Button>
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
        className="signature-glass sticky bottom-20 z-30 mt-5 flex gap-2 rounded-2xl p-2.5 lg:bottom-4"
        data-testid="workout-control-dock"
      >
        <Button variant="outline" className="min-h-11 flex-1" disabled={!remainingCount || !outbox.online || outbox.saveState !== 'saved'} onClick={completeAll}>
          Complete all remaining
        </Button>
        <Button className="min-h-11 flex-1" disabled={!completedCount || !outbox.online || outbox.saveState !== 'saved'} onClick={() => setFinishOpen(true)}>
          Finish workout
        </Button>
      </div>

      {restEndsAt && (
        <>
          <Button
            type="button"
            onClick={() => setRestEndsAt(null)}
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
            <div className="space-y-1.5"><Label htmlFor="workout-feedback">Feedback for your coach</Label><Textarea id="workout-feedback" rows={4} value={feedback} onChange={(event) => setFeedback(event.target.value)} /></div>
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
