# Preview mode for post-launch use — steps 1–3

**Date:** 2026-10-01
**Status:** Approved for implementation, revision 3 (owner review 2026-10-01).
**Written against:** `origin/main` at `e86938d`. Line references below are to that commit.

## Why

Preview mode is kept (owner decision 2026-10-01). After launch its jobs are owner review of
unreleased features and UI on Vercel preview links, design QA, and the `npm run test:e2e:preview`
regression suite. Three things stand in the way today:

1. A route with no mock returns a generic 404 (`previewMode.js:2201`). On a phone that is
   indistinguishable from an app bug, and no test notices it unless it happens to assert on the
   affected screen.
2. Loading, retry and failed-save states can only be reached by editing `localStorage` by hand
   (`cvf_preview_latency`, `cvf_preview_history_failure`). There is no way back to a clean start
   short of knowing which keys to clear.
3. Recurring sessions — released and hosted-verified — cannot be opened in preview at all. None of
   its four routes are mocked.

## Scope

In scope, in build order:

1. Explicit unsupported-flow handling and missing-mock detection.
2. Reset, network-speed and failure controls in the preview toolbar.
3. Recurring-session preview support.

Out of scope (later steps, separate spec if needed): scenario seed data, coach identity selector,
a scenario selector, any change to the preview gate, any backend or schema change.

## Rules this spec follows

- The preview gate (`previewFlag.js`, `vite.config.js`) is not touched.
- Preview verifies UI behavior. It does not prove real authorization, server validation, database
  behavior, or delivery of emails and push notifications; backend/database tests and relevant
  integration checks are the source of truth for those.
- Nothing is imported across the `frontend/` ↔ `backend/` deploy boundary.
- Sarah's existing fixtures stay as they are.
- Functional and visual changes go in separate commits. The toolbar additions reuse existing
  toolbar classes and tokens; this is dev tooling, not a signature surface, so the visual gate in
  `docs/design-principles.md` is not triggered.

---

## Step 1 — Unsupported flows and missing mocks

Two different situations get two different treatments.

### Deliberately unsupported

A single list in `previewMode.js`:

```js
// Routes preview deliberately does not mock. Each entry needs a reason.
const PREVIEW_UNSUPPORTED = [
  { method: 'post', pattern: /^\/sessions\/series\/preview$/, reason: 'Recurring sessions are not in preview yet' },
  // ...
];
```

The adapter checks this list before its final fall-through. A match:

- rejects with status **422** and `{ error: 'Not available in preview', code: 'preview_unsupported', reason }`.
  A 4xx is deliberate: several callers treat ≥ 500 as "outcome unknown" (`classifySaveOutcome` in
  `seriesRequest.js`), which would lock a form instead of reporting a definite refusal.
- dispatches a `cvf-preview-notice` window event with `{ kind: 'unsupported', method, path, reason }`.

`PreviewToolbar` listens for that event and shows a toast through the app's existing `<Toaster>`
(`App.js:150`): **"Not available in preview"** with the reason as the description. A fixed toast id
keeps repeated hits from stacking. This is what guarantees the explicit state: it appears even when
the calling screen swallows the error. Screens that surface `errMsg(e)` will also show the same
sentence in their own error slot; that duplication is acceptable.

Initial entries: the four recurring-session routes. Step 3 removes them.

### Unexpectedly missing

The final fall-through keeps its 404 and message, and additionally:

- writes `console.error('[cvf-preview:missing-mock] METHOD /path')` — a fixed, greppable prefix;
- dispatches `cvf-preview-notice` with `{ kind: 'missing', method, path }`, shown as a toast
  **"Preview is missing a mock"** with the method and path, so on a phone it reads as a preview gap
  rather than an app bug.

### Failing the suite

The adapter's 404s never touch the network, so Playwright network listeners cannot see them. The
detector therefore observes the adapter's own emission:

- New `frontend/e2e/preview-test.mjs` exports `test` and `expect`. `test` extends Playwright's with
  an **automatic** fixture that subscribes to `context.on('console')` — context-level, so it
  survives navigations and covers every page a test opens — and collects messages starting with
  `[cvf-preview:missing-mock]`.
