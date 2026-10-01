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
