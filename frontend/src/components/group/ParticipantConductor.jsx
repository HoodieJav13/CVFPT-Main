import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Bell, Check, Loader2, Pencil, Play, RefreshCw, ShieldPlus, Smartphone, Users,
} from 'lucide-react';
import { api, errMsg } from '@/lib/api';
import { makeId } from '@/lib/workoutOutbox';
import { freshnessLabel } from '@/lib/workoutSync';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { SetConflictNotice, SwapStatus } from '@/components/training/SessionCorrections';
import { CoachConflictActions, CoachSwapActions } from '@/components/group/CoachSessionActions';

// L12 coach-first group logging (pt-session-events/v1, L12/CONTRACT.md).
// The conductor record lives on the server (any coach device can resume it);
// every participant's sets are written to that participant's own log with an
// event id and the revision the coach saw, so retries replay and a value the
// client changed meanwhile is kept as a disagreement, never overwritten.
// No live push: the group view re-reads on a fixed cadence and says so.

export const GROUP_REFRESH_SECONDS = 5;
const PENDING_KEY = 'cvf_coach_set_pending_v1';
const SELF_LOGGING_WINDOW_MS = 2 * 60 * 1000;

function readPending() {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '{}'); } catch { return {}; }
}
function writePending(map) {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(map)); } catch { /* best effort */ }
}

// Write-ahead coach set write: the event id is stored before sending, so a
// retry after a lost reply sends the same id and the server replays it.
async function sendCoachSet(logId, set, payload, baseRevision) {
  const pending = readPending();
  const key = `${logId}:${set.id}`;
  const same = pending[key] && JSON.stringify(pending[key].payload) === JSON.stringify(payload);
  const entry = same ? pending[key] : { event_id: makeId(), base_revision: baseRevision, payload };
  pending[key] = entry;
  writePending(pending);
  const { data } = await api.patch(`/workout-logs/${logId}/sets/${set.id}`, { ...entry.payload, event_id: entry.event_id, base_revision: entry.base_revision });
  const after = readPending();
  delete after[key];
  writePending(after);
  return data;
}

function CoachSetRow({ log, exercise, set, onSaved }) {
  const [reps, setReps] = useState(set.actual_reps ?? '');
  const [load, setLoad] = useState(set.actual_load_value ?? exercise.prescribed_load_value ?? '');
  const [dirty, setDirty] = useState(false);
  const [baseRevision, setBaseRevision] = useState(set.revision ?? 0);
  const [state, setState] = useState(set.status === 'completed' ? 'saved' : 'idle');
  // A refresh never replaces what the coach is typing; the edit keeps the
  // revision it started from, so a stale save becomes a kept disagreement.
  useEffect(() => {
    if (dirty) return;
    setReps(set.actual_reps ?? '');
    setLoad(set.actual_load_value ?? exercise.prescribed_load_value ?? '');
    setBaseRevision(set.revision ?? 0);
    setState(set.status === 'completed' ? 'saved' : 'idle');
  }, [dirty, set.actual_reps, set.actual_load_value, set.revision, set.status, exercise.prescribed_load_value]);
  const edit = (setter) => (event) => {
    if (!dirty) { setDirty(true); setBaseRevision(set.revision ?? 0); }
    setter(event.target.value);
  };
  const save = async () => {
    const payload = {
      status: 'completed',
      actual_reps: reps === '' ? null : Number(reps),
      actual_load_value: load === '' ? null : Number(load),
      actual_load_unit: load === '' ? null : (set.actual_load_unit || exercise.prescribed_load_unit || 'lb'),
    };
    setState('saving');
    try {
      const data = await sendCoachSet(log.id, set, payload, dirty ? baseRevision : (set.revision ?? 0));
      const outcome = data.event?.outcome;
      setDirty(false);
      if (outcome === 'conflict' || data.event?.original_outcome === 'conflict') {
        setState('conflict');
        toast.message(`${log.client_name || 'The client'} changed this set first. Both values are kept; choose the final one below.`);
      } else {
        setState('saved');
      }
      onSaved?.();
    } catch (error) {
      setState(error.response ? 'error' : 'failed');
      if (error.response) toast.error(errMsg(error, 'Not saved.'));
    }
  };
  const tid = `coach-set-${exercise.exercise_name.replace(/\W+/g, '-')}-${set.set_number}`;
  const sealed = log.status !== 'active';
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={tid} data-state={state} data-actor={set.last_actor_role || ''}>
      <span className="w-12 text-xs text-muted-foreground">Set {set.set_number}</span>
      <Input aria-label={`${exercise.exercise_name} set ${set.set_number} reps`} className="h-11 w-16" inputMode="numeric" value={reps} disabled={sealed} onChange={edit(setReps)} data-testid={`${tid}-reps`} />
      <span className="text-xs text-muted-foreground">×</span>
      <Input aria-label={`${exercise.exercise_name} set ${set.set_number} weight`} className="h-11 w-20" inputMode="decimal" value={load} disabled={sealed} onChange={edit(setLoad)} data-testid={`${tid}-load`} />
      <Button type="button" size="sm" className="h-11 min-w-20" variant={state === 'saved' && !dirty ? 'outline' : 'default'} disabled={sealed || state === 'saving'} onClick={save} data-testid={`${tid}-save`}>
        {state === 'saving' ? <Loader2 className="animate-spin" /> : state === 'saved' && !dirty ? <Check /> : null}
        {state === 'failed' ? 'Retry' : state === 'saved' && !dirty ? 'Saved' : 'Save'}
      </Button>
      {set.last_actor_role === 'client' && <Badge variant="outline" className="text-xs">by client</Badge>}
      {state === 'failed' && <span className="text-xs text-destructive">Not saved yet: no answer. Kept here; tap Retry.</span>}
    </div>
  );
}

