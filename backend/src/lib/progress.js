const IMPROVEMENT_DIRECTIONS = new Set(['higher', 'lower', 'neutral']);

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
  bestEntry,
  personalBestResult,
  metricProgressSummary,
};
