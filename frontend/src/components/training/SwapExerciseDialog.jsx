import { useEffect, useState } from 'react';
import { CheckCircle2, Lightbulb } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

// PT-Sub client flow (L12/CONTRACT.md §5). Coach-approved backups and catalog
// suggestions are shown as two separate groups. Targets are prefilled only
// from a coach backup; a suggestion starts blank. Offline, the client may use
// any choice and finish; the coach reviews it later.

const TRIGGERS = [
  ['equipment_busy', 'Equipment busy'],
  ['equipment_missing', 'Equipment missing'],
  ['cannot_do', "Can't do it today"],
  ['location', 'Training elsewhere'],
  ['other', 'Other'],
];

export function swapOptionsCacheKey(logId) {
  return `cvf_swap_options_${logId}`;
}

export function readCachedSwapOptions(logId) {
  try { return JSON.parse(localStorage.getItem(swapOptionsCacheKey(logId)) || '{}'); } catch { return {}; }
}

function targetsText(targets = {}) {
  const parts = [targets.sets && `${targets.sets} sets`, targets.reps && `${targets.reps} reps`, targets.load_value != null && `${targets.load_value} ${targets.load_unit || 'lb'}`].filter(Boolean);
  return parts.length ? parts.join(' × ') : 'No targets set';
}

