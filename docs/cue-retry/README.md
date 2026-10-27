# Cue → Retry → Recheck

**Current state:** the [durable backend continuation](DURABLE-BACKEND.md) implements actual Express/SQL persistence and normal frontend access. Its migration is local/unapplied to hosted databases. The sections below retain the original isolated browser-demo contract and historical first-slice evidence.

Built from remote-verified CVFPT main `84b47186ba8a1adf7559ff96a16eca265a0e4461`. This is an opt-in **fictional, browser-local demonstration**, not a released or hosted feature. No backend route, schema, hosted data, configuration, dependency, workflow or service is changed. Production force-disables the existing preview gate.

## Review and launch

From `frontend/`, run `npm run dev:preview -- --host 127.0.0.1 --port 58416 --strictPort`. In this task the sanitized launcher is `../launch-preview.sh` relative to this checkout. Open `/coach/workouts/cue_log_source?cueRetry=1`. If the toolbar starts in Client, switch **Preview role → Coach**, then reopen that path. The opt-in flag is `cvf_preview_cue_retry=1`.

The new separate client is **Casey · Cue demo**, not Sarah. The original source is a fictional completed Goblet Squat attempt (one set, 30 lb × 8, RPE 7). On that row choose **Add cue for next attempt**, enter one actionable text cue, and save. This is distinct from the existing client notes, program instructions and workout-level coach response.

Switch the toolbar to **Client** and **Casey · Cue demo**. Programs → Cue retry · local demo → day 1 → **Start workout** uses the existing assigned workout and guided tracker. The cue appears in that exact-source exercise. Complete a set and Finish through the existing tracker. Switch back to Coach; open the linked workout via the original cue's **View linked retry**. Choose **Fixed**, **Partly helped**, **No change**, or **Pending recheck**, then **Save recheck**. Original and retry link to each other. Client can see their own cue and verdict, with no coach controls.

Reload, close/reopen the tab or restart the browser on the same origin/profile: cues, cancelled receipts, attempts, performed sets, status and verdict remain. The local data is in IndexedDB `cvf_preview_cue_retry_v1`, object store `scenario`, key `current`. Clearing that origin's site data removes the demonstration. Another device/profile/origin has a separate copy. Browser storage eviction/private browsing/owner deletion are not cross-device durability. No credentials or real client data belong in this mode.

The ordinary toolbar **Reset** clears preview switches and disables this opt-in; it does not erase this IndexedDB database. Reopening `?cueRetry=1` recovers the same local scenario. Existing Sarah and other fixtures remain memory-only and still reset on reload.

## Semantics

- A cue references client, completed source workout-log exercise, exact source workout-exercise, program assignment and day. A performed source set is required. No exercise-name/library inference or automatic diagnosis occurs.
- One active cue per source attempt, with at most one awaiting retry for a given assigned source exercise. This avoids stacking hidden instructions on the next attempt.
- The next **newly started** matching exercise in the same assignment/day captures the cue link. An already-active workout is not retroactively changed. Same-library exercises in other days/copies do not match. Rescue's retained source identities can match; omitted/replaced exercises do not.
- Before linkage, **Edit cue** replaces the text only after a fresh source review. **Discard draft** changes nothing. **Cancel cue** soft-cancels it while retaining its text and receipt; it will not attach later. New cue creation is then possible.
- After linkage, text and link freeze. Cancelling or editing that original cue is rejected. An abandoned retry remains linked and pending (visibly labelled), rather than silently shifting the cue to another workout.
- The coach records/corrects the verdict only on a completed retry with a performed set. Pending is explicit; it is never inferred from completion. Revision checks reject stale changes. Reusing an operation id with the same body returns its original receipt; reuse with a different body conflicts. The UI retains the operation id for an unchanged failed retry.
- Changed source plan/assignment/load invalidates an unlinked cue. It is not silently applied. A replaced/missing source exercise requires cancellation and a cue on a completed current attempt. A still-present changed source can be freshly reviewed and saved.
- A changed retry snapshot is labelled **Earlier-plan cue**, and verdict writes fail; the earlier cue stays pending. Later edits to the original program do not rewrite an already captured retry instruction.
- Cue records/receipts live separately. Create/edit/cancel/recheck never patch prescriptions, performed sets, completed snapshots, exercise notes or program history.

