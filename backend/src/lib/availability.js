const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Weekly-template and override windows share one shape. Capacity stays
// clamped small (A8: group slots deferred; the column exists for later).
function validateWindow(row = {}, { requireDate = false } = {}) {
  if (requireDate) {
    if (!DATE_RE.test(String(row.on_date || ''))) return { ok: false, error: 'A date (YYYY-MM-DD) is required' };
  } else {
    const weekday = Number(row.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      return { ok: false, error: 'Weekday must be 0 (Sunday) through 6 (Saturday)' };
    }
  }
  if (!TIME_RE.test(String(row.start_time || '')) || !TIME_RE.test(String(row.end_time || ''))) {
    return { ok: false, error: 'Start and end must be HH:MM times' };
  }
  if (String(row.end_time) <= String(row.start_time)) {
    return { ok: false, error: 'End time must be after start time' };
  }
  const capacity = row.capacity === undefined || row.capacity === null ? 1 : Number(row.capacity);
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 10) {
    return { ok: false, error: 'Capacity must be between 1 and 10' };
  }
  const value = { start_time: row.start_time, end_time: row.end_time, capacity };
  if (requireDate) value.on_date = row.on_date;
  else value.weekday = Number(row.weekday);
  return { ok: true, value };
}

function validateTimeOff(body = {}) {
  const starts = new Date(body.starts_at || '');
  const ends = new Date(body.ends_at || '');
  if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime())) {
    return { ok: false, error: 'Start and end date-times are required' };
  }
  if (ends <= starts) return { ok: false, error: 'Time off must end after it starts' };
  return { ok: true, value: { starts_at: starts.toISOString(), ends_at: ends.toISOString() } };
}

function validateSlotQuery(query = {}) {
  const duration = Number(query.duration);
  if (!Number.isInteger(duration) || duration < 15 || duration > 240) {
    return { ok: false, error: 'A session duration is required' };
  }
  const from = query.from && DATE_RE.test(query.from) ? query.from : null;
  const to = query.to && DATE_RE.test(query.to) ? query.to : null;
  return { ok: true, value: { duration, from, to } };
}

module.exports = { validateWindow, validateTimeOff, validateSlotQuery };
