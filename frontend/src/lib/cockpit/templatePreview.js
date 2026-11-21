// Template change preview, client by client (Q2 default: preview only; the
// coach confirms each client). A draft edit of a program template is compared
// with every assigned client's EFFECTIVE prescription (template + that
// client's coach overrides). Overrides always win and are shown as kept.
// Confirming records a receipt bound to a fingerprint of exactly what that
// client would get; any later edit changes the fingerprint and the receipt
// becomes stale, so nothing is ever confirmed for a preview the coach did not
// see. No program is changed: there is no general template-propagation
// endpoint, and TEMPLATE_APPLY_MODE is 'preview_only'.

import { COCKPIT_COACH_UNDO_MS, TEMPLATE_APPLY_MODE } from './config.js';

export const TEMPLATE_FIELDS = Object.freeze(['name', 'sets', 'reps', 'load']);

// Fictional fixture for the replay cockpit.
export const TEMPLATE_FIXTURE = Object.freeze({
  id: 'tpl_strength_b',
  name: 'Strength Block B',
  label: 'Week 3 · Day 1',
  revision: 7,
  exercises: Object.freeze([
    Object.freeze({ id: 'tx_squat', name: 'Back squat', sets: 4, reps: '5', load: Object.freeze({ value: 80, unit: 'kg' }) }),
    Object.freeze({ id: 'tx_rdl', name: 'Romanian deadlift', sets: 3, reps: '8', load: Object.freeze({ value: 60, unit: 'kg' }) }),
    Object.freeze({ id: 'tx_row', name: 'Cable row', sets: 3, reps: '10', load: Object.freeze({ value: 35, unit: 'kg' }) }),
    Object.freeze({ id: 'tx_carry', name: 'Farmer carry', sets: 3, reps: '30 m', load: Object.freeze({ value: 24, unit: 'kg' }) }),
  ]),
});

export const TEMPLATE_ASSIGNMENTS = Object.freeze([
  { clientId: 'client_juno', name: 'Juno Park', status: 'active', inSessionNow: true, overrides: {} },
  { clientId: 'client_ezra', name: 'Ezra Lind', status: 'active', overrides: { tx_squat: { load: { value: 70, unit: 'kg' }, reason: 'Lighter squat while the back settles' } } },
  { clientId: 'client_noor', name: 'Noor Abadi', status: 'paused', pausedReason: 'Program paused by the coach', overrides: {} },
  { clientId: 'client_pell', name: 'Pell Rios', status: 'active', overrides: { tx_rdl: { name: 'Hip thrust', reason: 'Coach swap for the hamstring' } } },
  { clientId: 'client_quinn', name: 'Quinn Adair', status: 'active', overrides: {} },
  { clientId: 'client_sol', name: 'Sol Varga', status: 'active', overrides: { tx_carry: { load: { value: 16, unit: 'kg' }, reason: 'Grip limit' } } },
].map((row) => Object.freeze(row)));

export function loadText(load) {
  return load && load.value != null ? `${load.value} ${load.unit || 'kg'}` : 'No load';
}

export function prescriptionText(item) {
  if (!item) return 'Removed';
  return `${item.sets} × ${item.reps} · ${loadText(item.load)}`;
}

function sameLoad(a, b) {
  return (a?.value ?? null) === (b?.value ?? null) && (a?.unit ?? null) === (b?.unit ?? null);
}

function sameField(field, a, b) {
  return field === 'load' ? sameLoad(a, b) : String(a ?? '') === String(b ?? '');
}

