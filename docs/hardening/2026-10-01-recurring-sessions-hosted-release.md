# Recurring sessions hosted release — 2026-10-01

Status at this commit: both hosted database gates passed; merge and automatic
Production deployment follow only after ALL checks pass on this documentation head.
Post-deployment results are reported to the owner separately, without presenting a
future deployment as already verified.

PR: https://github.com/HoodieJav13/CVFPT-Main/pull/90
Code head verified: `a647c292411ab14ac8b2829ecee4cc8f53b2a07e`.
Owner explicitly delegated push, PR, hosted application/verification, labels, and
merge/deployment in the release request. This task-specific grant overrides the
normal manual-owner merge default. No raw credentials were read, copied, or changed.

## Reconciliation and local evidence

Current main (`f297a9c`) introduced a separate Production database and the shared
training library after the original branch review. The release was reconciled in a
separate scratch clone, preserving all three unrelated changes in the original
checkout. Exact-date calendar coverage and current main CI guards were retained.
Workout/program templates are usable across coaches; client instances retain their
ownership boundary. Optional assignment uses the existing `assign_program_clone`,
recognizes both legacy and cloned assignments, and rejects hidden templates.

Three new backend regressions failed before the compatibility fix and passed after.
Final local checks: backend 441/441; frontend unit 29/29; production build exit 0;
preview 29 passed / 8 skipped / 0 failed; series 19/19; provisioning guards 10/10;
migration-in-flight fixtures 4/4; both deploy boundaries; stack/isolation guards
18 + 11. The real local Supabase Postgres 17 reset, all four SQL files, both
committed concurrency races, isolation, and teardown passed. The SQL tests include
private client plan copies, legacy/clone duplicate suppression, and clone-failure
rollback. GitHub's backend, frontend, frontend-series, and database jobs all passed
on their first run for the reconciled code (CI run `36898120494`).

## Hosted application and verification

| Environment | Project | Result |
|---|---|---|
| Development / Preview | `CVFPT-Main` / `hhzpzcxcurmhpmfgriqb` | four migrations applied; 39/39 ledger; no pending migration |
| Production | `cvfpt-production` / `dacqdoohqqcqgtpacerk` | four migrations applied; 39/39 ledger; no pending migration |

Applied exactly `20260930100000`, `20260930110000`, `20260930120000`, and
`20260930130000`, in order. CLI 2.118.0 flags were checked with `--help`. Each
`supabase db push --project-ref <target> --skip-vault --yes` exited 0. Subsequent
`--dry-run` reported up to date for each. No seed, test-account provisioning,
custom-role push, credential manipulation, or original-checkout relinking occurred.
The last pending migration was reconciled before application; no applied migration
was edited.

Both hosted schema checks confirmed:

- Four invoker functions; anon/authenticated EXECUTE false, service-role true.
- `session_series` RLS on, zero policies, anon/authenticated SELECT false,
  service-role INSERT true.
- Nullable UUID `series_id` and integer `series_ordinal` on sessions.
- `UNIQUE (coach_id, request_id)` and `idx_sessions_series` present.
- Scheduler uses the shared helper and scheduling lock; series assignment calls
  `assign_program_clone`.
- Zero series or linked sessions before the feature is used.

In each database, an assertion-based version of the runbook probe created two
sessions, replayed the same receipt/series, and checked the overlapping coach
conflict. It rolled back. Exact-ID counts for series, coach, client, and sessions
were `0 | 0 | 0 | 0` afterwards. No notifications are dispatched by this SQL probe.

The `migration-applied` and `prod-migration-applied` labels are added only after
these respective verification gates. The in-flight check initially counted this PR
alongside dormant payment PR #3; that other PR is unchanged. Every migration guard
must pass after labels and before merge. No failed check is bypassed.

## Deployment gate and rollback reference

Merging automatically deploys BOTH Vercel Production projects. The hosted schema
has already passed verification before that trigger. Merge is conditional on all
checks being green for the exact latest PR head; a moved head or main is rechecked.

Previous Ready Production deployments at `f297a9c`, retained as rollback references:

- Backend: `dpl_5W5nKeaoJjde8qyRqmZAz3cMjTxh`.
- Frontend: `dpl_CC7iHpJXPwz66sWKKdZQQKqh5YHt`.

The additive schema remains in place for an application rollback. Database
corrections remain forward-only. Post-merge verification covers Production aliases,
health, rendered login, both configured exact-origin CORS responses, unauthenticated
series routes, retired-route 404s, deployment build state, and available error/5xx
logs over the preceding hour. An hour-range query is not a claim of a full hour of
post-deployment observation.

## Accepted gaps

Real-auth browser credentials are not configured in the release execution
environment; that suite is not rerun and no historical result is presented as a
release result. The optional owner first-use test with a test client and Notify off
is separate from the rollback-only probe and is not performed on a real client.
