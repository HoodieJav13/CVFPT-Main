import { useEffect, useState, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, errMsg } from '@/lib/api';
import { PageHeader, LoadingScreen, EmptyState, StatusBadge } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerFooter,
} from '@/components/ui/drawer';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Plus, CalendarDays, MoreVertical, Check, X, Pencil, StickyNote, Loader2, Inbox,
} from 'lucide-react';
import { fmtTime, fmtDay, fmtDateTime, toLocalInputValue } from '@/lib/format';
import { toast } from 'sonner';

const FILTERS = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'today', label: 'Today' },
  { key: 'past', label: 'Past' },
  { key: 'cancelled', label: 'Cancelled' },
];

export default function CoachSessions() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [sessions, setSessions] = useState(null);
  const [bookings, setBookings] = useState([]);
  const [clients, setClients] = useState([]);
  const [filter, setFilter] = useState('upcoming');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [notesFor, setNotesFor] = useState(null);

  const load = useCallback(async () => {
    try {
      const [s, b, c] = await Promise.all([
        api.get('/sessions'),
        api.get('/bookings?status=pending'),
        api.get('/clients'),
      ]);
      setSessions(s.data);
      setBookings(b.data);
      setClients(c.data);
    } catch (e) {
      toast.error(errMsg(e, 'Failed to load sessions'));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setEditing(null);
      setDrawerOpen(true);
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const presetClient = searchParams.get('client');

  const filtered = useMemo(() => {
    if (!sessions) return [];
    const now = Date.now();
    const todayStr = new Date().toDateString();
    let list = sessions;
    if (filter === 'upcoming') list = sessions.filter((s) => s.status === 'scheduled' && new Date(s.scheduled_at).getTime() >= now - 3600e3);
    if (filter === 'today') list = sessions.filter((s) => new Date(s.scheduled_at).toDateString() === todayStr && s.status !== 'cancelled');
    if (filter === 'past') list = sessions.filter((s) => s.status === 'completed' || (s.status === 'scheduled' && new Date(s.scheduled_at).getTime() < now - 3600e3)).slice().reverse();
    if (filter === 'cancelled') list = sessions.filter((s) => s.status === 'cancelled');
    return list;
  }, [sessions, filter]);

  const grouped = useMemo(() => {
    const groups = [];
    let currentKey = null;
    for (const s of filtered) {
      const key = fmtDay(s.scheduled_at);
      if (key !== currentKey) {
        groups.push({ day: key, items: [] });
        currentKey = key;
      }
      groups[groups.length - 1].items.push(s);
    }
    return groups;
  }, [filtered]);

  const complete = async (s) => {
    try {
      const { data } = await api.patch(`/sessions/${s.id}/complete`);
      if (data.credit_deducted) {
        toast.success(`Session completed - 1 credit used (${data.credits_remaining} left)`);
      } else {
        toast.success('Session completed - client had no credits to deduct', { description: 'You can record a package purchase from their profile.' });
      }
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const cancel = async (s) => {
    try {
      await api.patch(`/sessions/${s.id}/cancel`);
      toast.success('Session cancelled');
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const handleBooking = async (id, action) => {
    try {
      await api.patch(`/bookings/${id}/${action}`);
      toast.success(action === 'approve' ? 'Approved - session created' : 'Request declined');
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  if (!sessions) return <LoadingScreen />;

  return (
    <div>
      <PageHeader
        title="Sessions"
        subtitle="Schedule, complete and manage training sessions"
        action={
          <Button className="rounded-xl" onClick={() => { setEditing(null); setDrawerOpen(true); }} data-testid="session-create-button">
            <Plus className="h-4 w-4 mr-1.5" /> New
          </Button>
        }
      />

      {bookings.length > 0 && (
        <div className="mb-5 rounded-2xl border border-[#F2C94C]/30 bg-[#F2C94C]/5 p-4" data-testid="pending-requests-banner">
          <p className="text-sm font-semibold flex items-center gap-2 mb-3">
            <Inbox className="h-4 w-4 text-[#F2C94C]" /> {bookings.length} pending booking request{bookings.length > 1 ? 's' : ''}
          </p>
          <div className="space-y-2">
            {bookings.map((b) => (
              <div key={b.id} className="flex items-center justify-between gap-2 rounded-xl bg-card/70 border border-border px-3 py-2.5" data-testid="sessions-booking-row">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{b.client?.name}</p>
                  <p className="text-xs text-muted-foreground">{fmtDateTime(b.requested_time)} - {b.duration_minutes}m</p>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <Button size="icon" className="h-8 w-8 rounded-lg" onClick={() => handleBooking(b.id, 'approve')} data-testid="booking-approve-button"><Check className="h-4 w-4" /></Button>
                  <Button size="icon" variant="destructive" className="h-8 w-8 rounded-lg" onClick={() => handleBooking(b.id, 'decline')} data-testid="booking-decline-button"><X className="h-4 w-4" /></Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            data-testid={`session-filter-${f.key}`}
            className={`rounded-full px-4 py-1.5 text-xs font-medium border transition-colors shrink-0 ${filter === f.key ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {grouped.length === 0 && (
        <EmptyState icon={CalendarDays} title="Nothing here" subtitle={filter === 'upcoming' ? 'Schedule your next session to see it here.' : 'No sessions match this filter.'} testId="sessions-empty-state" />
      )}

      <div className="space-y-5">
        {grouped.map((g) => (
          <div key={g.day}>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{g.day}</p>
            <div className="space-y-2">
              {g.items.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-2 rounded-xl border border-border bg-card/60 px-4 py-3" data-testid="session-row">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="text-center shrink-0 w-16">
                      <p className="font-display font-semibold text-primary tabular-nums text-sm">{fmtTime(s.scheduled_at)}</p>
                      <p className="text-[10px] text-muted-foreground">{s.duration_minutes}m</p>
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium truncate text-sm">{s.client?.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{s.location || 'No location'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusBadge status={s.status} />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon" variant="ghost" className="h-8 w-8 rounded-lg" data-testid="session-actions-button">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {s.status === 'scheduled' && (
                          <DropdownMenuItem onClick={() => complete(s)} data-testid="session-complete-action">
                            <Check className="h-4 w-4 mr-2" /> Mark complete
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => setNotesFor(s)} data-testid="session-notes-action">
                          <StickyNote className="h-4 w-4 mr-2" /> Notes
                        </DropdownMenuItem>
                        {s.status === 'scheduled' && (
                          <>
                            <DropdownMenuItem onClick={() => { setEditing(s); setDrawerOpen(true); }} data-testid="session-edit-action">
                              <Pencil className="h-4 w-4 mr-2" /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => cancel(s)} className="text-destructive" data-testid="session-cancel-action">
                              <X className="h-4 w-4 mr-2" /> Cancel session
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <SessionDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        clients={clients}
        editing={editing}
        presetClient={presetClient}
        onSaved={() => { setDrawerOpen(false); load(); }}
      />

      <NotesDialog session={notesFor} onClose={() => setNotesFor(null)} />
    </div>
  );
}

function SessionDrawer({ open, onOpenChange, clients, editing, presetClient, onSaved }) {
  const [form, setForm] = useState({ client_id: '', scheduled_at: '', duration_minutes: '60', location: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      if (editing) {
        setForm({
          client_id: editing.client_id,
          scheduled_at: toLocalInputValue(editing.scheduled_at),
          duration_minutes: String(editing.duration_minutes),
          location: editing.location || '',
        });
      } else {
        setForm({ client_id: presetClient || '', scheduled_at: '', duration_minutes: '60', location: '' });
      }
    }
  }, [open, editing, presetClient]);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.client_id || !form.scheduled_at) {
      toast.error('Client and date/time are required');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        client_id: form.client_id,
        scheduled_at: new Date(form.scheduled_at).toISOString(),
        duration_minutes: Number(form.duration_minutes),
        location: form.location,
      };
      if (editing) {
        await api.put(`/sessions/${editing.id}`, payload);
        toast.success('Session updated');
      } else {
        await api.post('/sessions', payload);
        toast.success('Session scheduled');
      }
      onSaved();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <div className="mx-auto w-full max-w-md px-4 pb-6">
          <DrawerHeader className="px-0">
            <DrawerTitle>{editing ? 'Edit session' : 'New session'}</DrawerTitle>
          </DrawerHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Client *</Label>
              <Select value={form.client_id} onValueChange={(v) => setForm({ ...form, client_id: v })} disabled={Boolean(editing)}>
                <SelectTrigger className="rounded-xl h-11" data-testid="session-client-select">
                  <SelectValue placeholder="Choose client..." />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Date & time *</Label>
              <Input type="datetime-local" required value={form.scheduled_at} onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })} className="rounded-xl h-11" data-testid="session-datetime-input" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Duration</Label>
                <Select value={form.duration_minutes} onValueChange={(v) => setForm({ ...form, duration_minutes: v })}>
                  <SelectTrigger className="rounded-xl h-11" data-testid="session-duration-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {['30', '45', '60', '90'].map((d) => <SelectItem key={d} value={d}>{d} min</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Location</Label>
                <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="CVF Studio" className="rounded-xl h-11" data-testid="session-location-input" />
              </div>
            </div>
            <DrawerFooter className="px-0">
              <Button type="submit" disabled={saving} className="rounded-xl h-11 font-semibold" data-testid="session-save-button">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editing ? 'Save changes' : 'Schedule session'}
              </Button>
            </DrawerFooter>
          </form>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function NotesDialog({ session, onClose }) {
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
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Session notes</DialogTitle>
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
