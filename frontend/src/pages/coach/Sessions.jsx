import { useEffect, useState, useCallback, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api, errMsg } from '@/lib/api';
import { PageHeader, SessionsSkeleton, LoadErrorState, EmptyState, StatusBadge, SectionLabel } from '@/components/common';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Plus, CalendarDays, MoreVertical, Check, X, Pencil, StickyNote, Loader2, Inbox, Dumbbell, UserX,
} from 'lucide-react';
import { AvailabilityDrawer } from '@/components/AvailabilityEditor';
import { SessionEditorDrawer } from '@/components/SessionEditorDrawer';
import { SessionNotesDialog } from '@/components/SessionNotesDialog';
import { fmtTime, fmtDay, fmtDateTime, isBeforeToday } from '@/lib/format';
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
  // Destructive friction (audit F-9): cancelling from the row menu confirms
  // in a dialog, matching the two-tap pattern everywhere else.
  const [cancelFor, setCancelFor] = useState(null);
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
    // Past is every finished outcome (completed and no-show, like the
    // Cancelled filter treats cancelled) plus stale scheduled sessions.
    if (filter === 'past') list = sessions.filter((s) => s.status === 'completed' || s.status === 'no_show' || (s.status === 'scheduled' && isBeforeToday(s.scheduled_at))).slice().reverse();
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
              <div key={b.id} className="rounded-xl border border-gold/30 bg-gold/[0.06] px-3 py-2.5" data-testid="sessions-booking-row">
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
            aria-pressed={filter === f.key}
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
                  <Link
                    to={`/coach/sessions/${s.id}`}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    data-testid="coach-session-detail-link"
                  >
                    <div className="text-center shrink-0 w-16">
                      <p className="font-display font-semibold text-primary tabular-nums text-sm">{fmtTime(s.scheduled_at)}</p>
                      <p className="text-[10px] text-muted-foreground">{s.duration_minutes}m</p>
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium truncate text-sm">{s.client?.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {s.location || 'No location'}
                        {s.workout?.name ? ` · ${s.workout.name}` : ''}
                      </p>
                      {s.status === 'scheduled' && s.linked_workout_log?.status === 'active' && (
                        <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-primary" data-testid="session-live-chip">
                          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-primary motion-safe:animate-pulse" /> In the gym now
                        </p>
                      )}
                      {s.status === 'scheduled' && s.linked_workout_log?.status === 'completed' && (
                        <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-gold" data-testid="session-workout-done-chip">
                          <Dumbbell className="h-3 w-3" /> Workout done{s.linked_workout_log.quick_completed ? ' (not tracked)' : ''}
                        </p>
                      )}
                    </div>
                  </Link>
                  <div className="flex items-center gap-2 shrink-0">
                    {s.status === 'scheduled' && s.linked_workout_log?.status === 'completed' ? (
                      // The workout is in — surface the approval right on the
                      // row; the chip already says why.
                      <Button size="sm" className="min-h-11 rounded-lg" disabled={acting === s.id} onClick={() => complete(s)} data-testid="session-confirm-complete-button">
                        {acting === s.id ? <><Loader2 className="h-4 w-4 animate-spin" /><span className="sr-only">Completing session</span></> : <><Check className="h-3.5 w-3.5 mr-1" /> Complete</>}
                      </Button>
                    ) : (
                      <StatusBadge status={s.status} />
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon" variant="ghost" className="h-11 w-11 rounded-lg" data-testid="session-actions-button">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {/* Mirror the server guard (and the detail page): a
                            future day's session can't be completed. */}
                        {s.status === 'scheduled' && new Date(s.scheduled_at).setHours(0, 0, 0, 0) <= Date.now() && (
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
                            <DropdownMenuItem onClick={() => setCancelFor(s)} className="text-destructive" data-testid="session-cancel-action">
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

      <SessionEditorDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        clients={clients}
        editing={editing}
        presetClient={presetClient}
        onSaved={() => { setDrawerOpen(false); load(); }}
      />

      <SessionNotesDialog session={notesFor} onClose={() => setNotesFor(null)} />
      <AvailabilityDrawer open={hoursOpen} onOpenChange={setHoursOpen} />

      <Dialog open={Boolean(cancelFor)} onOpenChange={(open) => !open && setCancelFor(null)}>
        <DialogContent className="max-w-sm" data-testid="session-cancel-dialog">
          <DialogHeader>
            <DialogTitle>Cancel this session?</DialogTitle>
            <DialogDescription>
              {cancelFor && `${cancelFor.client?.name} — ${fmtDateTime(cancelFor.scheduled_at)}. The client will be notified.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className="min-h-11 rounded-xl" onClick={() => setCancelFor(null)} data-testid="session-cancel-keep">
              Keep session
            </Button>
            <Button
              variant="ghost"
              className="min-h-11 rounded-xl border border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={Boolean(acting)}
              onClick={async () => { const target = cancelFor; setCancelFor(null); await cancel(target); }}
              data-testid="session-cancel-confirm"
            >
              Cancel session
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
