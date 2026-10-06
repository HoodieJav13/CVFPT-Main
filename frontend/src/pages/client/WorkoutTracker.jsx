import { workoutEntryErrorMessage, workoutEntryErrors } from '@/lib/workoutEntryErrors';
import { performedSet, trackingType, tracks } from '@/lib/workoutMetrics';
import { WorkoutViewport } from '@/components/training/WorkoutViewport';
import { WorkoutMetricInput } from '@/components/training/WorkoutMetricInput';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Bell, BellOff, Check, ChevronDown, CircleAlert, Clock3, History, Info, Loader2, Play, Plus, Save, Timer, Trash2, WifiOff } from 'lucide-react';
import { api, errMsg } from '@/lib/api';
import { cn } from '@/lib/utils';
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
import {
  adjustRestEnd, formatRestSeconds, manualRestSeconds, REST_ADJUST_SECONDS,
} from '@/lib/rest';
import { safeHttpUrl } from '@/lib/safeUrl';
import { lastTimeFills } from '@/lib/workoutSync';
import { trackProductEvent } from '@/lib/telemetry';
import { ExerciseMarker, SupersetGroups } from '@/components/training/SupersetGroups';
import { nextExercise, restAfterSet, supersetBlocks, supersetRestSeconds } from '@/lib/supersets';

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
          {error && <div role="alert" className="space-y-2 text-sm"><p>{error}</p><Button type="button" size="sm" variant="outline" className="min-h-11" onClick={() => loadHistory(nextCursor && occurrences.length ? nextCursor : null)}>Retry</Button></div>}
          {!loading && !error && attempted && occurrences.length === 0 && <p className="text-sm text-muted-foreground">No completed history yet.</p>}
          {occurrences.map((occurrence) => (
            <section key={occurrence.occurrence_id || occurrence.workout_log_id} className="space-y-2" data-testid="history-occurrence">
              <div><p className="text-sm font-medium">{occurrence.exercise_name}</p><p className="text-xs text-muted-foreground">{new Date(occurrence.completed_at).toLocaleDateString()}</p></div>
              <div className="space-y-1">
                {occurrence.sets.map((set) => (
                  <div key={set.set_number} className="grid grid-cols-[2rem_repeat(3,minmax(0,1fr))] gap-2 text-xs">
                    <span>Set {set.set_number}</span>
                    <span>Weight: {displayPerformed(set.actual_load_value, set.actual_load_unit ? ` ${set.actual_load_unit}` : '')}</span>
                    {trackingType(occurrence) === 'reps_weight' && <span>Reps: {displayPerformed(set.actual_reps)}</span>}
                    {['duration', 'distance'].filter((metric) => tracks(occurrence, metric)).map((metric) => <span key={metric}>{metric === 'duration' ? 'Duration' : 'Distance'}: {displayPerformed(set[`actual_${metric}_value`], ` ${set[`actual_${metric}_unit`] || ''}`)}</span>)}
                    <span>RPE: {displayPerformed(set.actual_rpe)}</span>
                  </div>
                ))}
              </div>
            </section>
          ))}
          {nextCursor && !error && <Button type="button" size="sm" variant="outline" className="min-h-11" disabled={loading} onClick={() => loadHistory(nextCursor)}>{loading ? 'Loading…' : 'Load more'}</Button>}
        </div>
      )}
    </div>
  );
}

