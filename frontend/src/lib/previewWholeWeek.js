// Preview-only whole-week scenario (double-gated preview module; never a
// security boundary). Mirrors the backend routes/RPC contract closely enough to
// review the UI: role-separated preferences, collection gate, receipts with
// replay/mismatch, revision conflicts and soft archive. Fictional data, held in
// memory on the shared preview state and reset on reload.
//  - David (client_david): collection on, a partial week (one unknown duration).
//  - Emily (client_emily): opted out after an earlier shared activity.
//  - Sarah: no preference row, so she shows the default-off state; her
//    existing fixtures are untouched.
import { ACTIVITY_TYPES, LIMITS, addDays, denverToday, isCalendarDate, mondayOf, summarizeOutsideActivities } from './outsideActivities.js';

export const WHOLE_WEEK_LOSE_KEY = 'cvf_preview_whole_week_lose_next_response';
export const WHOLE_WEEK_CAPABILITY_KEY = 'cvf_preview_whole_week_capability';
export const WHOLE_WEEK_SWITCH_KEYS = [WHOLE_WEEK_LOSE_KEY, WHOLE_WEEK_CAPABILITY_KEY];
export const WHOLE_WEEK_SAVE_ROUTES = [
  ['post', /^\/outside-activities\/mine$/],
  ['post', /^\/outside-activities\/clients\/([^/]+)$/],
  ['patch', /^\/outside-activities\/([^/]+)\/archive$/],
  ['patch', /^\/outside-activities\/([^/]+)$/],
  ['patch', /^\/context-preferences\/mine$/],
  ['patch', /^\/context-preferences\/clients\/([^/]+)$/],
];
const FIELD_KEYS = ['activity_type', 'occurred_on', 'label', 'duration_seconds', 'effort_rpe', 'note'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readSwitch(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function clearSwitch(key) {
  try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
}
function denverDateOf(instant) {
  return denverToday(new Date(instant));
}

export function seedWholeWeekScenario(state, now = new Date()) {
  if (state.outsideActivities) return;
  const today = denverToday(now);
  const monday = mondayOf(today);
  const day = (offset) => { const date = addDays(monday, offset); return date > today ? today : date; };
  const stamp = new Date(now.getTime() - 3600000).toISOString();
  const row = (values) => ({
    label: null, duration_seconds: null, effort_rpe: null, note: null, revision: 1, archived: false, archived_at: null,
    created_at: stamp, updated_at: stamp, ...values,
    updated_by_role: values.created_by_role, updated_by_id: values.created_by_id,
  });
  state.outsideActivities = [
    row({ id: 'outside_david_game', client_id: 'client_david', activity_type: 'game', label: 'Club soccer', occurred_on: day(0), duration_seconds: 3600, effort_rpe: 8, note: 'Played the full second half.', created_by_role: 'client', created_by_id: 'client_david' }),
    row({ id: 'outside_david_run', client_id: 'client_david', activity_type: 'run', occurred_on: day(1), duration_seconds: 1800, created_by_role: 'client', created_by_id: 'client_david' }),
    row({ id: 'outside_david_hike', client_id: 'client_david', activity_type: 'hike', label: 'Foothills trail', occurred_on: day(2), effort_rpe: 5, created_by_role: 'coach', created_by_id: 'coach_marcus' }),
    row({ id: 'outside_david_last_week', client_id: 'client_david', activity_type: 'extra_training', occurred_on: addDays(monday, -3), duration_seconds: 2700, effort_rpe: 6, created_by_role: 'client', created_by_id: 'client_david' }),
    row({ id: 'outside_emily_shared', client_id: 'client_emily', activity_type: 'sport_practice', label: 'Volleyball', occurred_on: addDays(monday, -5), duration_seconds: 5400, created_by_role: 'client', created_by_id: 'client_emily' }),
  ];
  state.outsideActivityReceipts = [];
  state.contextPreferences = [
    { client_id: 'client_david', activity_coach_enabled: true, activity_client_off: false, checkin_prompt_coach_enabled: true, checkin_prompt_client_off: false, revision: 1, updated_by_role: 'coach', updated_by_id: 'coach_marcus', created_at: stamp, updated_at: stamp },
    { client_id: 'client_emily', activity_coach_enabled: true, activity_client_off: true, checkin_prompt_coach_enabled: false, checkin_prompt_client_off: false, revision: 2, updated_by_role: 'client', updated_by_id: 'client_emily', created_at: stamp, updated_at: stamp },
  ];
}

function preferencesDto(state, clientId) {
  const p = state.contextPreferences.find((row) => row.client_id === clientId) || null;
  return {
    revision: p?.revision || 0,
    stored: Boolean(p),
    activity_coach_enabled: Boolean(p?.activity_coach_enabled),
    activity_client_off: Boolean(p?.activity_client_off),
    activity_collection: !p ? 'default_off' : p.activity_client_off ? 'client_opted_out' : !p.activity_coach_enabled ? 'coach_off' : 'on',
    checkin_prompt_coach_enabled: Boolean(p?.checkin_prompt_coach_enabled),
    checkin_prompt_client_off: Boolean(p?.checkin_prompt_client_off),
    checkin_prompt: p?.checkin_prompt_coach_enabled && !p.checkin_prompt_client_off ? 'on' : 'hidden',
    updated_by_role: p?.updated_by_role || null,
    updated_at: p?.updated_at || null,
  };
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function normalizeFields(body, today, requireAll) {
  if (requireAll) {
    const supplied = FIELD_KEYS.filter((key) => Object.hasOwn(body, key));
    if (!supplied.length) throw badRequest('Choose an activity field to correct');
    const normalized = normalizeFields({ activity_type: 'other', occurred_on: today, ...body }, today, false);
    return Object.fromEntries(supplied.map((key) => [key, normalized[key]]));
  }
  if (!ACTIVITY_TYPES.includes(body.activity_type)) throw badRequest('Choose an activity type');
  if (!isCalendarDate(body.occurred_on)) throw badRequest('Choose a real calendar date');
  if (body.occurred_on > today) throw badRequest('Activity dates cannot be in the future (America/Denver)');
  const text = (value, max, label) => {
    if (value == null) return null;
    if (typeof value !== 'string') throw badRequest(`${label} must be text`);
    const trimmed = value.trim();
    if (Array.from(trimmed).length > max) throw badRequest(`${label} is too long`);
    return trimmed || null;
  };
  const whole = (value, min, max, message) => {
    if (value == null) return null;
    if (!Number.isInteger(value) || value < min || value > max) throw badRequest(message);
    return value;
  };
  return {
    activity_type: body.activity_type,
    occurred_on: body.occurred_on,
    label: text(body.label, LIMITS.labelChars, 'Label'),
    duration_seconds: whole(body.duration_seconds, 1, LIMITS.maxDurationSeconds, 'Duration must be a whole number of seconds from 1 to 86400, or unknown'),
    effort_rpe: whole(body.effort_rpe, 1, 10, 'Effort must be a whole number from 1 to 10, or unknown'),
    note: text(body.note, LIMITS.noteChars, 'Note'),
  };
}

export function createPreviewWholeWeek({ state, ok, fail, getRole, currentCoach, currentClient, canAccessClient }) {
  seedWholeWeekScenario(state);
  const clientById = (clientId) => state.clients.find((row) => row.id === clientId && !row.archived) || null;
  const coachName = (coachId) => state.coaches.find((row) => row.id === coachId)?.name || null;
  const conflict = (config, message, code) => Promise.reject({ response: { data: { error: message, code }, status: 409, statusText: 'Conflict', headers: {}, config }, config });

  // Mirrors authorize_whole_week: client self, current coach, or admin.
  function authorize(role, target) {
    if (!target) return null;
    if (role === 'client') return currentClient().id === target.id ? { role: 'client', id: target.id, key: `client:${target.id}` } : null;
    if (!canAccessClient(role, target)) return null;
    return { role, id: currentCoach().id, key: `coach:${currentCoach().id}` };
  }

  function dto(row) {
    return { ...row, created_by_name: row.created_by_role === 'client' ? null : coachName(row.created_by_id) };
  }

  function readWeek(config, search, role, target) {
    const actor = authorize(role, target);
    if (!actor) return fail(config, 404, 'Client week not found');
    const today = denverToday();
    const current = mondayOf(today);
    const raw = config.params?.week_start ?? search.get('week_start');
    const weekStart = raw == null || raw === '' ? current : raw;
    if (!isCalendarDate(weekStart) || mondayOf(weekStart) !== weekStart) return fail(config, 400, 'week_start must be a Monday');
    if (weekStart > current) return fail(config, 400, 'Future weeks are not available');
    const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
    const rows = state.outsideActivities
      .filter((row) => row.client_id === target.id && !row.archived && row.occurred_on >= days[0] && row.occurred_on <= days[6])
      .sort((a, b) => a.occurred_on.localeCompare(b.occurred_on) || a.id.localeCompare(b.id));
    let cursor = null;
    const rawCursor = config.params?.cursor ?? search.get('cursor');
    if (rawCursor != null) {
      try { cursor = JSON.parse(rawCursor); } catch { return fail(config, 400, 'Invalid activity page cursor'); }
      if (!cursor || typeof cursor !== 'object' || Object.keys(cursor).sort().join(',') !== 'client_id,id,occurred_on,week_start'
        || cursor.client_id !== target.id || cursor.week_start !== weekStart || typeof cursor.id !== 'string' || !cursor.id
        || !isCalendarDate(cursor.occurred_on) || cursor.occurred_on < days[0] || cursor.occurred_on > days[6]) return fail(config, 400, 'Invalid activity page cursor');
    }
    const eligible = cursor ? rows.filter(row => row.occurred_on > cursor.occurred_on || (row.occurred_on === cursor.occurred_on && row.id.localeCompare(cursor.id) > 0)) : rows;
    const page = eligible.slice(0, 100);
    const last = page[page.length - 1];
    const nextCursor = eligible.length > 100 ? { client_id: target.id, week_start: weekStart, occurred_on: last.occurred_on, id: last.id } : null;
    const byDay = Object.fromEntries(days.map((date) => [date, 0]));
    state.workoutLogs
      .filter((log) => log.client_id === target.id && log.status === 'completed' && !log.archived && log.completed_at)
      .forEach((log) => { const date = denverDateOf(log.completed_at); if (date in byDay) byDay[date] += 1; });
    return ok({
      contract: 1, timezone: 'America/Denver', today, current_week_start: current, days,
      client_id: target.id, viewer_role: actor.role, client_name: target.name, coach_name: coachName(target.coach_id),
      week_start: days[0], week_end: days[6], preferences: preferencesDto(state, target.id),
      activities: page.map(dto), next_cursor: nextCursor, truncated: Boolean(nextCursor), summary: summarizeOutsideActivities(rows),
      pt_workouts: { status: 'available', completed_count: Object.values(byDay).reduce((sum, count) => sum + count, 0), by_day: byDay },
    }, config);
  }

  function mutate(config, role, { target = null, activityId = null, action, payload }) {
    const today = denverToday();
    let fields = null;
    const body = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
    try {
      if (!body || !UUID_RE.test(body.request_id || '')) throw badRequest('Invalid activity request');
      const allowed = action === 'archive' ? ['request_id', 'revision'] : ['request_id', 'revision', ...FIELD_KEYS];
      if (Object.keys(body).some((key) => !allowed.includes(key))) throw badRequest('Invalid activity request');
      if (action === 'create' ? body.revision !== 0 : !Number.isInteger(body.revision) || body.revision < 1) throw badRequest('Invalid activity revision');
      if (action !== 'archive') fields = normalizeFields(body, today, action === 'update');
    } catch (error) {
      return fail(config, error.status || 400, error.message);
    }
    let activity = null;
    if (activityId) {
      activity = state.outsideActivities.find((row) => row.id === activityId) || null;
      target = activity ? clientById(activity.client_id) : null;
    }
    const actor = authorize(role, target);
    if (!actor) return fail(config, 404, activityId ? 'Activity not found' : 'Client week not found');
    const hash = JSON.stringify(stable({ action, client_id: target.id, activity_id: activityId, revision: body.revision, fields }));
    const receipt = state.outsideActivityReceipts.find((row) => row.actor_key === actor.key && row.request_id === body.request_id);
    if (receipt) {
      if (receipt.request_hash !== hash) return conflict(config, 'This request id was already used for a different change', 'request_mismatch');
      const latest = state.outsideActivities.find((row) => row.id === receipt.activity_id);
      return ok({ resource: dto(latest), committed_revision: receipt.committed_revision, request_id: body.request_id, replayed: true, action: receipt.action }, config);
    }
    const stamp = new Date().toISOString();
    if (action === 'create') {
      const prefs = preferencesDto(state, target.id);
      if (prefs.activity_collection !== 'on') {
        return conflict(config, prefs.activity_client_off ? 'Outside activity logging is turned off by the client' : 'Outside activity logging is not turned on for this client', 'collection_off');
      }
      activity = {
        id: `outside_${Math.random().toString(36).slice(2, 10)}`, client_id: target.id, ...fields,
        created_by_role: actor.role, created_by_id: actor.id, updated_by_role: actor.role, updated_by_id: actor.id,
        revision: 1, archived: false, archived_at: null, created_at: stamp, updated_at: stamp,
      };
      state.outsideActivities.push(activity);
    } else {
      if (activity.archived) return conflict(config, 'This activity was removed. Reload the week', 'archived');
      if (activity.revision !== body.revision) return conflict(config, 'This activity changed elsewhere. Reload before saving', 'revision_conflict');
      Object.assign(activity, action === 'update' ? fields : { archived: true, archived_at: stamp }, {
        updated_by_role: actor.role, updated_by_id: actor.id, revision: activity.revision + 1, updated_at: stamp,
      });
    }
    state.outsideActivityReceipts.push({ actor_key: actor.key, request_id: body.request_id, action, client_id: target.id, activity_id: activity.id, request_hash: hash, committed_revision: activity.revision });
    const result = { resource: dto(activity), committed_revision: activity.revision, request_id: body.request_id, replayed: false, action };
    // Review switch: the save commits, then the response is "lost" in transit.
    if (readSwitch(WHOLE_WEEK_LOSE_KEY) === '1') {
      clearSwitch(WHOLE_WEEK_LOSE_KEY);
      return Promise.reject(Object.assign(new Error('Network Error (preview: response lost after the save committed)'), { config, code: 'ERR_NETWORK' }));
    }
    return ok(result, config, action === 'create' ? 201 : 200);
  }

  function savePreferences(config, role, target, payload) {
    const actor = authorize(role, target);
    if (!actor) return fail(config, 404, 'Client week not found');
    const body = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
    const own = actor.role === 'client' ? ['activity_client_off', 'checkin_prompt_client_off'] : ['activity_coach_enabled', 'checkin_prompt_coach_enabled'];
    const keys = Object.keys(body).filter((key) => key !== 'revision');
    if (!keys.length || !Number.isInteger(body.revision) || body.revision < 0) return fail(config, 400, 'Invalid preference request');
    if (keys.some((key) => !own.includes(key))) return fail(config, 403, actor.role === 'client' ? 'Only your coach can turn this on' : 'Only the client can change their own choice');
    if (keys.some((key) => typeof body[key] !== 'boolean')) return fail(config, 400, 'Invalid preference request');
    let row = state.contextPreferences.find((item) => item.client_id === target.id) || null;
    if ((row?.revision || 0) !== body.revision) return conflict(config, 'Preferences changed elsewhere. Reload before saving', 'revision_conflict');
    const stamp = new Date().toISOString();
    if (!row) {
      row = { client_id: target.id, activity_coach_enabled: false, activity_client_off: false, checkin_prompt_coach_enabled: false, checkin_prompt_client_off: false, revision: 0, created_at: stamp };
      state.contextPreferences.push(row);
    }
    keys.forEach((key) => { row[key] = body[key]; });
    Object.assign(row, { revision: row.revision + 1, updated_by_role: actor.role, updated_by_id: actor.id, updated_at: stamp });
    return ok({ preferences: preferencesDto(state, target.id) }, config);
  }

  return {
    handle(config, method, path, search, payload) {
      const role = getRole();
      if (path === '/whole-week/capability' && method === 'get') {
        if (readSwitch(WHOLE_WEEK_CAPABILITY_KEY) === 'missing') return fail(config, 404, 'Not found');
        return ok({ feature: 'whole_week', contract: 1, outside_activity_writes: 'guarded', preference_writes: 'guarded' }, config);
      }
      if (path === '/whole-week/mine' && method === 'get') {
        if (role !== 'client') return fail(config, 403, 'Client access required');
        return readWeek(config, search, role, currentClient());
      }
      const coachWeek = path.match(/^\/whole-week\/clients\/([^/]+)$/);
      if (coachWeek && method === 'get') {
        if (role === 'client') return fail(config, 403, 'Coach access required');
        return readWeek(config, search, role, clientById(coachWeek[1]));
      }
      if (path === '/outside-activities/mine' && method === 'post') {
        if (role !== 'client') return fail(config, 403, 'Client access required');
        return mutate(config, role, { target: currentClient(), action: 'create', payload });
      }
      const coachCreate = path.match(/^\/outside-activities\/clients\/([^/]+)$/);
      if (coachCreate && method === 'post') {
        if (role === 'client') return fail(config, 403, 'Coach access required');
        return mutate(config, role, { target: clientById(coachCreate[1]), action: 'create', payload });
      }
      const archive = path.match(/^\/outside-activities\/([^/]+)\/archive$/);
      if (archive && method === 'patch') return mutate(config, role, { activityId: archive[1], action: 'archive', payload });
      const update = path.match(/^\/outside-activities\/([^/]+)$/);
      if (update && method === 'patch' && update[1] !== 'mine') return mutate(config, role, { activityId: update[1], action: 'update', payload });
      if (path === '/context-preferences/mine' && method === 'patch') {
        if (role !== 'client') return fail(config, 403, 'Client access required');
        return savePreferences(config, role, currentClient(), payload);
      }
      const coachPrefs = path.match(/^\/context-preferences\/clients\/([^/]+)$/);
      if (coachPrefs && method === 'patch') {
        if (role === 'client') return fail(config, 403, 'Coach access required');
        return savePreferences(config, role, clientById(coachPrefs[1]), payload);
      }
      return undefined;
    },
  };
}
