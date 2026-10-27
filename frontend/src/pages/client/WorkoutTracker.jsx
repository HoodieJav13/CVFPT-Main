import { CueRetryEntry } from '@/components/training/CueRetryEntry';
import { workoutEntryErrorMessage, workoutEntryErrors } from '@/lib/workoutEntryErrors';
import { performedSet, trackingType, tracks } from '@/lib/workoutMetrics';
import { WorkoutViewport } from '@/components/training/WorkoutViewport';
import { WorkoutMetricInput } from '@/components/training/WorkoutMetricInput';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ArrowLeftRight, Bell, BellOff, Check, ChevronDown, CircleAlert, Clock3, History, Info, Loader2, Plus, RefreshCw, Repeat2, Save, Timer, Trash2, WifiOff } from 'lucide-react';
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
import { freshnessLabel, lastTimeFills, mergeRefresh } from '@/lib/workoutSync';
import { SetConflictNotice, SwapStatus, canSwap } from '@/components/training/SessionCorrections';
import SwapExerciseDialog, { readCachedSwapOptions, swapOptionsCacheKey } from '@/components/training/SwapExerciseDialog';
import { lastTimeDate, lastTimeFillNote, lastTimeLine, pickLastTimeOccurrence } from '@/lib/lastTime';
import { trackProductEvent } from '@/lib/telemetry';
import { ExerciseMarker, SupersetGroups } from '@/components/training/SupersetGroups';
import { exerciseMarkers, nextExercise, restAfterSet, supersetBlocks, supersetRestSeconds } from '@/lib/supersets';
import { nextWork, outlineBlocks, repeatPlan } from '@/lib/workoutGuide';
import { WorkoutOutline } from '@/components/training/WorkoutOutline';
import { ExerciseMediaInline } from '@/components/training/media/ExerciseMediaInline';
import { ExerciseInstructionDialog } from '@/components/training/media/ExerciseInstructionDialog';
import { ExerciseDemoAction, ExerciseDemoDialog } from '@/components/training/media/ExerciseDemoDialog';
import { demoForRow } from '@/lib/exerciseDemo';
import { nextPosterTargets } from '@/lib/exerciseMedia';

// The rest timer reads prescribed_rest_seconds — the structured column the
// database parses and backfills. The old runtime text parser is gone; text
// only survives as a display fallback for legacy completed snapshots.

// Bounded refresh (L12): no live push; the tracker re-reads the log on this
// cadence while online and says how fresh its copy is.
const REFRESH_SECONDS = 10;

