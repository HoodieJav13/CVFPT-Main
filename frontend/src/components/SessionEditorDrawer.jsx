// Coach session editor (create + edit), shared by the Sessions list and the
// coach session detail page. Extracted unchanged from pages/coach/Sessions.jsx.
import { useEffect, useState } from 'react';
import { api, errMsg } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerFooter,
} from '@/components/ui/drawer';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import DateTimePicker from '@/components/DateTimePicker';
import { fmtDateTime, toLocalInputValue } from '@/lib/format';
import { toast } from 'sonner';

export function SessionEditorDrawer({ open, onOpenChange, clients, editing, presetClient, onSaved }) {
  const [form, setForm] = useState({ client_id: '', scheduled_at: '', duration_minutes: '60', location: '', workout_id: 'none' });
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(null);
  // 011 B: optional planned-workout attachment, fetched once per drawer open.
  const [workouts, setWorkouts] = useState(null);

  useEffect(() => {
    if (open) {
      setConflict(null);
      if (editing) {
        setForm({
          client_id: editing.client_id,
          scheduled_at: toLocalInputValue(editing.scheduled_at),
          duration_minutes: String(editing.duration_minutes),
          location: editing.location || '',
          workout_id: editing.workout_id || 'none',
        });
      } else {
        setForm({ client_id: presetClient || '', scheduled_at: '', duration_minutes: '60', location: '', workout_id: 'none' });
      }
      if (workouts === null) {
        api.get('/programs/workouts')
          .then(({ data }) => setWorkouts(data))
          .catch(() => setWorkouts([]));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        workout_id: form.workout_id === 'none' ? null : form.workout_id,
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
            <div className="space-y-1.5">
              <Label>Planned workout</Label>
              <Select value={form.workout_id} onValueChange={(v) => setForm((current) => ({ ...current, workout_id: v }))}>
                <SelectTrigger className="rounded-xl h-11" data-testid="session-workout-select">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No workout attached</SelectItem>
                  {(workouts || []).map((workout) => (
                    <SelectItem key={workout.id} value={workout.id}>{workout.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">The client sees the plan on their session page.</p>
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
