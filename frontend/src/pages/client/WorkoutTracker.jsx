import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Check, CircleAlert, Clock3, Loader2, Plus, Save, Trash2, WifiOff } from 'lucide-react';
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
        } catch {
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
  }, [persist, setLog]);

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
    const timer = window.setInterval(() => setTimerNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [restEndsAt]);

  if (!log && loadError) return <LoadErrorState message={loadError} scope="workout-tracker" onRetry={load} />;
  if (!log) return <LoadingScreen />;

  const allSets = log.exercises.flatMap((exercise) => exercise.sets);
  const completedCount = allSets.filter((set) => set.status === 'completed').length;
  const remainingCount = allSets.filter((set) => set.status === 'pending').length;
  const restSeconds = restEndsAt ? Math.max(0, Math.ceil((restEndsAt - timerNow) / 1000)) : 0;

  const setLocalWeight = (exerciseId, setId, key, value) => {
    setLog((current) => updateExercise(current, exerciseId, (exercise) => ({
      ...exercise,
      sets: exercise.sets.map((set) => set.id === setId ? { ...set, [key]: value } : set),
    })));
    outbox.markDirty();
  };

  const saveWeight = (exercise, set) => {
    const blank = set.actual_load_value === '' || set.actual_load_value === null;
    outbox.enqueue({
      kind: 'set', exerciseId: exercise.id, setId: set.id,
      method: 'patch', url: `/workout-logs/${id}/sets/${set.id}`,
      data: {
        actual_load_value: blank ? null : Number(set.actual_load_value),
        actual_load_unit: blank ? null : (set.actual_load_unit || 'lb'),
        status: set.status,
      },
    });
  };

  const toggleSet = (exercise, set) => {
    const status = set.status === 'completed' ? 'pending' : 'completed';
    outbox.enqueue({
      kind: 'set', exerciseId: exercise.id, setId: set.id,
      method: 'patch', url: `/workout-logs/${id}/sets/${set.id}`,
      data: { status, actual_load_value: set.actual_load_value, actual_load_unit: set.actual_load_unit },
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
      navigate(`/client/workouts/${id}`, { replace: true });
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
        {outbox.saveState === 'saving' && <><Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> Saving</>}
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
              <div className="grid grid-cols-[2rem_minmax(6rem,1fr)_4.5rem_2.75rem] gap-2 px-1 text-xs font-medium text-muted-foreground">
                <span>Set</span><span>Weight</span><span>Reps</span><span className="sr-only">Complete</span>
              </div>
              {exercise.sets.map((set) => (
                <div key={set.id} className={`grid min-h-12 grid-cols-[2rem_minmax(6rem,1fr)_4.5rem_2.75rem] items-center gap-2 rounded-md px-1 ${set.status === 'completed' ? 'bg-success/10' : 'bg-secondary/50'}`}>
                  <span className="text-center text-sm tabular-nums">{set.set_number}</span>
                  <div className="flex min-w-0 gap-1">
                    <Input
                      type="number" min="0" step="0.5" inputMode="decimal" className="h-10 min-w-0 tabular-nums"
                      value={set.actual_load_value ?? ''}
                      onChange={(event) => setLocalWeight(exercise.id, set.id, 'actual_load_value', event.target.value)}
                      onBlur={() => saveWeight(exercise, set)}
                      aria-label={`${exercise.exercise_name} set ${set.set_number} weight`}
                    />
                    <Select value={set.actual_load_unit || exercise.prescribed_load_unit || 'lb'} onValueChange={(value) => {
                      setLocalWeight(exercise.id, set.id, 'actual_load_unit', value);
                      outbox.enqueue({
                        kind: 'set', exerciseId: exercise.id, setId: set.id,
                        method: 'patch', url: `/workout-logs/${id}/sets/${set.id}`,
                        data: {
                          actual_load_value: set.actual_load_value === '' || set.actual_load_value == null ? null : Number(set.actual_load_value),
                          actual_load_unit: set.actual_load_value === '' || set.actual_load_value == null ? null : value,
                          status: set.status,
                        },
                      });
                    }}>
                      <SelectTrigger className="h-10 w-[68px] px-2" aria-label="Weight unit"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="lb">lb</SelectItem><SelectItem value="kg">kg</SelectItem></SelectContent>
                    </Select>
                  </div>
                  <span className="text-center text-sm tabular-nums">{exercise.prescribed_reps || '-'}</span>
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

      <div className="sticky bottom-16 z-30 -mx-4 mt-5 flex gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur lg:bottom-0 lg:mx-0 lg:px-0">
        <Button variant="outline" className="min-h-11 flex-1" disabled={!remainingCount || !outbox.online || outbox.saveState !== 'saved'} onClick={completeAll}>
          Complete all remaining
        </Button>
        <Button className="min-h-11 flex-1" disabled={!completedCount || !outbox.online || outbox.saveState !== 'saved'} onClick={() => setFinishOpen(true)}>
          Finish workout
        </Button>
      </div>

      {restEndsAt && restSeconds > 0 && (
        <button type="button" onClick={() => setRestEndsAt(null)} className="fixed bottom-36 right-4 z-40 flex h-16 min-w-16 items-center justify-center gap-1 rounded-full bg-primary px-3 font-display text-lg font-semibold text-primary-foreground shadow-lg lg:bottom-6" aria-label={`Rest timer ${formatTimer(restSeconds)}, tap to stop`}>
          <Clock3 className="h-5 w-5" /> {formatTimer(restSeconds)}
        </button>
      )}

      <Dialog open={finishOpen} onOpenChange={setFinishOpen}>
        <DialogContent>
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
