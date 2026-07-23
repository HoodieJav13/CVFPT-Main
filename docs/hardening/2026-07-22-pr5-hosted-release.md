# PR #5 hosted release evidence

Release date: 2026-07-22 (America/Denver)

Release commit: `2786aa356b6c2ca0632791fde723ac0addaa93cf`

Scope: integrated API validation hardening, coach workout responses, and client
exercise performance history from PR #5. The merged PR head was
`c5f7f3ea00d96c0e9602cff3d7529e1155edf8b8`, one commit after the independently
reviewed feature head `c6edeff`: that final commit changed only
`backend/package-lock.json`, updating `body-parser` from 1.20.5 to 1.20.6 to
resolve the reported dependency vulnerability. It made no application-source,
schema, or public-interface change.

## What reached Production

- Vercel backend deployment `dpl_9uqfL74GYbwmvH5N8JkXmDR1pVqt` reached
  `cvfpt-backend.vercel.app`.
- Vercel frontend deployment `dpl_Ey36DhFgcy2PsKM5onwoRPVCiGAt` reached
  `cvfpt-frontend.vercel.app`.
- Both deployments identify merge commit `2786aa3`; backend became ready before
  frontend.
- Hosted Supabase received, in timestamp order:
  1. `20260720120000_coach_workout_responses.sql`
  2. `20260720173000_exercise_performance_history.sql`

## Sequencing exception

The approved release order was hosted migration, backend, then frontend. Merging
PR #5 triggered both Vercel Production projects automatically, so both code
deployments began before the separately authorized migration command could run.
The backend still became ready before the frontend, but the strict
migration-first gate was not achieved.

The two pending migrations were then applied immediately in timestamp order.
No additional application change was required. Post-application verification
proved the deployed code and hosted schema converged successfully.

There was therefore a real interval—not merely a theoretical risk—when deployed
code could have reached tables/functions that were not hosted yet. No failure was
observed during that interval, and the subsequent one-hour runtime scan found no
backend error/fatal entry or `5xx` response. That evidence does not prove that no
request encountered the gap; it proves only that no such failure was observed
and that the final state is healthy.

Future migration-bearing PRs must account for the Git deployment trigger before
merge. If migration-first ordering is required, apply and verify a
backward-compatible migration before merge or explicitly pause automatic
deployment. This project rule is also recorded in
`.agentic/PROJECT_POLICY.md`.

## Hosted database evidence

- The linked migration ledger reports 16/16 local and remote migrations.
- A second linked dry run reports the remote database is up to date.
- `workout_coach_responses` exists with RLS enabled and the intended
  one-response-per-workout/author uniqueness constraint.
- `save_workout_coach_response` exists as a security-invoker routine; direct
  execution is denied to `PUBLIC`, `anon`, and `authenticated`, and granted to
  `service_role`.
- `actual_reps`, `actual_rpe`, and `exercise_library_id` are present on their
  intended workout snapshot tables.
- The completed-workout child immutability trigger is enabled.
- `get_workout_exercise_history` exists with the same service-role-only
  execution boundary.
- The recoverable legacy exercise-identity backfill reports zero missing rows.
- A rollback-only coach-response probe created and updated one response while
  preserving its identity.
- A rollback-only Exercise History probe returned a completed occurrence with
  `completed_at` and ordered set data.
- A follow-up query confirmed neither probe left verification rows behind.

The migration command completed successfully. Its final `pg-delta` catalog-cache
warning referenced a missing local CA file and occurred after the successful
push; the independent ledger and second dry run distinguish that CLI cache
warning from a migration failure.

## Production application evidence

- Backend `/api/health`: `200`.
- Frontend `/login`: `200`, rendered with the expected title and meaningful
  login content, with no runtime error overlay.
- Unauthenticated coach-feedback, coach-response, and exercise-history
  requests: `401`.
- Retired `/api/packages` and `/api/payments` surfaces: `404`.
- The configured frontend origin receives the expected CORS response.
- Vercel build logs contain no new build failure. Existing informational
  warnings remain the frontend chunk-size warning and backend Node
  `engines >=18` warning.
- The backend Production runtime log scan for the following hour found no
  error/fatal entries and no `5xx` responses.

## Regression status and explicit gap

- Backend regressions: 94/94 passing in PR #5 CI.
- Preview browser regressions: 16/16 passing in PR #5 CI.
- Migration replay: passing before merge; hosted ledger and behavior were
  independently verified after merge as described above.
- The previously accepted Production real-auth suite remains historically 7/7.
- The dedicated real-auth suite was **not rerun for this release** because its
  `CVF_E2E_*` credential set was unavailable in the execution environment.
  No raw credentials were retrieved or exposed. Therefore the historical 7/7
  result must not be presented as a PR #5 release run.

This gap does not negate the completed public, authentication-boundary, schema,
rollback-probe, CI, and runtime checks above. It remains the one unavailable
release-specific verification layer.
