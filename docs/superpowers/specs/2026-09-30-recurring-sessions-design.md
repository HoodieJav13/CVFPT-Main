# Recurring Sessions — Design

Status: draft v3 for owner review (2026-09-30). No code written. v2 and v3 incorporate two
external reviews, each checked against the code; see "Changes" at the end.

## Problem

A coach adds client sessions one at a time (`SessionEditorDrawer.jsx` → `POST /sessions`).
A client who trains every Tuesday and Thursday for twelve weeks means twenty-four
separate form submissions. Coaches also want to attach the client's program
workouts to those sessions without picking each one by hand.

## Decisions (made with the owner)

| Topic | Decision |
|---|---|
| Series model | A series creates a **batch of ordinary sessions** tagged with a shared `series_id`. Each session stays independently editable. No rolling/open-ended series, no edit-the-whole-series operation. |
| Pattern | Weekly, one or more weekdays, every 1 or 2 weeks, same time and duration. Ends after N sessions or on a date. At most 52 sessions per series, all inside the horizon window below. |
| Conflicts | Preview before saving. Conflicting dates are flagged and can be fixed in place (change the date or time, or tap a nearest-free-slot suggestion) or unticked. Save is enabled only when every ticked row is conflict-free. |
| Save-time conflicts | **All-or-nothing**: if any ticked slot became unavailable between preview and save, nothing is created, the conflicting rows are marked in the preview with the coach's edits preserved, and the coach fixes them and saves again. |
| Notifications | A **Notify client when saved** checkbox (default on): one summary email and push for the whole series, sent only after a successful new save. |
| Program | Optional. Picking a program maps its days onto the sessions in order; every mapping stays editable. An **Also assign this program to the client** checkbox is on when the client does not already have the program and hidden when they do. |
| Cancel | Cancelling a series session offers "just this one" or "this and all future", and both honor the Notify client checkbox. |
| Timezone | `America/Denver` (the studio convention), labeled in the editor and preview. |

## Non-goals

- Editing time, duration or location for a whole series at once. Editing stays per session through the existing form.
- Monthly, daily, "last Friday" or other custom patterns.
- Rolling series that generate sessions in the background.
- Holiday calendars. Any date can be unticked.
- Enforcing availability windows or time off. They do not block sessions today (`routes/availability.js` only reports impact) and a series
  follows that. Suggestions ignore them. (A future advisory warning is possible; not in v1.)
- Showing series information to clients.
- Durable notification retry. Delivery is best-effort, as for every existing session notification.
- Launching an assigned program day directly from a session (see "What the mapping delivers").
- Changing credits, payments or bookings. Booking approval and auto-book keep creating single sessions.

## Existing behavior this builds on

- `sessions` rows are independent. Conflicts are enforced by the `schedule_session` RPC
  (`20260730220646_session_conflict_protection.sql`), which takes a global advisory lock
  (`cvf_session_scheduling`, transaction-scoped) and returns ordinary `coach_conflict` / `client_conflict` outcomes rather than raising, backed by the GiST
  exclusion constraints `sessions_no_coach_overlap` (capacity 1 only) and `sessions_no_client_overlap`. Ranges are half-open
  (back-to-back is allowed). The coach check also honors `capacity > 1` group slots by remaining headcount.
- `POST /sessions` and `PUT /sessions/:id` call the RPC and **then** validate and attach `workout_id` (`sessions.js:210` before `:222`;
  `:256` before `:268`). A bad workout therefore returns 400 after the session was already created or moved.
- `validateWorkoutAttachment` requires `workout.coach_id === coachId`, so shared workouts (`coach_id` null) are rejected although
  `GET /programs/workouts` offers them.
- `PATCH /sessions/:id/cancel` always sends an email and push (`sessions.js:305-310`).
- `sessions.workout_id` references a shared `workouts` template and is a plan hint shown on the client's session page and used to
  prefer a session when a workout log auto-links. It does not assign anything and carries no program/day context.
- A program is `program_days` rows (`day_number` 1–5), each pointing at a `workouts` row. Assigning a program is
  `POST /programs/:id/assign` → RPC `save_program_assignment_with_loads(uuid, uuid, uuid, text, jsonb)`; a second non-archived
  assignment of the same program to the same client is a 409.
