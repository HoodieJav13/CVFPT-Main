import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WEEKLY_REVIEW_KEY_PREFIX,
  createReviewStore,
  parseReviewScope,
  reviewScope,
  reviewStorageKey,
  validateDraft,
} from '../../src/lib/weeklyReviewLocal.js';
// Adapted from the accepted42-case demo engine suite. Three fixture-catalog
// tests are superseded by strict live DTO tests; reset now preserves other scopes.
function fixtureContext(caseId,weekStart) { return {caseId,caseLabel:'Client',weekStart,pt_status:'available',pt_completed_count:2,activity_collection:'on',outside_partial:false,outside_activities:[{id:'synthetic-activity',occurred_on:weekStart,activity_type:'run',label:'Synthetic run',duration_seconds:null}]}; }

const WEEK = '2026-10-19';
const OTHER_WEEK = '2026-10-26';
const CASE = 'review_demo_a';
const OTHER_CASE = 'review_demo_b';
const SCOPE = reviewScope({ actorId: 'coach_1', caseId: CASE, weekStart: WEEK });
const KEY = reviewStorageKey(SCOPE);
const TEXT = { adjustment: 'Move Thursday lifting to Friday.', rationale: 'Thursday stayed busy this fictional week.' };

class MemoryStorage {
  constructor(entries = {}) {
    this.map = new Map(Object.entries(entries));
    this.failSet = false;
    this.failGet = false;
    this.dropWrites = false;
    this.setCalls = [];
  }

  get length() { return this.map.size; }

  key(index) { return [...this.map.keys()][index] ?? null; }

  getItem(key) {
    if (this.failGet) throw new Error('denied');
    return this.map.has(key) ? this.map.get(key) : null;
  }

  setItem(key, value) {
    this.setCalls.push(key);
    if (this.failSet) throw new Error('QuotaExceededError');
    if (!this.dropWrites) this.map.set(key, String(value));
  }

  removeItem(key) { this.map.delete(key); }
}

function makeStore(overrides = {}) {
  let id = 0;
  const storage = overrides.storage ?? new MemoryStorage();
  const store = createReviewStore({
    storage,
    scope: SCOPE,
    now: () => `2026-10-31T00:00:${String(id).padStart(2, '0')}.000Z`,
    newId: () => { id += 1; return `id_${id}`; },
    ...overrides,
  });
  return { store, storage };
}

async function proposed(overrides) {
  const made = makeStore(overrides);
  const result = await made.store.propose({ ...TEXT, context: fixtureContext(CASE, WEEK) });
  assert.equal(result.ok, true);
  return { ...made, proposal: result.state.proposal };
}

function gate() {
  let open;
  const opened = new Promise((resolve) => { open = resolve; });
  return { opened, open };
}

test('validateDraft rejects empty and whitespace-only text', () => {
  for (const draft of [{}, { adjustment: '', rationale: '' }, { adjustment: '  \n ', rationale: '\t' }]) {
    const result = validateDraft(draft);
    assert.equal(result.valid, false);
    assert.ok(result.errors.adjustment);
    assert.ok(result.errors.rationale);
  }
});

test('validateDraft trims and accepts the exact limits', () => {
  const result = validateDraft({ adjustment: `  ${'a'.repeat(2000)}  `, rationale: ` ${'r'.repeat(1000)}\n` });
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, {});
  assert.equal(result.value.adjustment.length, 2000);
  assert.equal(result.value.rationale.length, 1000);
});

test('validateDraft rejects one character over each limit', () => {
  const result = validateDraft({ adjustment: 'a'.repeat(2001), rationale: 'r'.repeat(1001) });
  assert.equal(result.valid, false);
  assert.match(result.errors.adjustment, /2,000/);
  assert.match(result.errors.rationale, /1,000/);
});

test('validateDraft counts characters, not UTF-16 units', () => {
  assert.equal(validateDraft({ adjustment: '💪'.repeat(2000), rationale: 'ok' }).valid, true);
});

