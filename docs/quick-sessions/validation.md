# Quick sessions — local validation record (2026-10-09)

## October14 integration checkpoint

Accepted repaired combined source9f7ea119 is reconciled onto released Invite main8d68a789 in isolation, preserving released Invite SQL and visual evidence. Quick SQL/controller remain exact accepted F1/F2 bytes. The current resulting head requires independent local review; no Quick hosted mutation, publication or release occurred. Fresh integration outputs are recorded separately in the sealed exact-head packet; the October9 counts/A1–A12 record below remain historical author evidence. See [released-main integration](released-main-integration.md).

## Historical October9 local validation

Repair follow-up: [review-repair.md](review-repair.md) records the F1/F2 corrections, new regressions and fresh local checks. The original implementation results below remain historical evidence.

Status: **implemented and verified locally only.** Nothing is pushed, no PR exists, and the
one draft migration (`supabase/migrations/20261009200000_quick_sessions.sql`, SHA-256
`8842d98ed4dec4abe57000240c2952712f220018d8af785ba0001938376e2119`) is **not applied to any
hosted database**. Independent code, exact-SQL and lock-graph review is still required.
Spec: `docs/superpowers/specs/2026-10-09-quick-sessions-design.md`; plan:
`docs/superpowers/plans/2026-10-09-quick-sessions.md`.

- Branch `claude/quick-sessions-implementation`, base `1b3950b8c87e1e5a7b5e75c58ae203e95bf62639`.
- Suites ran at `66c36710fc5280bcc117095e072790c63a79917f`, whose code is identical to `5a75530062880210599755bf14d3592031ae6999` (only visual docs added). `ef0f7ea` then moved the mocked suite to its own port (4178, since 4176 is used by the metrics config); the mocked suite, metrics mocked suite (3/3) and workout-ux suite (25/25) were re-run there. Later commits are docs only.
- Visual evidence: [visual-review/](visual-review/README.md).

## Checks run once on the verified head

| Check | Result |
|---|---|
| `bash scripts/check-boundaries.sh backend` / `frontend` | pass / pass |
| `cd backend && npm test` | 523/523 (baseline 499/499) |
| `cd frontend && npm run test:unit` | 100/100 (baseline 83/83) |
| `cd frontend && npm run build` | pass |
| `npx playwright test` (preview suite) | 89 passed, 8 skipped, 0 failed (baseline-pattern skips; 10 new quick-session tests) |
| `npm run test:e2e:quick-sessions` (mocked network) | 9/9 |
| `npm run test:e2e:series` / `test:e2e:auth` / `test:e2e:analytics` | 23/23 / 4/4 / 6/6 |
| `bash supabase/tests/quick_sessions/stack_guard_test.sh` | 25 cases |
| `bash supabase/tests/quick_sessions/run.sh --all --down` | parity identical (26 rows), 66 behavior/grant assertions, 17 race assertions, verified teardown |
| `bash supabase/tests/session_series/run.sh --down`, its guard tests (18 + 11) | pass |
| `bash supabase/tests/workout_metrics/run.sh` | pass |

All SQL ran on owned disposable Postgres 17 stacks (`cvfpt-quick-sessions-test`, ports 573xx)
under the host-wide coordination lock `~/.cvfpt/disposable-db.lock`, never against a linked or
hosted project. The new CI jobs (`frontend-quick-sessions`, the quick-sessions database step)
have **not run on GitHub**.

## A1–A12: executed evidence vs acceptance text

| ID | Executed evidence | Not proven here |
|---|---|---|
| A1 | `quick-session-normalization.test.js` (aliases, numeric forms, blank rows, superset keys, every prescription field, reorder, client/date/title/notes, Denver midnight); route hash equivalence; SQL `receipts.sql` replay/mismatch incl. client change | — |
| A2 | SQL `receipts.sql`: null/body actor, retargeting and receipt-field immutability, other actor, reassignment/archive of client/assignment/workout/actor masks replay/mismatch/status/library, archived receipt never replaced; routes: auth-derived actor, hydration recheck, read error → 500; mocked masked re-entry | — |
| A3 | SQL `concurrency.sh` race 1 (identical) and race 2 both orders (status shows winner); fresh hidden admission rejected; replay after hiding; mocked suite both browser orders | — |
| A4 | Unit tests (persist-before-send, same UUID on 404/500/timeout, re-entry access check, mismatch → status winner, lost access); mocked: lost reply + reload, status before delayed commit, masked access | — |
| A5 | Unit fences (actor, same-actor re-login epoch, page, client, generation), exact-key removal, two tabs, blocked/full/corrupt storage, payload-free storage; mocked: stale reply after page/client change, two tabs, corrupt/blocked | Account switch in a real browser session is unit-tested only |
| A6 | SQL `edits.sql` (resume, conflict, completed dated refusal), `library.sql`, race 6; routes envelopes; unit + mocked lost Start/library retries never resend create | — |
| A7 | SQL `reads.sql` (completed quick log behind >50 newer logs, tracked + quick-completed, active/abandoned/archived excluded, no writes); route annotation and visible read errors; preview hides completed cards in three surfaces | Counts/history/adherence/week-rhythm/digest code is unchanged by construction (no diff), not separately re-measured |
| A8 | Mounted detail + paged/unpaged coach/client history agree, archived source kept, no receipt/actor/pointer leak, independent of `quick_completed`; preview labels | — |
| A9 | SQL `edits.sql` (generic and load writers, abandoned/archived logs, ordinary private/template edits unchanged); races 3, 4, 5 (both orders) and 7 (library vs edit, both orders); routes map 409; preview started-edit rejection | Full lock-graph proof needs independent SQL review |
| A10 | Parity: identical relational reports on verified pre/post schemas (`20261005165134` vs `20261009200000`); grants: catalog + role probes (18 anon/authenticated denials, 9 service-role executions) | — |
| A11 | Preview fixtures (separate fictional client), missing-mock enforcement via `preview-test.mjs`, Production gate untouched (`vite.config.js` unchanged), full preview suite, independent mocked/SQL suites, 60 paired captures with manifest | Classification/cold review not self-certified |
| A12 | **Not executed** (acceptance text only); see `docs/hardening/quick-sessions-hosted-release.md` | All release gates |
