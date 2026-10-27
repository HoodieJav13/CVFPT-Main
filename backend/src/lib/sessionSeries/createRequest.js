const { validateUuid, validateOptionalText } = require('../../validation/business');
const { validateSlotShapes, isRealDate, isTime } = require('./rule');

const invalid = (error) => ({ ok: false, error });

// The stored/displayed copy of the repeat pattern. Display-only: it is never used
// to regenerate sessions, so only its shape is checked here.
function parseRuleDisplay(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid('Repeat settings are required');
  if (!isRealDate(raw.start_date)) return invalid('Start date must be a valid date');
  if (!isTime(raw.time)) return invalid('Time must be HH:mm');
  if (!Array.isArray(raw.weekdays) || !raw.weekdays.length || !raw.weekdays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) {
    return invalid('Choose one or more weekdays');
  }
  if (raw.interval_weeks !== 1 && raw.interval_weeks !== 2) return invalid('Repeat every 1 or 2 weeks');
  if (!raw.end || typeof raw.end !== 'object' || Array.isArray(raw.end)) return invalid('Choose how the series ends');
  const end = Object.hasOwn(raw.end, 'count') ? { count: raw.end.count } : { until: raw.end.until };
  if (end.count !== undefined && !Number.isInteger(end.count)) return invalid('End count must be a whole number');
  if (end.until !== undefined && !isRealDate(end.until)) return invalid('End date must be a valid date');
  return {
    ok: true,
    value: { start_date: raw.start_date, time: raw.time, weekdays: [...raw.weekdays].sort((a, b) => a - b), interval_weeks: raw.interval_weeks, end },
  };
}

// Shape validation ONLY. Time-sensitive and record-eligibility checks (past dates,
// archived workouts/programs, client access) happen later, and only for new
// operations, so a saved request stays recoverable by retry.
function parseCreateRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return invalid('Request body must be a JSON object');
  const requestId = validateUuid(body.request_id, 'Request ID');
  if (!requestId.ok) return invalid(requestId.error);
  const clientId = validateUuid(body.client_id, 'Client ID');
  if (!clientId.ok) return invalid(clientId.error);
  if (!Number.isInteger(body.duration_minutes) || body.duration_minutes < 15 || body.duration_minutes > 240) {
    return invalid('Duration must be a whole number between 15 and 240 minutes');
  }
  const location = validateOptionalText(body.location, 'Location');
  if (!location.ok) return invalid(location.error);
  const rule = parseRuleDisplay(body.rule);
  if (!rule.ok) return invalid(rule.error);
  const slots = validateSlotShapes(body.slots);
  if (!slots.ok) return invalid(slots.error);

  let programId = null;
  if (body.program_id !== undefined && body.program_id !== null) {
    const program = validateUuid(body.program_id, 'Program ID');
    if (!program.ok) return invalid(program.error);
    programId = program.value;
  }
  for (const flag of ['assign_program', 'notify']) {
    if (Object.hasOwn(body, flag) && typeof body[flag] !== 'boolean') return invalid(`${flag === 'notify' ? 'Notify' : 'Assign program'} must be true or false`);
  }
  const value = {
    request_id: requestId.value,
    client_id: clientId.value,
    duration_minutes: body.duration_minutes,
    location: location.value,
    rule: rule.value,
    slots: slots.value,
    program_id: programId,
    assign_program: body.assign_program === true,
    notify: body.notify !== false,
  };
  return { ok: true, value, normalized: value };
}

module.exports = { parseCreateRequest };
