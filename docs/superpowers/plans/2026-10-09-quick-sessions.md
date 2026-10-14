# Quick Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL for later authorized execution: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax. This handoff authorizes drafting only; it does not authorize executing this plan or spawning implementation agents.

**Goal:** Implement the settled coach-created, dated Quick Session without shared-template clutter, duplicate creates or stale-response leaks.

**Architecture:** Express normalizes and authenticates requests; service-only transactional RPCs own receipts, private-workout creation, hidden-template save and quick-only edit/start serialization. Server reads provide completion and safe provenance; an in-memory frontend controller fences responses and persists only one metadata record per request. Existing tracking and standalone paths remain intact.

**Tech Stack:** Existing React 19 / Vite 6, Node/Express, Supabase/Postgres, node:test and Playwright. No dependency additions; isolated frontend/backend Vercel roots.

**Spec:** `docs/superpowers/specs/2026-10-09-quick-sessions-design.md` (corrected draft accompanies this plan).

## Global Constraints

- Coach/admin creation only, with server-enforced current client access.
- Always ordinary `dated` mode, default **today in America/Denver**.
- One transaction creates a private client workout and its assignment.
- Start is independent after confirmed create; a retry only starts the existing assignment.
- Optional **Also save to shared studio library**, off by default, is a separate idempotent operation after confirmed create.
- Browser recovery storage contains routing and request identity only, never workout payloads.
- Existing `active` standalone repeat availability is intentional.
- No applied migration may be edited, renamed, removed or reordered.
- No shared cross-root import; no seeds or test accounts against production; no real notifications in tests.
- Current authority is **documents only**. All steps below are prospective and unchecked, including SQL/test creation. Implement only in a newly authorized isolated checkout after independent review.

## Review Focus

These input classes are pinned to the owning tasks, not left as informal cautions:

1. Browser midnight or reload changes default date/title: freeze resolved fields for same-body retries; re-entry still uses the original UUID (Tasks 1/5, A1/A4).
2. Original client loses access while a new target remains accessible: authorize both without disclosing original receipt (Task 3, A2).
3. Completed log is older than the history page or assignment is archived: active filter remains correct, historical label survives (Task 4, A7/A8).
4. Abandoned/archived started log or alternate edit route: never restores quick pre-start editing rights (Task 3, A9).
5. Hidden library exercise changes after commit or another tab clears pending metadata: replay is recovery, storage event is only a refresh signal (Tasks 3/5, A3/A5).

All A1–A12 tests in the spec are required. Each task references the owning IDs;
no test result is claimed by this draft.

---

## Source map and execution boundaries

Baseline is exact commit `1b3950b8c87e1e5a7b5e75c58ae203e95bf62639` on
`claude/quick-sessions`, whose only change from reviewed main is the source spec.
This plan is based on an archive copy, not an edited original worktree. Do not
apply a patch blind to a newer main: review the exact diff and reconcile touched
contracts first. Read `/Users/jav/Documents/Codex/Portfolio/EXECUTION-PREFERENCES.md`
alongside repository instructions in any execution handoff outside this folder.

Existing integration points:

| Source at baseline | Responsibility |
|---|---|
| `backend/src/routes/programs.js` | `trackingExercises` at 42; hidden admission at 295; create/update at 449/484; coach assignment read at 942, load edit at 996, client assigned at 1047 |
| `backend/src/lib/workoutMetrics.js`, `backend/src/lib/supersets.js` | Typed metrics and kept-row/full superset normalization |
| `backend/src/lib/trainingLibrary.js` | Explicit client assignment allowlist; private fields default excluded |
| `backend/src/routes/workoutLogs.js` | Detail/bulk builders at 354/404, paged history at 75, start at 559, notification condition at 615 |
| `supabase/migrations/20261005165134_workout_duration_distance.sql:86` | Existing six-argument save_workout update/id/removal/load-archival behavior; read only |
| `supabase/migrations/20260720173000_exercise_performance_history.sql:32` and `20260730203738_workout_actor_rpcs_v2.sql:15` | Start core and v2 wrapper; read only, redefine forward if necessary |
| `frontend/src/pages/coach/ClientDetail.jsx` | Assign selector, private-copy editor, assigned/history lists |
| `frontend/src/pages/coach/Programs.jsx` | Existing workout builder patterns; reuse behavior without restructuring it |
| `frontend/src/pages/client/Programs.jsx`, `Home.jsx`, `frontend/src/lib/clientTodayPlan.js`, `frontend/src/pages/WorkoutLogDetail.jsx` | Client active cards, due priority, history/detail labels |
| `frontend/src/context/AuthContext.jsx`, `frontend/src/lib/previewMode.js` | Session epoch integration and fixture API |
| `supabase/tests/workout_metrics/`, `session_series/` | Owned disposable stack, transaction/race/teardown patterns |

