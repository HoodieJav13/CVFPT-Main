import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { api, errMsg } from '@/lib/api';
import { PageHeader, SessionsSkeleton, LoadErrorState, EmptyState, StatusBadge, SectionLabel } from '@/components/common';
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
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Plus, CalendarDays, MoreVertical, Check, X, Pencil, StickyNote, Loader2, Inbox, Dumbbell, UserX,
} from 'lucide-react';
import DateTimePicker from '@/components/DateTimePicker';
import { AvailabilityDrawer } from '@/components/AvailabilityEditor';
import { fmtTime, fmtDay, fmtDateTime, toLocalInputValue, isBeforeToday } from '@/lib/format';
import { toast } from 'sonner';

const FILTERS = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'today', label: 'Today' },
  { key: 'past', label: 'Past' },
  { key: 'cancelled', label: 'Cancelled' },
];

export default function CoachSessions() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sessions, setSessions] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [bookings, setBookings] = useState([]);
  const [clients, setClients] = useState([]);
  const [filter, setFilter] = useState('upcoming');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [notesFor, setNotesFor] = useState(null);
  const [bookingConflicts, setBookingConflicts] = useState({});

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
      setLoadError(null);
    } catch (e) {
      const message = errMsg(e, 'Failed to load sessions');
      setLoadError(message);
      toast.error(message);
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

  useEffect(() => {
    const requestedView = searchParams.get('view');
    if (FILTERS.some((item) => item.key === requestedView)) setFilter(requestedView);
  }, [searchParams]);

  const presetClient = searchParams.get('client');

  const filtered = useMemo(() => {
    if (!sessions) return [];
    const todayStr = new Date().toDateString();
    let list = sessions;
    if (filter === 'upcoming') list = sessions.filter((s) => s.status === 'scheduled' && !isBeforeToday(s.scheduled_at));
    if (filter === 'today') list = sessions.filter((s) => new Date(s.scheduled_at).toDateString() === todayStr && s.status !== 'cancelled');
    if (filter === 'past') list = sessions.filter((s) => s.status === 'completed' || (s.status === 'scheduled' && isBeforeToday(s.scheduled_at))).slice().reverse();
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

  const [acting, setActing] = useState(null);

  const complete = async (s) => {
    if (acting) return;
    setActing(s.id);
    try {
      await api.patch(`/sessions/${s.id}/complete`);
      toast.success('Session completed');
      await load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setActing(null);
    }
  };

  const markNoShow = async (s) => {
    if (acting) return;
    setActing(s.id);
    try {
      await api.patch(`/sessions/${s.id}/no-show`);
      toast.success('Marked as a no-show');
      await load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setActing(null);
    }
  };

  const cancel = async (s) => {
    if (acting) return;
    setActing(s.id);
    try {
      await api.patch(`/sessions/${s.id}/cancel`);
      toast.success('Session cancelled');
      await load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setActing(null);
    }
  };

  const handleBooking = async (id, action) => {
    if (acting) return;
    setActing(id);
    try {
      await api.patch(`/bookings/${id}/${action}`);
      toast.success(action === 'approve' ? 'Approved - session created' : 'Request declined');
      setBookingConflicts((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      load();
    } catch (e) {
      // A conflicting approval is refused server-side and the request stays
      // pending — keep the reason visible on the row, not just in a toast.
      const conflict = e?.response?.status === 409 && e?.response?.data?.conflict;
      if (action === 'approve' && conflict) {
        setBookingConflicts((current) => ({
          ...current,
          [id]: { scope: e.response.data.conflict.scope, message: e.response.data.error },
        }));
      } else {
        toast.error(errMsg(e));
      }
    } finally {
      setActing(null);
    }
  };

  if (!sessions && loadError) return <LoadErrorState message={loadError} scope="coach-sessions" onRetry={() => { setLoadError(null); load(); }} />;
  if (!sessions) return <SessionsSkeleton />;

  return (
    <div>
      <PageHeader
        title="Sessions"
        subtitle="Schedule, complete and manage training sessions"
        action={
          <div className="grid w-full grid-cols-3 gap-1.5 sm:flex sm:w-auto sm:items-center">
            <Button variant="outline" className="min-h-11 min-w-0 rounded-xl px-2 sm:px-4" onClick={() => setHoursOpen(true)} data-testid="session-hours-button">
              Hours
            </Button>
            <Button variant="outline" className="min-h-11 min-w-0 rounded-xl px-2 sm:px-4" onClick={() => navigate('/coach/calendar')} data-testid="session-week-view-button">
              <CalendarDays className="mr-1 h-4 w-4" /> Week
            </Button>
            <Button className="min-h-11 min-w-0 rounded-xl px-2 sm:px-4" onClick={() => { setEditing(null); setDrawerOpen(true); }} data-testid="session-create-button">
              <Plus className="mr-1 h-4 w-4" /> New
            </Button>
          </div>
        }
      />

      {bookings.length > 0 && (
        <div className="mb-5 rounded-2xl border border-gold/30 bg-gold/5 p-4" data-testid="pending-requests-banner">
          <p className="text-sm font-semibold flex items-center gap-2 mb-3">
            <Inbox className="h-4 w-4 text-gold" /> {bookings.length} pending booking request{bookings.length > 1 ? 's' : ''}
          </p>
          <div className="space-y-2">
            {bookings.map((b) => (
              <div key={b.id} className="rounded-xl bg-card/70 border border-border px-3 py-2.5" data-testid="sessions-booking-row">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate" data-testid="booking-client-name">{b.client?.name}</p>
                    <p className="text-xs text-muted-foreground" data-testid="booking-request-time">{fmtDateTime(b.requested_time)} - {b.duration_minutes}m</p>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <Button size="sm" className="min-h-11 rounded-lg" disabled={acting === b.id} onClick={() => handleBooking(b.id, 'approve')} data-testid="booking-approve-button"><Check className="h-3.5 w-3.5 mr-1" /> Approve</Button>
                    <Button size="sm" variant="ghost" className="min-h-11 rounded-lg border border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={acting === b.id} onClick={() => handleBooking(b.id, 'decline')} data-testid="booking-decline-button">Decline</Button>
                  </div>
                </div>
                {bookingConflicts[b.id] && (
                  <p
                    className="mt-2 rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-xs"
                    role="alert"
                    data-testid="booking-conflict-note"
                    data-conflict-scope={bookingConflicts[b.id].scope}
                  >
                    {bookingConflicts[b.id].message}
                  </p>
                )}
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
            className={`min-h-11 shrink-0 rounded-full border px-4 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${filter === f.key ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}
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
            <SectionLabel className="mb-2">{g.day}</SectionLabel>
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
                        <Button size="icon" variant="ghost" className="h-11 w-11 rounded-lg" data-testid="session-actions-button">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {s.status === 'scheduled' && (
                          <DropdownMenuItem onClick={() => complete(s)} data-testid="session-complete-action">
                            <Check className="h-4 w-4 mr-2" /> Mark complete
                          </DropdownMenuItem>
                        )}
                        {s.status === 'scheduled' && new Date(s.scheduled_at).getTime() <= Date.now() && (
                          <DropdownMenuItem onClick={() => markNoShow(s)} data-testid="session-no-show-action">
                            <UserX className="h-4 w-4 mr-2" /> Mark no-show
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => setNotesFor(s)} data-testid="session-notes-action">
                          <StickyNote className="h-4 w-4 mr-2" /> Notes
                        </DropdownMenuItem>
                        {s.status !== 'cancelled' && (
                          <DropdownMenuItem onClick={() => navigate(`/coach/clients/${s.client_id}?tab=programs&session=${s.id}`)} data-testid="session-log-workout-action">
                            <Dumbbell className="h-4 w-4 mr-2" /> Log workout
                          </DropdownMenuItem>
                        )}
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
      <AvailabilityDrawer open={hoursOpen} onOpenChange={setHoursOpen} />
    </div>
  );
}

function SessionDrawer({ open, onOpenChange, clients, editing, presetClient, onSaved }) {
  const [form, setForm] = useState({ client_id: '', scheduled_at: '', duration_minutes: '60', location: '' });
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(null);

  useEffect(() => {
    if (open) {
      setConflict(null);
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

  // A shown conflict is about a specific client + time + duration; changing
  // any of those restarts the attempt, so the panel clears.
  const setField = (patch) => {
    setForm((current) => ({ ...current, ...patch }));
    if (Object.keys(patch).some((key) => key !== 'location')) setConflict(null);
  };

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
      const { data } = editing
        ? await api.put(`/sessions/${editing.id}`, payload)
        : await api.post('/sessions', payload);
      // Location overlap is advisory only (S1): the session is saved either way.
      if (data?.location_overlaps > 0) {
        toast.warning(`Scheduled — heads up: ${data.location_overlaps} other session${data.location_overlaps === 1 ? '' : 's'} at ${form.location.trim()} in that window.`);
      } else {
        toast.success(editing ? 'Session updated' : 'Session scheduled');
      }
      onSaved();
    } catch (err) {
      const conflictData = err?.response?.status === 409 && err?.response?.data?.conflict;
      if (conflictData) {
        setConflict(err.response.data.conflict);
      } else {
        toast.error(errMsg(err));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent data-testid="session-editor-drawer">
        <div className="mx-auto w-full max-w-md px-4 pb-6">
          <DrawerHeader className="px-0">
            <DrawerTitle>{editing ? 'Edit session' : 'New session'}</DrawerTitle>
          </DrawerHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Client *</Label>
              <Select value={form.client_id} onValueChange={(v) => setField({ client_id: v })} disabled={Boolean(editing)}>
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
              <DateTimePicker
                value={form.scheduled_at}
                onChange={(scheduled_at) => setField({ scheduled_at })}
                data-testid="session-datetime-input"
              />
              {conflict && (
                <div
                  className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm"
                  role="alert"
                  data-testid="session-conflict-panel"
                  data-conflict-scope={conflict.scope}
                >
                  <p className="font-medium">
                    {conflict.scope === 'client' ? 'This client is already booked then' : 'You already have a session then'}
                  </p>
                  {conflict.session?.scheduled_at && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {fmtDateTime(conflict.session.scheduled_at)} · {conflict.session.duration_minutes} min{conflict.session.location ? ` · ${conflict.session.location}` : ''}
                    </p>
                  )}
                  <p className="mt-0.5 text-xs text-muted-foreground">Pick a different time or duration.</p>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Duration</Label>
                <Select value={form.duration_minutes} onValueChange={(v) => setField({ duration_minutes: v })}>
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
                <Input value={form.location} onChange={(e) => setField({ location: e.target.value })} placeholder="CVF Studio" className="rounded-xl h-11" data-testid="session-location-input" />
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
