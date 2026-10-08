// Explicit event construction: never merge arbitrary properties, errors or SDK defaults.
const SCREENS = new Set([
  'home', 'clients', 'client_detail', 'sessions', 'session_detail', 'calendar',
  'programs', 'resources', 'messages', 'notifications', 'analytics',
  'workout_detail', 'workout_tracker',
]);
const OPERATIONS = new Set(['create', 'update', 'series_create']);
const OUTCOMES = new Set(['success', 'failure', 'unconfirmed', 'recovered']);
const WORKOUT_CHANGES = new Set(['attached', 'removed', 'unchanged', 'none']);
const FAILURES = new Set(['none', 'network', 'server', 'conflict', 'authorization', 'validation', 'unknown']);
const SOURCES = new Set(['action', 'render', 'runtime', 'unhandled_rejection']);
export const INGEST_HOSTS = new Set(['https://us.i.posthog.com', 'https://eu.i.posthog.com']);
const VISIT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Only this enum leaves the browser; pathname, search/hash and record IDs never do.
export function coachScreen(pathname) {
  if (typeof pathname !== 'string') return null;
  const path = pathname.split(/[?#]/, 1)[0].replace(/\/$/, '');
  if (path === '/coach') return 'home';
  const match = /^\/coach\/(clients|sessions|calendar|programs|resources|messages|notifications|analytics|workouts)(?:\/[^/]+)?(\/track)?$/.exec(path);
  if (!match) return null;
  const section = match[1];
  const detail = path.split('/').length === 4;
  if (section === 'workouts') return match[2] ? 'workout_tracker' : detail ? 'workout_detail' : null;
  if (match[2]) return null;
  if (section === 'clients' && detail) return 'client_detail';
  if (section === 'sessions' && detail) return 'session_detail';
  if (detail && section !== 'messages') return null;
  return section;
}

export function analyticsMode({ allowedBuild, productionBuild, syntheticFixtures, requestedMode, host, token }) {
  const publicToken = typeof token === 'string' && /^phc_[A-Za-z0-9]+$/.test(token);
  if (requestedMode === 'production-coach') {
    return productionBuild && !syntheticFixtures && host === 'https://us.i.posthog.com'
      && publicToken ? 'production-coach' : 'off';
  }
  if (!allowedBuild || !syntheticFixtures) return 'off';
  if (requestedMode === 'local') return 'local';
  if (requestedMode === 'synthetic-preview' && INGEST_HOSTS.has(host) && publicToken) return 'synthetic-preview';
  return 'off';
}

// Only eligibility, a random visit UUID, and a local generation are retained.
// No auth object/ID, cookie, storage, or persistent device identity enters this module.
export function createCoachVisit({ randomUUID = () => globalThis.crypto?.randomUUID() } = {}) {
  let eligible = false;
  let distinctId = null;
  let generation = 0;
  return {
    setRole(role) {
      const next = role === 'coach';
      if (next !== eligible) { generation += 1; distinctId = null; }
      eligible = next;
    },
    getContext(mode) {
      if (!eligible || !['local', 'synthetic-preview', 'production-coach'].includes(mode)) return null;
      if (mode === 'production-coach') {
        try { distinctId ||= randomUUID(); } catch { return null; }
        if (typeof distinctId !== 'string' || !VISIT_ID.test(distinctId)) return null;
      }
      return { mode, distinctId, generation };
    },
  };
}

export function failureKind(error) {
  // Only numeric HTTP status is read; no message, name, code, body, stack, config or URL.
  try {
    const status = error?.response?.status;
    if (status === undefined) return 'network';
    if (!Number.isInteger(status)) return 'unknown';
    if (status >= 500 && status < 600) return 'server';
    if (status === 409) return 'conflict';
    if (status === 401 || status === 403) return 'authorization';
    if (status >= 400 && status < 500) return 'validation';
  } catch { /* hostile/nonstandard error objects are discarded */ }
  return 'unknown';
}

export function buildCoachEvent(event, fields = {}, { mode = 'synthetic-preview', distinctId } = {}) {
  const production = mode === 'production-coach';
  if (production && (typeof distinctId !== 'string' || !VISIT_ID.test(distinctId))) return null;
  if (!production && mode !== 'local' && mode !== 'synthetic-preview') return null;
  const common = {
    app: 'cvfpt', schema_version: production ? 2 : 1,
    environment: production ? 'production' : 'synthetic_preview',
    $process_person_profile: false, $ip: null, $geoip_disable: true,
  };
  let properties;
  if (event === 'cvfpt_coach_screen_viewed') {
    if (!SCREENS.has(fields.screen)) return null;
    properties = { screen: fields.screen };
  } else if (event === 'cvfpt_coach_session_save') {
    if (!OPERATIONS.has(fields.operation) || !OUTCOMES.has(fields.outcome)
        || !WORKOUT_CHANGES.has(fields.workout_change) || !FAILURES.has(fields.failure_kind)) return null;
    properties = {
      operation: fields.operation, outcome: fields.outcome,
      workout_change: fields.workout_change, failure_kind: fields.failure_kind,
    };
  } else if (event === '$exception') {
    if (!SOURCES.has(fields.source) || !FAILURES.has(fields.failure_kind) || fields.failure_kind === 'none') return null;
    if (fields.source === 'action' && !OPERATIONS.has(fields.operation)) return null;
    if (fields.source !== 'action' && !SCREENS.has(fields.screen)) return null;
    const scope = fields.source === 'action' ? fields.operation : fields.screen;
    const value = `Coach ${scope}: ${fields.source} ${fields.failure_kind}`;
    properties = {
      source: fields.source, failure_kind: fields.failure_kind,
      ...(fields.source === 'action' ? { operation: scope } : { screen: scope }),
      $exception_list: [{ type: 'CvfptCoachFailure', value,
        mechanism: { type: 'generic', handled: fields.source === 'action', synthetic: true } }],
      $exception_fingerprint: `cvfpt-v${production ? 2 : 1}-${scope}-${fields.source}-${fields.failure_kind}`,
      $exception_level: 'error',
    };
  } else return null;
  return { event, distinct_id: production ? distinctId : 'cvfpt-synthetic-preview', properties: { ...common, ...properties } };
}

export function createCoachTracker({ mode = 'off', send = () => {}, now = Date.now,
  getContext = () => ({ mode }),
} = {}) {
  let eventCount = 0;
  let errorCount = 0;
  const recentErrors = new Map();
  return (event, fields) => {
    try {
      if (!['local', 'synthetic-preview', 'production-coach'].includes(mode)) return false;
      const context = getContext();
      if (!context || context.mode !== mode) return false;
      const payload = buildCoachEvent(event, fields, context);
      if (!payload || eventCount >= 100) return false;
      if (event === '$exception') {
        const key = payload.properties.$exception_fingerprint;
        const time = now();
        if (errorCount >= 20 || (recentErrors.has(key) && time - recentErrors.get(key) < 30000)) return false;
        recentErrors.set(key, time);
        errorCount += 1;
      }
      eventCount += 1;
      // Detached: neither a throwing transport nor its rejected promise can alter an app action.
      Promise.resolve(send(payload)).catch(() => {});
      return true;
    } catch { return false; }
  };
}

// Observe the API result, before unrelated UI callbacks. Never await capture delivery.
export async function observeSessionSave(run, fields, emit) {
  const safeEmit = (event, properties) => {
    try { Promise.resolve(emit(event, properties)).catch(() => {}); } catch { /* best effort */ }
  };
  let result;
  try { result = await run(); }
  catch (error) {
    const kind = failureKind(error);
    safeEmit('cvfpt_coach_session_save', { ...fields,
      outcome: kind === 'network' || kind === 'server' ? 'unconfirmed' : 'failure', failure_kind: kind });
    // Expected client validation/conflicts remain product outcomes, not error issues.
    if (kind === 'network' || kind === 'server' || kind === 'unknown') {
      safeEmit('$exception', { operation: fields.operation, source: 'action', failure_kind: kind });
    }
    throw error;
  }
  safeEmit('cvfpt_coach_session_save', { ...fields,
    outcome: fields.operation === 'series_create' && result?.data?.replayed === true ? 'recovered' : 'success', failure_kind: 'none' });
  return result;
}

// Independent of the authenticated app API: no bearer interceptor, cookies, referrer or retries.
export function createCaptureTransport({ host, token, fetchFn = globalThis.fetch,
  getContext = () => ({ mode: 'synthetic-preview' }),
}) {
  return async (payload) => {
    if (!INGEST_HOSTS.has(host) || typeof token !== 'string' || !/^phc_[A-Za-z0-9]+$/.test(token)) return false;
    // Rebuild at the transport boundary too. A caller cannot inject extra event properties.
    const context = getContext();
    if (!context || (context.mode === 'production-coach'
      && (host !== 'https://us.i.posthog.com' || payload?.distinct_id !== context.distinctId))) return false;
    const clean = buildCoachEvent(payload?.event, payload?.properties, context);
    if (!clean) return false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    try {
      const response = await fetchFn(`${host}/i/v0/e/`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: token, ...clean }), credentials: 'omit',
        referrerPolicy: 'no-referrer', signal: controller.signal,
      });
      return response.ok;
    } catch { return false; }
    finally { clearTimeout(timer); }
  };
}