A future migration filename is `supabase/migrations/<reserved-version>_quick_sessions.sql`.
`<reserved-version>` is an execution-time monotonic version reserved after fresh
migration inventory/invite coordination, not SQL to create now. Use one forward
migration for the approved feature; exact definitions/grants get independent
review. No existing migration file is modified by any task.

## Task 1: Normalize the complete create contract and fingerprint

**Files:** Create `backend/src/lib/quickSessions.js` and
`backend/test/quick-session-normalization.test.js`; modify
`backend/src/routes/programs.js` only to share its full normalization contract
within the backend. Keep existing route tests in `backend/test/workout-metrics-mounted.test.js`
and `backend/test/supersets.test.js`.

**Interfaces:**
- Export `normalizeQuickSessionCreate(body, {today}) -> {request_id, payload}`.
  `payload` is the spec's canonical v1 `{version, client_id, assigned_for, name, notes, exercises}`.
- Export `quickSessionHash(payload) -> string` (`v1:` + SHA-256 canonical UTF-8 JSON).
- Export backend-local `trackingExercises(exercises, previous=[]) -> normalizedRows`
  for existing create/update and new create, preserving previous-row merge and superset behavior.
- `today` is an injected Denver ISO date; actor is absent from these inputs and
  is taken from authentication only by Task 3. No frontend/backend shared import.

- [ ] Write failing A1 normalization tests: `equivalent_forms_replay` asserts alias
  precedence, empty → null, numeric normalization, default units, blank-row skip,
  superset canonicalization and stable sorted JSON. `every_prescription_field_is_hashed`
  changes each spec field in turn and asserts a different hash; reorder and client
  change differ. `resolved_defaults_are_frozen` uses a Denver midnight boundary;
  title is exactly `Quick session · <assigned_for>`.
- [ ] Write rejection tests for actor/hash/template/workout-id fields, row ids,
  invalid UUID/date/tracking/units, and unsupported behavior-bearing fields.
  Preserve existing normalization expectations for ordinary routes.
- [ ] Run `cd backend && node --test test/quick-session-normalization.test.js test/workout-metrics-mounted.test.js test/supersets.test.js`;
  confirm new tests fail for missing interfaces, not fixture errors.
- [ ] Implement those exact exports with the writer-aligned field/default rules
  in spec R2; no mutable library names/visibility enter the hash.
- [ ] Rerun the command; require all cases pass. Record command, counts and exact
  source SHA. Commit only this backend contract after relevant checks pass.

## Task 2: Establish SQL parity, then extract the shared writer

**Files:** Future new forward migration; create
`supabase/tests/quick_sessions/{stack.sh,stack_guard_test.sh,run.sh,parity.sql}`;
retain `supabase/tests/workout_metrics/assertions.sql` unchanged as a regression.
Wire local-only suite into `.github/workflows/ci.yml` when executable tests exist.

**Interfaces:**
- Internal `public.sync_workout_exercises(p_workout_id uuid, p_exercises jsonb) -> void`
  owns retained-row update/insert/removal and both assignment-load archival families.
- Existing `public.save_workout(uuid, uuid, text, text, text, jsonb) -> uuid`
  keeps the identical signature/return and top-level create/update semantics.
- All helpers security invoker, empty search path, schema-qualified, no public/
  anon/authenticated EXECUTE. Task 3 adds the quick guard without changing ordinary semantics.

- [ ] Write A10 behavioral fixture sequence on the **pre-feature** schema, with
  a stable report of relational results and explicit existing ids. Exercise
  template create, private update, same-library id retention, custom identity
  `  Squat  ` ↔ `sQUAT`, changed identity replacement, removal and reorder, empty
  row skipping, archived exercises, omitted versus explicit-null typed metrics,
  notes/units/video/supersets, retained loads and removed/replaced loads in both
  assignment families. Assert invalid metric/update rollback restores title,
  exercise rows and both load families; archived workout update returns null.
