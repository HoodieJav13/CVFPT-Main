import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { api, errMsg } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { diffProgramRevisions } from '@/lib/programHistory';

const label = (key) => ({ default_load_value:'Load', default_load_unit:'Load unit', target_rpe:'Target RPE', frequency_days:'Days per week', day_number:'Day number', superset_group:'Linked group', recorded_at:'Changed at' }[key] || key.replaceAll('_',' '));
function date(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Date unavailable';
  return new Date(value).toLocaleString(undefined, { dateStyle:'medium', timeStyle:'short' });
}
function Value({ value }) {
  if (value == null || value === '') return <span className="text-muted-foreground">Not set</span>;
  if (Array.isArray(value)) return <ol className="space-y-1">{value.map((v,i)=><li key={i}><Value value={v} /></li>)}</ol>;
  if (typeof value === 'object') return <dl className="space-y-1">{Object.entries(value).filter(([k,v])=>k!=='id' && v!=null && v!=='').map(([k,v])=><div key={k}><dt className="text-xs capitalize text-muted-foreground">{label(k)}</dt><dd><Value value={v} /></dd></div>)}</dl>;
  return String(value);
}
function HistoryContent({ data }) {
  const revisions=data.revisions || [];
  const [selected,setSelected]=useState(revisions.length-1);
  const revision=revisions[selected];
  const previous=revisions[selected-1];
  const changes=revision ? diffProgramRevisions(previous?.snapshot, revision.snapshot) : null;
  return <div className="space-y-4">
    <div className="space-y-1 text-sm text-muted-foreground">
      <p>{data.capture==='preview_memory' ? 'Preview only · fictional revisions. Saved changes reset on reload.' : data.capture === 'durable' ? 'Forward history · recorded with successful program and workout edits. Earlier history is unavailable.' : 'Stored revisions are unavailable. Earlier changes cannot be recovered. New changes are not being captured here.'}</p>
      <details><summary className="min-h-11 cursor-pointer py-3 text-xs">Coverage and record safety</summary><p>Program details, days and workout prescriptions only. Assignment load overrides and library edits are outside this history.</p><p>Read-only. Completed workout records stay unchanged.</p></details>
      <p className="text-xs">Source: {data.source}</p>{data.has_earlier && <p className="text-xs">Showing the latest 200 snapshots. Earlier stored revisions are not shown.</p>}
    </div>
    {!revisions.length ? <p className="rounded-xl border border-border p-4 text-sm" data-testid="program-history-unavailable">History unavailable for this program.</p> : <>
      <label className="block space-y-1 text-sm"><span>Revision</span><select className="min-h-11 w-full rounded-lg border border-input bg-background px-3 text-foreground" value={selected} onChange={e=>setSelected(Number(e.target.value))} data-testid="program-history-revision">
        {revisions.map((r,i)=><option key={r.id} value={i}>Revision {i+1} · {date(r.recorded_at)}</option>)}
      </select></label>
      <div className="rounded-xl border border-border p-3 text-sm space-y-1">
        <p className="font-medium">{revision.author?.name || 'Author unavailable'} · {date(revision.recorded_at)}</p>
        <p className="text-xs text-muted-foreground">{revision.source}</p>
        <p className="text-xs text-muted-foreground">{previous ? `Comparing revision ${selected} → ${selected+1}` : 'First available snapshot. Earlier history unavailable.'}</p>
      </div>
      {changes===null ? <p className="text-sm text-muted-foreground">No earlier revision to compare.</p> : !changes.length ? <p className="text-sm">No prescription changes between these snapshots.</p> : <ol className="space-y-3" data-testid="program-history-changes">{changes.map((change,i)=><li key={i} className="rounded-xl border border-border p-3 text-sm space-y-2 break-words [overflow-wrap:anywhere]">
        <p className="font-medium capitalize">{change.kind} · {label(change.field)}</p><p className="text-xs text-muted-foreground">{change.path}</p>
        <div className="grid gap-3 sm:grid-cols-2"><div><p className="text-xs font-semibold text-muted-foreground mb-1">Before</p><Value value={change.before} /></div><div><p className="text-xs font-semibold text-muted-foreground mb-1">After</p><Value value={change.after} /></div></div>
      </li>)}</ol>}
    </>}
  </div>;
}
export function ProgramHistoryButton({ programId, programName, clientName }) {
  const { user, sessionEpoch } = useAuth();
  const scope = `${programId}:${user?.role}:${user?.profile?.id}:${sessionEpoch}`;
  const [open,setOpen]=useState(false);
  const [state,setState]=useState({});
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{
    if(!open) return;
    let cancelled=false; setState({ scope });
    api.get(`/programs/${encodeURIComponent(programId)}/history`).then(({data})=>{if(!cancelled)setState({ scope, data });}).catch(error=>{if(!cancelled)setState({ scope, error:errMsg(error,'Could not load program history') });});
    return ()=>{cancelled=true;};
  },[open,programId,attempt,scope]);
  return <>
    <Button type="button" size="sm" variant="ghost" className="min-h-11 rounded-lg text-muted-foreground" onClick={()=>setOpen(true)} aria-label={`Change history for ${programName}`} data-testid="program-history-open">Change history</Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto min-w-0 [&>button]:h-11 [&>button]:w-11" data-testid="program-history-dialog">
      <DialogHeader><DialogTitle>Program change history</DialogTitle><DialogDescription className="break-words pr-8">{programName}{clientName ? ` · ${clientName}` : ' · Shared template'}</DialogDescription></DialogHeader>
      {state.scope === scope && state.error ? <div role="alert" className="space-y-3 text-sm"><p>{state.error}</p><Button variant="secondary" className="min-h-11" onClick={()=>setAttempt(n=>n+1)}>Try again</Button></div> : state.scope !== scope || !state.data ? <p role="status" className="text-sm">Loading program history…</p> : <HistoryContent key={`${programId}:${attempt}`} data={state.data} />}
    </DialogContent></Dialog>
  </>;
}
