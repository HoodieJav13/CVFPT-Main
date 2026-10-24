import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PROPOSAL_STATUS, canonicalJson, canonicalRowPaths, catalogIdentity, recheckBeforeCommit, sha256Hex, verifyOfflineProposal,
} from '../../src/lib/offlineDraftImport.js';

// Fixtures were produced by the accepted offline companion's own export
// wrapper (MOCK provider, fictional data); see fixtures/offline-proposal/PROVENANCE.md.
const fixture = (name) => JSON.parse(readFileSync(new URL(`../browser/fixtures/offline-proposal/${name}`, import.meta.url), 'utf8'));
const proposal = () => fixture('proposal.json');
const library = () => fixture('library.json');
const PRODUCER_EXPORT_SHA = 'd288b6ba258bec838739e334c38ece7b979c9515bde0a15cead92de5cbf9163b';

test('a companion export verifies against the same fictional catalog and keeps its identities', async () => {
  const result = await verifyOfflineProposal(proposal(), library());
  assert.equal(result.ok, true, JSON.stringify(result.refusal));
  assert.equal(result.identity.proposal_sha256, PRODUCER_EXPORT_SHA, 'PT hashes the file exactly as the companion export did');
  assert.equal(result.identity.catalog_revision, proposal().provenance.catalog_revision);
  assert.equal(result.identity.accepted_sha256, proposal().provenance.accepted_sha256);
  assert.equal(result.identity.accepted_by, 'fict-coach-c04');
  assert.equal(result.bindings.length, 6);
  assert.deepEqual(result.bindings.map((row) => row.exercise_id), ['lib-goblet', 'lib-deadbug', 'lib-pushup', 'lib-row', 'lib-plank', 'lib-goblet']);
  assert.equal(result.draft.days[2].exercises[0].tracking_type, 'duration');
});

test('the catalog revision is derived from content: order-independent, and any field change moves it', async () => {
  const rows = library();
  const a = await catalogIdentity(rows);
  const b = await catalogIdentity([...rows].reverse().map((row) => ({ ...row, video_url: 'ignored', created_at: 'ignored' })));
  assert.equal(a.revision, b.revision);
  assert.equal(a.sha256, b.sha256);
  assert.match(a.revision, /^pt-catalog:[0-9a-f]{64}$/);
  const renamed = await catalogIdentity(rows.map((row) => (row.id === 'lib-row' ? { ...row, equipment: 'Machine' } : row)));
  assert.notEqual(renamed.revision, a.revision);
  const archived = await catalogIdentity([...rows, { ...rows[0], id: 'lib-old', name: 'Old Squat', archived: true }]);
  assert.equal(archived.revision, a.revision, 'archived rows cannot be matched by the import and are not part of the snapshot');
});

