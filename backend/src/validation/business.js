function invalid(error) {
  return { ok: false, error };
}

function valid(value) {
  return { ok: true, value };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_STATUSES = new Set(['scheduled', 'completed', 'cancelled']);
const BOOKING_STATUSES = new Set(['pending', 'approved', 'declined']);

function validateUuid(value, label = 'ID') {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    return invalid(`${label} must be a valid UUID`);
  }
  return valid(value);
}

function validateOptionalText(value, label) {
  if (value === undefined || value === null || value === '') return valid(null);
  if (typeof value !== 'string') return invalid(`${label} must be text`);
  return valid(value.trim() || null);
}

function validateTimestamp(value, label = 'Date/time') {
  if (typeof value !== 'string' || !value.trim()) return invalid(`${label} must be a valid date and time`);
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return invalid(`${label} must be a valid date and time`);
  return valid(timestamp.toISOString());
}

function validatePackagePayload(body = {}, { partial = false } = {}) {
  const value = {};
  if (!partial && (!Object.hasOwn(body, 'name') || !Object.hasOwn(body, 'price'))) {
    return invalid('Name and price are required');
  }
  if (Object.hasOwn(body, 'name')) {
    const name = String(body.name || '').trim();
    if (!name || name.length > 120) return invalid('Name must be between 1 and 120 characters');
    value.name = name;
  }
  if (Object.hasOwn(body, 'description')) {
    const description = body.description ? String(body.description).trim() : null;
    if (description && description.length > 2_000) return invalid('Description must be 2,000 characters or fewer');
    value.description = description;
  }
  if (Object.hasOwn(body, 'price')) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0) return invalid('Price must be a non-negative number');
    value.price = price;
  }
  if (Object.hasOwn(body, 'session_credits')) {
    const credits = Number(body.session_credits);
    if (!Number.isInteger(credits) || credits < 0 || credits > 10_000) {
      return invalid('Session credits must be a whole number between 0 and 10,000');
    }
    value.session_credits = credits;
  } else if (!partial) {
    value.session_credits = 0;
  }
  if (Object.hasOwn(body, 'is_recurring')) value.is_recurring = Boolean(body.is_recurring);
  if (partial && !Object.keys(value).length) return invalid('Provide at least one package field to update');
  return valid(value);
}

function validateSchedulePayload(body = {}, { requireDate = false } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return invalid('Request body must be a JSON object');
  const value = {};
  if (requireDate && !body.scheduled_at) return invalid('Client and date/time are required');
  if (Object.hasOwn(body, 'scheduled_at')) {
    const timestamp = validateTimestamp(body.scheduled_at, 'Date/time');
    if (!timestamp.ok) return invalid('Enter a valid date and time');
    value.scheduled_at = timestamp.value;
  }
  if (Object.hasOwn(body, 'duration_minutes')) {
    if (!Number.isInteger(body.duration_minutes) || body.duration_minutes < 15 || body.duration_minutes > 240) {
      return invalid('Duration must be a whole number between 15 and 240 minutes');
    }
    value.duration_minutes = body.duration_minutes;
  } else if (requireDate) {
    value.duration_minutes = 60;
  }
  return valid(value);
}

function validateSessionListQuery(query = {}) {
  const value = {};
  if (Object.hasOwn(query, 'client_id')) {
    const clientId = validateUuid(query.client_id, 'Client ID');
    if (!clientId.ok) return clientId;
    value.client_id = clientId.value;
  }
  if (Object.hasOwn(query, 'status')) {
    if (typeof query.status !== 'string' || !SESSION_STATUSES.has(query.status)) {
      return invalid('Status must be scheduled, completed, or cancelled');
    }
    value.status = query.status;
  }
  for (const field of ['from', 'to']) {
    if (!Object.hasOwn(query, field)) continue;
    const timestamp = validateTimestamp(query[field], field === 'from' ? 'From' : 'To');
    if (!timestamp.ok) return timestamp;
    value[field] = timestamp.value;
  }
  return valid(value);
}

function validateBookingListQuery(query = {}) {
  const value = {};
  if (Object.hasOwn(query, 'status')) {
    if (typeof query.status !== 'string' || !BOOKING_STATUSES.has(query.status)) {
      return invalid('Status must be pending, approved, or declined');
    }
    value.status = query.status;
  }
  return valid(value);
}

function validateSessionNotePayload(body = {}, { partial = false } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return invalid('Request body must be a JSON object');
  const value = {};
  if (!partial || Object.hasOwn(body, 'content')) {
    if (typeof body.content !== 'string' || !body.content.trim()) return invalid('Note content is required');
    value.content = body.content.trim();
  }
  if (Object.hasOwn(body, 'shared_with_client')) {
    if (typeof body.shared_with_client !== 'boolean') return invalid('Shared with client must be true or false');
    value.shared_with_client = body.shared_with_client;
  } else if (!partial) {
    value.shared_with_client = false;
  }
  if (partial && !Object.keys(value).length) return invalid('Provide a note field to update');
  return valid(value);
}

module.exports = {
  validateBookingListQuery,
  validateOptionalText,
  validatePackagePayload,
  validateSchedulePayload,
  validateSessionListQuery,
  validateSessionNotePayload,
  validateUuid,
};