function PlanEditDialog({ log, exercise, onClose }) {
  const [reps, setReps] = useState(exercise.prescribed_reps || '');
  const [load, setLoad] = useState(exercise.prescribed_load_value ?? '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.patch(`/workout-logs/${log.id}/exercises/${exercise.id}/plan`, {
        event_id: makeId(), base_plan_revision: exercise.plan_revision || 0, prescribed_reps: reps, prescribed_load_value: load === '' ? null : Number(load),
      });
      toast.success('Plan updated for the sets not done yet.');
      onClose(true);
    } catch (error) {
      toast.error(errMsg(error, 'Not saved.'));
      onClose(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(false); }}>
      <DialogContent data-testid="plan-edit-dialog">
        <DialogHeader>
          <DialogTitle>Change the rest of {exercise.exercise_name}</DialogTitle>
          <DialogDescription>Applies to sets not done yet. Completed sets keep what was done; a client offline keeps the plan they had and you will see that.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1 text-xs text-muted-foreground">Reps<Input className="min-h-11" value={reps} onChange={(e) => setReps(e.target.value)} data-testid="plan-edit-reps" /></label>
          <label className="space-y-1 text-xs text-muted-foreground">Load (lb)<Input className="min-h-11" value={load} onChange={(e) => setLoad(e.target.value)} data-testid="plan-edit-load" /></label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onClose(false)}>Cancel</Button>
          <Button disabled={busy} onClick={save} data-testid="plan-edit-save">Update unfinished sets</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BackupDialog({ exercise, library, onClose }) {
  const [libraryId, setLibraryId] = useState('');
  const [targets, setTargets] = useState({ sets: '', reps: '', load_value: '' });
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const choices = library.filter((row) => row.review_status !== 'needs_review' && row.id !== exercise.exercise_library_id);
  const save = async () => {
    setBusy(true);
    try {
      const clean = {};
      if (String(targets.sets).trim()) clean.sets = Number(targets.sets);
      if (String(targets.reps).trim()) clean.reps = String(targets.reps).trim();
      if (String(targets.load_value).trim()) { clean.load_value = Number(targets.load_value); clean.load_unit = 'lb'; }
      await api.post(`/programs/workout-exercises/${exercise.source_workout_exercise_id}/backups`, { exercise_library_id: libraryId, targets: clean, ...(note.trim() ? { client_note: note.trim() } : {}) });
      toast.success('Backup planned. The client can use it right away if needed.');
      onClose(true);
    } catch (error) {
      toast.error(errMsg(error, 'Not saved.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(false); }}>
      <DialogContent data-testid="backup-dialog">
        <DialogHeader>
          <DialogTitle>Backup if {exercise.exercise_name} is unavailable</DialogTitle>
          <DialogDescription>Optional. The client sees it as coach-approved and can use it immediately. Targets stay blank unless you set them.</DialogDescription>
        </DialogHeader>
        <select className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm" value={libraryId} onChange={(e) => setLibraryId(e.target.value)} data-testid="backup-exercise">
          <option value="">Choose…</option>
          {choices.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
        </select>
        <div className="grid grid-cols-3 gap-2">
          <Input className="min-h-11" placeholder="Sets" value={targets.sets} onChange={(e) => setTargets((t) => ({ ...t, sets: e.target.value }))} data-testid="backup-sets" />
          <Input className="min-h-11" placeholder="Reps" value={targets.reps} onChange={(e) => setTargets((t) => ({ ...t, reps: e.target.value }))} data-testid="backup-reps" />
          <Input className="min-h-11" placeholder="Load lb" value={targets.load_value} onChange={(e) => setTargets((t) => ({ ...t, load_value: e.target.value }))} data-testid="backup-load" />
        </div>
        <label className="block space-y-1 text-xs text-muted-foreground">Note shown to the client (optional)
          <Input className="min-h-11" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} data-testid="backup-note" />
        </label>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onClose(false)}>Cancel</Button>
          <Button disabled={!libraryId || busy} onClick={save} data-testid="backup-save">Save backup</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StartWorkout({ participant, onStarted }) {
  const [options, setOptions] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get(`/programs/workout-assignments/client/${participant.client_id}`).then((r) => r.data).catch(() => []),
      api.get(`/programs/program-assignments/client/${participant.client_id}`).then((r) => r.data).catch(() => []),
    ]).then(([workouts, programs]) => {
      if (cancelled) return;
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' });
      const rows = [];
      for (const a of workouts || []) {
        if (a.quick_session_completed) continue;
        if (a.assignment_mode === 'dated' && a.assigned_for !== today) continue;
        rows.push({ key: a.id, label: a.workout?.name || 'Assigned workout', source: { workout_assignment_id: a.id } });
      }
      for (const p of programs || []) {
        for (const day of p.program?.days || []) rows.push({ key: `${p.id}:${day.id}`, label: `${p.program.name} · Day ${day.day_number}${day.workout?.name ? ` · ${day.workout.name}` : ''}`, source: { program_assignment_id: p.id, program_day_id: day.id } });
      }
      setOptions(rows);
    });
    return () => { cancelled = true; };
  }, [participant.client_id]);
  const start = async (source) => {
    setBusy(true);
    try {
      await api.post('/workout-logs/start', { ...source, client_id: participant.client_id });
      onStarted();
    } catch (error) {
      if (error.response?.status === 409 && error.response.data?.active_workout) onStarted();
      else toast.error(errMsg(error, 'Could not start.'));
    } finally {
      setBusy(false);
    }
  };
  if (!options) return <p className="text-sm text-muted-foreground">Loading {participant.name}&apos;s workouts…</p>;
  if (!options.length) return <p className="text-sm text-muted-foreground">No workout assigned for today.</p>;
  return (
    <div className="space-y-2" data-testid="participant-start">
      <p className="text-sm text-muted-foreground">No workout started yet. Start one to log for {participant.name}:</p>
      {options.map((row) => (
        <Button key={row.key} type="button" variant="outline" className="min-h-11 w-full justify-start" disabled={busy} onClick={() => start(row.source)} data-testid="participant-start-option">
          <Play /> {row.label}
        </Button>
      ))}
    </div>
  );
}

