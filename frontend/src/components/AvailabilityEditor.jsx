import { useEffect, useState, useCallback } from 'react';
import { api, errMsg } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { IconButton, SectionLabel, ListSkeleton, LoadErrorState } from '@/components/common';
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription,
} from '@/components/ui/drawer';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Plus, Trash2, Loader2 } from 'lucide-react';
import { fmtDateTime, fmtDay } from '@/lib/format';
import { toast } from 'sonner';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// tstzrange arrives as '["2026-08-10 13:00:00+00","2026-08-10 20:00:00+00")'.
function parseSpan(span) {
  const match = /^[[(]"?([^",]+)"?\s*,\s*"?([^",)\]]+)"?[)\]]$/.exec(span || '');
  return match ? { starts_at: match[1], ends_at: match[2] } : null;
}

const trimSeconds = (value) => (value || '').slice(0, 5);

export function AvailabilityDrawer({ open, onOpenChange }) {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [windows, setWindows] = useState([]);
  const [savingWindows, setSavingWindows] = useState(false);
  const [override, setOverride] = useState({ on_date: '', start_time: '', end_time: '' });
  const [timeOff, setTimeOff] = useState({ starts_at: '', ends_at: '', reason: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/availability/mine');
      setData(data);
      setWindows(data.windows.map((w) => ({ ...w, start_time: trimSeconds(w.start_time), end_time: trimSeconds(w.end_time) })));
      setLoadError(null);
    } catch (e) {
      setLoadError(errMsg(e, 'Failed to load availability'));
    }
  }, []);

  useEffect(() => { if (open) load(); }, [open, load]);

  const saveWindows = async () => {
    setSavingWindows(true);
    try {
      const payload = windows.map(({ weekday, start_time, end_time }) => ({ weekday: Number(weekday), start_time, end_time }));
      await api.put('/availability/windows', { windows: payload });
      toast.success('Weekly hours saved');
      load();
    } catch (e) {
      toast.error(errMsg(e, 'Failed to save hours'));
    } finally {
      setSavingWindows(false);
    }
  };

  const addOverride = async () => {
    setBusy(true);
    try {
      await api.post('/availability/overrides', override);
      toast.success('Date override added');
      setOverride({ on_date: '', start_time: '', end_time: '' });
      load();
    } catch (e) {
      toast.error(errMsg(e, 'Failed to add override'));
    } finally {
      setBusy(false);
    }
  };

  const addTimeOff = async () => {
    setBusy(true);
    try {
      await api.post('/availability/time-off', {
        starts_at: timeOff.starts_at ? new Date(timeOff.starts_at).toISOString() : '',
        ends_at: timeOff.ends_at ? new Date(timeOff.ends_at).toISOString() : '',
        reason: timeOff.reason,
      });
      toast.success('Time off added — booked sessions stay on the calendar');
      setTimeOff({ starts_at: '', ends_at: '', reason: '' });
      load();
    } catch (e) {
      toast.error(errMsg(e, 'Failed to add time off'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (kind, id) => {
    try {
      await api.delete(`/availability/${kind}/${id}`);
      load();
    } catch (e) {
      toast.error(errMsg(e, 'Failed to remove'));
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent data-testid="availability-drawer">
        <div className="mx-auto w-full max-w-lg px-4 pb-8 max-h-[80vh] overflow-y-auto">
          <DrawerHeader className="px-0">
            <DrawerTitle className="font-display">My hours</DrawerTitle>
            <DrawerDescription>
              Clients pick session times from these open windows. Requests still come to you to approve.
            </DrawerDescription>
          </DrawerHeader>
          {loadError && !data && <LoadErrorState message={loadError} scope="availability" onRetry={() => { setLoadError(null); load(); }} />}
          {!data && !loadError && <ListSkeleton rows={3} />}
          {data && (
            <div className="space-y-6">
              <section>
                <SectionLabel className="mb-2">Weekly hours</SectionLabel>
                <div className="space-y-2">
                  {windows.length === 0 && (
                    <p className="text-sm text-muted-foreground" data-testid="availability-empty">
                      No hours published yet — clients see a free date picker until you add some.
                    </p>
                  )}
                  {windows.map((w, i) => (
                    <div key={w.id || `new-${i}`} className="flex items-center gap-2" data-testid="availability-window-row">
                      <Select value={String(w.weekday)} onValueChange={(v) => setWindows(windows.map((row, j) => (j === i ? { ...row, weekday: Number(v) } : row)))}>
                        <SelectTrigger className="h-11 w-20 shrink-0 rounded-xl" data-testid="availability-weekday-select"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {WEEKDAYS.map((name, day) => <SelectItem key={day} value={String(day)}>{name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Input type="time" step={1800} value={w.start_time} onChange={(e) => setWindows(windows.map((row, j) => (j === i ? { ...row, start_time: e.target.value } : row)))} className="h-11 min-w-0 flex-1 rounded-xl" data-testid="availability-start-input" />
                      <span className="text-muted-foreground text-xs" aria-hidden="true">–</span>
                      <Input type="time" step={1800} value={w.end_time} onChange={(e) => setWindows(windows.map((row, j) => (j === i ? { ...row, end_time: e.target.value } : row)))} className="h-11 min-w-0 flex-1 rounded-xl" data-testid="availability-end-input" />
                      <IconButton label="Remove window" size="touchIcon" variant="ghost" className="rounded-lg text-muted-foreground shrink-0" onClick={() => setWindows(windows.filter((_, j) => j !== i))} data-testid="availability-window-remove">
                        <Trash2 className="h-3.5 w-3.5" />
                      </IconButton>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <Button variant="secondary" size="sm" className="rounded-xl" onClick={() => setWindows([...windows, { weekday: 1, start_time: '06:00', end_time: '11:00' }])} data-testid="availability-add-window">
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add window
                  </Button>
                  <Button size="sm" className="rounded-xl" onClick={saveWindows} disabled={savingWindows} data-testid="availability-save-windows">
                    {savingWindows ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save hours'}
                  </Button>
                </div>
              </section>

              <section>
                <SectionLabel className="mb-2">Date overrides</SectionLabel>
                <p className="mb-2 text-xs text-muted-foreground">A date with overrides uses only those hours instead of the weekly ones.</p>
                <div className="space-y-2">
                  {data.overrides.map((o) => (
                    <div key={o.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card/60 px-3 py-2" data-testid="availability-override-row">
                      <p className="text-sm">{fmtDay(`${o.on_date}T12:00:00`)} · <span className="tabular-nums">{trimSeconds(o.start_time)}–{trimSeconds(o.end_time)}</span></p>
                      <IconButton label="Remove override" size="touchIcon" variant="ghost" className="rounded-lg text-muted-foreground" onClick={() => remove('overrides', o.id)} data-testid="availability-override-remove">
                        <Trash2 className="h-3.5 w-3.5" />
                      </IconButton>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <div className="space-y-1"><Label className="text-xs">Date</Label>
                    <Input type="date" value={override.on_date} onChange={(e) => setOverride({ ...override, on_date: e.target.value })} className="h-11 w-36 rounded-xl" data-testid="availability-override-date" /></div>
                  <div className="space-y-1"><Label className="text-xs">From</Label>
                    <Input type="time" step={1800} value={override.start_time} onChange={(e) => setOverride({ ...override, start_time: e.target.value })} className="h-11 rounded-xl" data-testid="availability-override-start" /></div>
                  <div className="space-y-1"><Label className="text-xs">To</Label>
                    <Input type="time" step={1800} value={override.end_time} onChange={(e) => setOverride({ ...override, end_time: e.target.value })} className="h-11 rounded-xl" data-testid="availability-override-end" /></div>
                  <Button variant="secondary" size="sm" className="h-11 rounded-xl" onClick={addOverride} disabled={busy || !override.on_date || !override.start_time || !override.end_time} data-testid="availability-override-add">
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add
                  </Button>
                </div>
              </section>

              <section>
                <SectionLabel className="mb-2">Time off</SectionLabel>
                <p className="mb-2 text-xs text-muted-foreground">Blocks open slots. Already-booked sessions stay put — cancel those separately if needed. Reasons stay private to you.</p>
                <div className="space-y-2">
                  {data.time_off.map((t) => {
                    const span = parseSpan(t.span);
                    return (
                      <div key={t.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card/60 px-3 py-2" data-testid="availability-timeoff-row">
                        <div className="min-w-0">
                          <p className="truncate text-sm">{span ? `${fmtDateTime(span.starts_at)} – ${fmtDateTime(span.ends_at)}` : t.span}</p>
                          {t.reason && <p className="truncate text-xs text-muted-foreground">{t.reason}</p>}
                        </div>
                        <IconButton label="Remove time off" size="touchIcon" variant="ghost" className="rounded-lg text-muted-foreground" onClick={() => remove('time-off', t.id)} data-testid="availability-timeoff-remove">
                          <Trash2 className="h-3.5 w-3.5" />
                        </IconButton>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-2 space-y-2">
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="space-y-1"><Label className="text-xs">From</Label>
                      <Input type="datetime-local" value={timeOff.starts_at} onChange={(e) => setTimeOff({ ...timeOff, starts_at: e.target.value })} className="h-11 rounded-xl" data-testid="availability-timeoff-start" /></div>
                    <div className="space-y-1"><Label className="text-xs">To</Label>
                      <Input type="datetime-local" value={timeOff.ends_at} onChange={(e) => setTimeOff({ ...timeOff, ends_at: e.target.value })} className="h-11 rounded-xl" data-testid="availability-timeoff-end" /></div>
                  </div>
                  <div className="flex items-end gap-2">
                    <div className="flex-1 space-y-1"><Label className="text-xs">Reason (private)</Label>
                      <Input value={timeOff.reason} onChange={(e) => setTimeOff({ ...timeOff, reason: e.target.value })} placeholder="Vacation, appointment..." className="h-11 rounded-xl" data-testid="availability-timeoff-reason" /></div>
                    <Button variant="secondary" size="sm" className="h-11 rounded-xl" onClick={addTimeOff} disabled={busy || !timeOff.starts_at || !timeOff.ends_at} data-testid="availability-timeoff-add">
                      <Plus className="h-3.5 w-3.5 mr-1" /> Add
                    </Button>
                  </div>
                </div>
              </section>
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
