import { useEffect, useState, useCallback, useMemo } from 'react';
import { api, errMsg } from '@/lib/api';
import { PageHeader, SessionsSkeleton, EmptyState, StatusBadge, SectionLabel } from '@/components/common';
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
import { fmtTime, fmtDay, fmtDateTime, isBeforeToday } from '@/lib/format';
import { toast } from 'sonner';

export default function ClientSessions() {
  const [sessions, setSessions] = useState(null);
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
    } catch (e) {
      toast.error(errMsg(e, 'Failed to load sessions'));
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

  useEffect(() => {
    if (open) setForm({ requested_time: '', duration_minutes: '60', location: '', note: '' });
  }, [open]);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.requested_time) {
      toast.error('Please choose a date and time');
      return;
    }
    setSaving(true);
    try {
      await api.post('/bookings', {
        requested_time: new Date(form.requested_time).toISOString(),
        duration_minutes: Number(form.duration_minutes),
        location: form.location,
        note: form.note,
      });
      toast.success('Request sent - your coach will confirm');
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
          <p className="text-xs text-muted-foreground -mt-2 mb-4">Your coach must confirm before it's booked.</p>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Preferred date & time *</Label>
              <Input type="datetime-local" required value={form.requested_time} onChange={(e) => setForm({ ...form, requested_time: e.target.value })} className="rounded-xl h-11" data-testid="booking-datetime-input" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Duration</Label>
                <Select value={form.duration_minutes} onValueChange={(v) => setForm({ ...form, duration_minutes: v })}>
                  <SelectTrigger className="rounded-xl h-11" data-testid="booking-duration-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['30', '45', '60', '90'].map((d) => <SelectItem key={d} value={d}>{d} min</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Location</Label>
                <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="CVF Studio" className="rounded-xl h-11" data-testid="booking-location-input" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Note to your coach</Label>
              <Textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Anything specific you want to work on?" data-testid="booking-note-input" />
            </div>
            <DrawerFooter className="px-0">
              <Button type="submit" disabled={saving} className="rounded-xl h-11 font-semibold" data-testid="booking-submit-button">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send request'}
              </Button>
            </DrawerFooter>
          </form>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
