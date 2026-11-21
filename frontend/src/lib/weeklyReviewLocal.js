// Pure validation, state and durable-store adapter for the local weekly
// review. localStorage is the sole durable boundary: nothing here calls the
// API, changes a program or sends anything. Each review scope owns one envelope
// under WEEKLY_REVIEW_KEY_PREFIX, and no other key is ever read or written.
// No '@/' imports: Node unit tests load this file directly.

import { isCalendarDate } from './outsideActivities.js';
import { validReviewContext } from './weeklyReviewContext.js';
const SCOPE_VERSION = 2;

export const WEEKLY_REVIEW_KEY_PREFIX = 'cvf_weekly_review_local:v2:';
export const WEEKLY_REVIEW_LIMITS = Object.freeze({ adjustmentChars: 2000, rationaleChars: 1000 });

const ENVELOPE_SCHEMA = 'cvf_weekly_review';
const ENVELOPE_VERSION = 1;

const FAILURE_MESSAGES = {
  unavailable: 'Browser storage is unavailable, so this local review cannot save anything.',
  corrupt: 'Saved local review data for this week could not be read. Nothing was changed. Reset this review to start again.',
  unsupported: 'Saved local review data for this week uses an unsupported format. Nothing was changed. Reset this review to start again.',
  write_failed: 'Browser storage refused the write, and it may be full. This was not saved.',
  write_unverified: 'The write could not be read back, so it is not treated as saved.',
  invalid_draft: 'Fix the highlighted fields first.',
  invalid_context: 'This week could not be frozen into a proposal.',
  proposal_frozen: 'This proposal is frozen. Edit it to start a new draft.',
  acknowledgement_required: 'Tick the acknowledgement before confirming.',
  revision_mismatch: 'This proposal changed, so it was not confirmed.',
  reset_failed: 'This review could not be reset.',
  access_denied: 'This client week is no longer available. Nothing was confirmed.',
};

const countChars = (text) => Array.from(text).length;
const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0;
const clone = (value) => JSON.parse(JSON.stringify(value));

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function fail(code, extra = {}) {
  return { ok: false, code, message: FAILURE_MESSAGES[code], ...extra };
}

function defaultNewId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** `(scopeVersion, actorId, caseId, weekStart)` as one delimiter-safe string. */
export function reviewScope({ actorId, caseId, weekStart }) {
  if (!isNonEmptyString(actorId) || !isNonEmptyString(caseId) || !isCalendarDate(weekStart)) {
    throw new TypeError('A review scope needs an actor, a case and a calendar week start.');
  }
  return [SCOPE_VERSION, encodeURIComponent(actorId), encodeURIComponent(caseId), weekStart].join('|');
}

export function parseReviewScope(scope) {
  if (typeof scope !== 'string') return null;
  const parts = scope.split('|');
  if (parts.length !== 4 || parts[0] !== String(SCOPE_VERSION)) return null;
  try {
    const parsed = { actorId: decodeURIComponent(parts[1]), caseId: decodeURIComponent(parts[2]), weekStart: parts[3] };
    return reviewScope(parsed) === scope ? parsed : null;
  } catch {
    return null;
  }
}

export function reviewStorageKey(scope) {
  return `${WEEKLY_REVIEW_KEY_PREFIX}${scope}`;
}

/** Required, trimmed text. `value` is the exact text a proposal would freeze. */
export function validateDraft({ adjustment, rationale } = {}) {
  const value = {
    adjustment: typeof adjustment === 'string' ? adjustment.trim() : '',
    rationale: typeof rationale === 'string' ? rationale.trim() : '',
  };
  const errors = {};
  if (!value.adjustment) errors.adjustment = 'Enter a proposed adjustment.';
  else if (countChars(value.adjustment) > WEEKLY_REVIEW_LIMITS.adjustmentChars) errors.adjustment = 'Adjustment must be 2,000 characters or fewer.';
  if (!value.rationale) errors.rationale = 'Enter a rationale.';
  else if (countChars(value.rationale) > WEEKLY_REVIEW_LIMITS.rationaleChars) errors.rationale = 'Rationale must be 1,000 characters or fewer.';
  return { valid: Object.keys(errors).length === 0, errors, value };
}

// An unfinished draft may be blank, but it can never outgrow the proposal limits.
function draftOverflowErrors(draft) {
  const { errors } = validateDraft(draft);
  return Object.fromEntries(Object.entries(errors).filter(([, message]) => message.includes('or fewer')));
}

function sameFixtureValue(actual, expected) {
  if (actual === expected) return true;
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && actual.length === expected.length
      && expected.every((value, index) => sameFixtureValue(actual[index], value));
  }
  if (!isPlainObject(expected) || !isPlainObject(actual)) return false;
  return Object.keys(actual).length === Object.keys(expected).length
    && Object.keys(expected).every((key) => Object.hasOwn(actual, key) && sameFixtureValue(actual[key], expected[key]));
}