function formatTimer(seconds) {
  const safe = Math.max(0, seconds);
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

function displayPerformed(value, suffix = '') {
  return value === null || value === undefined ? 'Not recorded' : `${value}${suffix}`;
}

// The dated prior sets "Same as last time" would copy (what the fill reads).
function LastTimeLine({ state, occurrence, online }) {
  let text = null;
  if (occurrence) text = lastTimeLine(occurrence);
  else if (occurrence === null) text = 'No completed history yet.';
  else if (state === 'loading') text = <><Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />Loading last time…</>;
  else if (state === 'offline' && !online) text = 'Last time unavailable offline.';
  else if (state === 'error') text = 'Last time unavailable.';
  if (!text) return null;
  return <p className="break-words px-1 text-xs text-muted-foreground" data-testid="last-time-line">{text}</p>;
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
  // Per exercise: 'loading' | 'loaded' | 'offline' | 'error' (local UI state only).
  const [lastTimeState, setLastTimeState] = useState({});
  // Per exercise: the note left by the last fill; cleared only by leaving the page.
  const [fillNotes, setFillNotes] = useState({});
  // Exercises whose "Same as last time" copy is still running. One copy per
  // exercise at a time: the ref is the synchronous gate (checked and set before
  // any await, so no second continuation can register). The state renders only
  // copies that are waiting for history, so a cached copy never disables (and
  // never takes focus from) its button. Taps on different exercises stay
  // independent; the background preview never marks one pending (a tap joins it).
  const lastTimeCopying = useRef(new Set());
  const [lastTimePending, setLastTimePending] = useState(() => new Set());
  const [validatedSets, setValidatedSets] = useState({});
  const [restAlerts, setRestAlerts] = useState(() => localStorage.getItem('cvf_rest_alerts') === 'on');
  // Exercise guides: only the active + next posters load; others on request.
  const [mediaRequested, setMediaRequested] = useState(() => new Set());
  const [instruction, setInstruction] = useState(null);
  // One click-to-load demo dialog at a time (no provider traffic until Play).
  const [demoFor, setDemoFor] = useState(null);
  const mediaContext = useMemo(() => ({ type: 'workout_log', id }), [id]);
  const lastTimeCache = useRef({});
  const lastTimeRequests = useRef({});
  const lastTimePreloaded = useRef(new Set());
  const intensity = useVisualIntensity();
  // Set when the server refuses a queued Finish (the outbox has already reloaded
  // the still-active log), so finish() keeps the client here with the reason.
  const completeRejection = useRef(null);
  // Sets being typed into (not yet saved): refresh keeps their values and base revision.
  const draftIds = useRef(new Set());
  const refreshRef = useRef(null);
  const [lastChecked, setLastChecked] = useState(null);
  const [, setClock] = useState(0);
  const [swapFor, setSwapFor] = useState(null);
  // P1 guidance: compact outline, next-row reveal and per-card details.
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [reveal, setReveal] = useState(null);
  const [announcement, setAnnouncement] = useState('');
  const [detailsOpen, setDetailsOpen] = useState({});
  const [rpeOpen, setRpeOpen] = useState({});
  const landedRef = useRef(false);
  const outbox = useWorkoutOutbox(id, setLog, {
    onCompleteRejected: (message) => { completeRejection.current = message; },
    getLog: () => logRef.current,
    onConflict: () => {
      toast.message('Someone else changed this set first. Both values are kept and your coach will choose.');
      refreshRef.current?.();
    },
  });
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
      const hydrated = hydratePending(data);
      setLog(hydrated);
      setLastChecked(Date.now());
      setLoadError(null);
      // First load (fresh or resumed) lands on the next unfinished set with no
      // focus change. A fresh workout scrolls only as far as needed ('nearest')
      // so its weight, reps and Complete controls are whole while the title and
      // save status stay as high as possible; a resume centres the row.
      if (!landedRef.current) {
        landedRef.current = true;
        const next = nextWork(hydrated.exercises);
        const resumed = hydrated.exercises.some((exercise) => exercise.sets.some((set) => set.status === 'completed'));
        if (next) setReveal({ ...next, initial: !resumed, nonce: Date.now() });
      }
    } catch (error) {
      setLoadError(errMsg(error, 'Failed to load workout'));
    }
  }, [basePath, hydratePending, id, navigate]);

  useEffect(() => { load(); }, [load]);

  const refresh = useCallback(async () => {
    if (!navigator.onLine) return;
    try {
      const { data } = await api.get(`/workout-logs/${id}`);
      if (data.status !== 'active') {
        navigate(`${basePath}/workouts/${id}`, { replace: true });
        return;
      }
      setLog((current) => hydratePending(mergeRefresh(current, data, draftIds.current)));
      setLastChecked(Date.now());
    } catch {
      // Keep this device's copy; the freshness label shows its age.
    }
  }, [basePath, hydratePending, id, navigate]);
  refreshRef.current = refresh;
  useEffect(() => {
    const timer = window.setInterval(() => { refreshRef.current?.(); setClock((tick) => tick + 1); }, REFRESH_SECONDS * 1000);
    const onOnline = () => refreshRef.current?.();
    window.addEventListener('online', onOnline);
    return () => { window.clearInterval(timer); window.removeEventListener('online', onOnline); };
  }, []);

  // Bring the next unfinished set into view after a completion or on resume,
  // without moving focus and never while the person is typing in a field. A
  // jump chosen from the outline (force) moves focus to that exercise.
  useEffect(() => {
    if (!reveal) return undefined;
    const frame = requestAnimationFrame(() => {
      const tracker = document.querySelector('[data-testid="workout-tracker"]');
      const active = document.activeElement;
      const editing = active && tracker?.contains(active) && active.matches('input, textarea, select, [contenteditable="true"]');
      if (editing && !reveal.force) return;
      const selector = reveal.setId ? `[data-set-id="${CSS.escape(reveal.setId)}"]` : `[data-exercise-id="${CSS.escape(reveal.exerciseId)}"]`;
      const target = tracker?.querySelector(selector);
      if (!target) return;
      target.scrollIntoView({ block: reveal.force ? 'start' : reveal.initial ? 'nearest' : 'center', behavior: 'auto' });
      if (reveal.force) tracker.querySelector(`[data-exercise-heading="${CSS.escape(reveal.exerciseId)}"]`)?.focus({ preventScroll: true });
      if (reveal.exerciseName && !reveal.initial) setAnnouncement(`Next: ${reveal.exerciseName}${reveal.setNumber ? `, set ${reveal.setNumber}` : ''}`);
    });
    return () => cancelAnimationFrame(frame);
  }, [reveal]);

  // Save swap choices on this phone while online, so a swap still works offline.
  const contractLog = Boolean(log?.server_time);
  useEffect(() => {
    if (!contractLog || !navigator.onLine || !logRef.current) return;
    const current = logRef.current;
    const eligible = current.exercises.filter((exercise) => exercise.exercise_library_id && canSwap(exercise, current, false));
    const found = {};
    Promise.all(eligible.map((exercise) => api.get(`/workout-logs/${id}/exercises/${exercise.id}/substitution-options`)
      .then(({ data }) => { found[exercise.id] = data; }).catch(() => {})))
      .then(() => {
        try { localStorage.setItem(swapOptionsCacheKey(id), JSON.stringify({ ...readCachedSwapOptions(id), ...found })); } catch { /* cache is optional */ }
      });
  }, [contractLog, id]);

  // Re-resolve guide metadata after a failed lookup, or for one exercise whose
  // guide changed since the workout loaded (libraryId). Never touches set data
  // or the outbox; a failure here leaves the card as it was.
  const retryMedia = useCallback(async (libraryId) => {
    try {
      const { data } = await api.post('/exercise-media/resolve', { context: mediaContext });
      const byExercise = new Map((data.media || []).map((item) => [item.exercise_id, item]));
      const target = (exercise) => Boolean(exercise.exercise_library_id)
        && (libraryId ? exercise.exercise_library_id === libraryId : exercise.media_status === 'unavailable');
      setLog((current) => current && ({
        ...current,
        exercises: current.exercises.map((exercise) => (target(exercise)
          ? { ...exercise, media: byExercise.get(exercise.exercise_library_id) || null, media_status: undefined }
          : exercise)),
      }));
      if (libraryId) {
        const fresh = byExercise.get(libraryId) || null;
        setInstruction((current) => (current?.media?.exercise_id === libraryId ? (fresh ? { ...current, media: fresh } : null) : current));
        if (!fresh) toast.message('This exercise guide is no longer available. Your workout is unaffected.');
      }
    } catch {
      toast.message('Exercise guides are still unavailable. Your workout is unaffected.');
    }
  }, [mediaContext]);

  const toggleRestAlerts = () => {
    const next = !restAlerts;
    localStorage.setItem('cvf_rest_alerts', next ? 'on' : 'off');
    setRestAlerts(next);
  };

  // One history read per exercise per visit, shared by the "Last time" line and
  // the fill button. The cached result is the occurrence the fill would use, or
  // null when there is none; a failed read is not cached.
  const loadLastTime = useCallback((exercise) => {
    if (lastTimeCache.current[exercise.id] !== undefined) return Promise.resolve(lastTimeCache.current[exercise.id]);
    if (lastTimeRequests.current[exercise.id]) return lastTimeRequests.current[exercise.id];
    setLastTimeState((current) => ({ ...current, [exercise.id]: 'loading' }));
    const request = api.get(`/workout-logs/${id}/exercises/${exercise.id}/history`)
      .then(({ data }) => {
        const occurrence = pickLastTimeOccurrence(data.occurrences, exercise);
        lastTimeCache.current[exercise.id] = occurrence;
        setLastTimeState((current) => ({ ...current, [exercise.id]: 'loaded' }));
        return occurrence;
      }, (error) => {
        setLastTimeState((current) => ({ ...current, [exercise.id]: 'error' }));
        throw error;
      })
      .finally(() => { delete lastTimeRequests.current[exercise.id]; });
    lastTimeRequests.current[exercise.id] = request;
    return request;
  }, [id]);

  // Preview the source for the ACTIVE exercise only, once per visit. Offline
  // without a cached result it waits (no request) and loads on reconnect.
  const lastTimeActiveId = log ? nextExercise(log.exercises)?.id : null;
  useEffect(() => {
    const exercise = lastTimeActiveId && logRef.current?.exercises.find((row) => row.id === lastTimeActiveId);
    if (!exercise || outbox.queuedComplete) return;
    if (lastTimeCache.current[exercise.id] !== undefined || lastTimeRequests.current[exercise.id]) return;
    if (!outbox.online) {
      setLastTimeState((current) => (current[exercise.id] ? current : { ...current, [exercise.id]: 'offline' }));
      return;
    }
    if (lastTimePreloaded.current.has(exercise.id)) return;
    lastTimePreloaded.current.add(exercise.id);
    loadLastTime(exercise).catch(() => {});
  }, [lastTimeActiveId, outbox.online, outbox.queuedComplete, loadLastTime]);

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
  const posterTargets = nextPosterTargets(log.exercises, activeExerciseId);
  const activeBlock = supersetBlocks(log.exercises).find((block) => block.items.some(({ exercise }) => exercise.id === activeExercise?.id));
  const manualRest = manualRestSeconds(activeBlock && activeBlock.kind !== 'single'
    ? { prescribed_rest_seconds: supersetRestSeconds(activeBlock.items.map(({ exercise }) => exercise)) }
    : activeExercise);
  // One active row for the whole workout: the round-aware next unfinished set
  // (P1). Before, every card highlighted its own first pending set, so in a
  // superset A1 set 2 looked current while A2 set 1 was next.
  const next = nextWork(log.exercises);
  const isActiveSet = (exercise, set) => !sealed && set.id === next?.setId;
  const markers = exerciseMarkers(log.exercises);
  const outline = outlineBlocks(log.exercises);
  const nextIndex = next ? log.exercises.findIndex((exercise) => exercise.id === next.exerciseId) : -1;
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
    draftIds.current.add(setId);
    outbox.markDirty();
  };

  const fieldErrors = new Map(log.exercises.flatMap((exercise) => exercise.sets
    .filter((set) => validatedSets[set.id]).map((set) => [set.id, workoutEntryErrors(set, exercise)])));
  const entryErrors = (exercise, set) => fieldErrors.get(set.id) || {};
  const errorId = (set, field) => `set-${set.id}-${field}-error`;
  const errorProps = (exercise, set, field) => entryErrors(exercise, set)[field]
    ? { 'aria-invalid': true, 'aria-describedby': errorId(set, field) } : {};
  // RPE is optional (P1): its column opens on demand, and it always stays
  // shown while any set holds an RPE value or an RPE error, so nothing entered
  // or wrong is ever hidden.
  const rpeLocked = (exercise) => exercise.sets.some((set) => (set.actual_rpe !== null && set.actual_rpe !== undefined && set.actual_rpe !== '')
    || entryErrors(exercise, set).actual_rpe);
  const showRpe = (exercise) => Boolean(rpeOpen[exercise.id]) || rpeLocked(exercise);

  const saveSet = (exercise, set) => {
    let payload;
    try { payload = performedSet(set, exercise); } catch (error) { setValidatedSets((current) => ({ ...current, [set.id]: true })); toast.message(workoutEntryErrorMessage(error)); return; }
    outbox.enqueue({
      kind: 'set', exerciseId: exercise.id, setId: set.id,
      method: 'patch', url: `/workout-logs/${id}/sets/${set.id}`,
      data: payload,
    });
    draftIds.current.delete(set.id);
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
    draftIds.current.delete(set.id);
    if (status === 'completed') afterCompletion(exercise, set);
  };

  // After a set is completed: the round-aware rest rule (unchanged), then reveal
  // the next unfinished set without an extra Next action.
  const afterCompletion = (exercise, set) => {
    // Inside a superset/giant set, rest waits for the end of the round.
    const rest = restAfterSet(log.exercises, exercise.id, set.id);
    if (rest.seconds > 0) startRest(rest.seconds);
    else if (rest.clear) clearRest();
    const updated = updateExercise(logRef.current || log, exercise.id, (row) => ({
      ...row, sets: row.sets.map((item) => (item.id === set.id ? { ...item, status: 'completed' } : item)),
    }));
    const following = nextWork(updated.exercises);
    if (following) setReveal({ ...following, nonce: Date.now() });
    else setAnnouncement('All sets done. Finish the workout when ready.');
  };

  // Explicit "same as the previous set": records this set as performed with the
  // previous completed set's actuals. Never inferred from the prescription and
  // never applied to a set the person already typed into (workoutGuide.repeatPlan).
  const repeatPrevious = (exercise, set) => {
    const plan = repeatPlan(exercise, set, { drafting: draftIds.current.has(set.id), conflicts: log.conflicts });
    if (!plan.available) return;
    outbox.enqueue({
      kind: 'set', exerciseId: exercise.id, setId: set.id,
      method: 'patch', url: `/workout-logs/${id}/sets/${set.id}`,
      data: plan.payload,
    });
    afterCompletion(exercise, set);
  };

  const jumpTo = (exerciseId) => {
    setOutlineOpen(false);
    const exercise = log.exercises.find((row) => row.id === exerciseId);
    setReveal({ exerciseId, exerciseName: exercise?.exercise_name, force: true, nonce: Date.now() });
  };

  const addSet = (exercise) => {
    const operationId = makeId();
    outbox.enqueue({
      kind: 'add', exerciseId: exercise.id, clientOperationId: operationId,
      method: 'post', url: `/workout-logs/${id}/exercises/${exercise.id}/sets`,
      data: { client_operation_id: operationId },
    });
  };

  // PT-Sub: record the swap for this workout only. A coach backup (or any
  // choice made offline) is usable at once; an online suggestion waits for the
  // coach. The client adds the substitute's sets itself, so they can be logged
  // offline; nothing is copied from the original exercise.
  const confirmSwap = (choice) => {
    const exercise = swapFor;
    setSwapFor(null);
    const offline = !navigator.onLine;
    const activate = choice.kind === 'backup' || offline || isCoach;
    const swapId = makeId();
    const replacementId = makeId();
    const targets = {};
    if (String(choice.targets.sets ?? '').trim()) targets.sets = Number(choice.targets.sets);
    if (String(choice.targets.reps ?? '').trim()) targets.reps = String(choice.targets.reps).trim();
    if (String(choice.targets.load_value ?? '').trim()) { targets.load_value = Number(choice.targets.load_value); targets.load_unit = 'lb'; }
    const source = choice.kind === 'backup' ? 'coach_backup' : 'catalog_suggestion';
    const libraryId = choice.kind === 'backup' ? choice.item.exercise_library_id : choice.item.id;
    outbox.enqueue({
      kind: 'substitute', exerciseId: exercise.id,
      method: 'post', url: `/workout-logs/${id}/exercises/${exercise.id}/substitutions`,
      data: {
        id: swapId, replacement_log_exercise_id: replacementId, source, ...(choice.kind === 'backup' ? { backup_id: choice.item.id } : {}),
        exercise_library_id: libraryId, trigger: choice.trigger, ...(choice.reason?.trim() ? { reason: choice.reason.trim() } : {}),
        targets, offline, chosen_at: new Date().toISOString(), create_target_sets: false,
      },
      swap: { id: swapId, replacementId, name: choice.item.name, libraryId, targets, activate, source },
    });
    if (activate) {
      for (let index = 0; index < (targets.sets || 1); index += 1) {
        const operationId = makeId();
        outbox.enqueue({
          kind: 'add', exerciseId: replacementId, clientOperationId: operationId,
          method: 'post', url: `/workout-logs/${id}/exercises/${replacementId}/sets`,
          data: { client_operation_id: operationId },
        });
      }
      toast.success(offline ? `Using ${choice.item.name}. Your coach will be told when you are back online.` : `Using ${choice.item.name} for this workout.`);
    } else {
      toast.message(`Asked your coach about ${choice.item.name}.`);
    }
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
    if (sealed || lastTimeCopying.current.has(exercise.id)) return;
    lastTimeCopying.current.add(exercise.id);
    try {
      await copyLastTime(exercise);
    } finally {
      lastTimeCopying.current.delete(exercise.id);
      setLastTimePending((pending) => {
        if (!pending.has(exercise.id)) return pending;
        const next = new Set(pending);
        next.delete(exercise.id);
        return next;
      });
    }
  };

  const copyLastTime = async (exercise) => {
    let occurrence = lastTimeCache.current[exercise.id];
    if (occurrence === undefined) {
      if (!navigator.onLine) {
        toast.error('You are offline. Reconnect to copy last time.');
        return;
      }
      setLastTimePending((pending) => new Set(pending).add(exercise.id));
      try {
        occurrence = await loadLastTime(exercise);
      } catch (error) {
        toast.error(errMsg(error, 'Failed to load last time'));
        return;
      }
    }
    if (!occurrence) {
      toast.info('No history yet.');
      return;
    }
    // Re-read the exercise: anything typed while history loaded is kept.
    const current = logRef.current?.exercises.find((row) => row.id === exercise.id) || exercise;
    let filledCount = 0;
    const filledSets = [];
    lastTimeFills(current.sets, occurrence, current).forEach(({ setId, data }) => {
      const queued = outbox.enqueue({
        kind: 'set', exerciseId: exercise.id, setId,
        method: 'patch', url: `/workout-logs/${id}/sets/${setId}`,
        data,
      });
      if (queued) {
        filledCount += 1;
        filledSets.push(current.sets.find((set) => set.id === setId)?.set_number);
      }
    });
    if (!filledCount) {
      setFillNotes((notes) => ({ ...notes, [exercise.id]: 'Nothing copied: no matching blank fields.' }));
      toast.info('Nothing copied: no matching blank fields.');
      return;
    }
    setFillNotes((notes) => ({ ...notes, [exercise.id]: lastTimeFillNote(filledSets.filter(Boolean), occurrence) }));
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
    completeRejection.current = null;
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
      if (completeRejection.current) {
        setFinishOpen(false);
        toast.error(completeRejection.current);
        return;
      }
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
    <WorkoutViewport
      controls={controls}
      headerSticky={!outlineOpen}
      header={(
        <WorkoutOutline
          blocks={outline}
          next={next ? { ...next, marker: hasGroups ? markers[nextIndex] : null } : null}
          expanded={outlineOpen}
          onToggle={() => setOutlineOpen((open) => !open)}
          onJump={jumpTo}
          sealed={sealed}
        />
      )}
    >
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
        <span className="sr-only" aria-live="polite" data-testid="next-set-announcement">{announcement}</span>
        <span className="flex items-center gap-2" aria-live="polite" data-testid="workout-save-state">
          {outbox.saveState === 'saved' && <><Save className="h-3.5 w-3.5 text-success" /> Saved</>}
          {outbox.saveState === 'saving' && <><Loader2 className="h-3.5 w-3.5 animate-spin text-primary motion-reduce:animate-none" /> Saving</>}
          {outbox.saveState === 'not_saved' && <><CircleAlert className="h-3.5 w-3.5 text-gold" /> Not saved yet</>}
          {!outbox.online && <Badge variant="outline"><WifiOff className="mr-1 h-3.5 w-3.5" /> Offline</Badge>}
        </span>
        {contractLog && (
          <span className="flex items-center gap-1 text-muted-foreground" data-testid="tracker-freshness">
            <RefreshCw className="h-3 w-3" aria-hidden />{freshnessLabel(lastChecked, Date.now(), { online: outbox.online, everySeconds: REFRESH_SECONDS })}
          </span>
        )}
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
            data-exercise-id={exercise.id}
          >
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="flex min-w-0 items-center gap-2 font-display text-lg">
                  {hasGroups && <ExerciseMarker marker={marker} />}
                  <span className="min-w-0 break-words outline-none" tabIndex={-1} data-exercise-heading={exercise.id}>{exercise.exercise_name}</span>
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
              {(exercise.media || exercise.media_status === 'unavailable') && (
                <ExerciseMediaInline
                  media={exercise.media}
                  mediaStatus={exercise.media_status}
                  context={mediaContext}
                  exerciseName={exercise.exercise_name}
                  load={posterTargets.has(exercise.id) || mediaRequested.has(exercise.id)}
                  onRequestLoad={() => setMediaRequested((current) => new Set(current).add(exercise.id))}
                  onOpenInstruction={(media) => setInstruction({ media, exerciseName: exercise.exercise_name })}
                  onRetryMetadata={retryMedia}
                />
              )}
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
              {contractLog && <SwapStatus exercise={exercise} log={log} />}
              {contractLog && canSwap(exercise, log, sealed) && (
                <Button type="button" variant="ghost" size="sm" className="min-h-11 justify-start px-0 text-xs text-muted-foreground" onClick={() => setSwapFor(exercise)} data-testid="swap-open">
                  <ArrowLeftRight className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Can&apos;t do this?
                </Button>
              )}
              <ExerciseDemoAction
                demo={demoForRow(exercise)}
                exerciseName={exercise.exercise_name}
                onView={() => setDemoFor({ exerciseId: exercise.id })}
              />
            </CardHeader>
            <CardContent className="space-y-3">
              <CueRetryEntry log={log} exercise={exercise} />
              <LastTimeLine
                state={lastTimeState[exercise.id]}
                occurrence={lastTimeCache.current[exercise.id]}
                online={outbox.online}
              />
              <div className={cn('hidden gap-1 px-1 text-xs font-medium text-muted-foreground sm:grid', showRpe(exercise)
                ? 'sm:grid-cols-[1.75rem_minmax(8.5rem,2fr)_minmax(3.5rem,1fr)_minmax(3.5rem,1fr)_2.75rem]'
                : 'sm:grid-cols-[1.75rem_minmax(8.5rem,2fr)_minmax(3.5rem,1fr)_2.75rem]')}>
                <span>Set</span><span>Weight</span><span>{trackingType(exercise) === 'reps_weight' ? 'Reps' : '—'}</span>{showRpe(exercise) && <span>RPE</span>}<span className="sr-only">Complete</span>
              </div>
              {exercise.sets.map((set) => (
                <div key={set.id} data-set-id={set.id} data-active={isActiveSet(exercise, set) ? 'true' : undefined} className={cn('grid min-h-12 grid-cols-[1.75rem_minmax(0,1fr)_minmax(0,1fr)_2.75rem] items-end gap-1 rounded-md px-1 py-1 sm:items-center', showRpe(exercise)
                  ? 'sm:grid-cols-[1.75rem_minmax(8.5rem,2fr)_minmax(3.5rem,1fr)_minmax(3.5rem,1fr)_2.75rem]'
                  : 'sm:grid-cols-[1.75rem_minmax(8.5rem,2fr)_minmax(3.5rem,1fr)_2.75rem]', setRowClass(exercise, set))}>
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
                  <div className={cn('col-start-2 min-w-0 sm:col-start-auto', !showRpe(exercise) && 'col-span-2 sm:col-span-1')}>
                    <span className="text-xs text-muted-foreground sm:hidden">{trackingType(exercise) === 'reps_weight' ? 'Reps' : '—'}</span>
                    {trackingType(exercise) === 'reps_weight' ? <Input type="number" min="0" step="1" inputMode="numeric" className="h-11 px-2 text-sm tabular-nums" value={set.actual_reps ?? ''}
                      placeholder={exercise.prescribed_reps || undefined}
                      onChange={(event) => setLocalValue(exercise.id, set.id, 'actual_reps', event.target.value)} onBlur={() => saveSet(exercise, set)} disabled={sealed}
                      {...errorProps(exercise, set, 'actual_reps')} aria-label={`${exercise.exercise_name} set ${set.set_number} performed reps`} /> : <span aria-hidden className="text-center text-muted-foreground">—</span>}
                  </div>
                  {showRpe(exercise) && <div className="min-w-0">
                    <span className="text-xs text-muted-foreground sm:hidden">RPE</span>
                    <Input type="number" min="1" max="10" step="0.5" inputMode="decimal" className="h-11 px-2 text-sm tabular-nums" value={set.actual_rpe ?? ''}
                      placeholder={exercise.prescribed_rpe || undefined}
                      onChange={(event) => {
                        // Keep the column open once edited, so clearing a value never unmounts the focused field.
                        setRpeOpen((current) => (current[exercise.id] ? current : { ...current, [exercise.id]: true }));
                        setLocalValue(exercise.id, set.id, 'actual_rpe', event.target.value);
                      }} onBlur={() => saveSet(exercise, set)} disabled={sealed}
                      {...errorProps(exercise, set, 'actual_rpe')} aria-label={`${exercise.exercise_name} set ${set.set_number} performed RPE`} />
                  </div>}
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
                  {(log.conflicts || []).filter((conflict) => conflict.workout_log_set_id === set.id).map((conflict) => (
                    <SetConflictNotice key={conflict.id} conflict={conflict} logId={id} viewer={isCoach ? 'coach' : 'client'} online={outbox.online} onChanged={() => refreshRef.current?.()} />
                  ))}
                  {!sealed && set.id === exercise.sets.find((row) => row.status !== 'completed')?.id && (() => {
                    const plan = repeatPlan(exercise, set, { drafting: draftIds.current.has(set.id), conflicts: log.conflicts });
                    if (plan.available) {
                      return (
                        <Button type="button" variant="secondary" size="sm" className="col-span-full min-h-11 justify-start whitespace-normal text-left"
                          onClick={() => repeatPrevious(exercise, set)} data-testid="repeat-previous-set"
                          aria-label={`Record ${exercise.exercise_name} set ${set.set_number} as done, ${plan.label.replace(/^Same as/, 'same as')}`}>
                          <Repeat2 className="mr-1.5 h-4 w-4 shrink-0" aria-hidden /> Done · {plan.label}
                        </Button>
                      );
                    }
                    return plan.reason && !plan.quiet
                      ? <p className="col-span-full text-xs text-muted-foreground" data-testid="repeat-unavailable">{plan.reason}</p>
                      : null;
                  })()}
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" className="min-h-11" disabled={sealed} onClick={() => addSet(exercise)}>
                  <Plus className="mr-1.5 h-4 w-4" /> Add set
                </Button>
                <Button
                  type="button" variant="outline" size="sm" className="min-h-11"
                  disabled={sealed || lastTimePending.has(exercise.id)}
                  onClick={() => applyLastTime(exercise)}
                  aria-describedby={lastTimeCache.current[exercise.id] ? `last-time-source-${exercise.id}` : undefined}
                  data-testid="same-as-last-time"
                >
                  {lastTimePending.has(exercise.id)
                    ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin motion-reduce:animate-none" />
                    : <History className="mr-1.5 h-4 w-4" />}
                  Same as last time
                </Button>
                {!rpeLocked(exercise) && !sealed && (
                  <Button type="button" variant="ghost" size="sm" className="min-h-11 px-2 text-muted-foreground" aria-expanded={showRpe(exercise)}
                    data-testid="rpe-toggle" onClick={() => {
                      const opening = !rpeOpen[exercise.id];
                      setRpeOpen((current) => ({ ...current, [exercise.id]: opening }));
                      setAnnouncement(opening ? `RPE fields shown for ${exercise.exercise_name}` : `RPE fields hidden for ${exercise.exercise_name}`);
                    }}>
                    {showRpe(exercise) ? 'Hide RPE' : 'Add RPE'}
                  </Button>
                )}
                {lastTimeCache.current[exercise.id] && (
                  <span id={`last-time-source-${exercise.id}`} className="sr-only">Copies blank fields from {lastTimeDate(lastTimeCache.current[exercise.id])}.</span>
                )}
                <p role="status" className="w-full break-words text-xs text-muted-foreground empty:hidden" data-testid="last-time-note">{fillNotes[exercise.id] || ''}</p>
              </div>
              {(() => {
                // History and notes are optional, so they open on demand (P1).
                // Notes that already have text stay open: nothing entered is hidden.
                const open = detailsOpen[exercise.id] ?? Boolean(exercise.client_notes);
                return (
                  <>
                    <Button type="button" variant="ghost" size="sm" className="min-h-11 px-2 text-muted-foreground"
                      aria-expanded={open} aria-controls={`details-${exercise.id}`} data-testid="exercise-details-toggle"
                      onClick={() => setDetailsOpen((current) => ({ ...current, [exercise.id]: !open }))}>
                      {open ? 'Hide history & notes' : 'History & notes'}
                      <ChevronDown className={cn('ml-1.5 h-4 w-4 transition-transform motion-reduce:transition-none', open && 'rotate-180')} aria-hidden />
                    </Button>
                    {open && (
                      <div id={`details-${exercise.id}`} className="space-y-3" data-testid="exercise-details">
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
                      </div>
                    )}
                  </>
                );
              })()}
            </CardContent>
          </Card>
        )}</SupersetGroups>
      </div>

      <ExerciseInstructionDialog
        media={instruction?.media}
        exerciseName={instruction?.exerciseName}
        context={mediaContext}
        open={Boolean(instruction)}
        onOpenChange={(open) => { if (!open) setInstruction(null); }}
        onRetryMetadata={retryMedia}
      />

      {(() => {
        const exercise = demoFor && log.exercises.find((row) => row.id === demoFor.exerciseId);
        return (
          <ExerciseDemoDialog
            demo={exercise ? demoForRow(exercise) : null}
            exerciseName={exercise?.exercise_name}
            media={exercise?.media || null}
            context={mediaContext}
            open={Boolean(exercise)}
            onOpenChange={(open) => { if (!open) setDemoFor(null); }}
          />
        );
      })()}

      {swapFor && <SwapExerciseDialog exercise={swapFor} logId={id} online={outbox.online} onClose={() => setSwapFor(null)} onConfirm={confirmSwap} />}
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
