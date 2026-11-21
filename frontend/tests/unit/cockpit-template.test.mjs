// Coaching cockpit: template change preview, client by client (Q2 default:
// preview only; nothing applies until the coach confirms each client).
import test from 'node:test';
import assert from 'node:assert/strict';
import { COCKPIT_COACH_UNDO_MS, TEMPLATE_APPLY_MODE } from '../../src/lib/cockpit/config.js';
import {
  TEMPLATE_ASSIGNMENTS, TEMPLATE_FIXTURE, canUndoConfirm, clientDecision, confirmClient, createDraft, decisionSummary,
  draftChanges, editDraft, previewAll, previewForClient, undoConfirm,
} from '../../src/lib/cockpit/templatePreview.js';

const byClient = (previews) => Object.fromEntries(previews.map((preview) => [preview.clientId, preview]));

test('an unedited draft changes nobody', () => {
  const draft = createDraft(TEMPLATE_FIXTURE);
  assert.deepEqual(draftChanges(TEMPLATE_FIXTURE, draft), []);
  const summary = decisionSummary(previewAll(TEMPLATE_FIXTURE, draft, TEMPLATE_ASSIGNMENTS), {});
  assert.deepEqual(summary, { confirmed: 0, needs_confirm: 0, stale: 0, no_effect: 5, paused: 1 });
});

test('a template edit previews per client, keeping each coach override', () => {
  const draft = editDraft(createDraft(TEMPLATE_FIXTURE), 'tx_squat', 'load', '85');
  assert.deepEqual(draftChanges(TEMPLATE_FIXTURE, draft), [{ exerciseId: 'tx_squat', field: 'load' }]);
  const previews = byClient(previewAll(TEMPLATE_FIXTURE, draft, TEMPLATE_ASSIGNMENTS));

  const juno = previews.client_juno;
  assert.equal(juno.changeCount, 1);
  assert.equal(juno.items[0].now.load.value, 80);
  assert.equal(juno.items[0].next.load.value, 85);
  assert.ok(juno.warnings.some((warning) => warning.includes('after today’s session')));

  const ezra = previews.client_ezra;
  assert.equal(ezra.items[0].effect, 'kept_override');
  assert.deepEqual(ezra.items[0].keptOverride.fields, ['load']);
  assert.equal(ezra.items[0].next.load.value, 70);
  assert.equal(clientDecision(ezra, {}), 'no_effect');

  assert.equal(clientDecision(previews.client_noor, {}), 'paused');
  assert.equal(previews.client_noor.confirmable, false);
  assert.equal(previews.client_pell.items[1].now.name, 'Hip thrust', 'Pell keeps the coach swap');

  assert.deepEqual(decisionSummary(Object.values(previews), {}), { confirmed: 0, needs_confirm: 4, stale: 0, no_effect: 1, paused: 1 });
  assert.equal(TEMPLATE_FIXTURE.exercises[0].load.value, 80, 'the template itself is untouched');
});

test('confirming is per client, bound to what that client was shown, with a ten-second Undo', () => {
  let draft = editDraft(createDraft(TEMPLATE_FIXTURE), 'tx_squat', 'load', '85');
  let previews = byClient(previewAll(TEMPLATE_FIXTURE, draft, TEMPLATE_ASSIGNMENTS));
  let receipts = confirmClient({}, previews.client_juno, 1_000);
  assert.equal(receipts.client_juno.mode, TEMPLATE_APPLY_MODE);
  assert.equal(clientDecision(previews.client_juno, receipts), 'confirmed');
  assert.equal(clientDecision(previews.client_quinn, receipts), 'needs_confirm', 'other clients are not confirmed by it');

  assert.equal(confirmClient(receipts, previews.client_noor, 1_000), receipts, 'a paused client cannot be confirmed');
  assert.equal(confirmClient(receipts, previews.client_ezra, 1_000), receipts, 'a client with no effect needs no confirmation');

  assert.equal(canUndoConfirm(receipts, 'client_juno', 1_000 + COCKPIT_COACH_UNDO_MS - 1), true);
  assert.equal(canUndoConfirm(receipts, 'client_juno', 1_000 + COCKPIT_COACH_UNDO_MS), false);
  assert.equal(undoConfirm(receipts, 'client_juno', 1_000 + COCKPIT_COACH_UNDO_MS), receipts, 'no Undo after the window');
  assert.deepEqual(undoConfirm(receipts, 'client_juno', 2_000), {});

  draft = editDraft(draft, 'tx_squat', 'sets', '5');
  previews = byClient(previewAll(TEMPLATE_FIXTURE, draft, TEMPLATE_ASSIGNMENTS));
  assert.equal(clientDecision(previews.client_juno, receipts), 'stale', 'a later edit needs a fresh confirmation');
});

test('fingerprints are stable for the same preview and invalid edits are ignored', () => {
  const draft = editDraft(createDraft(TEMPLATE_FIXTURE), 'tx_row', 'reps', '12');
  const assignment = TEMPLATE_ASSIGNMENTS.find((row) => row.clientId === 'client_quinn');
  assert.equal(previewForClient(TEMPLATE_FIXTURE, draft, assignment).fingerprint, previewForClient(TEMPLATE_FIXTURE, draft, assignment).fingerprint);
  assert.notEqual(previewForClient(TEMPLATE_FIXTURE, draft, assignment).fingerprint, previewForClient(TEMPLATE_FIXTURE, createDraft(TEMPLATE_FIXTURE), assignment).fingerprint);
  assert.equal(editDraft(draft, 'tx_row', 'sets', 'abc').exercises[2].sets, 3);
  assert.equal(editDraft(draft, 'tx_row', 'unknown', 'x'), draft);
});