- `backend/src/utils/time.js` can format a date in a zone and compute "today", but has **no** Denver wall-clock → UTC converter.
- `supabase/tests/` already holds SQL assertion scripts, including a concurrency one (`coach_feedback_concurrency_assert.sql`); the Supabase CLI is
  installed and `supabase/config.toml` targets Postgres 17.

## Data model

One additive, backward-compatible forward-only migration in `supabase/migrations/`. No existing migration file is edited.

```
session_series
  id             uuid primary key default gen_random_uuid()
  coach_id       uuid not null references coaches(id)
  client_id      uuid not null references clients(id)
  program_id     uuid null references programs(id)     -- display only
  rule           jsonb not null                        -- display only, see below
  created_count  integer not null                     -- sessions created at save time
  request_id     uuid not null                         -- idempotency key, one per coach-side draft
  request_hash   text not null                         -- hash of the normalized request body
  receipt        jsonb not null                        -- immutable creation receipt, see below
  archived       boolean not null default false        -- soft-delete convention; unused in v1
  created_at     timestamptz not null default now()
  unique (coach_id, request_id)

sessions
  series_id      uuid null references session_series(id)
  series_ordinal integer null                          -- 1-based chronological position at creation
  partial index on sessions(series_id) where series_id is not null
```

- `rule` records what the coach chose so the UI can label the series ("Weekly · Tue/Thu", "Every 2 weeks · Tue"). It is never used to
  regenerate sessions. It is the *original* pattern: individual dates may have been adjusted or added, and the UI and notification say so
  rather than implying every session follows the rule.
- `receipt` is written once at creation and never updated: `{ slots: [{ key, session_id, scheduled_at, workout_id }] }`, in chronological order,
  keeping the original occurrence keys (including keys of added rows) and the original times. Occurrence keys within a request must be unique
  (validated).
- `series_ordinal` and `created_count` give a **stable** badge, "Session 3 of 12", that does not change when an earlier session is later cancelled.
- The new table follows the existing convention: RLS enabled with no policies, access limited to `service_role`.
- Nothing is hard-deleted. Cancelling sets `sessions.status = 'cancelled'`.

### Shared conflict helper: `find_session_conflict`

The review correctly noted that "one place" is false if the scheduler keeps its own copy of the rules. The migration therefore **extracts** the
existing coach/client blocker queries into a read-only SQL function and has both the scheduler and the new functions call it:

```
find_session_conflict(p_coach_id uuid, p_client_id uuid, p_scheduled_at timestamptz,
                      p_duration_minutes int, p_exclude_session_id uuid default null) returns jsonb
  -- null, or { scope: 'coach'|'client', conflict_session: <sessions row> }
```

- Its body is the current logic moved verbatim: coach blocker (capacity-1 overlap, or `capacity > 1` filled to its headcount), then client blocker; cancelled and archived rows
  ignored; half-open ranges via `session_time_range`.
- The migration redefines `schedule_session` with `create or replace` so it calls the helper. **Signature, return shape, advisory lock and location-advisory
  behavior are unchanged.** `approve_booking` / `request_booking` are untouched and keep working through it.
- Because this edits the live booking path, the change is guarded by: the existing `session-conflicts.test.js` and booking tests still passing, plus
  differential database tests asserting `schedule_session` and `find_session_conflict` agree on a fixture matrix.
- Owner veto available: the alternative is to leave `schedule_session` untouched, implement the checker separately, and protect the duplication with the
  same differential tests. This spec recommends the shared helper because the whole point is that preview and save cannot disagree.

### Read-only check function: `check_session_slots`

```
check_session_slots(p_coach_id uuid, p_client_id uuid, p_duration_minutes int,
                    p_slots jsonb,          -- selected rows: [{ key, scheduled_at }]
                    p_alternatives jsonb    -- [{ key, for_key, scheduled_at }] or null
                   ) returns jsonb
```

- **Selected rows.** Each is checked against existing bookings via `find_session_conflict`, and the selected rows are checked **against each other** by pairwise range overlap.
  Result per row: `{ key, conflict: null | { scope: 'coach'|'client', session } | { scope: 'batch', with_key } }`. Batch-internal conflicts reference stable row keys,
  never provisional session IDs.
- **Alternatives are independent candidates, not a batch.** Each alternative is checked against existing bookings **and every selected row except the row it
  would replace (`for_key`)**. Alternatives are never compared with one another, so nearby 15-minute candidates cannot block each other.
  Result per alternative: `{ key, for_key, free: boolean }`.
