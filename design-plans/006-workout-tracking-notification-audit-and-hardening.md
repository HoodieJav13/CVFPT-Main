# Workout tracking and notification audit findings

Audit date: 2026-07-17
Verification updated: 2026-07-17

Baseline commits: workout tracking `7d95208`, `97c76cc`, and `2de6e5d`; plans 001–005 implemented through `5371ad7`.

Scope: client Programs start/resume, active workout tracking, offline save recovery, rest timer, extra sets, partial completion, completed workout detail, coach notification badge/list, coach workout detail, Message Client, reduced motion, responsive layout, workout authorization/integrity, and the applied workout schema.

Existing coverage at audit start: backend source-contract tests for authorization and database integrity; preview E2E for start, one offline weight edit, extra-set add/remove, completion, immutable detail, notification navigation, button motion, and reduced-motion primitives; hosted real-auth verification for load overrides, completion, immutability, assigned-coach isolation, Message Client, and unchanged credits.

Audit evidence is in [`design-plans/artifacts/006`](artifacts/006). Captures use deterministic preview data at 390×844, 768×1024, and 1440×1000. Code inspection covered `WorkoutTracker.jsx`, `WorkoutLogDetail.jsx`, `Notifications.jsx`, `NotificationsContext.jsx`, `AppShell.jsx`, the workout/notification Express routes, the applied workout migration, and the backend, preview, and hosted workout tests.

## Critical and high findings

### P1 — Concurrent duplicate extra-set retries can return `500` (fixed locally)

Observable problem and consequence: the extra-set route performs a read-before-insert idempotency check. Two requests carrying the same valid `client_operation_id` can both miss the pre-check; one insert succeeds and the other reaches a unique violation that the route converts to a generic `500`. An offline retry can therefore remain stuck even though the requested set already exists.

Evidence: `POST /api/workout-logs/:id/exercises/:exerciseId/sets` in `backend/src/routes/workoutLogs.js` checks globally by operation ID, then inserts, while the applied migration declares `client_operation_id uuid unique`. The catch block maps every insert error to `500`. No existing hosted test races the duplicate operation.

Exact affected behavior: retrying the same extra-set creation concurrently; the existing sequential retry path can return the prior row.

Required correction: scope the initial lookup to the owned workout exercise and, after an insert unique violation, re-read that same scoped operation and return it as the idempotent result. Preserve non-idempotency conflicts as errors and do not edit the applied migration.

Verification needed for closure: a hosted regression issues the same operation twice concurrently and asserts both responses identify one set, followed by the existing offline/outbox flow and backend regressions.

Resolution: `5f78bec` scopes both operation lookups to the owned workout exercise and handles PostgreSQL `23505` by re-reading and returning the winning row only when the same operation now exists. `1c62ce2` adds a secret-free source regression and a hosted race that sends the same operation twice concurrently; both responses succeeded and returned the same set ID.

## Moderate findings

### P2 — Per-set weight-unit selectors have indistinguishable accessible names (fixed locally)

Observable problem and consequence: all nine unit selectors in the audited tracker expose the name `Weight unit`. A screen-reader or voice-control user cannot tell which exercise and set a selector changes.

Evidence: the 390px tracker accessibility snapshot lists nine `combobox "Weight unit"` nodes while the neighboring weight fields are named by exercise and set. Source: `frontend/src/pages/client/WorkoutTracker.jsx`. Visual reference: [`workout-tracker-390.png`](artifacts/006/workout-tracker-390.png).

Exact affected behavior: every prescribed or extra set's lb/kg selector in the active tracker.

Required correction: include exercise name and set number in each trigger's accessible name without changing its visible compact label.

Verification needed for closure: preview E2E asserts unique contextual names for prescribed and newly added extra sets, plus keyboard selection and the frontend build.

Resolution: `2262bc9` names each trigger as `<exercise> set <number> weight unit` while leaving `lb`/`kg` as the visible value. The expanded preview regression asserts contextual names for prescribed sets and an optimistically added extra set, then exercises the selector as part of offline replay. The focused and full preview suites pass.

### P2 — Coach quick-add overlaps Message Client on mobile (fixed locally)

Observable problem and consequence: at 390×844, the fixed coach quick-add button occupies the right end of the full-width Message Client action at the bottom of workout detail. It obscures content and intercepts part of the action's touch area.

Evidence: [`coach-workout-detail-message-390.png`](artifacts/006/coach-workout-detail-message-390.png) shows both controls at the same vertical position. Runtime geometry places Message Client at `y=712–748` and the 52px quick-add control at approximately `y=712–764`. Owners: `frontend/src/pages/WorkoutLogDetail.jsx` and `frontend/src/components/layout/AppShell.jsx`.

Exact affected behavior: coach/admin mobile completed-workout detail when scrolled to feedback and Message Client.

Required correction: reserve enough route-local bottom space for the fixed coach action while preserving the quick-add control and the client detail layout.

Verification needed for closure: a 390px preview regression proves the two rectangles do not intersect, Message Client remains at least 44px tall and navigates to the correct client conversation, and tablet/desktop remain unchanged.

Resolution: `2262bc9` reserves route-local mobile space below Message Client, and `f3ea44e` keeps the action at least 44px tall. The 390px regression scrolls to the real action, compares both bounding rectangles, proves no intersection, and follows the client-specific link. Fixed evidence: [`coach-workout-detail-message-390-fixed.png`](artifacts/006/coach-workout-detail-message-390-fixed.png).

