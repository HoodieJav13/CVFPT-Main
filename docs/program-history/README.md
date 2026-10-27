# Program Change History — local first slice

**Current continuation:** [durable forward capture is now implemented and locally tested](DURABLE-CONTINUATION.md). The original prototype report below is historical; its memory-only boundary is superseded by the continuation. Hosted databases and production remain untouched.

Read-only coach history is available from Training builder → Programs → Change history, and Client → Programs → assigned program → Change history. It displays adjacent stored snapshots, exact before/after fields, additions/removals, relative day/exercise reordering, source labels and explicit unknown author/date states. It shares existing Dialog/Button/Card styles. The new dialog is data-first; coverage details expand on demand. No independent visual redesign is proposed.

## Evidence and provenance

Remote main was directly checked using `git ls-remote` at task start: `84b47186ba8a1adf7559ff96a16eca265a0e4461` (PR122). `/Users/jav/Projects/cvf/cvfpt` is the authoritative repository checkout but is on an older user branch with existing changes. It was inspected without edits. A preserved release candidate already contained the exact main object. This task copied its Git objects into `task-15/history-objects.git`, then created linked worktree `task-15/program-change-history`, branch `feature/program-change-history`. Push URL is disabled. WorkoutRescue's worktree and source files were untouched.

The canonical migrations and current program writes contain **no program revision history**. Existing workout set revisions, completion snapshots, template lineage and exercise media revisions are separate models and cannot establish earlier program edits. No production/client records were fetched. `GET /api/programs/:id/history` therefore returns `availability: unavailable`, `capture: disabled`, empty revisions, after the existing role/current-client ownership checks. It loads only the program/current-owner relation, never workout logs. Failures remain retryable errors, not empty histories. Responses use `Cache-Control: no-store`.

Forward capture is deliberately **fictional, memory-only preview**, resetting on reload. No database migration or durable server capture is implemented. No env/settings switch can activate server capture. Existing preview gating and Production forced-off flags are unchanged. Successful program create/update and workout prescription update capture allowlisted before/after snapshots. Failed saves produce no entries. Reads never initialize history. The first observed baseline carries null author/date; it is not attributed to the program creator or creation date. A separate, clearly labeled History example holds two explicit fixture revisions; Sarah's prior history is never fabricated.

The diff uses stored row identities. New identities are conservatively shown as removal/addition, never guessed as edits by name. Relative order of common identities prevents an insertion from falsely marking every following exercise as reordered. Snapshots exclude performed/completed logs, auth data and arbitrary fields. Coach-only details stay behind coach-only access. UI replies are fenced by open state, program identity and auth session scope.

## Local preview and launch

Already running: <http://127.0.0.1:58261/coach/programs>. Set the existing preview toolbar to Coach, open Programs, then Change history on History example. Revision 1 demonstrates missing metadata; revision 2 compares actual stored fixture values (sets 3 → 4, notes and exercise order). On Sarah's Programs tab, the mobility program shows unavailable history until a successful preview save. Reload resets captured preview changes.

```sh
cd /Users/jav/Documents/Codex/2026-10-26/task-15/program-change-history/frontend
npm run dev:preview -- --host 127.0.0.1 --port 58261 --strictPort
```

Existing dependencies were reused with local filesystem clones; no dependency manifests/locks changed and no dependency install or external model call was made. Local runtime is Node 26.7.0, Vite 6.4.3. No hosted runtime claim is made.

## Integration notes

- **WorkoutRescue:** additive history entry in `ClientDetail.jsx` and `Programs.jsx`; small preview save/read hooks in `previewMode.js`. These are the only likely overlap points. Preserve Rescue's active-workout behavior when reconciling them. This branch never edits WorkoutTracker, workout event/conductor code, completed log writers or migrations.
- **CueRetry:** successful preview workout saves snapshot `client_notes` and `coach_notes`; refused/failed saves do not capture. Reconcile retry outcomes with the existing successful-save hook, avoiding duplicate capture on response replay. No retry behavior is added here.
- Durable history needs a later authorized transactional design spanning program/workout writers, imports/copies/assignment overrides, stable row identities, idempotency, append-only service-only storage, retention/pagination, and author/date snapshots from authenticated server actors. Do not promote preview memory into a server audit store or reconstruct history from current rows.
- No undo, template propagation, bulk reassignment, completed record edits, migrations, production settings/data, credential operations, paid services, model calls, push/PR/automatic CI, merge or deploy are included.

## Limitations and decisions

1. Independent local object copy/worktree chosen because this projectless task's native worktree tool cannot target the authoritative checkout. Cost if wrong: an extra local repository to retain; no shared work changed.
2. Real history explicitly unavailable because no stored program revisions exist. Preview-only forward capture satisfies the authorized isolated slice. Cost: this is not a durable production audit trail or release-ready history collection.
3. Existing schema may replace row IDs on saves. Such changes display as additions/removals; no fuzzy identity matching. Cost: a recreated day may be verbose rather than appearing as an in-place edit.
4. Coverage is program details, days, and workout prescriptions on the named preview save paths. Assignment load overrides, imports/copies/archive actions and library edits are not journaled. The UI discloses coverage; this is not comprehensive change collection. Cost: later production work must account for these write paths before claiming comprehensive history.
5. Inline implementation and self-review only, honoring the delegation's no-extra-agents restriction. No independent source or cold visual acceptance is claimed.

## Verification

[Actual paired visual comparison](visual-review/index.html), with 320px/390px/1440px screenshots and image hashes. New surface has no equivalent baseline dialog; its baseline is stated honestly. Fictional data, same fixed clock/theme/logical card state. Pixels and rendered HTML were inspected; all nine images load. Phone disclaimer was compacted after pixel review; coverage remains expandable.

Final command results are recorded in `RETURN.md`. Browser plugin is not listed in this environment; repository Playwright was used against local fixture Vite. Page identity/title, meaningful dialog content, no framework overlay, clean target-flow console/page errors, revision selection and responsive overflow were directly checked. Real devices, hosted auth/data/schema and durable capture are not tested here.

The first broad browser attempt ran against a server edited through HMR during implementation. Direct API probes imported a second uninitialized module URL and received Vite HTML; the untouched baseline probe passed. That invalid candidate run was interrupted, the frozen server restarted, and the final full suite run from cold state is the reported result. The shared preview test helper remains unchanged; the new history tests explicitly await preview readiness.

Verified source commit: `113ed4b9d556bba98c25fd733678545ee5b98622`. The following evidence commit changes documentation/screenshots only. Final clean preview regression: **135 passed, 14 designed skips, 0 failures** (149 total, 5.5 minutes). Frontend units270/270; focused history8/8; backend716 passes/4 platform skips; mounted history2/2. Latest supported shared usage17%, below working stop29%.
