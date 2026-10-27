# Quick sessions (coach-created) — corrected design

Status: draft for independent review, 2026-10-09. Corrects the five findings in
`/Users/jav/Documents/Codex/2026-10-08/task-44/quick-sessions-spec-review-1b3950b.md`
against source commit `1b3950b8c87e1e5a7b5e75c58ae203e95bf62639`, spec blob
`2d325f4a5a2e41efbaded601751a5f8d900d3e5c`. This draft and its companion plan
are documentation only: no feature implementation, SQL creation/application,
real emails, hosted data operations, pushes, merges or deployment are authorized.

## Problem and settled scope

Coaches need a one-off client workout without building a program or filling the
shared template library. Today **Client → Assign → Standalone workout** picks
an existing template; creating through `POST /programs/workouts` / `save_workout`
creates a visible shared template. That existing Assign flow is the honest UI
baseline for the new creator.

- Coach/admin creation only, with server-enforced current client access.
- Assign offers Program / Standalone workout / Quick session. Show the distinct
  **Quick session** label; use `workout_assignments.kind = 'quick'`.
- Always ordinary `dated` mode, default **today in America/Denver**. Reuse
  one-completion, overdue and planned-adherence semantics. Home considers the
  quick assignment among due candidates using its existing priority rules;
  it is not guaranteed to be the dominant card.
- One transaction creates a private client workout and its assignment. It
  creates no shared template; the default library list remains unchanged.
- Assign or Start now. Start is independent after confirmed create; a retry
  only starts the existing assignment.
- Optional **Also save to shared studio library**, off by default, is a
  separate idempotent operation after confirmed create. It produces one hidden
  shared template per quick assignment, not an assignable template until shown.
- Fictional preview fixtures and actual paired visual evidence are required
  for eventual implementation. Browser recovery storage contains routing and
  request identity only, never workout payloads.

Out of scope: client authoring, durable drafts, a new onboarding flow, tracker
redesign, recurring or reusable standalone behavior changes, new product
choices. Existing `active` standalone repeat availability is intentional.
Start, tracked/quick completion, abandon, attribution, history, adherence,
week rhythm, digest and appointment linking retain their existing behavior
except the explicitly quick-only label, active-card filter and pre-start guard.

## R2 — Data, normalized fingerprint and authorization

One future additive, forward-only migration, exact SQL independently reviewed.
No applied migration may be edited, renamed, removed or reordered.

| Assignment addition | Contract |
|---|---|
| `kind` text NOT NULL default `'assigned'` | Only `'assigned'` or `'quick'`; existing rows retain `'assigned'` |
| `created_by_coach_id` uuid → coaches | Nullable for ordinary rows; **NOT NULL for every quick row**; authenticated acting coach/admin |
| `create_request_id` uuid | Required for quick; browser UUID |
| `create_request_hash` text | Required for quick; version-prefixed server fingerprint |
| `library_template_id` uuid → workouts | Initially null; single hidden-template pointer |
| Quick-row check | Requires `dated`, non-null `assigned_for`, non-null actor and both request columns |
| Unique index | `(created_by_coach_id, create_request_id)` where request id is non-null |

`kind`, actor, request id and hash are immutable after insert. For quick rows,
`client_id` and `workout_id` are also immutable receipt/source identity: an update
cannot retarget the receipt and defeat original-client authorization. Ordinary
assignment updates retain their existing contract. The template
pointer can transition only null → value. Retain archived receipts: archive
must never free an identity for reuse or turn replay into a fresh create.

### Normalization and hash v1

Express derives actor only from authenticated context, never body fields. The
service-only RPC receives that actor and the server-generated hash, not a
browser-supplied hash. Canonical hash input is an explicit allowlisted object:

`{version:1, client_id, assigned_for, name, notes, exercises:[...]}`.

Hash is `v1:` plus SHA-256 of UTF-8 canonical JSON: object keys sorted
recursively, arrays retain order, all allowed fields present, absent optional
values resolved to their persisted null/default, UUIDs canonicalized, numeric
fields represented as normalized finite numbers. Date is a validated ISO date;
name is the resolved trimmed title. Resolve blank/default title to
`Quick session · <assigned_for>`. Freeze resolved date/title in the in-memory
request before dispatch (including across midnight retries); after reload,
re-entry can yield a different hash under the same UUID and is handled below.