- [ ] Build the owned local test runner from the existing isolation pattern with
  distinct project id `cvfpt-quick-sessions-test`; fail closed if Docker ownership
  cannot be verified, no linked/hosted target, teardown only owned resources.
  Run stack guards; capture the before report. No server connection strings or
  workout payloads in evidence intended for external delivery.
- [ ] After separate implementation authorization, put the extraction in the
  one new migration. Run the same sequences after applying it locally; compare
  relational reports after mapping generated ids/timestamps, and independently
  require expected retained ids to match. Do not change old migrations.
- [ ] Add actual SQL role probes and function-definition/grant checks for
  helper and outer RPC EXECUTE/search_path; denied low-privilege execution must
  fail and service invocation must succeed. Schema/regex tests supplement this.
- [ ] Run `bash supabase/tests/quick_sessions/stack_guard_test.sh`,
  `bash supabase/tests/quick_sessions/run.sh --parity --down` and
  `bash supabase/tests/workout_metrics/run.sh` sequentially; require before/after
  equality, assertions PASS and verified teardown. This new runner defines
  `--parity`, `--down`, full `--all`, and race selection for subsequent tasks.
- [ ] Commit the parity/extraction unit after local evidence and exact SQL review
  for that unit. If later tasks amend the same migration before any hosted
  application, review the final complete SQL again.

## Task 3: Atomic receipts, independent library save, and quick edit/start guard

**Files:** Same future new migration; modify `backend/src/routes/programs.js`
(create/status/library/edit handlers), `backend/src/lib/quickSessions.js`;
create `backend/test/quick-session-routes.test.js`,
`supabase/tests/quick_sessions/{fixtures.sql,receipts.sql,library.sql,edits.sql,concurrency.sh}`.
Use existing `backend/test/workout-tracking.test.js`,
`session-private-copy-access.test.js` and `quick-complete.test.js` for regressions.

**Interfaces:** Spec R2 defines create/library RPC signatures. Add backend
`authorizeQuickReceipt(user, receipt, suppliedClientId) -> authorized context | masked not_found`,
using read errors as errors, not null; `quickAssignmentForResponse(user, assignmentId)`
rechecks current access before serialization. RPC is still the transactional
authority. Handler envelopes/status codes are exactly spec R1. Database internal
`lock_quick_session_for_write(p_workout_id uuid) -> void` acquires the quick-only
lock sequence and checks source existence; a separate guard checks ever-started
for edits (not for start or library). Calls on ordinary workouts preserve existing behavior.

- [ ] Write failing mounted-route tests A1–A3/A6/A9 for new/replay/mismatch,
  coach/admin/client scope, caller actor spoof, null actor, reassignment/archive,
  cross-client same key with inaccessible original, pointer replay access,
  read failure and independent failure/retry envelopes. Mismatch body has no
  original data; browser recovers through status. Library list unchanged by create.
- [ ] Write SQL receipt/constraint/grant tests and controlled committed races:
  identical creates, competing bodies with original-first and re-entry-first,
  same request other actor, archived receipt no replacement, replay after
  library visibility change, fresh hidden admission rejection. Authorize the
  original and supplied clients within the receipt transaction.
- [ ] Write edit/start races with two database connections and barriers, in both
  orders, for generic save_workout and assignment-load writes. Assert edit-first
  gives a whole new snapshot; start-first rejects edits with no partial mutation.
  Any started log including abandoned/archived blocks quick edits; ordinary
  private/template edits and snapshots retain baseline behavior. Also race edit
  against template clone and assert one coherent prescription.
- [ ] Run `cd backend && node --test test/quick-session-routes.test.js test/workout-tracking.test.js test/session-private-copy-access.test.js test/quick-complete.test.js`
  and `bash supabase/tests/quick_sessions/run.sh --all --down`; verify expected
  new-contract failures before implementing and retain their cause.
- [ ] Implement receipt columns/check/immutable trigger/unique index (including
  quick client/workout identity immutability), advisory
  locking, atomic create and separate clone/pointer. After finding an existing
  receipt, acquire its quick-workout lock before client/assignment locks;
  a new create has no shared quick workout to lock until it creates one.
  Multiple clients lock in UUID order. Return no details after access loss.
- [ ] Enforce guard inside save_workout and assignment-load writer and quick
  start core **before existing log locks**, covering v2 and quick-complete.
  Quick order is workout advisory → client → assignment → workout → log → rows.
  Revalidate source after locks. No route-only check or unguarded alternate
  editor/RPC path; keep signatures/snapshots for ordinary sources. Map begun
  quick edit to 409 `quick_session_started` in existing edit endpoints.
