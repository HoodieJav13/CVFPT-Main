import { useState } from 'react';
import { Link } from 'react-router';
import { ExternalLink, HeartPulse, Loader2, MessageSquareText, Smartphone } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { HEAT_LABELS } from '@/lib/cockpit/config';
import { NOTE_MAX_LENGTH } from '@/lib/cockpit/notes';
import { classifyHeat, idleMs, minutesText, noteTargetFor } from '@/lib/cockpit/model';
import { ATTN, HEAT_STYLES, Kbd } from './CockpitBoard';

// The selected client's context and the note composer. onAddNote and
// onResolveNote may be async; a failure keeps the typed text and says so.
export default function ClientPanel({
  row, serverNowMs, log, target: targetOverride, notes, noteKind, onNoteKind, noteRef, onAddNote, onResolveNote, phoneHref, workoutHref, children, persistenceLabel,
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [resolveError, setResolveError] = useState('');
  if (!row) {
    return <section className="rounded-xl border border-border bg-card p-4 text-muted-foreground" data-testid="cockpit-client-panel">Select someone on the roster or in the queue.</section>;
  }
  const heat = classifyHeat(row, serverNowMs);
  const idle = idleMs(row, serverNowMs);
  // Live: the session's own current-set read supplies the target; replay
  // derives it from the fictional log.
  const target = targetOverride !== undefined ? targetOverride : noteTargetFor(log);
  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const result = await onAddNote({ kind: noteKind, text, setRef: target });
      if (result?.error) { setError(result.error); return; }
      setError('');
      setText('');
    } finally {
      setSaving(false);
    }
  };
  const resolve = async (id) => {
    const result = await onResolveNote(id);
    setResolveError(result?.error || '');
  };
  const open = notes.filter((note) => !note.resolved);
  return (
    <section aria-labelledby="cockpit-client-title" className="space-y-3 rounded-xl border border-border bg-card p-4" data-testid="cockpit-client-panel">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="cockpit-client-title" className="truncate font-display text-3xl font-semibold leading-tight">{row.name}</h2>
          <p className="text-sm text-muted-foreground">
            {row.log ? `${row.log.workoutName} · ${row.log.done}/${row.log.total} sets` : 'No workout started today'}
            {idle != null ? ` · last set ${minutesText(idle)} ago` : ''}
          </p>
        </div>
        <span className={cn('shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold', HEAT_STYLES[heat].chip)}>{HEAT_LABELS[heat]}</span>
      </div>

      {phoneHref || workoutHref ? (
        <div className="flex flex-wrap gap-2">
          {phoneHref ? (
            <Button asChild variant="outline" size="sm"><Link to={phoneHref} target="_blank" rel="noreferrer" data-testid="cockpit-phone-link"><Smartphone aria-hidden /> {row.name.split(' ')[0]}’s phone view <ExternalLink aria-hidden /></Link></Button>
          ) : null}
          {workoutHref ? <Button asChild variant="outline" size="sm"><Link to={workoutHref}>Open workout</Link></Button> : null}
        </div>
      ) : null}

      <div className="space-y-2 rounded-lg border border-border bg-background/40 p-3" data-testid="cockpit-note-composer">
        <p className="font-semibold">Note on {row.name.split(' ')[0]}’s next set</p>
        <div role="group" aria-label="Note type" className="flex flex-wrap gap-2">
          <button type="button" aria-pressed={noteKind === 'cue'} onClick={() => onNoteKind('cue')} className={cn('inline-flex min-h-10 items-center gap-1.5 rounded-md px-3 text-sm font-medium', noteKind === 'cue' ? 'bg-primary text-primary-foreground' : 'bg-muted')}>
            <MessageSquareText className="h-4 w-4" aria-hidden />Cue <Kbd className="ml-1">N</Kbd>
          </button>
          <button type="button" aria-pressed={noteKind === 'pain'} onClick={() => onNoteKind('pain')} className={cn('inline-flex min-h-10 items-center gap-1.5 rounded-md px-3 text-sm font-medium', noteKind === 'pain' ? ATTN.solid : 'bg-muted')}>
            <HeartPulse className="h-4 w-4" aria-hidden />Pain flag <Kbd className="ml-1">P</Kbd>
          </button>
        </div>
        <label htmlFor="cockpit-note-text" className="sr-only">Note text</label>
        <Textarea
          id="cockpit-note-text"
          ref={noteRef}
          value={text}
          maxLength={NOTE_MAX_LENGTH}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); save(); } }}
          placeholder={noteKind === 'pain' ? 'e.g. Left knee sore on the descent' : 'e.g. Brace before you unrack'}
          rows={2}
          className="w-full text-base"
          data-testid="cockpit-note-input"
        />
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{target ? `Pins to ${target.label}` : 'Pins to their next pending set'} · Enter saves · Esc leaves</span>
          <Button type="button" size="sm" onClick={save} disabled={saving} data-testid="cockpit-note-save">{saving ? <Loader2 className="animate-spin" aria-hidden /> : null}{saving ? 'Saving…' : 'Save note'}</Button>
        </div>
        {error ? <p role="alert" className="text-sm text-destructive" data-testid="cockpit-note-error">{error}</p> : null}
        <p className="text-xs text-muted-foreground" data-testid="cockpit-note-persistence">{persistenceLabel}</p>
      </div>

      {open.length ? (
        <ul className="space-y-1.5" data-testid="cockpit-client-notes">
          {open.map((note) => (
            <li key={note.id} className={cn('flex items-start justify-between gap-2 rounded-lg border-l-4 px-3 py-2 text-sm', ATTN.border, ATTN.softBg)}>
              <span>
                <strong>{note.kind === 'pain' ? 'Pain flag' : 'Cue'}:</strong> {note.text}
                {note.setRef?.label ? <span className="block text-xs text-muted-foreground">{note.setRef.label}</span> : null}
                {note.status === 'sending' ? <span className="block text-xs text-muted-foreground">Sending…</span> : null}
              </span>
              {note.status ? null : <button type="button" onClick={() => resolve(note.id)} className="shrink-0 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">Resolve</button>}
            </li>
          ))}
        </ul>
      ) : null}
      {resolveError ? <p role="alert" className="text-sm text-destructive" data-testid="cockpit-resolve-error">{resolveError}</p> : null}

      {children}
    </section>
  );
}