test('reviewScope separates actor, case and week and round-trips awkward ids', () => {
  const scopes = new Set([
    SCOPE,
    reviewScope({ actorId: 'coach_2', caseId: CASE, weekStart: WEEK }),
    reviewScope({ actorId: 'coach_1', caseId: OTHER_CASE, weekStart: WEEK }),
    reviewScope({ actorId: 'coach_1', caseId: CASE, weekStart: OTHER_WEEK }),
  ]);
  assert.equal(scopes.size, 4);
  const awkward = { actorId: 'a|b', caseId: 'c|d', weekStart: WEEK };
  assert.deepEqual(parseReviewScope(reviewScope(awkward)), awkward);
  assert.notEqual(
    reviewScope({ actorId: 'a|b', caseId: 'c', weekStart: WEEK }),
    reviewScope({ actorId: 'a', caseId: 'b|c', weekStart: WEEK }),
  );
  assert.equal(parseReviewScope('1|a|b|2026-10-19'), null);
  assert.throws(() => reviewScope({ actorId: '', caseId: CASE, weekStart: WEEK }), TypeError);
  assert.throws(() => reviewScope({ actorId: 'a', caseId: CASE, weekStart: '2026-02-31' }), TypeError);
});

test('createReviewStore refuses a hand-built scope', () => {
  assert.throws(() => createReviewStore({ storage: new MemoryStorage(), scope: 'nope' }), TypeError);
});

test('an unfinished draft is durable and may be blank', async () => {
  const { store, storage } = makeStore();
  const saved = await store.saveDraft({ adjustment: '  half a thought', rationale: '' });
  assert.equal(saved.ok, true);
  assert.equal(saved.state.status, 'draft');
  const reopened = createReviewStore({ storage, scope: SCOPE });
  const loaded = await reopened.load();
  assert.equal(loaded.state.draft.adjustment, '  half a thought');
});