- [ ] Implement mounted routes with normalized payload/hash from Task 1 and
  auth-derived actor. Do not run fresh hidden admission before receipt replay.
  Recheck actual source access on status, library replay and response hydration.
  Start notification logic remains unchanged; tests stub all delivery.
- [ ] Rerun the same commands plus Task 2 parity; require one-row race counts,
  independent retry behavior, role/grant proof and owned teardown. Independently
  review complete lock graph/SQL before commit. No hosted operation.

## Task 4: Authoritative completion and safe history/detail labels

**Files:** Modify `backend/src/routes/programs.js`,
`backend/src/routes/workoutLogs.js`, `backend/src/lib/trainingLibrary.js`;
create `backend/src/lib/quickSessionReads.js` and
`backend/test/quick-session-reads.test.js`; extend
`backend/test/workout-history-paging.test.js`, `training-library.test.js` and
`supabase/tests/quick_sessions/reads.sql`. Include service-only completion-read
helper in the future migration; do not rewrite adherence/week-rhythm/digest code.

**Interfaces:**
- `quickCompletionFlags(clientId, assignmentIds, {db}) -> Map<assignmentId, boolean>`:
  database EXISTS per requested quick source across all non-archived completed
  logs, no history pagination or Supabase default row-limit truncation.
- Service-only `get_quick_session_completion(p_client_id uuid, p_assignment_ids uuid[])`
  returns one id/boolean per authorized requested quick assignment; Express
  enforces target access before invocation. Read failures propagate.
- `quickLogKinds(authorizedLogs, {db}) -> Map<logId, 'quick'|'assigned'|null>`
  uses each log's own assignment join including archived sources, no private fields.
- Assignment payload gains safe `kind`, `quick_session_completed`; log payload
  gains safe `workout_assignment_kind`. All other serializers stay allowlisted.

- [ ] Write A7/A8 tests with a completed quick source older than 50 newer logs
  (and SQL case beyond a default read limit), tracked/untracked completion,
  active/abandoned sources, source archival and query failures. Assert assignment
  read retains underlying rows; no archive writes; active filter input is true.
- [ ] Assert single detail and coach/client paged bulk history agree, including
  archived source; program null/ordinary assigned; no actor/hash/request/pointer/
  other-client/coach-note data is exposed by provenance. Preserve history order,
  pagination count and original snapshots. Assert quick_completed remains independent.
- [ ] Run `cd backend && node --test test/quick-session-reads.test.js test/workout-history-paging.test.js test/training-library.test.js`;
  inspect expected missing-field/query failures before implementing.
- [ ] Implement EXISTS flags and safe kind projection in the listed modules,
  add the two assignment allowlist fields, wire detail and bulk builders. Keep
  completion-read errors visible instead of returning false. Do not filter raw
  source arrays used for analytics/adherence/week rhythm/digest.
- [ ] Rerun the command and `bash supabase/tests/quick_sessions/run.sh --all --down`;
  include counts/history/adherence/digest behavioral regressions for unchanged
  ordinary active/dated assignments. Commit after passing checks.

## Task 5: Metadata-only recovery controller, builder and list consumers

**Files:** Create `frontend/src/lib/quickSessionRequest.js`,
`frontend/src/components/training/QuickSessionBuilder.jsx`,
`frontend/tests/unit/quickSessionRequest.test.mjs`; modify
`frontend/src/context/AuthContext.jsx`, `frontend/src/pages/coach/ClientDetail.jsx`,
`frontend/src/pages/client/Programs.jsx`, `Home.jsx`,
`frontend/src/lib/clientTodayPlan.js`, `frontend/src/pages/WorkoutLogDetail.jsx`.
Use existing `ExerciseTrackingFields.jsx`, metrics/supersets and token styles.

**Interfaces:**
- `pendingKey({environment, actorId, requestId}) -> string` exactly spec R1.
- `persistPending(storage, record, scope) -> {recoverable:boolean}` writes/validates
  immutable allowlisted metadata before dispatch, never a payload/map.
- `removeMatchingPending(storage, scope, record) -> boolean` removes only exact
  matching validated immutable entry; corrupt/mismatched entries need Discard.
