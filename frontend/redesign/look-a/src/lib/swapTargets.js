// Look A swap targets (2026-11-14; LOOK-A-INTEGRATION-REVIEW.md case 4).
// A coach backup carries its saved replacement facts: the load unit (kg stays
// kg), an upper load (a range) and per side. What the person keeps or changes
// in the swap dialog is sent; what they cannot change (unit, per side) comes
// from the backup. Changing the load makes it one number: the coach's range is
// not stretched over a value they did not prescribe. A suggestion never copies
// numbers, and a load typed for it is lb (the default for new inputs).
// The server applies the same rule to older queued payloads
// (backend/src/lib/sessionEvents.js backupTargets).
const filled = (value) => String(value ?? '').trim() !== '';

// Owner decision (2026-11-14, handoff c): a coach backup chosen mid-exercise
// gets its own prescribed set count minus the sets already completed or
// skipped on the old exercise, minimum 1. Fixed, not typed. The old
// exercise's rows are never changed. A backup without its own valid set
// count has no count (null): it cannot be used, and no count is taken from
// the old exercise or typed (Jav, 2026-11-14). The server decides it again.
export function backupSetCount(savedTargets, oldExercise) {
  const own = Number(savedTargets?.sets);
  if (!Number.isInteger(own) || own < 1) return null;
  const touched = (oldExercise?.sets || []).filter((set) => !set.archived && (set.status === 'completed' || set.status === 'skipped')).length;
  return Math.max(1, own - touched);
}

export const MISSING_BACKUP_SETS = 'Your coach has not set how many sets this backup has, so it cannot be swapped in. Ask your coach, or pick another option.';

export function swapRequestTargets(choice, oldExercise) {
  const typed = choice?.targets || {};
  const saved = choice?.kind === 'backup' ? choice.item?.targets || {} : {};
  const out = {};
  if (choice?.kind === 'backup') {
    const count = backupSetCount(saved, oldExercise);
    if (count !== null) out.sets = count;
  }
  else if (filled(typed.sets)) out.sets = Number(typed.sets);
  if (filled(typed.reps)) out.reps = String(typed.reps).trim();
  if (filled(typed.load_value)) {
    out.load_value = Number(typed.load_value);
    out.load_unit = saved.load_value != null && saved.load_unit ? saved.load_unit : 'lb';
    if (saved.load_max != null && Number(saved.load_value) === out.load_value && Number(saved.load_max) > out.load_value) out.load_max = Number(saved.load_max);
  }
  if (saved.per_side === true) out.per_side = true;
  return out;
}

export function swapLoadUnit(choice) {
  const saved = choice?.kind === 'backup' ? choice.item?.targets || {} : {};
  return saved.load_value != null && saved.load_unit ? saved.load_unit : 'lb';
}

// "3 sets × 8 reps × 30–35 kg per side"; never a number that was not saved.
export function swapTargetsText(targets = {}) {
  const load = targets.load_value != null
    ? `${targets.load_value}${targets.load_max != null && Number(targets.load_max) > Number(targets.load_value) ? `–${targets.load_max}` : ''} ${targets.load_unit || 'lb'}${targets.per_side ? ' per side' : ''}`
    : (targets.per_side ? 'per side' : null);
  const parts = [targets.sets && `${targets.sets} sets`, targets.reps && `${targets.reps} reps`, load].filter(Boolean);
  return parts.length ? parts.join(' × ') : 'No targets set';
}