### P2 — Completion and notification idempotency lack concurrent runtime coverage (fixed locally)

Observable problem and consequence: the applied RPC uses a row lock and notification uniqueness, but current hosted verification completes only once and checks only the assigned and unrelated coaches. A regression in lock/idempotency behavior or active-admin fan-out could pass the current suite.

Evidence: `complete_workout_log` uses `FOR UPDATE` and `ON CONFLICT ... DO NOTHING`; `frontend/e2e/live-auth.spec.mjs` sends one completion request and does not inspect active-admin delivery or duplicate notification counts.

Exact affected behavior: simultaneous completion, repeated completion, duplicate assigned-coach/admin notifications, unrelated-coach isolation, partial-completion skipping, and credit invariance under retries.

Required correction: extend hosted workout verification to race completion requests, retry after success, assert one completed record/result and exactly one notification for the assigned coach and active admin, assert none for the unrelated coach, and re-check credits.

Verification needed for closure: the focused hosted workout test and the complete hosted workout verification pass against the applied schema.

Resolution: `1c62ce2` races two completion requests, retries after success, and asserts the same completed log is returned each time. The hosted run proves partial completion still skips the remaining prescribed/extra sets, the assigned coach and active admin each receive exactly one notification, the unrelated coach receives none, completed children remain immutable, and the credit balance is unchanged.

### P2 — Notification read-failure recovery is implemented but unverified (fixed locally)

Observable problem and consequence: individual and mark-all handlers await the server before navigation or reloading, which appears safe, but no regression proves a rejected read leaves the row/badge state truthful and the user on the notification list. A future optimistic update could silently reintroduce false read state.

Evidence: `frontend/src/pages/coach/Notifications.jsx` catches both failures and only navigates after a successful individual read; current preview and hosted tests cover success only.

Exact affected behavior: failed `PATCH /notifications/:id/read` and failed `PATCH /notifications/read-all`.

Required correction: fault-inject both hosted browser requests, assert no incorrect navigation or read-state change, remove the fault, and prove the same actions recover.

Verification needed for closure: focused hosted browser regression plus existing notification success flow.

Resolution: `1c62ce2` fault-injects both mark-all and individual read requests in the hosted browser flow. Each failure keeps the user on Notifications with the target row still unread and surfaces the server error. Removing the injected failures lets the same individual action mark read and navigate to the correct workout detail.

### P2 — Offline outbox coverage does not prove full operation ordering (fixed locally)

Observable problem and consequence: the outbox serializes and remaps pending extra-set IDs, but the current preview test queues only one weight edit offline and performs add/remove online. Ordering across weight, unit, completion, notes, extra-set creation, pending-ID edits, and removal is therefore not protected by a behavioral regression.

Evidence: `useWorkoutOutbox` in `WorkoutTracker.jsx` contains the ordering/remap logic; `preview-critical.spec.mjs` takes the browser offline only around a single weight edit.

Exact affected behavior: reconnect replay order, completion gating while dirty, and add/edit/remove of an extra set before its server ID exists.

Required correction: expand the deterministic preview E2E to queue mixed operations offline, verify completion remains blocked, reconnect, wait for `Saved`, and assert the server-shaped completion result reflects the final ordered state without a duplicate extra set.

Verification needed for closure: preview E2E passes at 390px and the final detail proves performed weight/status/notes and extra-set removal.

Resolution: `1c62ce2` queues weight and unit changes, a completion toggle, exercise notes, extra-set creation, a pending-ID weight edit/completion, and extra-set removal while offline. The regression proves bulk/finish actions remain disabled, reconnect reaches `Saved`, and the server-shaped completed detail contains the final `37.5 kg` performed load, note, one completed set, eight skipped sets, and no removed `42.5 kg` extra set.

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

Closure status:

- Plans 001–005: implemented in five scoped source commits after the tracking commit; each relevant frontend build and preview suite passed before the next plan began.
- Backend regressions: 56/56 passing, including workout ownership, service-role isolation, transactional RPC contracts, no-credit coupling, and scoped duplicate extra-set recovery.
- Frontend build: passing. The existing large-chunk advisory remains informational and predates this audit.
- Preview browser suite: 10/10 applicable tests passing; seven live-auth tests are intentionally skipped without hosted credentials. The expanded workout test covers contextual labels, mixed offline ordering, completion gating, immutable results, notification navigation, and mobile action geometry.
- Focused hosted workout verification: 1/1 passing against the hosted preview Supabase schema through the local fixed backend. It covers duplicate extra-set retry, concurrent/repeated completion, partial completion, notification deduplication and recipient boundaries, read-failure recovery, immutability, Message Client, and unchanged credits.
- Migration replay: all 13 migrations applied in order to isolated PostgreSQL 17.6, including the five dormant payment-related migrations and `20260717043317_workout_tracking_notifications.sql`. `supabase migration list --local` reports all 13 local/remote entries aligned. No migration file changed and no new schema correction was needed.
- Responsive/reduced-motion evidence: actual screens were exercised at 390×844, 768×1024, and 1440×1000; no horizontal overflow was observed. The shared reduced-motion computed-style regression passes for tracker select, completion dialog, and shell dropdown.
- Repository integrity: applied workout/payment migrations remain untouched and `git diff --check` passes.
