import { useEffect, useState, useCallback, useMemo } from 'react';
import { api, errMsg } from '@/lib/api';
import { PageHeader, SessionsSkeleton, LoadErrorState, EmptyState, StatusBadge, SectionLabel } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerFooter,
} from '@/components/ui/drawer';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Plus, CalendarDays, MapPin, Loader2, StickyNote } from 'lucide-react';
import DateTimePicker from '@/components/DateTimePicker';
import { fmtTime, fmtDay, fmtDateTime, isBeforeToday } from '@/lib/format';
import { toast } from 'sonner';

export default function ClientSessions() {
  const [sessions, setSessions] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [requests, setRequests] = useState([]);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([
        api.get('/sessions/client/mine'),
        api.get('/bookings/mine'),
      ]);
      setSessions(s.data);
      setRequests(r.data);
      setLoadError(null);
    } catch (e) {
      const message = errMsg(e, 'Failed to load sessions');
      setLoadError(message);
      toast.error(message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const { upcoming, past } = useMemo(() => {
    if (!sessions) return { upcoming: [], past: [] };
    const isPast = (s) => s.status === 'completed' || s.status === 'cancelled' || isBeforeToday(s.scheduled_at);
    return {
      upcoming: sessions.filter((s) => !isPast(s)).slice().reverse(),
      past: sessions.filter(isPast),
    };
  }, [sessions]);

  if (!sessions && loadError) return <LoadErrorState message={loadError} scope="client-sessions" onRetry={() => { setLoadError(null); load(); }} />;
  if (!sessions) return <SessionsSkeleton />;

  return (
    <div>
      <PageHeader
        title="Sessions"
        subtitle="Your time on the CVF floor"
        action={
          <Button className="rounded-xl" onClick={() => setDrawerOpen(true)} data-testid="booking-request-button">
            <Plus className="h-4 w-4 mr-1.5" /> Request
          </Button>
        }
      />

      {requests.filter((r) => r.status === 'pending').length > 0 && (
        <div className="mb-5">
          <SectionLabel className="mb-2">Pending requests</SectionLabel>
          <div className="space-y-2">
            {requests.filter((r) => r.status === 'pending').map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card/60 px-4 py-3" data-testid="my-booking-request-row">
                <div>
                  <p className="text-sm font-medium">{fmtDateTime(r.requested_time)}</p>
                  <p className="text-xs text-muted-foreground">{r.duration_minutes}m{r.note ? ` - "${r.note}"` : ''}</p>
                </div>
                <StatusBadge status={r.status} />
              </div>
            ))}
          </div>
        </div>
      )}

      <SectionLabel className="mb-2">Upcoming</SectionLabel>
      {upcoming.length === 0 ? (
        <EmptyState icon={CalendarDays} title="No upcoming sessions" subtitle="Request a session and your coach will confirm it." testId="upcoming-empty-state" />
      ) : (
        <div className="space-y-2">
          {upcoming.map((s) => (
            <div key={s.id} className="rounded-xl border border-primary/25 bg-card/60 px-4 py-3" data-testid="client-upcoming-session-row">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium text-sm">{fmtDay(s.scheduled_at)} - <span className="text-primary">{fmtTime(s.scheduled_at)}</span></p>
                <StatusBadge status={s.status} />
              </div>
              <p className="text-xs text-muted-foreground mt-1 flex items-center gap-3 flex-wrap">
                <span>{s.duration_minutes} min with {s.coach?.name}</span>
                {s.location && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {s.location}</span>}
              </p>
            </div>
          ))}
        </div>
      )}

      <SectionLabel className="mb-2 mt-6">Past</SectionLabel>
      {past.length === 0 ? (
        <p className="text-sm text-muted-foreground">No past sessions yet.</p>
      ) : (
        <div className="space-y-2">
          {past.map((s) => (
            <div key={s.id} className="rounded-xl border border-border bg-card/40 px-4 py-3" data-testid="client-past-session-row">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium text-sm">{fmtDay(s.scheduled_at)} - {fmtTime(s.scheduled_at)}</p>
                <StatusBadge status={s.status} />
              </div>
              <p className="text-xs text-muted-foreground mt-1">{s.duration_minutes} min with {s.coach?.name}</p>
              {s.shared_notes?.length > 0 && (
                <div className="mt-2 space-y-1.5">
                  {s.shared_notes.map((n) => (
                    <div key={n.id} className="flex gap-2 rounded-lg bg-primary/10 border border-primary/20 px-3 py-2" data-testid="shared-note-row">
                      <StickyNote className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                      <p className="text-xs whitespace-pre-wrap">{n.content}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <RequestDrawer open={drawerOpen} onOpenChange={setDrawerOpen} onSaved={() => { setDrawerOpen(false); load(); }} />
    </div>
  );
}

function RequestDrawer({ open, onOpenChange, onSaved }) {
  const [form, setForm] = useState({ requested_time: '', duration_minutes: '60', location: '', note: '' });
  const [saving, setSaving] = useState(false);
  // Open-slot picking (availability docket A4): slots === null means the
  // coach hasn't published availability, so the free date-time picker
  // stays as the fallback.
  const [slots, setSlots] = useState(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotDay, setSlotDay] = useState(null);
  // Coach's instant-booking setting — drives the drawer copy and the
  // submit label so the UI never promises the wrong outcome.
  const [coachAutoBook, setCoachAutoBook] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({ requested_time: '', duration_minutes: '60', location: '', note: '' });
      setSlotDay(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSlotsLoading(true);
    setForm((current) => ({ ...current, requested_time: '' }));
    api.get(`/availability/slots?duration=${form.duration_minutes}`)
      .then(({ data }) => {
        if (cancelled) return;
        setSlots(data.slots.length ? data.slots : null);
        setCoachAutoBook(Boolean(data.auto_book));
      })
      .catch(() => { if (!cancelled) setSlots(null); })
      .finally(() => { if (!cancelled) setSlotsLoading(false); });
    return () => { cancelled = true; };
  }, [open, form.duration_minutes]);

  const slotDays = useMemo(() => {
    if (!slots) return [];
    const byDay = new Map();
    for (const slot of slots) {
      // Group by the viewer's local calendar day — the UTC date in the
      // ISO string can differ for evening slots.
      const local = new Date(slot.starts_at);
      const day = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push(slot);
    }
    return [...byDay.entries()];
  }, [slots]);

  const activeDay = slotDay && slotDays.some(([day]) => day === slotDay)
    ? slotDay
    : slotDays[0]?.[0] ?? null;
  const activeDaySlots = slotDays.find(([day]) => day === activeDay)?.[1] || [];

  const submit = async (e) => {
    e.preventDefault();
    if (!form.requested_time) {
      toast.error(slots ? 'Please pick an open time' : 'Please choose a date and time');
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.post('/bookings', {
        requested_time: new Date(form.requested_time).toISOString(),
        duration_minutes: Number(form.duration_minutes),
        location: form.location,
        note: form.note,
      });
      toast.success(data?.auto_booked
        ? "Booked — you're on the calendar"
        : 'Request sent - your coach will confirm');
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
            <DrawerTitle>Request a session</DrawerTitle>
          </DrawerHeader>
          <p className="text-xs text-muted-foreground -mt-2 mb-4" data-testid="booking-drawer-copy">
            {coachAutoBook && slots
              ? 'Open times book instantly — pick one and it goes straight on the calendar.'
              : "Your coach must confirm before it's booked."}
          </p>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Duration</Label>
              <Select value={form.duration_minutes} onValueChange={(v) => setForm({ ...form, duration_minutes: v, requested_time: '' })}>
                <SelectTrigger className="rounded-xl h-11" data-testid="booking-duration-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['30', '45', '60'].map((d) => <SelectItem key={d} value={d}>{d} min</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Longer sessions and assessments are scheduled by your coach.</p>
            </div>
            {slotsLoading ? (
              <div className="flex items-center gap-2 rounded-xl border border-border bg-card/60 px-4 py-3 text-sm text-muted-foreground" data-testid="booking-slots-loading">
                <Loader2 className="h-4 w-4 animate-spin" /> Finding open times...
              </div>
            ) : slots ? (
              <div className="space-y-3" data-testid="booking-slot-picker">
                <div className="space-y-1.5">
                  <Label>Open days (next 3 weeks)</Label>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {slotDays.map(([day]) => (
                      <button
                        key={day}
                        type="button"
                        onClick={() => { setSlotDay(day); setForm({ ...form, requested_time: '' }); }}
                        aria-pressed={day === activeDay}
                        className={`min-h-11 shrink-0 rounded-xl border px-3 text-xs font-medium transition-colors ${day === activeDay ? 'border-primary/40 bg-primary/10 text-foreground' : 'border-border bg-card/60 text-muted-foreground hover:text-foreground'}`}
                        data-testid="booking-slot-day"
                      >
                        {fmtDay(`${day}T12:00:00`)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Open times *</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {activeDaySlots.map((slot) => (
                      <button
                        key={slot.starts_at}
                        type="button"
                        onClick={() => setForm({ ...form, requested_time: slot.starts_at })}
                        aria-pressed={form.requested_time === slot.starts_at}
                        className={`min-h-11 rounded-xl border text-sm font-medium tabular-nums transition-colors ${form.requested_time === slot.starts_at ? 'border-primary bg-primary/15 text-foreground' : 'border-border bg-card/60 text-muted-foreground hover:text-foreground'}`}
                        data-testid="booking-slot-time"
                      >
                        {fmtTime(slot.starts_at)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>Preferred date & time *</Label>
                <DateTimePicker
                  value={form.requested_time}
                  onChange={(requested_time) => setForm({ ...form, requested_time })}
                  data-testid="booking-datetime-input"
                />
                <p className="text-xs text-muted-foreground">Your coach hasn't published open times yet, so pick what works and they'll confirm.</p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Location</Label>
              <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="CVF Studio" className="rounded-xl h-11" data-testid="booking-location-input" />
            </div>
            <div className="space-y-1.5">
              <Label>Note to your coach</Label>
              <Textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Anything specific you want to work on?" data-testid="booking-note-input" />
            </div>
            <DrawerFooter className="px-0">
              <Button type="submit" disabled={saving} className="rounded-xl h-11 font-semibold" data-testid="booking-submit-button">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : (coachAutoBook && slots ? 'Book session' : 'Send request')}
              </Button>
            </DrawerFooter>
          </form>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
