import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Lock, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { api, errMsg } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useUnsavedChanges } from '@/context/UnsavedChangesContext';

const MAX = 4000;
const UNSAVED_NOTE = 'You have an unsaved coach note. Discard it and continue?';

// Private notes on a client for the coaches authorized for that client (its
// coach and admins). The server enforces who may read or write them; this
// section only renders what the coach API returns. Clients never load it.
export default function CoachNotes({ client, coachId }) {
  const [notes, setNotes] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');
  // A save whose reply was lost (or a 5xx) may already be stored: the list is
  // reloaded before another save is allowed. phase: reloading | reloaded | reload-failed.
  const [unconfirmed, setUnconfirmed] = useState(null);
  const loadSeq = useRef(0);
  const readOnly = Boolean(client.archived);
  // Typed but unsaved text is guarded like other unsaved forms (tab switch, navigation, unload).
  useUnsavedChanges(!readOnly && draft.trim() !== '', () => setDraft(''), UNSAVED_NOTE);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoadError('');
    try {
      const { data } = await api.get(`/clients/${client.id}/coach-notes${client.archived ? '?include_archived=true' : ''}`);
      if (seq === loadSeq.current) setNotes(data.notes || []);
    } catch (e) {
      if (seq === loadSeq.current) setLoadError(errMsg(e, 'Could not load coach notes'));
    }
  }, [client.id, client.archived]);

  useEffect(() => { setNotes(null); load(); }, [load]);

  const reloadAfterUnconfirmed = async (content, knownIds) => {
    setUnconfirmed({ phase: 'reloading' });
    try {
      const { data } = await api.get(`/clients/${client.id}/coach-notes${client.archived ? '?include_archived=true' : ''}`);
      const list = data.notes || [];
      setNotes(list);
      // A new note of this coach's with the same text is a likely match, not a receipt.
      const match = list.some((note) => !knownIds.has(note.id) && note.author_coach_id === coachId && note.content === content);
      setUnconfirmed({ phase: 'reloaded', match, content, knownIds });
    } catch (e) {
      setUnconfirmed({ phase: 'reload-failed', message: errMsg(e, 'Could not reload the notes'), content, knownIds });
    }
  };

  const add = async (event) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content || adding || unconfirmed?.phase === 'reloading' || unconfirmed?.phase === 'reload-failed') return;
    const knownIds = new Set((notes || []).map((note) => note.id));
    setAdding(true);
    setAddError('');
    setUnconfirmed(null);
    try {
      const { data } = await api.post(`/clients/${client.id}/coach-notes`, { content });
      setNotes((current) => [data, ...(current || [])]);
      setDraft('');
      toast.success('Coach note saved');
    } catch (e) {
      const status = e?.response?.status;
      if (status >= 400 && status < 500) {
        // The notes route refuses (validation, access) before it writes.
        setAddError(`Not saved: ${errMsg(e, 'the server refused the note')}. Your text is still here.`);
      } else {
        await reloadAfterUnconfirmed(content, knownIds);
      }
    } finally {
      setAdding(false);
    }
  };
  const savePaused = unconfirmed?.phase === 'reloading' || unconfirmed?.phase === 'reload-failed';

  const replace = (note) => setNotes((current) => (current || []).map((row) => (row.id === note.id ? note : row)));

  return (
    <Card data-testid="coach-notes">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Lock className="h-4 w-4 text-primary" aria-hidden /> Coach Notes
          </CardTitle>
          <Badge variant="outline" className="border-primary/25 bg-primary/10 text-primary" data-testid="coach-notes-private-badge">Private · coaches only</Badge>
        </div>
        <p className="text-xs text-muted-foreground" data-testid="coach-notes-visibility">
          Visible only to this client&apos;s coach and admins. Never shown to the client.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {readOnly ? (
          <p className="rounded-xl border border-border bg-card/50 p-3 text-xs text-muted-foreground" data-testid="coach-notes-read-only">Archived client: notes are read-only. Restore the client to add or edit notes.</p>
        ) : (
          <form onSubmit={add} className="space-y-2" data-testid="coach-notes-form">
            <Label htmlFor="coach-note-new" className="sr-only">New coach note</Label>
            <Textarea id="coach-note-new" rows={3} maxLength={MAX} value={draft} disabled={adding}
              onChange={(e) => { setDraft(e.target.value); setAddError(''); }}
              placeholder="Add a private note for coaches…" data-testid="coach-note-input" />
            {addError && <p role="alert" className="text-sm text-destructive" data-testid="coach-note-add-error">{addError}</p>}
            {unconfirmed && (
              <div role="status" className="rounded-xl border border-gold/30 bg-gold/10 p-3 text-sm" data-testid="coach-note-add-unconfirmed" data-phase={unconfirmed.phase}>
                <p className="font-medium">Not confirmed: the server did not give a definite answer (no reply or a server error), so this note may already be saved.</p>
                {unconfirmed.phase === 'reloading' && <p className="mt-1 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Reloading the notes before you can save again…</p>}
                {unconfirmed.phase === 'reloaded' && (
                  <p className="mt-1">
                    {unconfirmed.match ? 'The reloaded list now shows a note of yours with this exact text, so it was probably saved. ' : 'The list below was reloaded. '}
                    Check it before saving again. Your text is still here.
                  </p>
                )}
                {unconfirmed.phase === 'reload-failed' && (
                  <div className="mt-1 space-y-2">
                    <p>The notes could not be reloaded ({unconfirmed.message}). Saving again is paused until they reload, so the note is not added twice. Your text is still here.</p>
                    <Button type="button" size="sm" variant="outline" className="rounded-lg" onClick={() => reloadAfterUnconfirmed(unconfirmed.content, unconfirmed.knownIds)} data-testid="coach-note-reload-notes">Reload notes</Button>
                  </div>
                )}
              </div>
            )}
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">{draft.trim().length.toLocaleString('en-US')} / {MAX.toLocaleString('en-US')}</span>
              <Button type="submit" size="sm" className="min-h-11 rounded-xl" disabled={adding || savePaused || !draft.trim()} data-testid="coach-note-save-button">
                {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save note'}
              </Button>
            </div>
          </form>
        )}

        {loadError ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm" data-testid="coach-notes-load-error">
            <span>{loadError}</span>
            <Button type="button" size="sm" variant="outline" className="rounded-lg" onClick={load} data-testid="coach-notes-retry">Retry</Button>
          </div>
        ) : notes === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="coach-notes-loading"><Loader2 className="h-4 w-4 animate-spin" /> Loading notes…</p>
        ) : notes.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="coach-notes-empty">No coach notes yet.</p>
        ) : (
          <ul className="space-y-3" data-testid="coach-notes-list">
            {notes.map((note) => (
              <CoachNoteItem key={note.id} note={note} clientId={client.id} canEdit={!readOnly && note.author_coach_id === coachId} onSaved={replace} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function CoachNoteItem({ note, clientId, canEdit, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.content);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [latest, setLatest] = useState(null);
  const edited = note.updated_at && note.updated_at !== note.created_at;
  useUnsavedChanges(editing && text.trim() !== note.content, () => setEditing(false), UNSAVED_NOTE);

  const start = () => { setText(note.content); setError(''); setLatest(null); setEditing(true); };

  const save = async () => {
    const content = text.trim();
    if (!content || saving) return;
    setSaving(true);
    setError('');
    try {
      const { data } = await api.put(`/clients/${clientId}/coach-notes/${note.id}`, { content, expected_updated_at: (latest || note).updated_at });
      onSaved(data);
      setEditing(false);
      setLatest(null);
      toast.success('Coach note updated');
    } catch (e) {
      // A newer version replaces the one this edit was based on; the typed text stays.
      if (e.response?.status === 409 && e.response.data?.note) setLatest(e.response.data.note);
      setError(`Not saved: ${errMsg(e, 'the server did not confirm the edit')}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <li className="rounded-xl border border-border bg-card/50 p-3" data-testid="coach-note">
      {editing ? (
        <div className="space-y-2">
          <Label htmlFor={`coach-note-edit-${note.id}`} className="sr-only">Edit coach note</Label>
          <Textarea id={`coach-note-edit-${note.id}`} rows={3} maxLength={MAX} value={text} disabled={saving}
            onChange={(e) => { setText(e.target.value); setError(''); }} data-testid="coach-note-edit-input" />
          {latest && (
            <div className="rounded-lg border border-gold/30 bg-gold/10 p-2 text-xs" data-testid="coach-note-latest">
              <p className="font-medium">Latest saved version ({fmtDateTime(latest.updated_at)}):</p>
              <p className="mt-1 whitespace-pre-wrap">{latest.content}</p>
            </div>
          )}
          {error && <p role="alert" className="text-sm text-destructive" data-testid="coach-note-edit-error">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="outline" className="min-h-11 rounded-xl" disabled={saving} onClick={() => setEditing(false)}>Cancel</Button>
            <Button type="button" size="sm" className="min-h-11 rounded-xl" disabled={saving || !text.trim()} onClick={save} data-testid="coach-note-update-button">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save changes'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 whitespace-pre-wrap break-words text-sm" data-testid="coach-note-content">{note.content}</p>
          {canEdit && (
            <Button type="button" size="sm" variant="ghost" className="min-h-11 shrink-0 rounded-lg" onClick={start} aria-label="Edit note" data-testid="coach-note-edit-button">
              <Pencil className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}
      <p className="mt-2 text-xs text-muted-foreground" data-testid="coach-note-meta">
        {note.author_name_snapshot} · Added {fmtDateTime(note.created_at)}{edited ? ` · Edited ${fmtDateTime(note.updated_at)}` : ''}
      </p>
    </li>
  );
}
