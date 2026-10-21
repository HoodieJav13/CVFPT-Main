// "Same as last time" source display: what the existing fill would copy, shown
// before the tap (a dated reference line) and after it (a local note). Reads
// only the history occurrence the button already uses; never changes fill rules.
import { fmtDate } from './format.js';
import { trackingType, tracks } from './workoutMetrics.js';

// The fill's own choice: the most recent occurrence (history is newest first)
// with the same tracking type. The line and the fill must never disagree.
export function pickLastTimeOccurrence(occurrences, exercise) {
  return (occurrences || []).find((row) => trackingType(row) === trackingType(exercise)) || null;
}

const shown = (value, suffix = '') => (value === null || value === undefined || value === '' ? '—' : `${value}${suffix}`);

// One set as performed last time, e.g. "35 lb × 10", "— × 12", "20 min · 3 km".
export function lastTimeSetText(set, occurrence) {
  if (trackingType(occurrence) === 'reps_weight') {
    const load = set.actual_load_value === null || set.actual_load_value === undefined
      ? '—' : `${set.actual_load_value} ${set.actual_load_unit || 'lb'}`;
    return `${load} × ${shown(set.actual_reps)}`;
  }
  return ['duration', 'distance'].filter((metric) => tracks(occurrence, metric))
    .map((metric) => shown(set[`actual_${metric}_value`], set[`actual_${metric}_unit`] ? ` ${set[`actual_${metric}_unit`]}` : ''))
    .join(' · ');
}

export function lastTimeDate(occurrence) {
  return fmtDate(occurrence?.completed_at);
}

export function lastTimeLine(occurrence) {
  const sets = [...(occurrence?.sets || [])].sort((a, b) => a.set_number - b.set_number);
  return ['Last time', lastTimeDate(occurrence), ...sets.map((set) => lastTimeSetText(set, occurrence))].join(' · ');
}

// "set 2", "sets 1–3", "sets 1, 3, 5", "sets 1–2, 4".
export function filledSetsLabel(setNumbers) {
  const sorted = [...new Set(setNumbers)].sort((a, b) => a - b);
  if (sorted.length === 1) return `set ${sorted[0]}`;
  const runs = [];
  sorted.forEach((n) => {
    const run = runs[runs.length - 1];
    if (run && n === run[1] + 1) run[1] = n; else runs.push([n, n]);
  });
  return `sets ${runs.map(([a, b]) => (a === b ? `${a}` : b === a + 1 ? `${a}, ${b}` : `${a}–${b}`)).join(', ')}`;
}

export function lastTimeFillNote(setNumbers, occurrence) {
  return `Filled ${filledSetsLabel(setNumbers)} from ${lastTimeDate(occurrence)}. Typed values kept.`;
}