- `captureQuickOperation(context) -> fence`; `isCurrentQuickOperation(fence, context) -> boolean`
  compare actor/authEpoch/pageToken/requestId/clientId/operationGeneration,
  and assignmentId on subsequent operations.
- `createQuickSessionController({api, storage, getContext, clock})` exposes
  `save(form,intent)`, `recover(record)`, `reenter(record)`, `retryStart(assignmentId)`,
  `retryLibrary(assignmentId)`, `discard(record)` and `dispose()`; no create from
  retryStart/retryLibrary. It holds only in-memory payload and current identity.
- Auth context exposes monotonic in-memory `sessionEpoch`, changed on auth/session
  replacement; page token is per mounted controller. No stored auth token/epoch.

- [ ] Write A4/A5/A6 unit tests using deferred API promises and controllable
  storage: persisted-before-send, no payload in any write, same id on 404/500/
  timeout, target access recheck before re-entry, mismatch→status winning version,
  account/session/page/current-request/operation change before resolution,
  exact-key deletion, second request preservation, blocked/full/corrupt entries,
  tabs same/different UUIDs and storage removal without record resurrection.
  Test fresh same-actor login invalidates old replies; test start/library callbacks too.
- [ ] Assert known create/status success clears only matching entry; Discard
  warns and is scoped; no auto-expiry/new-id create; midnight identical retry
  freezes date/title. Lost start reply retry resumes; lost library reply retries
  only library; either follow-up failure leaves confirmed assignment intact.
- [ ] Run `cd frontend && node --test tests/unit/quickSessionRequest.test.mjs`;
  require failures for missing controller/fencing rather than unrelated setup.
- [ ] Implement the controller and epoch integration. Before all response side
  effects/chained calls run the fence. Status not_found retains uncertainty;
  authorized re-entry keeps UUID. Storage events schedule guarded status reads
  only. Clear private in-memory data on dispose/account changes; never persist
  through workoutOutbox or coachActionQueue.
- [ ] Implement builder under Assign and independently retryable saved-state
  actions. Use exact spec copy, Denver default and existing typed exercise fields.
  Connect private-copy edit 409 to refresh/read-only messaging. Add label and
  quick-completed-only active-card suppression to all three consumers; retain
  Home priority and active-log dominance. History/detail use the safe enum.
- [ ] Rerun unit command, `cd frontend && npm run test:unit` and `npm run build`.
  Validate no cross-root imports with `bash scripts/check-boundaries.sh frontend`.
  Commit functional changes separately from any later visual-direction changes.

## Task 6: Preview fixtures, independent browser races and paired evidence

**Files:** Modify `frontend/src/lib/previewMode.js`;
create `frontend/e2e/quick-sessions-preview.spec.mjs`,
`frontend/e2e/quick-sessions-mocked.spec.mjs`,
`frontend/playwright.quick-sessions.config.mjs`; update default Playwright
`testIgnore` and `.github/workflows/ci.yml` for the separate mock-server suite.
Future evidence: `docs/quick-sessions/validation.md` and
`docs/quick-sessions/visual-review/{index.html,manifest.json,captures/}`.
No screenshots or runtime tests are produced by this drafting pass.

**Interfaces:** Preview implements the Task 3/4 envelopes and UI states. Mocked
suite owns an isolated local server and retained fake database across reloads;
its config ignores hosted auth, stubs all notification delivery, refuses reuse
of a foreign web server and is isolated from preview/series/analytics servers.

- [ ] Add a separate fictional quick-session scenario with existing Sarah
  fixtures unchanged, relative dates, ephemeral preview memory, phone-accessible
  slow/error controls and all API envelopes/label fields from the spec. Keep
  Production gate hard-off and PREVIEW_UNSUPPORTED explicit.
- [ ] Write A11 preview test using `test` from `./preview-test.mjs`: Assign →
  typed builder/More/validation → save → Quick session on coach/client/Home
  when selected by existing priority → complete → active suppression and history/
  detail label. Exercise start conflict, library failure/retry, status uncertainty
  and started edit rejection; missing mock must fail, never call real backend.
- [ ] Write A4–A6 independent mocked-network browser tests: lost create reply +
  reload; status before delayed commit; original-first/re-entry-first bodies;
  masked access reassignment; account/page/new-request changes while reads pending;
  concurrent tabs same/different UUID; blocked/corrupt storage. Inspect decoded
  storage and dispatch counts; no create from start/library retry. Fake server
  commit survives reload even though preview fixture memory intentionally resets.
