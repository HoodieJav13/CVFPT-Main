// Coach session editor (create + edit), shared by the Sessions list and the
// coach session detail page. Create mode can also build a recurring series
// (see components/series/SeriesComposer).
import { useEffect, useMemo, useState } from 'react';
import { api, errMsg } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerFooter,
} from '@/components/ui/drawer';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import DateTimePicker from '@/components/DateTimePicker';
import { SeriesComposer } from '@/components/series/SeriesComposer';
import { createDraftStore } from '@/lib/seriesDraftStore';
import { fmtDateTime, toLocalInputValue } from '@/lib/format';
import { toast } from 'sonner';

const EMPTY_FORM = { client_id: '', scheduled_at: '', duration_minutes: '60', location: '', workout_id: 'none' };

export function SessionEditorDrawer({ open, onOpenChange, clients, editing, presetClient, onSaved }) {
  const { user } = useAuth();
  const userId = user?.profile?.id || user?.email || 'anonymous';
  const draftStore = useMemo(() => createDraftStore({ userId }), [userId]);

  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(null);
  // 011 B: optional planned-workout attachment, fetched once per drawer open.
  const [workouts, setWorkouts] = useState(null);
  // Recurring series (create mode only).
  const [repeat, setRepeat] = useState(false);
  const [resumeRecord, setResumeRecord] = useState(null);
  const [composerBusy, setComposerBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setConflict(null);
      setRepeat(false);
      setResumeRecord(null);
      if (editing) {
        setForm({
          client_id: editing.client_id,
          scheduled_at: toLocalInputValue(editing.scheduled_at),
          duration_minutes: String(editing.duration_minutes),
          location: editing.location || '',
          workout_id: editing.workout_id || 'none',
        });
      } else {
        // An unfinished recurring save (timeout, reload, or a closed drawer) is resumed, never replaced.
        const pending = draftStore.findPending();
        if (pending) {
          const { body } = pending.record;
          setForm({
            client_id: pending.clientId,
            scheduled_at: `${body.rule.start_date}T${body.rule.time}`,
            duration_minutes: String(body.duration_minutes),
            location: body.location || '',
            workout_id: 'none',
          });
          setResumeRecord(pending.record);
          setRepeat(true);
        } else {
          setForm({ ...EMPTY_FORM, client_id: presetClient || '' });
        }
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
    if (repeat) return; // the composer owns saving in repeat mode
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

  const locked = composerBusy; // client/date/duration are frozen while a series save is in flight or unresolved
  const seriesReady = repeat && form.client_id && form.scheduled_at;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent data-testid="session-editor-drawer">
        <div className="mx-auto w-full max-w-md px-4 pb-6">
          <DrawerHeader className="px-0">
            <DrawerTitle>{editing ? 'Edit session' : repeat ? 'New recurring sessions' : 'New session'}</DrawerTitle>
          </DrawerHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Client *</Label>
              <Select value={form.client_id} onValueChange={(v) => setField({ client_id: v })} disabled={Boolean(editing) || locked}>
                <SelectTrigger className="rounded-xl h-11" data-testid="session-client-select">
                  <SelectValue placeholder="Choose client..." />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{repeat ? 'First session *' : 'Date & time *'}</Label>
              <DateTimePicker
                value={form.scheduled_at}
                onChange={(scheduled_at) => setField({ scheduled_at })}
                disabled={locked}
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
                <Select value={form.duration_minutes} onValueChange={(v) => setField({ duration_minutes: v })} disabled={locked}>
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
                <Input value={form.location} onChange={(e) => setField({ location: e.target.value })} disabled={locked} placeholder="CVF Studio" className="rounded-xl h-11" data-testid="session-location-input" />
              </div>
            </div>

            {!editing && (
              <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2.5">
                <Label htmlFor="session-repeat" className="font-medium">Repeat weekly</Label>
                <Switch id="session-repeat" checked={repeat} onCheckedChange={setRepeat} disabled={locked || Boolean(resumeRecord)} data-testid="session-repeat-toggle" />
              </div>
            )}

            {repeat ? (
              seriesReady ? (
                // Keyed by CLIENT only: duration, location and the first session's date/time are props, so
                // editing them never resets the reviewed draft (see SeriesComposer for how each is handled).
                <SeriesComposer
                  key={resumeRecord ? 'resume' : form.client_id}
                  clientId={form.client_id}
                  startAt={form.scheduled_at}
                  durationMinutes={Number(form.duration_minutes)}
                  location={form.location}
                  resumeRecord={resumeRecord}
                  onBusyChange={setComposerBusy}
                  onDone={() => { setRepeat(false); setResumeRecord(null); onSaved(); }}
                />
              ) : (
                <p className="text-sm text-muted-foreground">Choose a client and the first session&apos;s date and time to set up the repeat.</p>
              )
            ) : (
              <>
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
              </>
            )}
          </form>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
