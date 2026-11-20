import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, RotateCcw, ShieldCheck, Undo2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { COCKPIT_RECEIPTS_PREFIX } from '@/lib/cockpit/config';
import {
  TEMPLATE_ASSIGNMENTS, TEMPLATE_FIXTURE, canUndoConfirm, clientDecision, confirmClient, createDraft, decisionSummary,
  draftChanges, editDraft, loadText, prescriptionText, previewAll, undoConfirm,
} from '@/lib/cockpit/templatePreview';
import { ATTN } from './CockpitBoard';

const DECISION_LABELS = {
  applied: 'Applied (fictional copy)', confirmed: 'Confirmed: Undo open', needs_confirm: 'Needs your confirmation', stale: 'Changed since you confirmed: review again', no_effect: 'No effect', paused: 'Paused: not receiving',
};
const DECISION_STYLES = {
  applied: 'bg-success/15 text-success', confirmed: 'bg-success/15 text-success', needs_confirm: ATTN.solid, stale: cn('border', ATTN.border, ATTN.text), no_effect: 'bg-muted text-muted-foreground', paused: 'bg-muted text-muted-foreground',
};
const FIELDS = [['name', 'Exercise'], ['sets', 'Sets'], ['reps', 'Reps'], ['load', 'Load (kg)']];

function readReceipts(key) {
  try { const parsed = JSON.parse(localStorage.getItem(key) || '{}'); return parsed && typeof parsed === 'object' ? parsed : {}; } catch { return {}; }
}
function writeReceipts(key, receipts) {
  try { localStorage.setItem(key, JSON.stringify(receipts)); return true; } catch { return false; }
}