- [ ] Run `cd frontend && npm run test:e2e:preview` and
  `npx playwright test --config playwright.quick-sessions.config.mjs`;
  require all new tests pass, retained full-suite counts/skips explained. Separately
  run SQL suite for authorization/concurrency; preview is not that evidence.
- [ ] Record visual-direction classification from spec R5. Keep existing
  patterns/tokens; if a genuine direction delta emerges, produce compliant and
  materially distinct bold alternatives with exact deltas and route through the
  established owner/cold-review gate. Do not claim self-certified distinctiveness.
- [ ] Render actual baseline/proposed **full SHAs** under identical fictional
  fixture/clock/theme/state at 320px, 390px and 1440px desktop. Capture full
  viewport plus useful full-page context. Today's Assign/Standalone selector is
  creator baseline; new-only builder has no invented old counterpart. Pair shared
  selector/list/history states and honestly caption new-only states.
- [ ] Populate manifest (SHA, fixture, clock, theme, logical state, viewport,
  actual image dimensions, relative image path, SHA-256, caption, limitations,
  classification); include errors/overlays/navigation. Build compact comparison,
  inspect pixels and rendered HTML/PDF. Attach evidence paths to validation record;
  visible change is incomplete without actual evidence.
- [ ] Run both deploy-boundary scripts, `cd backend && npm test`,
  `cd frontend && npm run test:unit`, `npm run build`, full preview and mocked
  suite, and quick SQL/full parity suite once on final changed head. Run existing
  CI-required series/auth/analytics and existing metrics/series SQL suites as
  applicable to touched auth/start/shared writer; record failures/skips honestly.
  Repeat only for new changes or unresolved failures. Commit scoped fixtures/tests
  and evidence; do not publish or deploy without separately recorded authority.

## Task 7: Assemble review and future release record

**Files:** Future `docs/quick-sessions/validation.md` and
`docs/hardening/quick-sessions-hosted-release.md`; scoped CLAUDE status update
only when authorized implementation makes it stale. This task assembles evidence;
release actions below remain separately gated.

- [ ] Map A1–A12 to exact test names/commands, SQL race output, expected/actual row
  counts and screenshots; record candidate full SHA, complete diff, SQL SHA-256,
  runtime/check counts and independent review disposition. Existing 41/41 source
  claim is **reported 2026-10-09**, not fresh hosted clearance.
- [ ] Before any release action, independently inspect both hosted ledgers and
  open migration PRs with then-authorized read-only tools, timestamp the evidence
  and coordinate invite work. Require at most one unapplied migration PR in
  flight. If one exists while Quick Sessions is pending, it must be the Quick
  Sessions candidate; otherwise sequence the other migration first. Zero is valid
  before the candidate PR exists or after both targets are applied and labelled.
  No hosted checks occur in this draft task.
- [ ] Prepare exact backward-compatible SQL and rollback/legacy preservation
  evidence for independent review. Separate owner authority is needed for each
  hosted target; no credential handling and no production seeds/probe data
  outside explicitly approved scope. Mechanical checks are agent work after access.
- [ ] Only after exact SQL approval and hosted authority, apply/verify development
  and production independently before either application label is asserted.
  Record target refs, exact migration/hash, ledger/dry-run/schema/grant results,
  counts and authorized probe cleanup. Both labels and required CI/evidence must
  be present before owner merge.
- [ ] Disclose that owner merge automatically deploys both Vercel projects;
  verify exact merged SHA reaches both READY deployments and relevant boundaries
  after merge. Never promise migration-first after merge. Keep application
  rollback separate from schema recovery; no applied-migration rewriting.

## Self-review and current handoff status

Spec coverage: R1→Tasks 3/5/6; R2→Tasks 1/2/3; R3→Tasks 3/4/5;
R5→Tasks 6/7; shared-save finding 4→Task 2 and Task 3 guard/parity rerun.
A1–A3→1/3; A4–A5→5/6; A6→3/5/6; A7–A8→4/5/6; A9→3;
A10→2/3; A11→6; A12→7. Interface names, envelopes, metadata fields and enum
values are shared explicitly above. Tasks do not create new standalone behavior,
new product choices, or cross-root dependencies.

This local plan is a draft for task44's independent review. All implementation,
runtime/database/browser tests, screenshots and release steps remain **not run**
(not applicable to this documentation-only authorization). No owner response or
Claude relay is needed to complete this bounded drafting handoff.