// 32-bit FNV-1a over a canonical JSON string: stable across reloads.
export function fingerprint(value) {
  const text = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function createDraft(template) {
  return { baseRevision: template.revision, exercises: template.exercises.map((row) => ({ ...row, load: row.load ? { ...row.load } : null })) };
}

export function editDraft(draft, exerciseId, field, value) {
  if (!TEMPLATE_FIELDS.includes(field)) return draft;
  return {
    ...draft,
    exercises: draft.exercises.map((row) => {
      if (row.id !== exerciseId) return row;
      if (field === 'sets') {
        const sets = Number.parseInt(value, 10);
        return { ...row, sets: Number.isFinite(sets) ? Math.max(1, Math.min(10, sets)) : row.sets };
      }
      if (field === 'load') {
        const number = value === '' || value == null ? null : Number(value);
        return { ...row, load: number == null || !Number.isFinite(number) || number < 0 ? null : { value: Math.round(number * 10) / 10, unit: row.load?.unit || 'kg' } };
      }
      return { ...row, [field]: String(value ?? '').slice(0, 60) };
    }),
  };
}

export function draftChanges(template, draft) {
  const changes = [];
  for (const before of template.exercises) {
    const after = draft.exercises.find((row) => row.id === before.id);
    for (const field of TEMPLATE_FIELDS) if (!sameField(field, before[field], after?.[field])) changes.push({ exerciseId: before.id, field });
  }
  return changes;
}

function effective(exercise, override) {
  if (!exercise) return null;
  const result = { ...exercise };
  for (const field of TEMPLATE_FIELDS) if (override && Object.hasOwn(override, field)) result[field] = override[field];
  return result;
}

// The preview for one client: per exercise, what they have now and what they
// would have after the draft, with kept overrides called out.
export function previewForClient(template, draft, assignment) {
  const items = template.exercises.map((before) => {
    const override = assignment.overrides?.[before.id] || null;
    const after = draft.exercises.find((row) => row.id === before.id);
    const now = effective(before, override);
    const next = effective(after, override);
    const templateChanged = TEMPLATE_FIELDS.filter((field) => !sameField(field, before[field], after?.[field]));
    const keptOverride = templateChanged.filter((field) => override && Object.hasOwn(override, field));
    const changedFields = TEMPLATE_FIELDS.filter((field) => !sameField(field, now?.[field], next?.[field]));
    return {
      exerciseId: before.id,
      now,
      next,
      changedFields,
      keptOverride: keptOverride.length ? { fields: keptOverride, reason: override.reason || 'Coach override' } : null,
      effect: changedFields.length ? 'changes' : keptOverride.length ? 'kept_override' : 'unchanged',
    };
  });
  const changeCount = items.filter((item) => item.effect === 'changes').length;
  const warnings = [];
  if (assignment.status === 'paused') warnings.push(assignment.pausedReason ? `${assignment.pausedReason}. Receives nothing while paused.` : 'Paused. Receives nothing while paused.');
  if (assignment.inSessionNow) warnings.push('In a session now. A confirmed change would start after today’s session; logged sets never change.');
  return {
    clientId: assignment.clientId,
    name: assignment.name,
    status: assignment.status,
    items,
    changeCount,
    warnings,
    confirmable: assignment.status !== 'paused' && changeCount > 0,
    fingerprint: fingerprint({ template: template.id, baseRevision: draft.baseRevision, client: assignment.clientId, next: items.map((item) => item.next) }),
  };
}

export function previewAll(template, draft, assignments) {
  return assignments.map((assignment) => previewForClient(template, draft, assignment));
}

// receipts: { [clientId]: { fingerprint, confirmedAtMs, undoUntilMs } }
// With nowMs, a confirmation whose ten-second Undo window has closed reads as
// 'applied' (in the fictional replay this applies to the fictional copy
// only; the live cockpit applies on the server, see LiveTemplatePanel).
export function clientDecision(preview, receipts, nowMs) {
  if (preview.status === 'paused') return 'paused';
  if (!preview.changeCount) return 'no_effect';
  const receipt = receipts[preview.clientId];
  if (!receipt) return 'needs_confirm';
  if (receipt.fingerprint !== preview.fingerprint) return 'stale';
  return nowMs != null && nowMs >= receipt.undoUntilMs ? 'applied' : 'confirmed';
}

export function confirmClient(receipts, preview, nowMs) {
  if (!preview.confirmable) return receipts;
  return { ...receipts, [preview.clientId]: { fingerprint: preview.fingerprint, confirmedAtMs: nowMs, undoUntilMs: nowMs + COCKPIT_COACH_UNDO_MS, mode: TEMPLATE_APPLY_MODE } };
}

export function canUndoConfirm(receipts, clientId, nowMs) {
  const receipt = receipts[clientId];
  return Boolean(receipt && nowMs < receipt.undoUntilMs);
}

export function undoConfirm(receipts, clientId, nowMs) {
  if (!canUndoConfirm(receipts, clientId, nowMs)) return receipts;
  const next = { ...receipts };
  delete next[clientId];
  return next;
}

export function decisionSummary(previews, receipts, nowMs) {
  const counts = { confirmed: 0, needs_confirm: 0, stale: 0, no_effect: 0, paused: 0 };
  for (const preview of previews) {
    const decision = clientDecision(preview, receipts, nowMs);
    counts[decision === 'applied' ? 'confirmed' : decision] += 1;
  }
  return counts;
}