// The rest timer owns its own 250ms tick so a running countdown re-renders
// only these controls — not every exercise card and controlled input (audit #11).
// The opt-in end-of-rest cue lives here too, since it keys off the same tick.
function RestTimerFab({ restEndsAt, onClear, onAdjust, restAlerts, attentionScale }) {
  const [now, setNow] = useState(Date.now());
  const announcedRef = useRef(false);

  useEffect(() => {
    setNow(Date.now());
    if (!restEndsAt) return undefined;
    let timer;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      if (current >= restEndsAt) window.clearInterval(timer);
    };
    timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [restEndsAt]);

  const complete = Boolean(restEndsAt && now >= restEndsAt);

  useEffect(() => {
    if (!complete) {
      announcedRef.current = false;
      return;
    }
    if (announcedRef.current || !restAlerts) return;
    announcedRef.current = true;
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
  }, [complete, restAlerts]);

  if (!restEndsAt) return null;
  const seconds = Math.max(0, Math.ceil((restEndsAt - now) / 1000));
  const adjustClass = 'signature-glass h-11 w-11 rounded-full px-0 text-sm font-semibold tabular-nums text-foreground hover:bg-card/80';
  return (
    <>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {!complete && (
          <>
            <Button type="button" className={adjustClass} onClick={() => onAdjust(-REST_ADJUST_SECONDS)} aria-label={`Subtract ${REST_ADJUST_SECONDS} seconds of rest`} data-testid="rest-minus">
              −{REST_ADJUST_SECONDS}
            </Button>
            <Button type="button" className={adjustClass} onClick={() => onAdjust(REST_ADJUST_SECONDS)} aria-label={`Add ${REST_ADJUST_SECONDS} seconds of rest`} data-testid="rest-plus">
              +{REST_ADJUST_SECONDS}
            </Button>
          </>
        )}
        <Button
          type="button"
          onClick={onClear}
          className={`signature-glass h-14 min-w-28 rounded-full px-4 font-display text-base font-semibold ${complete ? 'signature-glass-success motion-attention-pop-once hover:bg-success/90' : 'text-foreground hover:bg-card/80'}`}
          style={complete ? { '--motion-attention-scale': attentionScale } : undefined}
          aria-label={complete ? 'Rest complete, tap to dismiss' : `Rest timer ${formatTimer(seconds)}, tap to stop`}
          data-testid="rest-timer"
          data-rest-state={complete ? 'complete' : 'running'}
        >
          <Clock3 className="h-5 w-5" /> {complete ? 'Rest complete' : formatTimer(seconds)}
        </Button>
      </div>
      <div className="sr-only" aria-live="assertive" aria-atomic="true" data-testid="rest-complete-announcement">
        {complete ? 'Rest complete' : ''}
      </div>
    </>
  );
}