## Architecture and durability

`cueRetry.js` owns role/ownership checks and state transitions over the actual existing preview model shapes. `previewCueRetry.js` seeds only the isolated scenario and selects its client-owned program/workout/assignment/log/exercise/set/load rows plus cue records and receipts. Existing `previewMode.js` handlers still implement Start, set logging, Finish, history and program edits.

The opt-in adapter loads before React renders. Every request is serialized within a tab, reads the current durable scenario, then runs the existing handler. A changed scenario is acknowledged only after a single IndexedDB readwrite transaction commits the whole snapshot. Compare-and-set revision checks reject concurrent stale writers across tabs. Failure restores fixture memory and yields an error; no memory-only save is represented as durable. Unsupported/corrupt envelope versions are refused without replacement. Initial concurrent opens converge on the first committed snapshot. Storage failure blocks scenario writes with reload/retry guidance; ordinary non-opt-in preview operation is unchanged.

`CueRetryEntry` is double-gated through `isPreviewMode` and the isolated client id; its lazy panel is mounted in existing `WorkoutLogDetail` and `WorkoutTracker`. No new top-level route, navigation destination, media upload or external call is added. The preview API helper awaits asynchronous adapter readiness, including tests that import the API directly.

This is a deliberate scoped exception to ordinary memory-only preview fixtures, expressly implementing the task's durable local/test path. **Preview actors and checks are synthetic UI/domain boundaries, not hosted authorization.** Local storage can be edited by its owner and is not an access-control boundary.

## Original prototype integration handoff (superseded by backend continuation)

WorkoutRescue `231272b` was inspected but not cherry-picked or modified. Its handoff recommends preserving retained `source_workout_exercise_id`; this implementation does. Cue code does not change `rescue_snapshot`, load resolution, outbox behavior, exercise media/demo resolution, Repeat or workout outline. ProgramHistory's active worktree was untouched. Future program-history events must remain separate from cue receipts; cue edits do not create program edits.

At the original prototype boundary, production integration still required the following implementation (now provided by the linked backend continuation): a new numbered migration for separate cue/link/recheck and idempotency receipts; service-only grants/RLS with no browser policies; server-side role and current-client ownership checks (existing Auth User ≠ Client rule); authoritative plan/assignment revisions; atomic link-at-start and operation/revision fencing; immutable completed history and receipt retention; and backend/SQL concurrency and hosted synthetic verification under separate authority. Do not copy this fixture's JSON freshness values or browser-controlled actor into a security boundary. No migration file is supplied because the completed path uses IndexedDB only; do not mount an imaginary production API.

No voice/video, private video storage, external model calls, purchased services, secrets, CI, push, merge or deploy are part of this candidate. Text quality is coach-owned; no movement diagnosis or claim that a cue caused improvement is generated.

## Verification and visual evidence

- Baseline frontend units: 262/262. Final domain adds lifecycle, unauthorized/missing references, request replay, edit/cancel, stale source/assignment, single-awaiting-cue and stale retry tests.
- `frontend/e2e/cue-retry.spec.mjs` uses the guarded preview fixture. It exercises the full loop at 1440/390/320px, actual browser process restart, cross-tab stale writes, denied clients, missing attempts, immutable completed records, failed saves, unavailable storage, recovery and source edits.
- The repository preview suite remains the regression check for existing Start/Finish/outbox/notes/media/Repeat behavior. Exact final counts and raw logs are in the task handoff.
- [Paired visual review](visual-review/index.html) uses actual baseline source plus only the identical isolated fictional seed, and the proposed source. Existing layout/tokens are reused; no signature visual direction or cold-visibility certification is claimed.

Local Node 26/reused dependencies and Chromium emulation are qualified evidence. Physical devices, cold service-worker offline, hosted auth/database and production persistence are not certified. There is no dedicated frontend TypeScript/lint script; build plus targeted ESLint supplement unit/browser checks.
