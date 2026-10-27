import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { api, errMsg } from '@/lib/api';
import { CUE_VERDICTS } from '@/lib/cueRetry';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export default function LocalCueRetry({ log, exercise, actor, localDemo = false }) {
  const [context, setContext] = useState(null);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState('pending');
  const mounted = useRef(false);
  const operation = useRef(null);
  const endpoint = `/workout-logs/${log.id}/exercises/${exercise.id}/cue-retry`;
  const coach = ['coach', 'admin'].includes(actor.role);
  const load = useCallback(async () => {
    try {
      const { data } = await api.get(endpoint);
      if (!mounted.current) return;
      setContext(data); setError(null);
      setVerdict(data.incoming[0]?.verdict || 'pending');
      return data;
    } catch (failure) {
      if (mounted.current) { setContext(null); setError(errMsg(failure, 'Could not load this cue.')); }
    }
  }, [endpoint]);
  useEffect(() => { mounted.current = true; load(); return () => { mounted.current = false; }; }, [load, log.status]);
  const outgoing = context?.outgoing.find(row => !row.archived);
  const incoming = context?.incoming[0];
  const save = async (payload) => {
    const fingerprint = JSON.stringify(payload);
    if (operation.current?.fingerprint !== fingerprint) operation.current = { fingerprint, request_id: crypto.randomUUID() };
    setBusy(true); setError(null); setMessage('');
    try {
      await api.post(endpoint, { ...payload, request_id: operation.current.request_id });
      if (!mounted.current) return;
      operation.current = null;
      setEditing(false);
      setMessage(localDemo ? 'Saved in this browser.' : 'Cue saved.');
      await load();
    } catch (failure) {
      if (mounted.current) setError(errMsg(failure, 'Could not save cue. Try again.'));
    } finally { if (mounted.current) setBusy(false); }
  };
  const openEditor = async () => {
    setBusy(true); setMessage('');
    const fresh = await load();
    if (mounted.current) {
      if (fresh) { setText(fresh.outgoing.find(row => !row.archived)?.text || ''); setEditing(true); }
      setBusy(false);
    }
  };
  const path = (logId, tracking = false) => `/${coach ? 'coach' : 'client'}/workouts/${logId}${!coach && tracking ? '/track' : ''}`;
  return (
    <section className="my-3 space-y-2 border-t border-border pt-3 text-sm" aria-label={`Coaching cue for ${exercise.exercise_name}`} data-testid="cue-retry-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="font-medium">Cue → Retry → Recheck</h3>
        {localDemo && <span className="text-xs text-muted-foreground">Local demo · fictional · stored in this browser</span>}
      </div>
      {incoming && <div className="space-y-1 border-l-2 border-primary pl-3" data-testid="incoming-cue">
        <p className="text-xs text-muted-foreground">{incoming.stale_retry ? 'Earlier-plan cue' : 'Try this cue'} · {incoming.author_name}</p>
        <p className="whitespace-pre-wrap break-words font-medium">{incoming.text}</p>
        <p className="text-xs text-muted-foreground">Coach recheck: {CUE_VERDICTS[incoming.verdict]}</p>
        <Link className="inline-flex min-h-11 items-center text-primary underline" to={path(incoming.source_log_id)}>View original attempt</Link>
        {incoming.stale_retry && <p className="text-xs text-muted-foreground">The retry plan changed. This cue belongs to the earlier attempt version; keep it pending.</p>}
        {coach && context.can_recheck && !incoming.stale_retry && <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); save({ action: 'verdict', cue_id: incoming.id, revision: incoming.revision, verdict }); }}>
          <div className="min-w-0 space-y-1">
            <Label htmlFor={`verdict-${exercise.id}`}>Did this cue help?</Label>
            <select id={`verdict-${exercise.id}`} className="block min-h-11 max-w-full rounded-md border border-input bg-background px-3 text-sm" value={verdict} disabled={busy} onChange={event => setVerdict(event.target.value)}>
              {Object.entries(CUE_VERDICTS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <Button type="submit" size="sm" className="min-h-11" disabled={busy}>Save recheck</Button>
        </form>}
        {coach && !context.can_recheck && <p className="text-xs text-muted-foreground">Recheck after this workout is completed with a performed set.</p>}
      </div>}
      {outgoing && <div className="space-y-1" data-testid="outgoing-cue">
        <p className="text-xs text-muted-foreground">Cue for the next attempt · {outgoing.author_name}</p>
        <p className="whitespace-pre-wrap break-words">{outgoing.text}</p>
        <p className="text-xs text-muted-foreground">{outgoing.retry_exercise_id
          ? `Linked to retry · ${CUE_VERDICTS[outgoing.verdict]}${outgoing.retry_status === 'abandoned' ? ' · Retry abandoned' : ''}`
          : outgoing.stale ? (context.source_version
            ? 'Program or assignment changed. This cue will not attach until the coach reviews and saves it again.'
            : 'Program or assignment changed. The original exercise is no longer available. Cancel this cue and use a completed current attempt.')
            : 'Waiting for the next newly started attempt of this exercise in the same assigned day.'}</p>
        {outgoing.retry_log_id && <Link className="inline-flex min-h-11 items-center text-primary underline" to={path(outgoing.retry_log_id, outgoing.retry_status === 'active')}>View linked retry</Link>}
        {coach && !outgoing.retry_exercise_id && !editing && <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" className="min-h-11" disabled={busy || !context.can_create} onClick={openEditor}>Edit cue</Button>
          <Button type="button" variant="ghost" size="sm" className="min-h-11" disabled={busy} onClick={() => save({ action: 'cancel', cue_id: outgoing.id, revision: outgoing.revision })}>Cancel cue</Button>
        </div>}
      </div>}
      {context?.outgoing.filter(row => row.archived).map(row => <p key={row.id} className="text-xs text-muted-foreground" data-testid="cancelled-cue">Cancelled cue: {row.text}</p>)}
      {coach && !outgoing && context?.can_create && !editing && <Button type="button" variant="outline" size="sm" className="min-h-11" disabled={busy} onClick={openEditor}>Add cue for next attempt</Button>}
      {editing && <form className="space-y-2" onSubmit={event => { event.preventDefault(); save({ action: outgoing ? 'edit' : 'create', ...(outgoing ? { cue_id: outgoing.id, revision: outgoing.revision } : {}), text, source_version: context.source_version }); }}>
        <Label htmlFor={`cue-${exercise.id}`}>One actionable cue</Label>
        <Textarea id={`cue-${exercise.id}`} rows={2} maxLength={500} value={text} disabled={busy} onChange={event => setText(event.target.value)} aria-describedby={`cue-help-${exercise.id}`} />
        <p id={`cue-help-${exercise.id}`} className="text-xs text-muted-foreground">Attached to this attempt, then frozen on the next retry. Separate from exercise notes. Up to 500 characters.</p>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" className="min-h-11" disabled={busy || !context?.can_create || !text.trim()}>Save cue</Button>
          <Button type="button" size="sm" variant="ghost" className="min-h-11" disabled={busy} onClick={() => { setEditing(false); setText(''); setError(null); operation.current = null; }}>Discard draft</Button>
        </div>
      </form>}
      {context && !incoming && !outgoing && !coach && <p className="text-xs text-muted-foreground">No coaching cue attached to this attempt.</p>}
      {error && <div role="alert" className="space-y-1 text-destructive"><p>{error}</p><Button type="button" size="sm" variant="outline" className="min-h-11" disabled={busy} onClick={load}>Reload cue</Button></div>}
      <p role="status" className="text-xs text-muted-foreground">{busy ? 'Saving…' : message}</p>
    </section>
  );
}