- Limits are separate: ≤ 52 selected rows; ≤ 600 alternatives per database call.
  The API generates at most 24 candidates per conflicting row and returns at most 3 free ones per row. A fully conflicting 52-row selection would generate 1,248
  candidates, so the API **chunks** alternatives into calls of ≤ 600 (e.g. 25 rows' candidates per call), passing **all selected rows as blockers in every call**,
  and merges the results under one client `seq`. A valid 52-row preview never fails because of suggestion expansion.
- Read-only; advisory. `schedule_session_series` remains the authority at save time.

### Batch function: `schedule_session_series`

A security-invoker, `service_role`-only plpgsql function (same revoke/grant pattern as the other RPCs). It runs the whole save in **one transaction**:

```
schedule_session_series(
  p_request_id uuid, p_request_hash text,
  p_coach_id uuid, p_client_id uuid,
  p_duration_minutes int, p_location text,
  p_rule jsonb, p_program_id uuid, p_assign_program boolean,
  p_slots jsonb            -- [{ key, scheduled_at (UTC ISO), workout_id|null }], chronological, keys unique
) returns jsonb
```

1. **Take the global scheduling advisory lock first** (transaction-scoped, held until commit/rollback).
2. **Then** look up `(coach_id, request_id)`. Doing the lookup under the lock means two simultaneous identical requests serialize: the first creates,
   the second finds the committed series and replays. Same `request_hash` → return the receipt (`replayed: true`); different hash → `outcome: 'request_mismatch'`.
3. **Evaluate, without writing:** compute every slot's conflicts — existing bookings via `find_session_conflict`, and pairwise overlap among the slots.
   If any conflict exists, return `{ outcome: 'conflicts', conflicts: [{ key, scope, conflict_session | with_key }] }` and **write nothing**. (No insert-then-rollback,
   so no provisional IDs are ever produced and no inner-exception trick is needed. Every conflict is reported at once.)
4. **Otherwise create, in a foreign-key-compatible order** (`sessions.series_id` references `session_series`, so the series row must exist before any session points at it):
   a. For each slot call `schedule_session` (create path), producing session rows with no series link. Because the lock is held and step 3 found no conflicts, any outcome
      other than `scheduled` is unexpected and raises, rolling back the whole transaction.
   b. Build the `receipt` from the created session IDs and the original slot keys/times.
   c. Insert the `session_series` row with its receipt.
   d. Update the created sessions: set `series_id`, `series_ordinal` and `workout_id`.
   e. If `p_assign_program`, call `save_program_assignment_with_loads` (skipped when a non-archived assignment already exists).
5. Returns `{ outcome: 'created', series, receipt, replayed: false }`; the replay path of step 2 returns `{ outcome: 'created', series, receipt, replayed: true }`.
   Any unexpected error rolls everything back (sessions, series row and assignment) and surfaces as a 500.

A **replay** returns the stored receipt (original keys, session IDs and original times) plus each session's *current* `status` (sessions stay editable, so current values
may differ from creation; the receipt shows what was created).

## Backend

New routes live in `backend/src/routes/sessions.js` (or a `sessionSeries.js` it mounts), registered before the `/:id` routes.
All require `requireAuth` + `requireCoach`.

### Slot format and timezone

Every API slot is `{ key, date: 'YYYY-MM-DD', time: 'HH:mm', workout_id? }`, interpreted as `America/Denver` wall-clock. The server converts
to UTC in one place, so the browser's timezone never affects a series, and responses return both `scheduled_at` (UTC) and Denver display
strings. This adds a new, unit-tested `denverWallClockToUtc` helper to `utils/time.js` (Intl-based; no new dependency unless it cannot be done
reliably). Daylight saving: a spring-forward gap time (e.g. 2:30 AM) resolves forward to the first valid instant; a fall-back ambiguous time
resolves to the first occurrence (daylight time).

### Horizon (one definition, used everywhere)

A series has a `start_date` (its first date, Denver). Every slot — generated, edited, added, suggested, or created — must satisfy
`today_denver <= date <= start_date + 365 days`, both ends inclusive, and `start_date >= today_denver`. Max 52 selected slots. Preview, check and create all receive
`start_date` (check and create inside the body; create also has it in `rule`) and enforce this identically.

### Occurrence generator (pure, unit-tested)

`expandSeriesRule(rule) → [{ key, date, time }]`

- Weeks are counted from the Monday-start week containing `start_date`; `interval_weeks: 2` takes every second such week. Weekdays earlier
  than `start_date` in its first week are skipped.
