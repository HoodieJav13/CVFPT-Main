function invalid(error) {
  return { ok: false, error };
}

function valid(value) {
  return { ok: true, value };
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
  const value = {};
  if (requireDate && !body.scheduled_at) return invalid('Client and date/time are required');
  if (Object.hasOwn(body, 'scheduled_at')) {
    const timestamp = new Date(body.scheduled_at);
    if (!body.scheduled_at || Number.isNaN(timestamp.getTime())) return invalid('Enter a valid date and time');
    value.scheduled_at = timestamp.toISOString();
  }
  if (Object.hasOwn(body, 'duration_minutes')) {
    const duration = Number(body.duration_minutes);
    if (!Number.isInteger(duration) || duration < 15 || duration > 240) {
      return invalid('Duration must be a whole number between 15 and 240 minutes');
    }
    value.duration_minutes = duration;
  } else if (requireDate) {
    value.duration_minutes = 60;
  }
  return valid(value);
}

module.exports = { validatePackagePayload, validateSchedulePayload };