export default function SwapExerciseDialog({ exercise, logId, online, onClose, onConfirm }) {
  const [options, setOptions] = useState(null);
  const [loadNote, setLoadNote] = useState('');
  const [trigger, setTrigger] = useState('equipment_busy');
  const [reason, setReason] = useState('');
  const [equipment, setEquipment] = useState('');
  const [choice, setChoice] = useState(null);
  const [targets, setTargets] = useState({ sets: '', reps: '', load_value: '' });

  useEffect(() => {
    if (!exercise) return undefined;
    let cancelled = false;
    const cached = readCachedSwapOptions(logId)[exercise.id];
    const fallback = cached || { backups: exercise.backups || [], suggestions: [], offline_copy: true };
    if (!online) {
      setOptions(fallback);
      setLoadNote(cached ? 'Offline: showing the choices saved on this phone.' : 'Offline: only your coach\'s planned backups are available.');
      return undefined;
    }
    api.get(`/workout-logs/${logId}/exercises/${exercise.id}/substitution-options`, { params: equipment ? { equipment } : {} })
      .then(({ data }) => { if (!cancelled) { setOptions(data); setLoadNote(''); } })
      .catch(() => { if (!cancelled) { setOptions(fallback); setLoadNote('Could not reach the server; showing saved choices.'); } });
    return () => { cancelled = true; };
  }, [exercise, logId, online, equipment]);

  if (!exercise) return null;
  const pick = (kind, item) => {
    setChoice({ kind, item });
    // Only a coach backup carries targets; a suggestion never copies numbers.
    const t = kind === 'backup' ? item.targets || {} : {};
    setTargets({ sets: t.sets ?? '', reps: t.reps ?? '', load_value: t.load_value ?? '' });
  };
  const backups = options?.backups || [];
  const suggestions = options?.suggestions || [];
  const confirmLabel = !choice ? 'Choose an option'
    : choice.kind === 'backup' ? 'Use this backup'
      : online ? 'Ask my coach to approve' : 'Use it now · my coach will review';

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto" data-testid="swap-dialog">
        <DialogHeader>
          <DialogTitle>Can&apos;t do {exercise.exercise_name}?</DialogTitle>
          <DialogDescription>
            This changes this workout only. Your planned exercise stays in your plan and your coach is told.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-muted-foreground">Why?</legend>
            <div className="flex flex-wrap gap-2">
              {TRIGGERS.map(([value, label]) => (
                <Button key={value} type="button" size="sm" variant={trigger === value ? 'default' : 'outline'} className="min-h-11"
                  onClick={() => setTrigger(value)} aria-pressed={trigger === value} data-testid={`swap-trigger-${value}`}>{label}</Button>
              ))}
            </div>
            <Input className="min-h-11" maxLength={200} value={reason} placeholder="Optional detail for your coach" onChange={(event) => setReason(event.target.value)} data-testid="swap-reason" />
          </fieldset>
          {loadNote && <p className="text-xs text-muted-foreground" data-testid="swap-options-note">{loadNote}</p>}
          <section className="space-y-2" data-testid="swap-backups">
            <h3 className="flex items-center gap-1.5 font-semibold"><CheckCircle2 className="h-4 w-4 text-success" aria-hidden /> Coach-approved backup</h3>
            {backups.length ? backups.map((backup) => (
              <button key={backup.id} type="button" onClick={() => pick('backup', backup)} data-testid={`swap-backup-${backup.name}`}
                className={cn('w-full rounded-lg border p-3 text-left', choice?.item === backup ? 'border-primary bg-primary/10' : 'border-border')}>
                <span className="block font-medium">{backup.name}</span>
                <span className="block text-xs text-muted-foreground">{targetsText(backup.targets)}</span>
                {backup.client_note && <span className="block text-xs">From your coach: {backup.client_note}</span>}
              </button>
            )) : <p className="text-xs text-muted-foreground">Your coach has not planned a backup for this exercise.</p>}
          </section>
          <section className="space-y-2" data-testid="swap-suggestions">
            <h3 className="flex items-center gap-1.5 font-semibold"><Lightbulb className="h-4 w-4 text-gold" aria-hidden /> Suggestions · not approved by your coach</h3>
            {online && (
              <Input className="min-h-11" value={equipment} placeholder="Equipment you have (e.g. Bodyweight, Dumbbells)"
                onChange={(event) => setEquipment(event.target.value)} aria-label="Equipment you have" data-testid="swap-equipment" />
            )}
            {suggestions.length ? suggestions.map((item) => (
              <button key={item.id} type="button" onClick={() => pick('suggestion', item)} data-testid={`swap-suggestion-${item.name}`}
                className={cn('w-full rounded-lg border p-3 text-left', choice?.item === item ? 'border-primary bg-primary/10' : 'border-dashed border-border')}>
                <span className="block font-medium">{item.name}</span>
                <span className="block text-xs text-muted-foreground">{item.rationale.join(' · ')}</span>
              </button>
            )) : <p className="text-xs text-muted-foreground">{options?.catalog_reason || 'No suggestions here.'}</p>}
            <p className="text-xs text-muted-foreground">Suggestions match by muscle, category or equipment only. They are not equivalent exercises and not medical advice.</p>
          </section>
          {!backups.length && !suggestions.length && options && (
            <p className="rounded-md border border-border p-3 text-xs" data-testid="swap-no-option">
              No approved swap here. You can do the exercise as planned, skip it, or tell your coach in your workout notes.
            </p>
          )}
          {choice && (
            <fieldset className="space-y-2" data-testid="swap-targets">
              <legend className="text-xs font-medium text-muted-foreground">
                What you will do for {choice.item.name}. {choice.kind === 'backup' ? 'From your coach; change if needed.' : 'Leave blank if unsure; nothing is copied from the original.'}
              </legend>
              <div className="grid grid-cols-3 gap-2">
                <Input className="min-h-11" inputMode="numeric" placeholder="Sets" value={targets.sets} onChange={(event) => setTargets((row) => ({ ...row, sets: event.target.value }))} aria-label="Substitute sets" data-testid="swap-target-sets" />
                <Input className="min-h-11" placeholder="Reps" value={targets.reps} onChange={(event) => setTargets((row) => ({ ...row, reps: event.target.value }))} aria-label="Substitute reps" data-testid="swap-target-reps" />
                <Input className="min-h-11" inputMode="decimal" placeholder="Load lb" value={targets.load_value} onChange={(event) => setTargets((row) => ({ ...row, load_value: event.target.value }))} aria-label="Substitute load" data-testid="swap-target-load" />
              </div>
            </fieldset>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!choice} onClick={() => onConfirm({ ...choice, trigger, reason, targets })} data-testid="swap-confirm">{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
