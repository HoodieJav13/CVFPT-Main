# Workout tracking and notification audit findings

Audit date: 2026-07-17

Baseline commits: workout tracking `7d95208`, `97c76cc`, and `2de6e5d`; plans 001–005 implemented through `5371ad7`.

Scope: client Programs start/resume, active workout tracking, offline save recovery, rest timer, extra sets, partial completion, completed workout detail, coach notification badge/list, coach workout detail, Message Client, reduced motion, responsive layout, workout authorization/integrity, and the applied workout schema.

Existing coverage at audit start: backend source-contract tests for authorization and database integrity; preview E2E for start, one offline weight edit, extra-set add/remove, completion, immutable detail, notification navigation, button motion, and reduced-motion primitives; hosted real-auth verification for load overrides, completion, immutability, assigned-coach isolation, Message Client, and unchanged credits.

Audit evidence is in [`design-plans/artifacts/006`](artifacts/006). Captures use deterministic preview data at 390×844, 768×1024, and 1440×1000. Code inspection covered `WorkoutTracker.jsx`, `WorkoutLogDetail.jsx`, `Notifications.jsx`, `NotificationsContext.jsx`, `AppShell.jsx`, the workout/notification Express routes, the applied workout migration, and the backend, preview, and hosted workout tests.

## Critical and high findings

### P1 — Concurrent duplicate extra-set retries can return `500`

Observable problem and consequence: the extra-set route performs a read-before-insert idempotency check. Two requests carrying the same valid `client_operation_id` can both miss the pre-check; one insert succeeds and the other reaches a unique violation that the route converts to a generic `500`. An offline retry can therefore remain stuck even though the requested set already exists.

Evidence: `POST /api/workout-logs/:id/exercises/:exerciseId/sets` in `backend/src/routes/workoutLogs.js` checks globally by operation ID, then inserts, while the applied migration declares `client_operation_id uuid unique`. The catch block maps every insert error to `500`. No existing hosted test races the duplicate operation.

Exact affected behavior: retrying the same extra-set creation concurrently; the existing sequential retry path can return the prior row.

Required correction: scope the initial lookup to the owned workout exercise and, after an insert unique violation, re-read that same scoped operation and return it as the idempotent result. Preserve non-idempotency conflicts as errors and do not edit the applied migration.

Verification needed for closure: a hosted regression issues the same operation twice concurrently and asserts both responses identify one set, followed by the existing offline/outbox flow and backend regressions.

Status: open.

## Moderate findings

### P2 — Per-set weight-unit selectors have indistinguishable accessible names

Observable problem and consequence: all nine unit selectors in the audited tracker expose the name `Weight unit`. A screen-reader or voice-control user cannot tell which exercise and set a selector changes.

Evidence: the 390px tracker accessibility snapshot lists nine `combobox "Weight unit"` nodes while the neighboring weight fields are named by exercise and set. Source: `frontend/src/pages/client/WorkoutTracker.jsx`. Visual reference: [`workout-tracker-390.png`](artifacts/006/workout-tracker-390.png).

Exact affected behavior: every prescribed or extra set's lb/kg selector in the active tracker.

Required correction: include exercise name and set number in each trigger's accessible name without changing its visible compact label.

Verification needed for closure: preview E2E asserts unique contextual names for prescribed and newly added extra sets, plus keyboard selection and the frontend build.

Status: open.

### P2 — Coach quick-add overlaps Message Client on mobile

Observable problem and consequence: at 390×844, the fixed coach quick-add button occupies the right end of the full-width Message Client action at the bottom of workout detail. It obscures content and intercepts part of the action's touch area.

Evidence: [`coach-workout-detail-message-390.png`](artifacts/006/coach-workout-detail-message-390.png) shows both controls at the same vertical position. Runtime geometry places Message Client at `y=712–748` and the 52px quick-add control at approximately `y=712–764`. Owners: `frontend/src/pages/WorkoutLogDetail.jsx` and `frontend/src/components/layout/AppShell.jsx`.

Exact affected behavior: coach/admin mobile completed-workout detail when scrolled to feedback and Message Client.

Required correction: reserve enough route-local bottom space for the fixed coach action while preserving the quick-add control and the client detail layout.

Verification needed for closure: a 390px preview regression proves the two rectangles do not intersect, Message Client remains at least 44px tall and navigates to the correct client conversation, and tablet/desktop remain unchanged.

Status: open.

### P2 — Completion and notification idempotency lack concurrent runtime coverage

Observable problem and consequence: the applied RPC uses a row lock and notification uniqueness, but current hosted verification completes only once and checks only the assigned and unrelated coaches. A regression in lock/idempotency behavior or active-admin fan-out could pass the current suite.