- End: `count` (N generated candidate sessions) or `until` (a date within the horizon).
- "N sessions" means N *generated candidates*. If the coach unticks two of twelve, ten are saved; the UI says "10 of 12 selected · last on Dec 18"
  and offers **+ Add a date** (an ordinary extra slot in the same series). The series is never silently extended.
- Keys are stable per row (deterministic from the rule index for generated rows; client-generated for added rows) and echoed in all responses.

### `POST /sessions/series/preview`

Body: `client_id`, `duration_minutes`, `rule` fields. Returns the generated `slots` with `scheduled_at` and display strings. The client then calls check
(the two may be combined server-side into one round trip; they share `check_session_slots`).

### `POST /sessions/series/check`

Body: `client_id`, `duration_minutes`, `start_date`, `slots` (**all currently ticked rows**), `seq` (a client counter echoed back).
Validates the same shape and horizon as create. For each conflicting row the API generates up to 24 candidate times within ±3 hours of the requested time in
15-minute steps, submits them in chunks of ≤ 600 as `p_alternatives` (with `for_key`; see `check_session_slots`), merges the chunk results, and returns up to three free ones per row
as `suggestions`.
Response: per-row `{ key, conflict, suggestions }` and `seq`. The UI re-sends the whole selection whenever a date, time, duration or selection changes, applies results
to *both* rows of a batch conflict, and ignores any response whose `seq` is older than the latest sent.

### `POST /sessions/series` — request identity and order of operations

Body: `request_id`, `client_id`, `duration_minutes`, `location`, `rule`, `slots: [{ key, date, time, workout_id|null }]`, `program_id|null`,
`assign_program`, `notify`.

Order matters so that a successful save can always be recovered:

1. **Shape validation only:** well-formed UUIDs, JSON types, slot count 1–52, unique keys, date/time formats. Normalize and compute `request_hash`.
2. **Authenticate the actor and resolve an existing operation.** Look up `session_series` by `(request_id, client_id)`. If found, the caller must be that series' coach or an
   admin (otherwise 404 — a known request id alone is never enough). Same hash → return the receipt (`200`, `replayed: true`), **skipping all time-sensitive and
   record-eligibility checks below**, so a saved request is still recoverable after its first session has started or a workout/program was later archived.
   Different hash → `409 request_mismatch`. If the client was since reassigned to another coach, the original coach and admins can still read the receipt;
   others get 404.
3. **Only for new operations**, validate current eligibility, all before any mutation: client access (`canAccessClient`, 404), program (exists, not archived,
   accessible — even when `assign_program` is false), all distinct `workout_id`s in **one** bulk query through the updated visibility rule, horizon, and no slot in the past.
4. Call `schedule_session_series` (which re-resolves the request under the lock, step 2 of the function, covering concurrent identical requests).
5. `conflicts` → `409` with `{ conflicts: [{ key, scope, session | with_key, display }] }`. Nothing was created.
6. `created` with `replayed: false` → `201` with `{ series, receipt }`. After commit, if `notify`, send one email and push (best-effort; failures logged and swallowed like
   existing notifications). `created` with `replayed: true` — which happens when two identical requests both passed step 2's early lookup and the second was resolved by the
   database function after waiting on the lock — is handled **exactly like the early replay**: `200`, same body shape, and **no notification**. The rule is
   `notify && !replayed`, evaluated on the function's result, not on the route's early lookup.
7. The server never remaps workouts: mappings are applied exactly as sent, including on replays.

### Request lifecycle (single rule, backend and UI)

- The UI mints **one `request_id` per draft** when the coach opens the Repeat panel and keeps it for that draft; it is never regenerated automatically.
- **Pending saves survive reloads and drawer closure.** Immediately before the first POST, the UI persists `{ request_id, frozen body, editor snapshot, state: 'pending' }` in browser storage
  (`localStorage`, in try/catch so the page still works when storage is unavailable), keyed by the authenticated user and client. On app load or drawer reopen, an unresolved
  pending operation is restored into the "Save status unknown" state and **no replacement id is minted while it is unresolved**. The record is cleared only on a definitive
  result (receipt received, or a definitive failure response). The **editor snapshot** (versioned: repeat configuration, every row including deselected ones, workout pins, and the rule the rows came from) is what lets a definitive conflict or error after a reload put the coach back in a fully editable draft; the frozen body is what is retried while the outcome is unknown. A record without a snapshot (older format) falls back to rebuilding the rows, pins and configuration from the submitted body (deselections and the starting day cannot be recovered that way). If storage is unavailable the page cannot offer this protection and the in-memory lock still applies; the UI says so.
