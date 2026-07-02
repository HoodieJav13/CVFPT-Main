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

module.exports = { todayRangeInTz, todayDateInTz };
