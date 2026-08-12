// Coach session notes dialog (private + client-shared), shared by the
// Sessions list and the coach session detail page. Extracted unchanged
// from pages/coach/Sessions.jsx.
import { useCallback, useEffect, useState } from 'react';
import { api, errMsg } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Loader2 } from 'lucide-react';
import { fmtDateTime } from '@/lib/format';
import { toast } from 'sonner';

export function SessionNotesDialog({ session, onClose }) {
  const [notes, setNotes] = useState(null);
  const [content, setContent] = useState('');
  const [shared, setShared] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!session) return;
    try {
      const { data } = await api.get(`/sessions/${session.id}/notes`);
      setNotes(data);
    } catch (e) {
      toast.error(errMsg(e));
    }
  }, [session]);

  useEffect(() => {
    setNotes(null);
    setContent('');
    setShared(false);
    load();
  }, [load]);

  const addNote = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post(`/sessions/${session.id}/notes`, { content, shared_with_client: shared });
      toast.success(shared ? 'Note saved & shared with client' : 'Note saved');
      setContent('');
      setShared(false);
      load();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleShare = async (note) => {
    try {
      await api.put(`/sessions/notes/${note.id}`, { shared_with_client: !note.shared_with_client });
      load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  return (
    <Dialog open={Boolean(session)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md" data-testid="session-notes-dialog">
        <DialogHeader>
          <DialogTitle>Session notes</DialogTitle>
          <DialogDescription>Record private coach notes and client-visible notes for this session.</DialogDescription>
        </DialogHeader>
        {session && (
          <p className="text-xs text-muted-foreground -mt-2">
            {session.client?.name} - {fmtDateTime(session.scheduled_at)}
          </p>
        )}
        <div className="space-y-2 max-h-52 overflow-y-auto">
          {notes && notes.length === 0 && <p className="text-sm text-muted-foreground">No notes yet.</p>}
          {(notes || []).map((n) => (
            <div key={n.id} className="rounded-xl border border-border bg-card/60 p-3" data-testid="session-note-row">
              <p className="text-sm whitespace-pre-wrap">{n.content}</p>
              <div className="flex items-center justify-between mt-2">
                <p className="text-[10px] text-muted-foreground">{fmtDateTime(n.created_at)}</p>
                <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  Shared with client
                  <Switch checked={n.shared_with_client} onCheckedChange={() => toggleShare(n)} className="scale-75" data-testid="note-share-toggle" />
                </label>
              </div>
            </div>
          ))}
        </div>
        <form onSubmit={addNote} className="space-y-3 border-t border-border pt-4">
          <Textarea required rows={3} value={content} onChange={(e) => setContent(e.target.value)} placeholder="How did the session go?" data-testid="session-notes-textarea" />
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch checked={shared} onCheckedChange={setShared} data-testid="session-notes-share-switch" />
              Share with client
            </label>
            <Button type="submit" size="sm" disabled={saving || !content.trim()} className="rounded-xl" data-testid="note-save-button">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add note'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