Only accepted behavior-bearing inputs enter the hash. Top-level accepted fields
are request id, client id, date, title/name, assignment notes and exercises.
Do not accept client-controlled actor, template/private flags, workout ids,
hash, description or goal in this create contract. Reject unsupported fields
rather than silently persisting unhashed behavior. Request id and actor scope
uniqueness, so they are not payload fields. Start intent and library checkbox
are independent operations and are excluded.

Normalize the entire exercise list with the route's **`trackingExercises`**
contract (`normalizeTracking` plus `normalizeSupersetGroups`), then apply the
same kept-row/default/coercion rules as the shared writer. Hash these persisted
prescription fields on each retained row, in persisted position order:

`exercise_library_id`, `custom_name`, `sets`, `reps`, `default_load_value`,
`default_load_unit`, `rest`, `tempo`, `target_rpe`, `client_notes`, `coach_notes`,
`video_url`, `superset_group`, `tracking_type`, `duration_value`, `duration_unit`,
`distance_value`, `distance_unit`.

`name` on a custom exercise is an alias for `custom_name`; `notes` is an alias
for `client_notes`, with the existing writer's precedence. Store/hash resolved
values once. Row ids are not accepted on create. Empty rows skipped by the
writer do not affect the fingerprint or superset positions. Text prescriptions
use the writer's text coercion and empty-string → null rules; do not globally
trim or case-fold stored display text. Custom-name case/trim equivalence is an
update identity rule, not permission to hash visibly different text as equal.
Load values use numeric coercion and unit default `lb` when a value exists;
no value means null value/unit. Typed metric values/units and canonical
superset labels follow existing full normalization. Do not hash mutable
library names, visibility, timestamps or generated row ids. Any later accepted
behavior-bearing field requires a hash-version contract and test update.

### `create_quick_session(actor, client_id, request_id, hash, assigned_for, name, notes, exercises jsonb)`

Security invoker, empty search path, schema-qualified objects. Revoke EXECUTE
from public/anon/authenticated on **outer RPCs and every internal helper**;
grant only the service role needed by the backend. One transaction:

1. Take transaction advisory lock on `(actor, request_id)` before receipt lookup.
2. Find the stored receipt by actor/request, including archived receipts.
   For an existing receipt, acquire its quick-workout lock before client and
   assignment locks and recheck the receipt. Check actor is an active coach/admin.
   Authorize the newly supplied target
   **and**, if a receipt exists, its **original client**, against current
   ownership/non-archival. Hold ownership stable for the transaction with client
   row locks (multiple client rows in UUID order). Lost original access returns
   masked `not_found`, with no original assignment/client/hash details, even
   when the new supplied target is accessible. Other actors cannot replay it.
3. Authorized live receipt: same normalized hash → `replayed`; different hash
   → `request_mismatch`. An archived assignment/workout or archived client is
   not recoverable and returns masked `not_found`; it is never recreated.
   Replay does not repeat fresh exercise admission or rerun writes.