function isValidContext(context, scopeParts) {
  return validReviewContext(context, scopeParts);
}

function isValidFrozenText(record) {
  const { valid, value } = validateDraft(record);
  return valid && value.adjustment === record.adjustment && value.rationale === record.rationale;
}

function isValidProposal(proposal, scopeParts) {
  return isPlainObject(proposal)
    && isNonEmptyString(proposal.revisionId)
    && isNonEmptyString(proposal.requestId)
    && isNonEmptyString(proposal.proposedAt)
    && isValidFrozenText(proposal)
    && isValidContext(proposal.context, scopeParts);
}

function isValidReceipt(receipt, scope, scopeParts) {
  return isValidProposal(receipt, scopeParts)
    && receipt.scope === scope
    && isNonEmptyString(receipt.receiptId)
    && isNonEmptyString(receipt.confirmedAt);
}

function isValidDraft(draft) {
  return draft === null || (isPlainObject(draft)
    && typeof draft.adjustment === 'string'
    && typeof draft.rationale === 'string'
    && isNonEmptyString(draft.updatedAt)
    && (draft.baseRevisionId === null || isNonEmptyString(draft.baseRevisionId))
    && Object.keys(draftOverflowErrors(draft)).length === 0);
}

function isValidConfirming(confirming, proposal) {
  return confirming === null || (isPlainObject(confirming)
    && proposal !== null
    && confirming.revisionId === proposal.revisionId
    && confirming.requestId === proposal.requestId
    && isNonEmptyString(confirming.startedAt));
}

function isValidEnvelope(envelope, scope, scopeParts) {
  if (!isPlainObject(envelope) || envelope.scope !== scope) return false;
  if (!isValidDraft(envelope.draft)) return false;
  if (envelope.proposal !== null && !isValidProposal(envelope.proposal, scopeParts)) return false;
  if (!isValidConfirming(envelope.confirming, envelope.proposal)) return false;
  if (!Array.isArray(envelope.receipts)) return false;
  if (!envelope.receipts.every((receipt) => isValidReceipt(receipt, scope, scopeParts))) return false;
  const activeReceipt = envelope.proposal && envelope.receipts.find((receipt) => receipt.revisionId === envelope.proposal.revisionId);
  if (activeReceipt && !['revisionId', 'requestId', 'adjustment', 'rationale', 'context', 'proposedAt']
    .every((field) => sameFixtureValue(activeReceipt[field], envelope.proposal[field]))) return false;
  return new Set(envelope.receipts.map((receipt) => receipt.revisionId)).size === envelope.receipts.length;
}

function emptyEnvelope(scope) {
  return { schema: ENVELOPE_SCHEMA, version: ENVELOPE_VERSION, scope, draft: null, proposal: null, confirming: null, receipts: [] };
}

function toState(envelope) {
  const { draft, proposal, receipts } = envelope;
  const receipt = proposal ? receipts.find((entry) => entry.revisionId === proposal.revisionId) ?? null : null;
  let status = 'draft';
  if (proposal) status = receipt ? 'confirmed' : 'proposed';
  // A marker without a receipt is an unknown outcome: report it as unconfirmed.
  const interrupted = status === 'proposed' && envelope.confirming !== null;
  return deepFreeze(clone({ status, draft, proposal, receipt, receipts, interrupted }));
}

/**
 * Durable store for one review scope. Every method resolves to `{ ok: true, state }`
 * or `{ ok: false, code, message }` and never reports success before the write
 * reads back. Calls on one store run in order, so overlapping saves cannot lose
 * each other's work. `commitYield` runs between the pending marker and the
 * receipt write: the page uses it to paint "Confirming…", and tests may gate it.
 * `storage` follows the Web Storage shape; tests may inject promise-returning
 * methods. The store only ever awaits them.
 */