export default function WorkoutTracker() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isCoach = user.role === 'coach' || user.role === 'admin';
  const basePath = isCoach ? '/coach' : '/client';
  const [log, setLog] = useState(null);
  // Latest rendered log, for handlers that resume after an await.
  const logRef = useRef(null);
  logRef.current = log;
  const [loadError, setLoadError] = useState(null);
  const [finishOpen, setFinishOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [workoutNotes, setWorkoutNotes] = useState('');
  const [finishing, setFinishing] = useState(false);
  const [abandonOpen, setAbandonOpen] = useState(false);
  const [restEndsAt, setRestEndsAt] = useState(null);
  const [lastTimeLoading, setLastTimeLoading] = useState(null);
  const [validatedSets, setValidatedSets] = useState({});
  const [restAlerts, setRestAlerts] = useState(() => localStorage.getItem('cvf_rest_alerts') === 'on');
  const lastTimeCache = useRef({});
  const intensity = useVisualIntensity();
  const outbox = useWorkoutOutbox(id, setLog);
  const hydratePending = outbox.hydrate;
  const restStorageKey = `cvf_rest_timer_${id}`;

  // A running rest timer survives reloads and app switches: the end
  // timestamp persists per log and is restored while still in the future.
  const startRest = (seconds) => {
    const endsAt = Date.now() + (seconds * 1000);
    localStorage.setItem(restStorageKey, String(endsAt));
    setRestEndsAt(endsAt);
  };
  const clearRest = () => {
    localStorage.removeItem(restStorageKey);
    setRestEndsAt(null);
  };
  const adjustRest = (deltaSeconds) => {
    if (!restEndsAt) return;
    const endsAt = adjustRestEnd(restEndsAt, deltaSeconds);
    localStorage.setItem(restStorageKey, String(endsAt));
    setRestEndsAt(endsAt);
  };
  useEffect(() => {
    const stored = Number(localStorage.getItem(restStorageKey));
    if (stored && stored > Date.now()) {
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

  const toggleRestAlerts = () => {
    const next = !restAlerts;
    localStorage.setItem('cvf_rest_alerts', next ? 'on' : 'off');
    setRestAlerts(next);
  };

  if (!log && loadError) return <LoadErrorState message={loadError} scope="workout-tracker" onRetry={load} />;
  if (!log) return <LoadingScreen />;

  const allSets = log.exercises.flatMap((exercise) => exercise.sets);
  const completedCount = allSets.filter((set) => set.status === 'completed').length;
  // Previous / current / upcoming set states (design-plans/010, bold
  // direction): the first pending set is "current"; completed sets go quiet.
  // Inside a superset the "current" card alternates between members.
  const activeExerciseId = nextExercise(log.exercises)?.id;
  const hasGroups = log.exercises.some((exercise) => exercise.superset_group);
  // Manual rest defaults to the current exercise's rest (else 90s); inside
  // a superset it is the group's round rest, like the automatic timer.
  const activeExercise = log.exercises.find((ex) => ex.id === activeExerciseId) || log.exercises[0];
  const activeBlock = supersetBlocks(log.exercises).find((block) => block.items.some(({ exercise }) => exercise.id === activeExercise?.id));
  const manualRest = manualRestSeconds(activeBlock && activeBlock.kind !== 'single'
    ? { prescribed_rest_seconds: supersetRestSeconds(activeBlock.items.map(({ exercise }) => exercise)) }
    : activeExercise);
  const isActiveSet = (exercise, set) => !sealed && set.status !== 'completed'
    && set.id === exercise.sets.find((s) => s.status !== 'completed')?.id;
  const setRowClass = (exercise, set) => {
    if (set.status === 'completed') return 'bg-success/5 opacity-55';
    if (isActiveSet(exercise, set)) return 'bg-primary/15 ring-1 ring-primary/40';
    return 'bg-secondary/30';
  };
  const remainingCount = allSets.filter((set) => set.status === 'pending').length;
  const sealed = outbox.queuedComplete;
  const attentionRecipe = ATTENTION_FEEDBACK_MOTION[intensity];

  const setLocalValue = (exerciseId, setId, key, value) => {
    setLog((current) => updateExercise(current, exerciseId, (exercise) => ({
      ...exercise,
      sets: exercise.sets.map((set) => set.id === setId ? { ...set, [key]: value } : set),
    })));
    outbox.markDirty();
  };

  const fieldErrors = new Map(log.exercises.flatMap((exercise) => exercise.sets
    .filter((set) => validatedSets[set.id]).map((set) => [set.id, workoutEntryErrors(set, exercise)])));
  const entryErrors = (exercise, set) => fieldErrors.get(set.id) || {};
  const errorId = (set, field) => `set-${set.id}-${field}-error`;
  const errorProps = (exercise, set, field) => entryErrors(exercise, set)[field]
    ? { 'aria-invalid': true, 'aria-describedby': errorId(set, field) } : {};

  const saveSet = (exercise, set) => {
    let payload;
    try { payload = performedSet(set, exercise); } catch (error) { setValidatedSets((current) => ({ ...current, [set.id]: true })); toast.message(workoutEntryErrorMessage(error)); return; }
    outbox.enqueue({
      kind: 'set', exerciseId: exercise.id, setId: set.id,
      method: 'patch', url: `/workout-logs/${id}/sets/${set.id}`,
      data: payload,
    });
  };

  const toggleSet = (exercise, set) => {
    const status = set.status === 'completed' ? 'pending' : 'completed';
    // Load fields normalized exactly like saveSet — an empty string with a
    // stale unit is a backend 400 that would revert the completion.
    let payload;
    try { payload = performedSet({ ...set, status }, exercise); } catch (error) { setValidatedSets((current) => ({ ...current, [set.id]: true })); toast.message(workoutEntryErrorMessage(error)); return; }
    outbox.enqueue({
      kind: 'set', exerciseId: exercise.id, setId: set.id,
      method: 'patch', url: `/workout-logs/${id}/sets/${set.id}`,
      data: payload,
    });
    if (status === 'completed') {
      // Inside a superset/giant set, rest waits for the end of the round.
      const rest = restAfterSet(log.exercises, exercise.id, set.id);
      if (rest.seconds > 0) startRest(rest.seconds);
      else if (rest.clear) clearRest();
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
        occurrence = data.occurrences.find((row) => trackingType(row) === trackingType(exercise)) || null;
        lastTimeCache.current[exercise.id] = occurrence;
      } catch (error) {
        toast.error(errMsg(error, 'Failed to load last time'));
        return;
      } finally {
        setLastTimeLoading(null);
      }
    }
    if (!occurrence) {
      toast.info('No history yet.');
      return;
    }
    // Re-read the exercise: anything typed while history loaded is kept.
    const current = logRef.current?.exercises.find((row) => row.id === exercise.id) || exercise;
    let filledCount = 0;
    lastTimeFills(current.sets, occurrence, current).forEach(({ setId, data }) => {
      const queued = outbox.enqueue({
        kind: 'set', exerciseId: exercise.id, setId,
        method: 'patch', url: `/workout-logs/${id}/sets/${setId}`,
        data,
      });
      if (queued) filledCount += 1;
    });
    if (!filledCount) {
      toast.info('Nothing copied: no matching blank fields.');
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
      trackProductEvent('workout_completed', { source: isCoach ? 'coach_tracker' : 'client_tracker', offline: !flushed });
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
    setAbandonOpen(false);
    try {
      await api.post(`/workout-logs/${id}/abandon`);
      trackProductEvent('workout_abandoned', { source: isCoach ? 'coach_tracker' : 'client_tracker' });
      localStorage.removeItem(`cvf_workout_outbox_${id}`);
      localStorage.removeItem(restStorageKey);
      navigate(isCoach ? `/coach/clients/${log.client_id}` : '/client/programs', { replace: true });
    } catch (error) {
      toast.error(errMsg(error));
    }
  };

  const controls = (
      <div
        className="signature-glass flex flex-col gap-2 rounded-2xl p-2.5"
        data-testid="workout-control-dock"
      >
        <RestTimerFab restEndsAt={restEndsAt} onClear={clearRest} onAdjust={adjustRest} restAlerts={restAlerts} attentionScale={attentionRecipe.scale} />
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
          <Button variant="outline" className="h-auto min-h-11 min-w-0 flex-1 whitespace-normal py-2" disabled={sealed || !remainingCount || !outbox.online || outbox.saveState !== 'saved'} onClick={completeAll}>
            Complete all remaining
          </Button>
          <Button className="h-auto min-h-11 min-w-0 flex-1 whitespace-normal py-2" disabled={sealed || !completedCount} onClick={() => setFinishOpen(true)}>
            Finish workout
          </Button>
        </div>
      </div>
  );

  return (
    <WorkoutViewport controls={controls}>
      <PageHeader
        title={log.workout_name}
        subtitle={isCoach && log.client?.name ? `For ${log.client.name}` : null}
        action={(
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setAbandonOpen(true)}
            className="min-h-11 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            Abandon
          </Button>
        )}
      />
      {outbox.queuedComplete && (
        <div className="mb-4 flex flex-col gap-2 rounded-xl border border-gold/35 bg-gold/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between" data-testid="finished-locally-banner">
          <p className="text-sm font-medium">Finished on this phone — waiting to sync. Editing is locked.</p>
          <Button type="button" size="sm" variant="outline" className="min-h-11 shrink-0" onClick={outbox.removeQueuedComplete} data-testid="keep-editing-button">
            Keep editing
          </Button>
        </div>
      )}
      <div className="mb-4 flex items-center gap-2 text-xs">
        <span className="flex items-center gap-2" aria-live="polite" data-testid="workout-save-state">
          {outbox.saveState === 'saved' && <><Save className="h-3.5 w-3.5 text-success" /> Saved</>}
          {outbox.saveState === 'saving' && <><Loader2 className="h-3.5 w-3.5 animate-spin text-primary motion-reduce:animate-none" /> Saving</>}
          {outbox.saveState === 'not_saved' && <><CircleAlert className="h-3.5 w-3.5 text-gold" /> Not saved yet</>}
          {!outbox.online && <Badge variant="outline"><WifiOff className="mr-1 h-3.5 w-3.5" /> Offline</Badge>}
        </span>
        {!restEndsAt && !sealed && (
          <Button
            type="button" variant="ghost" size="sm"
            className="ml-auto min-h-11 px-2 text-xs text-muted-foreground"
            onClick={() => startRest(manualRest)}
            aria-label={`Start a ${formatTimer(manualRest)} rest timer`}
            data-testid="rest-start"
          >
            <Timer className="mr-1 h-3.5 w-3.5" /> Rest {formatTimer(manualRest)}
          </Button>
        )}
        <Button
          type="button" variant="ghost" size="sm"
          className={cn('min-h-11 px-2 text-xs text-muted-foreground', (restEndsAt || sealed) && 'ml-auto')}
          onClick={toggleRestAlerts}
          aria-pressed={restAlerts}
          aria-label={restAlerts ? 'Turn rest alerts off' : 'Turn rest alerts on'}
          data-testid="rest-alerts-toggle"
          data-rest-alerts={restAlerts ? 'on' : 'off'}
        >
          {restAlerts ? <Bell className="text-primary" aria-hidden /> : <BellOff aria-hidden />}
          Rest alerts
        </Button>
      </div>

      <div className="space-y-4">
        <SupersetGroups
          exercises={log.exercises}
          roundRest={(members) => (supersetRestSeconds(members) > 0 ? `rest ${formatRestSeconds(supersetRestSeconds(members))}` : null)}
        >{(exercise, { marker, grouped }) => (
          <Card
            className={cn(exercise.id === activeExerciseId && !sealed && 'border-primary/35 shadow-[var(--app-elev-soft)]')}
            data-testid="tracker-exercise-card"
          >
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="flex min-w-0 items-center gap-2 font-display text-lg">
                  {hasGroups && <ExerciseMarker marker={marker} />}
                  <span className="min-w-0 break-words">{exercise.exercise_name}</span>
                </CardTitle>
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
                {exercise.prescribed_load_value != null && <span>Load {exercise.prescribed_load_value} {exercise.prescribed_load_unit || 'lb'}</span>}
                {trackingType(exercise) === 'reps_weight' && exercise.prescribed_reps && <span>Reps {exercise.prescribed_reps}</span>}
                {['duration', 'distance'].filter((metric) => tracks(exercise, metric)).map((metric) => exercise[`prescribed_${metric}_value`] != null && <span key={metric}>{metric === 'duration' ? 'Duration' : 'Distance'} {exercise[`prescribed_${metric}_value`]} {exercise[`prescribed_${metric}_unit`]}</span>)}
                {exercise.prescribed_rpe && <span>RPE {exercise.prescribed_rpe}</span>}
                {/* Grouped exercises rest once per round (shown on the group). */}
                {!grouped && (exercise.prescribed_rest_seconds != null || exercise.prescribed_rest) && (
                  <span>Rest {exercise.prescribed_rest_seconds != null ? formatRestSeconds(exercise.prescribed_rest_seconds) : exercise.prescribed_rest}</span>
                )}
                {exercise.prescribed_tempo && <span>Tempo {exercise.prescribed_tempo}</span>}
              </div>
              {exercise.prescribed_notes && <p className="text-xs text-muted-foreground">{exercise.prescribed_notes}</p>}
              {safeHttpUrl(exercise.video_url) && (
                <a
                  href={safeHttpUrl(exercise.video_url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 w-fit items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                  aria-label={`Watch demo: ${exercise.exercise_name} (opens in a new tab)`}
                  data-testid="tracker-exercise-video"
                >
                  <Play className="h-4 w-4" aria-hidden /> Watch demo
                </a>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="hidden gap-1 px-1 text-xs font-medium text-muted-foreground sm:grid sm:grid-cols-[1.75rem_minmax(8.5rem,2fr)_minmax(3.5rem,1fr)_minmax(3.5rem,1fr)_2.75rem]">
                <span>Set</span><span>Weight</span><span>{trackingType(exercise) === 'reps_weight' ? 'Reps' : '—'}</span><span>RPE</span><span className="sr-only">Complete</span>
              </div>
              {exercise.sets.map((set) => (
                <div key={set.id} className={`grid min-h-12 grid-cols-[1.75rem_minmax(0,1fr)_minmax(0,1fr)_2.75rem] items-end gap-1 rounded-md px-1 py-1 sm:grid-cols-[1.75rem_minmax(8.5rem,2fr)_minmax(3.5rem,1fr)_minmax(3.5rem,1fr)_2.75rem] sm:items-center ${setRowClass(exercise, set)}`}>
                  <span className={cn('row-span-2 self-center text-center text-sm tabular-nums sm:row-span-1', isActiveSet(exercise, set) && 'font-semibold text-primary')}>{set.set_number}</span>
                  <div className="col-span-3 min-w-0 sm:col-span-1">
                    <span className="text-xs text-muted-foreground sm:hidden">Weight</span>
                    <div className="flex min-w-0 gap-1">
                      <Input
                        type="number" min="0" step="0.5" inputMode="decimal"
                        className={cn('h-11 min-w-0 px-2 text-sm tabular-nums', isActiveSet(exercise, set) && 'h-12 border-primary/40 font-display text-lg font-semibold')}
                        value={set.actual_load_value ?? ''}
                        placeholder={exercise.prescribed_load_value != null ? String(exercise.prescribed_load_value) : undefined}
                        onChange={(event) => setLocalValue(exercise.id, set.id, 'actual_load_value', event.target.value)}
                        onBlur={() => saveSet(exercise, set)}
                        disabled={sealed}
                        {...errorProps(exercise, set, 'actual_load_value')}
                        aria-label={`${exercise.exercise_name} set ${set.set_number} weight`}
                      />
                      <Select disabled={sealed} value={set.actual_load_unit || exercise.prescribed_load_unit || 'lb'} onValueChange={(value) => {
                        setLocalValue(exercise.id, set.id, 'actual_load_unit', value);
                        saveSet(exercise, { ...set, actual_load_unit: value });
                      }}>
                        <SelectTrigger
                          className="h-11 w-14 shrink-0 px-1.5"
                          aria-label={`${exercise.exercise_name} set ${set.set_number} weight unit`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent><SelectItem value="lb">lb</SelectItem><SelectItem value="kg">kg</SelectItem></SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="col-start-2 min-w-0 sm:col-start-auto">
                    <span className="text-xs text-muted-foreground sm:hidden">{trackingType(exercise) === 'reps_weight' ? 'Reps' : '—'}</span>
                    {trackingType(exercise) === 'reps_weight' ? <Input type="number" min="0" step="1" inputMode="numeric" className="h-11 px-2 text-sm tabular-nums" value={set.actual_reps ?? ''}
                      placeholder={exercise.prescribed_reps || undefined}
                      onChange={(event) => setLocalValue(exercise.id, set.id, 'actual_reps', event.target.value)} onBlur={() => saveSet(exercise, set)} disabled={sealed}
                      {...errorProps(exercise, set, 'actual_reps')} aria-label={`${exercise.exercise_name} set ${set.set_number} performed reps`} /> : <span aria-hidden className="text-center text-muted-foreground">—</span>}
                  </div>
                  <div className="min-w-0">
                    <span className="text-xs text-muted-foreground sm:hidden">RPE</span>
                    <Input type="number" min="1" max="10" step="0.5" inputMode="decimal" className="h-11 px-2 text-sm tabular-nums" value={set.actual_rpe ?? ''}
                      placeholder={exercise.prescribed_rpe || undefined}
                      onChange={(event) => setLocalValue(exercise.id, set.id, 'actual_rpe', event.target.value)} onBlur={() => saveSet(exercise, set)} disabled={sealed}
                      {...errorProps(exercise, set, 'actual_rpe')} aria-label={`${exercise.exercise_name} set ${set.set_number} performed RPE`} />
                  </div>
                  <Button
                    type="button" size="icon" variant={set.status === 'completed' ? 'default' : 'outline'}
                    className="h-11 w-11" disabled={sealed} onClick={() => toggleSet(exercise, set)}
                    aria-label={`${set.status === 'completed' ? 'Mark incomplete' : 'Complete'} set ${set.set_number}`}
                  >
                    <Check className="h-5 w-5" />
                  </Button>
                  {trackingType(exercise) !== 'reps_weight' && (
                    <div className="col-span-full grid grid-cols-1 gap-2 pb-2 sm:grid-cols-2">
                      {['duration', 'distance'].filter((metric) => tracks(exercise, metric)).map((metric) => (
                        <WorkoutMetricInput key={metric} metric={metric} errorId={entryErrors(exercise, set)[`actual_${metric}_value`] ? errorId(set, `actual_${metric}_value`) : undefined} label={`${exercise.exercise_name} set ${set.set_number} performed ${metric}`}
                          value={set[`actual_${metric}_value`]} unit={set[`actual_${metric}_unit`] || exercise[`prescribed_${metric}_unit`]}
                          disabled={sealed} onValueChange={(value) => setLocalValue(exercise.id, set.id, `actual_${metric}_value`, value)}
                          onBlur={() => saveSet(exercise, set)} onUnitChange={(unit) => {
                            const updated = { ...set, [`actual_${metric}_unit`]: unit };
                            setLocalValue(exercise.id, set.id, `actual_${metric}_unit`, unit);
                            saveSet(exercise, updated);
                          }} />
                      ))}
                      <p className="col-span-full text-xs text-muted-foreground">Enter values in the selected units. Changing a unit keeps the number.</p>
                    </div>
                  )}
                  {Object.entries(entryErrors(exercise, set)).map(([field, message]) => (
                    <p key={field} id={errorId(set, field)} role="status" className="col-span-full flex items-start gap-2 text-sm text-foreground">
                      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span>{message}</span>
                    </p>
                  ))}
                  {set.set_origin === 'extra' && (
                    <Button type="button" size="touchIcon" variant="ghost" className="col-start-2 text-muted-foreground" disabled={sealed} onClick={() => removeSet(exercise, set)} aria-label="Remove extra set" title="Remove extra set">
                      <Trash2 aria-hidden />
                    </Button>
                  )}
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" className="min-h-11" disabled={sealed} onClick={() => addSet(exercise)}>
                  <Plus className="mr-1.5 h-4 w-4" /> Add set
                </Button>
                <Button
                  type="button" variant="outline" size="sm" className="min-h-11"
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
                  id={`notes-${exercise.id}`} rows={2} value={exercise.client_notes || ''} disabled={sealed}
                  onChange={(event) => {
                    setLog((current) => updateExercise(current, exercise.id, (row) => ({ ...row, client_notes: event.target.value })));
                    outbox.markDirty();
                  }}
                  onBlur={() => saveNotes(exercise)}
                />
              </div>
            </CardContent>
          </Card>
        )}</SupersetGroups>
      </div>

      <Dialog open={abandonOpen} onOpenChange={setAbandonOpen}>
        <DialogContent className="max-w-sm [&>button]:h-11 [&>button]:w-11" data-testid="workout-abandon-dialog">
          <DialogHeader>
            <DialogTitle>Abandon this workout?</DialogTitle>
            <DialogDescription>Logged sets are kept but won't count as completed.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className="min-h-11 rounded-xl" onClick={() => setAbandonOpen(false)} data-testid="abandon-keep-button">
              Keep tracking
            </Button>
            <Button
              variant="ghost"
              className="min-h-11 rounded-xl border border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={abandon}
              data-testid="abandon-confirm-button"
            >
              Abandon workout
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={finishOpen} onOpenChange={setFinishOpen}>
        <DialogContent className="signature-glass bg-card/80 sm:rounded-2xl [&>button]:h-11 [&>button]:w-11" data-testid="workout-completion-dialog">
          <DialogHeader>
            <DialogTitle>Finish workout?</DialogTitle>
            <DialogDescription>{completedCount} {completedCount === 1 ? 'set' : 'sets'} done{remainingCount ? ` · ${remainingCount} ${remainingCount === 1 ? 'set' : 'sets'} will be skipped` : ''}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {!isCoach && <div className="space-y-1.5"><Label htmlFor="workout-feedback">Feedback for your coach</Label><Textarea id="workout-feedback" rows={4} value={feedback} onChange={(event) => setFeedback(event.target.value)} /></div>}
            <div className="space-y-1.5"><Label htmlFor="workout-notes">Workout notes</Label><Textarea id="workout-notes" rows={3} value={workoutNotes} onChange={(event) => setWorkoutNotes(event.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="touch" onClick={() => setFinishOpen(false)}>Keep tracking</Button>
            <Button size="touch" onClick={finish} disabled={finishing}>{finishing ? <><Loader2 className="h-4 w-4 animate-spin" /><span className="sr-only">Finishing workout</span></> : 'Confirm completion'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </WorkoutViewport>
  );
}