Evidence: `complete_workout_log` uses `FOR UPDATE` and `ON CONFLICT ... DO NOTHING`; `frontend/e2e/live-auth.spec.mjs` sends one completion request and does not inspect active-admin delivery or duplicate notification counts.

Exact affected behavior: simultaneous completion, repeated completion, duplicate assigned-coach/admin notifications, unrelated-coach isolation, partial-completion skipping, and credit invariance under retries.

Required correction: extend hosted workout verification to race completion requests, retry after success, assert one completed record/result and exactly one notification for the assigned coach and active admin, assert none for the unrelated coach, and re-check credits.

Verification needed for closure: the focused hosted workout test and the complete hosted workout verification pass against the applied schema.

Status: open.

### P2 — Notification read-failure recovery is implemented but unverified

Observable problem and consequence: individual and mark-all handlers await the server before navigation or reloading, which appears safe, but no regression proves a rejected read leaves the row/badge state truthful and the user on the notification list. A future optimistic update could silently reintroduce false read state.

Evidence: `frontend/src/pages/coach/Notifications.jsx` catches both failures and only navigates after a successful individual read; current preview and hosted tests cover success only.

Exact affected behavior: failed `PATCH /notifications/:id/read` and failed `PATCH /notifications/read-all`.

Required correction: fault-inject both hosted browser requests, assert no incorrect navigation or read-state change, remove the fault, and prove the same actions recover.

Verification needed for closure: focused hosted browser regression plus existing notification success flow.

Status: open.

### P2 — Offline outbox coverage does not prove full operation ordering

Observable problem and consequence: the outbox serializes and remaps pending extra-set IDs, but the current preview test queues only one weight edit offline and performs add/remove online. Ordering across weight, unit, completion, notes, extra-set creation, pending-ID edits, and removal is therefore not protected by a behavioral regression.

Evidence: `useWorkoutOutbox` in `WorkoutTracker.jsx` contains the ordering/remap logic; `preview-critical.spec.mjs` takes the browser offline only around a single weight edit.

Exact affected behavior: reconnect replay order, completion gating while dirty, and add/edit/remove of an extra set before its server ID exists.

Required correction: expand the deterministic preview E2E to queue mixed operations offline, verify completion remains blocked, reconnect, wait for `Saved`, and assert the server-shaped completion result reflects the final ordered state without a duplicate extra set.

Verification needed for closure: preview E2E passes at 390px and the final detail proves performed weight/status/notes and extra-set removal.

Status: open.

## Lower-severity and maintenance findings

- The desktop preview toolbar can cover part of the tracker sticky action row at 1440px. This is isolated to the preview-only control surface and did not affect the production shell or the audited workout behaviors. It should be revisited if the toolbar becomes a general visual-regression harness.
- The reduced-motion audit is behaviorally covered by computed animation assertions; still screenshots are intentionally not treated as proof of motion timing.

## Controls verified as present

- Trainers preset sets, reps, RPE, rest, and starting load; the client tracker exposes performed weight/unit and extra-set controls without editing the prescribed fields.
- Prescribed sets remain in completed detail and unfinished sets become `skipped`; completion requires one completed set.
- A partial unique index permits one active workout per client.
- Completion and notification creation occur in one database transaction. Completed parent and child records are trigger-protected from mutation.
- Assigned coaches and active admins are selected as recipients; notification uniqueness is keyed by recipient, event type, and workout log. Unrelated coaches are ownership-filtered.
- Notifications use 30-second/focus polling only; no Realtime, push, or email path exists.
- Workout migration/RPC and route sources contain no `client_credits` read or mutation.
- The applied `20260717043317_workout_tracking_notifications.sql` and the five preceding dormant payment migrations were not edited during this audit.
- Offline operations are persisted in local storage, replayed serially, and keep completion disabled until the outbox reports `Saved` and the browser is online.
- Dialog, select, dropdown, and shared buttons use the plan 002 vocabulary and plan 005 fade-only reduced-motion path.
- Programs, tracker, completion, notification, and detail screens show no horizontal overflow at 390, 768, or 1440 pixels. The 390px offline state, rest timer, extra set, partial completion dialog, and completed details remain readable without clipped primary actions.
- Message Client resolves to the completed log's client-specific conversation.

## Regression and hosted-verification status

Audit-baseline status:

- Plans 001–005: implemented in five scoped source commits after the tracking commit; their relevant frontend builds and preview suites passed before this audit.
- Backend workout authorization/integrity regressions: present and passing at the accepted workout baseline.
- Preview workout completion/notification E2E: present and passing at the accepted workout baseline.
- Hosted workout verification: present for load override, completion, immutability, assigned-coach isolation, Message Client, and unchanged credits; concurrent/admin/failure cases remain open findings above.
- Migration replay: required after fixes even though no schema change is currently indicated.
- Combined closure suite: pending resolution of the open findings.
