import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowRight, Check, CloudOff, Loader2, Plus, RefreshCw, UserRoundPlus, Wrench, Undo2,
} from 'lucide-react';
import { api, errMsg } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { PageHeader, ListSkeleton, LoadErrorState } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { makeId } from '@/lib/workoutOutbox';
import { denverToday } from '@/lib/quickSessionRequest';
import { quickSessionEnvironment } from '@/lib/quickSessions';
import {
  MAX_STATIONS, MIN_STATIONS, activeOccupant, addExtraSet, advanceRound, amendStation, createGroupSession,
  effectiveExercise, getVisit, inSessionTraineeIds, occupantsFor, openVisit, recordEntry, restoreStation,
  roundBlockers, stationFor, stationLabel, substituteTrainee, unsyncedSets, validateSetup,
} from '@/lib/groupSession';
import { clearGroupSession, loadGroupSession, saveGroupSession } from '@/lib/groupSessionStore';
import { createGroupSessionSync } from '@/lib/groupSessionSync';
import GroupSummary from '@/components/group/GroupSummary';
import ParticipantConductor from '@/components/group/ParticipantConductor';
import { cn } from '@/lib/utils';

const SELECT = 'h-11 w-full rounded-md border border-input bg-background px-3 text-sm';
const emptyStation = () => ({ exercise_library_id: '', name: '', sets: '3', reps: '10', default_load_value: '', default_load_unit: 'lb' });

function pickExercise(library, id) {
  const row = library.find((item) => item.id === id);
  return row ? { exercise_library_id: row.id, name: row.name } : { exercise_library_id: '', name: '' };
}

function ExerciseFields({ value, onChange, library, prefix }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
      <label className="space-y-1 text-xs text-muted-foreground">Exercise
        <select className={SELECT} value={value.exercise_library_id} data-testid={`${prefix}-exercise`}
          onChange={(e) => onChange({ ...value, ...pickExercise(library, e.target.value) })}>
          <option value="">Choose…</option>
          {library.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
        </select>
      </label>
      <label className="space-y-1 text-xs text-muted-foreground">Sets
        <Input className="min-h-11" inputMode="numeric" value={value.sets} data-testid={`${prefix}-sets`}
          onChange={(e) => onChange({ ...value, sets: e.target.value })} />
      </label>
      <label className="space-y-1 text-xs text-muted-foreground">Reps
        <Input className="min-h-11" value={value.reps} data-testid={`${prefix}-reps`}
          onChange={(e) => onChange({ ...value, reps: e.target.value })} />
      </label>
      <label className="space-y-1 text-xs text-muted-foreground">Load (lb)
        <Input className="min-h-11" inputMode="decimal" value={value.default_load_value} data-testid={`${prefix}-load`}
          onChange={(e) => onChange({ ...value, default_load_value: e.target.value, default_load_unit: 'lb' })} />
      </label>
    </div>
  );
}

