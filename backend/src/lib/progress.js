const IMPROVEMENT_DIRECTIONS = new Set(['higher', 'lower', 'neutral']);

// Coach-set goal for a metric (owner decision: coach-set, client-visible).
// Empty/null clears the goal; anything non-numeric is rejected.
function normalizeTargetValue(raw) {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: null };
  const value = Number(raw);
  return Number.isFinite(value) ? { ok: true, value } : { ok: false, value: null };
}

function normalizeImprovementDirection(value) {
  return IMPROVEMENT_DIRECTIONS.has(value) ? value : 'neutral';
}

function numericEntries(entries = [], ignoredId = null) {
  return entries
    .filter((entry) => !entry.archived && entry.id !== ignoredId)
    .map((entry) => ({ ...entry, numericValue: Number(entry.value) }))
    .filter((entry) => Number.isFinite(entry.numericValue));
}

function bestEntry(entries = [], direction = 'neutral', ignoredId = null) {
  const normalizedDirection = normalizeImprovementDirection(direction);
  if (normalizedDirection === 'neutral') return null;

  const candidates = numericEntries(entries, ignoredId);
  if (!candidates.length) return null;

  return candidates.reduce((best, candidate) => {
    if (normalizedDirection === 'higher') {
      return candidate.numericValue > best.numericValue ? candidate : best;
    }
    return candidate.numericValue < best.numericValue ? candidate : best;
  });
}

function personalBestResult(entries = [], direction = 'neutral', value, ignoredId = null) {
  const normalizedDirection = normalizeImprovementDirection(direction);
  const numericValue = Number(value);
  const previousBest = bestEntry(entries, normalizedDirection, ignoredId);

  if (normalizedDirection === 'neutral' || !Number.isFinite(numericValue) || !previousBest) {
    return {
      isPersonalBest: false,
      previousBestValue: previousBest?.numericValue ?? null,
      improvementAmount: null,
    };
  }

  const isPersonalBest = normalizedDirection === 'higher'
    ? numericValue > previousBest.numericValue
    : numericValue < previousBest.numericValue;

  return {
    isPersonalBest,
    previousBestValue: previousBest.numericValue,
    improvementAmount: isPersonalBest
      ? Math.abs(numericValue - previousBest.numericValue)
      : null,
  };
}

function metricProgressSummary(metric, entries = []) {
  const direction = normalizeImprovementDirection(metric.improvement_direction);
  const currentBest = bestEntry(entries, direction);
  const latest = entries[entries.length - 1] || null;
  const latestResult = latest
    ? personalBestResult(entries, direction, latest.value, latest.id)
    : { isPersonalBest: false };

  return {
    ...metric,
    improvement_direction: direction,
    entries,
    best_value: currentBest?.numericValue ?? null,
    latest_is_personal_best: Boolean(latest && latestResult.isPersonalBest),
  };
}

module.exports = {
  IMPROVEMENT_DIRECTIONS,
  normalizeImprovementDirection,
  normalizeTargetValue,
  bestEntry,
  personalBestResult,
  metricProgressSummary,
};
