const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const {
  exerciseMarkers, normalizeSupersetGroups, supersetBlocks,
} = require('../src/lib/supersets');

const root = path.resolve(__dirname, '../..');
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20261001120000_superset_groups.sql'),
  'utf8',
);
const routes = fs.readFileSync(path.join(root, 'backend', 'src', 'routes', 'programs.js'), 'utf8');

const frontendLib = () => import(pathToFileURL(path.join(root, 'frontend/src/lib/supersets.js')));
const names = (list) => list.map((exercise) => exercise.custom_name);
const groups = (list) => list.map((exercise) => exercise.superset_group);
const row = (custom_name, superset_group = null) => ({ custom_name, superset_group });

test('migration adds constrained labels, snapshots them, and writes/copies them in the RPCs', () => {
  assert.match(migration, /alter table public\.workout_exercises\s*add column if not exists superset_group text\s*check \(superset_group is null or superset_group ~ '\^\[A-Z\]\{1,2\}\$'\)/);
  assert.match(migration, /alter table public\.workout_log_exercises\s*add column if not exists superset_group text\s*check/);
  assert.match(migration, /create trigger fill_workout_log_exercise_superset\s*before insert on public\.workout_log_exercises/);
  assert.match(migration, /where id = new\.source_workout_exercise_id/);
  assert.match(migration, /create or replace function public\.save_workout\(/);
  assert.match(migration, /superset_group = nullif\(btrim\(coalesce\(v_exercise ->> 'superset_group', ''\)\), ''\)/);
  assert.match(migration, /create or replace function public\.clone_workout\(/);
  assert.match(migration, /v_ex\.video_url, v_ex\.position, v_ex\.superset_group/);
  assert.match(migration, /revoke execute on function public\.fill_workout_log_exercise_superset\(\) from public, anon, authenticated;/);
  // Forward-only: an applied migration is never edited, only superseded.
  assert.doesNotMatch(migration, /drop function|drop table|delete from/i);
});

test('both workout write routes normalize labels before save_workout', () => {
  assert.equal((routes.match(/normalizeSupersetGroups\(/g) || []).length, 2);
});

test('normalization: contiguous runs of 2+ get sequential letters, singletons become null', () => {
  const result = normalizeSupersetGroups([
    row('Squat', 'x'),
    row('Bench', 'k1'), row('Row', 'k1'),
    row('Curl', 'k2'), row('Pushdown', 'k2'), row('Plank', 'k2'),
    row('Lunge', 'k1'), // same key but not adjacent to the first k1 run: alone
  ]);
  assert.deepEqual(groups(result), [null, 'A', 'A', 'B', 'B', 'B', null]);
});

test('normalization ignores rows save_workout drops, and tolerates junk input', () => {
  const result = normalizeSupersetGroups([
    row('Bench', 'k'), { custom_name: '  ', superset_group: 'k' }, row('Row', 'k'),
  ]);
  assert.deepEqual(groups(result), ['A', null, 'A']);
  assert.deepEqual(groups(normalizeSupersetGroups([{ exercise_library_id: 'lib', superset_group: 7 }, row('B', 7)])), ['A', 'A']);
  assert.deepEqual(normalizeSupersetGroups([null, row('A', 'q')]), [null, { custom_name: 'A', superset_group: null }]);
  assert.equal(normalizeSupersetGroups(undefined), undefined);
});

test('markers keep plain numbering without groups and use A/B1/B2 notation with them', async () => {
  const plain = [row('a'), row('b'), row('c')];
  const grouped = [row('a'), row('b', 'A'), row('c', 'A'), row('d'), row('e', 'B'), row('f', 'B'), row('g', 'B')];
  assert.deepEqual(exerciseMarkers(plain), ['1', '2', '3']);
  assert.deepEqual(exerciseMarkers(grouped), ['A', 'B1', 'B2', 'C', 'D1', 'D2', 'D3']);
  assert.deepEqual(supersetBlocks(grouped).map((block) => block.kind), ['single', 'superset', 'single', 'giant']);
  const ui = await frontendLib();
  assert.deepEqual(ui.exerciseMarkers(grouped), exerciseMarkers(grouped));
  assert.deepEqual(ui.exerciseMarkers(plain), exerciseMarkers(plain));
});

test('builder linking merges neighbouring blocks and unlinking splits at that boundary', async () => {
  const { toggleLinkWithNext, ungroupBlock, isLinkedWithNext } = await frontendLib();
  let list = [row('a'), row('b'), row('c'), row('d')];
  list = toggleLinkWithNext(list, 0);
  assert.deepEqual(groups(list), ['A', 'A', null, null]);
  list = toggleLinkWithNext(list, 1); // a+b+c: giant set
  assert.deepEqual(groups(list), ['A', 'A', 'A', null]);
  assert.equal(isLinkedWithNext(list, 2), false);
  list = toggleLinkWithNext(list, 0); // split a | b+c
  assert.deepEqual(groups(list), [null, 'A', 'A', null]);
  list = toggleLinkWithNext(list, 2); // b+c+d
  assert.deepEqual(groups(list), [null, 'A', 'A', 'A']);
  list = toggleLinkWithNext(list, 1); // b | c+d
  assert.deepEqual(groups(list), [null, null, 'A', 'A']);
  assert.deepEqual(groups(ungroupBlock(list, 3)), [null, null, null, null]);
  // Out-of-range links are no-ops.
  assert.equal(toggleLinkWithNext(list, 3), list);
});

test('moving an exercise swaps within a group and steps past whole neighbouring blocks', async () => {
  const { moveExercise } = await frontendLib();
  const list = [row('a'), row('b', 'A'), row('c', 'A'), row('d')];
  // Inside the group: swap, group intact.
  let moved = moveExercise(list, 1, 1);
  assert.deepEqual(names(moved), ['a', 'c', 'b', 'd']);
  assert.deepEqual(groups(moved), [null, 'A', 'A', null]);
  // A straight set never splits a group: it jumps the whole superset.
  moved = moveExercise(list, 0, 1);
  assert.deepEqual(names(moved), ['b', 'c', 'a', 'd']);
  assert.deepEqual(groups(moved), ['A', 'A', null, null]);
  moved = moveExercise(list, 3, -1);
  assert.deepEqual(names(moved), ['a', 'd', 'b', 'c']);
  assert.deepEqual(groups(moved), [null, null, 'A', 'A']);
  // A member leaving the edge of its group detaches; a 2-group dissolves.
  moved = moveExercise(list, 2, 1);
  assert.deepEqual(names(moved), ['a', 'b', 'd', 'c']);
  assert.deepEqual(groups(moved), [null, null, null, null]);
  // Ends are no-ops.
  assert.equal(moveExercise(list, 0, -1), list);
  assert.equal(moveExercise(list, 3, 1), list);
});

test('moving a block carries the whole group past its neighbour', async () => {
  const { moveBlock } = await frontendLib();
  const list = [row('a'), row('b', 'A'), row('c', 'A'), row('d'), row('e', 'B'), row('f', 'B'), row('g', 'B')];
  let moved = moveBlock(list, 2, -1);
  assert.deepEqual(names(moved), ['b', 'c', 'a', 'd', 'e', 'f', 'g']);
  assert.deepEqual(groups(moved), ['A', 'A', null, null, 'B', 'B', 'B']);
  moved = moveBlock(list, 1, 1);
  assert.deepEqual(names(moved), ['a', 'd', 'b', 'c', 'e', 'f', 'g']);
  moved = moveBlock(moved, 2, 1); // superset past the giant set
  assert.deepEqual(names(moved), ['a', 'd', 'e', 'f', 'g', 'b', 'c']);
  assert.deepEqual(groups(moved), [null, null, 'A', 'A', 'A', 'B', 'B']);
  assert.equal(moveBlock(list, 6, 1), list);
});

test('tracker alternates the current exercise through a superset, in order otherwise', async () => {
  const { nextExercise } = await frontendLib();
  const sets = (done, total) => Array.from({ length: total }, (_, i) => ({ status: i < done ? 'completed' : 'pending' }));
  const log = (a, b, c) => [
    { id: 'squat', superset_group: null, sets: sets(a, 2) },
    { id: 'bench', superset_group: 'A', sets: sets(b, 3) },
    { id: 'row', superset_group: 'A', sets: sets(c, 3) },
  ];
  assert.equal(nextExercise(log(0, 0, 0)).id, 'squat');
  assert.equal(nextExercise(log(1, 0, 0)).id, 'squat');
  assert.equal(nextExercise(log(2, 0, 0)).id, 'bench');
  assert.equal(nextExercise(log(2, 1, 0)).id, 'row');
  assert.equal(nextExercise(log(2, 1, 1)).id, 'bench');
  assert.equal(nextExercise(log(2, 3, 2)).id, 'row');
  assert.equal(nextExercise(log(2, 3, 3)), null);
});

test('rest is skipped mid-round inside a group and taken once the round is done', async () => {
  const { restAfterSet } = await frontendLib();
  const ex = (id, group, rest, done, total = 3) => ({
    id, superset_group: group, prescribed_rest_seconds: rest,
    sets: Array.from({ length: total }, (_, i) => ({ id: `${id}-${i + 1}`, status: i < done ? 'completed' : 'pending' })),
  });
  // Straight set: own prescription, never clears.
  assert.deepEqual(restAfterSet([ex('squat', null, 120, 0)], 'squat', 'squat-1'), { seconds: 120, clear: false });
  assert.deepEqual(restAfterSet([ex('squat', null, null, 0)], 'squat', 'squat-1'), { seconds: 0, clear: false });
  // Superset, rest typed only on A1: A1 set 1 -> no rest; A2 set 1 -> 90s.
  assert.deepEqual(restAfterSet([ex('a1', 'A', 90, 0), ex('a2', 'A', 0, 0)], 'a1', 'a1-1'), { seconds: 0, clear: true });
  assert.deepEqual(restAfterSet([ex('a1', 'A', 90, 1), ex('a2', 'A', 0, 0)], 'a2', 'a2-1'), { seconds: 90, clear: false });
  // Longest rest in the group wins; order within the round doesn't matter.
  assert.deepEqual(restAfterSet([ex('a1', 'A', 60, 0), ex('a2', 'A', 0, 1), ex('a3', 'A', 120, 1)], 'a1', 'a1-1'), { seconds: 120, clear: false });
  // Unequal set counts: once a member is out of sets it doesn't hold the round.
  assert.deepEqual(restAfterSet([ex('a1', 'A', 60, 3, 4), ex('a2', 'A', 0, 3, 3)], 'a1', 'a1-4'), { seconds: 60, clear: false });
  // Unknown exercise: nothing.
  assert.deepEqual(restAfterSet([ex('a1', 'A', 60, 0)], 'zzz', 'x'), { seconds: 0, clear: false });
});

test('drag-and-drop joins a group when dropped inside it and leaves it otherwise', async () => {
  const { dropExercise } = await frontendLib();
  const list = [row('a'), row('b', 'A'), row('c', 'A'), row('d', 'B'), row('e', 'B')];
  // Drop the straight set between b and c: joins the superset (giant set).
  let moved = dropExercise(list, 0, 1);
  assert.deepEqual(names(moved), ['b', 'a', 'c', 'd', 'e']);
  assert.deepEqual(groups(moved), ['A', 'A', 'A', 'B', 'B']);
  // Reorder inside a group keeps it.
  moved = dropExercise(list, 2, 1);
  assert.deepEqual(names(moved), ['a', 'c', 'b', 'd', 'e']);
  assert.deepEqual(groups(moved), [null, 'A', 'A', 'B', 'B']);
  // Drag a member out to the top: it leaves, and the 2-group dissolves.
  moved = dropExercise(list, 2, 0);
  assert.deepEqual(names(moved), ['c', 'a', 'b', 'd', 'e']);
  assert.deepEqual(groups(moved), [null, null, null, 'A', 'A']);
  // Dropped at a boundary between two different groups: straight set.
  moved = dropExercise(list, 0, 2);
  assert.deepEqual(names(moved), ['b', 'c', 'a', 'd', 'e']);
  assert.deepEqual(groups(moved), ['A', 'A', null, 'B', 'B']);
  assert.equal(dropExercise(list, 1, 1), list);
});

test('PDF exports state the same once-per-round rest as the tracker', async () => {
  const { generateProgramPdf, generateLogSheetPdf } = require('../src/lib/programPdf');
  const { extractPdfText } = require('../src/lib/pdfText');
  const { roundRestSeconds, formatRestSeconds } = require('../src/lib/supersets');
  assert.equal(roundRestSeconds([{ rest_seconds: 45 }, { rest_seconds: 90 }, { rest_seconds: null }]), 90);
  assert.equal(formatRestSeconds(90), '1:30');
  const exercises = [
    { custom_name: 'Back Squat', sets: '4', reps: '6', rest: '120s', rest_seconds: 120 },
    { custom_name: 'Bench Press', sets: '3', reps: '8', rest: '45s', rest_seconds: 45, superset_group: 'A' },
    { custom_name: 'Chest Row', sets: '3', reps: '10', rest: '90s', rest_seconds: 90, superset_group: 'A' },
  ];
  const toBuffer = async (pdf) => { const out = await pdf; return Buffer.isBuffer(out) ? out : Buffer.from(out); };
  const texts = [
    await extractPdfText(await toBuffer(generateProgramPdf({ name: 'T', days: [{ day_number: 1, workout: { name: 'Upper', exercises } }] }, { coach: { name: 'Coach' } }))),
    await extractPdfText(await toBuffer(generateLogSheetPdf({ title: 'Log', sections: [{ title: 'Upper', exercises }] }))),
  ];
  for (const raw of texts) {
    const text = raw.replace(/\s+/g, ' ');
    assert.match(text, /SUPERSET - ALTERNATE THESE 2, THEN REST 1:30/);
    // The straight set keeps its own rest; grouped members don't repeat theirs.
    assert.match(text, /Rest: 120s/);
    assert.doesNotMatch(text, /Rest: 45s/);
    assert.doesNotMatch(text, /Rest: 90s/);
  }
});

test('duplicating an exercise copies its prescription below it, as a new row, in its group', async () => {
  const { duplicateExercise } = await frontendLib();
  const list = [
    { id: 'e1', custom_name: 'Squat', sets: '3', reps: '5', rest: '120s', superset_group: null, _uid: 'u1' },
    { id: 'e2', custom_name: 'Bench', sets: '3', reps: '8', coach_notes: 'pause', superset_group: 'A', _uid: 'u2' },
    { id: 'e3', custom_name: 'Row', sets: '3', reps: '10', superset_group: 'A', _uid: 'u3' },
  ];
  let next = duplicateExercise(list, 0, { _uid: 'copy1' });
  assert.deepEqual(names(next), ['Squat', 'Squat', 'Bench', 'Row']);
  assert.deepEqual({ ...next[1] }, { ...list[0], id: '', _uid: 'copy1' });
  assert.equal(next[0].id, 'e1');
  // A grouped exercise's copy joins the group (superset -> giant set).
  next = duplicateExercise(list, 1, { _uid: 'copy2' });
  assert.deepEqual(names(next), ['Squat', 'Bench', 'Bench', 'Row']);
  assert.deepEqual(groups(next), [null, 'A', 'A', 'A']);
  assert.equal(next[2].coach_notes, 'pause');
  assert.equal(next[2].id, '');
  assert.equal(duplicateExercise(list, 9), list);
});

test('a duplicated exercise is an independent row: editing it never touches the original', async () => {
  const { duplicateExercise } = await frontendLib();
  const list = [
    { id: 'e1', custom_name: 'Bench', reps: '8', superset_group: 'A', _uid: 'u1' },
    { id: 'e2', custom_name: 'Row', reps: '10', superset_group: 'A', _uid: 'u2' },
  ];
  const next = duplicateExercise(list, 0, { _uid: 'copy' });
  assert.notEqual(next[1], next[0]);
  assert.notEqual(next[1], list[0]);
  // The builder edits rows immutably (setExercise spreads the row); a copy edit
  // must leave the original row and the input list as they were.
  const edited = next.map((row, i) => (i === 1 ? { ...row, reps: '15' } : row));
  assert.equal(edited[0].reps, '8');
  assert.equal(edited[1].reps, '15');
  assert.equal(list[0].reps, '8');
  assert.equal(edited[0].id, 'e1');
  assert.equal(edited[1].id, '');
});