- After each test the fixture fails the test if anything was collected, listing each method and path.
  This fires even when the screen caught and hid the error.
- `preview-critical.spec.mjs` imports `test`/`expect` from this file instead of `@playwright/test`.
  No other change to existing tests.
- A fixture option `allowMissingMocks` (default `false`) lets one test opt out and read the
  collected list.

Tests added:

- **Enforcement.** An ordinary test — no opt-out — calls an unmocked path through the app's own
  `api` instance (imported from the dev server's `/src/lib/api.js` inside `page.evaluate`) and
  swallows the error. It is annotated `test.fail()`: the suite passes only if the automatic fixture
  really fails that test, and goes red if the detector ever stops enforcing. The plan must confirm
  that a fixture-teardown failure satisfies `test.fail()` on Playwright 1.61.1; if it does not, the
  fallback is a small node test that runs Playwright on a one-test spec and asserts a non-zero exit
  naming the route.
- **Collection and notice.** With `allowMissingMocks: true`, the same call; assert the collected
  list contains the method and path and the "missing a mock" toast is visible.
- **Unsupported is explicit and does not fail the suite.** Hit a listed route the same way; assert
  the 422 body, the "Not available in preview" toast, and an empty missing-mock list.

### Triage

Turning the detector on will surface every route the current suite already hits without a mock.
That number is unknown until the suite runs with it. Each hit is resolved one of two ways: add the
mock, or add a list entry with a reason. Step 1 is done when the suite is green with the detector on.

---

## Step 2 — Toolbar controls

Three controls added to `PreviewToolbar.jsx`, next to the existing role and client selects. The
existing "Incomplete analytics" checkbox and the test-only `cvf_preview_history_failure` key are
unchanged.

### Reset

One button, no confirmation (all preview data is fake).

- Removes only state the preview owns, from an explicit list (below).
- Hard-loads the current role's home (`/client`, `/coach`, `/admin`).

Fixtures live in memory and rebuild on load, so the hard load restores all mutated data. The
storage cleanup is deliberately narrow because a local dev origin is shared with real-auth sessions:

| Removed | Why it is preview-owned |
|---|---|
| `cvf_preview_latency`, `cvf_preview_fail`, `cvf_preview_incomplete_analytics`, `cvf_preview_history_failure` | Preview switches |
| `cvf_series_pending:<user>:*` where `<user>` is a fixture coach's id (the draft store keys by `user.profile.id`, e.g. `coach_marcus`; real ids are UUIDs) | Pending recurring saves made by a preview user |
| `cvf_workout_outbox_<log id>` and that log's rest-timer key, where the log id is one the mock issued | Offline workout queue for a preview workout |

Everything else is preserved: `cvf_preview_role`, `cvf_preview_client_id`, auth tokens
(`cvf_access_token`, `cvf_refresh_token`), `cvf_rest_alerts`, `cvf_install_dismissed`,
`cvfpt_visual_intensity`, the one-time page-entrance record, `sessionStorage`, and any key not
listed above. The list lives next to the mock so a new preview-owned key is added in one place; the
plan confirms the mock's log-id form and the rest-timer key format before relying on them.

### Network speed

A select: **Normal / Slow (1.5 s) / Very slow (4 s)**.

It writes the existing `cvf_preview_latency` key as one catch-all rule, `[{ "path": ".*", "ms": 1500 }]`,
or removes the key for Normal. `previewLatencyFor` (`previewMode.js:958`) is reused unchanged, so
tests that set their own per-route rules keep working. Takes effect on the next request; no reload.

### Failures

A select: **Off / Fail next save / Fail loads**, stored in `cvf_preview_fail` as `write-once` or `reads`.

**What counts as a save.** A request is a *read* if it is a GET or one of the POSTs that only
compute a result: `/sessions/series/preview`, `/sessions/series/check`, and
`/programs/import/parse-csv`, `parse-paste`, `parse-pdf`. Every other non-GET is a *save*. Without
this, previewing dates would consume "Fail next save" before Create is ever pressed. The read-like
list sits beside the fault code; `/auth/*` is exempt from both modes.

| Value | Behavior |
|---|---|
| `write-once` | The next save rejects with 503 `{ error: 'Simulated failure (preview)' }` and leaves fixture data unchanged. The key is then cleared, so a retry succeeds. |
| `reads` | Every read rejects with the same 503 until the control is set back to Off. Turn it off and tap a screen's Retry to watch recovery. |

**The route is identified first; a save failure is injected before its handler runs.** The mock
keeps a table of every route that changes fixture data (`PREVIEW_SAVE_ROUTES`). For a request that
matches it while "Fail next save" is on, the adapter clears the switch and returns the 503 without
calling the handler, so nothing is changed and no handler event is emitted. Reading and clearing the
switch is synchronous, so of several concurrent saves exactly one fails and the others are kept.

Running the save and undoing it was rejected: undoing cannot retract events a handler emitted, and
restoring a snapshot erases other requests' saves that completed in between.

**A fault never hides a missing or unsupported route.** Those routes are not in the table, so a save
to one reaches the handler chain and its 404 or 422 passes through unchanged, without consuming the
switch. For "Fail loads" the read handler runs first — reads do not change fixture data — and only a
result that is not a missing or unsupported route is replaced by the 503.

**The table is kept honest by the suite.** A save the handler chain serves that is absent from the
table logs `[cvf-preview:unlisted-save]`; the shared test fixture fails on it, the same way it fails
on a missing mock.

When `write-once` fires, the adapter emits a dedicated `cvf-preview-switch-change` event so the
toolbar select returns to Off. It does not reuse `cvf-preview-change`: `AuthContext` answers that
event by replacing the user object, which would re-run user-dependent effects in the middle of the
failed save. A simulated failure does not use the missing-mock marker.

503 is deliberate here: it is what puts retry-safe forms into their "outcome unknown" path.

### Active indicator

When speed or failures are not at their defaults, the collapsed mobile toggle shows a small dot and
the desktop "Preview Mode" label reads "Preview Mode · modified". A stuck "Fail loads" from an
earlier visit is the main way this layer could mislead, so it must be visible without opening the panel.

### Tests added

- Reset: mutate data (approve the pending booking), set both switches, plant an auth token and a
  non-preview key, tap Reset; the booking is pending again, both switches read default, and role,
  client, the token and the non-preview key are all still there.
- Fail next save: a save shows the screen's error, the select returns to Off, fixture data is
  unchanged, and the retry succeeds exactly once (no duplicate row).
- Concurrent saves with Fail next save on: exactly one fails and the others are kept.
- A fault does not mask a missing mock: with Fail loads on, an unmocked GET still returns the 404
  and is collected by the detector (run with `allowMissingMocks: true`).
- Fail loads: a top-level page shows its accessible retry state; turning it off and tapping Retry
  loads the page.
- Slow: with Slow selected, a page's skeleton is visible before content.

---

## Step 3 — Recurring sessions in preview

### Shape of the change

- New `frontend/src/lib/previewSeries.js` holds the series logic as pure functions with relative
  imports only, so it is testable under `node --test` like `seriesPlan.js`. `previewMode.js` imports
  it; because `previewMode.js` itself loads only by dynamic import in preview mode, the new file stays
  out of the production bundle the same way.
- `previewMode.js` gains the four route handlers, a `state.sessionSeries` array, series fields on
  session reads, and a seeded series. `previewMode.js` is already ~2,200 lines; keeping the logic in
  its own file is the targeted improvement, not a wider refactor.

### Rule expansion — a third copy

The frontend has no rule expander; the only one is `expandSeriesRule` in
`backend/src/lib/sessionSeries/rule.js`. The deploy boundary rules out importing it, so
`previewSeries.js` carries a port: Monday-start weeks counted from the week containing `start_date`,
`interval_weeks`, `count` or `until`, weekdays before `start_date` skipped in the first week, max 52,
365-day horizon.

The same file ports `candidateTimes` from `backend/src/lib/sessionSeries/alternatives.js` for
suggestions (below).

Guard against drift: a new `frontend/tests/unit/previewSeries.test.mjs` asserts both ports against
the same input/expected vectors the backend tests use, copied in. CLAUDE.md's "Known duplication"
gains an entry for these copies.

### Routes

Shapes mirror `backend/src/routes/sessionSeries.js` as the UI consumes them.

| Route | Preview behavior |
|---|---|
| `POST /sessions/series/preview` | Expand the rule; return `{ slots }`, each `{ key, date, time, scheduled_at, display, conflict, suggestions }`. Mirrors the three user-reachable 400s with the real messages: more than 52 sessions, past one year from the start, slot in the past. |
| `POST /sessions/series/check` | Return `{ seq, slots }` with the request's `seq` echoed. Per slot: `conflict` and up to three `suggestions`. |
| `POST /sessions/series` | Create or replay; see below. |
| `PATCH /sessions/series/:seriesId/cancel` | Set `status = 'cancelled'` on that series' scheduled, unarchived sessions at or after the anchor's start. Return `{ cancelled: [{ id, scheduled_at }] }` sorted by time. Unknown series or anchor not in it → 404 with the real messages. |

**Times.** Slots are Denver wall-clock. `previewSeries.js` converts date + time to a UTC
`scheduled_at` with an `Intl`-based helper pinned to `America/Denver`, and formats `display` the same
way, so the result does not depend on the reviewer's device timezone.

**Conflicts.** Existing sessions are checked with the existing `previewScheduleConflict`
(`scope: 'coach'` or `'client'`, with `session` and `display`). Overlaps between two rows of the same
request return `scope: 'batch'` with `with_key`, on both rows.

**Suggestions.** Same rules as the server's `candidateTimes`: same day only; 15-minute steps out to
±180 minutes; ordered nearest first (+15, −15, +30, −30, …); start times limited to 05:00–20:45,
the date-time picker's range; never at or before the current time, which the server refuses at save.
The first three candidates free of both kinds of conflict are returned, in that order.

**Create.**

1. `request_id` already in `state.sessionSeries` with an identical body → 200 `{ series, receipt, replayed: true }`.
   Different body → 409 `{ code: 'request_mismatch' }` in the real `MISMATCH` shape.
2. Any conflict → 409 `{ error: 'Some dates are no longer available', conflicts }`; nothing is created.
3. Otherwise push one session row per slot (`series_id`, `workout_id` exactly as sent, ordinary
   `scheduled` sessions), store the series with its receipt, and return 201
   `{ series, receipt, replayed: false }`. `receipt.slots` is `[{ key, session_id, scheduled_at, workout_id, ordinal }]`.
4. `assign_program: true` reproduces what the real save does (`schedule_session_series` step 4e,
   via `assign_program_clone`), because the visible result differs from a plain assignment —
   including which Edit controls the coach sees:
   - **Skip** if the client already has an unarchived assignment to that program **or** to an
     unarchived program whose `source_program_id` is that program.
   - **Otherwise** create a private client copy the way `assign_program_clone` does: the source
     must be an unhidden template; the copy keeps the template's name, has `is_template: false`,
     `client_id`, and `source_program_id`, and belongs to the **client's coach**. Each program day
     gets **its own** workout copy (also owned by the client's coach, with `source_workout_id`),
     even when two days share one template workout, so editing one day never changes another.
     The copy is assigned.
   - Session `workout_id`s are stored exactly as sent; nothing is remapped to the copy.
5. `notify` is accepted and ignored. Preview sends nothing.

The mock's ordinary `POST /programs/:id/assign` (`previewMode.js:2110`) assigns the template
directly and does not clone. Whether that also diverges from the real route is outside this spec;
the copy helper is written so that handler could reuse it later.

**Reload resets the demo, including pending saves.** The real composer persists an unresolved save
(`cvf_series_pending:<user>:<client>`) and retries the same request after a reload. In preview the
fixtures are rebuilt on every load, so that retry would find no record of the request and create a
fresh series — a recovery screen describing something that never happened in the current demo.
Preview therefore clears pending series saves belonging to fixture coaches when the mock installs,
before the app renders. A reload is a clean start; the composer opens as a new draft.

Cross-reload recovery, replay and `request_mismatch` are not reviewable in preview and stay covered
by the mocked-API series suite. Within one page load the request-id lookup above still applies.

**Reads.** `GET /sessions` and `GET /sessions/:id/coach-detail` add `series: { id, rule, created_count }`
and `series_ordinal` for series sessions, which is what `SeriesBadge` and `CancelSessionDialog` read.
Client-facing reads are unchanged, as in the real API.

### Seed

One existing series so the badge and "this and all future" cancel are reviewable without creating
one first: David Chen with Marcus, weekly, six sessions — two past and completed, four upcoming.
Not on Sarah.

Constraint: the seed must not disturb existing tests. Sessions sit at 12:00 for 45 minutes, outside
Marcus's seeded availability windows (06:00–11:00, 16:00–20:00) and clear of `session_david` and the
seeded time off. If a collision shows up when the suite runs, the times move; the tests do not.

### Remove the temporary exclusions

The four series entries leave `PREVIEW_UNSUPPORTED`.

### Tests added to the preview suite

- Seeded series shows its badge on the coach Sessions list and session detail.
- Create a weekly series whose second date collides with an existing session: the row is flagged,
  a suggestion chip clears it, Create enables, and the new sessions appear on the list.
- Cancel "just this one" leaves the rest; cancel "this and all future" cancels from the anchor on and
  leaves completed sessions alone.
- With **Fail next save** on (step 2), previewing and checking dates do not consume it; Create lands
  in "Save status unknown"; Retry creates the series once.
- "Also assign this program": a client without it gets a private copy assigned; a client who already
  has the template or a copy of it gets no second assignment.
- After an unresolved save, a reload opens the composer as a fresh draft with no recovery prompt.

`series-mocked.spec.mjs` remains the authority for the composer's edge cases (stale check responses,
reload recovery, mismatch). Those are not duplicated here.

---

## Documentation changes

- **CLAUDE.md "Preview mode"** — the owner's amended section, with two refinements agreed in review:
  backend-only changes are exempt from the preview rule only when they do not change API behavior
  the UI uses; and the evidence line names "backend/database tests and relevant integration checks".
  It can land before step 1; its two enforcement mechanisms (the list and the suite failure) become
  true when step 1 merges.
- **CLAUDE.md "Known duplication"** — add the `previewSeries.js` rule expander (step 3).
- **CLAUDE.md Status** — one sentence on the recurring-sessions entry once step 3 merges.
- The recurring-sessions spec's "`previewMode.js` is not extended" line is left as the historical
  record; this spec supersedes it.

## Delivery

Three small PRs off current `main`, in order. Each leaves the preview suite green on its own.

| PR | Verification |
|---|---|
| 1 | Preview suite green with the detector on; the three new tests; production build. |
| 2 | Preview suite; the five new control tests; production build. |
| 3 | Frontend unit tests including `previewSeries.test.mjs`; preview suite with the seven new tests; mocked-API series suite unchanged and green; production build, with a check that no `previewSeries` code is in the production bundle. |

No backend, migration or deploy-order implications: every change is under `frontend/`.

## Open risks

- **Triage size (step 1).** The count of routes the suite already hits without a mock is unknown.
  A large number makes PR 1 bigger than it looks.
- **Detector test mechanics.** Importing `/src/lib/api.js` inside `page.evaluate` relies on the Vite
  dev server returning the same module instance the app uses. If it does not, the fallback is to
  drive a real screen whose route is on the unsupported list.
- **Third copy of the rule expander and suggestion times.** The vector test catches drift only for
  the vectors it holds. A backend rule change must update both the port and the vectors.
- **Save-route table.** "Fail next save" applies only to routes in `PREVIEW_SAVE_ROUTES`. The suite
  proves the table complete for the saves it exercises; a save no test touches could be missing.
- **`test.fail()` and fixture teardown.** Not yet confirmed on Playwright 1.61.1; a fallback is
  specified in step 1.
- **Seed collisions.** The seeded series may still collide with an existing test's assumptions about
  Marcus's calendar; the constraint above says which side moves.
