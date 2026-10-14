import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Loader2, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { IconButton } from '@/components/common';
import { ExerciseTrackingFields } from '@/components/training/ExerciseTrackingFields';
import { QuickSessionBadge } from '@/components/training/QuickSessionBadge';
import { trackingType } from '@/lib/workoutMetrics';
import { parseRestSeconds } from '@/lib/rest';
import { quickSessionEnvironment } from '@/lib/quickSessions';
import {
  PENDING_PREFIX, QUICK_SESSION_COPY, createQuickSessionController, defaultQuickTitle, denverToday,
} from '@/lib/quickSessionRequest';

let rowSeq = 0;
export function newQuickRow(fields = {}) {
  rowSeq += 1;
  return {
    _uid: `quick-row-${rowSeq}`, exercise_library_id: '', custom_name: '', sets: '', reps: '',
    default_load_value: '', default_load_unit: 'lb', rest: '', tempo: '', target_rpe: '', client_notes: '',
    tracking_type: 'reps_weight', duration_value: '', duration_unit: null, distance_value: '', distance_unit: null,
    ...fields,
  };
}

export function newQuickForm(today = denverToday()) {
  return { assigned_for: today, name: '', notes: '', exercises: [newQuickRow()] };
}

function browserStorage() {
  try { return window.localStorage; } catch { return null; }
}

// Owns one controller per mounted client page/account/session (page-lifetime token). The
// controller is created and disposed by the effect itself, so a StrictMode re-mount or a
// client/account/session change always gets a fresh, live controller. Workout data stays in
// memory; localStorage only ever receives the routing record (see lib/quickSessionRequest).
const CONTROLLER_METHODS = [
  'save', 'reenter', 'start', 'retryStart', 'saveToLibrary', 'retryLibrary', 'recoverAll', 'checkCurrent',
  'discard', 'resetForNew', 'dismissRecovered',
];

export function useQuickSession({ clientId, onStarted }) {
  const { user, sessionEpoch } = useAuth();
  const actorId = user?.profile?.id || null;
  const contextRef = useRef(null);
  contextRef.current = { actorId, authEpoch: sessionEpoch, clientId, environment: quickSessionEnvironment() };
  const startedRef = useRef(onStarted);
  startedRef.current = onStarted;
  const liveRef = useRef(null);
  const cardOperations = useRef(new Map());
  const [state, setState] = useState(null);
  const [form, setForm] = useState(() => newQuickForm());
  // Stable facade for callers; calls before the effect has run are no-ops.
  const controller = useMemo(() => Object.fromEntries(CONTROLLER_METHODS.map((name) => [
    name, (...args) => (liveRef.current ? liveRef.current[name](...args) : undefined),
  ])), []);

  useEffect(() => {
    const live = createQuickSessionController({
      api,
      storage: browserStorage(),
      getContext: () => contextRef.current,
      onChange: setState,
      onStarted: (log) => startedRef.current?.(log),
    });
    liveRef.current = live;
    setState(live.getState());
    setForm(newQuickForm());
    live.recoverAll();
    const onStorage = (event) => {
      if (event.key === null || String(event.key).startsWith(PENDING_PREFIX)) live.recoverAll();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('storage', onStorage);
      if (liveRef.current === live) liveRef.current = null;
      live.dispose();
    };
  }, [clientId, actorId, sessionEpoch]);

  // Cards can outlive the saved dialog, but their replies still belong to this
  // actor/session/client/page and the latest operation for a specific assignment.
  const beginCardOperation = (operation, assignmentId) => {
    const live = liveRef.current;
    const owner = contextRef.current;
    const token = { assignmentId };
    cardOperations.current.set(operation, token);
    return () => Boolean(live && owner.actorId && assignmentId)
      && liveRef.current === live
      && contextRef.current.actorId === owner.actorId
      && contextRef.current.authEpoch === owner.authEpoch
      && contextRef.current.clientId === owner.clientId
      && cardOperations.current.get(operation) === token;
  };

  return { controller, state: state || IDLE_STATE, form, setForm, beginCardOperation };
}

const IDLE_STATE = {
  phase: 'editing', requestId: null, record: null, recoverable: null, message: null, assignment: null,
  start: { state: 'idle', message: null }, library: { state: 'idle', templateId: null },
  recoveries: {}, recovered: [], corrupt: [], storageAvailable: true, hasFrozenBody: false,
};

function Field({ label, children, className = '' }) {
  const id = useId();
  return (
    <div className={`min-w-0 space-y-1 ${className}`}>
      <Label htmlFor={id}>{label}</Label>
      {typeof children === 'function' ? children(id) : children}
    </div>
  );
}

