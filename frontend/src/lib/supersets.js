/**
 * Supersets and giant sets. Consecutive exercises sharing a superset_group
 * label form one group: two is a superset, three or more a giant set. The
 * backend normalizes labels on save (backend/src/lib/supersets.js — the
 * display helpers here are duplicated across the deploy boundary), so stored
 * rows carry "A", "B", ... for groups and null for straight sets.
 *
 * The builder helpers below keep the editable list in that same normalized
 * shape after every edit, so groups are always contiguous runs of 2+.
 */

export function supersetLabel(index) {
  if (index < 26) return String.fromCharCode(65 + index);
  const rest = index - 26;
  return String.fromCharCode(65 + Math.floor(rest / 26)) + String.fromCharCode(65 + (rest % 26));
}

export function supersetBlocks(exercises) {
  const blocks = [];
  (exercises || []).forEach((exercise, index) => {
    const group = exercise?.superset_group || null;
    const last = blocks[blocks.length - 1];
    if (group && last && last.group === group) last.items.push({ exercise, index });
    else blocks.push({ group, items: [{ exercise, index }] });
  });
  return blocks.map((block) => {
    const grouped = block.group && block.items.length >= 2;
    const kind = !grouped ? 'single' : block.items.length === 2 ? 'superset' : 'giant';
    return { ...block, kind, start: block.items[0].index, end: block.items[block.items.length - 1].index };
  });
}

export function groupKindLabel(kind) {
  if (kind === 'superset') return 'Superset';
  if (kind === 'giant') return 'Giant set';
  return '';
}

// Program-sheet notation. Without groups: 1, 2, 3. With any group, every
// block is lettered and members are numbered within it: A, B1, B2, C.
export function exerciseMarkers(exercises) {
  const list = exercises || [];
  const blocks = supersetBlocks(list);
  const markers = new Array(list.length);
  if (!blocks.some((block) => block.kind !== 'single')) {
    list.forEach((_, index) => { markers[index] = String(index + 1); });
    return markers;
  }
  blocks.forEach((block, blockIndex) => {
    const letter = supersetLabel(blockIndex);
    block.items.forEach((item, itemIndex) => {
      markers[item.index] = block.kind === 'single' ? letter : `${letter}${itemIndex + 1}`;
    });
  });
  return markers;
}

// ---------- Builder edits (pure; return a new array) ----------

function normalize(exercises) {
  const result = exercises.map((exercise) => ({ ...exercise, superset_group: null }));
  let next = 0;
  let start = 0;
  while (start < exercises.length) {
    const key = exercises[start].superset_group || null;
    let end = start + 1;
    if (key) while (end < exercises.length && exercises[end].superset_group === key) end += 1;
    if (end - start >= 2) {
      const label = supersetLabel(next);
      next += 1;
      for (let i = start; i < end; i += 1) result[i].superset_group = label;
    }
    start = end;
  }
  return result;
}

export function normalizeSupersets(exercises) {
  return normalize(exercises || []);
}

export function isLinkedWithNext(exercises, index) {
  const current = exercises[index]?.superset_group;
  return Boolean(current) && exercises[index + 1]?.superset_group === current;
}

function blockAt(exercises, index) {
  return supersetBlocks(exercises).find((block) => index >= block.start && index <= block.end);
}

// Link exercise `index` with the one after it, merging their blocks into
// one group; if already linked, split the group at that boundary.
export function toggleLinkWithNext(exercises, index) {
  if (index < 0 || index >= exercises.length - 1) return exercises;
  const next = exercises.map((exercise) => ({ ...exercise }));
  if (isLinkedWithNext(exercises, index)) {
    const block = blockAt(exercises, index);
    for (let i = index + 1; i <= block.end; i += 1) next[i].superset_group = '__split';
    return normalize(next);
  }
  const above = blockAt(exercises, index);
  const below = blockAt(exercises, index + 1);
  for (let i = above.start; i <= below.end; i += 1) next[i].superset_group = '__merge';
  return normalize(next);
}

export function ungroupBlock(exercises, index) {
  const block = blockAt(exercises, index);
  if (!block) return exercises;
  return normalize(exercises.map((exercise, i) => (
    i >= block.start && i <= block.end ? { ...exercise, superset_group: null } : exercise
  )));
}

function moveRange(exercises, start, end, insertAt) {
  const moving = exercises.slice(start, end + 1);
  const rest = [...exercises.slice(0, start), ...exercises.slice(end + 1)];
  return [...rest.slice(0, insertAt), ...moving, ...rest.slice(insertAt)];
}

// Move a whole block (a straight set or an entire group) past its
// neighbouring block. Groups stay intact; nothing is split.
export function moveBlock(exercises, index, direction) {
  const blocks = supersetBlocks(exercises);
  const position = blocks.findIndex((block) => index >= block.start && index <= block.end);
  const neighbour = blocks[position + direction];
  if (position < 0 || !neighbour) return exercises;
  const block = blocks[position];
  const insertAt = direction < 0 ? neighbour.start : neighbour.end - (block.end - block.start);
  return normalize(moveRange(exercises, block.start, block.end, insertAt));
}

// Move one exercise. Inside a group it swaps with its groupmate; a straight
// set (or a member leaving the edge of its group) steps past the whole
// neighbouring block, so moving never splits a group it isn't part of.
export function moveExercise(exercises, index, direction) {
  const target = index + direction;
  if (target < 0 || target >= exercises.length) return exercises;
  const sameGroup = Boolean(exercises[index].superset_group)
    && exercises[index].superset_group === exercises[target].superset_group;
  if (sameGroup) {
    const next = [...exercises];
    [next[index], next[target]] = [next[target], next[index]];
    return normalize(next);
  }
  const detached = exercises.map((exercise, i) => (i === index ? { ...exercise, superset_group: null } : exercise));
  const neighbour = blockAt(detached, target);
  const insertAt = direction < 0 ? neighbour.start : neighbour.end;
  return normalize(moveRange(detached, index, index, insertAt));
}

export function canMoveExercise(exercises, index, direction) {
  const target = index + direction;
  return target >= 0 && target < exercises.length;
}

// ---------- Tracker ----------

// The exercise to work on next. Straight sets finish in order; inside a
// superset/giant set the client alternates rounds, so the member with the
// fewest completed sets (earliest on a tie) is next.
export function nextExercise(exercises) {
  const pending = (exercise) => (exercise.sets || []).some((set) => set.status !== 'completed');
  const done = (exercise) => (exercise.sets || []).filter((set) => set.status === 'completed').length;
  const block = supersetBlocks(exercises).find((candidate) => candidate.items.some(({ exercise }) => pending(exercise)));
  if (!block) return null;
  return block.items
    .map(({ exercise }) => exercise)
    .filter(pending)
    .reduce((best, exercise) => (done(exercise) < done(best) ? exercise : best));
}