- **Definitive outcomes** (any HTTP response): `400/404/409 conflicts` mean nothing was written. The coach edits and saves again with the *same* id (no receipt exists, so
  the changed body is simply a new operation under that id). `201`/`200` closes the draft.
- **Ambiguous outcomes** (timeout, network error, 5xx): the outcome is unknown. The panel locks into **"Save status unknown"**: the body is frozen, edits are disabled, and
  the only actions are **Retry** and **Check whether it saved** (both re-send the identical body and id). Only a definitive answer unlocks the form: either the receipt
  (show the created series) or a definitive failure (editable again).
- `request_mismatch` should be impossible under these rules; if it occurs it preserves the draft, shows the discrepancy, and does **not** retry under a new id.

### Cancellation

- `PATCH /sessions/:id/cancel` gains an optional validated boolean `notify`, **default true** (today's behavior preserved). Both the Sessions list and
  the session detail entry points pass it.
- `PATCH /sessions/series/:seriesId/cancel` — body `from_session_id`, `notify`. Verifies the series belongs to the caller (or admin) and that the anchor
  session belongs to **that series and client**. One statement cancels every session with that `series_id`, `status = 'scheduled'`,
  `archived = false`, `scheduled_at >=` the anchor's start, returning the rows actually changed. Completed and no-show sessions are never touched.
  If zero rows changed (a retry), no notification is sent. If `notify` and ≥ 1 row changed: one summary email and push.
- Cancelling never changes the workouts on remaining sessions.

### Notifications

- New `notifySeriesScheduled` (email) in `services/email.js`, plus a push via `sendToClient`, using the existing `dispatchEmail` / `dispatchPush`
  wrappers. Content is built from the **actual saved sessions**: count, the first five dates/times in Denver time, and a link to
  `/client/sessions`. If saved times vary, it says "times vary — see your schedule" rather than implying the original rule.
- New `notifySeriesCancelled`: number cancelled and the first five dates.
- "Silent" (`notify: false`) means no immediate creation message. Normal reminders and the daily digest still include these sessions, as for any
  session. The UI says this next to the checkbox.
- Delivery is best-effort; there is no durable retry queue.

### Workout attachment fixes (existing behavior, fixed alongside)

1. **Validation order.** In `POST /sessions` and `PUT /sessions/:id`, validate `workout_id` **before** calling `schedule_session`, so an invalid workout
   returns 400 with no session created or moved. (The window where the attach update itself fails after the RPC remains; it is a database error, not a
   validation outcome.)
2. **Shared workouts.** `validateWorkoutAttachment` accepts a workout that exists, is unarchived, and has `coach_id` null **or** equal to the
   owning coach.
3. A bulk variant validates a set of distinct IDs in one query for series.

### Series info on session reads

`GET /sessions` and `GET /sessions/:id/coach-detail` embed `series: { id, rule, created_count }` and `series_ordinal` for series sessions (one embed
on the existing select, no extra query). The badge reads "Weekly · Tue/Thu · Session 3 of 12". Client-facing routes are unchanged.

## Frontend

### Add-session drawer

`SessionEditorDrawer.jsx` gains a **Repeat** toggle in create mode only. To keep the file focused, the new UI is new components:

- `RecurrencePanel` — weekday chips, "every 1 / 2 weeks", end (after N sessions / on date), Program select, Starting day select,
  **Also assign this program to the client**, **Notify client when saved** (with a one-line note that reminders still apply), a "Times are Mountain
  (Albuquerque)" label, and **Preview dates**. It owns the draft's `request_id` and the "Save status unknown" state.
- `SeriesPreviewList` — one row per slot: checkbox, date and time (**both** editable inline), workout dropdown, and conflict state. A conflicting
  row shows what it clashes with (an existing session, or another row in this series), the free-slot suggestion chips, and the editors.
  A summary line: "10 of 12 selected · last on Dec 18", with **+ Add a date**. The footer reads "Create N sessions" and is disabled while any
  ticked row has a conflict, a check is in flight, or the check failed (inline retry).
- `lib/seriesPlan.js` — pure functions (see mapping rules).

### Program mapping rules

Given ticked rows in chronological order and a program with days D1…Dk, starting at day s:

- Automatic rows take days in sequence from s, wrapping after Dk. **Unticked rows take no day**, so later rows move up rather than a day being lost.
- A row the coach sets by hand is **pinned**: it keeps the chosen workout, **consumes its normal position in the sequence**, and does *not* change
  what the next row gets.
- Pins belong to the row (its key). Moving a row to another date keeps its pin; automatic rows are recomputed from chronological order.
- Chosen mappings are shown in the preview rows before saving; what is shown is exactly what is saved. After saving, nothing remaps.

Examples, program D1/D2/D3, starting day 1, six Tue/Thu rows R1–R6:
- No edits: D1 D2 D3 D1 D2 D3.
- R2 unticked (holiday): R1 D1, R3 D2, R4 D3, R5 D1, R6 D2.
- R3 pinned to D1 (it would otherwise be D3): R1 D1, R2 D2, R3 D1 (pinned, still occupies position 3), R4 D1, R5 D2, R6 D3.
- R1 moved to after R3 (becomes the third ticked row): automatic order is recomputed by chronology: R2 D1, R3 D2, R1 D3, R4 D1…; if R1 was pinned to D2, it stays D2.
- Starting day 2: D2 D3 D1 D2 D3 D1.

The assign checkbox is shown only when the client has no non-archived assignment of the selected program (from the existing client assignment data). Its default (on) is applied **only when the coach explicitly chooses a program** — never while restoring a saved draft or when program metadata finishes loading — so a deliberate "do not assign" survives recovery.

### What the mapping delivers

Saving the mapping attaches a **template workout** to each session as an editable plan hint, exactly as the existing single-session picker does. It does not carry the client's
program-day loads and does not itself start the assigned *program day* (`/workout-logs/start` needs the assignment and day ids). Starting a workout stays in the Programs
flow, which auto-links the log to the matching session (existing behavior). Direct launch from a session is out of scope for v1.

### Lists and detail

- Series sessions show the badge on the coach Sessions list and coach SessionDetail.
- The cancel dialog (`session-cancel-dialog`) for a series session offers **Just this one** / **This and all future (N)**, plus **Notify client**.
  Non-series sessions get the Notify checkbox as well (default on).

## Error handling

| Case | Behavior |
|---|---|
| Malformed body, duplicate keys, too many slots | 400, nothing created |
| Invalid/archived/foreign workout or program, slot in the past, outside horizon (new operation) | 400, nothing created |
| Client or program not accessible | 404, nothing created |
| Any slot conflicts (existing booking or another selected row) | 409 with all conflicting rows by key; nothing created; edits kept |
| Retry with the same `request_id` and body after success | Original receipt returned (even if the first session has since started or a workout was archived); nothing duplicated; no second notification |
| Two simultaneous identical requests | One creates, the other replays the same series |
| Same `request_id`, different body | 409; draft preserved, no automatic new id |
| Request id known but caller not the series' coach or an admin | 404 |
| Timeout / network / 5xx on save | UI locks in "Save status unknown" until the same request is resolved |
| Unexpected database error | Whole transaction rolls back; 500 |
| Notification send fails | Logged and swallowed; the series stays saved |
| Preview/check request fails | Inline retry in the list; Create stays disabled |

## Testing

**Database behavior in a disposable local database.** Committed-transaction races cannot be shown by rollback-only probes (if the first transaction is rolled back, a
waiting second one may succeed, which proves nothing about which commit won). The suite therefore runs against a disposable **local Supabase stack** (Docker + the installed
Supabase CLI, Postgres 17, `supabase start` / `db reset` applying `supabase/migrations/`), is discarded afterwards, and follows the existing `supabase/tests/*.sql`
style plus a small runner that opens real concurrent connections. A Docker readiness check (engine responds, API version compatible, enough memory for the Supabase stack)
is the first step before this layer is built; see Owner decisions #6.
Hosted-database probes remain a separately authorized release check, not a prerequisite for development.
- Same-`request_id`, same-body simultaneous calls: exactly one creation, one replay, identical series id. (The function result's `replayed` flag is asserted.)
- Insert-order and atomicity: the series row exists before any session's `series_id` is set, and a failure after the series insert rolls everything back.
- Different-`request_id` calls competing for overlapping slots: exactly one commit, the other gets `conflicts`.
- A mixed batch: nothing created, all conflicts reported by key, no series row, no stray rows.
- Unexpected error mid-batch rolls back sessions, series row and assignment.
- Replay returns the original receipt after one created session is rescheduled and another cancelled (receipt unchanged; current status shown).
- Same id, different hash → `request_mismatch`.
- Differential tests: `schedule_session` and `find_session_conflict` agree on a fixture matrix (capacity-1, capacity>1 filled and unfilled, a session starting before the
  window and overlapping it, back-to-back allowed, cancelled/archived ignored, client conflicts); `check_session_slots` agrees too.
- `check_session_slots`: an existing 09:00–10:00 booking yields a 10:00 alternative for the affected row; selected rows still block alternatives; nearby alternatives do not eliminate
  one another; an alternative is not blocked by the row it replaces; batch-internal conflicts are reported by key.
- Grants/revokes (service-role only), RLS enabled, the migration applies on top of the current schema, and existing session/booking SQL behavior is unchanged
  (the existing static `session-conflicts.test.js` plus the booking suites still pass).

**Backend route tests** (existing stubbed mounted-route style):
- Ownership and admin handling; replay authorization (known id, wrong coach → 404; admin ok).
- **Replay ordering:** a saved request retried after its first slot is in the past, or after its workout was archived, returns the receipt instead of 400; a new operation with
  those same problems returns 400.
- Shape validation precedes lookup; eligibility validation precedes any RPC (assert **zero** RPC calls on bad input for new operations).
- **Regression for the existing bug:** on `POST` and `PUT /sessions`, an invalid/foreign/archived workout returns 400 with zero `schedule_session` calls; a shared unarchived workout is accepted.
- Bulk workout validation issues one query for N slots.
- One notification regardless of N; none with `notify: false`; none on replay; none from a cancel that changed zero rows.
- `PATCH /sessions/:id/cancel` with `notify: false` sends nothing; default still notifies; non-boolean `notify` → 400.
- Series cancel: anchor must belong to the series and client; only `scheduled`, non-archived, on-or-after-anchor rows change.
- Check endpoint: horizon enforced from `start_date`; alternatives cap separate from the 52-row cap; **a maximum-size selection (52 conflicting rows, 1,248 candidates) is chunked
  into calls of ≤ 600 with all selected rows as blockers in each, and the merged result succeeds.**
- **Database-level replay path (mounted route):** when the early lookup finds nothing but the stubbed RPC returns `replayed: true`, the route responds `200` and sends no email or push.
- Generator: weekdays, interval 1/2, count and until ends, 52 and horizon limits (including count-based every-2-weeks), start-day alignment,
  DST spring-forward and fall-back, past start rejected. `denverWallClockToUtc` boundary cases.
- `lib/seriesPlan.js`: every example above, plus wraparound, starting day and pin-through-move.

**Browser (UI), test-owned Playwright fixtures.** A non-preview build with `page.route` network interception (as `frontend/e2e/live-auth.spec.mjs` already does), needing its own
setup because the preview Axios adapter bypasses the network. `previewMode.js` is not extended. Cases: edit one row onto another and see both flagged; a stale `check` response is ignored;
deselect and the "N of M" summary; manual override survives; save-time 409 returns rows with edits intact; a lost response ends in "Save status unknown", and Retry recovers the receipt
without creating a second series; edits are locked while the status is unknown. **Reload recovery:** drop the save response, reload the app, and confirm the same pending
request is restored (same id and frozen body), Retry recovers the same series, and the persisted record is cleared afterwards.

## Rollout

- `.agentic/PROJECT_POLICY.md`: merge to `main` triggers both Vercel Production projects; hosted migrations require explicit task authorization.
  The migration is additive and backward-compatible for existing callers (new table, nullable columns, new functions; the redefined `schedule_session` keeps its
  contract), so it can be applied and verified **before** merge, with the backend that uses it deployed after. The release must be sequenced and disclosed per that policy and
  `docs/hardening/2026-07-22-pr5-hosted-release.md`; this spec does not authorize any hosted migration or release.
- Separate commits: migration, backend, frontend functional changes, and any purely visual changes.
- No frontend/backend shared code. Denver conversion and the generator are backend-only; `lib/seriesPlan.js` is frontend-only and pure.
- Suggested build order: (1) validation-order and shared-workout fixes with regression tests (valuable on their own), (2) migration, helper, and database functions
  with local-database behavioral tests, (3) routes and notifications, (4) UI and Playwright fixtures, (5) release sequencing.

## Owner decisions (2026-09-30)

All design questions are resolved.

1. **Shared conflict helper — decided.** Extract `find_session_conflict`; `schedule_session` calls it. Guarded by the existing tests and new differential tests.
2. **Browser tests — decided.** Test-owned Playwright fixtures in a non-preview build with network interception; `previewMode.js` is not extended.
3. **Program-day launch — decided: not in v1.** Mapping stays an editable plan hint; launching stays in the Programs flow.
4. **Past start dates — decided: rejected** for new series (saved requests stay recoverable).
5. **Series badge — decided: coach-only** for v1.
6. **Local concurrency tests — decided.** Committed-transaction race tests run in a disposable local Supabase stack, not rollback-only probes.
   Prerequisite: a working Docker engine. The implementation plan starts with a readiness check and available startup steps run by the agent; the owner is asked only if
   a real installation, access, or system-permission problem blocks it. Status as of 2026-09-30: Docker Desktop and the Supabase CLI (2.118.0) are installed and Docker
   Desktop's processes are running, but every engine call (`docker version`, `info`, `ps`) returned HTTP 500 "check if the server supports the requested API version" for the
   CLI's API 1.55 (after an initial long hang), reproduced independently by a reviewer. So the engine is up but unhealthy or version-mismatched; "daemon stopped" is not the diagnosis.
   Likely remedies, to be tried by the agent in order: wait for Docker Desktop to finish starting, restart Docker Desktop, then align the CLI/engine versions.

## Success criteria

- A coach can create a 12-week Tue/Thu series for a client in one flow, with conflicts resolved in the preview, and every created session appears
  as an ordinary session everywhere it does today.
- Saving is all-or-nothing and retry-safe: no half-created series; no duplicates after a timeout, double-click, or two simultaneous identical requests; a saved request is
  always recoverable.
- With a program chosen, each session shows the mapped workout; each can be changed afterwards with the existing session editor.
- The client receives one summary message, not one per session, and none when the coach opts out.
- "This and all future" cancels exactly the remaining scheduled sessions of that series and honors Notify client; so does "just this one".
- An invalid workout on the existing single-session endpoints no longer leaves a created or moved session behind.

## Changes

**v1 → v2** (first external review, verified against code): transactional batch function (v1's claim that skipping conflicts required separate transactions was wrong);
`request_id` idempotency; check sends the whole selection and allows date edits; workout-validation-order bug; shared-workout rule; `notify` on single cancel; SQL conflict
checks matching the RPC (capacity, window boundary, row cap); stable ordinal badge; explicit mapping examples; "N sessions" semantics; Denver converter and DST choices;
notification content from actual dates; behavioral database tests. Owner-facing change of mine: save-time conflicts are all-or-nothing.

**v2 → v3** (second external review, verified): lock **before** the idempotency lookup; immutable `receipt` (keys, ids, original times); replay resolved before time-sensitive
and eligibility checks, with authorization; one request-id lifecycle and a "Save status unknown" state; suggestions modeled as independent alternatives excluding the replaced row;
`start_date` in check and one horizon definition; shared `find_session_conflict` helper (or documented duplication); batch conflicts reported by stable keys with no insert-then-rollback;
committed-transaction tests in a disposable local database. Not adopted: configurable timezones, hard availability blocks, durable notification retry.

**v3 → v3.1** (third external review, verified): pending saves persisted across reloads; foreign-key-compatible insert order (sessions, receipt, series row, then link);
database-level replays handled as `200` with no notification (`notify && !replayed`); suggestion checks chunked to ≤ 600 alternatives per call; Docker readiness is a diagnosed
first plan step rather than an assumed stopped daemon.

**v3.1 → v3.2** (plan review): editor draft keyed by client only so ordinary edits never reset it; editor snapshot persisted with the pending save; Create disabled until the current selection has been checked; database tests run only against an owned, disposable Supabase stack; Docker is never restarted without owner approval; the series browser suite is excluded from the preview suite and both new suites run in CI.

**v3.2 → v3.3** (second plan review): the assign-program default applies only on an explicit program choice; the disposable test stack is built in a staging directory and verified before use, teardown only ever targets the fixed test project id (never a project inferred from a copied config) and fails loudly if it cannot confirm removal; the isolation check fails when any Docker inspection fails and when teardown is incomplete; Docker-free failure-injection tests cover both scripts.