// Fictional replay only (the preview demo layer). The live cockpit applies
// confirmed changes on the server (LiveTemplatePanel). Here a confirmation
// applies to the fictional client's copy after its ten-second Undo window.
export default function TemplatePreviewPanel({ scope }) {
  const template = TEMPLATE_FIXTURE;
  const storageKey = `${COCKPIT_RECEIPTS_PREFIX}${scope}`;
  const [draft, setDraft] = useState(() => createDraft(template));
  const [receipts, setReceipts] = useState(() => readReceipts(storageKey));
  const [saveError, setSaveError] = useState('');
  const [nowMs, setNowMs] = useState(() => Date.now());
  const previews = useMemo(() => previewAll(template, draft, TEMPLATE_ASSIGNMENTS), [template, draft]);
  const changes = useMemo(() => draftChanges(template, draft), [template, draft]);
  const summary = decisionSummary(previews, receipts, nowMs);
  const undoOpen = Object.keys(receipts).some((clientId) => canUndoConfirm(receipts, clientId, nowMs));

  useEffect(() => {
    if (!undoOpen) return undefined;
    const timer = window.setInterval(() => setNowMs(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [undoOpen]);

  // A decision is shown only once it is stored, so a failed write never
  // reads as confirmed.
  const commit = (next) => {
    if (!writeReceipts(storageKey, next)) { setSaveError('This device could not save that decision. Nothing changed; try again.'); return; }
    setSaveError('');
    setReceipts(next);
  };
  const edit = (exerciseId, field, value) => setDraft((current) => editDraft(current, exerciseId, field, value));
  const confirm = (preview) => { const now = Date.now(); setNowMs(now); commit(confirmClient(receipts, preview, now)); };
  const undo = (clientId) => commit(undoConfirm(receipts, clientId, Date.now()));

  return (
    <div className="grid gap-4 xl:grid-cols-2" data-testid="cockpit-template">
      <section aria-labelledby="template-draft-title" className="min-w-0 space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 id="template-draft-title" className="font-display text-2xl font-semibold">{template.name}</h2>
            <p className="text-sm text-muted-foreground">{template.label} · revision {template.revision} · draft, not saved</p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => setDraft(createDraft(template))} disabled={!changes.length} data-testid="template-reset"><RotateCcw aria-hidden /> Reset draft</Button>
        </div>
        <p className="flex items-start gap-2 rounded-lg border border-primary/40 bg-primary/10 p-3 text-sm" data-testid="template-preview-only">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          Fictional replay. Nothing changes until you confirm a client; each confirmation keeps that client’s own overrides and applies after a ten-second Undo. Live mode applies the same rule to real program copies on the server.
        </p>
        <div className="space-y-2" role="table" aria-label="Template exercises (draft)">
          <div role="row" className="grid grid-cols-[minmax(0,1fr)_4rem_5rem_5rem] gap-2 text-xs uppercase tracking-wide text-muted-foreground">
            {FIELDS.map(([, label]) => <span key={label} role="columnheader">{label}</span>)}
          </div>
          {draft.exercises.map((exercise) => {
            const original = template.exercises.find((row) => row.id === exercise.id);
            return (
              <div key={exercise.id} role="row" className="grid grid-cols-[minmax(0,1fr)_4rem_5rem_5rem] gap-2">
                {FIELDS.map(([field, label]) => {
                  const id = `template-${exercise.id}-${field}`;
                  const value = field === 'load' ? (exercise.load?.value ?? '') : exercise[field];
                  const changed = field === 'load' ? (original.load?.value ?? null) !== (exercise.load?.value ?? null) : String(original[field]) !== String(exercise[field]);
                  return (
                    <div key={field} role="cell" className="min-w-0">
                      <label htmlFor={id} className="sr-only">{label} for {original.name}</label>
                      <Input id={id} value={value} inputMode={field === 'sets' || field === 'load' ? 'decimal' : undefined}
                        onChange={(event) => edit(exercise.id, field, event.target.value)}
                        className={cn('h-10 w-full min-w-0', changed && cn(ATTN.border, 'border-2'))} data-testid={id} />
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        <p className="text-sm text-muted-foreground" data-testid="template-change-count">{changes.length ? `${changes.length} change${changes.length === 1 ? '' : 's'} in the draft.` : 'Edit a value to preview its effect on each client.'}</p>
        {saveError ? <p role="alert" className="text-sm text-destructive" data-testid="template-save-error">{saveError}</p> : null}
      </section>

      <section aria-labelledby="template-clients-title" className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="template-clients-title" className="font-display text-2xl font-semibold">Client by client</h2>
          <p className="text-sm text-muted-foreground" data-testid="template-summary">
            {summary.confirmed} confirmed · {summary.needs_confirm} to confirm · {summary.stale} to review again · {summary.no_effect} no effect · {summary.paused} paused
          </p>
        </div>
        <ul className="space-y-2">
          {previews.map((preview) => {
            const decision = clientDecision(preview, receipts, nowMs);
            const shown = preview.items.filter((item) => item.effect !== 'unchanged');
            return (
              <li key={preview.clientId} className="min-w-0 rounded-xl border border-border bg-card p-3" data-testid={`template-client-${preview.clientId}`} data-decision={decision === 'applied' ? 'confirmed' : decision} data-applied={decision === 'applied' ? 'true' : 'false'}>
                <div className="flex items-start justify-between gap-2">
                  <p className="font-display text-xl font-semibold">{preview.name}</p>
                  <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold', DECISION_STYLES[decision])}>{DECISION_LABELS[decision]}</span>
                </div>
                {preview.warnings.map((warning) => <p key={warning} className={cn('mt-1 flex items-start gap-1.5 text-sm', ATTN.text)}><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{warning}</p>)}
                {shown.length ? (
                  <ul className="mt-2 space-y-1 text-sm">
                    {shown.map((item) => (
                      <li key={item.exerciseId} className="rounded-lg bg-background/50 px-2 py-1.5">
                        <span className="font-medium">{item.now?.name}</span>
                        {item.effect === 'changes' ? (
                          <span className="block text-muted-foreground"><span className="line-through">{prescriptionText(item.now)}</span> → <span className="text-foreground">{item.next?.name !== item.now?.name ? `${item.next?.name} · ` : ''}{prescriptionText(item.next)}</span></span>
                        ) : null}
                        {item.keptOverride ? <span className="block text-xs text-primary">Keeps the coach override ({item.keptOverride.fields.map((field) => (field === 'load' ? loadText(item.now.load) : `${field} ${item.now[field]}`)).join(', ')}): {item.keptOverride.reason}</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : <p className="mt-2 text-sm text-muted-foreground">No change for this client.</p>}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {decision === 'confirmed' && canUndoConfirm(receipts, preview.clientId, nowMs) ? (
                    <Button type="button" size="sm" variant="outline" onClick={() => undo(preview.clientId)} data-testid={`template-undo-${preview.clientId}`}><Undo2 aria-hidden /> Undo ({Math.ceil((receipts[preview.clientId].undoUntilMs - nowMs) / 1000)} s)</Button>
                  ) : null}
                  {decision === 'needs_confirm' || decision === 'stale' ? (
                    <Button type="button" size="sm" onClick={() => confirm(preview)} disabled={!preview.confirmable} data-testid={`template-confirm-${preview.clientId}`}><Check aria-hidden /> Confirm for {preview.name.split(' ')[0]}</Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
