import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

const today = () => new Date().toISOString().slice(0, 10);

const DEFAULT_FORM = {
  check_in_date: today(),
  energy: '',
  soreness: '',
  sleep_quality: '',
  stress: '',
  body_notes: '',
  training_notes: '',
  general_notes: '',
  coach_notes: '',
  review_status: 'needs_review',
};

export default function CheckInForm({ initial, saving, onSubmit, submitLabel = 'Save check-in', coachMode = false }) {
  const [form, setForm] = useState(DEFAULT_FORM);

  useEffect(() => {
    setForm({
      ...DEFAULT_FORM,
      ...(initial || {}),
      check_in_date: initial?.check_in_date || today(),
      energy: initial?.energy ? String(initial.energy) : '',
      soreness: initial?.soreness ? String(initial.soreness) : '',
      sleep_quality: initial?.sleep_quality ? String(initial.sleep_quality) : '',
      stress: initial?.stress ? String(initial.stress) : '',
      body_notes: initial?.body_notes || '',
      training_notes: initial?.training_notes || '',
      general_notes: initial?.general_notes || '',
      coach_notes: initial?.coach_notes || '',
      review_status: initial?.review_status || (coachMode ? 'reviewed' : 'needs_review'),
    });
  }, [initial, coachMode]);

  const submit = (e) => {
    e.preventDefault();
    onSubmit({
      check_in_date: form.check_in_date,
      energy: form.energy ? Number(form.energy) : null,
      soreness: form.soreness ? Number(form.soreness) : null,
      sleep_quality: form.sleep_quality ? Number(form.sleep_quality) : null,
      stress: form.stress ? Number(form.stress) : null,
      body_notes: form.body_notes,
      training_notes: form.training_notes,
      general_notes: form.general_notes,
      ...(coachMode ? { coach_notes: form.coach_notes, review_status: form.review_status } : {}),
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <Label>Date</Label>
        <Input
          type="date"
          value={form.check_in_date}
          onChange={(e) => setForm({ ...form, check_in_date: e.target.value })}
          className="rounded-xl h-11"
          data-testid="check-in-date-input"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <RatingField label="Energy" value={form.energy} onChange={(energy) => setForm({ ...form, energy })} testId="check-in-energy" />
        <RatingField label="Soreness" value={form.soreness} onChange={(soreness) => setForm({ ...form, soreness })} testId="check-in-soreness" />
        <RatingField label="Sleep quality" value={form.sleep_quality} onChange={(sleep_quality) => setForm({ ...form, sleep_quality })} testId="check-in-sleep" />
        <RatingField label="Stress" value={form.stress} onChange={(stress) => setForm({ ...form, stress })} testId="check-in-stress" />
      </div>

      <div className="space-y-1.5">
        <Label>Body notes</Label>
        <Textarea rows={2} value={form.body_notes} onChange={(e) => setForm({ ...form, body_notes: e.target.value })} placeholder="Aches, recovery, weight notes..." data-testid="check-in-body-notes" />
      </div>
      <div className="space-y-1.5">
        <Label>Training notes</Label>
        <Textarea rows={2} value={form.training_notes} onChange={(e) => setForm({ ...form, training_notes: e.target.value })} placeholder="What felt good or needs work?" data-testid="check-in-training-notes" />
      </div>
      <div className="space-y-1.5">
        <Label>General notes</Label>
        <Textarea rows={2} value={form.general_notes} onChange={(e) => setForm({ ...form, general_notes: e.target.value })} placeholder="Anything your coach should know?" data-testid="check-in-general-notes" />
      </div>

      {coachMode && (
        <>
          <div className="space-y-1.5">
            <Label>Coach notes</Label>
            <Textarea rows={2} value={form.coach_notes} onChange={(e) => setForm({ ...form, coach_notes: e.target.value })} placeholder="Response or follow-up..." data-testid="check-in-coach-notes" />
          </div>
          <div className="flex items-center justify-between rounded-xl border border-border bg-card/50 px-3 py-2.5">
            <div>
              <p className="text-sm font-medium">Mark reviewed</p>
              <p className="text-xs text-muted-foreground">Remove this from the dashboard review queue.</p>
            </div>
            <Switch
              checked={form.review_status === 'reviewed'}
              onCheckedChange={(checked) => setForm({ ...form, review_status: checked ? 'reviewed' : 'needs_review' })}
              data-testid="check-in-reviewed-switch"
            />
          </div>
        </>
      )}

      <Button type="submit" disabled={saving} className="w-full rounded-xl font-semibold" data-testid="check-in-save-button">
        {saving ? 'Saving...' : submitLabel}
      </Button>
    </form>
  );
}

function RatingField({ label, value, onChange, testId }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="grid grid-cols-5 gap-1" data-testid={testId}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(value === String(n) ? '' : String(n))}
            className={cn(
              'h-9 rounded-lg border border-border text-sm font-semibold tabular-nums transition-colors',
              value === String(n) ? 'border-primary bg-primary text-primary-foreground' : 'bg-card/60 text-muted-foreground hover:text-foreground'
            )}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}
