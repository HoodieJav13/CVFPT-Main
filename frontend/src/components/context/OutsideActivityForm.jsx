import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { ACTIVITY_LABELS, ACTIVITY_TYPES, LIMITS, formToFields } from '@/lib/outsideActivities';

// Type and date are the only required answers. Minutes and effort stay blank
// (unknown) unless the person knows them; blank is never saved as 0.
export default function OutsideActivityForm({ initial, today, mode = 'create', saving = false, error = null, onSubmit, onCancel }) {
  const [form, setForm] = useState(initial);
  const [localError, setLocalError] = useState(null);
  const firstField = useRef(null);
  useEffect(() => { setForm(initial); setLocalError(null); }, [initial]);
  useEffect(() => { firstField.current?.focus(); }, []);

  const set = (patch) => setForm((current) => ({ ...current, ...patch }));
  const submit = (event) => {
    event.preventDefault();
    const result = formToFields(form, today);
    if (result.error) {
      setLocalError(result.error);
      return;
    }
    setLocalError(null);
    onSubmit(result.fields);
  };
  const shownError = localError || error;

  return (
    <form onSubmit={submit} className="space-y-4" data-testid="outside-activity-form" noValidate>
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium">Activity</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Activity type" data-testid="outside-activity-type">
          {ACTIVITY_TYPES.map((type, index) => (
            <button
              key={type}
              ref={index === 0 ? firstField : undefined}
              type="button"
              role="radio"
              aria-checked={form.activity_type === type}
              disabled={saving}
              onClick={() => set({ activity_type: type })}
              className={cn(
                'min-h-11 rounded-lg border border-border px-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                form.activity_type === type ? 'border-primary bg-primary text-primary-foreground' : 'bg-card/60 text-muted-foreground hover:text-foreground',
              )}
            >
              {ACTIVITY_LABELS[type]}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="outside-activity-date">Date</Label>
          <Input
            id="outside-activity-date" type="date" max={today} required disabled={saving}
            value={form.occurred_on} onChange={(event) => set({ occurred_on: event.target.value })}
            className="h-11 rounded-xl" data-testid="outside-activity-date"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="outside-activity-label">Name <span className="font-normal text-muted-foreground">(optional)</span></Label>
          <Input
            id="outside-activity-label" maxLength={LIMITS.labelChars} disabled={saving}
            value={form.label} onChange={(event) => set({ label: event.target.value })}
            placeholder="e.g. Club soccer" className="h-11 rounded-xl" data-testid="outside-activity-label"
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="outside-activity-minutes">Minutes <span className="font-normal text-muted-foreground">(blank if unknown)</span></Label>
          <Input
            id="outside-activity-minutes" inputMode="numeric" pattern="[0-9]*" disabled={saving}
            value={form.duration_minutes} onChange={(event) => set({ duration_minutes: event.target.value })}
            className="h-11 rounded-xl" data-testid="outside-activity-minutes"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="outside-activity-effort">Effort, RPE 1–10 <span className="font-normal text-muted-foreground">(blank if unknown)</span></Label>
          <Input
            id="outside-activity-effort" inputMode="numeric" pattern="[0-9]*" disabled={saving}
            value={form.effort_rpe} onChange={(event) => set({ effort_rpe: event.target.value })}
            aria-describedby="outside-activity-effort-help" className="h-11 rounded-xl" data-testid="outside-activity-effort"
          />
          <p id="outside-activity-effort-help" className="text-xs text-muted-foreground">How hard it felt, 1 easy to 10 max. Not the 1–5 check-in scale.</p>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="outside-activity-note">Note <span className="font-normal text-muted-foreground">(optional)</span></Label>
        <Textarea
          id="outside-activity-note" rows={2} maxLength={LIMITS.noteChars} disabled={saving}
          value={form.note} onChange={(event) => set({ note: event.target.value })}
          placeholder="Anything your coach should know?" data-testid="outside-activity-note"
        />
      </div>

      {shownError && (
        <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm" data-testid="outside-activity-form-error">{shownError}</p>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" className="min-h-11 rounded-xl" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button type="submit" className="min-h-11 rounded-xl font-semibold" disabled={saving} data-testid="outside-activity-save">
          {saving ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />Saving…</> : mode === 'edit' ? 'Save correction' : 'Save activity'}
        </Button>
      </div>
    </form>
  );
}