4. No receipt: enforce the existing hidden-library-exercise admission rule
   inside the atomic create path, then insert private workout
   (`is_template=false`, target `client_id`, `coach_id` = client's coach),
   exercise rows, and quick dated assignment with authenticated actor receipt.
   Failure rolls all of these back. Fresh admission and hash normalization are
   separate: hiding an exercise after commit must not break an authorized replay.

The route may use existing hidden checks for early feedback, but cannot let a
pre-RPC hidden check reject a valid receipt replay or replace atomic admission.
Current ownership must also be checked before serializing a post-RPC response.
Read failures return errors, not absence. Unique index is the final backstop.

### Shared-save extraction parity

Share the exercise-write rules with `save_workout` through an internal helper.
This is a behavioral refactor, not a redesign. Preserve its six-argument
signature, UUID/null return, template defaults on create, private/template
semantics on update, caller behavior, archived-workout no-op and transaction
rollback. Keep normalization inside each deploy root; no shared cross-root import.

Before/after behavioral SQL comparisons on an owned disposable local stack must
cover creation **and updates**: retaining ids when library identity matches;
retaining custom ids under case-insensitive trimmed-name matching; replacing ids
when identity changes; removal/reorder; skipped empty rows; omitted typed-metric
preservation on updates versus explicit clears; all units, notes, video and
superset fields; existing archived exercises not resurrected; removed/replaced
exercise loads archived in **both** `program_assignment_exercise_loads` and
`workout_assignment_exercise_loads`; retained loads preserved; invalid updates
roll back title, rows, metrics and both load families together. Compare equivalent
relational results with generated ids/timestamps mapped, while asserting old-id
retention explicitly. Existing metrics creation assertions and regex tests alone
are insufficient. Ordinary hidden-exercise additions remain rejected and
already-present hidden exercises remain editable under current rules.

### `save_quick_session_to_library(actor, assignment_id)`

Use the same security/grant pattern. Recheck the actual quick assignment's
current client ownership, active actor and assignment/workout/client availability
before reading or returning its pointer, **including replay**. Under the common
quick lock order below, lock the assignment. If its pointer exists, return the
same template; do not clone again or silently replace an archived/hidden pointer.
Otherwise clone via existing `save_workout_as_template` behavior into a **hidden
shared studio template**, stripping client-specific loads and coach notes, and
set the pointer atomically. Failure leaves the original session intact and
pointer null. Response loss/retry returns the one committed pointer.

## R1 — Routes, uncertain saves and response fencing

- `POST /api/programs/quick-sessions`, `requireCoach`: shape validation and
  server normalization, then transactional create. New → 201
  `{state:'created', assignment}`; replay → 200 `{state:'replayed', assignment}`;
  mismatch → 409 `{state:'request_mismatch'}` with **no assignment details**.
  The browser then performs the status read to obtain the authorized committed
  version. Masked absence → 404 `{state:'not_found'}`; database error → 500.
- `GET /api/programs/quick-sessions/requests/:requestId`, `requireCoach`:
  lookup under authenticated actor; recheck stored original client's current
  access, including active actor/client and live assignment/workout. Authorized
  live receipt → `{state:'committed', assignment}`. Absent, other-actor,
  archived or access-lost receipt → `{state:'not_found'}` with no receipt data.
  Lookup/authorization read errors → 500, never a masked successful absence.
- `POST /api/programs/quick-sessions/:assignmentId/save-to-library`,
  `requireCoach`: independent idempotent RPC above.
- Start now uses existing `POST /workout-logs/start` with
  `{client_id, workout_assignment_id}`. No create retry from start or library.

**`not_found` means not currently recoverable. It never proves rollback or that
an earlier request will not arrive.** Keep the UUID and pending record. Re-entry
requires an independent fresh current-target access check; a status absence is
not that check. If access is denied, keep the uncertain identity, show no old
workout data, and allow retry or explicit Discard. A successful target check
allows re-entry under the **same UUID**, with copy: “Couldn't recover an earlier
save. It may still arrive. Check assignments or re-enter under this request.”
No timeout, 4xx, lookup absence or storage event automatically creates a new id.

After mismatch, status must show whichever authorized body actually committed,
which may be the re-entered body if it won the race. Neither first dispatch nor
last dispatch is presumed authoritative. A lost status reply or newly lost
access keeps uncertainty and hides old details. Reload recovery does not resume
lost Start/library intent automatically; the recovered assignment offers those
independent actions. Their normal retries survive response loss by using the
existing assignment id, never a new create UUID.

### Browser representation and lifecycle

One immutable pending record per localStorage key, not a serialized whole map:

`cvf_quick_session_pending:v1:<environment>:<actor_coach_id>:<request_id>`

Value exactly `{v:1, request_id, client_id, state:'pending', created_at}`.
Environment identifies the public app/backend environment scope; no secrets.
Write before first dispatch, read back and validate. In-memory form supports
identical retries; browser storage never contains title, exercises, notes,
loads, hash, server body, access tokens or refresh tokens. No outbox or other
browser persistence may receive this create payload. Values are immutable;
retries do not rewrite timestamps/state or recreate removed pending records.
Enumerate individual keys for the current actor/environment/client only.

Before **any** delayed create/status/target-access/start/library response can
show data, clear storage, rotate identity, change form state or navigate, compare
its captured tuple with the current tuple:

`(authenticated actor id, authentication/session epoch, page-lifetime token,
current request id, target client id, operation generation)`.

Auth epoch changes on logout/login/account/session replacement even if actor
id happens to match. Page token changes on unmount/reopen. Operation generation
invalidates superseded reads; assignment operations also capture assignment id.
An abort signal is useful but insufficient. Stale results perform no side effects,
including storage deletion or chained Start/library requests. Clear old in-memory
workout data on account/page change; a new epoch independently recovers allowed
pending ids. Keep these guards in memory, not as tokens in storage.

Known authorized success/status committed clears only the exact matching key
whose validated immutable value matches the captured pending record. Never clear
an actor's whole namespace or a different pending request. Rotate only that
builder's identity after known success or explicit Discard. Two tabs using
different UUIDs cannot lose each other's entries. Two tabs using the same UUID
share server idempotency; storage events trigger a guarded status refresh and
never certify access/commit, automatically resubmit, or rewrite an entry.
Already-removed entries need no delete; mismatched/corrupt entries are retained
until explicit scoped Discard. Explicit Discard warns that a dispatched save may
still commit; it removes only that entry and permits a new explicit operation.

Blocked/full storage does not block a save: preserve UUID in memory and say
recovery after reload is unavailable. Corrupt entries show “An earlier
quick-session save couldn't be read — check this client's assignments,” with
scoped Discard. Do not trust malformed routing ids, spill data in diagnostics,
or claim unavailable recovery. No automatic expiry or eviction of uncertain ids.

## Coach flow

Client → Assign → Quick session opens the small builder. Library/custom exercise,
sets × reps, optional weight; More exposes rest, tempo, RPE, notes and existing
tracking modes/targets. Title is editable; date defaults to Denver today.

Assign confirms the create. Start now confirms the create then starts and opens
the existing coach tracker. Start failure/conflict leaves the assignment saved;
retry only start, with the existing active-workout message. The optional shared
studio library checkbox sends a separate operation after confirmed create. A
library failure shows “Session assigned — saving to library failed · Try again”;
retry only library. Successful create remains successful if either follow-up
fails. Both follow-ups can use the saved id independently; failure in one must
not resend create or prevent retry of the other. Cards expose Save to library
when pointer is null, including after reload.

## R3 — Complete read, label and edit contracts

### Active lists and history

Coach assignment reads and `GET /api/programs/client/assigned` annotate each
quick assignment with `quick_session_completed:boolean`, calculated by a
server/database **EXISTS** query over all non-archived completed logs for that
client and assignment, including tracked and quick-completed logs. This query
has no history page/row limit. Abandoned/active logs do not count. A failed
completion query fails the read rather than returning false. Non-quick rows
keep existing behavior.

Keep assignment endpoints' underlying assignments intact; active-card consumers
(ClientDetail, client Programs and Home) suppress only `kind==='quick'` with
`quick_session_completed===true`. Do not archive assignment/workout/exercises
or change raw adherence/week-rhythm/digest sources to hide cards. Client
assignment allowlists explicitly add only `kind` and `quick_session_completed`;
never expose actor, request id/hash, pointer or coach-only fields there.

Both `workoutLogWithDetails` and `workoutLogsWithDetailsBulk` add safe
`workout_assignment_kind:'quick'|'assigned'|null`, joined via the log's own
assignment id after existing log/client authorization. Immutable assignment kind
remains readable for an archived source; label history/detail “Quick session.”
No assignment payload, actor, receipt, client routing data, coach notes or
hidden-template provenance travels with this label. Single-detail and paginated
coach/client history must agree; program logs use null. This is distinct from
existing log `quick_completed` (untracked completion), which is unchanged.
Historical snapshots, counts, adherence, week rhythm and digest remain intact.

### Before-start edits serialized with start

Use the existing client-copy editor; enforcement is quick-only at the server
**and database**, not just a disabled button. A quick prescription/assignment
load edit is allowed only if no log has ever been started for that assignment
(including abandoned, completed or archived logs). A begun quick session returns
409 `quick_session_started`; lost access remains masked 404. A UI read can
predict this state but cannot authorize the write. Immutable receipt fields
are not recalculated after an allowed edit.

All quick edit paths must use the same guard: generic `save_workout` updates
of its private workout and `save_workout_assignment_with_loads` (notes/loads)
cannot bypass it. Direct helper writes are not externally granted. Serialization
must hold across title/rows/metrics/notes/loads and the entire start snapshot.
Library saves also use the same quick lock to copy one coherent prescription.

Common quick-only lock order: transaction advisory lock on quick **workout id**
→ current client row → assignment row → workout row → existing log rows →
exercise/load rows. Create takes its actor/request advisory first; authorize
multiple client rows in UUID order. Receipt lookup before locking is advisory
only and must be rechecked after locks. Guard acquisition is inside the database
function, before mutation and before start's active-log locking/snapshot. The
start core used by v2 and quick-complete takes this lock for quick sources only,
then revalidates the source. No path takes a log lock and later waits for this
quick lock. Ordinary private-copy editing/start locking/snapshots are unchanged.
Exact SQL review must verify this order across wrappers, core, shared writer
and assignment-load writer; a route-only SELECT/check does not satisfy it.

Edit wins → start snapshots the complete new prescription. Start wins → edit
is rejected with no partial changes. Abandon permits another existing start
according to current rules, but does not restore pre-start editing rights.

### Existing linkage and notifications

Use `resolveSessionIdForStart`: best-effort scheduled appointment on the Denver
day the workout **starts**, possibly different from `assigned_for`. No match is
promised. “In the gym now” is sent only for a new client-started tracked log,
not a coach start/resume or quick-complete. Completion notifications and daily
digest remain governed by existing conditions; this feature introduces no mail.

## R5 — Preview, paired evidence and visual classification

User-facing implementation ships required `previewMode.js` mocks/fictional
scenario data in the same PR; Sarah's stable baseline is preserved. Fixtures
are relative to load time, in memory and reset on reload. Cover create/replay/
mismatch, status committed/not_found/errors, save-to-library success/failure/
retry, completion flags and labels on assignment/history/detail, pre-start edit
rejection and existing Start behavior. Failure/slow controls use the existing
phone-accessible preview toolbar and `cvf_preview_` keys. Production preview gate
stays force-off. Browser specs import `test` from `preview-test.mjs`. Explicitly
list unsupported flows/reasons in `PREVIEW_UNSUPPORTED`.

Preview proves UI behavior only. Cross-reload late commits, auth changes and
cross-tab fencing require independently controlled mocked-network browser tests
whose fake server survives page reload. Real transactional idempotency, grants,
authorization, ownership races and edit/start serialization require independent
local SQL tests, never evidence inferred from preview.

Visual-direction classification: this bounded addition extends existing Assign/
client-copy patterns and adds a semantic type label; it does not propose a new
identity/signature direction. State this classification with reasoning in the
implementation evidence. Actual layout/styling deltas still require paired
captures. If execution introduces a genuine visual-direction decision or is
uncertain about classification, follow `docs/design-principles.md`: compliant
baseline and materially distinct bold probe, exact deltas, effort/impact,
FAIL/UNDERPOWERED/PASS and cold review/owner direction before production
implementation. No direction is selected by this draft.

Capture **actual baseline and proposed source** at 320px, 390px and desktop
(1440px), identical fictional data, fixed clock, theme and logical action/scroll
state. Use full viewport navigation/errors/overlays and full-page context where
needed. New creator baseline is today's Assign → Standalone flow (no creator),
not a fabricated old Quick Session screen. Pair shared states directly and
caption new-only builder/recovery states honestly. Include Assign selector,
builder/More/validation, saved label on coach/client/Home candidate, recovery
uncertainty, Start conflict, library failure/retry and history/detail labels.

Retain a screenshot manifest with baseline/proposed full SHAs, viewport and
image dimensions, fixture/clock/theme/state, paths, SHA-256 image hashes,
captions, known limitations and visual classification. Link a compact HTML/PDF
comparison from change documentation. Inspect both image pixels and rendered
comparison document. Actual images are an **implementation gate still pending**;
this spec-only pass cannot establish proposed UI evidence or claim visual PASS.

## Acceptance tests

These IDs are shared with the implementation plan and review mapping.

| ID | Required assertion and evidence |
|---|---|
| A1 | Same actor/id/same normalized body replays same assignment/private workout, no template. Aliases, numeric forms, blank rows and canonical superset keys give equivalent fingerprints; changed/reordered prescriptions and every accepted field change mismatch. Target client changes mismatch when both clients remain authorized. |
| A2 | Null quick actor and quick receipt client/workout retargeting rejected; actor supplied in body rejected; another actor cannot recover original. Reassignment/archive of original client/assignment/workout masks replay, mismatch, status and library pointer; an accessible new target does not reveal the original. Read failure → error. Archived receipt never creates a replacement. |
| A3 | Two identical concurrent creates → one workout/assignment. Competing original/re-entered bodies, in each arrival order, commit exactly one; loser mismatches and guarded status shows authorized winning body. Fresh hidden admission rejected, replay after library hidden/changed succeeds without new admission. |
| A4 | Lost create response + reload recovers committed. Status lookup before original arrival stays uncertain/same UUID. Access recheck required before re-entry; not_found/4xx/500 never rotate. Mismatch followed by lost-access/read-error hides details and retains pending. |
| A5 | Old create/status/target/start/library reply after account/session/page change or newer request/operation does not display, navigate, clear or chain actions. Second request survives old success. Two different-tab entries survive writes/removal; shared UUID tabs converge through server status without rewrite/resubmit. Blocked/full/corrupt storage handled; decoded storage/network diagnostics contain no workout payload/tokens. |
| A6 | Lost start response retry resumes same active log; different active log conflicts; completed dated source refuses start. Lost template response retry returns one pointer; concurrent saves create one hidden template; template failure rolls back only clone/pointer. Start/library retries never invoke create and each can succeed/fail independently. |
| A7 | Completed quick log beyond page one (>50 newer history logs) suppresses active card in all three surfaces; active/abandoned log does not. No assignment/workout archive writes. Counts/history/adherence/week rhythm/digest unchanged. Ordinary active repeat and dated behavior retained. Completion read error is visible. |
| A8 | Coach/client paged history and detail label quick via safe enum, including archived source; program/ordinary log labels stay correct. Receipt/hash/actor/pointer and other client data absent. Quick Session provenance is independent of quick_completed. |
| A9 | Edit/start two-connection races in both orders: edit-first snapshot all new fields/loads; start-first edit → 409 and unchanged rows. Abandoned/archived-started log blocks quick edit. Generic workout and assignment-load routes/RPCs cannot bypass; ordinary private/template editing and start snapshots unchanged. Library clone versus edit is coherent. |
| A10 | Pre/post extraction SQL relational comparisons prove save_workout signature/return/create/update identity/removal/reorder/empty rows/omitted metrics/archive/load families/rollback parity. Outer/helper EXECUTE and search_path verified with role probes, not regex only. |
| A11 | Required preview mocks, missing-mock enforcement, separate fictional scenario, phone failure controls and Production gate. Mocked-network and SQL evidence are separate from preview. Full preview suite passes. Paired 320/390/desktop evidence includes exact SHAs/manifest/hashes and inspected review artifact; visual classification/gates recorded. |
| A12 | Future release record freshly checks both hosted ledgers and exact candidate SQL/hash, one unapplied migration PR, invite coordination, separate target-specific hosted authority, pre-merge application/verification and both labels. Owner merge auto-deploys both Vercel projects; exact deployment SHAs checked afterwards. |

## R5 — Future release gates (not authority to execute)

The source spec **reported** both hosted ledgers at 41/41 on 2026-10-09. This is
a dated reported receipt, not a fresh query in this pass or proof that nothing
will be pending at release. Other repository ledger summaries are also dated.
Before release, recheck development `hhzpzcxcurmhpmfgriqb` and production
`dacqdoohqqcqgtpacerk`, resolve drift and coordinate invite-on-create work so
there is only **one unapplied migration PR in flight**. Do not reuse 41/41 as
current release clearance.

Independent review of exact forward SQL, backward compatibility, rollback
strategy and helper grants precedes separate owner authorization to apply to
each hosted target. Agents prepare reviewable evidence; owner supplies only
judgment/authority where required. Apply and independently verify both targets
before `migration-applied` / `prod-migration-applied` labels and owner merge.
Merge auto-deploys **both** Vercel projects immediately; never promise migration
first after merge. Confirm required CI and paired UI evidence for exact head,
then owner merge, followed by exact-SHA deployment verification. No hosted
application, label, merge, deploy or email action is authorized by this draft.

Later phases remain undesigned: client authoring, a reusable quick-session
library, or onboarding/invite integration. No settled choice is reopened.
