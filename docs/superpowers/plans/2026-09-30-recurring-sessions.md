# Recurring Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Recommended shape: **one accountable executor working phase by phase**, with a review at each phase boundary — especially the Phase 3 scheduler/batch SQL and the Task 22–23 recovery UI — rather than a fresh agent per tiny task (more handoffs without more correctness). superpowers:subagent-driven-development is acceptable if the owner prefers it. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a coach create a recurring batch of ordinary client sessions in one flow — with conflict-fixing preview, optional program-workout mapping, retry-safe all-or-nothing saving, one summary notification, and "this and all future" cancellation.

**Architecture:** One additive migration adds `session_series`, `sessions.series_id/series_ordinal`, a shared read-only `find_session_conflict` helper (which `schedule_session` is refactored to call), a read-only `check_session_slots`, and a transactional `schedule_session_series` that takes the scheduling lock first, resolves replays from an immutable receipt, and creates everything in one transaction. Express routes (`/api/sessions/series/*`) validate shape → resolve replay → validate eligibility → call the RPC; the React drawer gains a Repeat composer whose pending save survives reloads. Existing single-session endpoints get a validation-order fix, shared-workout support, and a `notify` flag.

**Tech Stack:** Node/Express + Supabase (PostgreSQL 17, plpgsql), `node:test`, React 19 + Vite 6 + Tailwind + shadcn/ui, Playwright 1.61.1, Supabase CLI 2.118.0 + Docker for the local database test layer.

**Spec:** `docs/superpowers/specs/2026-09-30-recurring-sessions-design.md` (v3.1, includes owner decisions of 2026-09-30). Read it before starting; this plan implements it and does not restate every rationale.

## Global Constraints

Every task's requirements implicitly include these (copied from the spec, `CLAUDE.md`, `.agentic/PROJECT_POLICY.md`):

- **Series model:** a series creates a batch of ordinary `sessions` rows linked by `series_id`; no rolling series, no edit-whole-series.
- **Pattern:** weekly, one or more weekdays, every 1 or 2 weeks, same time and duration; end after N sessions or on a date; **at most 52 sessions** per series.
- **Horizon (one definition everywhere):** every slot — generated, edited, added, suggested or created — satisfies `today_denver <= date <= start_date + 365 days`, both ends inclusive; `start_date >= today_denver` for new series; none in the past (`scheduled_at > now`).
- **Timezone:** `America/Denver`. API slots are `{ key, date: 'YYYY-MM-DD', time: 'HH:mm' }` Denver wall-clock; the server converts to UTC in one place. Spring-forward gap time resolves forward; fall-back ambiguous time resolves to the first (daylight) occurrence.
- **Save-time conflicts are all-or-nothing:** if any slot conflicts, create nothing, return all conflicts keyed by row `key`.
- **Idempotency:** one `request_id` per draft; scheduling advisory lock is taken **before** the `(coach_id, request_id)` lookup; replays return the stored receipt with HTTP `200` and **never notify** (`notify && !replayed`, evaluated on the RPC result).
- **Notifications:** one summary email + push per series, best-effort (no durable retry); built from actual saved dates; "silent" still leaves normal reminders/digests.
- **Authorization is server-side on every endpoint** (locked invariant): `requireCoach` + `canAccessClient`; admin acts for the client's coach; a known `request_id` alone is never enough to read a receipt.
- **Locked invariants:** soft-delete only (cancel = `status = 'cancelled'`, no hard deletes of business records); service-role-only database access (RLS on, no policies, privileges only to `service_role`); never edit/rename/delete an applied migration — new numbered forward-only migrations only; `backend/migration.sql` is frozen.
- **Deploy boundary:** never import across `frontend/` ↔ `backend/`; duplicate if needed. The occurrence generator and Denver conversion are backend-only; `frontend/src/lib/seriesPlan.js` is frontend-only and pure.
- **Do not extend `frontend/src/lib/previewMode.js`.** Browser tests use test-owned Playwright fixtures in a non-preview build.
- **Design tokens only** in components (no hardcoded hex); functional and visual changes go in **separate commits**.
- **Release is out of scope for this plan.** Do not apply any hosted (Preview/Production) migration, push to a deploy branch, or merge. Release steps appear only as a handoff checklist at the end and each needs separate owner authorization (`.agentic/PROJECT_POLICY.md`).
- **Commits:** the commit steps below run only when the executor has been explicitly instructed to implement this plan. Work on a feature branch (`claude/recurring-sessions`) created from `main`; never merge; follow `.agentic/PROJECT_POLICY.md` for pushing.
- **No commit until its checks pass** (`AGENTS.md`): no commit in this plan may contain a failing test. Where a task's tests need an environment that is unavailable (the database suite without a healthy Docker engine), the files stay **uncommitted** (always `git add` explicit paths) and the task is reported BLOCKED — never committed on the strength of "it should work".
- **Verification discipline:** run verification commands directly and treat a non-zero exit status as failure. Never pipe a verification command through `tail`, `head` or `grep` (the pipeline then reports the filter's status and hides a failed test or build). If you want a shorter view, log it and print the status: `cmd > "${TMPDIR:-/tmp}/x.log" 2>&1; echo "exit=$?"; tail -n 20 "${TMPDIR:-/tmp}/x.log"`. "Expected: PASS" always means exit status 0 **and** the summary.
- **Database tests use only an owned, disposable stack.** `supabase/tests/session_series/stack.sh` creates its own Supabase work directory with a unique project id (`cvfpt-series-test`) and its own ports; every start, reset, SQL test, race test and cleanup goes through it. Nothing in this plan resets, stops or inspects data in the repository's normal local stack (`CVFPT-main`) or any other container. Never run `supabase link`, `db push`, or `db reset` against the repo root.
- **Docker is never restarted without the owner's explicit approval** (restarting may interrupt unrelated workloads, and an unresponsive API does not show that none are running). Diagnose with bounded commands, defer, and keep working on independent tasks.
- **Executor contract** (`AGENTS.md`, `CLAUDE.md`): run `.agentic/validate-contract-version.sh .`, read `.agentic/protocol.md`, `.agentic/EXECUTOR.md` and `.agentic/PROJECT_POLICY.md`, record the baseline SHA/branch and the pre-existing worktree changes before editing, and finish with a report in the EXECUTOR.md shape (raw evidence and counts, every unrun or failed check classified, numbered judgment calls, local vs pushed vs hosted state stated precisely).

Commit message trailer for every commit in this plan:

```
Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

---

## File Structure

**Create**

| Path | Responsibility |
|---|---|
| `backend/src/lib/sessionWorkouts.js` | Workout attachment validation (single + bulk) shared by `sessions.js` and the series routes |
| `backend/src/lib/sessionSeries/rule.js` | Rule parsing, occurrence generator, slot-shape validation, horizon, canonical request hash |
| `backend/src/lib/sessionSeries/alternatives.js` | Candidate suggestion times and chunking |
| `backend/src/routes/sessionSeries.js` | `/api/sessions/series` preview, check, create, cancel |
| `supabase/migrations/20260930100000_session_series_schema.sql` | `session_series` table + `sessions.series_id/series_ordinal` |
| `supabase/migrations/20260930110000_find_session_conflict_helper.sql` | `find_session_conflict` + `schedule_session` refactor |
| `supabase/migrations/20260930120000_check_session_slots.sql` | read-only checker |
| `supabase/migrations/20260930130000_schedule_session_series.sql` | transactional batch function |
| `supabase/tests/session_series/stack.sh` | Owned, disposable Supabase stack (own project id, own ports, staged+verified config; teardown only ever targets the fixed test project) |
| `supabase/tests/session_series/fake_bins.sh`, `stack_guard_test.sh`, `isolation_guard_test.sh` | Docker-free failure-injection tests (fake `docker`/`supabase`) proving the stack and isolation scripts can never touch another project and never pass on a failed inspection |
| `supabase/tests/session_series/*.sql`, `run.sh`, `concurrency.sh`, `isolation_check.sh` | Behavioral + committed-race tests against the owned stack; proof that other stacks are untouched |
| `backend/test/session-workout-validation.test.js`, `time-denver-wall-clock.test.js`, `session-series-rule.test.js`, `session-series-alternatives.test.js`, `session-series-migrations.test.js`, `session-series-routes.test.js`, `session-series-notifications.test.js`, `session-cancel-notify.test.js` | Backend tests |
| `frontend/src/lib/seriesPlan.js`, `seriesDraftStore.js`, `seriesRequest.js` | Pure frontend logic |
| `frontend/tests/unit/*.test.mjs` | `node --test` unit tests for the pure frontend modules |
| `frontend/src/components/series/SeriesComposer.jsx`, `RecurrencePanel.jsx`, `SeriesPreviewList.jsx`, `SeriesBadge.jsx`, `CancelSessionDialog.jsx` | Series UI |
| `frontend/playwright.series.config.mjs`, `frontend/e2e/series-mocked.spec.mjs` | Mocked-API browser tests (non-preview build) |

**Modify:** `backend/src/routes/sessions.js`, `backend/src/utils/time.js`, `backend/src/services/email.js`, `frontend/src/components/SessionEditorDrawer.jsx`, `frontend/src/pages/coach/Sessions.jsx`, `frontend/src/pages/coach/SessionDetail.jsx`, `frontend/package.json` (scripts only), `frontend/playwright.config.mjs` (exclude the series spec from the preview suite), `.github/workflows/ci.yml` (new checks), `CLAUDE.md` (status line, final task).

**Test commands used throughout** (run from the repo root):

```bash
cd backend && node --test test/<file>.test.js      # one backend file
cd backend && npm test                              # full backend suite
cd frontend && npm run test:unit                    # frontend pure-logic tests (added in Task 18)
cd frontend && npm run build                        # Vite build
cd frontend && npm run test:e2e:preview             # existing preview browser suite
cd frontend && npm run test:e2e:series              # new mocked-API browser suite (Task 24)
bash supabase/tests/session_series/run.sh           # database suite on the owned stack (needs a healthy Docker engine, Task 6)
```

---

## Phase 0 — Branch and baseline

### Task 0: Branch, baseline tests, commit the spec and plan

**Files:**
- Add (already on disk, untracked): `docs/superpowers/specs/2026-09-30-recurring-sessions-design.md`, `docs/superpowers/plans/2026-09-30-recurring-sessions.md`

- [ ] **Step 0: Follow the repository's executor contract**

```bash
cd /Users/jav/Projects/cvf/cvfpt
.agentic/validate-contract-version.sh .
git rev-parse HEAD
git branch --show-current
git status --short
```
Expected: the validator exits 0. Then read `CLAUDE.md`, `.agentic/protocol.md`, `.agentic/EXECUTOR.md` and `.agentic/PROJECT_POLICY.md` completely. Record the baseline SHA, branch/upstream, and the pre-existing worktree changes (they are not yours to stage or revert).

- [ ] **Step 1: Create the feature branch**

```bash
cd /Users/jav/Projects/cvf/cvfpt
git status --short
git switch -c claude/recurring-sessions
```
Expected: on branch `claude/recurring-sessions`. Pre-existing unrelated changes (`D .claude/skills/agent-browser`, `?? .claude/settings.local.json`, `?? docs/shared-training-library-design.md`) must **not** be staged by any commit in this plan; always `git add` explicit paths.

- [ ] **Step 2: Record the baseline**

```bash
cd backend && npm test
cd ../frontend && npm run test:e2e:preview
```
Expected: the backend exits 0 — **316 tests, 0 failures** when this plan was written (2026-09-30, `main` at `c8adc6d`).

The preview browser suite is **not fully green on the untouched repo**: when this plan was written (2026-09-30, about 22:54 MDT) it reported **19 passed, 8 skipped, 1 failed**. The one failure, `preview-critical.spec.mjs` › "session conflicts surface inline, clear on relevant edits, and keep refused bookings pending", fails identically without any change from this feature. Its cause was not investigated; the test books *today at 3:15 PM* against a 3:00 PM fixture session, so it may depend on the time of day. Record what you observe:
- If the suite shows exactly that one failure, treat it as a **known pre-existing failure**: do not fix it here (out of scope), report it as an out-of-scope discovery, and use the exclusion variant below in later runs.
- If it passes at your baseline, there is nothing to exclude.
- Any other baseline failure: stop and report; do not continue on a red baseline.

Known-failure exclusion variant (only if recorded): `cd frontend && npm run test:e2e:preview -- --grep-invert "session conflicts surface inline"`.

Write down the backend pass count and the preview suite's passed/skipped/failed counts; later tasks must not reduce the passes or add failures. The single recorded exception above is the only baseline failure that does not stop the work. **An excluded test has not passed:** every later report states the preview suite as "N passed, 8 skipped, 1 known pre-existing failure (excluded from the gating run, outcome reported separately)" and never as green.

- [ ] **Step 3: Commit the planning documents**

```bash
cd /Users/jav/Projects/cvf/cvfpt
git add docs/superpowers/specs/2026-09-30-recurring-sessions-design.md docs/superpowers/plans/2026-09-30-recurring-sessions.md
git commit -m "docs: recurring sessions spec v3.1 and implementation plan" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Phase 1 — Standalone fix: workout validation order and shared workouts

Valuable on its own and shippable without the rest. It fixes two existing defects: (1) `POST`/`PUT /api/sessions` schedule the session **before** validating `workout_id`, so a bad workout returns 400 after a session was created or moved; (2) shared workouts (`coach_id` null), which `GET /api/programs/workouts` offers, are rejected.

### Task 1: Shared-workout rule and bulk validator

**Files:**
- Create: `backend/src/lib/sessionWorkouts.js`
- Create: `backend/test/session-workout-validation.test.js`
- Modify: `backend/src/routes/sessions.js:25-36` (remove the local function; import the shared one)

**Interfaces:**
- Produces: `validateWorkoutAttachment(workoutId: string|null, coachId: string): Promise<{ ok: true, value: string|null } | { ok: false, error: string }>` and `validateWorkoutIds(workoutIds: Array<string|null|undefined>, coachId: string): Promise<{ ok: true, value: string[] } | { ok: false, error: string }>` (one `workouts` query for any number of IDs). Later tasks (series create) import both.

- [ ] **Step 1: Write the failing test file**

Create `backend/test/session-workout-validation.test.js`:

```js
// Workout attachment validation: must happen BEFORE scheduling mutates anything,
// and shared (coach_id null) unarchived workouts are valid for any coach.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const COACH_ID = 'aaaaaaaa-0000-0000-0000-00000000000a';
const OTHER_COACH_ID = 'bbbbbbbb-0000-0000-0000-00000000000b';
const CLIENT_ID = 'cccccccc-0000-0000-0000-00000000000c';
const SESSION_ID = 'eeeeeeee-0000-0000-0000-00000000000e';
const WORKOUT_ID = '99999999-0000-0000-0000-000000000009';
const WORKOUT_ID_2 = '99999999-0000-0000-0000-00000000000a';
const FUTURE = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

const state = {};
function resetState() {
  state.workoutRow = { id: WORKOUT_ID, coach_id: COACH_ID };
  state.workoutList = [];
  state.sessionRow = null;
  state.clientRow = { id: CLIENT_ID, coach_id: COACH_ID, archived: false };
  state.sessionUpdates = [];
  state.rpcCalls = [];
  state.workoutQueries = 0;
}

const supabasePath = require.resolve('../src/supabase');
require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true,
  exports: {
    supabaseAdmin: {
      from(table) {
        if (table === 'workouts') state.workoutQueries += 1;
        const chain = {
          _update: null,
          select() { return chain; },
          eq() { return chain; },
          in() { return chain; },
          order() { return chain; },
          update(values) { chain._update = values; if (table === 'sessions') state.sessionUpdates.push(values); return chain; },
          maybeSingle() {
            if (table === 'workouts') return Promise.resolve({ data: state.workoutRow, error: null });
            if (table === 'sessions') return Promise.resolve({ data: state.sessionRow, error: null });
            if (table === 'clients') return Promise.resolve({ data: state.clientRow, error: null });
            return Promise.resolve({ data: null, error: null });
          },
          single() {
            if (table === 'sessions') return Promise.resolve({ data: { ...state.sessionRow, ...(chain._update || {}) }, error: null });
            return Promise.resolve({ data: null, error: null });
          },
          then(resolve) {
            if (table === 'workouts') return resolve({ data: state.workoutList, error: null });
            return resolve({ data: [], error: null });
          },
        };
        return chain;
      },
      rpc(name, args) {
        state.rpcCalls.push({ name, args });
        if (name === 'schedule_session') {
          return Promise.resolve({ data: { outcome: 'scheduled', session: { id: SESSION_ID }, location_overlaps: 0 }, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
    },
  },
};

let currentUser;
const authPath = require.resolve('../src/middleware/auth');
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: {
    requireAuth: (req, _res, next) => { req.user = currentUser; next(); },
    requireCoach: (req, res, next) => (['coach', 'admin'].includes(req.user?.role) ? next() : res.status(403).json({ error: 'Coach access required' })),
    requireClient: (req, res, next) => (req.user?.role === 'client' ? next() : res.status(403).json({ error: 'Client access required' })),
    canAccessClient: () => true,
  },
};

const emailPath = require.resolve('../src/services/email');
require.cache[emailPath] = {
  id: emailPath, filename: emailPath, loaded: true,
  exports: {
    dispatchEmail: (task) => Promise.resolve().then(task),
    notifySessionScheduled: () => Promise.resolve({}),
    notifySessionRescheduled: () => Promise.resolve({}),
    notifySessionCancelled: () => Promise.resolve({}),
    notifySessionCancelledByClient: () => Promise.resolve({}),
    formatDenver: () => 'formatted',
  },
};

const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/sessions', require('../src/routes/sessions'));
const { validateWorkoutAttachment, validateWorkoutIds } = require('../src/lib/sessionWorkouts');
const server = http.createServer(app);
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); });

async function send(pathname, { method = 'POST', body } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method, headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

const coachUser = { role: 'coach', coach: { id: COACH_ID, name: 'Coach Sam' } };
const scheduledCalls = () => state.rpcCalls.filter((call) => call.name === 'schedule_session');
const createBody = (workout_id) => ({ client_id: CLIENT_ID, scheduled_at: FUTURE, duration_minutes: 60, workout_id });

test('create accepts a shared (coach_id null) unarchived workout', async () => {
  resetState();
  currentUser = coachUser;
  state.workoutRow = { id: WORKOUT_ID, coach_id: null };
  state.sessionRow = { id: SESSION_ID, client_id: CLIENT_ID, coach_id: COACH_ID, scheduled_at: FUTURE, duration_minutes: 60, status: 'scheduled' };
  const result = await send('/api/sessions', { body: createBody(WORKOUT_ID) });
  assert.equal(result.status, 201);
  assert.equal(scheduledCalls().length, 1);
  assert.ok(state.sessionUpdates.some((update) => update.workout_id === WORKOUT_ID));
});

test('update can still detach a workout with null', async () => {
  resetState();
  currentUser = coachUser;
  state.sessionRow = { id: SESSION_ID, client_id: CLIENT_ID, coach_id: COACH_ID, scheduled_at: FUTURE, duration_minutes: 60, status: 'scheduled', archived: false, workout_id: WORKOUT_ID };
  const result = await send(`/api/sessions/${SESSION_ID}`, { method: 'PUT', body: { duration_minutes: 60, workout_id: null } });
  assert.equal(result.status, 200);
  assert.ok(state.sessionUpdates.some((update) => update.workout_id === null));
});

test('validateWorkoutIds validates many ids with exactly one workouts query', async () => {
  resetState();
  state.workoutList = [
    { id: WORKOUT_ID, coach_id: COACH_ID },
    { id: WORKOUT_ID_2, coach_id: null },
  ];
  const result = await validateWorkoutIds([WORKOUT_ID, WORKOUT_ID_2, WORKOUT_ID, null, undefined], COACH_ID);
  assert.deepEqual(result, { ok: true, value: [WORKOUT_ID, WORKOUT_ID_2] });
  assert.equal(state.workoutQueries, 1);
});

test('validateWorkoutIds rejects an unusable id and skips the query when there is nothing to check', async () => {
  resetState();
  state.workoutList = [{ id: WORKOUT_ID, coach_id: OTHER_COACH_ID }];
  assert.deepEqual(await validateWorkoutIds([WORKOUT_ID], COACH_ID), { ok: false, error: 'Workout not found' });
  resetState();
  assert.deepEqual(await validateWorkoutIds([null, undefined], COACH_ID), { ok: true, value: [] });
  assert.equal(state.workoutQueries, 0);
  assert.equal((await validateWorkoutIds(['nope'], COACH_ID)).ok, false);
});

test('validateWorkoutAttachment null detaches without a query', async () => {
  resetState();
  assert.deepEqual(await validateWorkoutAttachment(null, COACH_ID), { ok: true, value: null });
  assert.equal(state.workoutQueries, 0);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && node --test test/session-workout-validation.test.js`
Expected: FAIL — `Cannot find module '../src/lib/sessionWorkouts'`.

- [ ] **Step 3: Create the shared validator**

Create `backend/src/lib/sessionWorkouts.js`:

```js
const { supabaseAdmin } = require('../supabase');
const { validateUuid } = require('../validation/business');

// A session may carry a workout template the owning coach can use: their own,
// or a shared one (coach_id null — the same set GET /programs/workouts offers).
// Archived workouts are excluded by the queries below.
function usable(workout, coachId) {
  return Boolean(workout) && (workout.coach_id === null || workout.coach_id === coachId);
}

// Single attachment. null detaches. Returns { ok, value | error }.
async function validateWorkoutAttachment(workoutId, coachId) {
  if (workoutId === null) return { ok: true, value: null };
  const idValidation = validateUuid(workoutId, 'Workout ID');
  if (!idValidation.ok) return { ok: false, error: idValidation.error };
  const { data: workout } = await supabaseAdmin.from('workouts').select('id, coach_id')
    .eq('id', idValidation.value).eq('archived', false).maybeSingle();
  if (!usable(workout, coachId)) return { ok: false, error: 'Workout not found' };
  return { ok: true, value: workout.id };
}

// Bulk variant for a series: one query for all distinct ids (a repeating
// program references only a handful of templates). null/undefined are skipped.
async function validateWorkoutIds(workoutIds, coachId) {
  const distinct = [...new Set((workoutIds || []).filter((id) => id !== null && id !== undefined))];
  for (const id of distinct) {
    const validation = validateUuid(id, 'Workout ID');
    if (!validation.ok) return { ok: false, error: validation.error };
  }
  if (!distinct.length) return { ok: true, value: [] };
  const { data, error } = await supabaseAdmin.from('workouts').select('id, coach_id')
    .in('id', distinct).eq('archived', false);
  if (error) throw error;
  const found = new Map((data || []).map((workout) => [String(workout.id).toLowerCase(), workout]));
  for (const id of distinct) {
    if (!usable(found.get(id.toLowerCase()), coachId)) return { ok: false, error: 'Workout not found' };
  }
  return { ok: true, value: distinct };
}

module.exports = { validateWorkoutAttachment, validateWorkoutIds };
```

- [ ] **Step 4: Point `sessions.js` at the shared validator**

In `backend/src/routes/sessions.js`, delete lines 25–36 (the comment and local `validateWorkoutAttachment` function) and add an import after the existing `require('../validation/business')` block:

```js
const { validateWorkoutAttachment } = require('../lib/sessionWorkouts');
```
Keep `attachWorkout` (lines 38–43) as is.

- [ ] **Step 5: Run the tests**

Run: `cd backend && node --test test/session-workout-validation.test.js`
Expected: every test in the file PASSES (the shared-workout create test, the null-detach update test, and the `validateWorkout*` tests). The ordering tests are added in Task 2 so that this commit is green.

- [ ] **Step 6: Commit**

```bash
git add backend/src/lib/sessionWorkouts.js backend/test/session-workout-validation.test.js backend/src/routes/sessions.js
git commit -m "feat: allow shared workouts on sessions and add bulk workout validation" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 2: Validate the workout before scheduling

**Files:**
- Modify: `backend/src/routes/sessions.js` (`POST /` and `PUT /:id` handlers)
- Test: `backend/test/session-workout-validation.test.js` (append the ordering tests)

**Interfaces:**
- Consumes: `validateWorkoutAttachment` from Task 1.

- [ ] **Step 1: Append the failing ordering tests**

Append to `backend/test/session-workout-validation.test.js` (the helpers `send`, `createBody`, `scheduledCalls`, `coachUser`, `resetState` are already defined above):

```js
test('create with another coach\'s workout returns 400 and never calls schedule_session', async () => {
  resetState();
  currentUser = coachUser;
  state.workoutRow = { id: WORKOUT_ID, coach_id: OTHER_COACH_ID };
  const result = await send('/api/sessions', { body: createBody(WORKOUT_ID) });
  assert.equal(result.status, 400);
  assert.equal(scheduledCalls().length, 0);
});

test('create with an archived or missing workout returns 400 and never schedules', async () => {
  resetState();
  currentUser = coachUser;
  state.workoutRow = null; // the query filters archived = false
  const result = await send('/api/sessions', { body: createBody(WORKOUT_ID) });
  assert.equal(result.status, 400);
  assert.equal(scheduledCalls().length, 0);
});

test('create with a malformed workout id returns 400 and never schedules', async () => {
  resetState();
  currentUser = coachUser;
  const result = await send('/api/sessions', { body: createBody('not-a-uuid') });
  assert.equal(result.status, 400);
  assert.equal(scheduledCalls().length, 0);
});

test('update with a foreign workout returns 400 and never reschedules', async () => {
  resetState();
  currentUser = coachUser;
  state.workoutRow = { id: WORKOUT_ID, coach_id: OTHER_COACH_ID };
  state.sessionRow = { id: SESSION_ID, client_id: CLIENT_ID, coach_id: COACH_ID, scheduled_at: FUTURE, duration_minutes: 60, status: 'scheduled', archived: false };
  const result = await send(`/api/sessions/${SESSION_ID}`, { method: 'PUT', body: { duration_minutes: 45, workout_id: WORKOUT_ID } });
  assert.equal(result.status, 400);
  assert.equal(scheduledCalls().length, 0);
});
```

- [ ] **Step 2: Run to verify they fail for the right reason**

Run: `cd backend && node --test test/session-workout-validation.test.js`
Expected: exactly these four new tests FAIL, each on `scheduledCalls().length` being `1` instead of `0` (the route schedules first and validates afterwards); every other test passes. If a different assertion fails, fix the test before touching the route.

- [ ] **Step 3: Fix `POST /`**

In `backend/src/routes/sessions.js`, in the `router.post('/', …)` handler: immediately after `const coachId = req.user.role === 'admin' ? clientRow.coach_id : req.user.coach.id;` insert, **before** the `supabaseAdmin.rpc('schedule_session', …)` call:

```js
    let workoutToAttach = null;
    if (Object.hasOwn(req.body || {}, 'workout_id') && req.body.workout_id !== null) {
      const attachment = await validateWorkoutAttachment(req.body.workout_id, coachId);
      if (!attachment.ok) return res.status(400).json({ error: attachment.error });
      workoutToAttach = attachment.value;
    }
```
Then replace the existing post-RPC block:

```js
    if (Object.hasOwn(req.body || {}, 'workout_id') && req.body.workout_id !== null) {
      const attachment = await validateWorkoutAttachment(req.body.workout_id, coachId);
      if (!attachment.ok) return res.status(400).json({ error: attachment.error });
      await attachWorkout(data.session.id, attachment.value);
    }
```
with:

```js
    if (workoutToAttach) await attachWorkout(data.session.id, workoutToAttach);
```

- [ ] **Step 4: Fix `PUT /:id`**

In the `router.put('/:id', …)` handler: after the existing `if (!Object.keys(updates).length) return res.status(400)…` line and **before** the RPC, insert:

```js
    const hasWorkoutField = Object.hasOwn(req.body || {}, 'workout_id');
    let workoutToAttach = null;
    if (hasWorkoutField) {
      const attachment = await validateWorkoutAttachment(req.body.workout_id, session.coach_id);
      if (!attachment.ok) return res.status(400).json({ error: attachment.error });
      workoutToAttach = attachment.value;
    }
```
Replace the existing post-RPC block:

```js
    if (Object.hasOwn(req.body || {}, 'workout_id')) {
      const attachment = await validateWorkoutAttachment(req.body.workout_id, session.coach_id);
      if (!attachment.ok) return res.status(400).json({ error: attachment.error });
      await attachWorkout(session.id, attachment.value);
    }
```
with:

```js
    if (hasWorkoutField) await attachWorkout(session.id, workoutToAttach);
```

- [ ] **Step 5: Run the workout tests**

Run: `cd backend && node --test test/session-workout-validation.test.js`
Expected: every test PASSES, including the four ordering tests.

- [ ] **Step 6: Run the existing session suites for regressions**

```bash
cd backend && node --test test/session-detail.test.js test/session-notifications.test.js test/session-booking-validation.test.js test/session-conflicts.test.js test/coach-session-surface.test.js test/session-workout-link.test.js
```
Expected: all PASS. Note: `session-detail.test.js` already asserts that another coach's workout yields 400 with no update; it must still pass.

- [ ] **Step 7: Run the full backend suite**

Run: `cd backend && npm test`
Expected: exit status 0; pass count = the Task 0 baseline plus the new tests; zero failures.

- [ ] **Step 8: Commit**

```bash
git add backend/src/routes/sessions.js backend/test/session-workout-validation.test.js
git commit -m "fix: validate session workout before scheduling so bad input mutates nothing" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

> **Checkpoint (phase boundary — review here):** Phase 1 is independently valuable and independently shippable. Tasks 1 and 2 are two green commits (shared-workout support, then validation order). Pause for review before Phase 2.

---

## Phase 2 — Pure backend building blocks

### Task 3: `denverWallClockToUtc` and display helper

**Files:**
- Modify: `backend/src/utils/time.js`
- Create: `backend/test/time-denver-wall-clock.test.js`

**Interfaces:**
- Produces:
  - `denverWallClockToUtc(dateStr: 'YYYY-MM-DD', timeStr: 'HH:mm', tz = 'America/Denver'): string | null` — UTC ISO string (`...Z`), or `null` for a malformed or non-existent calendar date/time string. Gap → resolves forward; ambiguous → first (daylight) occurrence.
  - `formatDenverDisplay(instant: Date | string | number): string` — e.g. `Tue, Oct 6, 5:00 PM` in Denver (same format as email `formatDenver`).
  - `denverTimeOfDay(instant): string` — `HH:mm` in Denver.

- [ ] **Step 1: Write the failing test**

Create `backend/test/time-denver-wall-clock.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { denverWallClockToUtc, formatDenverDisplay, denverTimeOfDay } = require('../src/utils/time');

test('daylight time (MDT, UTC-6): 5:00 PM on 2026-10-06 is 23:00Z', () => {
  assert.equal(denverWallClockToUtc('2026-10-06', '17:00'), '2026-10-06T23:00:00.000Z');
});

test('standard time (MST, UTC-7): 5:00 PM on 2026-12-01 is 00:00Z the next day', () => {
  assert.equal(denverWallClockToUtc('2026-12-01', '17:00'), '2026-12-02T00:00:00.000Z');
});

test('the same wall-clock time keeps its local hour across the spring-forward boundary', () => {
  const before = denverWallClockToUtc('2026-03-07', '17:00'); // MST
  const after = denverWallClockToUtc('2026-03-09', '17:00'); // MDT
  assert.equal(before, '2026-03-08T00:00:00.000Z');
  assert.equal(after, '2026-03-09T23:00:00.000Z');
  assert.equal(denverTimeOfDay(before), '17:00');
  assert.equal(denverTimeOfDay(after), '17:00');
});

test('spring-forward gap (2:30 AM does not exist on 2026-03-08) resolves forward to 3:30 MDT', () => {
  assert.equal(denverWallClockToUtc('2026-03-08', '02:30'), '2026-03-08T09:30:00.000Z');
  assert.equal(denverTimeOfDay('2026-03-08T09:30:00.000Z'), '03:30');
});

test('fall-back ambiguity (1:30 AM happens twice on 2026-11-01) picks the first, daylight occurrence', () => {
  assert.equal(denverWallClockToUtc('2026-11-01', '01:30'), '2026-11-01T07:30:00.000Z');
});

test('malformed or impossible input returns null', () => {
  for (const [date, time] of [['2026-02-30', '10:00'], ['2026-13-01', '10:00'], ['2026-10-06', '24:00'],
    ['2026-10-06', '9:00'], ['10/06/2026', '10:00'], ['2026-10-06', '10:60'], [null, '10:00'], ['2026-10-06', undefined]]) {
    assert.equal(denverWallClockToUtc(date, time), null, `${date} ${time}`);
  }
});

test('formatDenverDisplay renders weekday, date, and 12-hour time in Denver', () => {
  assert.equal(formatDenverDisplay('2026-10-06T23:00:00.000Z'), 'Tue, Oct 6, 5:00 PM');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && node --test test/time-denver-wall-clock.test.js`
Expected: FAIL — `denverWallClockToUtc is not a function`.

- [ ] **Step 3: Implement**

In `backend/src/utils/time.js`, add before `module.exports`:

```js
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
```
Replace the export line with:

```js
module.exports = {
  todayRangeInTz, todayDateInTz, shiftDate, dateInTz, DEFAULT_TZ,
  denverWallClockToUtc, formatDenverDisplay, denverTimeOfDay,
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && node --test test/time-denver-wall-clock.test.js`
Expected: PASS (7 tests). If the gap or ambiguity test fails, print `tzOffsetMinutes` for `naive ± 86400000` and confirm the 2026 US transition dates (Mar 8, Nov 1) — do not weaken the expectations.

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/time.js backend/test/time-denver-wall-clock.test.js
git commit -m "feat: Denver wall-clock to UTC conversion with DST gap and ambiguity rules" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 4: Rule parser, occurrence generator, slot validation, request hash

**Files:**
- Create: `backend/src/lib/sessionSeries/rule.js`
- Create: `backend/test/session-series-rule.test.js`

**Interfaces:**
- Consumes: `shiftDate` from `backend/src/utils/time.js`.
- Produces (all from `rule.js`):
  - `MAX_SLOTS = 52`, `HORIZON_DAYS = 365`.
  - `parseRule(raw, { today }): { ok: true, value: Rule } | { ok: false, error }` where `Rule = { start_date, time, duration_minutes, weekdays: number[] (Monday-first order), interval_weeks: 1|2, end: { count: number } | { until: string }, location: string|null }`. Requires `start_date >= today`, and `end.until` within the horizon.
  - `expandSeriesRule(rule): { slots: Array<{ key: string, date: string, time: string }>, exceededMax: boolean, exceededHorizon: boolean }` — keys are `g1..gN`. `exceededMax`/`exceededHorizon` are `true` when the rule asks for more than 52 sessions / more than fit in the horizon (the list is then truncated and the route must answer 400).
  - `horizonBounds(startDate, today): { min: string, max: string }`.
  - `validateSlotShapes(rawSlots): { ok: true, value: Slot[] } | { ok: false, error }` where `Slot = { key, date, time, workout_id: string|null }` (1–52 slots, unique keys of 1–64 chars, real dates, valid times, `workout_id` null/undefined/UUID).
  - `slotHorizonError(slots, startDate, today): string | null`.
  - `canonicalJson(value): string` and `requestHash(normalizedBody): string` (sha-256 hex, keys sorted recursively).

- [ ] **Step 1: Write the failing tests**

Create `backend/test/session-series-rule.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_SLOTS, parseRule, expandSeriesRule, horizonBounds, validateSlotShapes, slotHorizonError, requestHash, canonicalJson,
} = require('../src/lib/sessionSeries/rule');

const TODAY = '2026-09-30';
const base = (overrides = {}) => ({
  start_date: '2026-10-06', time: '17:00', duration_minutes: 60,
  weekdays: [2, 4], interval_weeks: 1, end: { count: 6 }, ...overrides,
});
const dates = (rule) => expandSeriesRule(parseRule(rule, { today: TODAY }).value).slots.map((slot) => slot.date);

test('Tue/Thu weekly, count 6 starting on a Tuesday', () => {
  assert.deepEqual(dates(base()), ['2026-10-06', '2026-10-08', '2026-10-13', '2026-10-15', '2026-10-20', '2026-10-22']);
});

test('keys are stable and ordered g1..gN', () => {
  const { slots } = expandSeriesRule(parseRule(base(), { today: TODAY }).value);
  assert.deepEqual(slots.map((slot) => slot.key), ['g1', 'g2', 'g3', 'g4', 'g5', 'g6']);
  assert.ok(slots.every((slot) => slot.time === '17:00'));
});

test('every 2 weeks takes every second Monday-start week', () => {
  assert.deepEqual(dates(base({ weekdays: [2], interval_weeks: 2, end: { count: 4 } })),
    ['2026-10-06', '2026-10-20', '2026-11-03', '2026-11-17']);
});

test('weekdays earlier than start_date in its first week are skipped', () => {
  // Wednesday start: Tuesday of that week is before start_date.
  assert.deepEqual(dates(base({ start_date: '2026-10-07', end: { count: 4 } })),
    ['2026-10-08', '2026-10-13', '2026-10-15', '2026-10-20']);
});

test('Sunday sorts last within a Monday-start week', () => {
  assert.deepEqual(dates(base({ start_date: '2026-10-05', weekdays: [0, 1], end: { count: 4 } })),
    ['2026-10-05', '2026-10-11', '2026-10-12', '2026-10-18']);
});

test('until end is inclusive', () => {
  assert.deepEqual(dates(base({ weekdays: [2], end: { until: '2026-10-20' } })), ['2026-10-06', '2026-10-13', '2026-10-20']);
});

test('52 weekly sessions fit the one-year horizon; 53 do not', () => {
  const ok = expandSeriesRule(parseRule(base({ weekdays: [2], end: { count: 52 } }), { today: TODAY }).value);
  assert.equal(ok.slots.length, 52);
  assert.equal(ok.exceededMax, false);
  assert.equal(ok.exceededHorizon, false);
  assert.equal(parseRule(base({ end: { count: 53 } }), { today: TODAY }).ok, false);
});

test('count-based every-2-weeks that runs past the horizon is flagged, not silently shortened', () => {
  const result = expandSeriesRule(parseRule(base({ weekdays: [2], interval_weeks: 2, end: { count: 30 } }), { today: TODAY }).value);
  assert.equal(result.exceededHorizon, true);
  assert.ok(result.slots.length < 30);
  assert.ok(result.slots.every((slot) => slot.date <= horizonBounds('2026-10-06', TODAY).max));
});

test('until-based rules that would exceed 52 sessions are flagged as exceededMax', () => {
  const result = expandSeriesRule(parseRule(base({ weekdays: [1, 2, 3, 4, 5], end: { until: '2027-10-06' } }), { today: TODAY }).value);
  assert.equal(result.exceededMax, true);
  assert.equal(result.slots.length, MAX_SLOTS + 1);
});

test('parseRule rejects bad shapes', () => {
  const bad = [
    base({ start_date: '2026-09-29' }), // before today
    base({ start_date: '2026-02-30' }),
    base({ time: '9:00' }),
    base({ duration_minutes: 10 }),
    base({ duration_minutes: 241 }),
    base({ duration_minutes: 60.5 }),
    base({ weekdays: [] }),
    base({ weekdays: [7] }),
    base({ weekdays: [2, 2] }),
    base({ interval_weeks: 3 }),
    base({ end: {} }),
    base({ end: { count: 0 } }),
    base({ end: { until: '2026-10-01' } }), // before start_date
    base({ end: { until: '2027-10-07' } }), // past the horizon (start + 365)
    base({ end: { count: 3, until: '2026-10-20' } }),
  ];
  for (const rule of bad) assert.equal(parseRule(rule, { today: TODAY }).ok, false, JSON.stringify(rule));
  assert.equal(parseRule(null, { today: TODAY }).ok, false);
});

test('parseRule normalizes weekdays to Monday-first order and trims location', () => {
  const parsed = parseRule(base({ weekdays: [0, 4, 2], location: '  CVF Studio ' }), { today: TODAY });
  assert.deepEqual(parsed.value.weekdays, [2, 4, 0]);
  assert.equal(parsed.value.location, 'CVF Studio');
});

test('horizon bounds are inclusive on both ends', () => {
  assert.deepEqual(horizonBounds('2026-10-06', TODAY), { min: '2026-09-30', max: '2027-10-06' });
  assert.equal(slotHorizonError([{ date: '2026-09-30' }, { date: '2027-10-06' }], '2026-10-06', TODAY), null);
  assert.match(slotHorizonError([{ date: '2026-09-29' }], '2026-10-06', TODAY), /past/i);
  assert.match(slotHorizonError([{ date: '2027-10-07' }], '2026-10-06', TODAY), /year/i);
});

test('validateSlotShapes enforces count, unique keys, formats, and workout ids', () => {
  const ok = validateSlotShapes([{ key: 'a', date: '2026-10-06', time: '17:00' }, { key: 'b', date: '2026-10-08', time: '17:00', workout_id: null }]);
  assert.equal(ok.ok, true);
  assert.equal(ok.value[0].workout_id, null);
  const bad = [
    [],
    'x',
    Array.from({ length: 53 }, (_, i) => ({ key: `k${i}`, date: '2026-10-06', time: '17:00' })),
    [{ key: 'a', date: '2026-10-06', time: '17:00' }, { key: 'a', date: '2026-10-08', time: '17:00' }],
    [{ key: '', date: '2026-10-06', time: '17:00' }],
    [{ key: 'a', date: '2026-10-32', time: '17:00' }],
    [{ key: 'a', date: '2026-10-06', time: '25:00' }],
    [{ key: 'a', date: '2026-10-06', time: '17:00', workout_id: 'nope' }],
  ];
  for (const slots of bad) assert.equal(validateSlotShapes(slots).ok, false, JSON.stringify(slots).slice(0, 80));
});

test('requestHash is order-insensitive for object keys and slot order, sensitive to content', () => {
  const a = { client_id: 'c', slots: [{ key: 'a', date: '2026-10-06', time: '17:00' }, { key: 'b', date: '2026-10-08', time: '17:00' }], notify: true };
  const b = { notify: true, slots: [{ time: '17:00', date: '2026-10-08', key: 'b' }, { time: '17:00', date: '2026-10-06', key: 'a' }], client_id: 'c' };
  assert.equal(requestHash(a), requestHash(b));
  assert.notEqual(requestHash(a), requestHash({ ...a, notify: false }));
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] }), '{"a":[2,{"c":2,"d":1}],"b":1}');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && node --test test/session-series-rule.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `backend/src/lib/sessionSeries/rule.js`:

```js
const crypto = require('node:crypto');
const { shiftDate } = require('../../utils/time');
const { validateUuid } = require('../../validation/business');

const MAX_SLOTS = 52;
const HORIZON_DAYS = 365;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0];

const invalid = (error) => ({ ok: false, error });
const valid = (value) => ({ ok: true, value });

function isRealDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const isTime = (value) => typeof value === 'string' && TIME_RE.test(value);
const weekdayOf = (dateStr) => new Date(`${dateStr}T00:00:00.000Z`).getUTCDay(); // 0 = Sunday
const mondayOf = (dateStr) => shiftDate(dateStr, -((weekdayOf(dateStr) + 6) % 7));

function horizonBounds(startDate, today) {
  return { min: today, max: shiftDate(startDate, HORIZON_DAYS) };
}

// Shape + rule validation. `today` is the Denver date (YYYY-MM-DD).
function parseRule(raw, { today }) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid('Repeat settings are required');
  if (!isRealDate(raw.start_date)) return invalid('Start date must be a valid date');
  if (raw.start_date < today) return invalid('A series cannot start in the past');
  if (!isTime(raw.time)) return invalid('Time must be HH:mm');
  if (!Number.isInteger(raw.duration_minutes) || raw.duration_minutes < 15 || raw.duration_minutes > 240) {
    return invalid('Duration must be a whole number between 15 and 240 minutes');
  }
  if (!Array.isArray(raw.weekdays) || !raw.weekdays.length || raw.weekdays.length > 7
    || !raw.weekdays.every((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    || new Set(raw.weekdays).size !== raw.weekdays.length) {
    return invalid('Choose one or more weekdays');
  }
  if (raw.interval_weeks !== 1 && raw.interval_weeks !== 2) return invalid('Repeat every 1 or 2 weeks');
  const end = raw.end;
  if (!end || typeof end !== 'object' || Array.isArray(end)) return invalid('Choose how the series ends');
  const hasCount = Object.hasOwn(end, 'count');
  const hasUntil = Object.hasOwn(end, 'until');
  if (hasCount === hasUntil) return invalid('End after a number of sessions or on a date, not both');
  const bounds = horizonBounds(raw.start_date, today);
  let normalizedEnd;
  if (hasCount) {
    if (!Number.isInteger(end.count) || end.count < 1 || end.count > MAX_SLOTS) {
      return invalid(`A series has between 1 and ${MAX_SLOTS} sessions`);
    }
    normalizedEnd = { count: end.count };
  } else {
    if (!isRealDate(end.until)) return invalid('End date must be a valid date');
    if (end.until < raw.start_date) return invalid('End date cannot be before the start date');
    if (end.until > bounds.max) return invalid('A series can run at most one year from its start date');
    normalizedEnd = { until: end.until };
  }
  let location = null;
  if (raw.location !== undefined && raw.location !== null && raw.location !== '') {
    if (typeof raw.location !== 'string') return invalid('Location must be text');
    location = raw.location.trim() || null;
  }
  const weekdays = MONDAY_FIRST.filter((day) => raw.weekdays.includes(day));
  return valid({
    start_date: raw.start_date, time: raw.time, duration_minutes: raw.duration_minutes,
    weekdays, interval_weeks: raw.interval_weeks, end: normalizedEnd, location,
  });
}

// Expands a parsed rule. Returns at most MAX_SLOTS + 1 slots (the extra one,
// when present, signals exceededMax). Slots beyond the horizon are never
// returned; exceededHorizon says the rule wanted more than fit.
function expandSeriesRule(rule) {
  const bounds = horizonBounds(rule.start_date, rule.start_date);
  const slots = [];
  let exceededHorizon = false;
  let exceededMax = false;
  const firstMonday = mondayOf(rule.start_date);
  const wantCount = Object.hasOwn(rule.end, 'count') ? rule.end.count : Infinity;
  const until = Object.hasOwn(rule.end, 'until') ? rule.end.until : null;

  for (let week = 0; week < 120 && !exceededMax; week += rule.interval_weeks) {
    for (const weekday of rule.weekdays) {
      const date = shiftDate(firstMonday, week * 7 + ((weekday + 6) % 7));
      if (date < rule.start_date) continue;
      if (until && date > until) return finish();
      if (slots.length >= wantCount) return finish();
      if (date > bounds.max) { exceededHorizon = true; return finish(); }
      slots.push({ key: `g${slots.length + 1}`, date, time: rule.time });
      if (slots.length > MAX_SLOTS) { exceededMax = true; break; }
    }
  }
  return finish();

  function finish() { return { slots, exceededMax, exceededHorizon }; }
}

function validateSlotShapes(rawSlots) {
  if (!Array.isArray(rawSlots) || rawSlots.length < 1 || rawSlots.length > MAX_SLOTS) {
    return invalid(`Choose between 1 and ${MAX_SLOTS} sessions`);
  }
  const seen = new Set();
  const value = [];
  for (const slot of rawSlots) {
    if (!slot || typeof slot !== 'object' || Array.isArray(slot)) return invalid('Each session needs a key, date and time');
    if (typeof slot.key !== 'string' || !slot.key.trim() || slot.key.length > 64) return invalid('Each session needs a key');
    if (seen.has(slot.key)) return invalid('Session keys must be unique');
    seen.add(slot.key);
    if (!isRealDate(slot.date)) return invalid('Each session needs a valid date');
    if (!isTime(slot.time)) return invalid('Each session needs a valid time');
    let workoutId = null;
    if (slot.workout_id !== undefined && slot.workout_id !== null) {
      const check = validateUuid(slot.workout_id, 'Workout ID');
      if (!check.ok) return invalid(check.error);
      workoutId = check.value;
    }
    value.push({ key: slot.key, date: slot.date, time: slot.time, workout_id: workoutId });
  }
  return valid(value);
}

// One horizon definition for generation, edits, additions, suggestions and creation.
function slotHorizonError(slots, startDate, today) {
  const bounds = horizonBounds(startDate, today);
  for (const slot of slots) {
    if (slot.date < bounds.min) return 'Sessions cannot be in the past';
    if (slot.date > bounds.max) return 'Sessions must be within one year of the start date';
  }
  return null;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// Hash of the normalized request body. Slots are sorted so row order cannot
// change the hash; everything else is key-sorted by canonicalJson.
function requestHash(normalizedBody) {
  const body = { ...normalizedBody };
  if (Array.isArray(body.slots)) {
    body.slots = [...body.slots].sort((a, b) => `${a.date}T${a.time}|${a.key}`.localeCompare(`${b.date}T${b.time}|${b.key}`));
  }
  return crypto.createHash('sha256').update(canonicalJson(body)).digest('hex');
}

module.exports = {
  MAX_SLOTS, HORIZON_DAYS, parseRule, expandSeriesRule, horizonBounds, validateSlotShapes,
  slotHorizonError, canonicalJson, requestHash,
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && node --test test/session-series-rule.test.js`
Expected: PASS (all tests). If the "exceededMax" test shows `slots.length` ≠ 53, re-check that the loop breaks after pushing the 53rd slot (the intent is exactly MAX_SLOTS + 1).

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/sessionSeries/rule.js backend/test/session-series-rule.test.js
git commit -m "feat: series rule parser, occurrence generator, slot validation and request hash" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 5: Suggestion candidates and chunking

**Files:**
- Create: `backend/src/lib/sessionSeries/alternatives.js`
- Create: `backend/test/session-series-alternatives.test.js`

**Interfaces:**
- Produces: `candidateTimes({ date, time }): Array<{ date, time }>` — up to 24 same-day start times within ±3 h in 15-minute steps, ordered by closeness (`+15, -15, +30, -30, …`), excluding the requested time and clamped to the allowed start times `05:00–20:45` (the existing `DateTimePicker` slots; these are start times, not a studio-hours policy); `chunk(items, size)`; constants `MAX_ALTERNATIVES_PER_CALL = 600`, `MAX_SUGGESTIONS_PER_ROW = 3`.

- [ ] **Step 1: Write the failing test**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { candidateTimes, chunk, MAX_ALTERNATIVES_PER_CALL, MAX_SUGGESTIONS_PER_ROW } = require('../src/lib/sessionSeries/alternatives');

test('candidates alternate +15/-15 outward, same date, excluding the requested time', () => {
  const out = candidateTimes({ date: '2026-10-06', time: '12:00' });
  assert.equal(out.length, 24);
  assert.deepEqual(out.slice(0, 4).map((c) => c.time), ['12:15', '11:45', '12:30', '11:30']);
  assert.ok(out.every((c) => c.date === '2026-10-06'));
  assert.ok(!out.some((c) => c.time === '12:00'));
});

test('candidates are clamped to the allowed start times 05:00-20:45', () => {
  const early = candidateTimes({ date: '2026-10-06', time: '05:15' });
  assert.ok(early.every((c) => c.time >= '05:00' && c.time <= '20:45'));
  assert.ok(early.some((c) => c.time === '05:00'));
  const late = candidateTimes({ date: '2026-10-06', time: '20:30' });
  assert.ok(late.every((c) => c.time <= '20:45'));
  assert.ok(late.some((c) => c.time === '20:45'));
});

test('chunk splits into calls of at most the given size and preserves order', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 3), []);
});

test('52 conflicting rows x 24 candidates (1,248) chunk into calls of at most 600', () => {
  const all = Array.from({ length: 52 * 24 }, (_, i) => i);
  const parts = chunk(all, MAX_ALTERNATIVES_PER_CALL);
  assert.equal(all.length, 1248);
  assert.equal(parts.length, 3);
  assert.ok(parts.every((part) => part.length <= 600));
  assert.equal(parts.flat().length, 1248);
  assert.equal(MAX_SUGGESTIONS_PER_ROW, 3);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && node --test test/session-series-alternatives.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `backend/src/lib/sessionSeries/alternatives.js`:

```js
const STEP_MINUTES = 15;
const WINDOW_MINUTES = 180;
const FIRST_START = 5 * 60;          // 05:00 — the DateTimePicker's first allowed start time
const LAST_START = 20 * 60 + 45;     // 20:45 — and its last (a start time, not a closing time: a 90-minute session started then ends later)
const MAX_ALTERNATIVES_PER_CALL = 600;
const MAX_SUGGESTIONS_PER_ROW = 3;

const pad = (n) => String(n).padStart(2, '0');
const toTime = (minutes) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

// Same-day alternatives around the requested time, nearest first: +15, -15, +30, -30, ...
function candidateTimes({ date, time }) {
  const [hour, minute] = time.split(':').map(Number);
  const base = hour * 60 + minute;
  const out = [];
  for (let delta = STEP_MINUTES; delta <= WINDOW_MINUTES; delta += STEP_MINUTES) {
    for (const sign of [1, -1]) {
      const candidate = base + sign * delta;
      if (candidate < FIRST_START || candidate > LAST_START) continue;
      out.push({ date, time: toTime(candidate) });
    }
  }
  return out;
}

function chunk(items, size) {
  const parts = [];
  for (let i = 0; i < items.length; i += size) parts.push(items.slice(i, i + size));
  return parts;
}

module.exports = { candidateTimes, chunk, MAX_ALTERNATIVES_PER_CALL, MAX_SUGGESTIONS_PER_ROW };
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && node --test test/session-series-alternatives.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/sessionSeries/alternatives.js backend/test/session-series-alternatives.test.js
git commit -m "feat: series suggestion candidates and chunking" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Phase 3 — Database

Four additive migrations, then SQL behavior tests that run against a **disposable local Supabase stack**. Authoring the SQL and the static tests does not need Docker; the behavioral steps do.

> **Owned-stack guard.** Every database command in this plan goes through `supabase/tests/session_series/stack.sh`, which creates and operates **its own** Supabase stack (project id `cvfpt-series-test`, ports shifted to 553xx, a scratch work directory under `$TMPDIR`). It never resets, stops or reads the repository's normal local stack (`CVFPT-main`) or any other container, and never runs `supabase link`, `db push`, or any command against a hosted project. Applying the migrations to Preview/Production is a separate, owner-authorized release step (see the handoff at the end).
>
> **If Docker is unavailable,** SQL and static-test files can still be authored, but their database steps are BLOCKED and **nothing from Tasks 6–11 is committed** (no commit until its checks pass). Phases 4–5 do not need Docker and can proceed with those files left uncommitted; the final status must say the database layer is unverified.

### Task 6: Docker readiness (diagnose, do not restart) and the owned stack script

**Files:**
- Create: `supabase/tests/session_series/stack.sh`, `fake_bins.sh`, `stack_guard_test.sh`

**Why this task exists:** on 2026-09-30 Docker Desktop's processes were running, but every engine call (`docker version`, `docker info`, `docker ps`) failed (HTTP 500 "check if the server supports the requested API version", later empty output). That is **not** proof of a stopped daemon or of a version mismatch, and it is not proof that no containers are running — so this task diagnoses with bounded commands and never restarts Docker on its own authority.

- [ ] **Step 1: Bounded, read-only diagnosis**

```bash
timeout 15 docker version --format 'client={{.Client.Version}} api={{.Client.APIVersion}}' || echo "docker version: failed/timed out"
timeout 15 docker info --format 'server={{.ServerVersion}} cpus={{.NCPU}} mem={{.MemTotal}}' || echo "docker info: failed/timed out"
timeout 15 docker context ls || true
timeout 10 curl -s --unix-socket "$HOME/.docker/run/docker.sock" http://localhost/version || echo "raw engine socket: no answer"
supabase --version
```
Record the output. Healthy looks like: `docker info` prints a server version and memory ≥ 4 GB.

- [ ] **Step 2: Non-disruptive remedies only, re-running Step 1 after each**

1. **Wait.** Docker Desktop may still be starting: re-run `timeout 15 docker info` every 15 s for up to 2 minutes.
2. **API version pin — only with evidence.** If the raw socket `curl …/version` answers and shows a `MaxAPIVersion`/`ApiVersion` lower than the CLI's, set `export DOCKER_API_VERSION=<that value>` for this shell and retry. A bare HTTP 500 is not evidence of a mismatch; do not set the variable on a guess.
3. **Stop.** If the engine still does not answer, mark this task and every database step in Tasks 7–11 **BLOCKED**, report the Step 1 evidence, and continue with Phases 4–5. **Do not restart Docker Desktop.** A restart may interrupt unrelated containers or development databases, and an unresponsive API does not show that none are running. Ask the owner in the report: "Do you authorize restarting Docker Desktop (this may interrupt anything running in Docker)?" Proceed only on an explicit yes, and then only once.

If a real installation, access or system-permission problem blocks Docker (an update/licence prompt, a privileged-helper password), report it to the owner as well; do not work around it.

- [ ] **Step 3: Create the owned-stack script**

Create `supabase/tests/session_series/stack.sh` and `chmod +x` it:

```bash
#!/usr/bin/env bash
# Owned, disposable Supabase stack for the recurring-sessions database tests. LOCAL ONLY.
#
#   stack.sh up                    create the scratch work dir and start the database
#   stack.sh reset [--version V]   rebuild THIS stack's database from the copied migrations
#   stack.sh psql [psql args...]   run psql inside THIS stack's database container
#   stack.sh status                exit 0 running, 1 not running, 2 Docker could not be queried
#   stack.sh down                  stop THIS stack, delete its volumes and scratch dir (fails loudly if it cannot)
#
# The identity is FIXED so every start, reset, test, race and cleanup targets the same owned
# stack:  project id "cvfpt-series-test", container "supabase_db_cvfpt-series-test",
# ports shifted from 543xx to 553xx, work dir "$TMPDIR/cvfpt-series-test-stack". It never
# touches the repository's normal local stack (project id "CVFPT-main") or any other
# container, and it never restarts Docker.
#
# Safety rules (each has a regression test in stack_guard_test.sh):
#  - The configuration is built and VERIFIED in a staging directory and only then moved into
#    place, so "$STACK_DIR/supabase" never holds a copy that still names another project.
#  - Nothing is stopped because a directory exists. `down` stops only the fixed test project
#    (`supabase stop --project-id cvfpt-series-test`), and only when Docker shows containers or
#    volumes carrying that project's label. Before that, it only removes scratch files.
#  - Every Docker query must SUCCEED. A failed query is a failure, never "nothing there".
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PROJECT_ID="cvfpt-series-test"
LABEL="com.supabase.cli.project"
STACK_DIR="${TMPDIR:-/tmp}/${PROJECT_ID}-stack"
DB_CONTAINER="supabase_db_${PROJECT_ID}"
# Start only the database: the SQL tests need nothing else.
EXCLUDE="gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor"
TIMEOUT=""
if command -v timeout >/dev/null 2>&1; then TIMEOUT="timeout 30"; fi

dk() { $TIMEOUT docker "$@"; }
sb() { supabase --workdir "$STACK_DIR" "$@"; }   # only ever used after config_is_owned

config_is_owned() {
  [ -f "$STACK_DIR/supabase/config.toml" ] && grep -qx "project_id = \"$PROJECT_ID\"" "$STACK_DIR/supabase/config.toml"
}

owned_containers() { dk ps -a --filter "label=${LABEL}=${PROJECT_ID}" -q; }
owned_volumes() { dk volume ls --filter "label=${LABEL}=${PROJECT_ID}" -q; }

assert_owned() {
  local label
  label="$(dk inspect --format "{{ index .Config.Labels \"${LABEL}\" }}" "$DB_CONTAINER" 2>/dev/null || true)"
  if [ "$label" != "$PROJECT_ID" ]; then
    echo "refusing: container $DB_CONTAINER is not owned by project $PROJECT_ID (label='$label')" >&2
    exit 2
  fi
}

teardown() {
  dk info >/dev/null 2>&1 || { echo "cannot verify teardown: the Docker engine is not responding" >&2; return 1; }
  local containers volumes where
  containers="$(owned_containers)"
  volumes="$(owned_volumes)"
  if [ -n "$containers" ] || [ -n "$volumes" ]; then
    # Run from the scratch dir (or TMPDIR) so the repository's own config can never be picked up.
    where="${TMPDIR:-/tmp}"; if [ -d "$STACK_DIR" ]; then where="$STACK_DIR"; fi
    ( cd "$where" && supabase stop --project-id "$PROJECT_ID" --no-backup )
    containers="$(owned_containers)"
    volumes="$(owned_volumes)"
    if [ -n "$containers" ] || [ -n "$volumes" ]; then
      echo "incomplete teardown: owned resources remain (containers: ${containers:-none}; volumes: ${volumes:-none})" >&2
      return 1
    fi
  fi
  rm -rf "$STACK_DIR"
}

cmd="${1:-}"; shift || true
case "$cmd" in
  up)
    command -v supabase >/dev/null || { echo "supabase CLI not found" >&2; exit 1; }
    dk info >/dev/null 2>&1 || { echo "Docker engine is not responding; not starting (this script never restarts Docker)" >&2; exit 1; }
    teardown                                         # any previous owned stack, verified gone
    mkdir -p "$STACK_DIR/staging"
    cp -R "$ROOT/supabase" "$STACK_DIR/staging/supabase"
    rm -rf "$STACK_DIR/staging/supabase/.temp" "$STACK_DIR/staging/supabase/.branches"   # never inherit a hosted-project link
    sed -E -i.bak \
      -e "s/^project_id = .*/project_id = \"$PROJECT_ID\"/" \
      -e 's/([^0-9])543([0-9]{2})([^0-9]|$)/\1553\2\3/g' \
      "$STACK_DIR/staging/supabase/config.toml"
    rm -f "$STACK_DIR/staging/supabase/config.toml.bak"
    if ! grep -qx "project_id = \"$PROJECT_ID\"" "$STACK_DIR/staging/supabase/config.toml"; then
      echo "config rewrite failed: the copy does not name project $PROJECT_ID; refusing to start" >&2
      rm -rf "$STACK_DIR"; exit 1
    fi
    if grep -nE '(^|[^0-9])543[0-9]{2}([^0-9]|$)' "$STACK_DIR/staging/supabase/config.toml"; then
      echo "port rewrite incomplete; refusing to start" >&2
      rm -rf "$STACK_DIR"; exit 1
    fi
    mv "$STACK_DIR/staging/supabase" "$STACK_DIR/supabase"
    rmdir "$STACK_DIR/staging"
    config_is_owned || { echo "internal error: staged config is not owned" >&2; rm -rf "$STACK_DIR"; exit 1; }
    sb start -x "$EXCLUDE"
    assert_owned
    ;;
  reset)
    config_is_owned || { echo "refusing: no verified owned config in $STACK_DIR" >&2; exit 2; }
    assert_owned
    if [ "${1:-}" = "--version" ]; then sb db reset --local --version "${2:?version required}"; else sb db reset --local; fi
    ;;
  psql)
    assert_owned
    dk exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 "$@"
    ;;
  status)
    echo "project=$PROJECT_ID container=$DB_CONTAINER workdir=$STACK_DIR"
    if ! state="$(dk ps -a --filter "name=^/${DB_CONTAINER}\$" --format '{{.State}}')"; then
      echo "cannot inspect: Docker did not answer" >&2; exit 2
    fi
    if [ "$state" = "running" ]; then echo "running: yes"; exit 0; fi
    echo "running: no (${state:-absent})"; exit 1
    ;;
  down)
    teardown
    echo "owned stack removed"
    ;;
  *)
    echo "usage: stack.sh up|reset [--version V]|psql [args]|status|down" >&2; exit 2 ;;
esac
```

- [ ] **Step 4: Create the Docker-free safety tests and make them pass**

These use fake `docker` and `supabase` executables first on `PATH`, so they need neither Docker nor the Supabase CLI and run anywhere (including CI before the real database job). They inject failures after directory creation, during the config rewrite, during startup and during teardown, and assert that **no path ever stops or resets any project other than the fixed test project**, and that teardown and inspection failures are never swallowed.

Create `supabase/tests/session_series/fake_bins.sh`:

```bash
# Shared helper sourced by the guard tests: writes fake `docker` and `supabase` executables.
# State lives in plain files under $FAKE_DIR so each test can arrange exactly the world it needs.
write_fake_bins() {   # write_fake_bins <bin-dir>
  cat > "$1/docker" <<'DOCKER'
#!/usr/bin/env bash
echo "docker $*" >> "$FAKE_DIR/docker.log"
if [ -f "$FAKE_DIR/docker_down" ]; then echo "Cannot connect to the Docker daemon" >&2; exit 1; fi
sub="${1:-}"; shift || true
args="$*"
case "$sub" in
  info) exit 0 ;;
  ps)
    if [ -f "$FAKE_DIR/ps_fail" ]; then echo "ps failed" >&2; exit 1; fi
    case "$args" in
      *"label=com.supabase.cli.project=cvfpt-series-test"*) cat "$FAKE_DIR/owned_containers" 2>/dev/null || true ;;
      *"name=^/supabase_db_cvfpt-series-test"*)
        if [ -f "$FAKE_DIR/owned_container_running" ]; then echo running
        elif [ -s "$FAKE_DIR/owned_containers" ]; then echo exited; fi ;;
      *"label=com.supabase.cli.project"*) cat "$FAKE_DIR/containers_all" 2>/dev/null || true ;;
    esac
    exit 0 ;;
  volume)
    if [ -f "$FAKE_DIR/volume_fail" ]; then echo "volume ls failed" >&2; exit 1; fi
    case "$args" in
      *"label=com.supabase.cli.project=cvfpt-series-test"*) cat "$FAKE_DIR/owned_volumes" 2>/dev/null || true ;;
      *"label=com.supabase.cli.project"*) cat "$FAKE_DIR/volumes_all" 2>/dev/null || true ;;
    esac
    exit 0 ;;
  inspect) if [ -s "$FAKE_DIR/owned_containers" ]; then echo "cvfpt-series-test"; exit 0; fi; exit 1 ;;
  exec) exit 0 ;;
esac
exit 0
DOCKER
  cat > "$1/supabase" <<'SUPABASE'
#!/usr/bin/env bash
echo "supabase $*" >> "$FAKE_DIR/supabase.log"
sub=""
for a in "$@"; do case "$a" in start|stop|db) sub="$a" ;; esac; done
case "$sub" in
  start)
    if [ -f "$FAKE_DIR/start_fail" ]; then exit 1; fi
    echo cid1 > "$FAKE_DIR/owned_containers"; touch "$FAKE_DIR/owned_container_running"; exit 0 ;;
  stop)
    if [ -f "$FAKE_DIR/stop_fail" ]; then exit 1; fi
    if [ ! -f "$FAKE_DIR/stop_leaves" ]; then : > "$FAKE_DIR/owned_containers"; rm -f "$FAKE_DIR/owned_container_running"; fi
    if [ ! -f "$FAKE_DIR/stop_leaves" ] && [ ! -f "$FAKE_DIR/stop_leaves_volume" ]; then : > "$FAKE_DIR/owned_volumes"; fi
    if [ -f "$FAKE_DIR/stop_leaves_volume" ]; then : > "$FAKE_DIR/owned_containers"; rm -f "$FAKE_DIR/owned_container_running"; fi
    exit 0 ;;
  db) exit 0 ;;
esac
exit 0
SUPABASE
  chmod +x "$1/docker" "$1/supabase"
}
```

Create `supabase/tests/session_series/stack_guard_test.sh` and `chmod +x` it:

```bash
#!/usr/bin/env bash
# Regression tests for stack.sh safety. They put FAKE `docker` and `supabase` executables first on
# PATH, so they need neither Docker nor the Supabase CLI and can run anywhere (including CI before
# the real database job). They prove that no failure path stops or resets any project other than
# the fixed test project, and that teardown/inspection failures are never swallowed.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=fake_bins.sh
. "$HERE/fake_bins.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
ORIG_PATH="$PATH"
PASS=0
fail() { echo "FAIL [$CASE]: $*" >&2; [ -f "${OUT:-/dev/null}" ] && sed 's/^/    | /' "$OUT" >&2; exit 1; }

sandbox() {   # sandbox <case-name>; builds a miniature repo plus fakes, and points the environment at them
  CASE="$1"
  SB="$(mktemp -d "$WORK/sb.XXXXXX")"
  export FAKE_DIR="$SB/fake"
  mkdir -p "$FAKE_DIR" "$SB/bin" "$SB/tmp" "$SB/repo/supabase/migrations" "$SB/repo/supabase/tests/session_series"
  printf 'project_id = "CVFPT-main"\n[api]\nport = 54321\n[db]\nport = 54322\nshadow_port = 54320\n' > "$SB/repo/supabase/config.toml"
  cp "$HERE/stack.sh" "$SB/repo/supabase/tests/session_series/stack.sh"
  write_fake_bins "$SB/bin"
  : > "$FAKE_DIR/supabase.log"; : > "$FAKE_DIR/docker.log"
  export PATH="$SB/bin:$ORIG_PATH" TMPDIR="$SB/tmp"
  STACK="$SB/repo/supabase/tests/session_series/stack.sh"
  STACK_DIR="$SB/tmp/cvfpt-series-test-stack"
  OUT="$SB/out.log"
}
stack() { set +e; bash "$STACK" "$@" > "$OUT" 2>&1; CODE=$?; set -e; }
expect_code() { [ "$CODE" -eq "$1" ] || fail "expected exit $1, got $CODE"; }
expect_nonzero() { [ "$CODE" -ne 0 ] || fail "expected a non-zero exit, got 0"; }
expect_no_supabase_calls() { [ ! -s "$FAKE_DIR/supabase.log" ] || fail "supabase must not be called, but was: $(cat "$FAKE_DIR/supabase.log")"; }
expect_never_foreign() { ! grep -q "CVFPT-main" "$FAKE_DIR/supabase.log" || fail "a command named the normal development project"; }
done_case() { PASS=$((PASS + 1)); echo "  ok  $CASE"; }

owned_stack_running() { echo cid1 > "$FAKE_DIR/owned_containers"; echo vol1 > "$FAKE_DIR/owned_volumes"; touch "$FAKE_DIR/owned_container_running"; }
write_owned_config() { mkdir -p "$STACK_DIR/supabase"; printf 'project_id = "cvfpt-series-test"\n' > "$STACK_DIR/supabase/config.toml"; }
write_foreign_config() { mkdir -p "$STACK_DIR/supabase"; printf 'project_id = "CVFPT-main"\n' > "$STACK_DIR/supabase/config.toml"; }

sandbox "partial setup: scratch copy still names CVFPT-main -> down only deletes scratch files"
write_foreign_config
stack down
expect_code 0; expect_no_supabase_calls; [ ! -e "$STACK_DIR" ] || fail "scratch dir should be removed"; done_case

sandbox "a development stack is running (foreign label) -> down never touches it"
write_foreign_config
printf 'container|devid1|supabase_db_CVFPT-main|2026-09-01|running\n' > "$FAKE_DIR/containers_all"
stack down
expect_code 0; expect_no_supabase_calls; expect_never_foreign; done_case

sandbox "owned stack running -> down stops ONLY the fixed project, then removes scratch"
write_owned_config; owned_stack_running
stack down
expect_code 0
[ "$(cat "$FAKE_DIR/supabase.log")" = "supabase stop --project-id cvfpt-series-test --no-backup" ] || fail "unexpected supabase calls: $(cat "$FAKE_DIR/supabase.log")"
expect_never_foreign; [ ! -e "$STACK_DIR" ] || fail "scratch dir should be removed"; done_case

sandbox "owned stack running but the scratch config is the partial/foreign copy -> still stops only the fixed project id"
write_foreign_config; owned_stack_running
stack down
expect_code 0
[ "$(cat "$FAKE_DIR/supabase.log")" = "supabase stop --project-id cvfpt-series-test --no-backup" ] || fail "unexpected supabase calls: $(cat "$FAKE_DIR/supabase.log")"
expect_never_foreign; done_case

sandbox "stop fails -> down fails and keeps the scratch dir for a retry"
write_owned_config; owned_stack_running; touch "$FAKE_DIR/stop_fail"
stack down
expect_nonzero; [ -d "$STACK_DIR" ] || fail "scratch dir must be kept when teardown failed"; done_case

sandbox "stop 'succeeds' but the container is left behind -> down fails"
write_owned_config; owned_stack_running; touch "$FAKE_DIR/stop_leaves"
stack down
expect_nonzero; grep -q "incomplete teardown" "$OUT" || fail "should say teardown is incomplete"; [ -d "$STACK_DIR" ] || fail "scratch dir must be kept"; done_case

sandbox "stop removes the container but leaves an owned volume -> down fails"
write_owned_config; owned_stack_running; touch "$FAKE_DIR/stop_leaves_volume"
stack down
expect_nonzero; grep -q "volumes: vol1" "$OUT" || fail "should name the leftover volume"; done_case

sandbox "Docker engine not responding -> down fails and calls nothing"
write_owned_config; touch "$FAKE_DIR/docker_down"
stack down
expect_nonzero; expect_no_supabase_calls; done_case

sandbox "docker ps failing is not treated as 'nothing to stop'"
write_owned_config; touch "$FAKE_DIR/ps_fail"
stack down
expect_nonzero; expect_no_supabase_calls; done_case

sandbox "nothing exists at all -> down is a clean no-op"
stack down
expect_code 0; expect_no_supabase_calls; done_case

sandbox "setup failure BEFORE the config rewrite (repo config.toml missing) -> up fails, never starts, nothing to stop afterwards"
rm "$SB/repo/supabase/config.toml"
stack up
expect_nonzero
! grep -q " start" "$FAKE_DIR/supabase.log" || fail "start must not run"
[ ! -e "$STACK_DIR/supabase" ] || fail "no half-built 'supabase' dir may remain"
stack down
expect_code 0; expect_no_supabase_calls; expect_never_foreign; done_case

sandbox "rewrite is a silent no-op (no project_id line) -> up refuses before starting"
printf '[api]\nport = 54321\n' > "$SB/repo/supabase/config.toml"
stack up
expect_nonzero; grep -q "config rewrite failed" "$OUT" || fail "should explain the refusal"
! grep -q " start" "$FAKE_DIR/supabase.log" || fail "start must not run"
[ ! -e "$STACK_DIR/supabase" ] || fail "no unverified config may remain"; done_case

sandbox "ports left unrewritten -> up refuses before starting"
printf 'project_id = "CVFPT-main"\n[api]\nport = 54321x\nurl = "http://127.0.0.1:54321"\n' > "$SB/repo/supabase/config.toml"
# 54321 followed by a letter is not rewritten by the digit-guarded pattern, so the leftover check must catch it
stack up
if [ "$CODE" -eq 0 ]; then
  # the guarded pattern DID rewrite the url form; make sure the owned config is correct instead
  grep -qx 'project_id = "cvfpt-series-test"' "$STACK_DIR/supabase/config.toml" || fail "owned config expected"
else
  ! grep -q " start" "$FAKE_DIR/supabase.log" || fail "start must not run after a refused rewrite"
fi; done_case

sandbox "startup fails after a verified rewrite -> down then stops only the fixed project"
touch "$FAKE_DIR/start_fail"
stack up
expect_nonzero
grep -qx 'project_id = "cvfpt-series-test"' "$STACK_DIR/supabase/config.toml" || fail "the config that start saw must be the owned one"
echo cid1 > "$FAKE_DIR/owned_containers"            # a partially started owned container
stack down
expect_code 0; expect_never_foreign
[ "$(grep -c "stop" "$FAKE_DIR/supabase.log")" -eq 1 ] || fail "exactly one stop expected"
grep -q -- "--project-id cvfpt-series-test" "$FAKE_DIR/supabase.log" || fail "stop must name the fixed project"; done_case

sandbox "up happy path: owned ports and project id, started with the scratch workdir"
stack up
expect_code 0
grep -qx 'project_id = "cvfpt-series-test"' "$STACK_DIR/supabase/config.toml" || fail "owned project id expected"
grep -q "^port = 55321" "$STACK_DIR/supabase/config.toml" || fail "ports must be shifted to 553xx"
grep -q "55322" "$STACK_DIR/supabase/config.toml" && grep -q "55320" "$STACK_DIR/supabase/config.toml" || fail "db and shadow ports must be shifted"
grep -q -- "--workdir $STACK_DIR start" "$FAKE_DIR/supabase.log" || fail "start must use the scratch workdir"
expect_never_foreign; done_case

sandbox "up over a leftover owned stack tears it down first (stop by fixed project id), then starts"
owned_stack_running
stack up
expect_code 0
first_stop=$(grep -n "stop" "$FAKE_DIR/supabase.log" | head -1 | cut -d: -f1); first_start=$(grep -n " start" "$FAKE_DIR/supabase.log" | head -1 | cut -d: -f1)
[ -n "$first_stop" ] && [ -n "$first_start" ] && [ "$first_stop" -lt "$first_start" ] || fail "stop must precede start"
expect_never_foreign; done_case

sandbox "reset refuses an unverified scratch config and runs no reset"
write_foreign_config
stack reset
expect_code 2; ! grep -q "db reset" "$FAKE_DIR/supabase.log" || fail "reset must not run"; done_case

sandbox "status distinguishes running (0), absent (1), and cannot-inspect (2)"
owned_stack_running; stack status; expect_code 0
: > "$FAKE_DIR/owned_containers"; rm -f "$FAKE_DIR/owned_container_running"; stack status; expect_code 1
touch "$FAKE_DIR/ps_fail"; stack status; expect_code 2; done_case

echo "stack guard tests passed ($PASS cases)"
```

Run: `bash supabase/tests/session_series/stack_guard_test.sh`
Expected: exit status 0 and `stack guard tests passed (18 cases)`. (Sharpness check, optional but recommended: temporarily change `teardown` so it calls `supabase --workdir "$STACK_DIR" stop --no-backup` whenever `$STACK_DIR/supabase` exists — the original defect — and confirm the first case fails with "supabase must not be called"; then revert the change.)

- [ ] **Step 5: Static check and CLI flags (needs no Docker)**

```bash
chmod +x supabase/tests/session_series/stack.sh supabase/tests/session_series/fake_bins.sh
bash -n supabase/tests/session_series/stack.sh
bash -n supabase/tests/session_series/stack_guard_test.sh
supabase start --help
supabase stop --help
supabase db reset --help
```
Expected: `bash -n` exits 0. In the help output confirm that `start` accepts `-x/--exclude`, that `stop` accepts `--project-id` and `--no-backup`, that `db reset` accepts `--local` and `--version`, and that the global `--workdir` flag exists. If the exclusion list is rejected, drop `-x` from the `up` command (the stack then starts every service and needs more memory) and note the deviation. If `stop --project-id` is not available in the installed CLI, stop and report: do not fall back to a config-dependent `stop`.

- [ ] **Step 6: Commit the script and its safety tests (the guard tests passed; the live stack is exercised in Step 7)**

```bash
git add supabase/tests/session_series/stack.sh supabase/tests/session_series/fake_bins.sh supabase/tests/session_series/stack_guard_test.sh
git commit -m "test: owned disposable Supabase stack script with failure-injection safety tests" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Start the owned stack and prove migrations apply to it (needs a healthy engine)**

```bash
bash supabase/tests/session_series/stack.sh up
bash supabase/tests/session_series/stack.sh status
bash supabase/tests/session_series/stack.sh reset
bash supabase/tests/session_series/stack.sh psql -c "select count(*) from public.sessions;"
```
Expected: `up` completes (the first run pulls images and can take several minutes; if a 553xx port is busy, report which process holds it rather than killing it), `status` prints `running: yes`, `reset` applies every migration, and the count query prints `0`. If the container label the script relies on (`com.supabase.cli.project`) is not what this CLI version sets, `up` fails at its ownership check — that is the intended safe failure; report it rather than loosening the check. No commit is needed for this step; if it cannot run, report BLOCKED.

### Task 7: Schema migration — `session_series`, `series_id`, `series_ordinal`

**Files:**
- Create: `supabase/migrations/20260930100000_session_series_schema.sql`
- Create: `backend/test/session-series-migrations.test.js`

**Interfaces:**
- Produces: table `public.session_series(id, coach_id, client_id, program_id, rule jsonb, created_count, request_id, request_hash, receipt jsonb, archived, created_at, unique(coach_id, request_id))`; columns `sessions.series_id uuid → session_series(id)`, `sessions.series_ordinal integer`; partial index `idx_sessions_series`.

- [ ] **Step 1: Write the failing static test**

Create `backend/test/session-series-migrations.test.js`:

```js
// Static checks on the recurring-sessions migrations. Behavior is proven by the
// local-database suite in supabase/tests/session_series/ (see run.sh); these only
// guard the shape: additive, forward-only, service-role-only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (name) => fs.readFileSync(path.join(__dirname, '../../supabase/migrations', name), 'utf8');
const FORBIDDEN = /drop table|drop column|delete from|truncate|drop function|drop constraint/i;

test('schema migration adds session_series and the session link additively', () => {
  const sql = read('20260930100000_session_series_schema.sql');
  assert.match(sql, /create table if not exists public\.session_series/);
  assert.match(sql, /unique \(coach_id, request_id\)/);
  assert.match(sql, /receipt jsonb not null/);
  assert.match(sql, /request_hash text not null/);
  assert.match(sql, /add column if not exists series_id uuid references public\.session_series\(id\)/);
  assert.match(sql, /add column if not exists series_ordinal integer/);
  assert.match(sql, /create index if not exists idx_sessions_series[\s\S]*where series_id is not null/);
  assert.match(sql, /alter table public\.session_series enable row level security/);
  assert.match(sql, /grant select, insert, update on table public\.session_series to service_role/);
  assert.doesNotMatch(sql, /to (anon|authenticated|public)\b/i);
  assert.doesNotMatch(sql, /set not null/i); // existing columns are never tightened
  assert.doesNotMatch(sql, FORBIDDEN);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && node --test test/session-series-migrations.test.js`
Expected: FAIL — `ENOENT … 20260930100000_session_series_schema.sql`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260930100000_session_series_schema.sql`:

```sql
-- Recurring sessions: schema. Additive and backward-compatible — a new table
-- plus two nullable columns on sessions. Existing callers are unaffected.
--
-- A series is a batch of ordinary sessions linked by sessions.series_id.
-- `rule` is display-only (never used to regenerate). `receipt` is the
-- immutable creation record (original slot keys, session ids, times) that makes
-- a retried request recoverable. (coach_id, request_id) is the idempotency key.

create table if not exists public.session_series (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.coaches(id),
  client_id uuid not null references public.clients(id),
  program_id uuid references public.programs(id),
  rule jsonb not null,
  created_count integer not null check (created_count between 1 and 52),
  request_id uuid not null,
  request_hash text not null,
  receipt jsonb not null,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (coach_id, request_id)
);

create index if not exists idx_session_series_client on public.session_series(client_id);

alter table public.session_series enable row level security;
grant select, insert, update on table public.session_series to service_role;

alter table public.sessions
  add column if not exists series_id uuid references public.session_series(id);
alter table public.sessions
  add column if not exists series_ordinal integer check (series_ordinal is null or series_ordinal >= 1);

create index if not exists idx_sessions_series
  on public.sessions(series_id) where series_id is not null;

select 'session series schema ready' as result;
```

- [ ] **Step 4: Run to verify the static test passes**

Run: `cd backend && node --test test/session-series-migrations.test.js`
Expected: PASS.

- [ ] **Step 5: Apply to the local database (needs Task 6)**

```bash
bash supabase/tests/session_series/stack.sh reset
bash supabase/tests/session_series/stack.sh psql -c "\d public.session_series" -c "\d public.sessions"
```
Expected: the reset succeeds and the output lists `session_series` (with `request_id`, `receipt`) and the `series_id` / `series_ordinal` columns on `sessions`. (No pipe to `grep`: read the output.)

- [ ] **Step 6: Commit (only after Steps 4 and 5 passed; if Step 5 was BLOCKED, leave both files uncommitted)**

```bash
git add supabase/migrations/20260930100000_session_series_schema.sql backend/test/session-series-migrations.test.js
git commit -m "feat: add session_series schema and sessions.series_id" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 8: Shared conflict helper, scheduler refactor, and the SQL test harness

**Files:**
- Create: `supabase/migrations/20260930110000_find_session_conflict_helper.sql`
- Create: `supabase/tests/session_series/fixtures.sql`
- Create: `supabase/tests/session_series/01_conflict_matrix.sql`
- Create: `supabase/tests/session_series/run.sh`
- Modify: `backend/test/session-series-migrations.test.js` (append)

**Interfaces:**
- Produces: `public.find_session_conflict(p_coach_id uuid, p_client_id uuid, p_scheduled_at timestamptz, p_duration_minutes integer, p_exclude_session_id uuid default null) returns jsonb` — `null`, or `{ "scope": "coach"|"client", "conflict_session": <sessions row> }`. `public.schedule_session(...)` keeps its exact signature, lock, return shapes and location-advisory behavior.
- The matrix proves the refactor is **behavior-preserving**: it must pass against the old scheduler (before this migration) and the new one (after).

- [ ] **Step 1: Write the fixtures**

Create `supabase/tests/session_series/fixtures.sql`:

```sql
-- Fixtures shared by the rolled-back SQL tests (the runner wraps each test file
-- in begin/rollback). Fixed ids; nothing here persists.
insert into public.coaches (id, name, email) values
  ('10000000-0000-4000-8000-0000000000a1', 'Series Coach One', 'series-coach-1@example.invalid'),
  ('10000000-0000-4000-8000-0000000000a2', 'Series Coach Two', 'series-coach-2@example.invalid');

insert into public.clients (id, coach_id, name, email) values
  ('20000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000a1', 'Series Client One', 'series-client-1@example.invalid'),
  ('20000000-0000-4000-8000-0000000000b2', '10000000-0000-4000-8000-0000000000a1', 'Series Client Two', 'series-client-2@example.invalid'),
  ('20000000-0000-4000-8000-0000000000b3', '10000000-0000-4000-8000-0000000000a2', 'Series Client Three', 'series-client-3@example.invalid');

insert into public.workouts (id, coach_id, name) values
  ('30000000-0000-4000-8000-0000000000c1', '10000000-0000-4000-8000-0000000000a1', 'Series Workout One'),
  ('30000000-0000-4000-8000-0000000000c2', '10000000-0000-4000-8000-0000000000a1', 'Series Workout Two');

insert into public.programs (id, coach_id, name, frequency_days) values
  ('40000000-0000-4000-8000-0000000000d1', '10000000-0000-4000-8000-0000000000a1', 'Series Program', 2);

insert into public.program_days (program_id, day_number, workout_id) values
  ('40000000-0000-4000-8000-0000000000d1', 1, '30000000-0000-4000-8000-0000000000c1'),
  ('40000000-0000-4000-8000-0000000000d1', 2, '30000000-0000-4000-8000-0000000000c2');
```

If an insert fails on a missing NOT NULL column, read the table's definition in `supabase/migrations/20260710151327_baseline_schema.sql` (programs, program_days) and add the required column with a literal value; do not change the production schema.

- [ ] **Step 2: Write the conflict matrix**

Create `supabase/tests/session_series/01_conflict_matrix.sql`:

```sql
\set ON_ERROR_STOP on
-- Behavior matrix for schedule_session. Expected outcomes encode the CURRENT
-- (pre-refactor) behavior from 20260730220646_session_conflict_protection.sql,
-- so this file must pass both before and after the find_session_conflict refactor.
do $$
declare
  c1 constant uuid := '10000000-0000-4000-8000-0000000000a1';
  c2 constant uuid := '10000000-0000-4000-8000-0000000000a2';
  k1 constant uuid := '20000000-0000-4000-8000-0000000000b1';
  k2 constant uuid := '20000000-0000-4000-8000-0000000000b2';
  k3 constant uuid := '20000000-0000-4000-8000-0000000000b3';
  t0 constant timestamptz := '2031-03-04 17:00:00+00';
  r jsonb;
  s1 uuid; s7 uuid; g uuid;
begin
  -- M1: empty calendar schedules; location advisory present and zero.
  r := public.schedule_session(null, k1, c1, t0, 60, 'Studio', true);
  if r->>'outcome' <> 'scheduled' then raise exception 'M1 expected scheduled: %', r; end if;
  if (r->>'location_overlaps')::int <> 0 then raise exception 'M1 location_overlaps expected 0: %', r; end if;
  s1 := (r->'session'->>'id')::uuid;

  -- M2: same coach, different client, overlapping -> coach_conflict naming s1.
  r := public.schedule_session(null, k2, c1, t0 + interval '30 minutes', 60, null, true);
  if r->>'outcome' <> 'coach_conflict' or (r->'conflict_session'->>'id')::uuid <> s1 then
    raise exception 'M2 expected coach_conflict on s1: %', r;
  end if;

  -- M3: same client, different coach, overlapping -> client_conflict.
  r := public.schedule_session(null, k1, c2, t0 + interval '30 minutes', 60, null, true);
  if r->>'outcome' <> 'client_conflict' then raise exception 'M3 expected client_conflict: %', r; end if;

  -- M4: back-to-back is allowed (half-open ranges).
  r := public.schedule_session(null, k2, c1, t0 + interval '60 minutes', 60, null, true);
  if r->>'outcome' <> 'scheduled' then raise exception 'M4 expected scheduled (back-to-back): %', r; end if;

  -- M5: a candidate that STARTS BEFORE an existing session but overlaps it conflicts.
  r := public.schedule_session(null, k3, c1, t0 - interval '30 minutes', 60, null, true);
  if r->>'outcome' <> 'coach_conflict' then raise exception 'M5 expected coach_conflict (starts before): %', r; end if;

  -- M6: cancelled sessions free their slot.
  update public.sessions set status = 'cancelled' where id = s1;
  r := public.schedule_session(null, k3, c1, t0, 60, null, true);
  if r->>'outcome' <> 'scheduled' then raise exception 'M6 expected scheduled after cancel: %', r; end if;

  -- M7: archived sessions free their slot.
  update public.sessions set archived = true where id = (r->'session'->>'id')::uuid;
  r := public.schedule_session(null, k1, c1, t0, 60, null, true);
  if r->>'outcome' <> 'scheduled' then raise exception 'M7 expected scheduled after archive: %', r; end if;
  s7 := (r->'session'->>'id')::uuid;

  -- M8: capacity > 1 group slot: first extra booking fits the headcount, the next hits the capacity-1 session.
  insert into public.sessions (client_id, coach_id, scheduled_at, duration_minutes, capacity)
  values (k3, c1, t0 + interval '5 hours', 60, 2) returning id into g;
  r := public.schedule_session(null, k2, c1, t0 + interval '5 hours', 60, null, true);
  if r->>'outcome' <> 'scheduled' then raise exception 'M8a expected scheduled into a capacity-2 slot: %', r; end if;
  r := public.schedule_session(null, k1, c1, t0 + interval '5 hours', 60, null, true);
  if r->>'outcome' <> 'coach_conflict' then raise exception 'M8b expected coach_conflict once a capacity-1 session overlaps: %', r; end if;

  -- M9: rescheduling excludes the session itself (5 minutes earlier overlaps only itself,
  -- and still clears the back-to-back session that starts at t0 + 60 minutes).
  r := public.schedule_session(s7, k1, c1, t0 - interval '5 minutes', 60, null, false);
  if r->>'outcome' <> 'scheduled' then raise exception 'M9 expected reschedule to exclude itself: %', r; end if;

  -- M10: location advisory is case/space-insensitive and never blocks.
  insert into public.sessions (client_id, coach_id, scheduled_at, duration_minutes, location)
  values (k3, c2, t0 + interval '10 hours', 60, 'Studio');
  r := public.schedule_session(null, k2, c1, t0 + interval '10 hours', 60, '  studio ', true);
  if r->>'outcome' <> 'scheduled' or (r->>'location_overlaps')::int <> 1 then
    raise exception 'M10 expected scheduled with one location overlap: %', r;
  end if;
end;
$$;

select 'conflict matrix passed' as result;
```

- [ ] **Step 3: Write the runner**

Create `supabase/tests/session_series/run.sh` and `chmod +x` it:

```bash
#!/usr/bin/env bash
# Database behavioral tests for recurring sessions, on the OWNED disposable stack (stack.sh).
#   bash supabase/tests/session_series/run.sh                      # start if needed, reset, run all
#   bash supabase/tests/session_series/run.sh --no-reset           # reuse the stack's current database
#   bash supabase/tests/session_series/run.sh --only 01_conflict_matrix.sql --no-reset
#   bash supabase/tests/session_series/run.sh --down               # tear the stack down afterwards (CI); a failed teardown fails the run
# Each 0*.sql file runs inside a transaction that is rolled back, so reruns are safe.
# concurrency.sh uses committed transactions and cleans up after itself.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
STACK="$DIR/stack.sh"
RESET=1
ONLY=""
DOWN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --no-reset) RESET=0 ;;
    --only) ONLY="$2"; shift ;;
    --down) DOWN=1 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

# A failed teardown must fail the run: an EXIT trap's own status is otherwise lost.
cleanup() {
  local code=$?
  trap - EXIT
  if [ "$DOWN" = 1 ]; then bash "$STACK" down || code=1; fi
  exit "$code"
}
trap cleanup EXIT
if ! bash "$STACK" status >/dev/null 2>&1; then bash "$STACK" up; fi
if [ "$RESET" = 1 ]; then bash "$STACK" reset; fi

for f in "$DIR"/0*.sql; do
  if [ -n "$ONLY" ] && [ "$(basename "$f")" != "$ONLY" ]; then continue; fi
  echo "== $(basename "$f")"
  { echo 'begin;'; cat "$DIR/fixtures.sql"; cat "$f"; echo 'rollback;'; } | bash "$STACK" psql
done

if [ -z "$ONLY" ] && [ -f "$DIR/concurrency.sh" ]; then
  echo "== concurrency.sh"
  bash "$DIR/concurrency.sh"
fi
echo "session_series database tests passed"
```

- [ ] **Step 4: Run the matrix against the OLD scheduler (needs Task 6)**

Task 6 Step 4 already confirmed that `db reset` supports `--version`. (If it did not, the fallback is to edit **the stack's scratch copy** — `$TMPDIR/cvfpt-series-test-stack/supabase/migrations/` — never the repository's `supabase/migrations/`.)

```bash
chmod +x supabase/tests/session_series/run.sh
bash supabase/tests/session_series/stack.sh reset --version 20260930100000
bash supabase/tests/session_series/run.sh --no-reset --only 01_conflict_matrix.sql
```
Expected: `conflict matrix passed`. This proves the matrix encodes the current behavior. If a case fails here, fix the **test's expectation** only after reading the original SQL (`20260730220646_…sql:91-189`) — the old scheduler is the source of truth.

- [ ] **Step 5: Write the failing static test for the helper migration**

Append to `backend/test/session-series-migrations.test.js`:

```js
test('helper migration extracts the conflict predicate and keeps the scheduler contract', () => {
  const sql = read('20260930110000_find_session_conflict_helper.sql');
  assert.match(sql, /create or replace function public\.find_session_conflict\(/);
  assert.match(sql, /p_exclude_session_id uuid default null/);
  // schedule_session keeps its exact signature, lock, and now delegates to the helper.
  assert.match(sql, /create or replace function public\.schedule_session\(\s*p_session_id uuid,\s*p_client_id uuid,\s*p_coach_id uuid,\s*p_scheduled_at timestamptz,\s*p_duration_minutes integer,\s*p_location text,\s*p_set_location boolean\s*\)/);
  assert.match(sql, /pg_advisory_xact_lock\(hashtext\('cvf_session_scheduling'\)\)/);
  assert.match(sql, /public\.find_session_conflict\(/);
  assert.match(sql, /revoke execute on function public\.find_session_conflict\(uuid, uuid, timestamptz, integer, uuid\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.find_session_conflict\(uuid, uuid, timestamptz, integer, uuid\) to service_role/);
  assert.doesNotMatch(sql, FORBIDDEN);
});

test('previously applied migrations are not edited by this feature', () => {
  const applied = read('20260730220646_session_conflict_protection.sql');
  assert.match(applied, /create or replace function public\.schedule_session\(/);
  assert.doesNotMatch(applied, /find_session_conflict/); // the original definition is untouched
});
```

Run: `cd backend && node --test test/session-series-migrations.test.js`
Expected: the two new tests FAIL (helper file missing); the earlier test PASSES.

- [ ] **Step 6: Write the helper migration**

Create `supabase/migrations/20260930110000_find_session_conflict_helper.sql`:

```sql
-- Recurring sessions: ONE conflict predicate. The coach/client blocker queries
-- from schedule_session (20260730220646_session_conflict_protection.sql) are
-- extracted verbatim into a read-only function that schedule_session, the new
-- check_session_slots, and schedule_session_series all call, so a preview and the
-- real save cannot disagree.
--
-- schedule_session keeps its signature, advisory lock, return shapes and
-- location-advisory behavior. approve_booking / request_booking are untouched.

create or replace function public.find_session_conflict(
  p_coach_id uuid,
  p_client_id uuid,
  p_scheduled_at timestamptz,
  p_duration_minutes integer,
  p_exclude_session_id uuid default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_range tstzrange;
  v_conflict public.sessions%rowtype;
begin
  if p_scheduled_at is null or p_duration_minutes is null or p_duration_minutes < 1 then
    raise exception 'Valid schedule required';
  end if;
  v_range := public.session_time_range(p_scheduled_at, p_duration_minutes);

  -- Coach hard block. Overlapping a capacity-1 session is a conflict; capacity > 1
  -- group slots are governed by their remaining headcount.
  select s.* into v_conflict
  from public.sessions s
  where s.coach_id = p_coach_id
    and s.status <> 'cancelled' and s.archived = false
    and (p_exclude_session_id is null or s.id <> p_exclude_session_id)
    and public.session_time_range(s.scheduled_at, s.duration_minutes) && v_range
    and (s.capacity = 1 or (
      select count(*) from public.sessions o
      where o.coach_id = p_coach_id and o.status <> 'cancelled' and o.archived = false
        and (p_exclude_session_id is null or o.id <> p_exclude_session_id)
        and public.session_time_range(o.scheduled_at, o.duration_minutes) && v_range
    ) >= s.capacity)
  order by s.scheduled_at
  limit 1;
  if v_conflict.id is not null then
    return jsonb_build_object('scope', 'coach', 'conflict_session', to_jsonb(v_conflict));
  end if;

  -- Client hard block: a client cannot be in two places at once.
  select s.* into v_conflict
  from public.sessions s
  where s.client_id = p_client_id
    and s.status <> 'cancelled' and s.archived = false
    and (p_exclude_session_id is null or s.id <> p_exclude_session_id)
    and public.session_time_range(s.scheduled_at, s.duration_minutes) && v_range
  order by s.scheduled_at
  limit 1;
  if v_conflict.id is not null then
    return jsonb_build_object('scope', 'client', 'conflict_session', to_jsonb(v_conflict));
  end if;

  return null;
end;
$$;

-- Same signature, lock and results as before; the two blocker queries now live in
-- find_session_conflict.
create or replace function public.schedule_session(
  p_session_id uuid,
  p_client_id uuid,
  p_coach_id uuid,
  p_scheduled_at timestamptz,
  p_duration_minutes integer,
  p_location text,
  p_set_location boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_range tstzrange;
  v_found jsonb;
  v_session public.sessions%rowtype;
  v_location_overlaps integer := 0;
begin
  if p_scheduled_at is null or p_duration_minutes is null or p_duration_minutes < 1 then
    raise exception 'Valid schedule required';
  end if;
  v_range := public.session_time_range(p_scheduled_at, p_duration_minutes);

  -- Serialize all scheduling so concurrent requests cannot both pass the
  -- read check (three coaches: contention is negligible).
  perform pg_advisory_xact_lock(hashtext('cvf_session_scheduling'));

  v_found := public.find_session_conflict(p_coach_id, p_client_id, p_scheduled_at, p_duration_minutes, p_session_id);
  if v_found is not null then
    return jsonb_build_object(
      'outcome', (v_found->>'scope') || '_conflict',
      'conflict_session', v_found->'conflict_session'
    );
  end if;

  -- Location advisory (free text; case/space-insensitive; never blocks).
  if p_location is not null and btrim(p_location) <> '' then
    select count(*) into v_location_overlaps
    from public.sessions s
    where s.status <> 'cancelled' and s.archived = false
      and (p_session_id is null or s.id <> p_session_id)
      and s.location is not null
      and lower(btrim(s.location)) = lower(btrim(p_location))
      and public.session_time_range(s.scheduled_at, s.duration_minutes) && v_range;
  end if;

  if p_session_id is null then
    insert into public.sessions (client_id, coach_id, scheduled_at, duration_minutes, location)
    values (p_client_id, p_coach_id, p_scheduled_at, p_duration_minutes, p_location)
    returning * into v_session;
  else
    update public.sessions
    set scheduled_at = p_scheduled_at,
        duration_minutes = p_duration_minutes,
        location = case when p_set_location then p_location else location end,
        updated_at = now()
    where id = p_session_id and archived = false
    returning * into v_session;
    if v_session.id is null then
      raise exception 'Session not found';
    end if;
  end if;

  return jsonb_build_object(
    'outcome', 'scheduled',
    'session', to_jsonb(v_session),
    'location_overlaps', v_location_overlaps
  );
end;
$$;

revoke execute on function public.find_session_conflict(uuid, uuid, timestamptz, integer, uuid) from public, anon, authenticated;
grant execute on function public.find_session_conflict(uuid, uuid, timestamptz, integer, uuid) to service_role;
-- schedule_session keeps the privileges set when it was first created.

select 'find_session_conflict helper ready' as result;
```

- [ ] **Step 7: Run static tests, then the matrix against the NEW scheduler**

```bash
cd backend && node --test test/session-series-migrations.test.js && cd ..
bash supabase/tests/session_series/run.sh --only 01_conflict_matrix.sql
```
Expected: static tests PASS; the runner resets the owned stack (applying the migrations that exist so far) and prints `conflict matrix passed`. **Identical results before and after is the acceptance criterion for the refactor.**

- [ ] **Step 8: Run the existing booking/session suites for regressions**

```bash
cd backend && node --test test/session-conflicts.test.js test/auto-book.test.js test/auto-book-mounted.test.js test/transactional-rpcs.test.js
```
Expected: PASS. (`session-conflicts.test.js` asserts text of the *original* migration, which is unchanged.)

- [ ] **Step 9: Commit (only after Steps 7 and 8 passed; if the database steps were BLOCKED, leave these files uncommitted)**

```bash
git add supabase/migrations/20260930110000_find_session_conflict_helper.sql supabase/tests/session_series/fixtures.sql supabase/tests/session_series/01_conflict_matrix.sql supabase/tests/session_series/run.sh backend/test/session-series-migrations.test.js
git commit -m "feat: extract shared find_session_conflict helper behind schedule_session" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 9: `check_session_slots` (read-only preview/check function)

**Files:**
- Create: `supabase/migrations/20260930120000_check_session_slots.sql`
- Create: `supabase/tests/session_series/02_check_slots.sql`
- Modify: `backend/test/session-series-migrations.test.js` (append)

**Interfaces:**
- Consumes: `find_session_conflict` (Task 8).
- Produces: `public.check_session_slots(p_coach_id uuid, p_client_id uuid, p_duration_minutes integer, p_slots jsonb, p_alternatives jsonb default null) returns jsonb` →
  `{ "slots": [ { "key", "conflict": null | {"scope":"coach"|"client","session":{…}} | {"scope":"batch","with_key":"…"} } ], "alternatives": [ { "key", "for_key", "free": boolean } ] }`. Inputs: `p_slots = [{key, scheduled_at}]`, `p_alternatives = [{key, for_key, scheduled_at}]`.

- [ ] **Step 1: Write the failing SQL test**

Create `supabase/tests/session_series/02_check_slots.sql`:

```sql
\set ON_ERROR_STOP on
create function pg_temp.slot_of(res jsonb, k text) returns jsonb language sql as
$$ select e from jsonb_array_elements(res->'slots') e where e->>'key' = k $$;
create function pg_temp.alt_of(res jsonb, k text) returns jsonb language sql as
$$ select e from jsonb_array_elements(res->'alternatives') e where e->>'key' = k $$;

do $$
declare
  c1 constant uuid := '10000000-0000-4000-8000-0000000000a1';
  c2 constant uuid := '10000000-0000-4000-8000-0000000000a2';
  k1 constant uuid := '20000000-0000-4000-8000-0000000000b1';
  k2 constant uuid := '20000000-0000-4000-8000-0000000000b2';
  k3 constant uuid := '20000000-0000-4000-8000-0000000000b3';
  t constant timestamptz := '2031-03-04 17:00:00+00';
  e uuid; g uuid;
  res jsonb;
begin
  -- An existing coach-c1 / client-k3 booking at t (60 min).
  insert into public.sessions (client_id, coach_id, scheduled_at, duration_minutes)
  values (k3, c1, t, 60) returning id into e;

  -- 1. coach conflict names the existing session; the back-to-back slot is free.
  res := public.check_session_slots(c1, k1, 60, jsonb_build_array(
    jsonb_build_object('key','a','scheduled_at', t),
    jsonb_build_object('key','b','scheduled_at', t + interval '60 minutes')), null);
  if pg_temp.slot_of(res,'a')->'conflict'->>'scope' <> 'coach' or (pg_temp.slot_of(res,'a')->'conflict'->'session'->>'id')::uuid <> e then
    raise exception 'C1 expected coach conflict on e: %', res;
  end if;
  if jsonb_typeof(pg_temp.slot_of(res,'b')->'conflict') <> 'null' then raise exception 'C1b expected free: %', res; end if;

  -- 2. client conflict when the coach is free (coach c2, client k3).
  res := public.check_session_slots(c2, k3, 60, jsonb_build_array(jsonb_build_object('key','a','scheduled_at', t)), null);
  if pg_temp.slot_of(res,'a')->'conflict'->>'scope' <> 'client' then raise exception 'C2 expected client conflict: %', res; end if;

  -- 3. batch conflicts are reciprocal and reference stable keys, never session ids.
  res := public.check_session_slots(c1, k1, 60, jsonb_build_array(
    jsonb_build_object('key','x','scheduled_at', t + interval '2 hours'),
    jsonb_build_object('key','y','scheduled_at', t + interval '150 minutes')), null);
  if pg_temp.slot_of(res,'x')->'conflict' <> '{"scope":"batch","with_key":"y"}'::jsonb
     or pg_temp.slot_of(res,'y')->'conflict' <> '{"scope":"batch","with_key":"x"}'::jsonb then
    raise exception 'C3 expected reciprocal batch conflicts: %', res;
  end if;

  -- 4. an existing-booking conflict takes priority over a batch conflict.
  res := public.check_session_slots(c1, k1, 60, jsonb_build_array(
    jsonb_build_object('key','p','scheduled_at', t),
    jsonb_build_object('key','q','scheduled_at', t + interval '30 minutes')), null);
  if pg_temp.slot_of(res,'p')->'conflict'->>'scope' <> 'coach' then raise exception 'C4 expected coach priority: %', res; end if;

  -- 5. alternatives: independent, checked against existing bookings; they never block each other.
  res := public.check_session_slots(c1, k1, 60,
    jsonb_build_array(jsonb_build_object('key','r1','scheduled_at', t)),
    jsonb_build_array(
      jsonb_build_object('key','a15','for_key','r1','scheduled_at', t + interval '15 minutes'),   -- overlaps e
      jsonb_build_object('key','a60','for_key','r1','scheduled_at', t + interval '60 minutes'),   -- free (the 10:00 case)
      jsonb_build_object('key','a75','for_key','r1','scheduled_at', t + interval '75 minutes'),   -- free, overlaps a60 but alternatives are independent
      jsonb_build_object('key','am60','for_key','r1','scheduled_at', t - interval '60 minutes'))); -- free
  if (pg_temp.alt_of(res,'a15')->>'free')::boolean then raise exception 'C5 a15 should be blocked by e: %', res; end if;
  if not (pg_temp.alt_of(res,'a60')->>'free')::boolean or not (pg_temp.alt_of(res,'a75')->>'free')::boolean
     or not (pg_temp.alt_of(res,'am60')->>'free')::boolean then
    raise exception 'C5 expected a60/a75/am60 free and independent: %', res;
  end if;

  -- 6. selected rows block alternatives, except the row being replaced.
  res := public.check_session_slots(c1, k1, 60,
    jsonb_build_array(
      jsonb_build_object('key','r1','scheduled_at', t),
      jsonb_build_object('key','r2','scheduled_at', t + interval '2 hours')),
    jsonb_build_array(
      jsonb_build_object('key','into_r2','for_key','r1','scheduled_at', t + interval '2 hours'),   -- blocked by r2
      jsonb_build_object('key','own_slot','for_key','r2','scheduled_at', t + interval '2 hours'))); -- r2's own time: excluded row
  if (pg_temp.alt_of(res,'into_r2')->>'free')::boolean then raise exception 'C6 alternative into another selected row must be blocked: %', res; end if;
  if not (pg_temp.alt_of(res,'own_slot')->>'free')::boolean then raise exception 'C6 the replaced row must not block its own alternative: %', res; end if;

  -- 7. capacity > 1: a group slot with room does not block the coach.
  insert into public.sessions (client_id, coach_id, scheduled_at, duration_minutes, capacity)
  values (k2, c1, t + interval '5 hours', 60, 2) returning id into g;
  res := public.check_session_slots(c1, k1, 60, jsonb_build_array(jsonb_build_object('key','g','scheduled_at', t + interval '5 hours')), null);
  if jsonb_typeof(pg_temp.slot_of(res,'g')->'conflict') <> 'null' then raise exception 'C7 capacity-2 slot with room should not conflict: %', res; end if;

  -- 8. the checker is read-only: it created nothing.
  if (select count(*) from public.sessions where coach_id = c1) <> 2 then raise exception 'C8 checker must not write'; end if;

  -- 9. bad input raises.
  begin
    perform public.check_session_slots(c1, k1, 0, '[]'::jsonb, null);
    raise exception 'C9 expected a duration error';
  exception when others then
    if sqlerrm = 'C9 expected a duration error' then raise; end if;
  end;
end;
$$;

select 'check_session_slots tests passed' as result;
```

- [ ] **Step 2: Write the failing static test**

Append to `backend/test/session-series-migrations.test.js`:

```js
test('check_session_slots is read-only, service-role-only, and reuses the shared helper', () => {
  const sql = read('20260930120000_check_session_slots.sql');
  assert.match(sql, /create or replace function public\.check_session_slots\(/);
  assert.match(sql, /\bstable\b/);
  assert.match(sql, /public\.find_session_conflict\(/);
  assert.doesNotMatch(sql, /\binsert into\b|\bupdate public\.|\bdelete from\b/i);
  assert.match(sql, /revoke execute on function public\.check_session_slots\(uuid, uuid, integer, jsonb, jsonb\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.check_session_slots\(uuid, uuid, integer, jsonb, jsonb\) to service_role/);
  assert.doesNotMatch(sql, FORBIDDEN);
});
```
Run: `cd backend && node --test test/session-series-migrations.test.js` → the new test FAILS (file missing).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260930120000_check_session_slots.sql`:

```sql
-- Recurring sessions: read-only checker for preview/check. It evaluates the same
-- predicate as the real save by calling find_session_conflict, and additionally
-- compares the selected rows with each other.
--
--   p_slots:        [{ key, scheduled_at }]            -- the selected rows
--   p_alternatives: [{ key, for_key, scheduled_at }]   -- independent candidates
--
-- Selected rows: checked against existing bookings, then against each other
-- (scope 'batch', referencing the other row's KEY, never a session id).
-- Alternatives: each is checked against existing bookings and against every
-- selected row EXCEPT the row it would replace (for_key). Alternatives are never
-- compared with one another, so nearby candidates cannot block each other.

create or replace function public.check_session_slots(
  p_coach_id uuid,
  p_client_id uuid,
  p_duration_minutes integer,
  p_slots jsonb,
  p_alternatives jsonb default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_slots jsonb := coalesce(p_slots, '[]'::jsonb);
  v_alts jsonb := coalesce(p_alternatives, '[]'::jsonb);
  v_slot_results jsonb := '[]'::jsonb;
  v_alt_results jsonb := '[]'::jsonb;
  r record;
  v_found jsonb;
  v_with text;
begin
  if p_duration_minutes is null or p_duration_minutes < 1 then
    raise exception 'Valid duration required';
  end if;
  if jsonb_typeof(v_slots) <> 'array' or jsonb_typeof(v_alts) <> 'array' then
    raise exception 'Slots and alternatives must be arrays';
  end if;

  for r in
    select e->>'key' as key, (e->>'scheduled_at')::timestamptz as at
    from jsonb_array_elements(v_slots) as e
  loop
    v_found := public.find_session_conflict(p_coach_id, p_client_id, r.at, p_duration_minutes, null);
    v_with := null;
    if v_found is null then
      select o.key into v_with
      from (select e->>'key' as key, (e->>'scheduled_at')::timestamptz as at
            from jsonb_array_elements(v_slots) as e) o
      where o.key <> r.key
        and public.session_time_range(o.at, p_duration_minutes) && public.session_time_range(r.at, p_duration_minutes)
      order by o.at, o.key
      limit 1;
    end if;
    v_slot_results := v_slot_results || jsonb_build_array(jsonb_build_object(
      'key', r.key,
      'conflict', case
        when v_found is not null then jsonb_build_object('scope', v_found->>'scope', 'session', v_found->'conflict_session')
        when v_with is not null then jsonb_build_object('scope', 'batch', 'with_key', v_with)
        else null
      end
    ));
  end loop;

  for r in
    select e->>'key' as key, e->>'for_key' as for_key, (e->>'scheduled_at')::timestamptz as at
    from jsonb_array_elements(v_alts) as e
  loop
    v_found := public.find_session_conflict(p_coach_id, p_client_id, r.at, p_duration_minutes, null);
    v_with := null;
    if v_found is null then
      select o.key into v_with
      from (select e->>'key' as key, (e->>'scheduled_at')::timestamptz as at
            from jsonb_array_elements(v_slots) as e) o
      where o.key is distinct from r.for_key
        and public.session_time_range(o.at, p_duration_minutes) && public.session_time_range(r.at, p_duration_minutes)
      limit 1;
    end if;
    v_alt_results := v_alt_results || jsonb_build_array(jsonb_build_object(
      'key', r.key, 'for_key', r.for_key, 'free', (v_found is null and v_with is null)
    ));
  end loop;

  return jsonb_build_object('slots', v_slot_results, 'alternatives', v_alt_results);
end;
$$;

revoke execute on function public.check_session_slots(uuid, uuid, integer, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.check_session_slots(uuid, uuid, integer, jsonb, jsonb) to service_role;

select 'check_session_slots ready' as result;
```

- [ ] **Step 4: Run static + database tests**

```bash
cd backend && node --test test/session-series-migrations.test.js && cd ..
bash supabase/tests/session_series/run.sh
```
Expected: static PASS; runner prints `conflict matrix passed` and `check_session_slots tests passed`. (The runner resets the DB, so it applies all three migrations.) If C3's JSON equality fails on key ordering, compare with `@>` containment in both directions instead — jsonb equality ignores key order, so a failure means the content differs.

- [ ] **Step 5: Commit (only after Step 4 passed against the owned stack)**

```bash
git add supabase/migrations/20260930120000_check_session_slots.sql supabase/tests/session_series/02_check_slots.sql backend/test/session-series-migrations.test.js
git commit -m "feat: read-only check_session_slots with independent alternatives" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 10: `schedule_session_series` (transactional batch with receipt and replay)

**Files:**
- Create: `supabase/migrations/20260930130000_schedule_session_series.sql`
- Create: `supabase/tests/session_series/03_series_function.sql`
- Modify: `backend/test/session-series-migrations.test.js` (append)

**Interfaces:**
- Consumes: `schedule_session`, `check_session_slots`, `save_program_assignment_with_loads(p_assignment_id uuid, p_program_id uuid, p_client_id uuid, p_notes text, p_loads jsonb)`.
- Produces: `public.schedule_session_series(p_request_id uuid, p_request_hash text, p_coach_id uuid, p_client_id uuid, p_duration_minutes integer, p_location text, p_rule jsonb, p_program_id uuid, p_assign_program boolean, p_slots jsonb) returns jsonb`:
  - `{ "outcome": "created", "replayed": false|true, "series": {…session_series row…}, "receipt": { "slots": [ { "key", "session_id", "scheduled_at", "workout_id", "ordinal" } ] } }`
  - `{ "outcome": "conflicts", "conflicts": [ { "key", "scope", "session"?|"with_key"? } ] }`
  - `{ "outcome": "request_mismatch" }`
  - Input `p_slots = [{ key, scheduled_at (UTC ISO string), workout_id|null }]`.

- [ ] **Step 1: Write the failing SQL test**

Create `supabase/tests/session_series/03_series_function.sql`:

```sql
\set ON_ERROR_STOP on
do $$
declare
  c1 constant uuid := '10000000-0000-4000-8000-0000000000a1';
  k1 constant uuid := '20000000-0000-4000-8000-0000000000b1';
  k2 constant uuid := '20000000-0000-4000-8000-0000000000b2';
  w1 constant uuid := '30000000-0000-4000-8000-0000000000c1';
  w2 constant uuid := '30000000-0000-4000-8000-0000000000c2';
  p1 constant uuid := '40000000-0000-4000-8000-0000000000d1';
  rq1 constant uuid := 'a0000000-0000-4000-8000-000000000001';
  rq2 constant uuid := 'a0000000-0000-4000-8000-000000000002';
  rq3 constant uuid := 'a0000000-0000-4000-8000-000000000003';
  rq4 constant uuid := 'a0000000-0000-4000-8000-000000000004';
  rq5 constant uuid := 'a0000000-0000-4000-8000-000000000005';
  res jsonb; res2 jsonb; receipt0 jsonb; series_id0 uuid;
  slots jsonb;
begin
  -- Slots deliberately OUT of chronological order: ordinals must follow time.
  slots := jsonb_build_array(
    jsonb_build_object('key','late',  'scheduled_at','2031-03-18T17:00:00Z', 'workout_id', w2),
    jsonb_build_object('key','early', 'scheduled_at','2031-03-04T17:00:00Z', 'workout_id', w1),
    jsonb_build_object('key','mid',   'scheduled_at','2031-03-11T17:00:00Z', 'workout_id', null));

  -- S1: create. Sessions, series, receipt, ordinals and workouts all land together.
  res := public.schedule_session_series(rq1, 'hash-1', c1, k1, 60, 'Studio', '{"label":"Weekly"}'::jsonb, null, false, slots);
  if res->>'outcome' <> 'created' or (res->>'replayed')::boolean then raise exception 'S1 expected fresh creation: %', res; end if;
  series_id0 := (res->'series'->>'id')::uuid;
  receipt0 := res->'receipt';
  if (select count(*) from public.sessions where series_id = series_id0) <> 3 then raise exception 'S1 expected 3 linked sessions'; end if;
  if (res->'series'->>'created_count')::int <> 3 then raise exception 'S1 created_count: %', res; end if;
  if (select string_agg(series_ordinal::text, ',' order by scheduled_at) from public.sessions where series_id = series_id0) <> '1,2,3' then
    raise exception 'S1 ordinals must follow chronology';
  end if;
  if (select workout_id from public.sessions where series_id = series_id0 and series_ordinal = 1) <> w1
     or (select workout_id from public.sessions where series_id = series_id0 and series_ordinal = 3) <> w2
     or (select workout_id from public.sessions where series_id = series_id0 and series_ordinal = 2) is not null then
    raise exception 'S1 workouts not applied as sent';
  end if;
  if jsonb_array_length(receipt0->'slots') <> 3 or (receipt0->'slots'->0->>'key') <> 'early' then raise exception 'S1 receipt: %', receipt0; end if;

  -- S2: identical retry replays the stored receipt and creates nothing.
  res2 := public.schedule_session_series(rq1, 'hash-1', c1, k1, 60, 'Studio', '{"label":"Weekly"}'::jsonb, null, false, slots);
  if res2->>'outcome' <> 'created' or not (res2->>'replayed')::boolean or (res2->'series'->>'id')::uuid <> series_id0 then
    raise exception 'S2 expected replay of the same series: %', res2;
  end if;
  if (select count(*) from public.sessions where coach_id = c1) <> 3 then raise exception 'S2 replay must not create sessions'; end if;

  -- S3: same request id, different hash.
  res2 := public.schedule_session_series(rq1, 'hash-OTHER', c1, k1, 60, 'Studio', '{}'::jsonb, null, false, slots);
  if res2->>'outcome' <> 'request_mismatch' then raise exception 'S3 expected request_mismatch: %', res2; end if;

  -- S4: conflicts (existing bookings) create nothing and report every conflict by key.
  res := public.schedule_session_series(rq2, 'hash-2', c1, k2, 60, null, '{}'::jsonb, null, false, jsonb_build_array(
    jsonb_build_object('key','hit1','scheduled_at','2031-03-04T17:30:00Z'),   -- overlaps 'early' (coach)
    jsonb_build_object('key','ok',  'scheduled_at','2031-03-05T17:00:00Z'),
    jsonb_build_object('key','hit2','scheduled_at','2031-03-18T17:00:00Z'))); -- exactly 'late' (coach)
  if res->>'outcome' <> 'conflicts' or jsonb_array_length(res->'conflicts') <> 2 then raise exception 'S4 expected two conflicts: %', res; end if;
  if (select count(*) from public.sessions where coach_id = c1) <> 3 or exists (select 1 from public.session_series where request_id = rq2) then
    raise exception 'S4 conflicts must write nothing';
  end if;
  if not (res->'conflicts' @> '[{"key":"hit1","scope":"coach"}]'::jsonb) or not (res->'conflicts' @> '[{"key":"hit2","scope":"coach"}]'::jsonb) then
    raise exception 'S4 conflict keys/scopes: %', res;
  end if;

  -- S5: slots that overlap EACH OTHER conflict by key with scope batch; no provisional ids, nothing written.
  res := public.schedule_session_series(rq3, 'hash-3', c1, k2, 60, null, '{}'::jsonb, null, false, jsonb_build_array(
    jsonb_build_object('key','m','scheduled_at','2031-04-01T17:00:00Z'),
    jsonb_build_object('key','n','scheduled_at','2031-04-01T17:30:00Z')));
  if res->>'outcome' <> 'conflicts' or not (res->'conflicts' @> '[{"key":"m","scope":"batch","with_key":"n"}]'::jsonb) then
    raise exception 'S5 expected batch conflicts: %', res;
  end if;
  if (select count(*) from public.sessions where coach_id = c1) <> 3 then raise exception 'S5 must write nothing'; end if;

  -- S6: an unexpected failure (unknown workout -> FK violation) rolls back EVERYTHING.
  begin
    perform public.schedule_session_series(rq4, 'hash-4', c1, k2, 60, null, '{}'::jsonb, null, false, jsonb_build_array(
      jsonb_build_object('key','z1','scheduled_at','2031-05-01T17:00:00Z','workout_id','99999999-9999-4999-8999-999999999999')));
    raise exception 'S6 expected a foreign key failure';
  exception when foreign_key_violation then
    null;
  end;
  if (select count(*) from public.sessions where coach_id = c1) <> 3 or exists (select 1 from public.session_series where request_id = rq4) then
    raise exception 'S6 failure must leave no sessions or series row';
  end if;

  -- S7: program assignment is created once and never duplicated.
  res := public.schedule_session_series(rq5, 'hash-5', c1, k2, 60, null, '{}'::jsonb, p1, true, jsonb_build_array(
    jsonb_build_object('key','p1','scheduled_at','2031-06-03T17:00:00Z')));
  if res->>'outcome' <> 'created' then raise exception 'S7 expected created: %', res; end if;
  if (select count(*) from public.program_assignments where program_id = p1 and client_id = k2 and archived = false) <> 1 then
    raise exception 'S7 expected one assignment';
  end if;
  res := public.schedule_session_series('a0000000-0000-4000-8000-000000000006', 'hash-6', c1, k2, 60, null, '{}'::jsonb, p1, true, jsonb_build_array(
    jsonb_build_object('key','p2','scheduled_at','2031-06-10T17:00:00Z')));
  if (select count(*) from public.program_assignments where program_id = p1 and client_id = k2 and archived = false) <> 1 then
    raise exception 'S7 a second series must not duplicate the assignment';
  end if;

  -- S8: the receipt is immutable even after sessions are rescheduled and cancelled.
  update public.sessions set scheduled_at = scheduled_at + interval '1 day' where series_id = series_id0 and series_ordinal = 1;
  update public.sessions set status = 'cancelled' where series_id = series_id0 and series_ordinal = 3;
  res2 := public.schedule_session_series(rq1, 'hash-1', c1, k1, 60, 'Studio', '{"label":"Weekly"}'::jsonb, null, false, slots);
  if (res2->>'replayed')::boolean is not true or res2->'receipt' <> receipt0 then raise exception 'S8 receipt must be unchanged: %', res2; end if;
  if (select receipt from public.session_series where id = series_id0) <> receipt0 then raise exception 'S8 stored receipt changed'; end if;

  -- S9: input validation.
  begin perform public.schedule_session_series(rq1, 'h', c1, k1, 60, null, '{}'::jsonb, null, false, '[]'::jsonb); raise exception 'S9 empty';
  exception when others then if sqlerrm = 'S9 empty' then raise; end if; end;
end;
$$;

select 'schedule_session_series tests passed' as result;
```

- [ ] **Step 2: Write the failing static test**

Append to `backend/test/session-series-migrations.test.js`:

```js
test('schedule_session_series locks before the idempotency lookup and links in a safe order', () => {
  const sql = read('20260930130000_schedule_session_series.sql');
  assert.match(sql, /create or replace function public\.schedule_session_series\(/);
  const lock = sql.indexOf("pg_advisory_xact_lock(hashtext('cvf_session_scheduling'))");
  const lookup = sql.indexOf('from public.session_series where coach_id = p_coach_id and request_id = p_request_id');
  const insertSeries = sql.indexOf('insert into public.session_series');
  const linkSessions = sql.indexOf('update public.sessions s');
  assert.ok(lock > -1 && lookup > lock, 'advisory lock must be taken BEFORE the request lookup');
  assert.ok(insertSeries > lookup, 'series row is inserted after the lookup');
  assert.ok(linkSessions > insertSeries, 'sessions are linked AFTER the series row exists (foreign key)');
  assert.match(sql, /public\.check_session_slots\(/);
  assert.match(sql, /public\.schedule_session\(null,/);
  assert.match(sql, /save_program_assignment_with_loads\(null,/);
  assert.match(sql, /revoke execute on function public\.schedule_session_series\(uuid, text, uuid, uuid, integer, text, jsonb, uuid, boolean, jsonb\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.schedule_session_series\(uuid, text, uuid, uuid, integer, text, jsonb, uuid, boolean, jsonb\) to service_role/);
  assert.doesNotMatch(sql, FORBIDDEN);
});
```
Run → FAIL (file missing).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260930130000_schedule_session_series.sql`:

```sql
-- Recurring sessions: the transactional batch save.
--
-- Order matters:
--   1. take the global scheduling advisory lock (transaction-scoped);
--   2. THEN look up (coach_id, request_id) — so two simultaneous identical
--      requests serialize: the first creates, the second finds the committed
--      series and replays;
--   3. evaluate every slot WITHOUT writing (existing bookings + each other);
--      any conflict returns all of them by key and writes nothing;
--   4. otherwise create sessions (via schedule_session), build the immutable
--      receipt, insert the series row, THEN link the sessions (series_id has a
--      foreign key), then optionally assign the program. One transaction: any
--      unexpected error rolls everything back.

create or replace function public.schedule_session_series(
  p_request_id uuid,
  p_request_hash text,
  p_coach_id uuid,
  p_client_id uuid,
  p_duration_minutes integer,
  p_location text,
  p_rule jsonb,
  p_program_id uuid,
  p_assign_program boolean,
  p_slots jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_series public.session_series%rowtype;
  v_check jsonb;
  v_conflicts jsonb;
  v_result jsonb;
  v_receipt jsonb := '[]'::jsonb;
  v_slot record;
  v_ordinal integer := 0;
  v_count integer;
begin
  if p_slots is null or jsonb_typeof(p_slots) <> 'array' then
    raise exception 'Valid slots required';
  end if;
  v_count := jsonb_array_length(p_slots);
  if v_count < 1 or v_count > 52 then
    raise exception 'A series has between 1 and 52 sessions';
  end if;
  if p_duration_minutes is null or p_duration_minutes < 1 then
    raise exception 'Valid duration required';
  end if;
  if p_request_id is null or p_request_hash is null then
    raise exception 'Request identity required';
  end if;

  -- 1. Lock first.
  perform pg_advisory_xact_lock(hashtext('cvf_session_scheduling'));

  -- 2. Authoritative idempotency lookup, under the lock.
  select * into v_series from public.session_series where coach_id = p_coach_id and request_id = p_request_id;
  if v_series.id is not null then
    if v_series.request_hash <> p_request_hash then
      return jsonb_build_object('outcome', 'request_mismatch');
    end if;
    return jsonb_build_object('outcome', 'created', 'replayed', true, 'series', to_jsonb(v_series), 'receipt', v_series.receipt);
  end if;

  -- 3. Evaluate without writing; report every conflict at once, by stable key.
  v_check := public.check_session_slots(p_coach_id, p_client_id, p_duration_minutes, p_slots, null);
  select coalesce(jsonb_agg(jsonb_build_object('key', e->>'key') || (e->'conflict') order by ord), '[]'::jsonb)
    into v_conflicts
  from jsonb_array_elements(v_check->'slots') with ordinality as t(e, ord)
  where jsonb_typeof(e->'conflict') = 'object';
  if jsonb_array_length(v_conflicts) > 0 then
    return jsonb_build_object('outcome', 'conflicts', 'conflicts', v_conflicts);
  end if;

  -- 4a. Create sessions chronologically. Step 3 found no conflicts and the lock is
  -- held, so any other outcome is unexpected: raise and roll everything back.
  for v_slot in
    select e as slot, (e->>'scheduled_at')::timestamptz as at, e->>'key' as key
    from jsonb_array_elements(p_slots) as e
    order by (e->>'scheduled_at')::timestamptz, e->>'key'
  loop
    v_ordinal := v_ordinal + 1;
    v_result := public.schedule_session(null, p_client_id, p_coach_id, v_slot.at, p_duration_minutes, p_location, true);
    if v_result->>'outcome' <> 'scheduled' then
      raise exception 'Unexpected scheduling outcome % for slot %', v_result->>'outcome', v_slot.key;
    end if;
    v_receipt := v_receipt || jsonb_build_array(jsonb_build_object(
      'key', v_slot.key,
      'session_id', v_result->'session'->>'id',
      'scheduled_at', v_slot.slot->>'scheduled_at',
      'workout_id', v_slot.slot->'workout_id',
      'ordinal', v_ordinal
    ));
  end loop;

  -- 4b/c. Immutable receipt + series row (must exist before sessions point at it).
  insert into public.session_series
    (coach_id, client_id, program_id, rule, created_count, request_id, request_hash, receipt)
  values
    (p_coach_id, p_client_id, p_program_id, coalesce(p_rule, '{}'::jsonb), v_count,
     p_request_id, p_request_hash, jsonb_build_object('slots', v_receipt))
  returning * into v_series;

  -- 4d. Link the sessions and apply the workout mapping exactly as sent.
  update public.sessions s
  set series_id = v_series.id,
      series_ordinal = r.ordinal,
      workout_id = r.workout_id,
      updated_at = now()
  from jsonb_to_recordset(v_receipt) as r(session_id uuid, ordinal integer, workout_id uuid)
  where s.id = r.session_id;

  -- 4e. Optional program assignment (skipped when the client already has it).
  if p_assign_program and p_program_id is not null then
    if not exists (
      select 1 from public.program_assignments
      where program_id = p_program_id and client_id = p_client_id and archived = false
    ) then
      perform public.save_program_assignment_with_loads(null, p_program_id, p_client_id, null, '[]'::jsonb);
    end if;
  end if;

  return jsonb_build_object('outcome', 'created', 'replayed', false, 'series', to_jsonb(v_series), 'receipt', v_series.receipt);
end;
$$;

revoke execute on function public.schedule_session_series(uuid, text, uuid, uuid, integer, text, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.schedule_session_series(uuid, text, uuid, uuid, integer, text, jsonb, uuid, boolean, jsonb) to service_role;

select 'schedule_session_series ready' as result;
```

- [ ] **Step 4: Run static + database tests**

```bash
cd backend && node --test test/session-series-migrations.test.js && cd ..
bash supabase/tests/session_series/run.sh
```
Expected: static PASS; runner prints all three SQL results (`conflict matrix passed`, `check_session_slots tests passed`, `schedule_session_series tests passed`). If S7 fails inside `save_program_assignment_with_loads`, read its body at `supabase/migrations/20260717043317_workout_tracking_notifications.sql:391` and satisfy any precondition in `fixtures.sql` (do not alter the function).

- [ ] **Step 5: Commit (only after Step 4 passed against the owned stack)**

```bash
git add supabase/migrations/20260930130000_schedule_session_series.sql supabase/tests/session_series/03_series_function.sql backend/test/session-series-migrations.test.js
git commit -m "feat: transactional schedule_session_series with receipt and replay" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 11: Grants test and committed-transaction concurrency tests

**Files:**
- Create: `supabase/tests/session_series/04_grants.sql`
- Create: `supabase/tests/session_series/concurrency.sh`

**Why separate from Task 10:** rollback-only tests cannot prove which of two competing transactions commits (if the first rolls back, a waiting second may simply succeed). These tests use real concurrent psql sessions and committed transactions in the disposable local database.

- [ ] **Step 1: Write the grants test**

Create `supabase/tests/session_series/04_grants.sql`:

```sql
\set ON_ERROR_STOP on
do $$
declare
  fn text;
  who text;
begin
  foreach fn in array array[
    'public.find_session_conflict(uuid,uuid,timestamptz,integer,uuid)',
    'public.check_session_slots(uuid,uuid,integer,jsonb,jsonb)',
    'public.schedule_session_series(uuid,text,uuid,uuid,integer,text,jsonb,uuid,boolean,jsonb)'
  ] loop
    foreach who in array array['anon', 'authenticated'] loop
      if has_function_privilege(who, fn, 'execute') then raise exception '% must not execute %', who, fn; end if;
    end loop;
    if not has_function_privilege('service_role', fn, 'execute') then raise exception 'service_role must execute %', fn; end if;
  end loop;

  if not (select relrowsecurity from pg_class where oid = 'public.session_series'::regclass) then
    raise exception 'RLS must be enabled on session_series';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'session_series') then
    raise exception 'session_series must have no RLS policies (service-role-only)';
  end if;
  foreach who in array array['anon', 'authenticated'] loop
    if has_table_privilege(who, 'public.session_series', 'select') then raise exception '% must not read session_series', who; end if;
  end loop;
  if not has_table_privilege('service_role', 'public.session_series', 'insert') then
    raise exception 'service_role must write session_series';
  end if;
end;
$$;

select 'grants and RLS tests passed' as result;
```

- [ ] **Step 2: Write the concurrency script**

Create `supabase/tests/session_series/concurrency.sh`:

```bash
#!/usr/bin/env bash
# Committed-transaction race tests. OWNED DISPOSABLE STACK ONLY (via stack.sh).
# A "holder" call keeps its transaction (and the scheduling advisory lock) open for
# a few seconds via pg_sleep while a second call starts; the second call must
# queue behind the lock and then observe the COMMITTED result of the first.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
# One owned target: every statement goes through stack.sh, which refuses any container that is
# not the disposable cvfpt-series-test stack. There is no environment override.
psql_db() { bash "$DIR/stack.sh" psql -At "$@"; }

C1='10000000-0000-4000-8000-0000000000e1'
K1='20000000-0000-4000-8000-0000000000e2'
K2='20000000-0000-4000-8000-0000000000e3'

cleanup_db() {
  # Test data in the owned disposable stack only (stack.sh refuses any other container).
  psql_db <<SQL || true
delete from public.sessions where coach_id = '$C1';
delete from public.session_series where coach_id = '$C1';
delete from public.clients where coach_id = '$C1';
delete from public.coaches where id = '$C1';
SQL
}
TMP="$(mktemp -d)"
cleanup() { cleanup_db; rm -rf "$TMP"; }
trap cleanup EXIT
cleanup_db   # start from a clean slate in case a previous run was interrupted

psql_db <<SQL
insert into public.coaches (id, name, email) values ('$C1', 'Race Coach', 'race-coach@example.invalid');
insert into public.clients (id, coach_id, name, email) values
  ('$K1', '$C1', 'Race Client One', 'race-client-1@example.invalid'),
  ('$K2', '$C1', 'Race Client Two', 'race-client-2@example.invalid');
SQL

SLOTS='[{"key":"s1","scheduled_at":"2031-06-03T17:00:00Z","workout_id":null},{"key":"s2","scheduled_at":"2031-06-10T17:00:00Z","workout_id":null}]'

# series <request_id> <hash> <client> <hold_seconds> <outfile>
series() {
  psql_db -c "select r, pg_sleep($4) from (select public.schedule_session_series('$1','$2','$C1','$3',60,'Studio','{}'::jsonb,null,false,'$SLOTS'::jsonb) as r offset 0) s;" > "$5"
}
count_sessions() { psql_db -c "select count(*) from public.sessions where coach_id = '$C1';"; }
count_series() { psql_db -c "select count(*) from public.session_series where coach_id = '$C1';"; }
assert_contains() { grep -qF "$2" "$1" || { echo "FAIL: expected '$2' in $1:"; cat "$1"; exit 1; }; }

echo "-- race 1: two simultaneous identical requests -> one creation, one replay"
RQ='b0000000-0000-4000-8000-000000000001'
series "$RQ" hash-race-1 "$K1" 3 "$TMP/a1" &
HOLD=$!
sleep 1
START=$(date +%s)
series "$RQ" hash-race-1 "$K1" 0 "$TMP/b1"
ELAPSED=$(( $(date +%s) - START ))
wait "$HOLD"
assert_contains "$TMP/a1" '"replayed": false'
assert_contains "$TMP/b1" '"replayed": true'
[ "$ELAPSED" -ge 1 ] || { echo "FAIL: the second call returned in ${ELAPSED}s; it should have waited on the lock"; exit 1; }
[ "$(count_sessions)" = "2" ] || { echo "FAIL: expected exactly 2 sessions, got $(count_sessions)"; exit 1; }
[ "$(count_series)" = "1" ] || { echo "FAIL: expected exactly 1 series, got $(count_series)"; exit 1; }

echo "-- race 2: different request ids competing for the same slots -> one winner, one conflict"
RQ_A='b0000000-0000-4000-8000-000000000002'
RQ_B='b0000000-0000-4000-8000-000000000003'
SLOTS='[{"key":"t1","scheduled_at":"2031-07-01T17:00:00Z","workout_id":null}]'
series "$RQ_A" hash-race-2a "$K1" 3 "$TMP/a2" &
HOLD=$!
sleep 1
series "$RQ_B" hash-race-2b "$K2" 0 "$TMP/b2"
wait "$HOLD"
assert_contains "$TMP/a2" '"outcome": "created"'
assert_contains "$TMP/b2" '"outcome": "conflicts"'
assert_contains "$TMP/b2" '"scope": "coach"'
[ "$(count_sessions)" = "3" ] || { echo "FAIL: expected 3 sessions total, got $(count_sessions)"; exit 1; }
[ "$(count_series)" = "2" ] || { echo "FAIL: expected 2 series total, got $(count_series)"; exit 1; }

echo "concurrency tests passed"
```

- [ ] **Step 3: Run the whole database suite on the owned stack**

```bash
chmod +x supabase/tests/session_series/concurrency.sh
bash supabase/tests/session_series/run.sh
```
Expected: exit status 0; the four rolled-back files report their results, then `concurrency tests passed`, then `session_series database tests passed`. Re-run once with `--no-reset` to confirm the tests are repeatable, then confirm they leave no data behind:

```bash
bash supabase/tests/session_series/run.sh --no-reset
bash supabase/tests/session_series/stack.sh psql -At -c "select count(*) from public.sessions where coach_id = '10000000-0000-4000-8000-0000000000e1';"
```
Expected: the second run passes and the count is `0`.

- [ ] **Step 4: Prove the run does not touch any other stack — and that the proof cannot pass vacuously**

Create `supabase/tests/session_series/isolation_check.sh` and `chmod +x` it:

```bash
#!/usr/bin/env bash
# Proves a complete database-test run leaves every OTHER local Supabase container and volume
# untouched, and that the owned test stack is really gone afterwards.
#
# Every Docker query must SUCCEED: an engine that cannot be queried makes this check FAIL
# (isolation unverified); it never passes on an inventory that is empty only because a query
# failed. The run is NOT started with --down: teardown is an explicit step whose failure fails
# the check. (It cannot read another stack's data and does not try to: an unchanged container
# id and creation time and an unchanged volume list are the evidence that nothing was reset.)
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ID="cvfpt-series-test"
LABEL="com.supabase.cli.project"
TIMEOUT=""
if command -v timeout >/dev/null 2>&1; then TIMEOUT="timeout 30"; fi

dk() { $TIMEOUT docker "$@"; }
fail() { echo "FAIL: $*" >&2; exit 1; }

dk info >/dev/null 2>&1 || fail "the Docker engine is not responding; isolation cannot be verified"

# Supabase-labelled containers and volumes OTHER than the owned stack. Enumerate first (a
# failure aborts), then filter; an empty result therefore means "queried, and there are none".
inventory() {
  local owned_c owned_v all_c all_v
  owned_c="$(dk ps -a --filter "label=${LABEL}=${PROJECT_ID}" -q)" || return 1
  owned_v="$(dk volume ls --filter "label=${LABEL}=${PROJECT_ID}" -q)" || return 1
  all_c="$(dk ps -a --filter "label=${LABEL}" --format 'container|{{.ID}}|{{.Names}}|{{.CreatedAt}}|{{.State}}')" || return 1
  all_v="$(dk volume ls --filter "label=${LABEL}" --format 'volume|{{.Name}}')" || return 1
  printf '%s\n' "$all_c" "$all_v" | awk -F'|' -v oc="$owned_c" -v ov="$owned_v" '
    BEGIN {
      n = split(oc, a, "\n"); for (i = 1; i <= n; i++) if (a[i] != "") owned[a[i]] = 1
      n = split(ov, b, "\n"); for (i = 1; i <= n; i++) if (b[i] != "") owned[b[i]] = 1
    }
    NF && !($2 in owned)' | sort
}

teardown_if_failed() {
  local status=$?
  if [ "$status" -ne 0 ]; then bash "$DIR/stack.sh" down >/dev/null 2>&1 || true; fi
}
trap teardown_if_failed EXIT

before="$(inventory)" || fail "could not inventory the other Supabase resources before the run"
bash "$DIR/run.sh"
bash "$DIR/stack.sh" down
after="$(inventory)" || fail "could not inventory the other Supabase resources after the run"

count() { printf '%s\n' "$1" | awk 'NF' | wc -l | tr -d ' '; }
echo "other Supabase resources before: $(count "$before")  after: $(count "$after")"
if [ "$before" != "$after" ]; then
  diff <(printf '%s\n' "$before") <(printf '%s\n' "$after") >&2 || true
  fail "other Supabase containers/volumes changed during the run"
fi

left_c="$(dk ps -a --filter "label=${LABEL}=${PROJECT_ID}" -q)" || fail "could not confirm the owned containers are gone"
left_v="$(dk volume ls --filter "label=${LABEL}=${PROJECT_ID}" -q)" || fail "could not confirm the owned volumes are gone"
if [ -n "$left_c" ] || [ -n "$left_v" ]; then
  fail "the owned stack was not fully removed (containers: ${left_c:-none}; volumes: ${left_v:-none})"
fi
echo "isolation check passed"
```

Create `supabase/tests/session_series/isolation_guard_test.sh` and `chmod +x` it (it reuses `fake_bins.sh` from Task 6 and copies the real `isolation_check.sh` next to stub `run.sh`/`stack.sh` siblings, so it needs no Docker):

```bash
#!/usr/bin/env bash
# Regression tests for isolation_check.sh. Fake `docker` plus stub run.sh/stack.sh siblings (copied next to
# a private copy of the real isolation_check.sh) let every failure mode be injected without Docker.
# The check must PASS only when every Docker query succeeded, nothing else changed, teardown succeeded
# and the owned stack is confirmed gone; every inspection/teardown failure must make it FAIL.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=fake_bins.sh
. "$HERE/fake_bins.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
ORIG_PATH="$PATH"
PASS=0
fail() { echo "FAIL [$CASE]: $*" >&2; [ -f "${OUT:-/dev/null}" ] && sed 's/^/    | /' "$OUT" >&2; exit 1; }

sandbox() {
  CASE="$1"
  SB="$(mktemp -d "$WORK/sb.XXXXXX")"
  export FAKE_DIR="$SB/fake"
  mkdir -p "$FAKE_DIR" "$SB/bin" "$SB/suite"
  write_fake_bins "$SB/bin"
  : > "$FAKE_DIR/docker.log"; : > "$FAKE_DIR/steps.log"
  cp "$HERE/isolation_check.sh" "$SB/suite/isolation_check.sh"
  cat > "$SB/suite/run.sh" <<'RUN'
#!/usr/bin/env bash
echo "run" >> "$FAKE_DIR/steps.log"
if [ -f "$FAKE_DIR/run_fail" ]; then exit 1; fi
if [ -f "$FAKE_DIR/run_mutates_other" ]; then printf 'container|devid1|supabase_db_CVFPT-main|2026-09-02|running\n' > "$FAKE_DIR/containers_all"; fi
echo cid1 > "$FAKE_DIR/owned_containers"; echo vol1 > "$FAKE_DIR/owned_volumes"
exit 0
RUN
  cat > "$SB/suite/stack.sh" <<'STACK'
#!/usr/bin/env bash
echo "stack $*" >> "$FAKE_DIR/steps.log"
[ "${1:-}" = "down" ] || exit 0
if [ -f "$FAKE_DIR/down_fail" ]; then exit 1; fi
if [ ! -f "$FAKE_DIR/down_leaves_container" ]; then : > "$FAKE_DIR/owned_containers"; fi
if [ ! -f "$FAKE_DIR/down_leaves_volume" ]; then : > "$FAKE_DIR/owned_volumes"; fi
if [ -f "$FAKE_DIR/down_removes_other" ]; then : > "$FAKE_DIR/containers_all"; fi
exit 0
STACK
  chmod +x "$SB/suite/"*.sh
  export PATH="$SB/bin:$ORIG_PATH"
  OUT="$SB/out.log"
}
check() { set +e; bash "$SB/suite/isolation_check.sh" > "$OUT" 2>&1; CODE=$?; set -e; }
expect_pass() { [ "$CODE" -eq 0 ] || fail "expected the check to pass, exit $CODE"; grep -q "isolation check passed" "$OUT" || fail "missing the success line"; }
expect_fail() { [ "$CODE" -ne 0 ] || fail "expected the check to FAIL but it exited 0"; ! grep -q "isolation check passed" "$OUT" || fail "must not print the success line"; }
ok() { PASS=$((PASS + 1)); echo "  ok  $CASE"; }
other_container() { printf 'container|devid1|supabase_db_CVFPT-main|2026-09-01|running\n' > "$FAKE_DIR/containers_all"; echo "dev_vol" > "$FAKE_DIR/volumes_all"; }

sandbox "a legitimately EMPTY other-resource inventory passes"
check; expect_pass; grep -q "before: 0  after: 0" "$OUT" || fail "should report zero resources"; ok

sandbox "another stack present and unchanged passes (and is counted)"
other_container; check; expect_pass; grep -q "before: 2  after: 2" "$OUT" || fail "should report the two other resources"; ok

sandbox "another stack's container changes during the run -> FAIL"
other_container; touch "$FAKE_DIR/run_mutates_other"; check; expect_fail; ok

sandbox "another stack's container disappears during teardown -> FAIL"
other_container; touch "$FAKE_DIR/down_removes_other"; check; expect_fail; ok

sandbox "container enumeration fails -> FAIL, never a passing empty inventory"
touch "$FAKE_DIR/ps_fail"; check; expect_fail; ok

sandbox "volume enumeration fails -> FAIL"
touch "$FAKE_DIR/volume_fail"; check; expect_fail; ok

sandbox "Docker engine not responding -> FAIL (isolation unverified)"
touch "$FAKE_DIR/docker_down"; check; expect_fail; grep -qi "not responding" "$OUT" || fail "should say Docker is not responding"; ok

sandbox "teardown (stack.sh down) fails -> FAIL"
touch "$FAKE_DIR/down_fail"; check; expect_fail; ok

sandbox "the test run itself fails -> FAIL, and a best-effort teardown is still attempted"
touch "$FAKE_DIR/run_fail"; check; expect_fail
grep -q "stack down" "$FAKE_DIR/steps.log" || fail "teardown should still be attempted after a failed run"; ok

sandbox "an owned container is left behind after teardown -> FAIL"
touch "$FAKE_DIR/down_leaves_container"; check; expect_fail; grep -q "not fully removed" "$OUT" || fail "should say the owned stack remains"; ok

sandbox "an owned volume is left behind after teardown -> FAIL"
touch "$FAKE_DIR/down_leaves_volume"; check; expect_fail; ok

echo "isolation guard tests passed ($PASS cases)"
```

Run the Docker-free guard test first: `bash supabase/tests/session_series/isolation_guard_test.sh`
Expected: exit status 0 and `isolation guard tests passed (11 cases)` — covering a legitimately empty inventory (passes), enumeration failures, an unresponsive engine, a failing teardown, a failing run, and leftover owned containers or volumes (each must FAIL).

Then run the real check: `bash supabase/tests/session_series/isolation_check.sh`
Expected: exit status 0 and `isolation check passed`. If a normal `CVFPT-main` development stack is running on this machine it appears in both inventories unchanged; if none is, both counts are `0`, which is a legitimate pass because every Docker query succeeded. If Docker cannot be queried the check **fails** (isolation unverified) — it must never pass on an empty inventory produced by a failed query.

- [ ] **Step 5: Commit the database tests (only after Steps 3 and 4 passed)**

```bash
git add supabase/tests/session_series/04_grants.sql supabase/tests/session_series/concurrency.sh supabase/tests/session_series/isolation_check.sh supabase/tests/session_series/isolation_guard_test.sh
git commit -m "test: grants, committed-transaction concurrency and isolation checks for series scheduling" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Run the database suite in CI (separate commit)**

In `.github/workflows/ci.yml`, add a job after `frontend`:

```yaml
  database:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
        with:
          version: 2.118.0
      - name: Stack and isolation safety tests (fake Docker, no engine needed)
        run: |
          bash supabase/tests/session_series/stack_guard_test.sh
          bash supabase/tests/session_series/isolation_guard_test.sh
      - name: Recurring-sessions database tests (owned disposable stack)
        run: bash supabase/tests/session_series/run.sh --down
```
`--down` removes the stack even when a test fails. GitHub's `ubuntu-latest` runners provide Docker. Validate the YAML locally (`ruby -ryaml -e 'YAML.load_file(".github/workflows/ci.yml")'` or any YAML parser) and commit:

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run the recurring-sessions database tests on a disposable Supabase stack" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
The job itself is exercised the first time the branch is pushed; until then it is unverified, and the final report must say so. Note that `.github/workflows/migration-guard.yml` will also require the `migration-applied` label on this PR (see Task 26).

> **Checkpoint (phase boundary — review here):** Phase 3 is complete only when `run.sh` and `isolation_check.sh` both exit 0 on a healthy Docker engine. **Review the scheduler refactor (`find_session_conflict` / `schedule_session`) and `schedule_session_series` at this boundary.** If Docker was BLOCKED (Task 6), Phase 3 is **not** complete: its files are uncommitted and the handoff must say the database layer is unverified.

---

## Phase 4 — Backend routes and notifications

The migrations are not required to run the route tests (they stub the RPCs), but the routes depend on them at runtime. **Backend code that calls the new RPCs or selects `session_series` must not be deployed before the migrations are applied** — see the release handoff.

### Task 12: `notify` flag on single-session cancel

**Files:**
- Modify: `backend/src/validation/business.js`
- Modify: `backend/src/routes/sessions.js` (`PATCH /:id/cancel`)
- Create: `backend/test/session-cancel-notify.test.js`

**Interfaces:**
- Produces: `validateNotifyFlag(body): { ok: true, value: boolean } | { ok: false, error }` — missing/`undefined` body or missing `notify` key → `true` (today's behavior preserved); non-boolean → error. Later tasks (series cancel) import it.

- [ ] **Step 1: Write the failing test**

Create `backend/test/session-cancel-notify.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const COACH_ID = 'aaaaaaaa-0000-0000-0000-00000000000a';
const CLIENT_ID = 'cccccccc-0000-0000-0000-00000000000c';
const SESSION_ID = 'eeeeeeee-0000-0000-0000-00000000000e';
const FUTURE = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

const state = {};
function resetState() {
  state.sessionRow = { id: SESSION_ID, client_id: CLIENT_ID, coach_id: COACH_ID, scheduled_at: FUTURE, duration_minutes: 60, status: 'scheduled', archived: false };
  state.updates = [];
  state.emails = 0;
  state.pushes = 0;
}

const supabasePath = require.resolve('../src/supabase');
require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true,
  exports: {
    supabaseAdmin: {
      from() {
        const chain = {
          _update: null,
          select() { return chain; },
          eq() { return chain; },
          update(values) { chain._update = values; state.updates.push(values); return chain; },
          maybeSingle() { return Promise.resolve({ data: state.sessionRow, error: null }); },
          single() { return Promise.resolve({ data: { ...state.sessionRow, ...(chain._update || {}), client: { id: CLIENT_ID, name: 'Client' } }, error: null }); },
        };
        return chain;
      },
      rpc() { return Promise.resolve({ data: null, error: null }); },
    },
  },
};
const authPath = require.resolve('../src/middleware/auth');
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: {
    requireAuth: (req, _res, next) => { req.user = { role: 'coach', coach: { id: COACH_ID, name: 'Coach' } }; next(); },
    requireCoach: (_req, _res, next) => next(),
    requireClient: (_req, res) => res.status(403).json({ error: 'no' }),
    canAccessClient: () => true,
  },
};
const emailPath = require.resolve('../src/services/email');
require.cache[emailPath] = {
  id: emailPath, filename: emailPath, loaded: true,
  exports: {
    dispatchEmail: (task) => Promise.resolve().then(task),
    notifySessionCancelled: () => { state.emails += 1; return Promise.resolve({}); },
    notifySessionScheduled: () => Promise.resolve({}),
    notifySessionRescheduled: () => Promise.resolve({}),
    notifySessionCancelledByClient: () => Promise.resolve({}),
    notifySessionCancelRequested: () => Promise.resolve({}),
    formatDenver: () => 'formatted',
  },
};
const pushPath = require.resolve('../src/services/push');
require.cache[pushPath] = {
  id: pushPath, filename: pushPath, loaded: true,
  exports: {
    dispatchPush: () => { state.pushes += 1; return {}; },
    sendToClient: () => Promise.resolve({}),
    sendToCoaches: () => Promise.resolve({}),
  },
};

const express = require('express');
const { validateNotifyFlag } = require('../src/validation/business');
const app = express();
app.use(express.json());
app.use('/api/sessions', require('../src/routes/sessions'));
const server = http.createServer(app);
let baseUrl;
test.before(async () => { await new Promise((r) => { server.listen(0, '127.0.0.1', r); }); baseUrl = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { server.close(); });

async function cancel(body) {
  const response = await fetch(`${baseUrl}/api/sessions/${SESSION_ID}/cancel`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test('cancel without a body still notifies (default preserved)', async () => {
  resetState();
  const result = await cancel(undefined);
  assert.equal(result.status, 200);
  assert.equal(state.emails, 1);
  assert.equal(state.pushes, 1);
});

test('cancel with notify true notifies; notify false is silent but still cancels', async () => {
  resetState();
  assert.equal((await cancel({ notify: true })).status, 200);
  assert.equal(state.emails, 1);
  resetState();
  const quiet = await cancel({ notify: false });
  assert.equal(quiet.status, 200);
  assert.equal(quiet.body.status, 'cancelled');
  assert.equal(state.emails, 0);
  assert.equal(state.pushes, 0);
  assert.ok(state.updates.some((update) => update.status === 'cancelled'));
});

test('a non-boolean notify is rejected before anything changes', async () => {
  resetState();
  const result = await cancel({ notify: 'no' });
  assert.equal(result.status, 400);
  assert.equal(state.updates.length, 0);
  assert.equal(state.emails, 0);
});

test('validateNotifyFlag defaults to true and accepts only booleans', () => {
  assert.deepEqual(validateNotifyFlag(undefined), { ok: true, value: true });
  assert.deepEqual(validateNotifyFlag({}), { ok: true, value: true });
  assert.deepEqual(validateNotifyFlag({ notify: false }), { ok: true, value: false });
  assert.equal(validateNotifyFlag({ notify: 1 }).ok, false);
  assert.equal(validateNotifyFlag({ notify: null }).ok, false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && node --test test/session-cancel-notify.test.js`
Expected: FAIL — `validateNotifyFlag is not a function` (module destructure is undefined) / cancel-with-`notify:false` still emails.

- [ ] **Step 3: Implement the validator**

In `backend/src/validation/business.js`, add before `module.exports`:

```js
// Optional { notify } on cancel-style actions. Missing means notify (the
// historical behavior); anything but a boolean is an error.
function validateNotifyFlag(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.hasOwn(body, 'notify')) return valid(true);
  if (typeof body.notify !== 'boolean') return invalid('Notify must be true or false');
  return valid(body.notify);
}
```
and add `validateNotifyFlag,` to the `module.exports` object (alphabetical, after `validateBookingListQuery`… keep the existing ordering style).

- [ ] **Step 4: Honor the flag in the cancel route**

In `backend/src/routes/sessions.js`, add `validateNotifyFlag` to the destructured `require('../validation/business')` import. In `router.patch('/:id/cancel', …)`, make these edits:

1. First statement inside `try`, **before** `loadSessionForCoach`:
```js
    const notifyFlag = validateNotifyFlag(req.body);
    if (!notifyFlag.ok) return res.status(400).json({ error: notifyFlag.error });
```
2. Replace the notification lines
```js
    await dispatchEmail(() => notifySessionCancelled(data));
    dispatchPush(() => sendToClient(data.client_id, {
      title: 'Session cancelled',
      body: `${formatDenver(data.scheduled_at)} is off the calendar.`,
      url: '/client/sessions',
    }));
```
with:
```js
    if (notifyFlag.value) {
      await dispatchEmail(() => notifySessionCancelled(data));
      dispatchPush(() => sendToClient(data.client_id, {
        title: 'Session cancelled',
        body: `${formatDenver(data.scheduled_at)} is off the calendar.`,
        url: '/client/sessions',
      }));
    }
```

- [ ] **Step 5: Run to verify it passes, plus neighbors**

```bash
cd backend && node --test test/session-cancel-notify.test.js test/cancel-signals.test.js test/coach-session-surface.test.js test/business-validation.test.js
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/validation/business.js backend/src/routes/sessions.js backend/test/session-cancel-notify.test.js
git commit -m "feat: optional notify flag on single-session cancel (default unchanged)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 13: Series notification emails

**Files:**
- Modify: `backend/src/services/email.js`
- Create: `backend/test/session-series-notifications.test.js`

**Interfaces:**
- Produces (exported from `services/email.js`):
  - `notifySeriesScheduled({ seriesId, clientId, coachId, dates: string[] (ISO UTC, chronological) }, env?) → Promise` — one email; subject `Your coach scheduled N session(s)`; lists the first five Denver-formatted dates then `…and K more`; intro says times vary when saved times differ; idempotency key `series-scheduled/<seriesId>/<clientId>`.
  - `notifySeriesCancelled({ seriesId, clientId, coachId, cancelled: Array<{ id, scheduled_at }> }, env?) → Promise` — one email; idempotency key `series-cancelled/<seriesId>/<firstCancelledId>/<clientId>` (two separate cancellations in one series stay distinct events).
  - Returns `{ skipped: '…' }` when inputs/recipient are missing (matches the existing notifiers).

- [ ] **Step 1: Write the failing test**

Create `backend/test/session-series-notifications.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const sent = [];
const people = {
  clients: { id: 'client-1', name: 'Casey Client', email: 'casey@example.invalid' },
  coaches: { id: 'coach-1', name: 'Sam Coach', email: 'sam@example.invalid' },
};

const supabasePath = require.resolve('../src/supabase');
require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true,
  exports: {
    supabaseAdmin: {
      from(table) {
        const chain = { select() { return chain; }, eq() { return chain; }, maybeSingle() { return Promise.resolve({ data: people[table] || null, error: null }); } };
        return chain;
      },
    },
  },
};
const resendPath = require.resolve('resend');
require.cache[resendPath] = {
  id: resendPath, filename: resendPath, loaded: true,
  exports: {
    Resend: class {
      constructor() {
        this.emails = { send: async (message, options) => { sent.push({ message, options }); return { data: { id: 'email-1' }, error: null }; } };
      }
    },
  },
};

const { notifySeriesScheduled, notifySeriesCancelled } = require('../src/services/email');
const ENV = { RESEND_API_KEY: 'key', NOTIFY_REPLY_TO: 'reply@example.invalid', FRONTEND_URL: 'https://app.example.invalid' };
// Weekly at 23:00Z from 2031-06-03: all in daylight time, so the Denver wall-clock
// time is a constant 5:00 PM (no DST boundary inside the series).
const weekly = (count) => Array.from({ length: count }, (_, i) => new Date(Date.UTC(2031, 5, 3 + i * 7, 23, 0)).toISOString());

test('scheduled summary lists the first five dates and the remainder, one email total', async () => {
  sent.length = 0;
  await notifySeriesScheduled({ seriesId: 's-1', clientId: 'client-1', coachId: 'coach-1', dates: weekly(7) }, ENV);
  assert.equal(sent.length, 1);
  const { message, options } = sent[0];
  assert.deepEqual(message.to, ['casey@example.invalid']);
  assert.equal(message.subject, 'Your coach scheduled 7 sessions');
  assert.match(message.text, /…and 2 more/);
  assert.match(message.text, /These sessions are on your calendar\./);
  assert.doesNotMatch(message.text, /Times vary/);
  assert.equal(message.text.match(/(Jun|Jul) \d+/g).length, 5); // Jun 3, 10, 17, 24, Jul 1
  assert.equal(options.idempotencyKey, 'series-scheduled/s-1/client-1');
  assert.match(message.text, /https:\/\/app\.example\.invalid\/client\/sessions/);
});

test('scheduled summary says times vary when saved times differ', async () => {
  sent.length = 0;
  const dates = [new Date(Date.UTC(2031, 5, 3, 23, 0)).toISOString(), new Date(Date.UTC(2031, 5, 10, 22, 0)).toISOString()];
  await notifySeriesScheduled({ seriesId: 's-2', clientId: 'client-1', coachId: 'coach-1', dates }, ENV);
  assert.match(sent[0].message.text, /Times vary/);
  assert.equal(sent[0].message.subject, 'Your coach scheduled 2 sessions');
});

test('a single saved session uses the singular', async () => {
  sent.length = 0;
  await notifySeriesScheduled({ seriesId: 's-3', clientId: 'client-1', coachId: 'coach-1', dates: weekly(1) }, ENV);
  assert.equal(sent[0].message.subject, 'Your coach scheduled 1 session');
});

test('cancel summary is one email keyed by series and first cancelled session', async () => {
  sent.length = 0;
  const cancelled = weekly(3).map((scheduled_at, i) => ({ id: `sess-${i + 1}`, scheduled_at }));
  await notifySeriesCancelled({ seriesId: 's-1', clientId: 'client-1', coachId: 'coach-1', cancelled }, ENV);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].message.subject, 'Your 3 sessions were cancelled');
  assert.equal(sent[0].options.idempotencyKey, 'series-cancelled/s-1/sess-1/client-1');
});

test('missing inputs or recipient are skipped, not thrown', async () => {
  sent.length = 0;
  assert.deepEqual(await notifySeriesScheduled({ seriesId: null, clientId: 'client-1', coachId: 'coach-1', dates: weekly(1) }, ENV), { skipped: 'missing-series' });
  assert.deepEqual(await notifySeriesScheduled({ seriesId: 's', clientId: 'client-1', coachId: 'coach-1', dates: [] }, ENV), { skipped: 'missing-series' });
  assert.deepEqual(await notifySeriesCancelled({ seriesId: 's', clientId: 'client-1', coachId: 'coach-1', cancelled: [] }, ENV), { skipped: 'missing-series' });
  people.clients = { id: 'client-1', name: 'No Email', email: null };
  assert.deepEqual(await notifySeriesScheduled({ seriesId: 's', clientId: 'client-1', coachId: 'coach-1', dates: weekly(1) }, ENV), { skipped: 'missing-recipient' });
  assert.equal(sent.length, 0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && node --test test/session-series-notifications.test.js`
Expected: FAIL — `notifySeriesScheduled is not a function`.

- [ ] **Step 3: Implement**

In `backend/src/services/email.js`:

1. Change the time-utils import line to `const { dateInTz, denverTimeOfDay } = require('../utils/time');`.
2. Add after `notifySessionScheduled` (before `notifySessionRescheduled`):

```js
const pluralize = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

// One summary for a whole recurring series, built from the sessions actually
// saved (not from the original repeat rule — individual dates may have been
// adjusted). Best-effort like every other notification.
async function notifySeriesScheduled({ seriesId, clientId, coachId, dates }, env = process.env) {
  if (!seriesId || !Array.isArray(dates) || !dates.length) return { skipped: 'missing-series' };
  const { client, coach } = await loadPeople(clientId, coachId);
  if (!client?.email || !coach) return { skipped: 'missing-recipient' };
  const shown = dates.slice(0, 5).map(formatDenver);
  if (dates.length > 5) shown.push(`…and ${dates.length - 5} more`);
  const timesVary = new Set(dates.map((date) => denverTimeOfDay(date))).size > 1;
  const headline = `Your coach scheduled ${pluralize(dates.length, 'session')}`;
  const rendered = renderEmail({
    headline,
    intro: timesVary ? 'Times vary — see your schedule for each session.' : 'These sessions are on your calendar.',
    facts: [...shown, coach.name ? `With ${String(coach.name).split(' ')[0]}` : null].filter(Boolean),
    actionLabel: 'View sessions',
    actionUrl: `${env.FRONTEND_URL || ''}/client/sessions`,
  });
  return sendEmail({ to: [client.email], subject: headline, ...rendered }, `series-scheduled/${seriesId}/${client.id}`, env);
}

// `cancelled` is [{ id, scheduled_at }] — the sessions this operation actually
// changed. Keyed by the first cancelled session so separate cancellations within
// one series are distinct events.
async function notifySeriesCancelled({ seriesId, clientId, coachId, cancelled }, env = process.env) {
  if (!seriesId || !Array.isArray(cancelled) || !cancelled.length) return { skipped: 'missing-series' };
  const { client, coach } = await loadPeople(clientId, coachId);
  if (!client?.email || !coach) return { skipped: 'missing-recipient' };
  const shown = cancelled.slice(0, 5).map((session) => formatDenver(session.scheduled_at));
  if (cancelled.length > 5) shown.push(`…and ${cancelled.length - 5} more`);
  const headline = `Your ${pluralize(cancelled.length, 'session')} ${cancelled.length === 1 ? 'was' : 'were'} cancelled`;
  const rendered = renderEmail({
    headline,
    intro: 'These sessions are no longer on the calendar. Message your coach if you need other times.',
    facts: [...shown, coach.name ? `With ${String(coach.name).split(' ')[0]}` : null].filter(Boolean),
    actionLabel: 'View sessions',
    actionUrl: `${env.FRONTEND_URL || ''}/client/sessions`,
  });
  return sendEmail({ to: [client.email], subject: headline, ...rendered }, `series-cancelled/${seriesId}/${cancelled[0].id}/${client.id}`, env);
}
```
3. Add `notifySeriesCancelled, notifySeriesScheduled,` to `module.exports`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && node --test test/session-series-notifications.test.js`
Expected: PASS. If the date-count regex is off because the intro or footer happens to contain a month name, tighten the regex to the facts block; do not change the five-date rule.

- [ ] **Step 5: Run the existing email suites**

```bash
cd backend && node --test test/session-notifications.test.js test/digest-session-reminders.test.js test/push.test.js
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/email.js backend/test/session-series-notifications.test.js
git commit -m "feat: one-email series scheduled and cancelled notifications" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 14: Series routes — preview and check

**Files:**
- Create: `backend/src/routes/sessionSeries.js`
- Modify: `backend/src/routes/sessions.js` (mount the router)
- Modify: `backend/src/lib/sessionSeries/rule.js` (export `isRealDate`, `isTime`)
- Create: `backend/test/session-series-routes.test.js`

**Interfaces:**
- Consumes: `parseRule`, `expandSeriesRule`, `validateSlotShapes`, `slotHorizonError`, `horizonBounds`, `isRealDate` (rule.js); `candidateTimes`, `chunk`, `MAX_ALTERNATIVES_PER_CALL`, `MAX_SUGGESTIONS_PER_ROW`; `denverWallClockToUtc`, `formatDenverDisplay`, `todayDateInTz`; RPC `check_session_slots`.
- Produces:
  - `POST /api/sessions/series/preview` — body `{ client_id, start_date, time, duration_minutes, weekdays, interval_weeks, end, location? }` → `200 { slots: Row[] }`.
  - `POST /api/sessions/series/check` — body `{ client_id, duration_minutes, start_date, slots: [{ key, date, time }], seq? }` → `200 { seq, slots: Row[] }`.
  - `Row = { key, date, time, scheduled_at, display, conflict: null | { scope: 'coach'|'client', session, display } | { scope: 'batch', with_key }, suggestions: Array<{ date, time, scheduled_at, display }> }`.
  - Internal exports for later tasks: `router`, and (as properties on the router module) nothing else; `create` and `cancel` are added to the same router in Tasks 15–16.

- [ ] **Step 1: Export the two shape helpers**

In `backend/src/lib/sessionSeries/rule.js`, add `isRealDate, isTime,` to `module.exports`.

- [ ] **Step 2: Write the failing route tests (preview + check)**

Create `backend/test/session-series-routes.test.js` with the harness and the first group of tests (Tasks 15–16 append more):

```js
// Mounted-route tests for /api/sessions/series. Supabase, auth, email and push are stubbed
// through the per-process require cache; the database functions are stubbed at the rpc() seam.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const COACH_ID = 'aaaaaaaa-0000-0000-0000-00000000000a';
const OTHER_COACH_ID = 'bbbbbbbb-0000-0000-0000-00000000000b';
const CLIENT_ID = 'cccccccc-0000-0000-0000-00000000000c';
const PROGRAM_ID = '77777777-0000-0000-0000-000000000007';
const WORKOUT_ID = '99999999-0000-0000-0000-000000000009';
const SERIES_ID = 'dddddddd-0000-0000-0000-00000000000d';
const REQUEST_ID = 'a0000000-0000-4000-8000-000000000001';

const { shiftDate, todayDateInTz } = require('../src/utils/time');
const { requestHash } = require('../src/lib/sessionSeries/rule');
const TODAY = todayDateInTz();
const day = (offset) => shiftDate(TODAY, offset);

const state = {};
function resetState() {
  Object.assign(state, {
    clientRow: { id: CLIENT_ID, coach_id: COACH_ID, archived: false },
    programRow: { id: PROGRAM_ID, coach_id: COACH_ID, archived: false },
    workouts: [{ id: WORKOUT_ID, coach_id: COACH_ID }],
    existingSeries: null,
    anchorSession: null,
    cancelledRows: [],
    rpcCalls: [],
    rpcImpl: {},
    sessionUpdates: [],
    emails: [],
    cancelEmails: [],
    pushes: 0,
  });
}

function defaultCheck(args) {
  return {
    slots: args.p_slots.map((slot) => ({ key: slot.key, conflict: null })),
    alternatives: (args.p_alternatives || []).map((alt) => ({ key: alt.key, for_key: alt.for_key, free: true })),
  };
}
function defaultCreate(args) {
  const slots = [...args.p_slots].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  return {
    outcome: 'created', replayed: false,
    series: { id: SERIES_ID, coach_id: args.p_coach_id, client_id: args.p_client_id, request_id: args.p_request_id, created_count: slots.length },
    receipt: { slots: slots.map((slot, i) => ({ key: slot.key, session_id: `sess-${i + 1}`, scheduled_at: slot.scheduled_at, workout_id: slot.workout_id ?? null, ordinal: i + 1 })) },
  };
}

const matches = (row, eqs) => Boolean(row) && Object.entries(eqs).every(([key, value]) => !(key in row) || row[key] === value);

const supabasePath = require.resolve('../src/supabase');
require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true,
  exports: {
    supabaseAdmin: {
      from(table) {
        const chain = {
          _eqs: {}, _update: null,
          select() { return chain; },
          eq(column, value) { chain._eqs[column] = value; return chain; },
          in() { return chain; },
          gte() { return chain; },
          order() { return chain; },
          update(values) { chain._update = values; state.sessionUpdates.push(values); return chain; },
          maybeSingle() {
            const rows = { clients: state.clientRow, programs: state.programRow, session_series: state.existingSeries, sessions: state.anchorSession };
            const row = rows[table] ?? null;
            return Promise.resolve({ data: matches(row, chain._eqs) ? row : null, error: null });
          },
          then(resolve) {
            if (table === 'workouts') return resolve({ data: state.workouts, error: null });
            if (table === 'sessions' && chain._update) return resolve({ data: state.cancelledRows, error: null });
            return resolve({ data: [], error: null });
          },
        };
        return chain;
      },
      rpc(name, args) {
        state.rpcCalls.push({ name, args });
        const impl = state.rpcImpl[name] || (name === 'check_session_slots' ? defaultCheck : name === 'schedule_session_series' ? defaultCreate : () => null);
        return Promise.resolve({ data: impl(args), error: null });
      },
    },
  },
};

let currentUser;
const authPath = require.resolve('../src/middleware/auth');
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: {
    requireAuth: (req, _res, next) => { req.user = currentUser; next(); },
    requireCoach: (req, res, next) => (['coach', 'admin'].includes(req.user?.role) ? next() : res.status(403).json({ error: 'Coach access required' })),
    requireClient: (req, res, next) => (req.user?.role === 'client' ? next() : res.status(403).json({ error: 'Client access required' })),
    canAccessClient: (user, client) => user.role === 'admin' || client.coach_id === user.coach?.id,
  },
};
const emailPath = require.resolve('../src/services/email');
require.cache[emailPath] = {
  id: emailPath, filename: emailPath, loaded: true,
  exports: {
    dispatchEmail: (task) => Promise.resolve().then(task),
    notifySeriesScheduled: (args) => { state.emails.push(args); return Promise.resolve({}); },
    notifySeriesCancelled: (args) => { state.cancelEmails.push(args); return Promise.resolve({}); },
    notifySessionScheduled: () => Promise.resolve({}),
    notifySessionRescheduled: () => Promise.resolve({}),
    notifySessionCancelled: () => Promise.resolve({}),
    notifySessionCancelledByClient: () => Promise.resolve({}),
    notifySessionCancelRequested: () => Promise.resolve({}),
    formatDenver: () => 'formatted',
  },
};
const pushPath = require.resolve('../src/services/push');
require.cache[pushPath] = {
  id: pushPath, filename: pushPath, loaded: true,
  exports: { dispatchPush: () => { state.pushes += 1; return {}; }, sendToClient: () => Promise.resolve({}), sendToCoaches: () => Promise.resolve({}) },
};

const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/sessions', require('../src/routes/sessions'));
const server = http.createServer(app);
let baseUrl;
test.before(async () => { await new Promise((r) => { server.listen(0, '127.0.0.1', r); }); baseUrl = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { server.close(); });

async function call(pathname, { method = 'POST', body } = {}) {
  const response = await fetch(`${baseUrl}/api/sessions/series${pathname}`, {
    method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
const coachUser = { role: 'coach', coach: { id: COACH_ID, name: 'Coach Sam' } };
const checkCalls = () => state.rpcCalls.filter((c) => c.name === 'check_session_slots');
const rows = (count, { time = '17:00', startOffset = 14 } = {}) => Array.from({ length: count }, (_, i) => ({ key: `r${i + 1}`, date: day(startOffset + i), time }));

// ---------- preview ----------
const previewBody = (overrides = {}) => ({
  client_id: CLIENT_ID, start_date: day(14), time: '17:00', duration_minutes: 60,
  weekdays: [0, 1, 2, 3, 4, 5, 6], interval_weeks: 1, end: { count: 4 }, ...overrides,
});

test('preview expands the rule, checks it in one call, and returns display strings', async () => {
  resetState(); currentUser = coachUser;
  const result = await call('/preview', { body: previewBody() });
  assert.equal(result.status, 200);
  assert.equal(result.body.slots.length, 4);
  assert.deepEqual(result.body.slots.map((s) => s.key), ['g1', 'g2', 'g3', 'g4']);
  assert.ok(result.body.slots.every((s) => s.conflict === null && s.suggestions.length === 0 && typeof s.display === 'string'));
  assert.equal(checkCalls().length, 1);
  assert.equal(checkCalls()[0].args.p_alternatives, null);
});

test('preview hides clients the coach cannot access', async () => {
  resetState(); currentUser = coachUser;
  state.clientRow = { id: CLIENT_ID, coach_id: OTHER_COACH_ID, archived: false };
  assert.equal((await call('/preview', { body: previewBody() })).status, 404);
  assert.equal(state.rpcCalls.length, 0);
});

test('preview rejects past starts, too many sessions, and schedules past the horizon without calling the database', async () => {
  resetState(); currentUser = coachUser;
  assert.equal((await call('/preview', { body: previewBody({ start_date: day(-1) }) })).status, 400);
  const tooMany = await call('/preview', { body: previewBody({ end: { until: day(14 + 60) } }) });
  assert.equal(tooMany.status, 400);
  assert.match(tooMany.body.error, /52/);
  const pastHorizon = await call('/preview', { body: previewBody({ weekdays: [(new Date(`${day(14)}T00:00:00Z`)).getUTCDay()], interval_weeks: 2, end: { count: 30 } }) });
  assert.equal(pastHorizon.status, 400);
  assert.match(pastHorizon.body.error, /year/i);
  assert.equal(state.rpcCalls.length, 0);
});

// ---------- check ----------
test('check sends the WHOLE selection to the database and echoes seq', async () => {
  resetState(); currentUser = coachUser;
  const result = await call('/check', { body: { client_id: CLIENT_ID, duration_minutes: 60, start_date: day(14), slots: rows(6), seq: 7 } });
  assert.equal(result.status, 200);
  assert.equal(result.body.seq, 7);
  assert.equal(result.body.slots.length, 6);
  assert.equal(checkCalls()[0].args.p_slots.length, 6);
  assert.ok(checkCalls()[0].args.p_slots.every((s) => /Z$/.test(s.scheduled_at)));
});

test('check enforces the horizon from start_date and rejects bad shapes before any database call', async () => {
  resetState(); currentUser = coachUser;
  const body = (slots, extra = {}) => ({ client_id: CLIENT_ID, duration_minutes: 60, start_date: day(14), slots, ...extra });
  assert.equal((await call('/check', { body: body([{ key: 'a', date: day(14 + 366), time: '17:00' }]) })).status, 400);
  assert.equal((await call('/check', { body: body([{ key: 'a', date: day(14 + 365), time: '17:00' }]) })).status, 200);
  state.rpcCalls.length = 0;
  assert.equal((await call('/check', { body: body([{ key: 'a', date: day(-1), time: '17:00' }]) })).status, 400);
  assert.equal((await call('/check', { body: body([{ key: 'a', date: day(14), time: '17:00' }, { key: 'a', date: day(15), time: '17:00' }]) })).status, 400);
  assert.equal((await call('/check', { body: body([], {}) })).status, 400);
  assert.equal((await call('/check', { body: body(rows(1), { start_date: 'nope' }) })).status, 400);
  assert.equal((await call('/check', { body: body(rows(1), { duration_minutes: 5 }) })).status, 400);
  assert.equal(state.rpcCalls.length, 0);
});

test('check returns nearest-first suggestions (max 3) for a conflicting row, using independent alternatives', async () => {
  resetState(); currentUser = coachUser;
  state.rpcImpl.check_session_slots = (args) => {
    if (!args.p_alternatives) {
      return { slots: args.p_slots.map((s) => ({ key: s.key, conflict: s.key === 'r1' ? { scope: 'coach', session: { id: 'e', scheduled_at: s.scheduled_at } } : null })), alternatives: [] };
    }
    return { slots: [], alternatives: args.p_alternatives.map((alt) => ({ key: alt.key, for_key: alt.for_key, free: true })) };
  };
  const result = await call('/check', { body: { client_id: CLIENT_ID, duration_minutes: 60, start_date: day(14), slots: rows(2, { time: '12:00' }), seq: 1 } });
  const [r1, r2] = result.body.slots;
  assert.equal(r1.conflict.scope, 'coach');
  assert.ok(typeof r1.conflict.display === 'string');
  assert.deepEqual(r1.suggestions.map((s) => s.time), ['12:15', '11:45', '12:30']);
  assert.equal(r2.conflict, null);
  assert.deepEqual(r2.suggestions, []);
  const altCall = checkCalls().find((c) => c.args.p_alternatives);
  assert.ok(altCall.args.p_alternatives.every((alt) => alt.for_key === 'r1'));
  assert.equal(altCall.args.p_slots.length, 2); // every selected row is a blocker
});

test('a maximum-size selection (52 conflicting rows) chunks alternatives into calls of at most 600 with all rows as blockers', async () => {
  resetState(); currentUser = coachUser;
  state.rpcImpl.check_session_slots = (args) => {
    if (!args.p_alternatives) {
      return { slots: args.p_slots.map((s) => ({ key: s.key, conflict: { scope: 'coach', session: { id: 'e', scheduled_at: s.scheduled_at } } })), alternatives: [] };
    }
    return { slots: [], alternatives: args.p_alternatives.map((alt) => ({ key: alt.key, for_key: alt.for_key, free: true })) };
  };
  const result = await call('/check', { body: { client_id: CLIENT_ID, duration_minutes: 60, start_date: day(14), slots: rows(52, { time: '12:00' }) } });
  assert.equal(result.status, 200);
  const altCalls = checkCalls().filter((c) => c.args.p_alternatives);
  assert.deepEqual(altCalls.map((c) => c.args.p_alternatives.length), [600, 600, 48]);
  assert.ok(altCalls.every((c) => c.args.p_slots.length === 52));
  assert.ok(result.body.slots.every((s) => s.suggestions.length === 3));
});

test('suggestions never include times in the past', async () => {
  resetState(); currentUser = coachUser;
  const seen = [];
  state.rpcImpl.check_session_slots = (args) => {
    if (!args.p_alternatives) return { slots: args.p_slots.map((s) => ({ key: s.key, conflict: { scope: 'client', session: { id: 'e', scheduled_at: s.scheduled_at } } })), alternatives: [] };
    seen.push(...args.p_alternatives);
    return { slots: [], alternatives: args.p_alternatives.map((alt) => ({ key: alt.key, for_key: alt.for_key, free: true })) };
  };
  // A slot later today: candidates earlier than "now" must be dropped.
  await call('/check', { body: { client_id: CLIENT_ID, duration_minutes: 60, start_date: TODAY, slots: [{ key: 'today', date: TODAY, time: '20:45' }] } });
  assert.ok(seen.every((alt) => new Date(alt.scheduled_at).getTime() > Date.now()));
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd backend && node --test test/session-series-routes.test.js`
Expected: FAIL — the preview and check requests return 404 because the series router is not mounted yet.

- [ ] **Step 4: Implement the router (preview + check)**

Create `backend/src/routes/sessionSeries.js`:

```js
const express = require('express');
const { supabaseAdmin } = require('../supabase');
const { logError } = require('../utils/logger');
const { requireCoach, canAccessClient } = require('../middleware/auth');
const { validateUuid } = require('../validation/business');
const {
  parseRule, expandSeriesRule, horizonBounds, validateSlotShapes, slotHorizonError, isRealDate,
} = require('../lib/sessionSeries/rule');
const {
  candidateTimes, chunk, MAX_ALTERNATIVES_PER_CALL, MAX_SUGGESTIONS_PER_ROW,
} = require('../lib/sessionSeries/alternatives');
const { denverWallClockToUtc, formatDenverDisplay, todayDateInTz } = require('../utils/time');

const router = express.Router();

// ---- shared helpers ----

async function resolveClient(req, res, rawClientId) {
  const id = validateUuid(rawClientId, 'Client ID');
  if (!id.ok) { res.status(400).json({ error: id.error }); return null; }
  const { data: clientRow } = await supabaseAdmin.from('clients').select('*')
    .eq('id', id.value).eq('archived', false).maybeSingle();
  if (!clientRow || !canAccessClient(req.user, clientRow)) {
    res.status(404).json({ error: 'Client not found' });
    return null;
  }
  return { clientRow, coachId: req.user.role === 'admin' ? clientRow.coach_id : req.user.coach.id };
}

function durationError(value) {
  return Number.isInteger(value) && value >= 15 && value <= 240 ? null : 'Duration must be a whole number between 15 and 240 minutes';
}

function withUtc(slots) {
  return slots.map((slot) => ({ ...slot, scheduled_at: denverWallClockToUtc(slot.date, slot.time) }));
}

function pastError(slots, now) {
  return slots.some((slot) => !slot.scheduled_at || new Date(slot.scheduled_at).getTime() <= now)
    ? 'Sessions cannot be in the past' : null;
}

async function rpcCheck({ coachId, clientId, durationMinutes, slots, alternatives }) {
  const { data, error } = await supabaseAdmin.rpc('check_session_slots', {
    p_coach_id: coachId,
    p_client_id: clientId,
    p_duration_minutes: durationMinutes,
    p_slots: slots.map(({ key, scheduled_at }) => ({ key, scheduled_at })),
    p_alternatives: alternatives,
  });
  if (error) throw error;
  return data;
}

// Checks the whole selection, then — only for conflicting rows — evaluates up to 24
// same-day candidates each as INDEPENDENT alternatives (never compared with one
// another), in chunks of at most MAX_ALTERNATIVES_PER_CALL with every selected row
// passed as a blocker in every call.
async function checkRows({ coachId, clientId, durationMinutes, slots, startDate, today, now }) {
  const base = await rpcCheck({ coachId, clientId, durationMinutes, slots, alternatives: null });
  const byKey = new Map((base.slots || []).map((row) => [row.key, row]));
  const bounds = horizonBounds(startDate, today);

  const candidates = [];
  for (const slot of slots) {
    if (!byKey.get(slot.key)?.conflict) continue;
    for (const candidate of candidateTimes(slot)) {
      const scheduledAt = denverWallClockToUtc(candidate.date, candidate.time);
      if (!scheduledAt || candidate.date < bounds.min || candidate.date > bounds.max) continue;
      if (new Date(scheduledAt).getTime() <= now) continue;
      candidates.push({ key: `${slot.key}@${candidate.time}`, for_key: slot.key, date: candidate.date, time: candidate.time, scheduled_at: scheduledAt });
    }
  }

  const free = new Set();
  for (const part of chunk(candidates, MAX_ALTERNATIVES_PER_CALL)) {
    const result = await rpcCheck({
      coachId, clientId, durationMinutes, slots,
      alternatives: part.map(({ key, for_key, scheduled_at }) => ({ key, for_key, scheduled_at })),
    });
    for (const alt of result.alternatives || []) if (alt.free) free.add(alt.key);
  }

  const suggestions = new Map();
  for (const candidate of candidates) {
    if (!free.has(candidate.key)) continue;
    const list = suggestions.get(candidate.for_key) || [];
    if (list.length >= MAX_SUGGESTIONS_PER_ROW) continue;
    list.push({ date: candidate.date, time: candidate.time, scheduled_at: candidate.scheduled_at, display: formatDenverDisplay(candidate.scheduled_at) });
    suggestions.set(candidate.for_key, list);
  }

  return slots.map((slot) => {
    const row = byKey.get(slot.key);
    const conflict = row?.conflict
      ? { ...row.conflict, display: row.conflict.session?.scheduled_at ? formatDenverDisplay(row.conflict.session.scheduled_at) : null }
      : null;
    return {
      key: slot.key, date: slot.date, time: slot.time, scheduled_at: slot.scheduled_at,
      display: formatDenverDisplay(slot.scheduled_at), conflict, suggestions: suggestions.get(slot.key) || [],
    };
  });
}

// ---- POST /api/sessions/series/preview ----
router.post('/preview', requireCoach, async (req, res) => {
  try {
    const body = req.body || {};
    const resolved = await resolveClient(req, res, body.client_id);
    if (!resolved) return;
    const today = todayDateInTz();
    const parsed = parseRule(body, { today });
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    const expanded = expandSeriesRule(parsed.value);
    if (expanded.exceededMax) return res.status(400).json({ error: 'A series can have at most 52 sessions' });
    if (expanded.exceededHorizon) {
      return res.status(400).json({ error: 'That schedule runs past one year from the start date — reduce the count or choose an end date' });
    }
    const slots = withUtc(expanded.slots);
    const now = Date.now();
    const past = pastError(slots, now);
    if (past) return res.status(400).json({ error: past });
    const rowsOut = await checkRows({
      coachId: resolved.coachId, clientId: resolved.clientRow.id, durationMinutes: parsed.value.duration_minutes,
      slots, startDate: parsed.value.start_date, today, now,
    });
    return res.json({ slots: rowsOut });
  } catch (e) {
    logError('series preview error', e);
    return res.status(500).json({ error: 'Failed to preview the series' });
  }
});

// ---- POST /api/sessions/series/check ----
router.post('/check', requireCoach, async (req, res) => {
  try {
    const body = req.body || {};
    const resolved = await resolveClient(req, res, body.client_id);
    if (!resolved) return;
    const durationMessage = durationError(body.duration_minutes);
    if (durationMessage) return res.status(400).json({ error: durationMessage });
    if (!isRealDate(body.start_date)) return res.status(400).json({ error: 'Start date must be a valid date' });
    const shapes = validateSlotShapes(body.slots);
    if (!shapes.ok) return res.status(400).json({ error: shapes.error });
    const today = todayDateInTz();
    const horizon = slotHorizonError(shapes.value, body.start_date, today);
    if (horizon) return res.status(400).json({ error: horizon });
    const slots = withUtc(shapes.value);
    const now = Date.now();
    const past = pastError(slots, now);
    if (past) return res.status(400).json({ error: past });
    const rowsOut = await checkRows({
      coachId: resolved.coachId, clientId: resolved.clientRow.id, durationMinutes: body.duration_minutes,
      slots, startDate: body.start_date, today, now,
    });
    const seq = Number.isInteger(body.seq) ? body.seq : null;
    return res.json({ seq, slots: rowsOut });
  } catch (e) {
    logError('series check error', e);
    return res.status(500).json({ error: 'Failed to check the schedule' });
  }
});

module.exports = router;
module.exports.helpers = { resolveClient, withUtc, pastError };
```

- [ ] **Step 5: Mount the router**

In `backend/src/routes/sessions.js`, immediately after the existing `router.use(requireAuth);` line, add:

```js
// Recurring sessions: registered before the /:id routes.
router.use('/series', require('./sessionSeries'));
```

- [ ] **Step 6: Run to verify the preview/check tests pass**

Run: `cd backend && node --test test/session-series-routes.test.js`
Expected: the preview and check tests PASS (create/cancel tests do not exist yet). The "suggestions never include times in the past" test passes trivially if the current time is early in the day; it exists to guard the `now` filter — if you want it to be non-trivial, it is acceptable to leave it as is.

- [ ] **Step 7: Regression**

Run: `cd backend && node --test test/session-detail.test.js test/session-notifications.test.js test/coach-session-surface.test.js test/session-workout-validation.test.js test/session-cancel-notify.test.js`
Expected: PASS (these mount `sessions.js`, which now requires `sessionSeries.js`).

- [ ] **Step 8: Commit**

```bash
git add backend/src/routes/sessionSeries.js backend/src/routes/sessions.js backend/src/lib/sessionSeries/rule.js backend/test/session-series-routes.test.js
git commit -m "feat: series preview and check routes with chunked independent suggestions" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 15: Series create route — request parsing, replay-first ordering, notifications

**Files:**
- Create: `backend/src/lib/sessionSeries/createRequest.js`
- Modify: `backend/src/routes/sessionSeries.js` (add `POST /`)
- Modify: `backend/test/session-series-routes.test.js` (append)

**Interfaces:**
- Consumes: `requestHash`, `validateSlotShapes`, `isRealDate`, `isTime`, `slotHorizonError`, `MAX_SLOTS`; `validateWorkoutIds`; RPC `schedule_session_series`; `notifySeriesScheduled`; `dispatchEmail`, `dispatchPush`, `sendToClient`.
- Produces:
  - `parseCreateRequest(body): { ok: true, value: Request, normalized: object } | { ok: false, error }` where `Request = { request_id, client_id, duration_minutes, location, rule: { start_date, time, weekdays, interval_weeks, end }, slots: Slot[], program_id: string|null, assign_program: boolean, notify: boolean }`; `normalized` is what `requestHash` hashes (all fields above).
  - `POST /api/sessions/series` → `201 { series, receipt, replayed: false }`, `200 { series, receipt, replayed: true }`, `409 { error, conflicts: [{ key, scope, session?, with_key?, display? }] }`, `409 { error, code: 'request_mismatch' }`, `400`/`404`.

- [ ] **Step 1: Append the failing tests**

Append to `backend/test/session-series-routes.test.js`:

```js
// ---------- create ----------
const { parseCreateRequest } = require('../src/lib/sessionSeries/createRequest');
const createBody = (overrides = {}) => ({
  request_id: REQUEST_ID, client_id: CLIENT_ID, duration_minutes: 60, location: 'CVF Studio',
  rule: { start_date: day(14), time: '17:00', weekdays: [2, 4], interval_weeks: 1, end: { count: 3 } },
  slots: [
    { key: 'g1', date: day(14), time: '17:00', workout_id: WORKOUT_ID },
    { key: 'g2', date: day(16), time: '17:00', workout_id: null },
    { key: 'g3', date: day(21), time: '17:00' },
  ],
  program_id: null, assign_program: false, notify: true, ...overrides,
});
const createCalls = () => state.rpcCalls.filter((c) => c.name === 'schedule_session_series');
const hashOf = (body) => requestHash(parseCreateRequest(body).normalized);

test('create saves the batch, passes UTC slots in, and sends exactly one email and one push', async () => {
  resetState(); currentUser = coachUser;
  const result = await call('', { body: createBody() });
  assert.equal(result.status, 201);
  assert.equal(result.body.replayed, false);
  assert.equal(result.body.series.id, SERIES_ID);
  assert.equal(result.body.receipt.slots.length, 3);
  const args = createCalls()[0].args;
  assert.equal(args.p_coach_id, COACH_ID);
  assert.equal(args.p_request_id, REQUEST_ID);
  assert.equal(args.p_request_hash, hashOf(createBody()));
  assert.equal(args.p_slots.length, 3);
  assert.ok(args.p_slots.every((s) => /Z$/.test(s.scheduled_at)));
  assert.equal(args.p_slots.find((s) => s.key === 'g1').workout_id, WORKOUT_ID);
  assert.equal(args.p_location, 'CVF Studio');
  assert.equal(state.emails.length, 1);
  assert.equal(state.emails[0].dates.length, 3);
  assert.equal(state.pushes, 1);
});

test('create with notify false is silent', async () => {
  resetState(); currentUser = coachUser;
  const result = await call('', { body: createBody({ notify: false }) });
  assert.equal(result.status, 201);
  assert.equal(state.emails.length, 0);
  assert.equal(state.pushes, 0);
});

test('create validates shape, then eligibility, before any database write', async () => {
  resetState(); currentUser = coachUser;
  const bad = [
    createBody({ request_id: 'nope' }),
    createBody({ slots: [] }),
    createBody({ duration_minutes: 5 }),
    createBody({ notify: 'yes' }),
    createBody({ assign_program: 'yes' }),
    createBody({ slots: [{ key: 'a', date: day(14), time: '17:00', workout_id: 'bad' }] }),
  ];
  for (const body of bad) assert.equal((await call('', { body })).status, 400, JSON.stringify(body).slice(0, 80));
  // eligibility for NEW operations:
  assert.equal((await call('', { body: createBody({ slots: [{ key: 'a', date: day(-2), time: '17:00' }] }) })).status, 400);
  assert.equal((await call('', { body: createBody({ rule: { ...createBody().rule, start_date: day(-2) } }) })).status, 400);
  assert.equal((await call('', { body: createBody({ slots: [{ key: 'a', date: day(14 + 366), time: '17:00' }] }) })).status, 400);
  state.workouts = [{ id: WORKOUT_ID, coach_id: OTHER_COACH_ID }];
  assert.equal((await call('', { body: createBody() })).status, 400); // foreign workout
  state.workouts = [{ id: WORKOUT_ID, coach_id: null }];            // shared workout is fine
  assert.equal((await call('', { body: createBody({ program_id: PROGRAM_ID }) })).status, 201);
  assert.equal(createCalls().length, 1); // only the final, valid request reached the database
});

test('create refuses clients and programs the caller cannot use', async () => {
  resetState(); currentUser = coachUser;
  state.clientRow = { id: CLIENT_ID, coach_id: OTHER_COACH_ID, archived: false };
  assert.equal((await call('', { body: createBody() })).status, 404);
  resetState(); currentUser = coachUser;
  state.programRow = { id: PROGRAM_ID, coach_id: OTHER_COACH_ID, archived: false };
  assert.equal((await call('', { body: createBody({ program_id: PROGRAM_ID }) })).status, 404);
  resetState(); currentUser = coachUser;
  state.programRow = null; // archived or missing
  assert.equal((await call('', { body: createBody({ program_id: PROGRAM_ID, assign_program: false }) })).status, 404);
  assert.equal(createCalls().length, 0);
});

test('an admin saves for the client\'s coach', async () => {
  resetState(); currentUser = { role: 'admin', coach: { id: 'admin-coach' } };
  state.clientRow = { id: CLIENT_ID, coach_id: OTHER_COACH_ID, archived: false };
  state.workouts = [{ id: WORKOUT_ID, coach_id: OTHER_COACH_ID }];
  const result = await call('', { body: createBody() });
  assert.equal(result.status, 201);
  assert.equal(createCalls()[0].args.p_coach_id, OTHER_COACH_ID);
});

test('assign_program and program_id reach the database function', async () => {
  resetState(); currentUser = coachUser;
  await call('', { body: createBody({ program_id: PROGRAM_ID, assign_program: true }) });
  const args = createCalls()[0].args;
  assert.equal(args.p_program_id, PROGRAM_ID);
  assert.equal(args.p_assign_program, true);
});

test('save-time conflicts return 409 with every conflict by key and notify nobody', async () => {
  resetState(); currentUser = coachUser;
  state.rpcImpl.schedule_session_series = () => ({
    outcome: 'conflicts',
    conflicts: [
      { key: 'g1', scope: 'coach', session: { id: 'x', scheduled_at: new Date(Date.now() + 14 * 86400000).toISOString() } },
      { key: 'g2', scope: 'batch', with_key: 'g3' },
    ],
  });
  const result = await call('', { body: createBody() });
  assert.equal(result.status, 409);
  assert.equal(result.body.conflicts.length, 2);
  assert.equal(result.body.conflicts[0].key, 'g1');
  assert.ok(typeof result.body.conflicts[0].display === 'string');
  assert.equal(result.body.conflicts[1].with_key, 'g3');
  assert.equal(state.emails.length, 0);
  assert.equal(state.pushes, 0);
});

test('EARLY replay: a saved request is recovered even when its dates are now in the past, with no database call and no notification', async () => {
  resetState(); currentUser = coachUser;
  const body = createBody({
    rule: { start_date: '2020-01-07', time: '17:00', weekdays: [2], interval_weeks: 1, end: { count: 1 } },
    slots: [{ key: 'g1', date: '2020-01-07', time: '17:00', workout_id: null }],
  });
  state.existingSeries = { id: SERIES_ID, coach_id: COACH_ID, client_id: CLIENT_ID, request_id: REQUEST_ID, request_hash: hashOf(body), receipt: { slots: [{ key: 'g1', session_id: 's1' }] } };
  const result = await call('', { body });
  assert.equal(result.status, 200);
  assert.equal(result.body.replayed, true);
  assert.equal(result.body.receipt.slots[0].key, 'g1');
  assert.equal(state.rpcCalls.length, 0);
  assert.equal(state.emails.length, 0);
  assert.equal(state.pushes, 0);
});

test('replay with a different body is a request_mismatch 409; another coach\'s request id is a 404', async () => {
  resetState(); currentUser = coachUser;
  state.existingSeries = { id: SERIES_ID, coach_id: COACH_ID, client_id: CLIENT_ID, request_id: REQUEST_ID, request_hash: 'something-else', receipt: { slots: [] } };
  const mismatch = await call('', { body: createBody() });
  assert.equal(mismatch.status, 409);
  assert.equal(mismatch.body.code, 'request_mismatch');
  state.existingSeries = { ...state.existingSeries, coach_id: OTHER_COACH_ID, request_hash: hashOf(createBody()) };
  assert.equal((await call('', { body: createBody() })).status, 404);
  assert.equal(createCalls().length, 0);
});

test('DATABASE-LEVEL replay (both requests passed the early lookup) is a 200 and sends NO notification', async () => {
  resetState(); currentUser = coachUser;
  state.rpcImpl.schedule_session_series = (args) => ({ ...defaultCreate(args), replayed: true });
  const result = await call('', { body: createBody() });
  assert.equal(result.status, 200);
  assert.equal(result.body.replayed, true);
  assert.equal(state.emails.length, 0);
  assert.equal(state.pushes, 0);
});

test('a request_mismatch reported by the database function is also a 409 code request_mismatch', async () => {
  resetState(); currentUser = coachUser;
  state.rpcImpl.schedule_session_series = () => ({ outcome: 'request_mismatch' });
  const result = await call('', { body: createBody() });
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'request_mismatch');
});

test('series routes require a coach', async () => {
  resetState(); currentUser = { role: 'client', client: { id: CLIENT_ID } };
  assert.equal((await call('', { body: createBody() })).status, 403);
  assert.equal((await call('/preview', { body: previewBody() })).status, 403);
  assert.equal((await call('/check', { body: {} })).status, 403);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && node --test test/session-series-routes.test.js`
Expected: the test file fails to load (`Cannot find module '../src/lib/sessionSeries/createRequest'`) — that is the failing state; the new module and route do not exist yet.

- [ ] **Step 3: Implement the request parser**

Create `backend/src/lib/sessionSeries/createRequest.js`:

```js
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
```

- [ ] **Step 4: Implement `POST /`**

In `backend/src/routes/sessionSeries.js`:

1. Extend the imports:
```js
const { requestHash } = require('../lib/sessionSeries/rule');            // merge into the existing rule.js destructure
const { parseCreateRequest } = require('../lib/sessionSeries/createRequest');
const { validateWorkoutIds } = require('../lib/sessionWorkouts');
const { dispatchEmail, notifySeriesScheduled } = require('../services/email');
const { dispatchPush, sendToClient } = require('../services/push');
```
2. Add above `module.exports`:

```js
const MISMATCH = { error: 'This save was already used with different content — nothing was changed.', code: 'request_mismatch' };

function decorateConflicts(conflicts) {
  return (conflicts || []).map((conflict) => ({
    ...conflict,
    display: conflict.session?.scheduled_at ? formatDenverDisplay(conflict.session.scheduled_at) : null,
  }));
}

// ---- POST /api/sessions/series ----
// Order matters so a successful save is always recoverable:
//   1. shape validation only; 2. authorized replay lookup (skips every time- and
//   record-sensitive check); 3. eligibility checks for NEW operations; 4. the
//   transactional RPC, which re-resolves replays under the scheduling lock.
router.post('/', requireCoach, async (req, res) => {
  try {
    const parsed = parseCreateRequest(req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    const request = parsed.value;
    const hash = requestHash(parsed.normalized);

    const { data: existing } = await supabaseAdmin.from('session_series').select('*')
      .eq('request_id', request.request_id).eq('client_id', request.client_id).maybeSingle();
    if (existing) {
      if (req.user.role !== 'admin' && existing.coach_id !== req.user.coach.id) return res.status(404).json({ error: 'Not found' });
      if (existing.request_hash !== hash) return res.status(409).json(MISMATCH);
      return res.status(200).json({ series: existing, receipt: existing.receipt, replayed: true });
    }

    const resolved = await resolveClient(req, res, request.client_id);
    if (!resolved) return;
    const { coachId } = resolved;
    const today = todayDateInTz();
    if (request.rule.start_date < today) return res.status(400).json({ error: 'A series cannot start in the past' });
    const horizon = slotHorizonError(request.slots, request.rule.start_date, today);
    if (horizon) return res.status(400).json({ error: horizon });
    const slots = withUtc(request.slots);
    const past = pastError(slots, Date.now());
    if (past) return res.status(400).json({ error: past });

    if (request.program_id) {
      const { data: program } = await supabaseAdmin.from('programs').select('id, coach_id, archived')
        .eq('id', request.program_id).eq('archived', false).maybeSingle();
      if (!program || (req.user.role !== 'admin' && program.coach_id !== coachId)) {
        return res.status(404).json({ error: 'Program not found' });
      }
    }
    const workouts = await validateWorkoutIds(request.slots.map((slot) => slot.workout_id), coachId);
    if (!workouts.ok) return res.status(400).json({ error: workouts.error });

    const { data, error } = await supabaseAdmin.rpc('schedule_session_series', {
      p_request_id: request.request_id,
      p_request_hash: hash,
      p_coach_id: coachId,
      p_client_id: request.client_id,
      p_duration_minutes: request.duration_minutes,
      p_location: request.location,
      p_rule: request.rule,
      p_program_id: request.program_id,
      p_assign_program: request.assign_program,
      p_slots: slots.map((slot) => ({ key: slot.key, scheduled_at: slot.scheduled_at, workout_id: slot.workout_id })),
    });
    if (error) throw error;

    if (data.outcome === 'request_mismatch') return res.status(409).json(MISMATCH);
    if (data.outcome === 'conflicts') {
      return res.status(409).json({ error: 'Some dates are no longer available', conflicts: decorateConflicts(data.conflicts) });
    }

    const replayed = Boolean(data.replayed);
    // Notify only for a NEW save, decided on the database function's result — never
    // on the route's early lookup, which two simultaneous requests can both miss.
    if (!replayed && request.notify) {
      const dates = (data.receipt?.slots || []).map((slot) => slot.scheduled_at);
      await dispatchEmail(() => notifySeriesScheduled({ seriesId: data.series.id, clientId: request.client_id, coachId, dates }));
      dispatchPush(() => sendToClient(request.client_id, {
        title: 'New sessions scheduled',
        body: `${dates.length} session${dates.length === 1 ? '' : 's'} starting ${formatDenverDisplay(dates[0])}.`,
        url: '/client/sessions',
      }));
    }
    return res.status(replayed ? 200 : 201).json({ series: data.series, receipt: data.receipt, replayed });
  } catch (e) {
    logError('series create error', e);
    return res.status(500).json({ error: 'Failed to create the series' });
  }
});
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd backend && node --test test/session-series-routes.test.js`
Expected: PASS (preview, check, and create groups).

- [ ] **Step 6: Run the full backend suite**

Run: `cd backend && npm test`
Expected: zero failures.

- [ ] **Step 7: Commit**

```bash
git add backend/src/lib/sessionSeries/createRequest.js backend/src/routes/sessionSeries.js backend/test/session-series-routes.test.js
git commit -m "feat: series create route with replay-first ordering and single notification" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 16: Series cancel route ("this and all future")

**Files:**
- Modify: `backend/src/routes/sessionSeries.js`
- Modify: `backend/test/session-series-routes.test.js` (append)

**Interfaces:**
- Consumes: `validateNotifyFlag` (Task 12), `notifySeriesCancelled` (Task 13).
- Produces: `PATCH /api/sessions/series/:seriesId/cancel` — body `{ from_session_id: uuid, notify?: boolean }` → `200 { cancelled: [{ id, scheduled_at }] }`; `404` when the series is not the caller's or the anchor does not belong to that series and client.

- [ ] **Step 1: Append the failing tests**

```js
// ---------- cancel this-and-future ----------
const ANCHOR_ID = 'eeeeeeee-0000-0000-0000-00000000000e';
const cancelBody = (overrides = {}) => ({ from_session_id: ANCHOR_ID, notify: true, ...overrides });
function seedSeriesForCancel() {
  state.existingSeries = { id: SERIES_ID, coach_id: COACH_ID, client_id: CLIENT_ID, archived: false };
  state.anchorSession = { id: ANCHOR_ID, series_id: SERIES_ID, client_id: CLIENT_ID, scheduled_at: new Date(Date.now() + 7 * 86400000).toISOString(), archived: false };
  state.cancelledRows = [
    { id: ANCHOR_ID, scheduled_at: state.anchorSession.scheduled_at },
    { id: 'later-1', scheduled_at: new Date(Date.now() + 14 * 86400000).toISOString() },
  ];
}

test('cancel this-and-future changes only the returned scheduled rows and sends one summary', async () => {
  resetState(); currentUser = coachUser; seedSeriesForCancel();
  const result = await call(`/${SERIES_ID}/cancel`, { method: 'PATCH', body: cancelBody() });
  assert.equal(result.status, 200);
  assert.equal(result.body.cancelled.length, 2);
  assert.deepEqual(state.sessionUpdates.map((u) => u.status), ['cancelled']);
  assert.equal(state.cancelEmails.length, 1);
  assert.equal(state.cancelEmails[0].cancelled.length, 2);
  assert.equal(state.cancelEmails[0].seriesId, SERIES_ID);
  assert.equal(state.pushes, 1);
});

test('cancel with notify false is silent; a retry that changes zero rows sends nothing', async () => {
  resetState(); currentUser = coachUser; seedSeriesForCancel();
  assert.equal((await call(`/${SERIES_ID}/cancel`, { method: 'PATCH', body: cancelBody({ notify: false }) })).status, 200);
  assert.equal(state.cancelEmails.length, 0);
  resetState(); currentUser = coachUser; seedSeriesForCancel();
  state.cancelledRows = []; // nothing left to cancel
  const retry = await call(`/${SERIES_ID}/cancel`, { method: 'PATCH', body: cancelBody() });
  assert.equal(retry.status, 200);
  assert.deepEqual(retry.body.cancelled, []);
  assert.equal(state.cancelEmails.length, 0);
  assert.equal(state.pushes, 0);
});

test('cancel validates ids and the notify flag, and masks other coaches\' series and foreign anchors', async () => {
  resetState(); currentUser = coachUser; seedSeriesForCancel();
  assert.equal((await call('/not-a-uuid/cancel', { method: 'PATCH', body: cancelBody() })).status, 400);
  assert.equal((await call(`/${SERIES_ID}/cancel`, { method: 'PATCH', body: cancelBody({ from_session_id: 'nope' }) })).status, 400);
  assert.equal((await call(`/${SERIES_ID}/cancel`, { method: 'PATCH', body: cancelBody({ notify: 'x' }) })).status, 400);
  state.existingSeries = { ...state.existingSeries, coach_id: OTHER_COACH_ID };
  assert.equal((await call(`/${SERIES_ID}/cancel`, { method: 'PATCH', body: cancelBody() })).status, 404);
  seedSeriesForCancel();
  state.anchorSession = { ...state.anchorSession, series_id: 'some-other-series' };
  assert.equal((await call(`/${SERIES_ID}/cancel`, { method: 'PATCH', body: cancelBody() })).status, 404);
  seedSeriesForCancel();
  state.anchorSession = { ...state.anchorSession, client_id: 'someone-else' };
  assert.equal((await call(`/${SERIES_ID}/cancel`, { method: 'PATCH', body: cancelBody() })).status, 404);
  assert.equal(state.sessionUpdates.length, 0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && node --test test/session-series-routes.test.js`
Expected: the three new tests FAIL (route returns 404 for the unregistered path).

- [ ] **Step 3: Implement**

In `backend/src/routes/sessionSeries.js`: extend imports with `const { validateUuid, validateNotifyFlag } = require('../validation/business');` (replace the existing `validateUuid` import), `notifySeriesCancelled` from the email service, then add above `module.exports`:

```js
// ---- PATCH /api/sessions/series/:seriesId/cancel ----
// Cancels the anchor session and every LATER scheduled session of the same series.
// Completed, no-show and already-cancelled sessions are never touched. Nothing is
// deleted. Notifies only when rows actually changed (a retry that changes zero rows
// is silent).
router.patch('/:seriesId/cancel', requireCoach, async (req, res) => {
  try {
    const seriesId = validateUuid(req.params.seriesId, 'Series ID');
    if (!seriesId.ok) return res.status(400).json({ error: seriesId.error });
    const anchorId = validateUuid((req.body || {}).from_session_id, 'Session ID');
    if (!anchorId.ok) return res.status(400).json({ error: anchorId.error });
    const notify = validateNotifyFlag(req.body);
    if (!notify.ok) return res.status(400).json({ error: notify.error });

    const { data: series } = await supabaseAdmin.from('session_series').select('*')
      .eq('id', seriesId.value).eq('archived', false).maybeSingle();
    if (!series || (req.user.role !== 'admin' && series.coach_id !== req.user.coach.id)) {
      return res.status(404).json({ error: 'Series not found' });
    }
    const { data: anchor } = await supabaseAdmin.from('sessions').select('id, series_id, client_id, scheduled_at')
      .eq('id', anchorId.value).eq('archived', false).maybeSingle();
    if (!anchor || anchor.series_id !== series.id || anchor.client_id !== series.client_id) {
      return res.status(404).json({ error: 'Session not found in this series' });
    }

    const { data: changed, error } = await supabaseAdmin.from('sessions')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('series_id', series.id).eq('status', 'scheduled').eq('archived', false)
      .gte('scheduled_at', anchor.scheduled_at)
      .select('id, scheduled_at');
    if (error) throw error;
    const cancelled = [...(changed || [])].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));

    if (notify.value && cancelled.length) {
      await dispatchEmail(() => notifySeriesCancelled({ seriesId: series.id, clientId: series.client_id, coachId: series.coach_id, cancelled }));
      dispatchPush(() => sendToClient(series.client_id, {
        title: cancelled.length === 1 ? 'Session cancelled' : 'Sessions cancelled',
        body: `${cancelled.length} session${cancelled.length === 1 ? '' : 's'} starting ${formatDenverDisplay(cancelled[0].scheduled_at)} ${cancelled.length === 1 ? 'was' : 'were'} cancelled.`,
        url: '/client/sessions',
      }));
    }
    return res.json({ cancelled });
  } catch (e) {
    logError('series cancel error', e);
    return res.status(500).json({ error: 'Failed to cancel the sessions' });
  }
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && node --test test/session-series-routes.test.js`
Expected: PASS (all groups).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/sessionSeries.js backend/test/session-series-routes.test.js
git commit -m "feat: cancel this-and-future for a series with one summary notification" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 17: Series info on coach session reads

**Files:**
- Modify: `backend/src/routes/sessions.js` (`GET /` and `GET /:id/coach-detail` selects)
- Modify: `backend/test/session-series-routes.test.js` (append)

**Interfaces:**
- Produces: coach list rows and coach-detail rows gain `series: { id, rule, created_count } | null` (PostgREST embed via the `sessions.series_id` foreign key) and `series_ordinal: number | null` (already included by `*`). Client-facing routes are unchanged.

- [ ] **Step 1: Append the failing test**

The existing stub in this test file does not record `select()` arguments, so extend the stub's `select` first: in the `from(table)` chain in `session-series-routes.test.js`, replace `select() { return chain; },` with `select(columns) { if (table === 'sessions' && typeof columns === 'string') state.sessionSelects.push(columns); return chain; },` and add `sessionSelects: [],` to `resetState()`. Then append:

```js
test('coach list and coach detail embed the series for session rows', async () => {
  resetState(); currentUser = coachUser;
  state.anchorSession = { id: ANCHOR_ID, coach_id: COACH_ID, client_id: CLIENT_ID, scheduled_at: new Date().toISOString(), archived: false };
  await fetch(`${baseUrl}/api/sessions`).then((r) => r.json());
  await fetch(`${baseUrl}/api/sessions/${ANCHOR_ID}/coach-detail`).then((r) => r.json());
  const embeds = state.sessionSelects.filter((columns) => columns.includes('series:session_series(id, rule, created_count)'));
  assert.equal(embeds.length, 2, `selects seen: ${state.sessionSelects.join(' | ')}`);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && node --test test/session-series-routes.test.js`
Expected: FAIL — `embeds.length` is 0.

- [ ] **Step 3: Implement**

In `backend/src/routes/sessions.js`:
- In `router.get('/', …)`: change `.select('*, client:clients(id, name), coach:coaches(id, name), workout:workouts(id, name)')` to `.select('*, client:clients(id, name), coach:coaches(id, name), workout:workouts(id, name), series:session_series(id, rule, created_count)')`.
- In `router.get('/:id/coach-detail', …)`: change `.select('*, client:clients(id, name), coach:coaches(id, name), workout:workouts(id, name, description, goal)')` to `.select('*, client:clients(id, name), coach:coaches(id, name), workout:workouts(id, name, description, goal), series:session_series(id, rule, created_count)')`.

Do **not** change the studio calendar, client-facing, or booking selects.

- [ ] **Step 4: Run to verify it passes, then the full suite**

```bash
cd backend && node --test test/session-series-routes.test.js && npm test
```
Expected: PASS; zero failures in the full suite.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/sessions.js backend/test/session-series-routes.test.js
git commit -m "feat: embed series info on coach session list and detail" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

> **Checkpoint:** Phase 4 complete = backend behavior done and fully tested against stubs. These routes require the Phase 3 migrations at runtime.

---

## Phase 5 — Frontend

Pure logic first (unit-tested with Node's built-in runner, no new dependency), then components, then the mocked-API browser tests. The frontend never imports from `backend/`.

### Task 18: Unit-test script and `seriesPlan.js` (mapping, summary, labels)

**Files:**
- Modify: `frontend/package.json` (scripts only)
- Create: `frontend/src/lib/seriesPlan.js`
- Create: `frontend/tests/unit/seriesPlan.test.mjs`

**Interfaces:**
- Produces (all pure, no imports from `@/`; additions for recovery marked †):
  - `WEEKDAY_SHORT: string[]` (Sun-first).
  - `shiftDate(dateStr: 'YYYY-MM-DD', days: number): string`; `weekdayOfDate(dateStr): 0..6`.
  - `sortRows(rows: Row[]): Row[]` — chronological by `date`, `time`, `key`; `Row = { key, date, time, selected: boolean, ... }`.
  - `mapWorkouts({ rows, programDays, startingDay = 1, pins = {} }): { [key]: string|null }` — for **selected** rows only. `programDays = [{ day_number, workout_id }]`.
  - `summarizeSelection(rows): { selected: number, total: number, lastDate: string|null }`.
  - `ruleLabel(rule: { weekdays: number[], interval_weeks: 1|2 }): string` and `badgeLabel(series: { rule, created_count }, ordinal: number): string`.
  - † `assignDefault(program, clientId): boolean` — what "Also assign this program" should start as **when the coach explicitly chooses a program**: `true` only if the program exists and the client does not already have it. It is never applied while restoring saved state or when program metadata finishes loading.
  - † `rowsFromBody(body)`, `pinsFromBody(body)`, `configFromBody(body)` — **fallback** reconstruction of the editor from a frozen create-request body, used only when a restored pending save has no editor snapshot (records written before snapshots existed). Deselected candidates and the starting day cannot be recovered from a body, so every row comes back selected with its workout pinned.

- [ ] **Step 1: Add the test script**

In `frontend/package.json` `scripts`, add after `"preview"`:

```json
    "test:unit": "node --test \"tests/unit/*.test.mjs\"",
    "test:e2e:series": "playwright test --config playwright.series.config.mjs",
```
(`node --test` loads the ambiguous `.js` ES modules in `src/lib` through Node's module-syntax detection; no `type` field is needed.)

- [ ] **Step 2: Write the failing tests**

Create `frontend/tests/unit/seriesPlan.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sortRows, mapWorkouts, summarizeSelection, ruleLabel, badgeLabel, shiftDate, weekdayOfDate,
  rowsFromBody, pinsFromBody, configFromBody, assignDefault,
} from '../../src/lib/seriesPlan.js';

const W1 = 'w-1'; const W2 = 'w-2'; const W3 = 'w-3';
const DAYS = [{ day_number: 1, workout_id: W1 }, { day_number: 2, workout_id: W2 }, { day_number: 3, workout_id: W3 }];
// Six Tue/Thu rows R1..R6 starting Tue 2031-06-03.
const six = () => [
  ['R1', '2031-06-03'], ['R2', '2031-06-05'], ['R3', '2031-06-10'],
  ['R4', '2031-06-12'], ['R5', '2031-06-17'], ['R6', '2031-06-19'],
].map(([key, date]) => ({ key, date, time: '17:00', selected: true }));
const assignments = (rows, options = {}) => {
  const mapping = mapWorkouts({ rows, programDays: DAYS, ...options });
  return rows.map((row) => mapping[row.key]);
};

test('no edits: days in order, wrapping after the last day', () => {
  assert.deepEqual(assignments(six()), [W1, W2, W3, W1, W2, W3]);
});

test('an unticked row takes no day, so later rows move up instead of a day being lost', () => {
  const rows = six(); rows[1].selected = false; // R2 (holiday)
  const mapping = mapWorkouts({ rows, programDays: DAYS });
  assert.equal(mapping.R2, undefined);
  assert.deepEqual([mapping.R1, mapping.R3, mapping.R4, mapping.R5, mapping.R6], [W1, W2, W3, W1, W2]);
});

test('a pinned row keeps its workout, consumes its position, and does not shift the next row', () => {
  assert.deepEqual(assignments(six(), { pins: { R3: W1 } }), [W1, W2, W1, W1, W2, W3]);
});

test('a pin to "no workout" (null) still consumes the position', () => {
  assert.deepEqual(assignments(six(), { pins: { R2: null } }), [W1, null, W3, W1, W2, W3]);
});

test('moving a row across another re-maps the automatic rows by chronology; a pin follows its row', () => {
  const moved = six(); moved[0].date = '2031-06-11'; // R1 now between R3 (06-10) and R4 (06-12)
  const auto = mapWorkouts({ rows: moved, programDays: DAYS });
  assert.deepEqual([auto.R2, auto.R3, auto.R1, auto.R4], [W1, W2, W3, W1]);
  const pinned = mapWorkouts({ rows: moved, programDays: DAYS, pins: { R1: W2 } });
  assert.equal(pinned.R1, W2); // pinned, still the third position
  assert.deepEqual([pinned.R2, pinned.R3, pinned.R4], [W1, W2, W1]); // others unchanged
});

test('starting day offsets the sequence; an unknown starting day falls back to the first day', () => {
  assert.deepEqual(assignments(six(), { startingDay: 2 }), [W2, W3, W1, W2, W3, W1]);
  assert.deepEqual(assignments(six(), { startingDay: 9 }), [W1, W2, W3, W1, W2, W3]);
});

test('no program: automatic rows are null, pins still apply', () => {
  const rows = six();
  const mapping = mapWorkouts({ rows, programDays: [], pins: { R2: W3 } });
  assert.equal(mapping.R1, null);
  assert.equal(mapping.R2, W3);
});

test('program days are ordered by day_number regardless of input order', () => {
  const shuffled = [DAYS[2], DAYS[0], DAYS[1]];
  assert.deepEqual(assignments(six(), { programDays: shuffled }), [W1, W2, W3, W1, W2, W3]);
});

test('sortRows is chronological with key as the tie-break and does not mutate its input', () => {
  const rows = [{ key: 'b', date: '2031-06-05', time: '17:00' }, { key: 'a', date: '2031-06-05', time: '17:00' }, { key: 'c', date: '2031-06-03', time: '18:00' }];
  const sorted = sortRows(rows);
  assert.deepEqual(sorted.map((r) => r.key), ['c', 'a', 'b']);
  assert.deepEqual(rows.map((r) => r.key), ['b', 'a', 'c']);
});

test('summarizeSelection reports selected, total, and the last selected date', () => {
  const rows = six(); rows[5].selected = false; rows[4].selected = false;
  assert.deepEqual(summarizeSelection(rows), { selected: 4, total: 6, lastDate: '2031-06-12' });
  assert.deepEqual(summarizeSelection([]), { selected: 0, total: 0, lastDate: null });
});

test('rule label and badge label', () => {
  assert.equal(ruleLabel({ weekdays: [4, 2], interval_weeks: 1 }), 'Weekly · Tue/Thu');
  assert.equal(ruleLabel({ weekdays: [0, 1], interval_weeks: 2 }), 'Every 2 weeks · Mon/Sun');
  assert.equal(badgeLabel({ rule: { weekdays: [2, 4], interval_weeks: 1 }, created_count: 12 }, 3), 'Weekly · Tue/Thu · Session 3 of 12');
});

test('date helpers', () => {
  assert.equal(shiftDate('2031-06-30', 1), '2031-07-01');
  assert.equal(shiftDate('2031-03-01', -1), '2031-02-28');
  assert.equal(weekdayOfDate('2031-06-03'), 2); // Tuesday
});

test('assignDefault: ticked only for a program the client does not already have', () => {
  const unassigned = { id: 'p1', active_assignments: [] };
  const assignedElsewhere = { id: 'p2', active_assignments: [{ client: { id: 'someone-else' } }] };
  const assignedHere = { id: 'p3', active_assignments: [{ client: { id: 'c1' } }] };
  assert.equal(assignDefault(unassigned, 'c1'), true);
  assert.equal(assignDefault(assignedElsewhere, 'c1'), true);
  assert.equal(assignDefault(assignedHere, 'c1'), false);
  assert.equal(assignDefault({ id: 'p4' }, 'c1'), true);   // no assignment list at all
  assert.equal(assignDefault(null, 'c1'), false);          // no program chosen
  assert.equal(assignDefault(undefined, 'c1'), false);
});

const body = () => ({
  request_id: 'r', client_id: 'c', duration_minutes: 60, location: null,
  rule: { start_date: '2031-06-03', time: '17:00', weekdays: [2, 4], interval_weeks: 2, end: { until: '2031-08-01' } },
  slots: [{ key: 'g1', date: '2031-06-03', time: '17:00', workout_id: 'w1' }, { key: 'a1', date: '2031-06-05', time: '17:00', workout_id: null }],
  program_id: 'p1', assign_program: true, notify: false,
});

test('fallback reconstruction: rows come back selected, pins carry the saved workouts (null = none)', () => {
  assert.deepEqual(rowsFromBody(body()).map((r) => [r.key, r.date, r.time, r.selected, r.conflict]),
    [['g1', '2031-06-03', '17:00', true, null], ['a1', '2031-06-05', '17:00', true, null]]);
  assert.deepEqual(pinsFromBody(body()), { g1: 'w1', a1: null });
  assert.deepEqual(rowsFromBody(undefined), []);
  assert.deepEqual(pinsFromBody(undefined), {});
});

test('fallback config: end mode, program, assign and notify come from the body; starting day resets', () => {
  assert.deepEqual(configFromBody(body()), {
    weekdays: [2, 4], intervalWeeks: 2, endMode: 'until', count: 12, until: '2031-08-01',
    programId: 'p1', startingDay: 1, assignProgram: true, notify: false,
  });
  const counted = body(); counted.rule.end = { count: 6 }; counted.notify = true; counted.program_id = null; counted.assign_program = false;
  const config = configFromBody(counted);
  assert.equal(config.endMode, 'count'); assert.equal(config.count, 6); assert.equal(config.programId, ''); assert.equal(config.notify, true);
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd frontend && npm run test:unit`
Expected: FAIL — cannot find module `src/lib/seriesPlan.js`.

- [ ] **Step 4: Implement**

Create `frontend/src/lib/seriesPlan.js`:

```js
// Pure logic for the recurring-sessions composer: program-day mapping, selection
// summary, and labels. No imports from '@/' so it runs under `node --test`.

export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0];

export function shiftDate(dateStr, days) {
  return new Date(new Date(`${dateStr}T00:00:00.000Z`).getTime() + days * 86400000).toISOString().slice(0, 10);
}

export function weekdayOfDate(dateStr) {
  return new Date(`${dateStr}T00:00:00.000Z`).getUTCDay();
}

export function sortRows(rows) {
  return [...rows].sort((a, b) => `${a.date}T${a.time}|${a.key}`.localeCompare(`${b.date}T${b.time}|${b.key}`));
}

// Maps program days onto the SELECTED rows in chronological order.
//  - Automatic rows take days in sequence from `startingDay`, wrapping after the last day.
//  - Unselected rows take no day (later rows move up).
//  - A pinned row (pins[key], including null = "no workout") keeps its choice, consumes
//    its normal position, and never changes what the following row receives.
export function mapWorkouts({ rows, programDays = [], startingDay = 1, pins = {} }) {
  const days = [...programDays].sort((a, b) => a.day_number - b.day_number);
  const start = Math.max(0, days.findIndex((day) => day.day_number === startingDay));
  const mapping = {};
  let position = 0;
  for (const row of sortRows(rows)) {
    if (!row.selected) continue;
    const automatic = days.length ? (days[(start + position) % days.length].workout_id ?? null) : null;
    mapping[row.key] = Object.hasOwn(pins, row.key) ? pins[row.key] : automatic;
    position += 1;
  }
  return mapping;
}

export function summarizeSelection(rows) {
  const selected = sortRows(rows).filter((row) => row.selected);
  return { selected: selected.length, total: rows.length, lastDate: selected.length ? selected[selected.length - 1].date : null };
}

export function ruleLabel(rule) {
  const days = MONDAY_FIRST.filter((day) => (rule?.weekdays || []).includes(day)).map((day) => WEEKDAY_SHORT[day]).join('/');
  return rule?.interval_weeks === 2 ? `Every 2 weeks · ${days}` : `Weekly · ${days}`;
}

export function badgeLabel(series, ordinal) {
  return `${ruleLabel(series.rule)} · Session ${ordinal} of ${series.created_count}`;
}

// "Also assign this program" starts ticked only when the client does not already have the program.
// Apply it ONLY when the coach explicitly chooses a program — never while restoring a saved draft, and
// never because program metadata finished loading — so a deliberate "do not assign" survives recovery.
export function assignDefault(program, clientId) {
  return Boolean(program) && !(program.active_assignments || []).some((assignment) => assignment.client?.id === clientId);
}

// ---- Fallback reconstruction of the editor from a frozen create-request body ----
// Used only for restored records that have no editor snapshot. A body cannot say which
// candidates were deselected or which starting day was chosen, so rows return selected and
// every workout is pinned to what was submitted.

export function rowsFromBody(body) {
  return (body?.slots || []).map((slot) => ({
    key: slot.key, date: slot.date, time: slot.time, selected: true, conflict: null, suggestions: [],
  }));
}

export function pinsFromBody(body) {
  return Object.fromEntries((body?.slots || []).map((slot) => [slot.key, slot.workout_id ?? null]));
}

export function configFromBody(body) {
  const rule = body?.rule || {};
  const end = rule.end || {};
  return {
    weekdays: [...(rule.weekdays || [])],
    intervalWeeks: rule.interval_weeks === 2 ? 2 : 1,
    endMode: end.until ? 'until' : 'count',
    count: end.count ?? 12,
    until: end.until || '',
    programId: body?.program_id || '',
    startingDay: 1,
    assignProgram: Boolean(body?.assign_program),
    notify: body?.notify !== false,
  };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd frontend && npm run test:unit`
Expected: PASS (15 tests in `seriesPlan.test.mjs`). A "MODULE_TYPELESS_PACKAGE_JSON" warning on stderr is harmless. (Requires Node ≥ 22.7 for module-syntax detection; CI uses Node 22.)

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/src/lib/seriesPlan.js frontend/tests/unit/seriesPlan.test.mjs
git commit -m "feat: series workout mapping and labels (pure, unit-tested)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 19: Pending-save store with a storage-unavailable path

**Files:**
- Create: `frontend/src/lib/seriesDraftStore.js`
- Create: `frontend/tests/unit/seriesDraftStore.test.mjs`

**Interfaces:**
- Produces:
  - `newRequestId(): string` (UUID v4).
  - `createDraftStore({ getStorage = () => window.localStorage, userId }): { save(clientId, record): boolean, load(clientId): Record|null, findPending(): { clientId, record }|null, clear(clientId): void }`, where `Record = { request_id: string, body: object, draft?: { v: 1, config, rows, pins, ruleUsed }, state: 'pending', saved_at: number }`. `body` is the **frozen request**, retried verbatim while the outcome is unknown; `draft` is a versioned **editor snapshot** (configuration, every row including deselected ones, workout pins, the rule the rows came from) used to restore the editor if the retry ends in a definitive conflict or error.
  - Every method swallows storage exceptions. `save` returns `false` when it could not persist (storage missing, blocked, or full) so the UI can warn that the pending save will not survive a reload. `load`/`findPending` ignore corrupt JSON. Keys are `cvf_series_pending:<userId>:<clientId>` — scoped to the signed-in user.

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/unit/seriesDraftStore.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDraftStore, newRequestId } from '../../src/lib/seriesDraftStore.js';

function fakeStorage(options = {}) {
  const map = new Map();
  return {
    map,
    get length() { return map.size; },
    key(i) { return [...map.keys()][i] ?? null; },
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { if (options.failSet) throw new DOMException('blocked', 'QuotaExceededError'); map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
  };
}
const record = (id = 'req-1') => ({ request_id: id, body: { client_id: 'c1', slots: [{ key: 'g1' }] }, state: 'pending' });

test('save then load round-trips the frozen request, scoped to user and client', () => {
  const storage = fakeStorage();
  const store = createDraftStore({ getStorage: () => storage, userId: 'coach-1' });
  assert.equal(store.save('client-1', record()), true);
  assert.equal(store.load('client-1').request_id, 'req-1');
  assert.deepEqual(store.load('client-1').body.slots, [{ key: 'g1' }]);
  assert.equal(store.load('client-2'), null);
  const otherUser = createDraftStore({ getStorage: () => storage, userId: 'coach-2' });
  assert.equal(otherUser.load('client-1'), null); // never leaks across users
  assert.ok([...storage.map.keys()][0].startsWith('cvf_series_pending:coach-1:client-1'));
});

test('an editor snapshot saved with the request survives the round trip (versioned, optional)', () => {
  const storage = fakeStorage();
  const store = createDraftStore({ getStorage: () => storage, userId: 'u' });
  const draft = { v: 1, config: { weekdays: [2] }, rows: [{ key: 'g1', selected: false }], pins: { g1: 'w1' }, ruleUsed: { start_date: '2031-06-03' } };
  assert.equal(store.save('c', { ...record(), draft }), true);
  assert.deepEqual(store.load('c').draft, draft);
  store.save('c2', record()); // records written without a snapshot still load
  assert.equal(store.load('c2').draft, undefined);
  assert.equal(store.findPending().record.request_id !== undefined, true);
});

test('findPending locates the user\'s unresolved save without knowing the client', () => {
  const storage = fakeStorage();
  const store = createDraftStore({ getStorage: () => storage, userId: 'coach-1' });
  assert.equal(store.findPending(), null);
  storage.setItem('unrelated', 'x');
  createDraftStore({ getStorage: () => storage, userId: 'coach-2' }).save('client-9', record('other'));
  store.save('client-1', record('mine'));
  const pending = store.findPending();
  assert.equal(pending.clientId, 'client-1');
  assert.equal(pending.record.request_id, 'mine');
});

test('clear removes only that client\'s record', () => {
  const storage = fakeStorage();
  const store = createDraftStore({ getStorage: () => storage, userId: 'u' });
  store.save('a', record('1')); store.save('b', record('2'));
  store.clear('a');
  assert.equal(store.load('a'), null);
  assert.equal(store.load('b').request_id, '2');
});

test('STORAGE UNAVAILABLE: a throwing storage accessor never throws and save reports false', () => {
  const store = createDraftStore({ getStorage: () => { throw new Error('SecurityError'); }, userId: 'u' });
  assert.equal(store.save('c', record()), false);
  assert.equal(store.load('c'), null);
  assert.equal(store.findPending(), null);
  assert.doesNotThrow(() => store.clear('c'));
});

test('STORAGE UNAVAILABLE: missing storage (null) and a full/blocked setItem report false and stay quiet', () => {
  assert.equal(createDraftStore({ getStorage: () => null, userId: 'u' }).save('c', record()), false);
  const blocked = createDraftStore({ getStorage: () => fakeStorage({ failSet: true }), userId: 'u' });
  assert.equal(blocked.save('c', record()), false);
  assert.equal(blocked.load('c'), null);
});

test('corrupt or foreign values are ignored', () => {
  const storage = fakeStorage();
  const store = createDraftStore({ getStorage: () => storage, userId: 'u' });
  storage.setItem('cvf_series_pending:u:c1', '{not json');
  storage.setItem('cvf_series_pending:u:c2', JSON.stringify({ request_id: 5, body: 'x' }));
  storage.setItem('cvf_series_pending:u:c3', JSON.stringify({ request_id: 'ok', body: { a: 1 } }));
  assert.equal(store.load('c1'), null);
  assert.equal(store.load('c2'), null);
  assert.equal(store.findPending().clientId, 'c3');
});

test('newRequestId returns distinct UUIDs', () => {
  const a = newRequestId(); const b = newRequestId();
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.notEqual(a, b);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm run test:unit`
Expected: FAIL — cannot find module `seriesDraftStore.js`.

- [ ] **Step 3: Implement**

Create `frontend/src/lib/seriesDraftStore.js`:

```js
// Persists an in-flight recurring save ({ request_id, frozen body }) so closing or
// reloading the app after a timeout cannot lead to a second series: the next load
// finds the pending record and retries the SAME request id. Browser storage can be
// missing, blocked, or full (private windows, site data off), so every access is
// guarded and `save` reports whether it actually persisted.

const PREFIX = 'cvf_series_pending';

function defaultStorage() {
  return typeof window === 'undefined' ? null : window.localStorage;
}

export function newRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function parse(raw) {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && typeof value.request_id === 'string' && value.body && typeof value.body === 'object'
      ? value : null;
  } catch {
    return null;
  }
}

export function createDraftStore({ getStorage = defaultStorage, userId }) {
  const keyFor = (clientId) => `${PREFIX}:${userId}:${clientId}`;
  return {
    save(clientId, record) {
      try {
        const storage = getStorage();
        if (!storage) return false;
        storage.setItem(keyFor(clientId), JSON.stringify({ ...record, saved_at: Date.now() }));
        return true;
      } catch {
        return false;
      }
    },
    load(clientId) {
      try {
        const storage = getStorage();
        return storage ? parse(storage.getItem(keyFor(clientId))) : null;
      } catch {
        return null;
      }
    },
    findPending() {
      try {
        const storage = getStorage();
        if (!storage) return null;
        const prefix = `${PREFIX}:${userId}:`;
        for (let i = 0; i < storage.length; i += 1) {
          const key = storage.key(i);
          if (!key || !key.startsWith(prefix)) continue;
          const record = parse(storage.getItem(key));
          if (record) return { clientId: key.slice(prefix.length), record };
        }
        return null;
      } catch {
        return null;
      }
    },
    clear(clientId) {
      try {
        getStorage()?.removeItem(keyFor(clientId));
      } catch {
        // nothing to clear if storage is unavailable
      }
    },
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm run test:unit`
Expected: PASS (all files).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/seriesDraftStore.js frontend/tests/unit/seriesDraftStore.test.mjs
git commit -m "feat: persist pending series saves with a storage-unavailable fallback" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 20: Request lifecycle helpers (`seriesRequest.js`)

**Files:**
- Create: `frontend/src/lib/seriesRequest.js`
- Create: `frontend/tests/unit/seriesRequest.test.mjs`

**Interfaces:**
- Consumes: `sortRows` from `seriesPlan.js`.
- Produces:
  - `createSeqGuard(): { next(): number, isCurrent(seq): boolean }` — `next()` bumps and returns the sequence; anything older is stale. The composer calls `next()` on **every** selection change (even when it skips fetching) so a delayed response can never overwrite newer state.
  - `classifySaveOutcome(error): { kind: 'conflicts', conflicts } | { kind: 'mismatch' } | { kind: 'definitive', message } | { kind: 'unknown' }` — `unknown` = no response, timeout, or 5xx (the server may have committed).
  - `buildCheckBody({ clientId, durationMinutes, startDate, rows, seq })` and `buildCreateBody({ requestId, clientId, durationMinutes, location, rule, rows, mapping, programId, assignProgram, notify })` — selected rows only, chronological, `workout_id` from `mapping`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/unit/seriesRequest.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeqGuard, classifySaveOutcome, buildCheckBody, buildCreateBody } from '../../src/lib/seriesRequest.js';

test('seq guard: only the latest sequence is current', () => {
  const guard = createSeqGuard();
  const first = guard.next();
  assert.equal(guard.isCurrent(first), true);
  const second = guard.next();
  assert.equal(guard.isCurrent(first), false); // delayed response is stale
  assert.equal(guard.isCurrent(second), true);
});

const axiosError = (status, data) => ({ response: { status, data } });

test('classifySaveOutcome: no response, timeout, and 5xx are UNKNOWN (the server may have committed)', () => {
  assert.deepEqual(classifySaveOutcome(new Error('Network Error')), { kind: 'unknown' });
  assert.deepEqual(classifySaveOutcome({ code: 'ECONNABORTED' }), { kind: 'unknown' });
  for (const status of [500, 502, 503, 504]) assert.deepEqual(classifySaveOutcome(axiosError(status, {})), { kind: 'unknown' });
});

test('classifySaveOutcome: definitive client errors, conflicts, and mismatch', () => {
  assert.deepEqual(classifySaveOutcome(axiosError(400, { error: 'Bad dates' })), { kind: 'definitive', message: 'Bad dates' });
  assert.deepEqual(classifySaveOutcome(axiosError(404, {})), { kind: 'definitive', message: 'Could not save the series' });
  const conflicts = [{ key: 'g1', scope: 'coach' }];
  assert.deepEqual(classifySaveOutcome(axiosError(409, { conflicts })), { kind: 'conflicts', conflicts });
  assert.deepEqual(classifySaveOutcome(axiosError(409, { code: 'request_mismatch' })), { kind: 'mismatch' });
});

const rows = [
  { key: 'b', date: '2031-06-05', time: '17:00', selected: true },
  { key: 'x', date: '2031-06-04', time: '17:00', selected: false },
  { key: 'a', date: '2031-06-03', time: '17:00', selected: true },
];

test('buildCheckBody sends only the selected rows, chronologically, with seq and start_date', () => {
  const body = buildCheckBody({ clientId: 'c', durationMinutes: 60, startDate: '2031-06-03', rows, seq: 4 });
  assert.deepEqual(body, {
    client_id: 'c', duration_minutes: 60, start_date: '2031-06-03', seq: 4,
    slots: [{ key: 'a', date: '2031-06-03', time: '17:00' }, { key: 'b', date: '2031-06-05', time: '17:00' }],
  });
});

test('buildCreateBody applies the final mapping, null-safe, and only assigns when a program is chosen', () => {
  const rule = { start_date: '2031-06-03', time: '17:00', weekdays: [2, 4], interval_weeks: 1, end: { count: 2 } };
  const body = buildCreateBody({
    requestId: 'req', clientId: 'c', durationMinutes: 60, location: '', rule, rows,
    mapping: { a: 'w1' }, programId: '', assignProgram: true, notify: false,
  });
  assert.equal(body.request_id, 'req');
  assert.equal(body.location, null);
  assert.deepEqual(body.slots, [
    { key: 'a', date: '2031-06-03', time: '17:00', workout_id: 'w1' },
    { key: 'b', date: '2031-06-05', time: '17:00', workout_id: null },
  ]);
  assert.equal(body.program_id, null);
  assert.equal(body.assign_program, false); // no program -> never assign
  assert.equal(body.notify, false);
  assert.deepEqual(body.rule, rule);
  const withProgram = buildCreateBody({ requestId: 'r', clientId: 'c', durationMinutes: 60, location: 'Studio', rule, rows, mapping: {}, programId: 'p', assignProgram: true, notify: true });
  assert.equal(withProgram.program_id, 'p');
  assert.equal(withProgram.assign_program, true);
});
```

- [ ] **Step 2: Run to verify it fails** — `cd frontend && npm run test:unit` → FAIL (module missing).

- [ ] **Step 3: Implement**

Create `frontend/src/lib/seriesRequest.js`:

```js
import { sortRows } from './seriesPlan.js';

export function createSeqGuard() {
  let latest = 0;
  return {
    next() { latest += 1; return latest; },
    isCurrent(seq) { return seq === latest; },
  };
}

// What a failed save means for the request id:
//  - unknown     : no response / timeout / 5xx. The server may have committed. Freeze the
//                  form and retry the SAME request until a definitive answer arrives.
//  - conflicts   : 409 with conflicts. Nothing was written; the coach edits and saves again.
//  - mismatch    : 409 request_mismatch. Surface it; never auto-retry under a new id.
//  - definitive  : any other 4xx. Nothing was written.
export function classifySaveOutcome(error) {
  const response = error?.response;
  if (!response) return { kind: 'unknown' };
  const { status, data } = response;
  if (status === 409 && data?.code === 'request_mismatch') return { kind: 'mismatch' };
  if (status === 409 && Array.isArray(data?.conflicts)) return { kind: 'conflicts', conflicts: data.conflicts };
  if (status >= 500) return { kind: 'unknown' };
  return { kind: 'definitive', message: data?.error || 'Could not save the series' };
}

const selectedSorted = (rows) => sortRows(rows).filter((row) => row.selected);

export function buildCheckBody({ clientId, durationMinutes, startDate, rows, seq }) {
  return {
    client_id: clientId,
    duration_minutes: durationMinutes,
    start_date: startDate,
    seq,
    slots: selectedSorted(rows).map(({ key, date, time }) => ({ key, date, time })),
  };
}

export function buildCreateBody({
  requestId, clientId, durationMinutes, location, rule, rows, mapping, programId, assignProgram, notify,
}) {
  return {
    request_id: requestId,
    client_id: clientId,
    duration_minutes: durationMinutes,
    location: location || null,
    rule,
    slots: selectedSorted(rows).map((row) => ({ key: row.key, date: row.date, time: row.time, workout_id: mapping?.[row.key] ?? null })),
    program_id: programId || null,
    assign_program: Boolean(programId) && Boolean(assignProgram),
    notify: Boolean(notify),
  };
}
```

- [ ] **Step 4: Run to verify it passes** — `cd frontend && npm run test:unit` → PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/seriesRequest.js frontend/tests/unit/seriesRequest.test.mjs
git commit -m "feat: series request lifecycle helpers (outcome classifier, seq guard, bodies)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 21: Series badge and the shared cancel dialog

**Files:**
- Create: `frontend/src/components/series/SeriesBadge.jsx`
- Create: `frontend/src/components/series/CancelSessionDialog.jsx`
- Modify: `frontend/src/pages/coach/Sessions.jsx`
- Modify: `frontend/src/pages/coach/SessionDetail.jsx`

**Interfaces:**
- Produces: `<SeriesBadge session={...} className? />` (renders `null` unless `session.series` and `session.series_ordinal`; `data-testid="series-badge"`); `<CancelSessionDialog session open onOpenChange futureCount? busy? onConfirm={({ scope: 'one'|'future', notify: boolean }) => void} />` with test ids `session-cancel-dialog`, `session-cancel-keep`, `session-cancel-confirm` (unchanged), plus `session-cancel-scope-one`, `session-cancel-scope-future`, `session-cancel-notify`.
- Consumes: `badgeLabel` (Task 18); the `series`/`series_ordinal` fields from Task 17; `PATCH /sessions/:id/cancel {notify}` (Task 12); `PATCH /sessions/series/:seriesId/cancel {from_session_id, notify}` (Task 16).

- [ ] **Step 1: Create the badge**

Create `frontend/src/components/series/SeriesBadge.jsx`:

```jsx
import { Repeat } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { badgeLabel } from '@/lib/seriesPlan';

export function SeriesBadge({ session, className = '' }) {
  if (!session?.series || !session.series_ordinal) return null;
  return (
    <Badge variant="outline" className={`gap-1 text-[10px] font-medium text-muted-foreground ${className}`} data-testid="series-badge">
      <Repeat className="h-3 w-3" aria-hidden />
      {badgeLabel(session.series, session.series_ordinal)}
    </Badge>
  );
}
```

- [ ] **Step 2: Create the shared cancel dialog**

Create `frontend/src/components/series/CancelSessionDialog.jsx`:

```jsx
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { fmtDateTime } from '@/lib/format';

// One cancel dialog for the Sessions list and the session detail page. Series
// sessions choose "just this one" or "this and all future"; every session can opt
// out of the client notification (default on).
export function CancelSessionDialog({ session, open, onOpenChange, futureCount, busy = false, onConfirm }) {
  const [scope, setScope] = useState('one');
  const [notify, setNotify] = useState(true);
  useEffect(() => { if (open) { setScope('one'); setNotify(true); } }, [open, session?.id]);
  const inSeries = Boolean(session?.series_id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" data-testid="session-cancel-dialog">
        <DialogHeader>
          <DialogTitle>{scope === 'future' ? 'Cancel these sessions?' : 'Cancel this session?'}</DialogTitle>
          <DialogDescription>
            {session && `${session.client?.name} — ${fmtDateTime(session.scheduled_at)}.`}
          </DialogDescription>
        </DialogHeader>
        {inSeries && (
          <RadioGroup value={scope} onValueChange={setScope} className="gap-3" aria-label="What to cancel">
            <div className="flex items-center gap-2">
              <RadioGroupItem value="one" id="cancel-scope-one" data-testid="session-cancel-scope-one" />
              <Label htmlFor="cancel-scope-one">Just this one</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="future" id="cancel-scope-future" data-testid="session-cancel-scope-future" />
              <Label htmlFor="cancel-scope-future">
                This and all future{typeof futureCount === 'number' ? ` (${futureCount})` : ''}
              </Label>
            </div>
          </RadioGroup>
        )}
        <div className="flex items-center gap-2">
          <Checkbox id="cancel-notify" checked={notify} onCheckedChange={(checked) => setNotify(checked === true)} data-testid="session-cancel-notify" />
          <Label htmlFor="cancel-notify">Notify the client</Label>
        </div>
        <DialogFooter>
          <Button variant="outline" className="min-h-11 rounded-xl" onClick={() => onOpenChange(false)} data-testid="session-cancel-keep">
            Keep {scope === 'future' ? 'sessions' : 'session'}
          </Button>
          <Button
            variant="ghost"
            className="min-h-11 rounded-xl border border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={busy}
            onClick={() => onConfirm({ scope, notify })}
            data-testid="session-cancel-confirm"
          >
            {scope === 'future' ? 'Cancel sessions' : 'Cancel session'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Wire the Sessions list**

In `frontend/src/pages/coach/Sessions.jsx`:

1. Add imports next to the existing component imports:
```jsx
import { SeriesBadge } from '@/components/series/SeriesBadge';
import { CancelSessionDialog } from '@/components/series/CancelSessionDialog';
```
2. Replace the `cancel` function (currently `const cancel = async (s) => { … }`) with:
```jsx
  const cancel = async (s, { scope = 'one', notify = true } = {}) => {
    if (acting) return;
    setActing(s.id);
    try {
      if (scope === 'future' && s.series_id) {
        const { data } = await api.patch(`/sessions/series/${s.series_id}/cancel`, { from_session_id: s.id, notify });
        const count = data.cancelled.length;
        toast.success(count === 1 ? 'Session cancelled' : `${count} sessions cancelled`);
      } else {
        await api.patch(`/sessions/${s.id}/cancel`, { notify });
        toast.success('Session cancelled');
      }
      await load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setActing(null);
    }
  };
```
3. Add the badge in the session row, directly under the location/workout line (inside the `<div className="min-w-0">` block, after the `<p className="text-xs text-muted-foreground truncate">…</p>`):
```jsx
                      <SeriesBadge session={s} className="mt-1" />
```
4. Replace the whole `<Dialog open={Boolean(cancelFor)} …> … </Dialog>` block (the existing cancel confirmation) with:
```jsx
      <CancelSessionDialog
        session={cancelFor}
        open={Boolean(cancelFor)}
        onOpenChange={(open) => !open && setCancelFor(null)}
        busy={Boolean(acting)}
        futureCount={cancelFor?.series_id
          ? (sessions || []).filter((item) => item.series_id === cancelFor.series_id && item.status === 'scheduled' && item.scheduled_at >= cancelFor.scheduled_at).length
          : undefined}
        onConfirm={async (options) => { const target = cancelFor; setCancelFor(null); await cancel(target, options); }}
      />
```
5. Remove the now-unused `Dialog*` import line **only if** nothing else in the file uses it (`grep -n "<Dialog" frontend/src/pages/coach/Sessions.jsx`).

- [ ] **Step 4: Wire the session detail page**

In `frontend/src/pages/coach/SessionDetail.jsx`:

1. Add imports:
```jsx
import { SeriesBadge } from '@/components/series/SeriesBadge';
import { CancelSessionDialog } from '@/components/series/CancelSessionDialog';
```
2. Replace the `confirmingCancel` state and `cancel` function. Delete `const [confirmingCancel, setConfirmingCancel] = useState(false);` and `setConfirmingCancel(false);` inside `act`'s `finally`, add `const [cancelOpen, setCancelOpen] = useState(false);`, and replace
```jsx
  const cancel = () => {
    if (!confirmingCancel) { setConfirmingCancel(true); return; }
    act(() => api.patch(`/sessions/${session.id}/cancel`), 'Session cancelled');
  };
```
with:
```jsx
  const confirmCancel = ({ scope, notify }) => {
    setCancelOpen(false);
    if (scope === 'future' && session.series_id) {
      act(() => api.patch(`/sessions/series/${session.series_id}/cancel`, { from_session_id: session.id, notify }), 'Sessions cancelled');
    } else {
      act(() => api.patch(`/sessions/${session.id}/cancel`, { notify }), 'Session cancelled');
    }
  };
```
3. Replace the Cancel button's props: remove the `confirmingCancel` conditional class and label so it reads
```jsx
              <Button
                variant="ghost"
                className="min-h-11 rounded-xl text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                disabled={acting}
                onClick={() => setCancelOpen(true)}
                data-testid="session-detail-cancel"
              >
                <X className="mr-1.5 h-4 w-4" /> Cancel
              </Button>
```
4. Add, at the end of the returned JSX (next to the existing `SessionEditorDrawer`):
```jsx
      <CancelSessionDialog session={session} open={cancelOpen} onOpenChange={setCancelOpen} busy={acting} onConfirm={confirmCancel} />
```
5. Show the badge under the heading: after the `<h1 …>…</h1>` block in the card, add `<SeriesBadge session={session} className="mt-2" />`.

- [ ] **Step 5: Build and run the existing preview browser suite for regressions**

```bash
cd frontend && npm run build
npm run test:e2e:preview
```
Expected: build succeeds; the preview suite passes (the cancel dialog keeps its test ids; `session-detail-cancel` is not referenced by any spec). If the build reports an unused import, remove it.

- [ ] **Step 6: Commit (functional)**

```bash
git add frontend/src/components/series/SeriesBadge.jsx frontend/src/components/series/CancelSessionDialog.jsx frontend/src/pages/coach/Sessions.jsx frontend/src/pages/coach/SessionDetail.jsx
git commit -m "feat: series badge and cancel dialog with this-and-future and notify controls" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 22: Recurrence panel, preview list, and the composer

**Files:**
- Create: `frontend/src/components/series/RecurrencePanel.jsx`
- Create: `frontend/src/components/series/SeriesPreviewList.jsx`
- Create: `frontend/src/components/series/SeriesComposer.jsx`

**Interfaces:**
- Consumes: `api`, `errMsg` (`@/lib/api`); `useAuth` (`@/context/AuthContext`, `user.profile.id`); the Task 18–20 libs; `DateTimePicker` (value/onChange speak `YYYY-MM-DDTHH:mm`); `GET /programs` (`days[].{day_number, workout}`, `active_assignments[].client.id`), `GET /programs/workouts`.
- Produces: `<SeriesComposer clientId startAt durationMinutes location resumeRecord? onBusyChange(busy:boolean) onDone(result) />` where `startAt` is the drawer's `YYYY-MM-DDTHH:mm` (its date/time are the first occurrence's date and time) and `resumeRecord` is a restored `{ request_id, body }`. Test ids used by the browser tests: `series-composer`, `series-weekday-<0-6>`, `series-interval-select`, `series-end-mode-select`, `series-count-input`, `series-until-input`, `series-program-select`, `series-starting-day-select`, `series-assign-checkbox`, `series-notify-checkbox`, `series-preview-button`, `series-edit-rule`, `series-check-retry`, `series-check-failed`, `series-start-changed`, `series-regenerate-note`, `series-back-to-dates`, `series-row-<key>` (with `data-conflict`), `series-row-select-<key>`, `series-row-datetime-<key>`, `series-row-workout-<key>`, `series-suggestion-<key>-<HH:mm>`, `series-summary`, `series-add-date`, `series-create-button`, `series-unknown`, `series-retry-button`, `series-check-button`, `series-storage-warning`, `series-error`.

This task has no unit test of its own (the logic it uses is covered by Tasks 18–20; the behavior is covered by the browser tests in Task 24). Verify it compiles with `npm run build`.

- [ ] **Step 1: Create the recurrence form**

Create `frontend/src/components/series/RecurrencePanel.jsx`:

```jsx
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { WEEKDAY_SHORT } from '@/lib/seriesPlan';

const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first

// Controlled form for the repeat rule, program mapping, and notification choices.
// `config` shape: { weekdays, intervalWeeks, endMode, count, until, programId,
//                   startingDay, assignProgram, notify }
export function RecurrencePanel({ config, onChange, programs, selectedProgram, needsAssign, disabled }) {
  const toggleDay = (day) => {
    const next = config.weekdays.includes(day) ? config.weekdays.filter((d) => d !== day) : [...config.weekdays, day];
    onChange({ weekdays: next });
  };
  return (
    <div className="space-y-4" data-testid="series-recurrence-panel">
      <div className="space-y-1.5">
        <Label>Repeat on</Label>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Weekdays">
          {DISPLAY_ORDER.map((day) => (
            <button
              key={day}
              type="button"
              disabled={disabled}
              aria-pressed={config.weekdays.includes(day)}
              onClick={() => toggleDay(day)}
              data-testid={`series-weekday-${day}`}
              className={`min-h-11 min-w-11 rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${config.weekdays.includes(day) ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}
            >
              {WEEKDAY_SHORT[day]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Every</Label>
          <Select value={String(config.intervalWeeks)} onValueChange={(v) => onChange({ intervalWeeks: Number(v) })} disabled={disabled}>
            <SelectTrigger className="rounded-xl h-11" data-testid="series-interval-select"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1">week</SelectItem>
              <SelectItem value="2">2 weeks</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Ends</Label>
          <Select value={config.endMode} onValueChange={(v) => onChange({ endMode: v })} disabled={disabled}>
            <SelectTrigger className="rounded-xl h-11" data-testid="series-end-mode-select"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="count">After N sessions</SelectItem>
              <SelectItem value="until">On a date</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {config.endMode === 'count' ? (
        <div className="space-y-1.5">
          <Label htmlFor="series-count">Number of sessions (max 52)</Label>
          <Input id="series-count" type="number" inputMode="numeric" min={1} max={52} value={config.count}
            onChange={(e) => onChange({ count: e.target.value })} disabled={disabled} className="rounded-xl h-11" data-testid="series-count-input" />
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="series-until">Last day</Label>
          <Input id="series-until" type="date" value={config.until} onChange={(e) => onChange({ until: e.target.value })}
            disabled={disabled} className="rounded-xl h-11" data-testid="series-until-input" />
        </div>
      )}

      <div className="space-y-1.5">
        <Label>Program (optional)</Label>
        <Select value={config.programId || 'none'} onValueChange={(v) => onChange({ programId: v === 'none' ? '' : v, startingDay: 1 })} disabled={disabled}>
          <SelectTrigger className="rounded-xl h-11" data-testid="series-program-select"><SelectValue placeholder="No program" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No program</SelectItem>
            {programs.map((program) => <SelectItem key={program.id} value={program.id}>{program.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {selectedProgram && (
        <>
          <div className="space-y-1.5">
            <Label>Starting day</Label>
            <Select value={String(config.startingDay)} onValueChange={(v) => onChange({ startingDay: Number(v) })} disabled={disabled}>
              <SelectTrigger className="rounded-xl h-11" data-testid="series-starting-day-select"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(selectedProgram.days || []).map((day) => (
                  <SelectItem key={day.day_number} value={String(day.day_number)}>
                    Day {day.day_number}{day.workout?.name ? ` · ${day.workout.name}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Workouts attach to sessions in day order. You can change any of them below.</p>
          </div>
          {needsAssign && (
            <div className="flex items-center gap-2">
              <Checkbox id="series-assign" checked={config.assignProgram} disabled={disabled}
                onCheckedChange={(checked) => onChange({ assignProgram: checked === true })} data-testid="series-assign-checkbox" />
              <Label htmlFor="series-assign">Also assign this program to the client</Label>
            </div>
          )}
        </>
      )}

      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Checkbox id="series-notify" checked={config.notify} disabled={disabled}
            onCheckedChange={(checked) => onChange({ notify: checked === true })} data-testid="series-notify-checkbox" />
          <Label htmlFor="series-notify">Notify client when saved</Label>
        </div>
        <p className="pl-6 text-xs text-muted-foreground">One summary message. Unticked, nothing is sent now; normal reminders still apply.</p>
      </div>
      <p className="text-xs text-muted-foreground">All times are Mountain Time (Albuquerque).</p>
    </div>
  );
}
```

- [ ] **Step 2: Create the preview list**

Create `frontend/src/components/series/SeriesPreviewList.jsx`:

```jsx
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import DateTimePicker from '@/components/DateTimePicker';
import { sortRows } from '@/lib/seriesPlan';

function conflictMessage(conflict) {
  if (conflict.scope === 'client') return 'This client is already booked then';
  if (conflict.scope === 'batch') return 'Overlaps another date in this series';
  return 'You already have a session then';
}

export function SeriesPreviewList({
  rows, workouts, mapping, summary, disabled, hasProgram,
  onToggle, onEditDateTime, onPickSuggestion, onPickWorkout, onAddDate,
}) {
  return (
    <div className="space-y-3" data-testid="series-preview">
      <p className="text-sm font-medium" data-testid="series-summary">
        {summary.selected} of {summary.total} selected{summary.lastDate ? ` · last on ${summary.lastDate}` : ''}
      </p>
      <ul className="space-y-2">
        {sortRows(rows).map((row) => {
          const conflict = row.selected ? row.conflict : null;
          return (
            <li
              key={row.key}
              data-testid={`series-row-${row.key}`}
              data-conflict={conflict ? conflict.scope : 'none'}
              className={`rounded-xl border px-3 py-2.5 ${conflict ? 'border-destructive/40 bg-destructive/10' : 'border-border bg-card/60'} ${row.selected ? '' : 'opacity-60'}`}
            >
              <div className="flex items-center gap-2">
                <Checkbox checked={row.selected} disabled={disabled} onCheckedChange={() => onToggle(row.key)}
                  aria-label={`Include ${row.date} ${row.time}`} data-testid={`series-row-select-${row.key}`} />
                <div className="min-w-0 flex-1">
                  <DateTimePicker
                    value={`${row.date}T${row.time}`}
                    onChange={(value) => { if (value) onEditDateTime(row.key, { date: value.slice(0, 10), time: value.slice(11, 16) }); }}
                    disabled={disabled}
                    data-testid={`series-row-datetime-${row.key}`}
                  />
                </div>
              </div>
              {hasProgram || row.selected ? (
                <div className="mt-2 pl-6">
                  <Select
                    value={mapping[row.key] || 'none'}
                    onValueChange={(value) => onPickWorkout(row.key, value === 'none' ? null : value)}
                    disabled={disabled || !row.selected}
                  >
                    <SelectTrigger className="h-9 rounded-lg text-xs" data-testid={`series-row-workout-${row.key}`}><SelectValue placeholder="No workout" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No workout attached</SelectItem>
                      {workouts.map((workout) => <SelectItem key={workout.id} value={workout.id}>{workout.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              {conflict && (
                <div className="mt-2 pl-6 text-sm" role="alert">
                  <p className="font-medium">{conflictMessage(conflict)}</p>
                  {conflict.display && conflict.scope !== 'batch' && <p className="text-xs text-muted-foreground">{conflict.display}</p>}
                  {(row.suggestions || []).length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Suggested times">
                      {row.suggestions.map((suggestion) => (
                        <Button key={suggestion.time} type="button" size="sm" variant="outline" className="min-h-9 rounded-full text-xs" disabled={disabled}
                          onClick={() => onPickSuggestion(row.key, suggestion)} data-testid={`series-suggestion-${row.key}-${suggestion.time}`}>
                          {suggestion.display}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <Button type="button" variant="outline" className="min-h-11 rounded-xl" disabled={disabled} onClick={onAddDate} data-testid="series-add-date">
        <Plus className="mr-1.5 h-4 w-4" /> Add a date
      </Button>
    </div>
  );
}
```

- [ ] **Step 3: Create the composer**

Create `frontend/src/components/series/SeriesComposer.jsx`:

```jsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, errMsg } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { RecurrencePanel } from '@/components/series/RecurrencePanel';
import { SeriesPreviewList } from '@/components/series/SeriesPreviewList';
import { createDraftStore, newRequestId } from '@/lib/seriesDraftStore';
import { classifySaveOutcome, buildCheckBody, buildCreateBody, createSeqGuard } from '@/lib/seriesRequest';
import {
  assignDefault, configFromBody, mapWorkouts, pinsFromBody, rowsFromBody, shiftDate, sortRows, summarizeSelection, weekdayOfDate,
} from '@/lib/seriesPlan';

const signatureOf = (rows, durationMinutes) => JSON.stringify([
  durationMinutes,
  sortRows(rows).filter((row) => row.selected).map((row) => [row.key, row.date, row.time]),
]);

// Stages: configure -> review -> saving -> done, with two special stages:
//   unknown  : the save outcome is not known (timeout / 5xx / restored after a reload).
//              The body and request id are FROZEN; the only actions are Retry and Check,
//              both of which resend the identical request until a definitive answer arrives.
//   mismatch : the server says this request id was used with different content.
//
// Identity: the parent keys this component by CLIENT only, so ordinary edits to duration or
// location (props) never reset the draft. Duration is part of the check signature, so changing
// it re-checks the whole selection. Changing the first session's date/time sends the coach back
// to the repeat settings (the rows came from a rule that no longer matches) without discarding them.
export function SeriesComposer({
  clientId, startAt, durationMinutes, location, resumeRecord = null, onBusyChange, onDone,
}) {
  const { user } = useAuth();
  const userId = user?.profile?.id || user?.email || 'anonymous';
  const store = useMemo(() => createDraftStore({ userId }), [userId]);
  const startDate = startAt.slice(0, 10);
  const startTime = startAt.slice(11, 16);

  const [config, setConfig] = useState({
    weekdays: [weekdayOfDate(startDate)], intervalWeeks: 1, endMode: 'count', count: 12, until: '',
    programId: '', startingDay: 1, assignProgram: true, notify: true,
  });
  const [stage, setStage] = useState(resumeRecord ? 'unknown' : 'configure');
  const [rows, setRows] = useState([]);
  const [pins, setPins] = useState({});
  const [ruleUsed, setRuleUsed] = useState(null); // the rule the current rows were generated from (display copy)
  const [programs, setPrograms] = useState([]);
  const [workouts, setWorkouts] = useState([]);
  const [checking, setChecking] = useState(false);
  const [checkedSignature, setCheckedSignature] = useState(null); // the selection the server last checked
  const [checkFailed, setCheckFailed] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const [startChanged, setStartChanged] = useState(false);
  const [error, setError] = useState('');
  const [storageOk, setStorageOk] = useState(true);

  // One request id per draft; never regenerated automatically.
  const requestIdRef = useRef(resumeRecord?.request_id || newRequestId());
  const frozenBodyRef = useRef(resumeRecord?.body || null);
  const draftRef = useRef(resumeRecord?.draft || null); // editor snapshot taken at the moment of saving
  const guard = useRef(createSeqGuard()).current;
  const lastChecked = useRef(null);
  const prevStartAt = useRef(startAt);
  const addedCounter = useRef(0);

  const markChecked = (signature) => { lastChecked.current = signature; setCheckedSignature(signature); };

  useEffect(() => {
    api.get('/programs').then(({ data }) => setPrograms(data || [])).catch(() => setPrograms([]));
    api.get('/programs/workouts').then(({ data }) => setWorkouts(data || [])).catch(() => setWorkouts([]));
  }, []);

  // A pending save for this client (reload, or the drawer was closed mid-save) is restored, not replaced.
  useEffect(() => {
    if (resumeRecord) return;
    const pending = store.load(clientId);
    if (pending) {
      requestIdRef.current = pending.request_id;
      frozenBodyRef.current = pending.body;
      draftRef.current = pending.draft || null;
      setStage('unknown');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  useEffect(() => { onBusyChange?.(stage === 'saving' || stage === 'unknown'); }, [stage, onBusyChange]);

  // The first session moved: the rows were generated from a rule that no longer matches.
  useEffect(() => {
    if (prevStartAt.current === startAt) return;
    prevStartAt.current = startAt;
    if (rows.length && (stage === 'review' || stage === 'configure')) { setStage('configure'); setStartChanged(true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startAt]);

  const selectedProgram = programs.find((program) => program.id === config.programId) || null;
  // `needsAssign` only decides whether the checkbox is offered and sent. The checkbox's VALUE is the
  // coach's choice: its default is applied when a program is explicitly chosen (chooseConfig below),
  // never as a reaction to program metadata loading or to a restored draft.
  const needsAssign = Boolean(selectedProgram) && !(selectedProgram.active_assignments || []).some((a) => a.client?.id === clientId);

  const programDays = useMemo(
    () => (selectedProgram?.days || []).map((day) => ({ day_number: day.day_number, workout_id: day.workout?.id || day.workout_id || null })),
    [selectedProgram],
  );
  const mapping = useMemo(
    () => mapWorkouts({ rows, programDays, startingDay: config.startingDay, pins }),
    [rows, programDays, config.startingDay, pins],
  );
  const summary = useMemo(() => summarizeSelection(rows), [rows]);
  const signature = useMemo(() => signatureOf(rows, durationMinutes), [rows, durationMinutes]);
  const anyConflict = rows.some((row) => row.selected && row.conflict);
  const frozen = stage === 'saving' || stage === 'unknown' || stage === 'done';

  const patchConfig = (patch) => setConfig((current) => ({ ...current, ...patch }));
  // Choosing a program is the one moment the "assign" default is applied.
  const chooseConfig = (patch) => {
    if (Object.hasOwn(patch, 'programId')) {
      const chosen = programs.find((program) => program.id === patch.programId) || null;
      patchConfig({ ...patch, assignProgram: assignDefault(chosen, clientId) });
    } else {
      patchConfig(patch);
    }
  };
  const updateRow = (key, patch) => setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const slotToRow = (slot) => ({
    key: slot.key, date: slot.date, time: slot.time, selected: true, conflict: slot.conflict, suggestions: slot.suggestions || [], display: slot.display,
  });

  const currentRule = () => ({
    start_date: startDate, time: startTime, weekdays: config.weekdays, interval_weeks: config.intervalWeeks,
    end: config.endMode === 'count' ? { count: Number(config.count) } : { until: config.until },
  });

  // Previewing REGENERATES the dates; the existing draft is replaced only when the new preview succeeds.
  const preview = async () => {
    setError('');
    setChecking(true);
    try {
      const rule = currentRule();
      const { data } = await api.post('/sessions/series/preview', {
        client_id: clientId, start_date: rule.start_date, time: rule.time, duration_minutes: durationMinutes,
        weekdays: rule.weekdays, interval_weeks: rule.interval_weeks, end: rule.end, location: location || null,
      });
      const next = data.slots.map(slotToRow);
      setRuleUsed(rule);
      setRows(next);
      setPins({});
      setStartChanged(false);
      markChecked(signatureOf(next, durationMinutes));
      setStage('review');
    } catch (e) {
      setError(errMsg(e, 'Could not preview the dates'));
    } finally {
      setChecking(false);
    }
  };

  // Re-check the WHOLE selection whenever a date, time, duration, or selection changes.
  // Every change bumps the sequence (even when the fetch is skipped) so a delayed response can
  // never overwrite newer state, and Create stays disabled until the CURRENT selection has been
  // checked (checkedSignature === signature) — including the debounce gap before the request starts.
  useEffect(() => {
    if (stage !== 'review' || !rows.length) return undefined;
    const seq = guard.next();
    if (lastChecked.current === signature) { setChecking(false); return undefined; }
    const timer = setTimeout(async () => {
      setChecking(true);
      try {
        const { data } = await api.post('/sessions/series/check', buildCheckBody({
          clientId, durationMinutes, startDate: ruleUsed?.start_date || startDate, rows, seq,
        }));
        if (!guard.isCurrent(data.seq)) return;
        setCheckFailed(false);
        setRows((current) => current.map((row) => {
          const result = data.slots.find((slot) => slot.key === row.key);
          return result ? { ...row, conflict: result.conflict, suggestions: result.suggestions || [], display: result.display } : row;
        }));
        markChecked(signature);
        setChecking(false);
      } catch {
        if (guard.isCurrent(seq)) { setCheckFailed(true); setChecking(false); }
      }
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, stage, retryTick]);

  const applyConflicts = (conflicts) => {
    markChecked(null); // force a fresh check (and suggestions) once the editor is back in review
    setRows((current) => current.map((row) => {
      const conflict = conflicts.find((item) => item.key === row.key);
      return conflict
        ? { ...row, conflict: { scope: conflict.scope, session: conflict.session, with_key: conflict.with_key, display: conflict.display }, suggestions: [] }
        : row;
    }));
  };

  // After a reload the composer only has the frozen request (and, for newer records, an editor
  // snapshot). When the retry ends in a DEFINITIVE answer the editor must be usable again:
  // restore the snapshot (configuration, every row incl. deselected ones, pins); for older
  // records fall back to rebuilding rows/pins/config from the submitted body.
  const restoreEditor = () => {
    if (rows.length) return; // the editor state is still live in this session
    const snapshot = draftRef.current;
    const body = frozenBodyRef.current;
    if (snapshot?.v === 1) {
      setConfig(snapshot.config);
      setRows(snapshot.rows);
      setPins(snapshot.pins || {});
      setRuleUsed(snapshot.ruleUsed || body?.rule || null);
    } else if (body) {
      setConfig(configFromBody(body));
      setRows(rowsFromBody(body));
      setPins(pinsFromBody(body));
      setRuleUsed(body.rule || null);
    }
    markChecked(null);
  };

  const send = async (body) => {
    setStage('saving');
    setError('');
    try {
      const { data } = await api.post('/sessions/series', body);
      store.clear(clientId);
      frozenBodyRef.current = null;
      draftRef.current = null;
      toast.success(data.replayed ? 'Recovered your saved series' : `${data.receipt.slots.length} sessions scheduled`);
      setStage('done');
      onDone?.(data);
    } catch (err) {
      const outcome = classifySaveOutcome(err);
      if (outcome.kind === 'unknown') { setStage('unknown'); return; } // keep the record; stay frozen
      store.clear(clientId);
      restoreEditor();
      frozenBodyRef.current = null;
      draftRef.current = null;
      if (outcome.kind === 'conflicts') {
        applyConflicts(outcome.conflicts);
        setStage('review');
        toast.error('Some dates are no longer available — pick new times or untick them');
      } else if (outcome.kind === 'mismatch') {
        setError('This save was already used with different content. Nothing was changed.');
        setStage('mismatch');
      } else {
        setError(outcome.message);
        setStage('review');
      }
    }
  };

  const create = () => {
    const body = buildCreateBody({
      requestId: requestIdRef.current, clientId, durationMinutes, location, rule: ruleUsed || currentRule(), rows, mapping,
      programId: config.programId, assignProgram: needsAssign && config.assignProgram, notify: config.notify,
    });
    frozenBodyRef.current = body;
    draftRef.current = { v: 1, config, rows, pins, ruleUsed: ruleUsed || currentRule() };
    // Persist BEFORE the first POST so a reload after a timeout can still recover it.
    setStorageOk(store.save(clientId, { request_id: requestIdRef.current, body, draft: draftRef.current, state: 'pending' }));
    send(body);
  };

  const retryFrozen = () => send(frozenBodyRef.current);

  const addDate = () => {
    const last = sortRows(rows).at(-1);
    addedCounter.current += 1;
    setRows((current) => [...current, {
      key: `a${addedCounter.current}-${Date.now().toString(36)}`, date: shiftDate(last?.date || startDate, 1), time: startTime,
      selected: true, conflict: null, suggestions: [],
    }]);
  };

  // ---- render ----
  const storageWarning = !storageOk && (
    <p className="text-xs text-muted-foreground" data-testid="series-storage-warning">
      This browser cannot remember an unfinished save, so closing or reloading before it finishes cannot be recovered automatically.
    </p>
  );

  if (stage === 'unknown' || (stage === 'saving' && frozenBodyRef.current)) {
    const body = frozenBodyRef.current;
    const first = body?.slots?.[0];
    return (
      <div className="space-y-3 rounded-xl border border-border bg-card/60 p-4" data-testid="series-composer" data-request-id={requestIdRef.current}>
        <div role="status" data-testid="series-unknown">
          <p className="font-medium">{stage === 'saving' ? 'Saving…' : 'Save status unknown'}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {body ? `${body.slots.length} session${body.slots.length === 1 ? '' : 's'}${first ? ` starting ${first.date} ${first.time}` : ''}.` : ''}
            {' '}We could not confirm whether this was saved. Retrying is safe — it will not create duplicates.
          </p>
        </div>
        {storageWarning}
        <div className="flex flex-wrap gap-2">
          <Button type="button" className="min-h-11 rounded-xl" disabled={stage === 'saving'} onClick={retryFrozen} data-testid="series-retry-button">
            {stage === 'saving' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Retry'}
          </Button>
          <Button type="button" variant="outline" className="min-h-11 rounded-xl" disabled={stage === 'saving'} onClick={retryFrozen} data-testid="series-check-button">
            Check whether it saved
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="series-composer" data-request-id={requestIdRef.current}>
      <RecurrencePanel
        config={config} onChange={chooseConfig} programs={programs.filter((p) => p.frequency_days)} selectedProgram={selectedProgram}
        needsAssign={needsAssign} disabled={frozen || stage === 'review' || stage === 'mismatch'}
      />
      {stage === 'configure' && (
        <>
          {startChanged && (
            <p className="rounded-xl border border-border px-3 py-2.5 text-sm" role="status" data-testid="series-start-changed">
              The first session changed. Preview again to regenerate the dates, or go back to keep your current dates.
            </p>
          )}
          {rows.length > 0 && !startChanged && (
            <p className="text-xs text-muted-foreground" data-testid="series-regenerate-note">
              Previewing again regenerates the dates: your edits, unticked dates and workout choices will be replaced.
            </p>
          )}
          {error && <p className="text-sm text-destructive" role="alert" data-testid="series-error">{error}</p>}
          <Button type="button" className="min-h-11 w-full rounded-xl font-semibold" disabled={checking || !config.weekdays.length || !clientId}
            onClick={preview} data-testid="series-preview-button">
            {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : rows.length ? 'Regenerate dates' : 'Preview dates'}
          </Button>
          {rows.length > 0 && (
            <Button type="button" variant="ghost" className="min-h-11 w-full rounded-xl text-muted-foreground" disabled={checking}
              onClick={() => { setStartChanged(false); setStage('review'); }} data-testid="series-back-to-dates">
              Back to dates (keep edits)
            </Button>
          )}
        </>
      )}
      {stage === 'mismatch' && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm" role="alert" data-testid="series-error">{error}</div>
      )}
      {(stage === 'review' || stage === 'mismatch') && (
        <>
          {stage === 'review' && (
            <Button type="button" variant="ghost" className="min-h-11 rounded-xl text-muted-foreground" disabled={frozen} onClick={() => setStage('configure')} data-testid="series-edit-rule">
              Change repeat settings
            </Button>
          )}
          <SeriesPreviewList
            rows={rows} workouts={workouts} mapping={mapping} summary={summary} hasProgram={Boolean(selectedProgram)} disabled={frozen || stage === 'mismatch'}
            onToggle={(key) => setRows((current) => current.map((row) => (row.key === key ? { ...row, selected: !row.selected } : row)))}
            onEditDateTime={(key, { date, time }) => updateRow(key, { date, time, conflict: null, suggestions: [] })}
            onPickSuggestion={(key, suggestion) => updateRow(key, { date: suggestion.date, time: suggestion.time, conflict: null, suggestions: [] })}
            onPickWorkout={(key, workoutId) => setPins((current) => ({ ...current, [key]: workoutId }))}
            onAddDate={addDate}
          />
          {checkFailed && (
            <p className="text-sm text-destructive" role="alert" data-testid="series-check-failed">
              Could not check these dates.{' '}
              <button type="button" className="underline" onClick={() => { markChecked(null); setCheckFailed(false); setRetryTick((tick) => tick + 1); }} data-testid="series-check-retry">Retry</button>
            </p>
          )}
          {error && stage === 'review' && <p className="text-sm text-destructive" role="alert" data-testid="series-error">{error}</p>}
          {storageWarning}
          <Button type="button" className="min-h-11 w-full rounded-xl font-semibold"
            disabled={checkedSignature !== signature || checking || checkFailed || anyConflict || summary.selected === 0 || stage === 'mismatch'}
            onClick={create} data-testid="series-create-button">
            {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : `Create ${summary.selected} session${summary.selected === 1 ? '' : 's'}`}
          </Button>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Build**

Run: `cd frontend && npm run build`
Expected: build succeeds. Fix any import/unused-variable errors; do not suppress real lint errors.

- [ ] **Step 5: Commit (functional)**

```bash
git add frontend/src/components/series/RecurrencePanel.jsx frontend/src/components/series/SeriesPreviewList.jsx frontend/src/components/series/SeriesComposer.jsx
git commit -m "feat: recurring-session composer with preview, conflict fixing, and frozen unknown-save state" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 23: Integrate the composer into the session editor and auto-resume pending saves

**Files:**
- Modify (full replacement): `frontend/src/components/SessionEditorDrawer.jsx`
- Modify: `frontend/src/pages/coach/Sessions.jsx` (auto-open the drawer when a pending save exists)

**Interfaces:**
- Consumes: `SeriesComposer` (Task 22), `createDraftStore` (Task 19), `useAuth`.
- The existing single-session behavior and every existing test id are unchanged. New test ids: `session-repeat-toggle`.

- [ ] **Step 1: Replace the drawer**

Replace the entire contents of `frontend/src/components/SessionEditorDrawer.jsx` with:

```jsx
// Coach session editor (create + edit), shared by the Sessions list and the
// coach session detail page. Create mode can also build a recurring series
// (see components/series/SeriesComposer).
import { useEffect, useMemo, useState } from 'react';
import { api, errMsg } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerFooter,
} from '@/components/ui/drawer';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import DateTimePicker from '@/components/DateTimePicker';
import { SeriesComposer } from '@/components/series/SeriesComposer';
import { createDraftStore } from '@/lib/seriesDraftStore';
import { fmtDateTime, toLocalInputValue } from '@/lib/format';
import { toast } from 'sonner';

const EMPTY_FORM = { client_id: '', scheduled_at: '', duration_minutes: '60', location: '', workout_id: 'none' };

export function SessionEditorDrawer({ open, onOpenChange, clients, editing, presetClient, onSaved }) {
  const { user } = useAuth();
  const userId = user?.profile?.id || user?.email || 'anonymous';
  const draftStore = useMemo(() => createDraftStore({ userId }), [userId]);

  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(null);
  // 011 B: optional planned-workout attachment, fetched once per drawer open.
  const [workouts, setWorkouts] = useState(null);
  // Recurring series (create mode only).
  const [repeat, setRepeat] = useState(false);
  const [resumeRecord, setResumeRecord] = useState(null);
  const [composerBusy, setComposerBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setConflict(null);
      setRepeat(false);
      setResumeRecord(null);
      if (editing) {
        setForm({
          client_id: editing.client_id,
          scheduled_at: toLocalInputValue(editing.scheduled_at),
          duration_minutes: String(editing.duration_minutes),
          location: editing.location || '',
          workout_id: editing.workout_id || 'none',
        });
      } else {
        // An unfinished recurring save (timeout, reload, or a closed drawer) is resumed, never replaced.
        const pending = draftStore.findPending();
        if (pending) {
          const { body } = pending.record;
          setForm({
            client_id: pending.clientId,
            scheduled_at: `${body.rule.start_date}T${body.rule.time}`,
            duration_minutes: String(body.duration_minutes),
            location: body.location || '',
            workout_id: 'none',
          });
          setResumeRecord(pending.record);
          setRepeat(true);
        } else {
          setForm({ ...EMPTY_FORM, client_id: presetClient || '' });
        }
      }
      if (workouts === null) {
        api.get('/programs/workouts')
          .then(({ data }) => setWorkouts(data))
          .catch(() => setWorkouts([]));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing, presetClient]);

  // A shown conflict is about a specific client + time + duration; changing
  // any of those restarts the attempt, so the panel clears.
  const setField = (patch) => {
    setForm((current) => ({ ...current, ...patch }));
    if (Object.keys(patch).some((key) => key !== 'location')) setConflict(null);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (repeat) return; // the composer owns saving in repeat mode
    if (!form.client_id || !form.scheduled_at) {
      toast.error('Client and date/time are required');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        client_id: form.client_id,
        scheduled_at: new Date(form.scheduled_at).toISOString(),
        duration_minutes: Number(form.duration_minutes),
        location: form.location,
        workout_id: form.workout_id === 'none' ? null : form.workout_id,
      };
      const { data } = editing
        ? await api.put(`/sessions/${editing.id}`, payload)
        : await api.post('/sessions', payload);
      // Location overlap is advisory only (S1): the session is saved either way.
      if (data?.location_overlaps > 0) {
        toast.warning(`Scheduled — heads up: ${data.location_overlaps} other session${data.location_overlaps === 1 ? '' : 's'} at ${form.location.trim()} in that window.`);
      } else {
        toast.success(editing ? 'Session updated' : 'Session scheduled');
      }
      onSaved();
    } catch (err) {
      const conflictData = err?.response?.status === 409 && err?.response?.data?.conflict;
      if (conflictData) {
        setConflict(err.response.data.conflict);
      } else {
        toast.error(errMsg(err));
      }
    } finally {
      setSaving(false);
    }
  };

  const locked = composerBusy; // client/date/duration are frozen while a series save is in flight or unresolved
  const seriesReady = repeat && form.client_id && form.scheduled_at;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent data-testid="session-editor-drawer">
        <div className="mx-auto w-full max-w-md px-4 pb-6">
          <DrawerHeader className="px-0">
            <DrawerTitle>{editing ? 'Edit session' : repeat ? 'New recurring sessions' : 'New session'}</DrawerTitle>
          </DrawerHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Client *</Label>
              <Select value={form.client_id} onValueChange={(v) => setField({ client_id: v })} disabled={Boolean(editing) || locked}>
                <SelectTrigger className="rounded-xl h-11" data-testid="session-client-select">
                  <SelectValue placeholder="Choose client..." />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{repeat ? 'First session *' : 'Date & time *'}</Label>
              <DateTimePicker
                value={form.scheduled_at}
                onChange={(scheduled_at) => setField({ scheduled_at })}
                disabled={locked}
                data-testid="session-datetime-input"
              />
              {conflict && (
                <div
                  className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm"
                  role="alert"
                  data-testid="session-conflict-panel"
                  data-conflict-scope={conflict.scope}
                >
                  <p className="font-medium">
                    {conflict.scope === 'client' ? 'This client is already booked then' : 'You already have a session then'}
                  </p>
                  {conflict.session?.scheduled_at && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {fmtDateTime(conflict.session.scheduled_at)} · {conflict.session.duration_minutes} min{conflict.session.location ? ` · ${conflict.session.location}` : ''}
                    </p>
                  )}
                  <p className="mt-0.5 text-xs text-muted-foreground">Pick a different time or duration.</p>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Duration</Label>
                <Select value={form.duration_minutes} onValueChange={(v) => setField({ duration_minutes: v })} disabled={locked}>
                  <SelectTrigger className="rounded-xl h-11" data-testid="session-duration-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {['30', '45', '60', '90'].map((d) => <SelectItem key={d} value={d}>{d} min</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Location</Label>
                <Input value={form.location} onChange={(e) => setField({ location: e.target.value })} disabled={locked} placeholder="CVF Studio" className="rounded-xl h-11" data-testid="session-location-input" />
              </div>
            </div>

            {!editing && (
              <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2.5">
                <Label htmlFor="session-repeat" className="font-medium">Repeat weekly</Label>
                <Switch id="session-repeat" checked={repeat} onCheckedChange={setRepeat} disabled={locked || Boolean(resumeRecord)} data-testid="session-repeat-toggle" />
              </div>
            )}

            {repeat ? (
              seriesReady ? (
                // Keyed by CLIENT only: duration, location and the first session's date/time are props, so
                // editing them never resets the reviewed draft (see SeriesComposer for how each is handled).
                <SeriesComposer
                  key={resumeRecord ? 'resume' : form.client_id}
                  clientId={form.client_id}
                  startAt={form.scheduled_at}
                  durationMinutes={Number(form.duration_minutes)}
                  location={form.location}
                  resumeRecord={resumeRecord}
                  onBusyChange={setComposerBusy}
                  onDone={() => { setRepeat(false); setResumeRecord(null); onSaved(); }}
                />
              ) : (
                <p className="text-sm text-muted-foreground">Choose a client and the first session&apos;s date and time to set up the repeat.</p>
              )
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label>Planned workout</Label>
                  <Select value={form.workout_id} onValueChange={(v) => setForm((current) => ({ ...current, workout_id: v }))}>
                    <SelectTrigger className="rounded-xl h-11" data-testid="session-workout-select">
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No workout attached</SelectItem>
                      {(workouts || []).map((workout) => (
                        <SelectItem key={workout.id} value={workout.id}>{workout.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">The client sees the plan on their session page.</p>
                </div>
                <DrawerFooter className="px-0">
                  <Button type="submit" disabled={saving} className="rounded-xl h-11 font-semibold" data-testid="session-save-button">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editing ? 'Save changes' : 'Schedule session'}
                  </Button>
                </DrawerFooter>
              </>
            )}
          </form>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
```

> `DateTimePicker` already accepts `disabled` and applies `data-testid` to its trigger and `<testid>-panel` to its popover (`frontend/src/components/DateTimePicker.jsx:53-98`), so no change to that file is needed.

- [ ] **Step 2: Auto-open the drawer when a pending save exists**

In `frontend/src/pages/coach/Sessions.jsx`:

1. Add `useRef` to the existing `react` import (`import { useEffect, useState, useCallback, useMemo, useRef } from 'react';`) and add:
```jsx
import { useAuth } from '@/context/AuthContext';
import { createDraftStore } from '@/lib/seriesDraftStore';
```
2. Inside `CoachSessions()`, after the existing `useEffect` that handles `?new=1`, add:
```jsx
  // A recurring save that never got a confirmed answer (timeout/reload) is surfaced
  // right away — once, as soon as the signed-in user is known — so the coach can
  // resolve it instead of forgetting it.
  const { user } = useAuth();
  const checkedForPending = useRef(false);
  useEffect(() => {
    if (checkedForPending.current) return;
    const userId = user?.profile?.id || user?.email;
    if (!userId) return;
    checkedForPending.current = true;
    if (createDraftStore({ userId }).findPending()) {
      setEditing(null);
      setDrawerOpen(true);
    }
  }, [user]);
```

- [ ] **Step 3: Build and run the existing preview browser suite**

```bash
cd frontend && npm run build && npm run test:e2e:preview
```
Expected: build succeeds; the 16 existing preview tests still pass (single-session create/edit paths and test ids are unchanged; in preview mode `useAuth().user.profile.id` exists via `getPreviewUser`). If `user` is `null` while loading, the `|| 'anonymous'` fallback keeps the store keyed consistently.

- [ ] **Step 4: Commit (functional)**

```bash
git add frontend/src/components/SessionEditorDrawer.jsx frontend/src/pages/coach/Sessions.jsx
git commit -m "feat: repeat-weekly mode in the session editor with automatic resume of unfinished saves" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Let the editor scroll on short screens (separate, layout-only commit)**

A 52-row preview makes the drawer taller than the viewport. In `frontend/src/components/SessionEditorDrawer.jsx` change the wrapper `<div className="mx-auto w-full max-w-md px-4 pb-6">` to `<div className="mx-auto max-h-[85vh] w-full max-w-md overflow-y-auto px-4 pb-6">`. Then run `cd frontend && npm run build` (expected: exit status 0), and look at the editor once at a phone width in the browser pane (`npm run dev`, resize to mobile) with a long preview to confirm the list scrolls inside the drawer and the Create button stays reachable.

```bash
git add frontend/src/components/SessionEditorDrawer.jsx
git commit -m "fix: let the session editor scroll when a long series preview exceeds the screen" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 24: Mocked-API browser tests (non-preview build)

**Files:**
- Create: `frontend/playwright.series.config.mjs`
- Create: `frontend/e2e/series-mocked.spec.mjs`
- Modify: `frontend/playwright.config.mjs` (the existing **preview** config scans all of `./e2e`, so it must exclude the new spec)
- Modify: `.github/workflows/ci.yml` (run the new unit and browser suites)

**Interfaces:**
- Consumes: test ids from Tasks 21–23; the dev build with `REACT_APP_PREVIEW_MODE=false` and `REACT_APP_BACKEND_URL=''` so API calls are same-origin (`/api/...`) and fully intercepted by `page.route`. `previewMode.js` is not involved.
- Covers the spec's browser cases: conflict fixing by suggestion, row-onto-row batch conflict, stale-response protection, Create disabled until the current selection is checked, ordinary edits (duration/location) preserving the draft and request id, first-session change, save-time conflict recovery, **lost response → unknown → reload → resume → same series**, **lost BEFORE commit → reload → Retry returns 409 → the edited draft (deselections, pins) is restored**, **definitive error after a reload restores the editor**, **a declined program assignment, the starting day, pins and deselections survive late program metadata plus a 409 and a 400 after reload**, **storage unavailable**, cancel this-and-future with notify off — 14 tests.
- Suite separation: the preview config ignores this spec and this config matches only this spec; their test inventories must be disjoint (verified in Step 4).

- [ ] **Step 1: Create the Playwright config**

Create `frontend/playwright.series.config.mjs`:

```js
import { defineConfig } from '@playwright/test';

// Recurring-sessions browser tests: a normal (non-preview) dev build whose API calls are
// intercepted with page.route. No backend, no real auth, previewMode.js untouched.
export default defineConfig({
  testDir: './e2e',
  testMatch: 'series-mocked.spec.mjs',
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'line',
  use: { baseURL: 'http://127.0.0.1:4175', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4175',
    url: 'http://127.0.0.1:4175',
    env: { ...process.env, REACT_APP_BACKEND_URL: '', REACT_APP_PREVIEW_MODE: 'false' },
    // Never reuse: a foreign server on the port must be a loud error.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
```

- [ ] **Step 2: Write the fake backend and the specs**

Create `frontend/e2e/series-mocked.spec.mjs`:

```js
import { test, expect } from '@playwright/test';

const COACH = { id: 'coach-1', name: 'Coach Sam', email: 'coach@example.invalid' };
const CLIENT = { id: 'client-1', coach_id: 'coach-1', name: 'Casey Client', email: 'casey@example.invalid' };
const PROGRAM = {
  id: 'prog-1', name: 'Upper/Lower', frequency_days: 2, active_assignments: [],
  days: [{ day_number: 1, workout: { id: 'w1', name: 'Upper' } }, { day_number: 2, workout: { id: 'w2', name: 'Lower' } }],
};
const WORKOUTS = [{ id: 'w1', name: 'Upper' }, { id: 'w2', name: 'Lower' }];

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysFromNow = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
const plusDays = (dateStr, n) => { const d = new Date(`${dateStr}T12:00:00`); d.setDate(d.getDate() + n); return iso(d); };

/** In-memory stand-in for the series endpoints. */
class FakeBackend {
  constructor() {
    this.sessions = [];
    this.blocked = new Set();        // "YYYY-MM-DDTHH:mm" slots that are already booked
    this.created = new Map();        // request_id -> { series, receipt }
    this.createPosts = [];           // bodies received by POST /sessions/series
    this.cancelCalls = [];           // { path, body }
    this.checkPlan = [];             // per-check overrides: { delay, forceConflictKey }
    this.dropNextCreateResponse = false;  // the server commits, but the response is lost
    this.dropBeforeProcessing = false;    // the request never reaches the server
    this.failNextCreateWith400 = false;   // a definitive validation error
    this.attempts = [];                   // every create attempt, processed or not
    this.programsDelay = 0;               // ms before GET /programs answers (late program metadata)
    this.checkCalls = [];
  }

  slotConflict(slot, all) {
    if (this.blocked.has(`${slot.date}T${slot.time}`)) {
      return { scope: 'coach', session: { scheduled_at: `${slot.date}T${slot.time}:00Z` }, display: `${slot.date} ${slot.time}` };
    }
    const other = all.find((o) => o.key !== slot.key && o.date === slot.date && o.time === slot.time);
    return other ? { scope: 'batch', with_key: other.key } : null;
  }

  suggestionsFor(slot) {
    const [h, m] = slot.time.split(':').map(Number);
    const next = `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    return [{ date: slot.date, time: next, scheduled_at: `${slot.date}T${next}:00Z`, display: `${slot.date} ${next}` }];
  }

  rowFor(slot, all) {
    const conflict = this.slotConflict(slot, all);
    return { ...slot, scheduled_at: `${slot.date}T${slot.time}:00Z`, display: `${slot.date} ${slot.time}`, conflict, suggestions: conflict ? this.suggestionsFor(slot) : [] };
  }
}

async function install(page, backend) {
  await page.addInitScript(() => {
    if (!localStorage.getItem('cvf_access_token')) localStorage.setItem('cvf_access_token', 'test-token');
  });
  const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const path = pathname.replace(/^\/api/, '');
    const method = request.method();
    const body = request.postData() ? JSON.parse(request.postData()) : {};

    if (path === '/auth/me') return json(route, 200, { role: 'coach', email: COACH.email, profile: COACH });
    if (path === '/notifications/unread-count') return json(route, 200, { unread: 0 });
    if (path === '/sessions' && method === 'GET') return json(route, 200, backend.sessions);
    if (path === '/bookings') return json(route, 200, []);
    if (path === '/clients') return json(route, 200, [CLIENT]);
    if (path === '/programs') {
      if (backend.programsDelay) await new Promise((resolve) => setTimeout(resolve, backend.programsDelay));
      return json(route, 200, [PROGRAM]);
    }
    if (path === '/programs/workouts') return json(route, 200, WORKOUTS);

    if (path === '/sessions/series/preview') {
      const slots = [];
      let cursor = body.start_date;
      for (let guard = 0; slots.length < body.end.count && guard < 400; guard += 1) {
        const weekday = new Date(`${cursor}T12:00:00`).getDay();
        if (body.weekdays.includes(weekday)) slots.push({ key: `g${slots.length + 1}`, date: cursor, time: body.time });
        cursor = plusDays(cursor, 1);
      }
      return json(route, 200, { slots: slots.map((slot) => backend.rowFor(slot, slots)) });
    }

    if (path === '/sessions/series/check') {
      backend.checkCalls.push(body);
      const plan = backend.checkPlan.shift() || {};
      if (plan.delay) await new Promise((resolve) => setTimeout(resolve, plan.delay));
      const rows = body.slots.map((slot) => {
        const row = backend.rowFor(slot, body.slots);
        if (plan.forceConflictKey === slot.key) return { ...row, conflict: { scope: 'coach', display: 'stale' }, suggestions: [] };
        return row;
      });
      return json(route, 200, { seq: body.seq, slots: rows });
    }

    if (path === '/sessions/series' && method === 'POST') {
      backend.attempts.push(body);
      if (backend.dropBeforeProcessing) { backend.dropBeforeProcessing = false; return route.abort('failed'); }
      if (backend.failNextCreateWith400) { backend.failNextCreateWith400 = false; return json(route, 400, { error: 'Those dates are not valid' }); }
      backend.createPosts.push(body);
      const existing = backend.created.get(body.request_id);
      if (existing) return json(route, 200, { ...existing, replayed: true });
      const conflicts = body.slots
        .map((slot) => ({ slot, conflict: backend.slotConflict(slot, body.slots) }))
        .filter((item) => item.conflict)
        .map((item) => ({ key: item.slot.key, ...item.conflict }));
      if (conflicts.length) return json(route, 409, { error: 'Some dates are no longer available', conflicts });
      const result = {
        series: { id: `series-${backend.created.size + 1}`, created_count: body.slots.length },
        receipt: { slots: body.slots.map((slot, i) => ({ key: slot.key, session_id: `s${i}`, scheduled_at: `${slot.date}T${slot.time}:00Z`, workout_id: slot.workout_id, ordinal: i + 1 })) },
      };
      backend.created.set(body.request_id, result);
      if (backend.dropNextCreateResponse) {
        backend.dropNextCreateResponse = false;
        return route.abort('failed'); // the server committed; the response never arrives
      }
      return json(route, 201, { ...result, replayed: false });
    }

    if (/^\/sessions\/series\/[^/]+\/cancel$/.test(path) || /^\/sessions\/[^/]+\/cancel$/.test(path)) {
      backend.cancelCalls.push({ path, body });
      return json(route, 200, path.includes('/series/') ? { cancelled: [{ id: 's1', scheduled_at: '2031-06-03T23:00:00Z' }] } : { id: 's1', status: 'cancelled' });
    }
    return json(route, 200, []);
  });
}

/** Drive the branded DateTimePicker (copied from live-auth.spec.mjs). */
async function pickDateTime(page, testId, target, slotText = '9:00 AM') {
  await page.getByTestId(testId).click();
  const panel = page.getByTestId(`${testId}-panel`);
  const dayName = new RegExp(`${target.toLocaleDateString('en-US', { month: 'long' })} ${target.getDate()}(st|nd|rd|th)?, ${target.getFullYear()}`);
  for (let hops = 0; hops < 3; hops += 1) {
    if (await panel.getByRole('button', { name: dayName }).count()) break;
    await panel.getByRole('button', { name: /next month/i }).click();
  }
  await panel.getByRole('button', { name: dayName }).first().click();
  await panel.getByTestId('time-slot').filter({ hasText: slotText }).first().click();
  await expect(panel).toBeHidden();
}

// Open the editor, choose the client and a start 10 days out at 9:00 AM, switch on Repeat,
// 3 weekly sessions, optionally choose a program (declining the assignment and picking a starting day),
// and press Preview. Returns the first date (YYYY-MM-DD).
async function startPreview(page, { program = null, assign = true, startingDay = null } = {}) {
  await page.goto('/coach/sessions');
  await page.getByTestId('session-create-button').click();
  await page.getByTestId('session-client-select').click();
  await page.getByRole('option', { name: CLIENT.name }).click();
  const start = daysFromNow(10);
  await pickDateTime(page, 'session-datetime-input', start, '9:00 AM');
  await page.getByTestId('session-repeat-toggle').click();
  await page.getByTestId('series-count-input').fill('3');
  if (program) {
    await page.getByTestId('series-program-select').click();
    await page.getByRole('option', { name: program }).click();
    if (!assign) await page.getByTestId('series-assign-checkbox').click();            // decline "also assign"
    if (startingDay) {
      await page.getByTestId('series-starting-day-select').click();
      await page.getByRole('option', { name: new RegExp(`Day ${startingDay}`) }).click();
    }
  }
  await page.getByTestId('series-preview-button').click();
  await expect(page.getByTestId('series-row-g3')).toBeVisible();
  return iso(start);
}

const pendingKeys = (page) => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('cvf_series_pending')));

test('a conflicting date is fixed with a suggestion, then the series saves', async ({ page }) => {
  const backend = new FakeBackend();
  await install(page, backend);
  // Pre-block the second weekly date at 09:00. Dates are generated one week apart.
  const first = iso(daysFromNow(10));
  backend.blocked.add(`${plusDays(first, 7)}T09:00`);
  await startPreview(page);

  await expect(page.getByTestId('series-row-g2')).toHaveAttribute('data-conflict', 'coach');
  await expect(page.getByTestId('series-create-button')).toBeDisabled();
  await page.getByTestId('series-suggestion-g2-10:00').click();
  await expect(page.getByTestId('series-row-g2')).toHaveAttribute('data-conflict', 'none');
  await expect(page.getByTestId('series-create-button')).toBeEnabled();
  await expect(page.getByTestId('series-create-button')).toHaveText('Create 3 sessions');

  await page.getByTestId('series-create-button').click();
  await expect(page.getByText('3 sessions scheduled')).toBeVisible();
  expect(backend.createPosts).toHaveLength(1);
  expect(backend.createPosts[0].request_id).toMatch(/^[0-9a-f-]{36}$/);
  expect(backend.createPosts[0].slots.map((s) => s.time)).toEqual(['09:00', '10:00', '09:00']);
  expect(await pendingKeys(page)).toEqual([]); // cleared after a definitive success
});

test('moving a row onto another flags BOTH rows as a batch conflict', async ({ page }) => {
  const backend = new FakeBackend();
  await install(page, backend);
  const first = iso(daysFromNow(10));
  await startPreview(page);
  await pickDateTime(page, 'series-row-datetime-g3', new Date(`${plusDays(first, 7)}T12:00:00`), '9:00 AM');
  await expect(page.getByTestId('series-row-g2')).toHaveAttribute('data-conflict', 'batch');
  await expect(page.getByTestId('series-row-g3')).toHaveAttribute('data-conflict', 'batch');
  expect(backend.checkCalls.at(-1).slots).toHaveLength(3); // the whole selection, not just the edited row
  await expect(page.getByTestId('series-create-button')).toBeDisabled();
});

test('a delayed (stale) check response never overwrites newer state', async ({ page }) => {
  const backend = new FakeBackend();
  await install(page, backend);
  await startPreview(page);
  // The first check (after unticking g2) is slow and wrongly reports a conflict on g1.
  backend.checkPlan = [{ delay: 1500, forceConflictKey: 'g1' }];
  await page.getByTestId('series-row-select-g2').click();   // -> check #1 (delayed)
  await page.waitForTimeout(500);
  await page.getByTestId('series-row-select-g2').click();   // back to the original selection (no fetch needed)
  await page.waitForTimeout(2200);                          // let the stale response arrive
  await expect(page.getByTestId('series-row-g1')).toHaveAttribute('data-conflict', 'none');
  await expect(page.getByTestId('series-create-button')).toBeEnabled();
});

test('a save-time conflict returns the rows marked, keeps edits, and can be fixed and saved', async ({ page }) => {
  const backend = new FakeBackend();
  await install(page, backend);
  await startPreview(page);
  const first = iso(daysFromNow(10));
  backend.blocked.add(`${plusDays(first, 14)}T09:00`); // becomes unavailable after the preview
  await page.getByTestId('series-create-button').click();
  await expect(page.getByTestId('series-row-g3')).toHaveAttribute('data-conflict', 'coach');
  await expect(page.getByTestId('series-row-g1')).toHaveAttribute('data-conflict', 'none');
  expect(await pendingKeys(page)).toEqual([]);                // a definitive failure clears the pending record
  await page.getByTestId('series-suggestion-g3-10:00').click();
  await page.getByTestId('series-create-button').click();
  await expect(page.getByText('3 sessions scheduled')).toBeVisible();
  expect(backend.createPosts[1].request_id).toBe(backend.createPosts[0].request_id); // same draft, same id
});

test('LOST RESPONSE: save status unknown survives a reload and Retry recovers the same series', async ({ page }) => {
  const backend = new FakeBackend();
  await install(page, backend);
  await startPreview(page);
  backend.dropNextCreateResponse = true;
  await page.getByTestId('series-create-button').click();

  await expect(page.getByTestId('series-unknown')).toBeVisible();
  await expect(page.getByTestId('series-unknown')).toContainText('Save status unknown');
  expect((await pendingKeys(page)).length).toBe(1);
  expect(backend.created.size).toBe(1); // the server did commit

  await page.reload();                                  // close/refresh after the timeout
  await expect(page.getByTestId('series-unknown')).toBeVisible();   // restored, drawer reopened automatically
  await page.getByTestId('series-retry-button').click();
  await expect(page.getByText('Recovered your saved series')).toBeVisible();

  expect(backend.createPosts).toHaveLength(2);
  expect(backend.createPosts[1].request_id).toBe(backend.createPosts[0].request_id);
  expect(backend.createPosts[1]).toEqual(backend.createPosts[0]);   // identical frozen body
  expect(backend.created.size).toBe(1);                              // still exactly one series
  expect(await pendingKeys(page)).toEqual([]);
});

test('STORAGE UNAVAILABLE: warns, still locks and recovers in memory, and degrades safely after a reload', async ({ page }) => {
  const backend = new FakeBackend();
  await page.addInitScript(() => {
    // Only the pending-save key is blocked, so sign-in keeps working: the feature must degrade, not break.
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(key, value) {
      if (String(key).startsWith('cvf_series_pending')) throw new DOMException('blocked', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await install(page, backend);
  await startPreview(page);
  backend.dropNextCreateResponse = true;
  await page.getByTestId('series-create-button').click();

  await expect(page.getByTestId('series-unknown')).toBeVisible();
  await expect(page.getByTestId('series-storage-warning')).toBeVisible();           // honest about the limitation
  expect(await pendingKeys(page)).toEqual([]);                                     // nothing could be persisted
  await expect(page.getByTestId('series-weekday-0')).toHaveCount(0);               // the form is frozen (replaced by the unknown panel)
  await page.getByTestId('series-retry-button').click();                            // in-memory recovery still works
  await expect(page.getByText('Recovered your saved series')).toBeVisible();
  expect(backend.created.size).toBe(1);
  expect(backend.createPosts[1].request_id).toBe(backend.createPosts[0].request_id);

  // After a reload with nothing persisted the app cannot resume, but must not crash or auto-open a broken drawer.
  await page.reload();
  await expect(page.getByTestId('session-create-button')).toBeVisible();
  await expect(page.getByTestId('series-unknown')).toHaveCount(0);
});

async function chooseWorkout(page, key, name) {
  await page.getByTestId(`series-row-workout-${key}`).click();
  await page.getByRole('option', { name }).click();
}

test('ordinary edits (duration, location) keep the reviewed draft and request id; duration re-checks the whole selection', async ({ page }) => {
  const backend = new FakeBackend();
  await install(page, backend);
  await startPreview(page);
  const requestId = await page.getByTestId('series-composer').getAttribute('data-request-id');
  await page.getByTestId('series-row-select-g2').click();     // deselect a date
  await chooseWorkout(page, 'g1', 'Lower');                   // pin a workout by hand
  await expect(page.getByTestId('series-create-button')).toBeEnabled();
  const checksBefore = backend.checkCalls.length;

  await page.getByTestId('session-duration-select').click();
  await page.getByRole('option', { name: '90 min' }).click();
  await page.getByTestId('session-location-input').fill('Studio B');

  await expect.poll(() => backend.checkCalls.length).toBeGreaterThan(checksBefore);
  const last = backend.checkCalls.at(-1);
  expect(last.duration_minutes).toBe(90);
  expect(last.slots.map((slot) => slot.key)).toEqual(['g1', 'g3']);      // the whole selected selection
  await expect(page.getByTestId('series-create-button')).toBeEnabled();
  await expect(page.getByTestId('series-row-select-g2')).toHaveAttribute('data-state', 'unchecked');
  await expect(page.getByTestId('series-row-workout-g1')).toContainText('Lower');
  await expect(page.getByTestId('series-summary')).toContainText('2 of 3 selected');
  expect(await page.getByTestId('series-composer').getAttribute('data-request-id')).toBe(requestId);
});

test('changing the first session after previewing asks to regenerate, but the current dates are kept until then', async ({ page }) => {
  const backend = new FakeBackend();
  await install(page, backend);
  await startPreview(page);
  await pickDateTime(page, 'session-datetime-input', daysFromNow(11), '10:00 AM');
  await expect(page.getByTestId('series-start-changed')).toBeVisible();
  await expect(page.getByTestId('series-preview-button')).toHaveText('Regenerate dates');
  await page.getByTestId('series-back-to-dates').click();
  await expect(page.getByTestId('series-row-g3')).toBeVisible();          // the reviewed dates are still there
  await expect(page.getByTestId('series-row-g1')).toHaveAttribute('data-conflict', 'none');
});

test('Create stays disabled from the moment of an edit until that selection has been checked', async ({ page }) => {
  const backend = new FakeBackend();
  await install(page, backend);
  await startPreview(page);
  backend.checkPlan = [{ delay: 800 }];
  await page.getByTestId('series-row-select-g2').click();
  await expect(page.getByTestId('series-create-button')).toBeDisabled();  // immediately — before the debounce even fires
  await expect(page.getByTestId('series-create-button')).toBeEnabled();   // once the (slow) check has returned
});

test('LOST BEFORE COMMIT: after a reload the 409 on Retry restores the edited draft (deselection, pin) so it can be fixed and saved', async ({ page }) => {
  const backend = new FakeBackend();
  await install(page, backend);
  await startPreview(page);
  await page.getByTestId('series-row-select-g2').click();
  await chooseWorkout(page, 'g1', 'Lower');
  await expect(page.getByTestId('series-create-button')).toBeEnabled();
  const first = iso(daysFromNow(10));
  backend.blocked.add(`${plusDays(first, 14)}T09:00`);   // g3 will conflict when the request finally reaches the server
  backend.dropBeforeProcessing = true;
  await page.getByTestId('series-create-button').click();
  await expect(page.getByTestId('series-unknown')).toBeVisible();
  expect(backend.created.size).toBe(0);                  // it never committed

  await page.reload();
  await expect(page.getByTestId('series-unknown')).toBeVisible();
  await page.getByTestId('series-retry-button').click();

  await expect(page.getByTestId('series-row-g3')).toHaveAttribute('data-conflict', 'coach');
  await expect(page.getByTestId('series-row-select-g2')).toHaveAttribute('data-state', 'unchecked');
  await expect(page.getByTestId('series-row-workout-g1')).toContainText('Lower');
  await expect(page.getByTestId('series-summary')).toContainText('2 of 3 selected');
  await page.getByTestId('series-suggestion-g3-10:00').click();
  await page.getByTestId('series-create-button').click();
  await expect(page.getByText('2 sessions scheduled')).toBeVisible();
  expect(new Set(backend.attempts.map((attempt) => attempt.request_id)).size).toBe(1);   // one draft, one id, throughout
  expect(backend.created.size).toBe(1);
  expect(backend.createPosts.at(-1).slots.map((slot) => slot.workout_id)).toEqual(['w2', null]);
});

test('DEFINITIVE ERROR after a reload restores the editor with the message, and the draft can still be saved', async ({ page }) => {
  const backend = new FakeBackend();
  await install(page, backend);
  await startPreview(page);
  backend.dropBeforeProcessing = true;
  await page.getByTestId('series-create-button').click();
  await expect(page.getByTestId('series-unknown')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('series-unknown')).toBeVisible();
  backend.failNextCreateWith400 = true;
  await page.getByTestId('series-retry-button').click();

  await expect(page.getByTestId('series-error')).toContainText('Those dates are not valid');
  await expect(page.getByTestId('series-row-g1')).toBeVisible();          // the whole draft is back, not an empty review
  await expect(page.getByTestId('series-row-g3')).toBeVisible();
  await expect(page.getByTestId('series-create-button')).toBeEnabled();   // after the restored selection is re-checked
  await page.getByTestId('series-create-button').click();
  await expect(page.getByText('3 sessions scheduled')).toBeVisible();
  expect(new Set(backend.attempts.map((attempt) => attempt.request_id)).size).toBe(1);
  expect(backend.created.size).toBe(1);
});

for (const mode of ['409', '400']) {
  test(`RECOVERY (${mode} after reload): a declined program assignment, the starting day, pins and deselections survive late program metadata and a definitive failure`, async ({ page }) => {
    const backend = new FakeBackend();
    await install(page, backend);
    await startPreview(page, { program: 'Upper/Lower', assign: false, startingDay: 2 });
    await page.getByTestId('series-row-select-g2').click();       // deselect a date
    await chooseWorkout(page, 'g1', 'Upper');                      // pin g1 (the automatic choice for it would be Lower)
    await expect(page.getByTestId('series-create-button')).toBeEnabled();
    const first = iso(daysFromNow(10));
    if (mode === '409') backend.blocked.add(`${plusDays(first, 14)}T09:00`);
    backend.dropBeforeProcessing = true;
    await page.getByTestId('series-create-button').click();
    await expect(page.getByTestId('series-unknown')).toBeVisible();
    expect(backend.attempts.at(-1).assign_program).toBe(false);   // the frozen request declined the assignment

    backend.programsDelay = 1500;                                  // program metadata arrives AFTER the draft is restored
    await page.reload();
    await expect(page.getByTestId('series-unknown')).toBeVisible();
    if (mode === '400') backend.failNextCreateWith400 = true;
    await page.getByTestId('series-retry-button').click();

    if (mode === '409') {
      await expect(page.getByTestId('series-row-g3')).toHaveAttribute('data-conflict', 'coach');
      await page.getByTestId('series-suggestion-g3-10:00').click();
    } else {
      await expect(page.getByTestId('series-error')).toContainText('Those dates are not valid');
    }
    await expect(page.getByTestId('series-row-select-g2')).toHaveAttribute('data-state', 'unchecked');
    await expect(page.getByTestId('series-row-workout-g1')).toContainText('Upper');
    // Waits for the late program metadata, then proves it did not flip the declined assignment back on.
    await expect(page.getByTestId('series-assign-checkbox')).toHaveAttribute('data-state', 'unchecked');
    await expect(page.getByTestId('series-starting-day-select')).toContainText('Day 2');
    await expect(page.getByTestId('series-create-button')).toBeEnabled();
    await page.getByTestId('series-create-button').click();
    await expect(page.getByText('2 sessions scheduled')).toBeVisible();

    const saved = backend.createPosts.at(-1);
    expect(saved.assign_program).toBe(false);                      // the coach's explicit choice survived
    expect(saved.program_id).toBe('prog-1');
    expect(saved.slots.map((slot) => slot.workout_id)).toEqual(['w1', 'w1']);
    expect(new Set(backend.attempts.map((attempt) => attempt.request_id)).size).toBe(1);
    expect(backend.created.size).toBe(1);
  });
}

test('cancel this-and-future with Notify off sends the series cancel with notify:false', async ({ page }) => {
  const backend = new FakeBackend();
  backend.sessions = [{
    id: 's1', client_id: CLIENT.id, coach_id: COACH.id, client: { id: CLIENT.id, name: CLIENT.name }, coach: COACH,
    scheduled_at: new Date(Date.now() + 5 * 86400000).toISOString(), duration_minutes: 60, location: 'CVF Studio',
    status: 'scheduled', workout: null, linked_workout_log: null,
    series_id: 'ser-1', series_ordinal: 1, series: { id: 'ser-1', rule: { weekdays: [2, 4], interval_weeks: 1 }, created_count: 3 },
  }];
  await install(page, backend);
  await page.goto('/coach/sessions');
  await expect(page.getByTestId('series-badge')).toContainText('Weekly · Tue/Thu · Session 1 of 3');
  await page.getByTestId('session-actions-button').click();
  await page.getByTestId('session-cancel-action').click();
  await page.getByTestId('session-cancel-scope-future').click();
  await page.getByTestId('session-cancel-notify').click();
  await page.getByTestId('session-cancel-confirm').click();
  await expect.poll(() => backend.cancelCalls.length).toBe(1);
  expect(backend.cancelCalls[0].path).toBe('/sessions/series/ser-1/cancel');
  expect(backend.cancelCalls[0].body).toEqual({ from_session_id: 's1', notify: false });
});
```

- [ ] **Step 3: Exclude the series spec from the existing preview suite, and prove the two inventories are disjoint**

In `frontend/playwright.config.mjs` add one line inside `defineConfig({ … })`, right after `testDir: './e2e',`:

```js
  testIgnore: ['**/series-mocked.spec.mjs'], // the mocked-API series tests need a NON-preview build; see playwright.series.config.mjs
```
Then list both inventories (no browser is started):

```bash
cd frontend
npx playwright test --list > "${TMPDIR:-/tmp}/preview-list.txt"
npx playwright test --config playwright.series.config.mjs --list > "${TMPDIR:-/tmp}/series-list.txt"
if grep -q "series-mocked" "${TMPDIR:-/tmp}/preview-list.txt"; then echo "FAIL: preview suite discovers the series spec"; exit 1; fi
if grep -v "series-mocked" "${TMPDIR:-/tmp}/series-list.txt" | grep -q "›"; then echo "FAIL: series suite discovers a non-series spec"; exit 1; fi
tail -n 3 "${TMPDIR:-/tmp}/preview-list.txt" "${TMPDIR:-/tmp}/series-list.txt"
```
Expected: no FAIL line; the series list reports **14 tests in 1 file**, the preview list reports no `series-mocked` entries and the same test count as before this feature (the baseline you recorded from `npm run test:e2e:preview`).

- [ ] **Step 4: Run the series specs and stabilize**

```bash
cd frontend && npm run test:e2e:series
```
Expected: exit status 0, 14 tests PASS. First-run adjustments are expected and legitimate:
- If the app shell requests an endpoint not listed in `install()` and a page error appears in the console, add that route (the fallback returns `[]`; add an object response where the code reads properties).
- If a date lands on a month boundary and `pickDateTime` cannot find the day button, the helper already advances up to three months; keep it.
- The row-edit test targets `series-row-datetime-g3` through the shared `DateTimePicker`; its `data-testid` is applied to the trigger and `<testid>-panel` to the popover (the live spec relies on the same convention).
Do not weaken an assertion to make a test pass; fix the cause (usually a missing test id or fixture field).

- [ ] **Step 5: Re-run the existing preview suite**

Run: `cd frontend && npm run test:e2e:preview`
Expected: exit status 0 with exactly the pre-feature test count (the series spec is no longer discovered).

- [ ] **Step 6: Wire both new suites into CI**

In `.github/workflows/ci.yml`, in the `frontend` job, add `npm run test:unit` after the build step and `npm run test:e2e:series` after the preview suite, so the steps read:

```yaml
      - run: npm ci
      - run: npm run build
      - run: npm run test:unit
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e:preview
      - run: npm run test:e2e:series
      - run: npm audit --omit=dev
```
(The workflow uses Node 22; the unit tests rely on Node ≥ 22.7 module-syntax detection, which `node-version: 22` provides.) Validate the YAML (`ruby -ryaml -e 'YAML.load_file(".github/workflows/ci.yml")'` or any parser).

- [ ] **Step 7: Commit (two commits)**

```bash
git add frontend/playwright.series.config.mjs frontend/e2e/series-mocked.spec.mjs frontend/playwright.config.mjs
git commit -m "test: mocked-API browser tests for recurring sessions incl. reload recovery and unavailable storage" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git add .github/workflows/ci.yml
git commit -m "ci: run frontend unit tests and the series browser suite" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
The CI steps are exercised the first time the branch is pushed; until then they are unverified and the final report must say so.

> **Checkpoint (phase boundary — review here):** review the recovery UI (Tasks 22–24: draft snapshot, frozen retry, restore-on-definitive-failure, storage-unavailable behavior) before Phase 6.

---

## Phase 6 — Verification and handoff

### Task 25: Whole-feature verification and project status

**Files:**
- Modify: `CLAUDE.md` (one status bullet — **only after every check below exits 0**)

- [ ] **Step 1: Run every check, record every exit status, and keep the logs**

Nothing here pipes a check through `tail`/`grep` (that would hide a failure). Each check writes its own log, and the loop reports the exit status of the check itself. Run this as one block:

```bash
cd /Users/jav/Projects/cvf/cvfpt
set -uo pipefail
LOG="${TMPDIR:-/tmp}/recurring-verify"; mkdir -p "$LOG"
FAILED=""
run() {  # run <name> <command...>
  local name="$1"; shift
  if "$@" > "$LOG/$name.log" 2>&1; then echo "[PASS] $name (exit 0)"; else local code=$?; echo "[FAIL] $name (exit $code) — $LOG/$name.log"; tail -n 30 "$LOG/$name.log"; FAILED="$FAILED $name"; fi
}
run backend-tests   bash -c 'cd backend && npm test'
run frontend-unit   bash -c 'cd frontend && npm run test:unit'
run frontend-build  bash -c 'cd frontend && npm run build'
run e2e-preview     bash -c 'cd frontend && npm run test:e2e:preview'      # if Task 0 recorded the known baseline failure, append: -- --grep-invert "session conflicts surface inline"
run e2e-series      bash -c 'cd frontend && npm run test:e2e:series'
run stack-guards    bash -c 'bash supabase/tests/session_series/stack_guard_test.sh && bash supabase/tests/session_series/isolation_guard_test.sh'
run database        bash supabase/tests/session_series/run.sh
run db-isolation    bash supabase/tests/session_series/isolation_check.sh
echo "FAILED:${FAILED:- none}"
```
Expected: eight `[PASS]` lines and `FAILED: none`. If Task 0 recorded the known pre-existing preview failure, run the `e2e-preview` line with the `--grep-invert` exclusion, and also run that single test once (`cd frontend && npm run test:e2e:preview -- -g "session conflicts surface inline"`) to report its outcome next to the baseline (failing); it must not get worse and is reported as an out-of-scope discovery, not fixed. (`stack-guards` needs no Docker and must pass even when the two database checks are BLOCKED.) Record the raw counts from each log for the final report (backend: the Task 0 baseline plus the new tests; frontend unit tests; preview suite count unchanged from before the feature; series suite 14 tests; the 18 + 11 stack/isolation guard cases; the database suite's six result lines; `isolation check passed`). A check that cannot run (for example the two database checks when Docker is unavailable) is reported as **NOT RUN — BLOCKED** with the reason, never as passed.

- [ ] **Step 2: Invariant audits**

```bash
cd /Users/jav/Projects/cvf/cvfpt
# Only NEW migration files; no applied migration edited:
git diff --name-status main -- supabase/migrations
# No hardcoded hex in the new components (design tokens only):
grep -nE "#[0-9a-fA-F]{3,8}\b" frontend/src/components/series/*.jsx || echo "OK: no hex literals"
# No cross-boundary imports:
grep -rn "backend/" frontend/src/lib/series*.js frontend/src/components/series || echo "OK: no backend imports"
grep -rn "frontend/" backend/src/lib/sessionSeries backend/src/routes/sessionSeries.js || echo "OK: no frontend imports"
# previewMode.js untouched:
git diff --stat main -- frontend/src/lib/previewMode.js
# Pre-existing worktree changes still untouched and unstaged:
git status --short
```
Expected: every migration line starts with `A`; the three "OK" lines; an empty `previewMode.js` diff; and `git status --short` still shows only the pre-existing items from Task 0 plus nothing unexpected. Do not treat `grep`'s "no match" exit status as a failure here — the `|| echo` is deliberate.

- [ ] **Step 3: Add the status line to `CLAUDE.md` — conditional on Step 1**

If **every** check in Step 1 passed (including `database` and `db-isolation`; the documented pre-existing preview failure, if any, does not count against this but must be named in the bullet), append this bullet to the `## Status` list in `CLAUDE.md`:

```markdown
- Recurring sessions (2026-09-30): **implemented and locally verified (backend, frontend unit, build, both browser suites, and the database suite on a disposable Supabase stack<, with one pre-existing unrelated preview-suite failure unchanged from baseline — delete this clause if Task 0 recorded none>); not yet released**. Coaches create a weekly batch of ordinary sessions (`session_series` + `sessions.series_id`) from the session editor's Repeat mode with a conflict-fixing preview, optional program-day workout mapping, all-or-nothing retry-safe saving (idempotent `request_id`, immutable receipt, pending save and editor snapshot persisted across reloads), one summary notification, and "this and all future" cancellation. Four additive migrations (`20260930100000`–`20260930130000`, including a behavior-preserving refactor of `schedule_session` onto the shared `find_session_conflict` helper) are **not applied to the hosted database**; backend code that uses them must not deploy before they are applied. The new CI jobs have not yet run on GitHub. Spec: `docs/superpowers/specs/2026-09-30-recurring-sessions-design.md`.
```

If **any** check failed or could not run, do **not** write "locally verified". Write instead (naming exactly what is unverified):

```markdown
- Recurring sessions (2026-09-30): **implemented; verification incomplete — <list each check that failed or was NOT RUN, e.g. "database suite not run: Docker engine unavailable">**; not released. <same feature summary and migration warning as above>. Spec: `docs/superpowers/specs/2026-09-30-recurring-sessions-design.md`.
```

- [ ] **Step 4: Commit (documentation)**

```bash
git add CLAUDE.md
git commit -m "docs: record recurring sessions status" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Write the completion report in the repository's executor shape**

Follow `.agentic/EXECUTOR.md` "Reporting": begin with the protocol completion state and handoff envelope (`COMPLETE-LOCAL` unless the branch has been pushed with the owner's authorization; never "complete" for anything unverified), then give raw evidence and counts from the Step 1 logs, classify every failed or unrun check, number every judgment call or deviation (for example anything adjusted on the first run of the browser specs), reconcile the full baseline-to-head footprint, list out-of-scope discoveries separately without fixing them, and state precisely what is local, pushed, deployed and hosted-migrated (the last two are *none*).

### Task 26: Release handoff checklist — NOT executed by this plan

This task is a checklist for the owner. **Nothing here is run as part of executing this plan.** Each item needs separate, explicit authorization (`.agentic/PROJECT_POLICY.md`: hosted migrations and deploys require explicit task authorization; the owner performs merges).

- [ ] **Disclose the deploy consequence.** Merging to `main` triggers both Vercel Production projects through the Git integration. Because this PR is migration-bearing, disclose that before asking the owner to merge.
- [ ] **Migration guard.** `.github/workflows/migration-guard.yml` fails any PR that changes `supabase/migrations/` until the owner has applied the migrations to hosted Supabase and added the `migration-applied` label. That check is expected to be red until the hosted step below is done and verified.
- [ ] **Order.** The four migrations are additive and backward-compatible for existing callers (a new table, nullable columns, new functions; the redefined `schedule_session` keeps its contract, so the currently deployed backend keeps working after they are applied). They must be **applied and verified on the hosted database before** the merge that deploys backend code which calls `schedule_session_series` / `check_session_slots` or selects `session_series`. Do not promise a post-merge migration-first sequence that the Git trigger makes impossible; either apply before merge or explicitly pause automatic deployment.
- [ ] **Hosted database.** Preview and Production intentionally share one hosted Supabase project. Apply the migrations in timestamp order with the owner-authorized tooling only; do not handle keys. Verify with read-only checks (the three new functions exist with service-role-only execute, `session_series` has RLS enabled and no policies, `sessions.series_id`/`series_ordinal` exist, and `schedule_session` still returns identical results for a known fixture) and a rollback-only create probe, each separately authorized. State exactly which environment received the migrations.
- [ ] **CI.** Confirm the new `database` job and the extended `frontend` job pass on GitHub for the pushed branch; until then they are unverified.
- [ ] **Post-merge checks.** Backend health and CORS, unauthenticated boundaries for `/api/sessions/series/*` (401), retired-route 404s unchanged, public login renders, and a one-hour backend error/5xx scan, following `docs/hardening/2026-07-22-pr5-hosted-release.md`. A real-auth browser run needs the `CVF_E2E_*` credentials; if unavailable, say it was not rerun.
- [ ] **Rollback posture.** Forward-only: if something is wrong, the safe step is a new forward migration. The new columns and table are inert to old code, so a backend rollback alone is safe.

---

## What was and was not verified while writing this plan

Planning only — nothing in the repository was changed, no migration was applied, and nothing was deployed. The plan's code was nevertheless checked where it could be, in scratch copies outside the repo (code blocks extracted mechanically from this document and the plan's edits applied in the order an executor would apply them):

| Checked | How | Result |
|---|---|---|
| Tasks 3–5 (Denver conversion, rule/generator/hash, suggestion candidates) | `node --test` | 25/25 pass, including DST gap and ambiguity |
| Task 1 on its own; Task 2 | Edits applied step by step | Task 1: 5/5 green. Task 2: exactly the 4 ordering tests fail first, then 9/9 pass |
| Task 14 on its own (no `createRequest.js` yet) | Preview/check routes + tests | 8/8 pass — no stub, no red commit |
| Tasks 12–17 with all earlier tasks | Scratch copy of `backend/` | 67/67 new backend tests pass |
| Existing mounted-route suites with the edits applied | `node --test` | 67/71 — the 4 failures read `../../supabase/...` files absent from the scratch copy |
| **`stack.sh` / `isolation_check.sh` safety (Tasks 6, 11)** | The real scripts run against fake `docker`/`supabase` executables (no Docker needed): 18 + 11 failure-injection cases | All pass. Run against the **previous** versions the same tests fail: the old `stack.sh` calls `stop --no-backup` for a partial setup, and the old `isolation_check.sh` prints "isolation check passed" when every Docker query fails |
| Tasks 18–20 (`seriesPlan` incl. `assignDefault` and fallback reconstruction, `seriesDraftStore` incl. snapshot and storage-unavailable, `seriesRequest`) | `node --test` | 28/28 pass |
| **Frontend (Tasks 21–24)** | The plan's edits applied to a scratch copy of `frontend/`; `npm run build`; real Chromium via Playwright | Build succeeds. The new mocked-API suite: **14/14 pass** (after Task 23 Step 5, the scroll fix — without it two tests fail with "element is outside of the viewport"). The two `RECOVERY` tests **fail when the original assign-default bug is reintroduced** ("Expected unchecked, Received checked") |
| Preview browser suite with the changes applied | Real Chromium | 19 passed, 8 skipped, 1 failed — **identical to the untouched repo**. The inventory (28 tests in 2 files) is also identical, so the series spec is correctly excluded. The 1 failure is pre-existing (see Task 0) |
| Baselines of the untouched repo | `cd backend && node --test`; `cd frontend && npx playwright test` | Backend 316 pass, 0 fail. Preview: 19 passed, 8 skipped, 1 failed (`session conflicts surface inline…`, cause not investigated) |

**Not executed (the executor must run these):** every SQL migration and SQL test, `run.sh`, `concurrency.sh`, and the live `stack.sh`/`isolation_check.sh` against a real engine — Docker's engine was unhealthy and no Postgres binary is installed locally, so the SQL has been read for syntax and logic but never run; the Supabase CLI flags `stack.sh` relies on (`start -x`, `stop --project-id --no-backup`, `db reset --local --version`, `--workdir`) and the container label `com.supabase.cli.project` (confirmed in Task 6 Steps 5 and 7, with a safe failure if wrong); the CI workflow edits; and the `session conflicts surface inline` preview test with this feature's changes (it fails at baseline, so its behavior with the changes is unverified). Treat the SQL as the highest-risk part and expect first-run fixes, which the tasks tell the executor to fix at the cause rather than by weakening a test.

## Self-review (completed by the plan author)

**Spec coverage** — each spec requirement maps to a task:

| Spec requirement | Task(s) |
|---|---|
| Workout validation order + shared workouts + bulk validation | 1, 2 |
| Denver wall-clock → UTC, DST gap/ambiguity | 3 |
| Rule parsing, generator, 52 cap, one horizon definition, "N sessions" semantics, request hash | 4 |
| Suggestion candidates, 24 per row, chunk ≤ 600, ≤ 3 per row | 5, 14 |
| Docker diagnosis (no unauthorized restart) and an owned, disposable database stack | 6, 11 |
| `session_series`, `series_id`, `series_ordinal`, receipt, RLS/grants | 7, 11 |
| Shared `find_session_conflict`; `schedule_session` refactor; parity proof | 8 |
| `check_session_slots`: independent alternatives, batch conflicts by key, read-only | 9 |
| `schedule_session_series`: lock-then-lookup, evaluate-then-write, FK-compatible order, receipt, replay, mismatch, program assign, atomic rollback | 10 |
| Committed-transaction concurrency (same-id replay race, distinct-id race) | 11 |
| `notify` on single cancel; series cancel; zero-row no-notify | 12, 16 |
| One summary email/push; best-effort; built from actual dates; replay never notifies | 13, 15 |
| Preview / check routes, whole-selection check, `seq`, horizon via `start_date` | 14 |
| Create route: shape → authorized replay → eligibility → RPC; DB-level replay = 200; mismatch; conflicts by key | 15 |
| `series` embed on coach reads; coach-only badge | 17, 21 |
| Mapping rules + examples; assign checkbox visibility | 18, 22 |
| Pending save persisted across reloads; storage-unavailable path; one request-id lifecycle; "Save status unknown" lock | 19, 20, 22, 23, 24 |
| Cancel dialog (this one / this and all future, notify) | 21 |
| Preview UI: date+time editing, suggestions, summary "N of M · last on…", Add a date | 22 |
| Playwright with mocked API, `previewMode.js` untouched; preview and series suites kept disjoint; CI wiring | 11, 24 |
| Draft survives ordinary edits; editor restored after a post-reload 409/400; Create disabled until the current selection is checked | 22, 23, 24 |
| Green-only commits; verification without masking pipes; conditional "locally verified" status | Global Constraints, 1–2, 14–15, 25 |
| Release sequencing, no hosted action | 26 |

**Placeholder scan:** no unfilled steps; every code step contains the code. One step intentionally says to adjust on first run — Task 24 Step 4, where the real app shell's endpoints and markup determine which fixtures the mocked backend needs — and it names exactly what to check.

**Type/name consistency:** `parseCreateRequest` (Task 15) is what the Task 15 test block imports at its point of use (Task 14's tests do not need it); `validateNotifyFlag` (Task 12) is used by Task 16; `notifySeriesScheduled({ seriesId, clientId, coachId, dates })` / `notifySeriesCancelled({ seriesId, clientId, coachId, cancelled })` match between Task 13 and Tasks 15–16; the RPC argument names (`p_request_id`, `p_request_hash`, `p_coach_id`, `p_client_id`, `p_duration_minutes`, `p_location`, `p_rule`, `p_program_id`, `p_assign_program`, `p_slots`) match between Task 10 and Task 15; conflict objects are `{ key, scope, session | with_key, display }` in the RPC result, route response, `classifySaveOutcome`, and the composer; receipt slot fields (`key, session_id, scheduled_at, workout_id, ordinal`) match between SQL, route, and tests.

**Known judgment calls an executor should not "fix":** all-or-nothing save-time conflicts (owner decision, not partial success); notifications decided on the RPC result (`notify && !replayed`); suggestions are independent alternatives; conflicting rows are never forced through; `previewMode.js` stays untouched.