function GroupSetup({ clients, library, onStart, error }) {
  const [title, setTitle] = useState('');
  const [picked, setPicked] = useState([]);
  const [stations, setStations] = useState([emptyStation(), emptyStation(), emptyStation()]);
  const trainees = clients.filter((client) => picked.includes(client.id));
  const problems = validateSetup({ trainees, stations });
  const toggle = (id) => setPicked((rows) => (rows.includes(id) ? rows.filter((row) => row !== id) : [...rows, id]));
  return (
    <div className="space-y-5" data-testid="group-setup">
      <p className="text-sm text-muted-foreground">
        Plan the stations and who is training. During the session each trainee&apos;s sets are saved to their own workout;
        other trainees never appear in it.
      </p>
      <label className="block space-y-1 text-sm">Session name <span className="text-xs text-muted-foreground">(only you see this)</span>
        <Input className="min-h-11" value={title} maxLength={80} placeholder={`Small group · ${denverToday()}`}
          onChange={(e) => setTitle(e.target.value)} data-testid="group-title" />
      </label>
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Trainees <span className="font-normal text-muted-foreground">({picked.length} chosen)</span></h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {clients.map((client) => (
            <label key={client.id} className={cn('flex min-h-11 items-center gap-3 rounded-lg border px-3 text-sm', picked.includes(client.id) ? 'border-primary bg-primary/10' : 'border-border')}>
              <input type="checkbox" className="h-4 w-4" checked={picked.includes(client.id)} onChange={() => toggle(client.id)}
                data-testid={`group-trainee-option-${client.id}`} />
              {client.name}
            </label>
          ))}
        </div>
      </section>
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Stations</h2>
        {stations.map((station, index) => (
          <div key={index} className="space-y-2 rounded-xl border border-border bg-card/60 p-3" data-testid={`group-station-setup-${index}`}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{stationLabel(index)}</span>
              {stations.length > MIN_STATIONS ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => setStations((rows) => rows.filter((_, i) => i !== index))}>Remove</Button>
              ) : null}
            </div>
            <ExerciseFields value={station} library={library} prefix={`group-station-${index}`}
              onChange={(next) => setStations((rows) => rows.map((row, i) => (i === index ? next : row)))} />
          </div>
        ))}
        {stations.length < MAX_STATIONS ? (
          <Button type="button" variant="outline" onClick={() => setStations((rows) => [...rows, emptyStation()])}><Plus /> Add station</Button>
        ) : null}
      </section>
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
      {picked.length > 0 && problems.length ? <p className="text-sm text-muted-foreground" data-testid="group-setup-problems">{problems.join(' ')}</p> : null}
      <Button className="min-h-11" disabled={problems.length > 0} data-testid="group-start"
        onClick={() => onStart({ title, trainees: trainees.map((row) => ({ id: row.id, name: row.name })), stations })}>
        Start session
      </Button>
    </div>
  );
}

function SetRow({ visit, planned, set, exercise, disabled, onSave }) {
  const unit = exercise.default_load_unit || 'lb';
  const numericReps = /^\d+$/.test(String(exercise.reps || '')) ? exercise.reps : '';
  const [reps, setReps] = useState(set?.entry?.reps ?? numericReps);
  const [load, setLoad] = useState(set?.entry?.load ?? exercise.default_load_value ?? '');
  useEffect(() => {
    if (set?.entry && set.state === 'saved') {
      setReps(set.entry.reps ?? '');
      setLoad(set.entry.load ?? '');
    }
  }, [set?.entry, set?.state]);
  const state = set?.state || 'empty';
  const number = set?.setNumber ?? planned;
  const testId = `group-set-${visit.traineeId}-${number}`;
  return (
    <div className="space-y-1" data-testid={testId} data-state={state}>
      <div className="flex items-center gap-2">
        <span className="w-12 shrink-0 text-xs text-muted-foreground">{set?.origin === 'extra' ? `+${number}` : `Set ${number}`}</span>
        <Input aria-label={`${visit.traineeName} set ${number} reps`} className="h-11 w-16" inputMode="numeric" value={reps}
          disabled={disabled} onChange={(e) => setReps(e.target.value)} data-testid={`${testId}-reps`} />
        <span className="text-xs text-muted-foreground">×</span>
        <Input aria-label={`${visit.traineeName} set ${number} weight`} className="h-11 w-20" inputMode="decimal" value={load}
          disabled={disabled} onChange={(e) => setLoad(e.target.value)} data-testid={`${testId}-load`} />
        <span className="text-xs text-muted-foreground">{unit}</span>
        <Button type="button" size="sm" variant={state === 'saved' ? 'outline' : 'default'} className="h-11 min-w-16" disabled={disabled}
          onClick={() => onSave({ reps, load, unit })} data-testid={`${testId}-save`}>
          {state === 'pending' ? <Loader2 className="animate-spin" /> : state === 'saved' ? <Check /> : null}
          {state === 'saved' ? 'Saved' : state === 'failed' ? 'Retry' : 'Save'}
        </Button>
      </div>
      {set?.error ? <p className="text-xs text-destructive" role="alert" data-testid={`${testId}-error`}>{set.error}</p> : null}
    </div>
  );
}