test('saveDraft refuses overflow without writing', async () => {
  const { store, storage } = makeStore();
  const result = await store.saveDraft({ adjustment: 'a'.repeat(2001), rationale: '' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid_draft');
  assert.ok(result.errors.adjustment);
  assert.equal(storage.setCalls.length, 0);
});

test('propose refuses an invalid draft and a context from another scope', async () => {
  const { store, storage } = makeStore();
  const blank = await store.propose({ adjustment: ' ', rationale: 'why', context: fixtureContext(CASE, WEEK) });
  assert.equal(blank.code, 'invalid_draft');
  const foreign = await store.propose({ ...TEXT, context: fixtureContext(OTHER_CASE, WEEK) });
  assert.equal(foreign.code, 'invalid_context');
  assert.equal(storage.setCalls.length, 0);
});

test('a proposal freezes trimmed text and a detached context without confirming', async () => {
  const { store } = makeStore();
  const context = fixtureContext(CASE, WEEK);
  const result = await store.propose({ adjustment: `  ${TEXT.adjustment} `, rationale: TEXT.rationale, context });
  assert.equal(result.state.status, 'proposed');
  assert.equal(result.state.receipt, null);
  assert.deepEqual(result.state.receipts, []);
  assert.equal(result.state.proposal.adjustment, TEXT.adjustment);
  const expected = JSON.stringify(result.state.proposal.context);
  context.outside_activities[0].label = 'changed after proposing';
  const loaded = await store.load();
  assert.equal(JSON.stringify(loaded.state.proposal.context), expected);
  assert.throws(() => { 'use strict'; result.state.proposal.adjustment = 'changed'; }, TypeError);
  assert.throws(() => { 'use strict'; result.state.proposal.context.outside_activities[0].label = 'changed'; }, TypeError);
});

test('a frozen proposal refuses draft saves and a second proposal', async () => {
  const { store } = await proposed();
  assert.equal((await store.saveDraft(TEXT)).code, 'proposal_frozen');
  assert.equal((await store.propose({ ...TEXT, context: fixtureContext(CASE, WEEK) })).code, 'proposal_frozen');
});

test('confirm requires a strict true acknowledgement', async () => {
  const { store, proposal, storage } = await proposed();
  const writes = storage.setCalls.length;
  for (const acknowledged of [undefined, false, 'true', 1]) {
    const result = await store.confirm({ revisionId: proposal.revisionId, acknowledged });
    assert.equal(result.code, 'acknowledgement_required');
  }
  assert.equal(storage.setCalls.length, writes);
  assert.equal((await store.load()).state.status, 'proposed');
});

test('confirm refuses a revision that is not the frozen proposal', async () => {
  const { store, proposal } = await proposed();
  const result = await store.confirm({ revisionId: `${proposal.revisionId}_other`, acknowledged: true });
  assert.equal(result.code, 'revision_mismatch');
  assert.deepEqual((await store.load()).state.receipts, []);
});

test('a receipt binds the exact frozen proposal to its revision, request and scope', async () => {
  const { store, proposal } = await proposed();
  const { receipt, state } = await store.confirm({ revisionId: proposal.revisionId, acknowledged: true });
  assert.equal(state.status, 'confirmed');
  assert.equal(receipt.revisionId, proposal.revisionId);
  assert.equal(receipt.requestId, proposal.requestId);
  assert.equal(receipt.scope, SCOPE);
  assert.equal(receipt.adjustment, proposal.adjustment);
  assert.equal(receipt.rationale, proposal.rationale);
  assert.deepEqual(receipt.context, proposal.context);
});

test('repeated confirmation returns one stable receipt', async () => {
  const { store, proposal, storage } = await proposed();
  const first = await store.confirm({ revisionId: proposal.revisionId, acknowledged: true });
  const writes = storage.setCalls.length;
  const second = await store.confirm({ revisionId: proposal.revisionId, acknowledged: true });
  assert.equal(second.replayed, true);
  assert.deepEqual(second.receipt, first.receipt);
  assert.equal(storage.setCalls.length, writes);
  assert.equal((await store.load()).state.receipts.length, 1);
});

test('overlapping confirm calls produce one receipt', async () => {
  const { store, proposal } = await proposed();
  const call = () => store.confirm({ revisionId: proposal.revisionId, acknowledged: true });
  const [first, second] = await Promise.all([call(), call()]);
  assert.deepEqual(first.receipt, second.receipt);
  assert.equal((await store.load()).state.receipts.length, 1);
});

test('editing a confirmed proposal starts a new draft and keeps the old receipt byte-equal', async () => {
  const { store, proposal } = await proposed();
  const { receipt } = await store.confirm({ revisionId: proposal.revisionId, acknowledged: true });
  const edited = await store.edit();
  assert.equal(edited.state.status, 'draft');
  assert.equal(edited.state.receipt, null);
  assert.equal(edited.state.draft.adjustment, TEXT.adjustment);
  assert.equal(edited.state.draft.baseRevisionId, proposal.revisionId);
  const saved = await store.saveDraft({ ...TEXT, adjustment: 'A different plan.' });
  assert.equal(saved.state.draft.baseRevisionId, proposal.revisionId);
  const next = await store.propose({ ...TEXT, adjustment: 'A different plan.', context: fixtureContext(CASE, WEEK) });
  assert.notEqual(next.state.proposal.revisionId, proposal.revisionId);
  assert.notEqual(next.state.proposal.requestId, proposal.requestId);
  const second = await store.confirm({ revisionId: next.state.proposal.revisionId, acknowledged: true });
  assert.equal(second.state.receipts.length, 2);
  assert.equal(JSON.stringify(second.state.receipts[0]), JSON.stringify(receipt));
});

test('an old revision still replays its own receipt after a newer draft exists', async () => {
  const { store, proposal } = await proposed();
  const { receipt } = await store.confirm({ revisionId: proposal.revisionId, acknowledged: true });
  await store.edit();
  const replay = await store.confirm({ revisionId: proposal.revisionId, acknowledged: true });
  assert.deepEqual(replay.receipt, receipt);
  assert.equal(replay.state.status, 'draft');
});

test('editing an unconfirmed proposal abandons it and confirm then refuses that revision', async () => {
  const { store, proposal } = await proposed();
  await store.edit();
  assert.equal((await store.confirm({ revisionId: proposal.revisionId, acknowledged: true })).code, 'revision_mismatch');
});

test('actor, case and week scopes never share state', async () => {
  const storage = new MemoryStorage();
  const { store, proposal } = await proposed({ storage });
  await store.confirm({ revisionId: proposal.revisionId, acknowledged: true });
  const neighbours = [
    { actorId: 'coach_2', caseId: CASE, weekStart: WEEK },
    { actorId: 'coach_1', caseId: OTHER_CASE, weekStart: WEEK },
    { actorId: 'coach_1', caseId: CASE, weekStart: OTHER_WEEK },
  ];
  for (const parts of neighbours) {
    const other = createReviewStore({ storage, scope: reviewScope(parts) });
    const { state } = await other.load();
    assert.equal(state.status, 'draft');
    assert.deepEqual(state.receipts, []);
  }
});

test('a slow confirm finishes in its own scope while another scope works', async () => {
  const storage = new MemoryStorage();
  const held = gate();
  const { store, proposal } = await proposed({ storage, commitYield: () => held.opened });
  const pending = store.confirm({ revisionId: proposal.revisionId, acknowledged: true });
  const otherScope = reviewScope({ actorId: 'coach_1', caseId: OTHER_CASE, weekStart: WEEK });
  const other = createReviewStore({ storage, scope: otherScope });
  await other.saveDraft(TEXT);
  held.open();
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal((await other.load()).state.status, 'draft');
  assert.deepEqual((await other.load()).state.receipts, []);
  assert.equal((await store.load()).state.receipts.length, 1);
});

test('reopening a scope waits for its own unfinished confirm on the same store', async () => {
  const held = gate();
  const { store, proposal } = await proposed({ commitYield: () => held.opened });
  const pending = store.confirm({ revisionId: proposal.revisionId, acknowledged: true });
  const reopened = store.load();
  held.open();
  await pending;
  assert.equal((await reopened).state.status, 'confirmed');
});

test('a reload during confirmation restores an unconfirmed proposal, never success', async () => {
  const storage = new MemoryStorage();
  const held = gate();
  const { store, proposal } = await proposed({ storage, commitYield: () => held.opened });
  store.confirm({ revisionId: proposal.revisionId, acknowledged: true });
  await new Promise((resolve) => { setTimeout(resolve, 0); });

  const afterReload = createReviewStore({ storage, scope: SCOPE });
  const loaded = await afterReload.load();
  assert.equal(loaded.state.status, 'proposed');
  assert.equal(loaded.state.interrupted, true);
  assert.equal(loaded.state.receipt, null);
  assert.equal(loaded.state.proposal.revisionId, proposal.revisionId);

  const retried = await afterReload.confirm({ revisionId: proposal.revisionId, acknowledged: true });
  assert.equal(retried.state.status, 'confirmed');
  assert.equal(retried.state.interrupted, false);
  assert.equal(retried.receipt.requestId, proposal.requestId);
});

test('a late confirm after another tab finished it keeps the one receipt', async () => {
  const storage = new MemoryStorage();
  const held = gate();
  const { store, proposal } = await proposed({ storage, commitYield: () => held.opened });
  const late = store.confirm({ revisionId: proposal.revisionId, acknowledged: true });
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  const otherTab = createReviewStore({ storage, scope: SCOPE });
  const finished = await otherTab.confirm({ revisionId: proposal.revisionId, acknowledged: true });
  held.open();
  const result = await late;
  assert.equal(result.replayed, true);
  assert.deepEqual(result.receipt, finished.receipt);
  assert.equal((await otherTab.load()).state.receipts.length, 1);
});

test('a confirm finishing after reset writes nothing back', async () => {
  const storage = new MemoryStorage();
  const held = gate();
  const { store, proposal } = await proposed({ storage, commitYield: () => held.opened });
  const late = store.confirm({ revisionId: proposal.revisionId, acknowledged: true });
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  const otherScope = createReviewStore({ storage, scope: SCOPE });
  await otherScope.reset();
  held.open();
  assert.equal((await late).code, 'revision_mismatch');
  assert.equal(storage.getItem(KEY), null);
});

test('promise-returning storage works and overlapping writes keep their order', async () => {
  const backing = new MemoryStorage();
  const delayed = {
    getItem: async (key) => { await new Promise((resolve) => { setTimeout(resolve, 1); }); return backing.getItem(key); },
    setItem: async (key, value) => { await new Promise((resolve) => { setTimeout(resolve, 1); }); backing.setItem(key, value); },
  };
  const { store } = makeStore({ storage: delayed });
  const saves = await Promise.all([
    store.saveDraft({ adjustment: 'first', rationale: '' }),
    store.saveDraft({ adjustment: 'second', rationale: '' }),
  ]);
  assert.deepEqual(saves.map((result) => result.ok), [true, true]);
  assert.equal((await store.load()).state.draft.adjustment, 'second');
});

test('a full browser store reports failure and the proposal survives for Retry', async () => {
  const { store, storage, proposal } = await proposed();
  const before = storage.getItem(KEY);
  storage.failSet = true;
  const failed = await store.confirm({ revisionId: proposal.revisionId, acknowledged: true });
  assert.equal(failed.ok, false);
  assert.equal(failed.code, 'write_failed');
  assert.equal(storage.getItem(KEY), before);
  storage.failSet = false;
  const retried = await store.confirm({ revisionId: proposal.revisionId, acknowledged: true });
  assert.equal(retried.state.status, 'confirmed');
  assert.equal(retried.state.receipts.length, 1);
});

test('a receipt write that fails after the marker stays unconfirmed, then Retry succeeds', async () => {
  const storage = new MemoryStorage();
  const { store, proposal } = await proposed({ storage, commitYield: () => { storage.failSet = true; } });
  const failed = await store.confirm({ revisionId: proposal.revisionId, acknowledged: true });
  assert.equal(failed.code, 'write_failed');
  storage.failSet = false;
  const loaded = await store.load();
  assert.equal(loaded.state.status, 'proposed');
  assert.equal(loaded.state.interrupted, true);
  const retried = await createReviewStore({ storage, scope: SCOPE }).confirm({ revisionId: proposal.revisionId, acknowledged: true });
  assert.equal(retried.ok, true);
  assert.equal(retried.state.receipts.length, 1);
});

test('nothing reports saved when a write does not read back', async () => {
  const { store, storage } = makeStore();
  storage.dropWrites = true;
  const result = await store.saveDraft(TEXT);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'write_unverified');
});

test('denied storage is an explicit unavailable state on every path', async () => {
  const denied = makeStore();
  denied.storage.failGet = true;
  assert.equal((await denied.store.load()).code, 'unavailable');
  assert.equal((await denied.store.saveDraft(TEXT)).code, 'unavailable');

  const absent = createReviewStore({ storage: null, scope: SCOPE });
  assert.equal((await absent.load()).code, 'unavailable');
  assert.equal((await absent.saveDraft(TEXT)).code, 'unavailable');
  assert.equal((await absent.reset()).code, 'unavailable');
});

test('malformed storage is reported, kept intact and never overwritten', async () => {
  const cases = {
    'not json': 'corrupt',
    '[]': 'corrupt',
    '{}': 'corrupt',
    '{"schema":"cvf_weekly_review","version":2}': 'unsupported',
    '{"schema":"cvf_weekly_review","version":1,"scope":"other","draft":null,"proposal":null,"confirming":null,"receipts":[]}': 'corrupt',
  };
  for (const [raw, code] of Object.entries(cases)) {
    const storage = new MemoryStorage({ [KEY]: raw });
    const { store } = makeStore({ storage });
    assert.equal((await store.load()).code, code, raw);
    assert.equal((await store.saveDraft(TEXT)).code, code, raw);
    assert.equal(storage.getItem(KEY), raw);
  }
});

test('malformed nested proposal and receipt facts are rejected without overwriting raw storage', async () => {
  for (const kind of ['proposal', 'receipt']) {
    for (const field of ['outside_activities']) {
      const { store, storage, proposal } = await proposed();
      if (kind === 'receipt') await store.confirm({ revisionId: proposal.revisionId, acknowledged: true });
      const envelope = JSON.parse(storage.getItem(KEY));
      const record = kind === 'proposal' ? envelope.proposal : envelope.receipts[0];
      record.context[field] = [null];
      const raw = JSON.stringify(envelope);
      storage.map.set(KEY, raw);
      const loaded = await store.load();
      assert.equal(loaded.ok, false, `${kind}.${field} must not reach rendering`);
      assert.equal(loaded.code, 'corrupt');
      assert.equal(storage.getItem(KEY), raw);
    }
  }
});

test('invalid nested dates, duration, counts and fixture facts are rejected', async () => {
  for (const mutate of [
    (context) => { context.weekStart = 'invalid'; },
    (context) => { context.pt_completed_count = -1; },
    (context) => { context.outside_activities[0].duration_seconds = '3300'; },
    (context) => { context.outside_activities[0].duration_seconds = -5; },
    (context) => { context.outside_activities[0].activity_type = 'unknown'; },
  ]) {
    const { store, storage } = await proposed();
    const envelope = JSON.parse(storage.getItem(KEY));
    mutate(envelope.proposal.context);
    const raw = JSON.stringify(envelope);
    storage.map.set(KEY, raw);
    assert.equal((await store.load()).code, 'corrupt');
    assert.equal(storage.getItem(KEY), raw);
  }
});

test('a matching revision cannot confirm a different request or decision', async () => {
  for (const field of ['requestId', 'adjustment', 'rationale', 'proposedAt']) {
    const { store, storage, proposal } = await proposed();
    await store.confirm({ revisionId: proposal.revisionId, acknowledged: true });
    const envelope = JSON.parse(storage.getItem(KEY));
    envelope.receipts[0][field] = 'Different but structurally valid value';
    const raw = JSON.stringify(envelope);
    storage.map.set(KEY, raw);
    const loaded = await store.load();
    assert.equal(loaded.ok, false, `${field} mismatch must not show confirmed`);
    assert.equal(loaded.code, 'corrupt');
    assert.equal(storage.getItem(KEY), raw);
  }
});

test('tampered receipts and proposals are rejected', async () => {
  const { storage, store, proposal } = await proposed();
  await store.confirm({ revisionId: proposal.revisionId, acknowledged: true });
  const good = JSON.parse(storage.getItem(KEY));

  const blankReceipt = structuredClone(good);
  blankReceipt.receipts[0].adjustment = '   ';
  const duplicated = structuredClone(good);
  duplicated.receipts.push(duplicated.receipts[0]);
  const wrongCase = structuredClone(good);
  wrongCase.proposal.context.caseId = OTHER_CASE;
  const orphanMarker = structuredClone(good);
  orphanMarker.confirming = { revisionId: 'other', requestId: 'other', startedAt: 'now' };

  for (const envelope of [blankReceipt, duplicated, wrongCase, orphanMarker]) {
    storage.map.set(KEY, JSON.stringify(envelope));
    assert.equal((await store.load()).code, 'corrupt');
  }
});

test('reset clears only current scope and keeps other reviews and foreign keys exact', async () => {
  const foreign = {
    cvf_preview_role: 'coach',
    cvf_preview_weekly_review_lookalike: 'keep',
    'cvf_preview_weekly_review:v2:future': 'keep',
    unrelated: '{"a":1}',
  };
  const storage = new MemoryStorage(foreign);
  const { store } = await proposed({ storage });
  const otherScope = reviewScope({ actorId: 'coach_2', caseId: OTHER_CASE, weekStart: OTHER_WEEK });
  await createReviewStore({ storage, scope: otherScope }).saveDraft(TEXT);
  storage.map.set(`${WEEKLY_REVIEW_KEY_PREFIX}corrupt`, 'not json');

  const result = await store.reset();
  assert.equal(result.ok, true);
  assert.equal(result.state.status, 'draft');
  assert.equal(storage.getItem(KEY), null);
  for (const [key,value] of Object.entries(foreign)) assert.equal(storage.getItem(key),value);
  assert.ok(storage.getItem(reviewStorageKey(otherScope)));
  assert.equal(storage.getItem(`${WEEKLY_REVIEW_KEY_PREFIX}corrupt`),'not json');
  assert.equal((await store.load()).state.draft, null);
});

test('reset recovers a corrupt scope', async () => {
  const storage = new MemoryStorage({ [KEY]: 'not json' });
  const { store } = makeStore({ storage });
  assert.equal((await store.reset()).ok, true);
  assert.equal((await store.load()).ok, true);
});

test('reset reports a removal that does not stick', async () => {
  const storage = new MemoryStorage({ [KEY]: 'x' });
  storage.removeItem = () => {};
  const { store } = makeStore({ storage });
  assert.equal((await store.reset()).code, 'reset_failed');
});

test('stored data stays inside the scope key', async () => {
  const { store, storage, proposal } = await proposed();
  await store.confirm({ revisionId: proposal.revisionId, acknowledged: true });
  assert.ok(KEY.startsWith(WEEKLY_REVIEW_KEY_PREFIX));
  assert.deepEqual(new Set(storage.setCalls), new Set([KEY]));
});