export function createReviewStore({
  storage,
  scope,
  now = () => new Date().toISOString(),
  newId = defaultNewId,
  commitYield = () => undefined,
  authorize = () => true,
  isCurrent = () => true,
}) {
  const scopeParts = parseReviewScope(scope);
  if (!scopeParts) throw new TypeError('createReviewStore needs a scope from reviewScope().');
  const key = reviewStorageKey(scope);
  let tail = Promise.resolve();

  function inOrder(task) {
    const result = tail.then(async () => {
      if (!isCurrent() || !(await authorize()) || !isCurrent()) return fail('access_denied');
      return task();
    });
    tail = result.catch(() => undefined);
    return result;
  }

  async function read() {
    if (!storage) return fail('unavailable');
    let raw;
    try {
      raw = await storage.getItem(key);
    } catch {
      return fail('unavailable');
    }
    if (raw === null || raw === undefined) return { ok: true, envelope: emptyEnvelope(scope) };
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return fail('corrupt');
    }
    if (!isPlainObject(parsed) || parsed.schema !== ENVELOPE_SCHEMA) return fail('corrupt');
    if (parsed.version !== ENVELOPE_VERSION) return fail('unsupported');
    if (!isValidEnvelope(parsed, scope, scopeParts)) return fail('corrupt');
    return { ok: true, envelope: parsed };
  }

  async function write(envelope) {
    if (!isCurrent()) return fail('access_denied');
    if (!storage) return fail('unavailable');
    const text = JSON.stringify(envelope);
    try {
      await storage.setItem(key, text);
    } catch {
      return fail('write_failed');
    }
    try {
      if ((await storage.getItem(key)) !== text) return fail('write_unverified');
    } catch {
      return fail('write_unverified');
    }
    return { ok: true };
  }

  async function commit(envelope, extra = {}) {
    const written = await write(envelope);
    return written.ok ? { ok: true, state: toState(envelope), ...extra } : written;
  }

  function load() {
    return inOrder(async () => {
      const current = await read();
      return current.ok ? { ok: true, state: toState(current.envelope) } : current;
    });
  }

  function saveDraft({ adjustment = '', rationale = '' } = {}) {
    return inOrder(async () => {
      if (typeof adjustment !== 'string' || typeof rationale !== 'string') return fail('invalid_draft', { errors: {} });
      const errors = draftOverflowErrors({ adjustment, rationale });
      if (Object.keys(errors).length) return fail('invalid_draft', { errors });
      const current = await read();
      if (!current.ok) return current;
      if (current.envelope.proposal) return fail('proposal_frozen');
      const baseRevisionId = current.envelope.draft?.baseRevisionId ?? null;
      return commit({ ...current.envelope, draft: { adjustment, rationale, baseRevisionId, updatedAt: now() } });
    });
  }

  function propose({ adjustment, rationale, context } = {}) {
    return inOrder(async () => {
      const { valid, errors, value } = validateDraft({ adjustment, rationale });
      if (!valid) return fail('invalid_draft', { errors });
      if (!isValidContext(context, scopeParts)) return fail('invalid_context');
      const current = await read();
      if (!current.ok) return current;
      if (current.envelope.proposal) return fail('proposal_frozen');
      const proposal = {
        revisionId: newId(),
        requestId: newId(),
        adjustment: value.adjustment,
        rationale: value.rationale,
        context: clone(context),
        proposedAt: now(),
      };
      return commit({ ...current.envelope, draft: null, proposal, confirming: null });
    });
  }

  /** The frozen text becomes a new draft. Earlier receipts are never touched. */
  function edit() {
    return inOrder(async () => {
      const current = await read();
      if (!current.ok) return current;
      const { proposal } = current.envelope;
      if (!proposal) return { ok: true, state: toState(current.envelope) };
      const draft = {
        adjustment: proposal.adjustment,
        rationale: proposal.rationale,
        baseRevisionId: proposal.revisionId,
        updatedAt: now(),
      };
      return commit({ ...current.envelope, draft, proposal: null, confirming: null });
    });
  }

  function confirm({ revisionId, acknowledged } = {}) {
    return inOrder(async () => {
      if (acknowledged !== true) return fail('acknowledgement_required');

      const before = await read();
      if (!before.ok) return before;
      const replay = before.envelope.receipts.find((entry) => entry.revisionId === revisionId);
      if (replay) return { ok: true, state: toState(before.envelope), receipt: deepFreeze(clone(replay)), replayed: true };
      const { proposal } = before.envelope;
      if (!proposal || proposal.revisionId !== revisionId) return fail('revision_mismatch');

      const confirming = { revisionId, requestId: proposal.requestId, startedAt: now() };
      const marked = await write({ ...before.envelope, confirming });
      if (!marked.ok) return marked;

      await commitYield();
      if (!isCurrent() || !(await authorize()) || !isCurrent()) return fail('access_denied');

      // Re-read after the pause: another tab or a reset may have changed this scope.
      const after = await read();
      if (!after.ok) return after;
      const raced = after.envelope.receipts.find((entry) => entry.revisionId === revisionId);
      if (raced) return { ok: true, state: toState(after.envelope), receipt: deepFreeze(clone(raced)), replayed: true };
      if (after.envelope.proposal?.revisionId !== revisionId) return fail('revision_mismatch');

      const frozen = after.envelope.proposal;
      const receipt = { ...frozen, scope, receiptId: `receipt_${frozen.revisionId}`, confirmedAt: now() };
      const envelope = { ...after.envelope, confirming: null, receipts: [...after.envelope.receipts, receipt] };
      return commit(envelope, { receipt: deepFreeze(clone(receipt)), replayed: false });
    });
  }

  /** Removes only this actor/client/week review. Other scopes and receipts are preserved. */
  function reset() {
    return inOrder(async () => {
      if (!storage) return fail('unavailable');
      try {
        await storage.removeItem(key);
        if ((await storage.getItem(key)) !== null) return fail('reset_failed');
      } catch {
        return fail('reset_failed');
      }
      return { ok: true, state: toState(emptyEnvelope(scope)) };
    });
  }

  return { load, saveDraft, propose, edit, confirm, reset };
}