function TraineeBlock({ session, slotIndex, occupant, isActive, onSave, onAddSet, onSubstitute, onRetry }) {
  const round = session.round;
  const visit = getVisit(session, round, slotIndex, occupant.traineeId);
  const station = stationFor(session, slotIndex, round);
  const exercise = visit ? visit.exercise : effectiveExercise(session, station.id);
  const closed = visit && ['completed', 'abandoned', 'missing', 'blocked'].includes(visit.status);
  const placeholder = { traineeId: occupant.traineeId, traineeName: occupant.name };
  // Someone who left shows only the work they recorded, never open rows.
  const rows = visit ? visit.sets.filter((set) => isActive || set.entry) : Array.from({ length: exercise.sets }, () => null);
  return (
    <div className={cn('space-y-2 rounded-lg border p-3', isActive ? 'border-border' : 'border-dashed border-border/70 opacity-80')}
      data-testid={`group-trainee-${occupant.traineeId}`} data-visit-status={visit?.status || 'none'}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium" data-testid={`group-trainee-name-${occupant.traineeId}`}>{occupant.name}</p>
          {!isActive ? <p className="text-xs text-muted-foreground">Left the session · recorded work kept</p> : null}
          {visit && exercise.name !== effectiveExercise(session, station.id).name ? (
            <p className="text-xs text-muted-foreground" data-testid={`group-trainee-kept-exercise-${occupant.traineeId}`}>Already started here, so keeps {exercise.name}</p>
          ) : null}
        </div>
        {isActive ? (
          <Button type="button" size="sm" variant="ghost" onClick={onSubstitute} data-testid={`group-substitute-${occupant.traineeId}`}>
            <UserRoundPlus /> Substitute
          </Button>
        ) : null}
      </div>
      {visit?.error ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-destructive" role="alert" data-testid={`group-visit-error-${occupant.traineeId}`}>
          <AlertTriangle className="h-3.5 w-3.5" /> {visit.error}
          {visit.status === 'blocked' || visit.status === 'open' ? <Button type="button" size="sm" variant="outline" onClick={() => onRetry(visit.key)}>Try again</Button> : null}
        </div>
      ) : null}
      {(isActive || visit) ? rows.map((set, index) => (
        <SetRow key={set?.key || `planned-${index}`} visit={visit || placeholder} planned={index + 1} set={set} exercise={exercise}
          disabled={!isActive || closed} onSave={(entry) => onSave(occupant, set?.key || `p${index + 1}`, entry)} />
      )) : null}
      {isActive && visit && !closed ? (
        <Button type="button" size="sm" variant="ghost" onClick={() => onAddSet(visit.key)} data-testid={`group-add-set-${occupant.traineeId}`}><Plus /> Extra set</Button>
      ) : null}
    </div>
  );
}