function ParticipantPanel({ participant, library, onChanged }) {
  const [log, setLog] = useState(null);
  const [checkedAt, setCheckedAt] = useState(null);
  const [failed, setFailed] = useState(false);
  const [planFor, setPlanFor] = useState(null);
  const [backupFor, setBackupFor] = useState(null);
  const logId = participant.log?.id;
  const load = useCallback(async () => {
    if (!logId) { setLog(null); return; }
    try {
      const { data } = await api.get(`/workout-logs/${logId}`);
      setLog({ ...data, client_name: participant.name });
      setCheckedAt(Date.now());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [logId, participant.name]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(load, GROUP_REFRESH_SECONDS * 1000);
    return () => window.clearInterval(timer);
  }, [load]);
  const changed = () => { load(); onChanged(); };
  if (!participant.log) return <StartWorkout participant={participant} onStarted={onChanged} />;
  if (!log) return <p className="text-sm text-muted-foreground">Loading…</p>;
  return (
    <div className="space-y-4" data-testid={`participant-panel-${participant.client_id}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="font-semibold">{participant.name} · {log.workout_name}</p>
          <p className="text-xs text-muted-foreground" data-testid="participant-freshness">
            {failed ? 'Could not refresh; showing the last copy. ' : ''}{freshnessLabel(checkedAt, Date.now(), { everySeconds: GROUP_REFRESH_SECONDS })}
            {log.status !== 'active' ? ` · ${log.status}` : ''}
          </p>
        </div>
      </div>
      {log.exercises.map((exercise) => (
        <div key={exercise.id} className="space-y-2 rounded-xl border border-border bg-card/60 p-3" data-testid={`participant-exercise-${exercise.exercise_name.replace(/\W+/g, '-')}`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-medium">{exercise.exercise_name}</p>
              <p className="text-xs text-muted-foreground">
                Plan: {[exercise.prescribed_sets && `${exercise.prescribed_sets} sets`, exercise.prescribed_reps && `${exercise.prescribed_reps} reps`, exercise.prescribed_load_value != null && `${exercise.prescribed_load_value} ${exercise.prescribed_load_unit || 'lb'}`].filter(Boolean).join(' × ') || 'as written'}
                {exercise.plan_revision ? ` · changed ${exercise.plan_revision}×` : ''}
              </p>
              <SwapStatus exercise={exercise} log={log} viewer="coach" />
            </div>
            {log.status === 'active' && (
              <div className="flex flex-wrap gap-1">
                <Button type="button" size="sm" variant="ghost" className="min-h-11" onClick={() => setPlanFor(exercise)} data-testid="plan-edit-open"><Pencil /> Edit unfinished</Button>
                {exercise.source_workout_exercise_id && (
                  <Button type="button" size="sm" variant="ghost" className="min-h-11" onClick={() => setBackupFor(exercise)} data-testid="backup-open"><ShieldPlus /> Plan backup{exercise.backups?.length ? ` (${exercise.backups.length})` : ''}</Button>
                )}
              </div>
            )}
          </div>
          {exercise.sets.map((set) => (
            <div key={set.id} className="space-y-1">
              <CoachSetRow log={log} exercise={exercise} set={set} onSaved={changed} />
              {set.status === 'completed' && Number.isInteger(set.completed_plan_revision) && set.completed_plan_revision < (exercise.plan_revision || 0) && (
                <p className="text-xs text-muted-foreground" data-testid="earlier-plan-note">Done to the earlier plan (changed while this was logged).</p>
              )}
              {(log.conflicts || []).filter((conflict) => conflict.workout_log_set_id === set.id).map((conflict) => (
                <div key={conflict.id} className="space-y-1">
                  <SetConflictNotice conflict={conflict} logId={log.id} viewer="coach" />
                  <CoachConflictActions conflict={conflict} logId={log.id} onDone={changed} />
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
      <CoachSwapActions log={log} onDone={changed} />
      {planFor && <PlanEditDialog log={log} exercise={planFor} onClose={(saved) => { setPlanFor(null); if (saved) changed(); }} />}
      {backupFor && <BackupDialog exercise={backupFor} library={library} onClose={(saved) => { setBackupFor(null); if (saved) changed(); }} />}
    </div>
  );
}

function NoticesPanel({ notices, onRead, onSelect }) {
  if (!notices.length) return <p className="text-xs text-muted-foreground" data-testid="notices-empty">No new notices.</p>;
  return (
    <ul className="space-y-2" data-testid="notices">
      {notices.map((notice) => (
        <li key={notice.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border p-2 text-sm" data-testid={`notice-${notice.kind}`}>
          <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onSelect(notice.client_id)}>{notice.summary}</button>
          <Button type="button" size="sm" variant="ghost" className="min-h-11" onClick={() => onRead(notice.id)}>Mark read</Button>
        </li>
      ))}
    </ul>
  );
}

export default function ParticipantConductor({ clients, library, onBack }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [picked, setPicked] = useState([]);
  const [overview, setOverview] = useState(null);
  const [checkedAt, setCheckedAt] = useState(null);
  const [overviewFailed, setOverviewFailed] = useState(false);
  const [notices, setNotices] = useState([]);
  const [selected, setSelected] = useState(null);
  const [, setClock] = useState(0);
  const sessionRef = useRef(null);
  sessionRef.current = session;

  useEffect(() => {
    api.get('/group-sessions/open').then(({ data }) => {
      const open = (data.sessions || []).find((row) => row.mode === 'participants');
      if (open) setSession(open);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const refresh = useCallback(async () => {
    const current = sessionRef.current;
    if (!current) return;
    try {
      const [{ data: over }, { data: note }] = await Promise.all([
        api.get(`/group-sessions/${current.id}/overview`),
        api.get('/coach-notices'),
      ]);
      setOverview(over);
      setNotices(note.notices || []);
      setCheckedAt(Date.now());
      setOverviewFailed(false);
      setSelected((value) => value || over.participants[0]?.client_id || null);
    } catch {
      setOverviewFailed(true);
    }
  }, []);
  useEffect(() => { if (session) refresh(); }, [session, refresh]);
  useEffect(() => {
    const timer = window.setInterval(() => { refresh(); setClock((tick) => tick + 1); }, GROUP_REFRESH_SECONDS * 1000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const start = async () => {
    try {
      const { data } = await api.post('/group-sessions', { id: makeId(), title: title.trim() || undefined, mode: 'participants', participant_ids: picked });
      setSession(data.session);
    } catch (error) {
      toast.error(errMsg(error, 'Could not start the group.'));
    }
  };
  const finish = async () => {
    if (!window.confirm('Finish this group? Each trainee keeps everything logged; unfinished workouts stay open in their own app.')) return;
    try {
      await api.patch(`/group-sessions/${session.id}`, { base_revision: session.revision, status: 'finished' });
      setSession(null);
      setOverview(null);
    } catch (error) {
      toast.error(errMsg(error, 'Not finished. Refresh and try again.'));
    }
  };
  const markRead = async (id) => {
    await api.patch(`/coach-notices/${id}/read`).catch(() => {});
    refresh();
  };

  const participant = useMemo(() => overview?.participants.find((row) => row.client_id === selected) || null, [overview, selected]);

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!session) {
    return (
      <div className="space-y-4" data-testid="participants-setup">
        <p className="text-sm text-muted-foreground">Log for 2 to 6 trainees from one screen, each on their own workout. Trainees can still log on their own phones; you will see who changed what.</p>
        <label className="block space-y-1 text-sm">Group name <span className="text-xs text-muted-foreground">(only you see this)</span>
          <Input className="min-h-11" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} data-testid="participants-title" />
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          {clients.map((client) => (
            <label key={client.id} className={cn('flex min-h-11 items-center gap-3 rounded-lg border px-3 text-sm', picked.includes(client.id) ? 'border-primary bg-primary/10' : 'border-border')}>
              <input type="checkbox" className="h-4 w-4" checked={picked.includes(client.id)} data-testid={`participants-pick-${client.id}`}
                onChange={() => setPicked((rows) => (rows.includes(client.id) ? rows.filter((row) => row !== client.id) : [...rows, client.id]))} />
              {client.name}
            </label>
          ))}
        </div>
        <div className="flex gap-2">
          <Button className="min-h-11" disabled={picked.length < 2 || picked.length > 6} onClick={start} data-testid="participants-start"><Users /> Start group</Button>
          <Button variant="ghost" className="min-h-11" onClick={onBack}>Back</Button>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-4" data-testid="participants-running">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground" data-testid="group-freshness">
          <RefreshCw className="mr-1 inline h-3 w-3" aria-hidden />
          {overviewFailed ? 'Could not refresh; showing the last copy. ' : ''}{freshnessLabel(checkedAt, Date.now(), { everySeconds: GROUP_REFRESH_SECONDS })} · not live
        </p>
        <Button variant="ghost" className="min-h-11" onClick={finish} data-testid="participants-finish">Finish group</Button>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Trainees" data-testid="participant-switcher">
        {(overview?.participants || []).map((row) => {
          const selfLogging = row.log?.last_actor_role === 'client' && row.log.last_write_at && (Date.now() - Date.parse(row.log.last_write_at)) < SELF_LOGGING_WINDOW_MS;
          return (
            <button key={row.client_id} type="button" role="tab" aria-selected={row.client_id === selected} onClick={() => setSelected(row.client_id)}
              className={cn('min-h-11 shrink-0 rounded-lg border px-3 py-2 text-left text-sm', row.client_id === selected ? 'border-primary bg-primary/10' : 'border-border')}
              data-testid={`participant-tab-${row.client_id}`}>
              <span className="block font-medium">{row.name}</span>
              <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                {row.log ? `${row.log.done}/${row.log.total} sets${row.log.status === 'completed' ? ' · done' : ''}` : 'not started'}
                {row.log?.open_conflicts ? <Badge variant="outline" className="border-gold text-gold" data-testid="tab-conflicts"><AlertTriangle className="mr-0.5 h-3 w-3" />{row.log.open_conflicts}</Badge> : null}
                {row.log?.pending_swaps ? <Badge variant="outline" data-testid="tab-pending-swaps">swap?</Badge> : null}
                {row.log?.swaps_to_review ? <Badge variant="outline" data-testid="tab-review-swaps">review</Badge> : null}
                {selfLogging ? <span className="inline-flex items-center gap-0.5" data-testid="tab-self-logging"><Smartphone className="h-3 w-3" />on own phone</span> : null}
              </span>
            </button>
          );
        })}
      </div>
      <details className="rounded-lg border border-border p-2" open={notices.length > 0} data-testid="notices-panel">
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium"><Bell className="h-4 w-4" /> Notices ({notices.length})</summary>
        <NoticesPanel notices={notices} onRead={markRead} onSelect={setSelected} />
      </details>
      {participant && <ParticipantPanel key={participant.client_id} participant={participant} library={library} onChanged={refresh} />}
    </div>
  );
}