function validationError(form) {
  if (!form.assigned_for) return 'Choose a date.';
  if (!form.exercises.some((row) => row.exercise_library_id || String(row.custom_name || '').trim())) return 'Add at least one exercise.';
  return null;
}

export function QuickSessionBuilder({ form, setForm, library, state, onSave, disabled = false }) {
  const [more, setMore] = useState({});
  const [libraryToo, setLibraryToo] = useState(false);
  const [touched, setTouched] = useState(false);
  const frozen = state.phase === 'saving' || state.phase === 'checking' || state.phase === 'uncertain' || state.phase === 'unrecovered';
  const locked = disabled || frozen;
  const error = validationError(form);
  const listId = useId();
  const setRow = (index, fields) => setForm((current) => ({
    ...current, exercises: current.exercises.map((row, i) => (i === index ? { ...row, ...fields } : row)),
  }));
  const chooseExercise = (index, value) => {
    const match = library.find((exercise) => exercise.name.toLowerCase() === value.toLowerCase());
    setRow(index, match ? { exercise_library_id: match.id, custom_name: match.name } : { exercise_library_id: '', custom_name: value });
  };
  const submit = (start) => {
    setTouched(true);
    if (error) return;
    onSave({ start, library: libraryToo });
  };

  return (
    <div className="space-y-4" data-testid="quick-session-builder">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Title" className="sm:col-span-2">{(id) => (
          <Input id={id} className="min-h-11" value={form.name} disabled={locked} maxLength={120}
            placeholder={defaultQuickTitle(form.assigned_for || 'today')}
            onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="quick-session-title-input" />
        )}</Field>
        <Field label="Date">{(id) => (
          <Input id={id} type="date" className="min-h-11" value={form.assigned_for} disabled={locked} required
            onChange={(e) => setForm({ ...form, assigned_for: e.target.value })} data-testid="quick-session-date-input" />
        )}</Field>
      </div>
      <datalist id={listId}>{library.map((exercise) => <option key={exercise.id} value={exercise.name} />)}</datalist>
      <div className="space-y-3">
        {form.exercises.map((row, index) => {
          const open = Boolean(more[row._uid]);
          return (
            <div key={row._uid} className="space-y-2 rounded-xl border border-border bg-card/60 p-3" data-testid="quick-session-exercise-row">
              <div className="flex items-end gap-2">
                <Field label={`Exercise ${index + 1}`} className="flex-1">{(id) => (
                  <Input id={id} className="min-h-11" list={listId} value={row.custom_name} disabled={locked}
                    placeholder="Library or custom exercise" onChange={(e) => chooseExercise(index, e.target.value)}
                    data-testid="quick-session-exercise-name-input" />
                )}</Field>
                <IconButton label={`Remove exercise ${index + 1}`} size="touchIcon" variant="ghost" className="shrink-0 rounded-lg text-muted-foreground"
                  disabled={locked || form.exercises.length === 1}
                  onClick={() => setForm({ ...form, exercises: form.exercises.filter((_, i) => i !== index) })}
                  data-testid="quick-session-exercise-remove-button"><Trash2 className="h-4 w-4" /></IconButton>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Field label="Sets">{(id) => <Input id={id} className="min-h-11" inputMode="numeric" value={row.sets} disabled={locked} onChange={(e) => setRow(index, { sets: e.target.value })} data-testid="quick-session-sets-input" />}</Field>
                {trackingType(row) === 'reps_weight' && <Field label="Reps">{(id) => <Input id={id} className="min-h-11" value={row.reps} disabled={locked} onChange={(e) => setRow(index, { reps: e.target.value })} data-testid="quick-session-reps-input" />}</Field>}
                <Field label="Weight (optional)">{(id) => <Input id={id} className="min-h-11" type="number" min="0" step="0.5" inputMode="decimal" value={row.default_load_value} disabled={locked} onChange={(e) => setRow(index, { default_load_value: e.target.value })} data-testid="quick-session-weight-input" />}</Field>
                <Field label="Unit">{(id) => (
                  <select id={id} className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm" value={row.default_load_unit} disabled={locked}
                    onChange={(e) => setRow(index, { default_load_unit: e.target.value })} data-testid="quick-session-weight-unit">
                    <option value="lb">lb</option><option value="kg">kg</option>
                  </select>
                )}</Field>
              </div>
              <Button type="button" variant="ghost" size="sm" className="min-h-11 rounded-lg px-2 text-muted-foreground" disabled={locked}
                aria-expanded={open} onClick={() => setMore({ ...more, [row._uid]: !open })} data-testid="quick-session-more-button">
                {open ? <ChevronUp className="mr-1 h-4 w-4" /> : <ChevronDown className="mr-1 h-4 w-4" />} More
              </Button>
              {open && (
                <div className="space-y-2" data-testid="quick-session-more-fields">
                  <fieldset className="min-w-0" disabled={locked}>
                    <ExerciseTrackingFields exercise={row} onChange={(fields) => setRow(index, fields)} />
                  </fieldset>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <Field label="Rest (seconds)">{(id) => (
                      <Input id={id} className="min-h-11" type="number" min="0" step="5" inputMode="numeric" disabled={locked}
                        value={parseRestSeconds(row.rest) ?? ''} onChange={(e) => setRow(index, { rest: e.target.value === '' ? '' : `${Math.max(0, Number(e.target.value))}s` })}
                        data-testid="quick-session-rest-input" />
                    )}</Field>
                    <Field label="Tempo">{(id) => <Input id={id} className="min-h-11" value={row.tempo} disabled={locked} onChange={(e) => setRow(index, { tempo: e.target.value })} data-testid="quick-session-tempo-input" />}</Field>
                    <Field label="Target RPE">{(id) => <Input id={id} className="min-h-11" value={row.target_rpe} disabled={locked} onChange={(e) => setRow(index, { target_rpe: e.target.value })} data-testid="quick-session-rpe-input" />}</Field>
                  </div>
                  <Field label="Notes for the client">{(id) => <Input id={id} className="min-h-11" value={row.client_notes} disabled={locked} onChange={(e) => setRow(index, { client_notes: e.target.value })} data-testid="quick-session-exercise-notes-input" />}</Field>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <Button type="button" variant="secondary" size="touch" className="w-full rounded-xl" disabled={locked}
        onClick={() => setForm({ ...form, exercises: [...form.exercises, newQuickRow()] })} data-testid="quick-session-add-exercise-button">
        <Plus className="mr-1.5 h-4 w-4" /> Add exercise
      </Button>
      <Field label="Session notes">{(id) => (
        <Textarea id={id} rows={2} value={form.notes} disabled={locked} onChange={(e) => setForm({ ...form, notes: e.target.value })} data-testid="quick-session-notes-input" />
      )}</Field>
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <Checkbox checked={libraryToo} disabled={locked} onCheckedChange={(value) => setLibraryToo(value === true)} data-testid="quick-session-library-checkbox" />
        Also save to shared studio library
      </label>
      {touched && error && <p className="text-sm text-destructive" role="alert" data-testid="quick-session-validation">{error}</p>}
      {state.phase === 'rejected' && state.message && <p className="text-sm text-destructive" role="alert" data-testid="quick-session-rejected">{state.message}</p>}
      {state.recoverable === false && <p className="text-xs text-muted-foreground" data-testid="quick-session-storage-unavailable">{QUICK_SESSION_COPY.storageUnavailable}</p>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" size="touch" className="rounded-xl" disabled={locked} onClick={() => submit(true)} data-testid="quick-session-start-now-button">
          Start now
        </Button>
        <Button type="button" size="touch" className="rounded-xl" disabled={locked} onClick={() => submit(false)} data-testid="quick-session-assign-button">
          {state.phase === 'saving' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Assign'}
        </Button>
      </div>
    </div>
  );
}

// After a confirmed create: independent Start and studio-library actions on the saved id.
export function QuickSessionSaved({ state, controller, onDone, onOpenActive }) {
  const assignment = state.assignment;
  if (!assignment) return null;
  const { start, library } = state;
  return (
    <div className="space-y-3" data-testid="quick-session-saved">
      <div className="space-y-1">
        <QuickSessionBadge />
        <p className="font-display text-lg font-semibold">{assignment.workout?.name}</p>
        <p className="text-sm text-muted-foreground">Session assigned.</p>
      </div>
      {library.state === 'failed' && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm" role="alert" data-testid="quick-session-library-failed">
          <span>{QUICK_SESSION_COPY.libraryFailed}</span>
          <Button size="sm" variant="secondary" className="min-h-11 rounded-lg sm:min-h-0" onClick={() => controller.retryLibrary(assignment.id)} data-testid="quick-session-library-retry">Try again</Button>
        </div>
      )}
      {library.state === 'saved' && <p className="text-xs text-muted-foreground" data-testid="quick-session-library-saved">Saved to the shared studio library as a hidden template.</p>}
      {(start.state === 'failed' || start.state === 'conflict') && (
        <div className="space-y-2 rounded-lg border border-border bg-card/60 px-3 py-2 text-sm" role="alert" data-testid="quick-session-start-failed">
          <p>{start.message}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" className="min-h-11 rounded-lg sm:min-h-0" onClick={() => controller.retryStart(assignment.id)} data-testid="quick-session-start-retry">Try starting again</Button>
            {start.activeWorkoutId && <Button size="sm" variant="ghost" className="min-h-11 rounded-lg sm:min-h-0" onClick={() => onOpenActive(start.activeWorkoutId)} data-testid="quick-session-open-active">Open active workout</Button>}
          </div>
        </div>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {library.state !== 'saved' && library.state !== 'failed' && (
          <Button variant="ghost" size="touch" className="rounded-xl" disabled={library.state === 'saving'} onClick={() => controller.saveToLibrary(assignment.id)} data-testid="quick-session-save-library">
            {library.state === 'saving' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save to library'}
          </Button>
        )}
        {start.state !== 'started' && start.state !== 'failed' && start.state !== 'conflict' && (
          <Button variant="secondary" size="touch" className="rounded-xl" disabled={start.state === 'starting'} onClick={() => controller.start(assignment.id)} data-testid="quick-session-start-saved">
            {start.state === 'starting' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Start now'}
          </Button>
        )}
        <Button size="touch" className="rounded-xl" onClick={onDone} data-testid="quick-session-done">Done</Button>
      </div>
    </div>
  );
}

// Uncertain/unrecovered/corrupt recovery entries for this client. No old workout data is
// shown unless the server re-authorized and returned it.
export function QuickSessionRecovery({ state, controller, onReentered }) {
  const recoveries = Object.values(state.recoveries || {});
  const currentStuck = state.record && (state.phase === 'uncertain' || state.phase === 'unrecovered');
  if (!recoveries.length && !(state.corrupt || []).length && !currentStuck) return null;
  const confirmDiscard = (target) => {
    if (window.confirm(QUICK_SESSION_COPY.discardWarning)) controller.discard(target);
  };
  const reenter = async (record) => {
    if ((await controller.reenter(record)) === 'reentry') onReentered?.();
  };
  const row = (key, record, entryState, isCurrent) => (
    <div key={key} className="space-y-2 rounded-lg border border-gold/35 bg-gold/10 px-3 py-2 text-sm" role="status" data-testid="quick-session-recovery">
      <div className="flex gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden />
        <p>
          {entryState === 'checking' && 'Checking an earlier quick-session save…'}
          {entryState === 'uncertain' && QUICK_SESSION_COPY.uncertain}
          {entryState === 'unrecovered' && QUICK_SESSION_COPY.unrecovered}
          {entryState === 'access_denied' && QUICK_SESSION_COPY.accessDenied}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {isCurrent && entryState === 'uncertain' && (
          <Button size="sm" className="min-h-11 rounded-lg sm:min-h-0" onClick={() => controller.save(null)} data-testid="quick-session-retry-save">Retry save</Button>
        )}
        <Button size="sm" variant="secondary" className="min-h-11 rounded-lg sm:min-h-0" disabled={entryState === 'checking'}
          onClick={() => (isCurrent ? controller.checkCurrent() : controller.recoverAll())} data-testid="quick-session-check-again">Check again</Button>
        {(entryState === 'unrecovered' || entryState === 'access_denied') && (
          <Button size="sm" variant="secondary" className="min-h-11 rounded-lg sm:min-h-0" onClick={() => reenter(record)} data-testid="quick-session-reenter">Re-enter under this request</Button>
        )}
        <Button size="sm" variant="ghost" className="min-h-11 rounded-lg text-muted-foreground sm:min-h-0" onClick={() => confirmDiscard(record)} data-testid="quick-session-discard">Discard</Button>
      </div>
    </div>
  );
  return (
    <div className="space-y-2" data-testid="quick-session-recovery-list">
      {currentStuck && row(`current-${state.record.request_id}`, state.record, state.phase, true)}
      {recoveries.map((entry) => row(entry.record.request_id, entry.record, entry.state, false))}
      {(state.corrupt || []).map((key) => (
        <div key={key} className="flex flex-wrap items-center gap-2 rounded-lg border border-gold/35 bg-gold/10 px-3 py-2 text-sm" role="status" data-testid="quick-session-corrupt">
          <AlertTriangle className="h-4 w-4 shrink-0 text-gold" aria-hidden />
          <span className="min-w-0 flex-1">{QUICK_SESSION_COPY.corrupt}</span>
          <Button size="sm" variant="ghost" className="min-h-11 rounded-lg text-muted-foreground sm:min-h-0" onClick={() => confirmDiscard(key)} data-testid="quick-session-corrupt-discard">Discard</Button>
        </div>
      ))}
    </div>
  );
}

export function useQuickSessionSave({ controller, form }) {
  return useCallback((intent) => controller.save(form, intent), [controller, form]);
}
