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
// Library text is free-form ("DB,KB,BB", "Hip"/"Hips"), so filter options and
// matching use canonical names. Stored values and the exercise cards are never
// rewritten; unrecognised values pass through trimmed so custom entries still
// get a filter option.
const MUSCLE_ALIASES = {
  back: 'Back', lats: 'Back', lat: 'Back', 'mid-back': 'Back', 'mid back': 'Back', 'low back': 'Back', 'lower back': 'Back', 'upper back': 'Back',
  shoulder: 'Shoulders', shoulders: 'Shoulders', delts: 'Shoulders', deltoids: 'Shoulders',
  hip: 'Hips', hips: 'Hips',
  quad: 'Quads', quads: 'Quads', quadriceps: 'Quads', 'quad & knee': 'Quads',
  calf: 'Calves & Ankles', calves: 'Calves & Ankles', ankle: 'Calves & Ankles', ankles: 'Calves & Ankles',
  'calf & ankle': 'Calves & Ankles', 'calves/ankles': 'Calves & Ankles', 'calves & ankles': 'Calves & Ankles',
  trap: 'Traps', traps: 'Traps',
  glute: 'Glutes', glutes: 'Glutes',
  hamstring: 'Hamstrings', hamstrings: 'Hamstrings',
  bicep: 'Biceps', biceps: 'Biceps',
  tricep: 'Triceps', triceps: 'Triceps',
  ab: 'Core', abs: 'Core', core: 'Core',
  chest: 'Chest', pecs: 'Chest',
  'total body': 'Total Body', 'full body': 'Total Body',
};

const EQUIPMENT_ALIASES = {
  db: 'Dumbbell', dumbbell: 'Dumbbell', dumbbells: 'Dumbbell',
  kb: 'Kettlebell', kettlebell: 'Kettlebell', kettlebells: 'Kettlebell',
  bb: 'Barbell', barbell: 'Barbell', barbells: 'Barbell',
  band: 'Bands', bands: 'Bands', 'r - band': 'Bands', 'r- band': 'Bands', 'r-band': 'Bands', 'r band': 'Bands',
  'r - band (hoop)': 'Bands', 'hip (loop) bands': 'Bands', 'loop band': 'Bands', 'loop bands': 'Bands', 'resistance band': 'Bands', 'resistance bands': 'Bands',
  'bosu ball': 'Bosu Ball', bosu: 'Bosu Ball',
  'balance disc': 'Balance Pad', 'dyna disc': 'Balance Pad', 'airex pad': 'Balance Pad', 'balance pad': 'Balance Pad',
  'med ball': 'Med Ball', 'medicine ball': 'Med Ball',
  'lacrosse ball': 'Lacrosse Ball',
  cable: 'Cables', cables: 'Cables',
  rack: 'Squat Rack', 'squat rack': 'Squat Rack',
  box: 'Box/Step', step: 'Box/Step',
  wall: 'Wall', chair: 'Chair', pole: 'Pole', plate: 'Plate', machine: 'Machine', trx: 'TRX', pool: 'Pool', towel: 'Towel',
  'foam roller': 'Foam Roller', 'tennis ball': 'Tennis Ball', 'agility ladder': 'Agility Ladder', hurdle: 'Hurdle',
  bodyweight: 'Bodyweight', bw: 'Bodyweight',
};

const lookup = (aliases, value) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return aliases[text.toLowerCase()] || text;
};

export function canonicalMuscle(value) {
  return lookup(MUSCLE_ALIASES, value);
}

// Splits on commas, slashes, "+" and "w/" ("KB w/Band" is KB and Bands), then
// canonicalises each item and drops repeats.
export function equipmentItems(value) {
  const items = String(value || '')
    .split(/\s*(?:,|\/|\+|\bw\/)\s*/i)
    .map((part) => lookup(EQUIPMENT_ALIASES, part))
    .filter(Boolean);
  return [...new Set(items)];
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
  return {
    categories: distinctSorted(rows.map((row) => String(row.category || '').trim()).filter(Boolean)),
    muscles: distinctSorted(rows.map((row) => canonicalMuscle(row.primary_muscle)).filter(Boolean)),
    equipment: distinctSorted(rows.flatMap((row) => equipmentItems(row.equipment))),
  };
}

// category / muscle / equipment are 'all' or a value from exerciseFilterOptions.
export function filterExercises(rows, { search = '', category = 'all', muscle = 'all', equipment = 'all' } = {}) {
  const query = search.trim().toLowerCase();
  const same = (a, b) => String(a || '').trim().toLowerCase() === b.toLowerCase();
  return rows.filter((row) => {
    if (category !== 'all' && !same(row.category, category)) return false;
    if (muscle !== 'all' && !same(canonicalMuscle(row.primary_muscle), muscle)) return false;
    if (equipment !== 'all' && !equipmentItems(row.equipment).some((item) => same(item, equipment))) return false;
    if (!query) return true;
    return [row.name, row.category, row.equipment, row.primary_muscle].join(' ').toLowerCase().includes(query);
  });
}
