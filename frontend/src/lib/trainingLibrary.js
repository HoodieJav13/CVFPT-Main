// Coach-facing helpers for the shared training library (templates + variations).
// The same author-filter rules live in backend/src/lib/trainingLibrary.js; the
// two trees are deployed separately, so the small pure logic is duplicated.

// Nest variations under their root template. A variation whose root is not in
// the list (archived, or filtered away) is promoted to the top level.
export function groupVariations(rows) {
  const ids = new Set(rows.map((row) => row.id));
  const childrenOf = new Map();
  const roots = [];
  for (const row of rows) {
    if (row.variation_of && ids.has(row.variation_of)) {
      if (!childrenOf.has(row.variation_of)) childrenOf.set(row.variation_of, []);
      childrenOf.get(row.variation_of).push(row);
    } else {
      roots.push(row);
    }
  }
  return roots.map((root) => ({ item: root, children: childrenOf.get(root.id) || [] }));
}

// 'all' | 'me' | <coach id>. A matching root keeps all of its variations; a
// matching variation keeps its root as context but not its siblings.
export function filterByAuthor(rows, author, myCoachId) {
  if (!author || author === 'all') return rows;
  const wanted = author === 'me' ? myCoachId : author;
  if (!wanted) return rows;
  const byId = new Map(rows.map((row) => [row.id, row]));
  const matchedRoots = new Set();
  const keep = new Set();
  for (const row of rows) {
    if (row.created_by !== wanted) continue;
    keep.add(row.id);
    if (!row.variation_of) matchedRoots.add(row.id);
    else if (byId.has(row.variation_of)) keep.add(row.variation_of);
  }
  for (const row of rows) {
    if (row.variation_of && matchedRoots.has(row.variation_of)) keep.add(row.id);
  }
  return rows.filter((row) => keep.has(row.id));
}

// Distinct publishers present in the (unfiltered) rows, by name.
export function authorOptions(rows) {
  const seen = new Map();
  for (const row of rows) {
    if (row.author?.id && !seen.has(row.author.id)) seen.set(row.author.id, row.author.name);
  }
  return [...seen.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function isLegacyLockError(error) {
  return error?.response?.status === 409 && error.response?.data?.code === 'LEGACY_ASSIGNMENTS';
}

// ----- Exercise library filters -----
// Equipment is free text ("DB,KB,BB", "Box/Step + KB"), so it is split into
// individual items for the filter; an exercise matches when any item matches.
export function splitEquipment(value) {
  return String(value || '').split(/[,/]/).map((part) => part.trim()).filter(Boolean);
}

function distinctSorted(values) {
  const seen = new Map();
  for (const value of values) {
    const key = value.toLowerCase();
    if (!seen.has(key)) seen.set(key, value);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

export function exerciseFilterOptions(rows) {
  const clean = (value) => String(value || '').trim();
  return {
    categories: distinctSorted(rows.map((row) => clean(row.category)).filter(Boolean)),
    muscles: distinctSorted(rows.map((row) => clean(row.primary_muscle)).filter(Boolean)),
    equipment: distinctSorted(rows.flatMap((row) => splitEquipment(row.equipment))),
  };
}

// category / muscle / equipment are 'all' or a value from exerciseFilterOptions.
export function filterExercises(rows, { search = '', category = 'all', muscle = 'all', equipment = 'all' } = {}) {
  const query = search.trim().toLowerCase();
  const same = (a, b) => String(a || '').trim().toLowerCase() === b.toLowerCase();
  return rows.filter((row) => {
    if (category !== 'all' && !same(row.category, category)) return false;
    if (muscle !== 'all' && !same(row.primary_muscle, muscle)) return false;
    if (equipment !== 'all' && !splitEquipment(row.equipment).some((item) => same(item, equipment))) return false;
    if (!query) return true;
    return [row.name, row.category, row.equipment, row.primary_muscle].join(' ').toLowerCase().includes(query);
  });
}
