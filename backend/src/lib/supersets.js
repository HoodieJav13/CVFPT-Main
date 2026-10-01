// Supersets and giant sets. Consecutive workout exercises that share a
// superset_group key form one group: two exercises are a superset, three or
// more a giant set. The builder sends any opaque key per row; before every
// save the keys are normalized to the stored form — sequential letters
// ("A", "B", ...) for each contiguous run of two or more, null for every
// straight set — so the column never holds a one-member group or a label
// split across non-adjacent rows. The browser display helpers live in
// frontend/src/lib/supersets.js (duplicated across the deploy boundary).

const MAX_LABELS = 26 * 27; // "A".."Z", then "AA".."ZZ" (the column allows 1-2 letters)

function supersetLabel(index) {
  if (index < 26) return String.fromCharCode(65 + index);
  const rest = index - 26;
  return String.fromCharCode(65 + Math.floor(rest / 26)) + String.fromCharCode(65 + (rest % 26));
}

// Mirrors save_workout's keep rule so a blank row the RPC drops can't
// bridge (or split) a group.
function isKeptExercise(exercise) {
  if (!exercise || typeof exercise !== 'object') return false;
  if (exercise.exercise_library_id) return true;
  return String(exercise.custom_name ?? exercise.name ?? '').trim() !== '';
}

function groupKey(exercise) {
  const value = exercise.superset_group;
  if (value === null || value === undefined) return null;
  const key = String(value).trim().slice(0, 64);
  return key || null;
}

function normalizeSupersetGroups(exercises) {
  if (!Array.isArray(exercises)) return exercises;
  const result = exercises.map((exercise) => (
    exercise && typeof exercise === 'object' ? { ...exercise, superset_group: null } : exercise
  ));
  const kept = [];
  exercises.forEach((exercise, index) => {
    if (isKeptExercise(exercise)) kept.push({ index, key: groupKey(exercise) });
  });
  let next = 0;
  let start = 0;
  while (start < kept.length) {
    let end = start + 1;
    const key = kept[start].key;
    if (key !== null) {
      while (end < kept.length && kept[end].key === key) end += 1;
    }
    if (end - start >= 2 && next < MAX_LABELS) {
      const label = supersetLabel(next);
      next += 1;
      for (let i = start; i < end; i += 1) result[kept[i].index].superset_group = label;
    }
    start = end;
  }
  return result;
}

// Display: contiguous runs of the same label are one block. Blocks are what
// the coach and client see as "Superset" (2) or "Giant set" (3+).
function supersetBlocks(exercises) {
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
    return { ...block, kind };
  });
}

// Per-exercise markers in program-sheet notation. A workout without groups
// keeps plain numbering (1, 2, 3); with any group, every block is lettered
// and group members are numbered within it (A, B1, B2, C).
function exerciseMarkers(exercises) {
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

// A group rests once per round, for the longest structured rest on any
// member — the same rule as the tracker (frontend restAfterSet).
function roundRestSeconds(members) {
  return (members || []).reduce((max, exercise) => Math.max(max, Number(exercise?.rest_seconds) || 0), 0);
}

// Mirrors frontend/src/lib/rest.js formatRestSeconds.
function formatRestSeconds(seconds) {
  if (seconds == null) return '';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}:${String(remainder).padStart(2, '0')}` : `${minutes} min`;
}

module.exports = {
  exerciseMarkers, formatRestSeconds, normalizeSupersetGroups, roundRestSeconds, supersetBlocks, supersetLabel,
};
