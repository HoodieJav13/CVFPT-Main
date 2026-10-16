# Quick Sessions independent-review repairs — local only

Repairs start from exact reviewed head `365c6be721e37736e57a3edbcef456ee88d9daeb` on an independent local clone, branch `codex/quick-sessions-review-repair`. The author checkout and reviewed artifacts remain unchanged. The controlling review is `/Users/jav/Documents/Codex/2026-10-08/task-44/quick-sessions-implementation-review-365c6be.md`. No product semantics, dependencies, hosted state or visual layout changes are included.

## F1: current request/session ownership

The original independent controller reproducer navigated to `old-log-1` and saved `old-template-1` after assignment 2 was current. Fifteen unit regressions and six actual UI regressions failed against the reviewed controller. Five additional identity/re-entry tests also fail against that controller.

A controller-wide lifecycle generation now fences visible operations across per-assignment channels. Reset/Done, a fresh request, re-entry intent and current-request discard invalidate prior visible work. Follow-ups require the actual current assignment; automatic create → library → Start continuations capture ownership before notifying subscribers and recheck it after each await. Existing actor/auth-epoch/page/client and per-channel fences remain. Background recovery reads still report separate recovered entries rather than superseding the builder. Requests already sent can still commit on the server; cancellation suppresses their stale UI effects, preserving existing recovery semantics.

Regressions cover Start/library successes and failures after Done/new request/re-entry, a re-entry response after a newer create, invalid assignment dispatch, invalidation while re-entry access is still pending, and library-then-Start after Done. Existing auth/session/page/client change and retry/recovery cases still pass.

## F2: generic template copy uses the common lock

The original independent PostgreSQL reproduction persisted `Old title|9`, proving a mixed source snapshot. Its regression failed against the original migration with the same persisted result.

Only the **unapplied** draft `20261009200000_quick_sessions.sql` is amended: `save_workout_as_template` keeps its existing body, signature and copy behavior, with the common quick lock before the first source read. Ordinary sources are a no-op. Explicit names/variation parents, hidden templates, attribution, load/note stripping and the separate dedicated-library receipt pointer retain their semantics. Applied migration files are unchanged.

The generic HTTP path still calls that RPC after its normal role/ownership checks. Mounted route coverage verifies own-client/admin access, foreign-coach masking, client rejection and passing a null default title for a quick source. SQL coverage invokes the callable generic RPC independently of HTTP.

Lock graph: generic save → quick-workout advisory transaction lock → client FOR SHARE → assignment FOR UPDATE → workout FOR UPDATE → clone inserts/exercise reads. It holds no source row lock before the common helper. The dedicated library wrapper's nested acquisition is reentrant in the same transaction. Start/edit/load-edit/replay order stays unchanged. `clone_workout` remains an internal service-role callable helper; mounted quick-source template saves enter through the locked generic or dedicated wrapper. The existing assignment-clone routes accept templates, rather than quick private sources. No additional lock edge was introduced ahead of the common quick lock. Independent full SQL/lock-graph approval is still required.

The committed race regression is in `supabase/tests/quick_sessions/generic_template_concurrency.sh`, run by both `--all` and `--race`. Clone-first pauses at the original header/exercise boundary; edit-first holds the committed edit's locks before commit. Both assert `pg_blocking_pids` identifies the holder and the wait event is the advisory lock, then verify the complete persisted template (`Old title|1` / `New title|9`) and committed private-source edit.

## Directly verified local checks

| Check | Result |
|---|---|
| Complete backend `npm test` | 524 passed, 0 failed |
| Complete frontend unit suite | 120 passed, 0 failed |
| Frontend production build | Passed; existing chunk-size warning |
| Backend/frontend import boundaries; diff whitespace | Passed |
| Full mocked Quick Sessions browser suite | 15 passed, 0 failed, isolated port 4378 |
| Quick SQL `--all` | 26 identical parity report rows; original behavior/grants and all committed races passed |
| Final expanded SQL behavior/grants | 71 assertions; 20 low-privilege denials / 10 service-role successes |
| Existing quick races + new generic race | 17 existing + 4 new assertions; both generic arrival orders explicitly waited on common advisory lock |
| Fake-Docker guards | Quick 25; series 18; isolation 11 passed |
| Cleanup/preservation | No task-owned containers/volumes, shared lock or 4378/59422 listener; author checkout clean at original reviewed SHA |

SQL used only task-owned `cvfpt-quick-repair-task5` on 594xx ports, Supabase PostgreSQL cached image `17.6.1.171`, under the host-wide coordination lock and foreign-stack refusal. A test-only copy of `stack.sh` changed project/port identity; production harness identities remain unchanged. No downloads, real data, email, settings, other stacks or hosted database were used.

Raw logs, original independent reproducer copies, isolated test config/harness, exact diff/head and a local repair bundle are in the task handoff adjacent to the repair checkout. See `REPORT.md` in `/Users/jav/Documents/Codex/2026-10-09/task-5` for exact commit identity and links.

## Release ordering and gaps

**Invite acceptance/migration first, Quick Sessions afterward. Both remain unapplied to either hosted database.** The Quick Sessions draft version remains a placeholder; fresh migration inventory/version reservation, current-main reconciliation, exact SQL approval and separately authorized hosted release gates remain. No push, PR, merge or deployment is authorized or performed.

Not run here (not applicable to this focused local repair): hosted/live-auth checks, GitHub CI and A12 release gates. The full preview/series/auth/analytics/workout-UX browser suites and recurring/metric SQL suites are not rerun; their original results remain reported-only evidence. New UI tests use a mocked backend; the generic HTTP authorization test uses an in-memory DB, while the generic RPC concurrency proof runs actual PostgreSQL. Real browser account switching remains covered by existing unit fences, not newly measured in a real-auth browser. Full independent review of the repair head is pending.

## Judgment calls

1. An independent local clone with separate Git metadata implements the requested branch isolation without writing to the author's repository/worktree metadata.
2. The generic RPC takes the common lock rather than rejecting/rerouting quick sources, preserving approved generic and dedicated copy semantics.
3. Background recovery remains outside the visible lifecycle fence so other saved receipts can still be recovered while a new builder is in use.
4. Existing follow-up tests now create a real visible assignment before dispatch, matching the UI's ownership contract.
5. Test-only stack/browser identities are changed outside the committed production configuration; the authored harness and other agents' stacks are preserved.
