const DEFAULT_TZ = 'America/Denver';

/** Returns YYYY-MM-DD for the current date in the given IANA timezone. */
function todayDateInTz(tz = DEFAULT_TZ) {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(now);
}

/** Returns [startISO, endISO] of 'today' in the given IANA timezone (default America/Denver). */
function todayRangeInTz(tz = DEFAULT_TZ) {
  const now = new Date();
  const localDate = todayDateInTz(tz);
  // Find the UTC instant of local midnight by checking the tz offset at now
  const offsetFmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' });
  const tzName = offsetFmt.formatToParts(now).find((p) => p.type === 'timeZoneName')?.value || 'GMT-07:00';
  const m = tzName.match(/GMT([+-])(\d{2}):(\d{2})/);
  let offsetMinutes = -420;
  if (m) {
    offsetMinutes = (m[1] === '-' ? -1 : 1) * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10));
  }
  const startUtc = new Date(new Date(`${localDate}T00:00:00.000Z`).getTime() - offsetMinutes * 60000);
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);
  return [startUtc.toISOString(), endUtc.toISOString()];
}

/** Shifts a YYYY-MM-DD date string by whole days. Pure date arithmetic. */
function shiftDate(dateStr, days) {
  const base = new Date(`${dateStr}T00:00:00.000Z`).getTime();
  return new Date(base + days * 86400000).toISOString().slice(0, 10);
}

/** Returns YYYY-MM-DD for an instant, as seen in the given timezone. */
function dateInTz(instant, tz = DEFAULT_TZ) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(instant instanceof Date ? instant : new Date(instant));
}

/** UTC offset in minutes (negative west of UTC) for an instant in the given IANA zone. */
function tzOffsetMinutes(instantMs, tz = DEFAULT_TZ) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
    .formatToParts(new Date(instantMs));
  const name = parts.find((part) => part.type === 'timeZoneName')?.value || 'GMT';
  const match = name.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  if (!match) return 0;
  return (match[1] === '-' ? -1 : 1) * (parseInt(match[2], 10) * 60 + parseInt(match[3] || '0', 10));
}

const WALL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WALL_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Converts a wall-clock date + time in `tz` to a UTC ISO string, or null when
 * the input is malformed or not a real calendar date.
 *  - Spring-forward gap (the wall-clock time does not exist): resolves forward
 *    by the gap, e.g. 2:30 -> 3:30.
 *  - Fall-back ambiguity (the time happens twice): picks the first occurrence
 *    (the earlier instant, daylight time).
 */
function denverWallClockToUtc(dateStr, timeStr, tz = DEFAULT_TZ) {
  if (typeof dateStr !== 'string' || typeof timeStr !== 'string') return null;
  const d = dateStr.match(WALL_DATE);
  const t = timeStr.match(WALL_TIME);
  if (!d || !t) return null;
  const [year, month, day] = [Number(d[1]), Number(d[2]), Number(d[3])];
  const [hour, minute] = [Number(t[1]), Number(t[2])];
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(naive);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;

  const offsetBefore = tzOffsetMinutes(naive - 86400000, tz);
  const offsetAfter = tzOffsetMinutes(naive + 86400000, tz);
  const valid = [...new Set([offsetBefore, offsetAfter])]
    .map((offset) => naive - offset * 60000)
    .filter((utc) => naive - utc === tzOffsetMinutes(utc, tz) * 60000);
  const instant = valid.length ? Math.min(...valid) : naive - offsetBefore * 60000;
  return new Date(instant).toISOString();
}

/** e.g. "Tue, Oct 6, 5:00 PM" — the same shape the notification emails use. */
function formatDenverDisplay(instant, tz = DEFAULT_TZ) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(instant instanceof Date ? instant : new Date(instant));
}

/** "HH:mm" (24-hour) for an instant, as seen in the given timezone. */
function denverTimeOfDay(instant, tz = DEFAULT_TZ) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(instant instanceof Date ? instant : new Date(instant));
}
module.exports = {
  todayRangeInTz, todayDateInTz, shiftDate, dateInTz, DEFAULT_TZ,
  denverWallClockToUtc, formatDenverDisplay, denverTimeOfDay,
};
