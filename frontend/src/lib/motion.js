export const MOTION_EASINGS = {
  expressiveOut: [0.22, 1, 0.36, 1],
  chartOut: 'ease-out',
  highlightOut: 'easeOut',
  highlightPop: 'backOut',
};

export const PAGE_ENTRANCE_MOTION = {
  restrained: { durationMs: 340, distance: 5, staggerMs: 45, scale: 1 },
  cinematic: { durationMs: 520, distance: 11, staggerMs: 75, scale: 0.995 },
  spectacle: { durationMs: 760, distance: 48, staggerMs: 130, scale: 1.03 },
  authDurationOffsetMs: 120,
  maxStaggerDelayMs: 550,
};

export const ACHIEVEMENT_MOTION = {
  restrained: { distance: 5, durationMs: 350 },
  cinematic: { distance: 12, durationMs: 520 },
  spectacle: { distance: 22, durationMs: 700 },
};

export const PERSONAL_RECORD_MOTION = {
  restrained: { ...ACHIEVEMENT_MOTION.restrained, initialScale: 1 },
  cinematic: { ...ACHIEVEMENT_MOTION.cinematic, initialScale: 0.94 },
  spectacle: { ...ACHIEVEMENT_MOTION.spectacle, distance: 0, durationMs: 860, initialScale: 0.82 },
};

export const WORKOUT_COMPLETION_MOTION = {
  restrained: { ...ACHIEVEMENT_MOTION.restrained, initialScale: 1 },
  cinematic: { ...ACHIEVEMENT_MOTION.cinematic, initialScale: 0.99 },
  spectacle: { ...ACHIEVEMENT_MOTION.spectacle, initialScale: 0.98 },
};

export const ATTENTION_FEEDBACK_MOTION = {
  restrained: { scale: 1 },
  cinematic: { scale: 1.03 },
  spectacle: { scale: 1.05 },
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