function StationCard({ session, station, onAmend, onRestore, children }) {
  const current = effectiveExercise(session, station.id);
  return (
    <section className="space-y-3 rounded-xl border border-border bg-card/60 p-4" data-testid={`group-station-${station.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{station.label}</p>
          <p className="font-semibold" data-testid={`group-station-${station.id}-exercise`}>{current.name}</p>
          <p className="text-xs text-muted-foreground">{current.sets} × {current.reps}{current.default_load_value != null ? ` @ ${current.default_load_value} ${current.default_load_unit}` : ''}</p>
          {current.amended ? (
            <Badge variant="outline" className="mt-1" data-testid={`group-station-${station.id}-amended`}>Equipment change · planned {current.replaces}</Badge>
          ) : null}
        </div>
        {current.amended ? (
          <Button type="button" size="sm" variant="outline" onClick={onRestore} data-testid={`group-restore-${station.id}`}><Undo2 /> Equipment back</Button>
        ) : (
          <Button type="button" size="sm" variant="outline" onClick={onAmend} data-testid={`group-amend-${station.id}`}><Wrench /> Equipment issue</Button>
        )}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function AmendDialog({ station, library, onClose, onConfirm }) {
  const [value, setValue] = useState({ ...emptyStation(), sets: String(station?.plan.sets || 3), reps: station?.plan.reps || '10' });
  const [reason, setReason] = useState('');
  return (
    <Dialog open={Boolean(station)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent data-testid="group-amend-dialog">
        <DialogHeader>
          <DialogTitle>Equipment issue at {station?.label}</DialogTitle>
          <DialogDescription>
            Choose what trainees do here instead. Sets already recorded and the original plan ({station?.plan.name}) are kept;
            the change applies to trainees who have not started this station yet.
          </DialogDescription>
        </DialogHeader>
        <ExerciseFields value={value} onChange={setValue} library={library} prefix="group-amend" />
        <label className="block space-y-1 text-xs text-muted-foreground">Reason (for your session notes only)
          <Input className="min-h-11" value={reason} maxLength={160} onChange={(e) => setReason(e.target.value)} data-testid="group-amend-reason" />
        </label>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!value.name} onClick={() => onConfirm(value, reason)} data-testid="group-amend-confirm">Use instead</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SubstituteDialog({ target, candidates, onClose, onConfirm }) {
  const [choice, setChoice] = useState('');
  const [reason, setReason] = useState('');
  const picked = candidates.find((row) => row.id === choice);
  return (
    <Dialog open={Boolean(target)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent data-testid="group-substitute-dialog">
        <DialogHeader>
          <DialogTitle>Substitute for {target?.occupant.name}</DialogTitle>
          <DialogDescription>
            The substitute takes over this rotation from now on. {target?.occupant.name}&apos;s recorded sets stay theirs.
          </DialogDescription>
        </DialogHeader>
        <label className="block space-y-1 text-xs text-muted-foreground">Substitute
          <select className={SELECT} value={choice} onChange={(e) => setChoice(e.target.value)} data-testid="group-substitute-choice">
            <option value="">Choose…</option>
            {candidates.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        </label>
        <label className="block space-y-1 text-xs text-muted-foreground">Reason (for your session notes only)
          <Input className="min-h-11" value={reason} maxLength={160} onChange={(e) => setReason(e.target.value)} data-testid="group-substitute-reason" />
        </label>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!picked} onClick={() => onConfirm(picked, reason)} data-testid="group-substitute-confirm">Substitute</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function GroupSession() {
  const { user } = useAuth();
  const scope = useMemo(() => ({ environment: quickSessionEnvironment(), coachId: user?.profile?.id }), [user?.profile?.id]);
  const [session, setSession] = useState(() => (scope.coachId ? loadGroupSession(localStorage, scope) : null));
  const sessionRef = useRef(session);
  const [stored, setStored] = useState(true);
  const [clients, setClients] = useState(null);
  const [library, setLibrary] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [amending, setAmending] = useState(null);
  const [substituting, setSubstituting] = useState(null);

  const [mode, setMode] = useState('choose');
  const [serverOpen, setServerOpen] = useState([]);
  const [mirrorState, setMirrorState] = useState('pending');
  const mirror = useRef({ revision: null, timer: null });

  // The station plan also goes to the coach's account (pt-session-events/v1 §4),
  // so another coach device can resume it. Coach-only; never sent to trainees.
  const pushMirror = useCallback(() => {
    window.clearTimeout(mirror.current.timer);
    mirror.current.timer = window.setTimeout(async () => {
      const current = sessionRef.current;
      if (!current) return;
      const ids = [...new Set(current.slots.flatMap((slot) => slot.occupants.map((row) => row.traineeId)))].slice(0, 6);
      try {
        if (mirror.current.revision === null) {
          const { data } = await api.post('/group-sessions', { id: current.id, title: current.title, mode: 'stations', participant_ids: ids, station_state: current });
          mirror.current.revision = data.session.revision;
          if (data.outcome === 'created') { setMirrorState('saved'); return; }
        }
        const { data } = await api.patch(`/group-sessions/${current.id}`, {
          base_revision: mirror.current.revision, station_state: sessionRef.current, participant_ids: ids,
          ...(current.status === 'finished' ? { status: 'finished' } : {}),
        });
        mirror.current.revision = data.session.revision;
        setMirrorState('saved');
      } catch (error) {
        if (error.response?.status === 409 && error.response.data?.session) {
          // Another coach device changed the plan: adopt it rather than overwrite.
          mirror.current.revision = error.response.data.session.revision;
          const remote = error.response.data.session.station_state;
          if (remote) {
            sessionRef.current = remote;
            saveGroupSession(localStorage, scope, remote);
            setSession(remote);
          }
          setMirrorState('replaced');
        } else {
          setMirrorState('local');
        }
      }
    }, 600);
  }, [scope]);

  // Write-ahead: every change is stored on this device before any request.
  const commit = useCallback((updater) => {
    const next = updater(sessionRef.current);
    sessionRef.current = next;
    setStored(next ? saveGroupSession(localStorage, scope, next) : true);
    setSession(next);
    if (next) pushMirror();
    return next;
  }, [scope, pushMirror]);

  const sync = useMemo(() => createGroupSessionSync({ api, getSession: () => sessionRef.current, commit }), [commit]);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const [{ data: clientRows }, { data: libraryRows }] = await Promise.all([api.get('/clients'), api.get('/programs/exercise-library')]);
      setClients((clientRows || []).filter((row) => !row.archived));
      setLibrary((libraryRows || []).filter((row) => !row.archived && !row.hidden));
    } catch (error) {
      setLoadError(errMsg(error, 'Could not load your clients and exercises.'));
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (sessionRef.current?.status === 'running') sync.resume(); }, [sync]);
  useEffect(() => {
    if (sessionRef.current) { pushMirror(); return; }
    api.get('/group-sessions/open').then(({ data }) => setServerOpen((data.sessions || []).filter((row) => row.mode === 'stations' && row.station_state))).catch(() => {});
  }, [pushMirror]);
  const resumeHere = (row) => {
    mirror.current.revision = row.revision;
    commit(() => ({ ...row.station_state, environment: scope.environment, coachId: scope.coachId }));
    sync.resume();
  };

  const start = (setup) => {
    setActionError('');
    try {
      commit(() => createGroupSession({ id: makeId(), environment: scope.environment, coachId: scope.coachId, date: denverToday(), ...setup }));
    } catch (error) {
      setActionError(error.message);
    }
  };

  const saveEntry = (occupant, slotIndex, setKey, entry) => {
    setActionError('');
    try {
      const round = sessionRef.current.round;
      let key = getVisit(sessionRef.current, round, slotIndex, occupant.traineeId)?.key;
      if (!key) {
        commit((current) => openVisit(current, { round, slotIndex, traineeId: occupant.traineeId, requestId: makeId() }));
        key = getVisit(sessionRef.current, round, slotIndex, occupant.traineeId).key;
      }
      commit((current) => recordEntry(current, key, setKey, entry));
      sync.saveSet(key, setKey);
    } catch (error) {
      setActionError(error.message);
    }
  };

  const addSet = (key) => {
    try { commit((current) => addExtraSet(current, key, makeId())); } catch (error) { setActionError(error.message); }
  };

  const rotate = async () => {
    setBusy(true);
    setActionError('');
    try {
      await sync.closeRound(sessionRef.current.round);
      const blockers = roundBlockers(sessionRef.current);
      if (blockers.length) setActionError(blockers.join(' '));
      else commit((current) => advanceRound(current));
    } catch (error) {
      setActionError(error.message || 'Could not finish this round.');
    } finally {
      setBusy(false);
    }
  };

  const discard = () => {
    const pending = session ? unsyncedSets(session).length : 0;
    const warning = pending
      ? `${pending} entered set(s) have not reached the server yet and will be lost. Workouts already saved stay in each trainee's history. Discard this session?`
      : 'Close this session on this device? Workouts already saved stay in each trainee\'s history.';
    if (!window.confirm(warning)) return;
    clearGroupSession(localStorage, scope);
    sessionRef.current = null;
    setSession(null);
  };

  if (!scope.coachId) return <ListSkeleton />;
  if (loadError && !clients) return <LoadErrorState message={loadError} onRetry={load} />;
  if (!clients && !session) return <ListSkeleton />;

  if (!session) {
    return (
      <div>
        <PageHeader title="Small group" subtitle="Log for several trainees and keep each person's sets separate." testId="group-header" />
        {mode === 'choose' && (
          <div className="space-y-3" data-testid="group-mode-choice">
            <Button className="min-h-11 w-full justify-start sm:w-auto" onClick={() => setMode('participants')} data-testid="group-mode-participants">Each trainee&apos;s own workout (group logging)</Button>
            <Button variant="outline" className="min-h-11 w-full justify-start sm:w-auto sm:ml-2" onClick={() => setMode('stations')} data-testid="group-mode-stations">Stations that rotate</Button>
            {serverOpen.length > 0 && (
              <div className="space-y-2 rounded-lg border border-border p-3 text-sm" data-testid="group-resume-list">
                <p className="font-medium">Open station sessions on your account</p>
                {serverOpen.map((row) => (
                  <Button key={row.id} variant="outline" className="min-h-11" onClick={() => resumeHere(row)} data-testid="group-resume-here">Resume “{row.title}” on this device</Button>
                ))}
              </div>
            )}
          </div>
        )}
        {mode === 'participants' && <ParticipantConductor clients={clients || []} library={library} onBack={() => setMode('choose')} />}
        {mode === 'stations' && <GroupSetup clients={clients || []} library={library} onStart={start} error={actionError} />}
      </div>
    );
  }

  if (session.status === 'finished') {
    return (
      <div>
        <PageHeader title={session.title} subtitle="Session summary" testId="group-header"
          action={<Button variant="outline" onClick={discard} data-testid="group-new">Start a new session</Button>} />
        <GroupSummary session={session} />
      </div>
    );
  }

  const round = session.round;
  const pending = unsyncedSets(session);
  const blockers = roundBlockers(session);
  const present = inSessionTraineeIds(session);
  const candidates = (clients || []).filter((row) => !present.has(row.id));
  const last = round + 1 >= session.roundCount;

  return (
    <div className="space-y-4">
      <PageHeader title={session.title} subtitle={`Round ${round + 1} of ${session.roundCount}`} testId="group-header"
        action={<Button variant="ghost" onClick={discard} data-testid="group-discard">Close session</Button>} />
      <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="group-sync-status" aria-live="polite">
        {pending.length ? (
          <>
            <CloudOff className="h-4 w-4 text-gold" /> {pending.length} set(s) waiting to save
            <Button size="sm" variant="outline" onClick={() => sync.flush()} data-testid="group-retry-all"><RefreshCw /> Retry now</Button>
          </>
        ) : <><Check className="h-4 w-4 text-primary" /> All entered sets are saved</>}
        <span className="text-xs text-muted-foreground" data-testid="group-mirror-state" data-state={mirrorState}>
          {mirrorState === 'saved' ? '· Plan saved to your account' : mirrorState === 'replaced' ? '· Plan was changed on another device; showing that version' : mirrorState === 'local' ? '· Plan only on this device for now' : ''}
        </span>
        {!stored ? <span className="text-destructive">This browser refused to store the session; do not reload until everything is saved.</span> : null}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {session.stations.map((station) => (
          <StationCard key={station.id} session={session} station={station}
            onAmend={() => setAmending(station)}
            onRestore={() => commit((current) => restoreStation(current, { id: makeId(), stationId: station.id }))}>
            {session.slots.filter((slot) => stationFor(session, slot.index, round).id === station.id).flatMap((slot) => {
              const active = activeOccupant(session, slot.index, round);
              return occupantsFor(session, slot.index, round).map((occupant) => (
                <TraineeBlock key={`${slot.index}:${occupant.traineeId}`} session={session} slotIndex={slot.index} occupant={occupant}
                  isActive={occupant === active}
                  onSave={(person, setKey, entry) => saveEntry(person, slot.index, setKey, entry)}
                  onAddSet={addSet}
                  onRetry={(key) => sync.retryVisit(key)}
                  onSubstitute={() => setSubstituting({ slotIndex: slot.index, occupant })} />
              ));
            })}
          </StationCard>
        ))}
      </div>
      {actionError ? <p className="text-sm text-destructive" role="alert" data-testid="group-action-error">{actionError}</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button className="min-h-11" onClick={rotate} disabled={busy} data-testid="group-rotate">
          {busy ? <Loader2 className="animate-spin" /> : <ArrowRight />} {last ? 'Finish session' : `Rotate to round ${round + 2}`}
        </Button>
        {blockers.length && !busy ? <span className="text-xs text-muted-foreground">Saves and closes each trainee&apos;s station first.</span> : null}
      </div>
      <AmendDialog key={amending?.id || 'none'} station={amending} library={library} onClose={() => setAmending(null)}
        onConfirm={(exercise, reason) => {
          try { commit((current) => amendStation(current, { id: makeId(), stationId: amending.id, exercise, reason })); setAmending(null); } catch (error) { setActionError(error.message); }
        }} />
      <SubstituteDialog key={substituting ? `${substituting.slotIndex}:${substituting.occupant.traineeId}` : 'none'} target={substituting} candidates={candidates}
        onClose={() => setSubstituting(null)}
        onConfirm={(substitute, reason) => {
          try { commit((current) => substituteTrainee(current, { slotIndex: substituting.slotIndex, substitute: { id: substitute.id, name: substitute.name }, reason })); setSubstituting(null); } catch (error) { setActionError(error.message); }
        }} />
    </div>
  );
}