test('canonical JSON sorts keys at every depth and SHA-256 matches a fixed vector', async () => {
  assert.equal(canonicalJson({ b: 1, a: [{ d: null, c: 'x' }] }), '{"a":[{"c":"x","d":null}],"b":1}');
  assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

const refusalOf = async (envelope, rows = library()) => (await verifyOfflineProposal(envelope, rows)).refusal;

test('non-proposal and non-MOCK files are refused before anything else', async () => {
  assert.equal((await refusalOf(null)).code, 'invalid_proposal_file');
  assert.equal((await refusalOf([])).code, 'invalid_proposal_file');
  const live = proposal(); live.provider = 'ENABLED / live';
  assert.deepEqual((await refusalOf(live)).errors.map((e) => e.path), ['provider']);
  const status = proposal(); status.status = 'ASSIGNED';
  assert.deepEqual((await refusalOf(status)).errors.map((e) => e.path), ['status']);
  const contract = proposal(); contract.contract_version = 'pt-draft-proposal-v2';
  assert.deepEqual((await refusalOf(contract)).errors.map((e) => e.path), ['contract_version']);
  const bare = proposal(); delete bare.exercise_bindings;
  assert.deepEqual((await refusalOf(bare)).errors.map((e) => e.path), ['exercise_bindings']);
  assert.equal(PROPOSAL_STATUS, proposal().status);
});

test('the program draft must pass PT\'s own draft rules, with paths into program_draft', async () => {
  const bad = proposal(); bad.program_draft.days[0].exercises[0].name = '';
  const refusal = await refusalOf(bad);
  assert.equal(refusal.code, 'draft_invalid');
  assert.ok(refusal.errors.some((e) => e.path === 'program_draft.days.0.exercises.0.name'), JSON.stringify(refusal.errors));
});

test('tampered snapshot or accepted hashes and malformed bindings are refused as inconsistent', async () => {
  const cases = {
    'exercise_bindings.catalog_sha256': (p) => { p.exercise_bindings.catalog_sha256 = '0'.repeat(64); },
    'exercise_bindings.accepted_sha256': (p) => { p.exercise_bindings.accepted_sha256 = 'f'.repeat(64); },
    'exercise_bindings.accepted_revision': (p) => { p.exercise_bindings.accepted_revision = 2; },
    'exercise_bindings.catalog_revision': (p) => { p.exercise_bindings.catalog_revision = 'fict-catalog-r7'; },
    'provenance.accepted_sha256': (p) => { p.provenance.accepted_sha256 = 'abc'; p.exercise_bindings.accepted_sha256 = 'abc'; },
    'exercise_bindings.rows': (p) => { p.exercise_bindings.rows.pop(); },
    'exercise_bindings.rows.1': (p) => { p.exercise_bindings.rows[1].program_draft_path = 'days.0.exercises.0'; },
    'exercise_bindings.rows.2': (p) => { p.exercise_bindings.rows[2].exercise_id = 7; },
  };
  for (const [path, mutate] of Object.entries(cases)) {
    const envelope = proposal(); mutate(envelope);
    const refusal = await refusalOf(envelope);
    assert.equal(refusal?.code, 'binding_invalid', path);
    assert.ok(refusal.errors.some((e) => e.path === path), `${path}: ${JSON.stringify(refusal.errors)}`);
  }
});

test('a proposal drafted against another catalog revision, or with a tampered catalog hash, is refused', async () => {
  const changed = library().map((row) => (row.id === 'lib-plank' ? { ...row, primary_muscle: 'Abs' } : row));
  assert.equal((await refusalOf(proposal(), changed)).code, 'catalog_revision_mismatch');
  const forged = proposal();
  forged.provenance.catalog_sha256 = 'a'.repeat(64);
  forged.exercise_bindings.catalog_sha256 = 'a'.repeat(64);
  assert.equal((await refusalOf(forged)).code, 'catalog_revision_mismatch');
  const otherRevision = proposal();
  otherRevision.provenance.catalog_revision = 'fict-catalog-r7';
  otherRevision.exercise_bindings.catalog_revision = 'fict-catalog-r7';
  assert.equal((await refusalOf(otherRevision)).code, 'catalog_revision_mismatch');
});

test('a draft row edited after export no longer matches its bound exercise', async () => {
  const edited = proposal();
  edited.program_draft.days[1].exercises[1].name = 'Push-up';
  const refusal = await refusalOf(edited);
  assert.equal(refusal.code, 'exercise_binding_mismatch');
  assert.deepEqual(refusal.errors.map((e) => e.path), ['exercise_bindings.rows.3']);
});

// Bound-id rules need a catalog that still has the snapshot's revision, so
// these cases rebuild the proposal's catalog identity for the altered library.
async function againstLibrary(rows, mutate = () => {}) {
  const envelope = proposal();
  const identity = await catalogIdentity(rows);
  for (const target of [envelope.provenance, envelope.exercise_bindings]) {
    target.catalog_revision = identity.revision;
    target.catalog_sha256 = identity.sha256;
  }
  mutate(envelope);
  return verifyOfflineProposal(envelope, rows);
}

test('unknown, hidden, unapproved, renamed and ambiguous bound exercises are refused path by path', async () => {
  const unknown = await againstLibrary(library(), (p) => { p.exercise_bindings.rows[3].exercise_id = 'lib-missing'; });
  assert.equal(unknown.refusal.code, 'exercise_binding_mismatch');
  assert.deepEqual(unknown.refusal.errors.map((e) => e.path), ['exercise_bindings.rows.3']);

  const hidden = await againstLibrary(library().map((row) => (row.id === 'lib-row' ? { ...row, hidden: true } : row)));
  assert.match(hidden.refusal.errors[0].message, /Cable Row is hidden/);

  const pending = await againstLibrary(library().map((row) => (row.id === 'lib-pushup' ? { ...row, review_status: 'pending' } : row)));
  assert.match(pending.refusal.errors[0].message, /Push-up is not approved/);

  const renamed = await againstLibrary(library().map((row) => (row.id === 'lib-deadbug' ? { ...row, name: 'Dead Bug Hold' } : row)));
  assert.ok(renamed.refusal.errors.some((e) => /now named "Dead Bug Hold"/.test(e.message)));

  const ambiguous = await verifyOfflineProposal(fixture('proposal-ambiguous-catalog.json'), fixture('library-ambiguous.json'));
  assert.equal(ambiguous.refusal.code, 'exercise_binding_mismatch');
  assert.deepEqual(ambiguous.refusal.errors.map((e) => e.path), ['exercise_bindings.rows.0', 'exercise_bindings.rows.5']);
  assert.match(ambiguous.refusal.errors[0].message, /More than one catalog exercise is named "Goblet Squat"/);
});

test('re-check before saving: coach edits to prescriptions pass; a stale catalog or changed bound row is refused', async () => {
  const verified = await verifyOfflineProposal(proposal(), library());
  const edited = structuredClone(verified.draft);
  edited.days[0].exercises[0].sets = '4';
  edited.program.name = 'Sample C Foundations (coach edit)';
  const ok = await recheckBeforeCommit(verified, edited, library());
  assert.equal(ok.ok, true, JSON.stringify(ok.refusal));
  assert.equal(ok.draft.days[0].exercises[0].sets, '4');

  const swapped = structuredClone(verified.draft);
  swapped.days[1].exercises[1].name = 'Plank';
  const swappedRefusal = await recheckBeforeCommit(verified, swapped, library());
  assert.equal(swappedRefusal.refusal.code, 'exercise_binding_mismatch');

  const removed = structuredClone(verified.draft);
  removed.days[2].exercises.pop();
  assert.equal((await recheckBeforeCommit(verified, removed, library())).refusal.code, 'exercise_binding_mismatch');

  const stale = await recheckBeforeCommit(verified, verified.draft, [...library(), { id: 'lib-new', name: 'Step-up', category: 'Strength', equipment: 'Bodyweight', primary_muscle: 'Quads' }]);
  assert.equal(stale.refusal.code, 'catalog_revision_mismatch');
});

// R4 (independent review of 1c32ca1): bindings must be an exact bijection onto
// the draft's canonical row paths, at the first check and before commit.
test('R4: the companion export binds every canonical row path exactly once', async () => {
  const result = await verifyOfflineProposal(proposal(), library());
  assert.deepEqual(canonicalRowPaths(result.draft), ['days.0.exercises.0', 'days.0.exercises.1', 'days.1.exercises.0', 'days.1.exercises.1', 'days.2.exercises.0', 'days.2.exercises.1']);
  assert.deepEqual(result.bindings.map((row) => row.program_draft_path), canonicalRowPaths(result.draft));
});

test('R4: zero-padded and other alias paths are refused, and the rows they leave unbound are named', async () => {
  const aliases = { 'days.00.exercises.0': 0, 'days.0.exercises.01': 1, 'days.+1.exercises.0': 2, 'days.1.exercises.1 ': 3, 'days.1.exercises.1.0': 3, 'days.2.exercises.0x0': 4, 'days.2.exercises.9007199254740993': 5 };
  for (const [alias, index] of Object.entries(aliases)) {
    const envelope = proposal();
    const original = envelope.exercise_bindings.rows[index].program_draft_path;
    envelope.exercise_bindings.rows[index].program_draft_path = alias;
    const refusal = await refusalOf(envelope);
    assert.equal(refusal?.code, 'binding_invalid', alias);
    assert.ok(refusal.errors.some((e) => e.path === `exercise_bindings.rows.${index}` && e.message.startsWith(`${alias} is not a program row path`)), alias);
    assert.ok(refusal.errors.some((e) => e.message === `No binding for program row ${original}`), alias);
  }
});

test('R4: the reviewer alias map (six paths for the first row) is refused with every unbound row listed', async () => {
  const envelope = proposal();
  const first = envelope.exercise_bindings.rows[0];
  envelope.exercise_bindings.rows = Array.from({ length: 6 }, (_, i) => ({ ...first, program_draft_path: `days.${'0'.repeat(i + 1)}.exercises.0` }));
  envelope.program_draft.days[1].exercises[1].name = 'UNBOUND fictional new movement';
  const refusal = await refusalOf(envelope);
  assert.equal(refusal.code, 'binding_invalid');
  assert.deepEqual(refusal.errors.filter((e) => e.path === 'exercise_bindings.rows').map((e) => e.message),
    ['days.0.exercises.1', 'days.1.exercises.0', 'days.1.exercises.1', 'days.2.exercises.0', 'days.2.exercises.1'].map((path) => `No binding for program row ${path}`));
});

test('R4: a path outside the draft, a wrong day number, or a row swapped for a duplicate is refused', async () => {
  const outside = proposal(); outside.exercise_bindings.rows[5].program_draft_path = 'days.2.exercises.2';
  assert.ok((await refusalOf(outside)).errors.some((e) => e.message === 'No binding for program row days.2.exercises.1'));
  const day = proposal(); day.exercise_bindings.rows[2].day_number = 3;
  assert.deepEqual((await refusalOf(day)).errors, [{ path: 'exercise_bindings.rows.2', message: 'days.1.exercises.0 is in day 2, but the binding says day 3' }]);
  const swapped = proposal(); swapped.exercise_bindings.rows[4] = { ...swapped.exercise_bindings.rows[5] };
  const refusal = await refusalOf(swapped);
  assert.ok(refusal.errors.some((e) => e.message === 'Duplicate binding for days.2.exercises.1'));
  assert.ok(refusal.errors.some((e) => e.message === 'No binding for program row days.2.exercises.0'));
});

test('R4: before commit, an added or removed row breaks the bijection and nothing is approved', async () => {
  const verified = await verifyOfflineProposal(proposal(), library());
  const added = structuredClone(verified.draft);
  added.days[0].exercises.push({ ...added.days[0].exercises[1] });
  const addedRefusal = (await recheckBeforeCommit(verified, added, library())).refusal;
  assert.equal(addedRefusal.code, 'exercise_binding_mismatch');
  assert.deepEqual(addedRefusal.errors, [{ path: 'exercise_bindings.rows', message: 'No binding for program row days.0.exercises.2' }]);
  // Alias bindings that somehow reached the commit step are refused there too.
  const aliased = { ...verified, bindings: verified.bindings.map((row, i) => (i === 1 ? { ...row, program_draft_path: 'days.0.exercises.00' } : row)) };
  const aliasRefusal = (await recheckBeforeCommit(aliased, verified.draft, library())).refusal;
  assert.equal(aliasRefusal.code, 'exercise_binding_mismatch');
  assert.ok(aliasRefusal.errors.some((e) => e.message === 'No binding for program row days.0.exercises.1'));
});
