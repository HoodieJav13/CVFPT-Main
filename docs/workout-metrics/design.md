# Duration and distance workout logging — 2026-10-05

Base: 3886fef15db67b1177a0d4cf468fd8d654d42b3e, freshly cloned main. Branch: codex/workout-duration-distance.
DIAL: EXECUTE. Protocol v1.1. Authority: inspect/edit/test/local scoped commits allowed by delegated owner instruction and PROJECT_POLICY; push/merge/deploy/hosted migrations/sends/costs/new credentials forbidden for this task. No real client data.

## Contract

The coach explicitly configures each workout exercise, rather than changing the shared library identity. Modes: `reps_weight` (existing default, includes bodyweight with blank weight), `duration`, `distance`, `duration_distance`. Optional weight and RPE remain supported in every mode. Modes are never inferred from names, categories, or blank loads.

Targets: duration_value/unit and distance_value/unit. Actuals: actual_duration_value/unit and actual_distance_value/unit. Pairs are nullable together, positive finite numeric values, duration <=24 hours and distance <=1,000,000 metres. Units: s/min, m/km/mi/yd. Values retain entered units; changing a unit explicitly reinterprets the number, with UI guidance, rather than silently converting it. Targets are optional instructions; performed metrics start blank and are never populated from a target. Legacy weight initialization remains unchanged.

Snapshot mode and targets on workout_log_exercises at INSERT. Existing active/completed logs default to reps_weight and retain every existing field. Resume reads the snapshot; source changes never reinterpret prior data. History returns the snapshot mode and actual pairs, and Same as last time only fills matching modes and blank fields. Invalid/wrong-mode metrics fail before mutation; DB checks enforce pair/range invariants and a set trigger enforces its exercise's snapshot mode.

## Persistence and verification

Additive numbered migration only; retain existing history RPC and introduce a versioned extended RPC to avoid breaking old callers. Extend save_workout/clone_workout/import commit, including program and session private copies through existing clone_workout delegation. Use insert snapshot trigger to preserve current start RPC authorization, concurrency/idempotency, attribution and session linkage.

Test-first pure and mounted handler regressions, local synthetic legacy/new SQL fixtures, offline add/reconciliation, same-time fills and mode mismatches, coach save/reopen, client tracker/finish/history at mobile and desktop, existing regression suites and deploy-boundary checks. No broad design work, sides, metrics or analytics.

## Release/rollback

Every metric write must be echoed by the server before its outbox operation is removed. An older server that ignores new fields keeps the operation pending with a retry message and prevents FIFO completion from overtaking it. Extended history includes snapshot IDs so repeated uses of one library exercise remain distinct. A new atomic quick-complete RPC refuses edited logs, clears untouched load defaults and invokes existing completion logic; resumed workouts remain for explicit tracker completion. Set INSERT takes a shared lock on the parent log before checking status, serializing it with completion without adding parent locking to ordinary UPDATEs.

Local only. Both Vercel roots auto-deploy on main merge and branch previews may build on push. Do not push. Before a separately approved hosted release, apply and independently verify the backward-compatible migration in development and production, obtain migration-applied/prod-migration-applied labels, then release backend and frontend. Roll back application code while retaining the additive columns, versioned history RPC and values; never drop logged data. Existing constraints/immutability/RLS/grants remain active. Rollback migration transaction during synthetic tests; no production down migration.
