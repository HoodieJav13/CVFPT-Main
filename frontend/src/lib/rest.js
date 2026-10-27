/**
 * Structured rest (roadmap item 12): the numeric database columns
 * (workout_exercises.rest_seconds / workout_log_exercises.
 * prescribed_rest_seconds) are canonical. This module formats seconds for
 * display, and parses LEGACY free text only so the builder can prefill its
 * numeric input during the transition — the tracker never parses text.
 * Mirrors public.parse_rest_seconds, including the 0..36000s sanity range.
 */

function withinRange(seconds) {
  return Number.isFinite(seconds) && seconds >= 0 && seconds <= 36000 ? seconds : null;
}

export function parseRestSeconds(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return null;
  const clock = text.match(/^(\d+):(\d{1,2})$/);
  if (clock) return withinRange((Number(clock[1]) * 60) + Number(clock[2]));
  const minutes = text.match(/([\d.]+)\s*(?:m|min|mins|minute|minutes)/);
  const seconds = text.match(/([\d.]+)\s*(?:s|sec|secs|second|seconds)/);
  if (minutes || seconds) {
    return withinRange(Math.round((Number(minutes?.[1] || 0) * 60) + Number(seconds?.[1] || 0)));
  }
  if (/^\d+$/.test(text)) return withinRange(Number(text));
  return null;
}

export function formatRestSeconds(seconds) {
  if (seconds == null) return '';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}:${String(remainder).padStart(2, '0')}` : `${minutes} min`;
}

export const DEFAULT_MANUAL_REST_SECONDS = 90;
export const REST_ADJUST_SECONDS = 15;
const MAX_REST_SECONDS = 36000;

/**
 * Manual "Start rest": the current exercise's structured rest, or 90s when
 * the coach left rest blank (the auto-timer never runs in that case).
 */
export function manualRestSeconds(exercise) {
  const seconds = Number(exercise?.prescribed_rest_seconds);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, MAX_REST_SECONDS) : DEFAULT_MANUAL_REST_SECONDS;
}

/**
 * ±15s on a running timer. Subtracting past zero finishes the rest now
 * (never an end time in the past); adding is capped at the 10-hour rest
 * range the database also enforces.
 */
export function adjustRestEnd(endsAt, deltaSeconds, now = Date.now()) {
  const next = endsAt + (deltaSeconds * 1000);
  return Math.min(Math.max(next, now), now + (MAX_REST_SECONDS * 1000));
}
