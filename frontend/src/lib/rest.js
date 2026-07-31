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
