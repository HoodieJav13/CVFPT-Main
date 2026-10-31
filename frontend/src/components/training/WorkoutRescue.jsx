import { isPreviewMode } from '@/lib/previewFlag';
import { useEffect, useRef, useState } from 'react';
import { api, errMsg } from '@/lib/api';
import { rescueMatches, rescueDiff, rescueVersion, validateRescueBranch, RESCUE_EQUIPMENT } from '@/lib/workoutRescue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';


const equipmentLabel = (item) => item === 'cable' ? 'Cable station' : 'Dumbbells';
const exerciseName = (row) => row.custom_name || row.library_exercise?.name || 'Exercise';
export default function WorkoutRescue({ role, programId, dayId, assignmentId, programName, onStart, disabled = false }) {
  const coach = role === 'coach' || role === 'admin';
  const path = `/programs/${programId}/days/${dayId}/rescue`;
  const pendingStart = useRef(null);
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState(null);
  const [editId, setEditId] = useState(null);
  const [choiceId, setChoiceId] = useState(null);
  const [minutes, setMinutes] = useState(25);
  const [equipment, setEquipment] = useState([...RESCUE_EQUIPMENT]);
  const [reason, setReason] = useState('schedule');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const load = async () => {
    setBusy(true); setError(''); setChoiceId(null); setNotice('');
    try {
      const { data: response } = await api.get(path, { params: assignmentId ? { assignment_id: assignmentId } : undefined });
      if (!alive.current) return;
      setData(response); setDraft(structuredClone(response.plan)); setEditId(response.plan.branches[0]?.id || null);
    } catch (failure) { if (alive.current) setError(errMsg(failure)); }
    finally { if (alive.current) setBusy(false); }
  };
  const launch = () => { setOpen(true); setData(null); setDraft(null); setReason('schedule'); setMinutes(25); setEquipment([...RESCUE_EQUIPMENT]); load(); };
  const branch = draft?.branches.find((row) => row.id === editId);
  const update = (fields) => setDraft((current) => ({ ...current, branches: current.branches.map((row) => row.id === editId ? { ...row, ...fields } : row) }));
  const context = { minutes, equipment };
  const matches = data && !data.stale ? data.plan.branches.filter((row) => rescueMatches(row, context)) : [];
  const chosen = matches.find((row) => row.id === choiceId);
  const save = async () => {
    if (!data || !draft || busy) return;
    const problem = draft.branches.map((row) => validateRescueBranch(row, data.original)).find(Boolean);
    if (problem) { setError(problem); return; }
    setBusy(true); setError('');
    try {
      const { data: response } = await api.put(path, draft);
      if (!alive.current) return;
      setData(response); setDraft(structuredClone(response.plan)); setNotice(isPreviewMode ? 'Demo options saved for this preview session. Switch to Client to try them. Reload resets all demonstration data.' : 'Options saved. Your client can review these choices before starting a new workout.');
    } catch (failure) { if (alive.current) setError(errMsg(failure)); }
    finally { if (alive.current) setBusy(false); }
  };
  const choose = async () => {
    if (!chosen || busy || disabled) return;
    setBusy(true); setError('');
    try {
      // No source prescriptions leave the client: the fixture adapter resolves the
      // authored branch again, checks freshness and snapshots into the existing tracker.
      const selection = { branch_id: chosen.id, version: data.plan.version, revision: data.plan.revision, selection_version: data.selection_version, ...context };
      const key = JSON.stringify(selection);
      if (pendingStart.current?.key !== key) pendingStart.current = { key, request_id: crypto.randomUUID() };
      await onStart({ ...selection, request_id: pendingStart.current.request_id });
      if (alive.current) setOpen(false);
    } catch (failure) { if (alive.current) setError(errMsg(failure, 'Could not start. Review the current options and try again.')); }
    finally { if (alive.current) setBusy(false); }
  };
  return <div className="mt-3 rounded-lg border border-dashed border-primary/40 p-3" data-testid="rescue-entry">
    <Badge variant="outline">{isPreviewMode ? 'Demonstration data · Workout Rescue' : 'Workout Rescue'}</Badge>
    <p className="my-2 text-sm text-muted-foreground">{coach ? 'Define complete time and equipment options for this program’s first day.' : 'Short on time or equipment? Review a planned option for today.'}</p>
    <Button variant="outline" size="touch" disabled={disabled} onClick={launch}>{coach ? (isPreviewMode ? 'Define demo fallbacks' : 'Define fallbacks') : (isPreviewMode ? 'Find a demo option' : 'Find an option')}</Button>
    {disabled && !coach && <p className="mt-2 text-xs text-muted-foreground">Finish or abandon the active workout before choosing another option.</p>}
    <Dialog open={open} onOpenChange={(next) => { if (!busy) setOpen(next); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" data-testid="rescue-dialog">
        <DialogHeader><DialogTitle>{coach ? 'Define Workout Rescue' : 'Make today’s workout fit'}</DialogTitle>
          <DialogDescription>{isPreviewMode ? 'Demonstration only · Fictional coach-authored choices for time and equipment. Original estimate: 50 minutes. Reload resets this preview.' : `${programName || data?.original.program_name || 'Your program'} · Coach-authored choices for time and equipment. Durations are estimates. Existing completed workouts stay unchanged.`}</DialogDescription></DialogHeader>
        {error && <p role="alert" className="rounded-md border border-destructive p-3 text-sm">{error}</p>}
        {notice && <p role="status" className="rounded-md border border-primary p-3 text-sm">{notice}</p>}
        {!data && <Button variant="outline" onClick={load} disabled={busy}>{busy ? 'Loading…' : 'Retry loading options'}</Button>}
        {data && <div className="space-y-4 text-sm">
          <p><strong>Original intent:</strong> {data.original.workout.goal}. All retained exercises keep their original reps, load, rest and cues.</p>
          {data.stale && <div className="space-y-2 rounded-md border border-border p-3" role="status"><p>The original program changed. Previous fallbacks are unavailable until your coach reviews them.</p>
            {coach && <Button variant="outline" className="h-auto min-h-11 whitespace-normal" onClick={() => { setDraft({ version: data.current_version || rescueVersion(data.original), revision: data.plan.revision, branches: [] }); setEditId(null); setNotice('Start fresh against the current original. Add and save reviewed options.'); }}>Start fresh from current original</Button>}
          </div>}
          {coach ? <>
            <div className="flex flex-wrap gap-2">{draft.branches.map((row) => <Button key={row.id} variant={editId === row.id ? 'default' : 'outline'} className="h-auto min-h-11 whitespace-normal" onClick={() => setEditId(row.id)} aria-pressed={editId === row.id}>{row.name || 'Unnamed option'}</Button>)}
              <Button variant="outline" disabled={draft.branches.length >= 6} onClick={() => {
                const id = `rescue_${crypto.randomUUID()}`;
                setDraft((current) => ({ ...current, branches: [...current.branches, { id, name: 'New option', minutes: 25, equipment: [...RESCUE_EQUIPMENT], enabled: true, intent: '', items: data.original.workout.exercises.map((row) => ({ source_id: row.id, sets: Number(row.sets) })) }] })); setEditId(id);
              }}>Add option</Button>
            </div>
            {branch && <div className="space-y-3 rounded-lg border border-border p-3" data-testid="rescue-editor">
              <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={branch.enabled} onChange={(event) => update({ enabled: event.target.checked })} /> Offer this option to the client</label>
              <Label className="block">Option name<Input maxLength={80} value={branch.name} onChange={(event) => update({ name: event.target.value })} /></Label>
              <Label className="block">Estimated minutes<Input type="number" min="1" max="50" value={branch.minutes} onChange={(event) => update({ minutes: Number(event.target.value) })} /></Label>
              <Equipment values={branch.equipment} onChange={(values) => update({ equipment: values })} legend="Equipment required for this complete option" />
              <Label className="block">Intent kept and tradeoff<Textarea maxLength={400} value={branch.intent} onChange={(event) => update({ intent: event.target.value })} /></Label>
              <p>Keep original targets or reduce sets. Choose 0 to drop an exercise. Single-exercise backups remain in the existing tracker swap flow.</p>
              {data.original.workout.exercises.map((row) => <Label key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border p-2"><span>{exerciseName(row)} · originally {row.sets} sets × {row.reps}</span>
                <Input className="min-h-11 w-20" aria-label={`Sets for ${exerciseName(row)}`} type="number" min="0" max={row.sets} value={branch.items.find((item) => item.source_id === row.id)?.sets ?? 0} onChange={(event) => {
                  const sets = Number(event.target.value);
                  update({ items: [...branch.items.filter((item) => item.source_id !== row.id), ...(sets ? [{ source_id: row.id, sets }] : [])] });
                }} /></Label>)}
              <Changes original={data.original} branch={branch} />
            </div>}
            {!draft.branches.length && <p>No fallback options. The client keeps the original or contacts their coach.</p>}
          </> : <>
            <div className="flex flex-wrap gap-2"><Button variant={reason === 'schedule' ? 'default' : 'outline'} onClick={() => { setReason('schedule'); setChoiceId(null); }}>Time / equipment</Button><Button variant={reason === 'pain' ? 'default' : 'outline'} onClick={() => { setReason('pain'); setChoiceId(null); }}>Pain or injury</Button></div>
            {reason === 'pain' ? <p role="status">Rescue only covers time and equipment. Contact your coach about pain or injury; no automatic option is offered.</p> : <>
              <Label className="block">Time available (minutes)<Input type="number" min="1" max="120" value={minutes} onChange={(event) => { setMinutes(Number(event.target.value)); setChoiceId(null); }} /></Label>
              <Equipment values={equipment} onChange={(values) => { setEquipment(values); setChoiceId(null); }} legend="Equipment available today" />
              {matches.length ? <div className="space-y-2">{matches.map((row) => <button key={row.id} className={`min-h-11 w-full rounded-lg border p-3 text-left ${choiceId === row.id ? 'border-primary bg-primary/10' : 'border-border'}`} onClick={() => setChoiceId(row.id)} aria-pressed={choiceId === row.id}>
                <strong className="block">{row.name} · {row.minutes} minutes</strong><span>{row.intent}</span><span className="mt-1 block text-xs text-muted-foreground">Needs: {row.equipment.map(equipmentLabel).join(', ') || 'No equipment'}</span>
              </button>)}</div> : !data.stale && <p role="status">No coach-authored fallback fits this time and equipment combination. Separate options are never combined. Keep the original or ask your coach.</p>}
              {chosen && <Changes original={data.original} branch={chosen} />}
            </>}
          </>}
        </div>}
        <DialogFooter className="flex-wrap gap-2">
          {coach ? <><Button variant="ghost" disabled={busy || !data} onClick={() => { setDraft(structuredClone(data.plan)); setEditId(data.plan.branches[0]?.id); setNotice('Unsaved changes reset.'); setError(''); }}>Reset unsaved changes</Button><Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button><Button disabled={busy || !data || !draft || (data?.stale && draft.version === data.plan.version)} onClick={save}>{isPreviewMode ? 'Save demo options' : 'Save options'}</Button></>
            : <><Button variant="ghost" disabled={busy} onClick={() => { setChoiceId(null); setOpen(false); }}>Keep original / cancel</Button><Button variant="outline" disabled={busy} onClick={load}>Reload options</Button><Button disabled={busy || !chosen || reason !== 'schedule' || disabled} onClick={choose}>{isPreviewMode ? 'Use this demo option' : 'Use this option'}</Button></>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
function Equipment({ values, onChange, legend }) {
  return <fieldset><legend className="font-medium">{legend}</legend><div className="flex flex-wrap gap-3">{RESCUE_EQUIPMENT.map((item) => <label key={item} className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={values.includes(item)} onChange={(event) => onChange(event.target.checked ? [...values, item] : values.filter((value) => value !== item))} />{equipmentLabel(item)}</label>)}</div></fieldset>;
}
function Changes({ original, branch }) {
  return <section className="rounded-lg border border-border p-3" data-testid="rescue-changes"><h3 className="font-semibold">What changes today</h3><ul className="mt-2 space-y-2">{rescueDiff(original, branch).map((row) => <li key={row.id}><strong>{row.name}</strong>: {row.change}</li>)}</ul><p className="mt-2 text-xs text-muted-foreground">Only a new workout uses these choices. Your original program and completed workout history stay unchanged.</p></section>;
}
