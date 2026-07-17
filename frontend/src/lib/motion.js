export const MOTION_EASINGS = {
  expressiveOut: [0.22, 1, 0.36, 1],
  chartOut: 'ease-out',
  highlightOut: 'easeOut',
  highlightPop: 'backOut',
};

export const PAGE_ENTRANCE_MOTION = {
  restrained: { durationMs: 340, distance: 5, staggerMs: 45, scale: 1 },
  cinematic: { durationMs: 520, distance: 11, staggerMs: 75, scale: 0.995 },
  spectacle: { durationMs: 680, distance: 18, staggerMs: 110, scale: 0.985 },
  authDurationOffsetMs: 120,
  maxStaggerDelayMs: 550,
};

export const ACHIEVEMENT_MOTION = {
  restrained: { distance: 5, durationMs: 350 },
  cinematic: { distance: 12, durationMs: 520 },
  spectacle: { distance: 22, durationMs: 700 },
};

export const CHART_MOTION = {
  drawDurationMs: {
    restrained: 650,
    cinematic: 820,
    spectacle: 1000,
  },
  pulseDurationMs: 700,
  dotDurationMs: 320,
};

export function msToSeconds(milliseconds) {
  return milliseconds / 1000;
}
