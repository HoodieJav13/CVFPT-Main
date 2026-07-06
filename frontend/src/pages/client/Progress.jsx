import { useEffect, useState, useCallback } from 'react';
import { api, errMsg } from '@/lib/api';
import { PageHeader, LoadingScreen, EmptyState, MetricChart } from '@/components/common';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { TrendingUp, Plus, Pencil, Loader2 } from 'lucide-react';
import { fmtDate } from '@/lib/format';
import { toast } from 'sonner';

const blankEntry = () => ({ value: '', recorded_on: new Date().toISOString().slice(0, 10), notes: '' });

export default function ClientProgress() {
  const [metrics, setMetrics] = useState(null);
  const [entryFor, setEntryFor] = useState(null);
  const [editingEntry, setEditingEntry] = useState(null);
  const [entryForm, setEntryForm] = useState(blankEntry());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/progress/mine');
      setMetrics(data);
    } catch (e) {
      toast.error(errMsg(e, 'Failed to load progress'));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openNewEntry = (metric) => {
    setEntryFor(metric);
    setEditingEntry(null);
    setEntryForm(blankEntry());
  };

  const openEditEntry = (metric, entry) => {
    setEntryFor(metric);
    setEditingEntry(entry);
    setEntryForm({
      value: String(entry.value),
      recorded_on: entry.recorded_on,
      notes: entry.notes || '',
    });
  };

  const closeEntry = () => {
    setEntryFor(null);
    setEditingEntry(null);
    setEntryForm(blankEntry());
  };

  const saveEntry = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editingEntry) {
        await api.put(`/progress/entries/${editingEntry.id}`, entryForm);
        toast.success('Progress entry updated');
      } else {
        await api.post(`/progress/metrics/${entryFor.id}/entries`, entryForm);
        toast.success('Progress entry logged');
      }
      closeEntry();
      load();
    } catch (err) {
      toast.error(errMsg(err, 'Could not save entry'));
    } finally {
      setSaving(false);
    }
  };

  if (!metrics) return <LoadingScreen />;

  return (
    <div>
      <PageHeader title="Progress" subtitle="Log values for metrics your coach is tracking" />
      {metrics.length === 0 && (
        <EmptyState icon={TrendingUp} title="No metrics yet" subtitle="Your coach will create measurements and benchmarks here as you train." testId="client-progress-empty" />
      )}
      <div className="space-y-4">
        {metrics.map((m) => {
          const latest = m.entries[m.entries.length - 1];
          const first = m.entries[0];
          const delta = latest && first ? (Number(latest.value) - Number(first.value)).toFixed(1) : null;
          return (
            <Card key={m.id} data-testid="client-metric-card">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base font-display">{m.name}</CardTitle>
                    {latest ? (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Latest: <span className="text-primary font-semibold tabular-nums">{latest.value}{m.unit ? ` ${m.unit}` : ''}</span> on {fmtDate(latest.recorded_on)}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground mt-0.5">No entries yet</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {delta !== null && m.entries.length > 1 && (
                      <span className="text-xs font-semibold tabular-nums text-gold">
                        {delta > 0 ? '+' : ''}{delta}{m.unit ? ` ${m.unit}` : ''}
                      </span>
                    )}
                    <Button size="sm" className="rounded-lg" onClick={() => openNewEntry(m)} data-testid="client-log-entry-button">
                      <Plus className="h-3.5 w-3.5 mr-1" /> Log
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {m.entries.length > 0 ? (
                  <>
                    <MetricChart entries={m.entries} unit={m.unit} />
                    <div className="mt-3 space-y-2">
                      {m.entries.slice().reverse().slice(0, 4).map((entry) => (
                        <div key={entry.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card/60 px-3 py-2" data-testid="client-progress-entry-row">
                          <div>
                            <p className="text-sm font-medium tabular-nums">{entry.value}{m.unit ? ` ${m.unit}` : ''}</p>
                            <p className="text-xs text-muted-foreground">{fmtDate(entry.recorded_on)}{entry.notes ? ` - ${entry.notes}` : ''}</p>
                          </div>
                          <Button size="icon" variant="ghost" className="h-8 w-8 rounded-lg" onClick={() => openEditEntry(m, entry)} data-testid="client-edit-entry-button">
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground py-3 text-center">Log your first value to start the chart.</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={Boolean(entryFor)} onOpenChange={(open) => !open && closeEntry()}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{editingEntry ? 'Edit' : 'Log'} {entryFor?.name}</DialogTitle></DialogHeader>
          <form onSubmit={saveEntry} className="space-y-3.5">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Value{entryFor?.unit ? ` (${entryFor.unit})` : ''} *</Label>
                <Input required type="number" step="any" value={entryForm.value} onChange={(e) => setEntryForm({ ...entryForm, value: e.target.value })} data-testid="client-entry-value-input" />
              </div>
              <div className="space-y-1.5">
                <Label>Date</Label>
                <Input type="date" value={entryForm.recorded_on} onChange={(e) => setEntryForm({ ...entryForm, recorded_on: e.target.value })} data-testid="client-entry-date-input" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Input value={entryForm.notes} onChange={(e) => setEntryForm({ ...entryForm, notes: e.target.value })} placeholder="Optional context" data-testid="client-entry-notes-input" />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={saving} className="rounded-xl w-full sm:w-auto" data-testid="client-entry-save-button">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editingEntry ? 'Save changes' : 'Log entry'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
