# Set value origin tests (cross-device Undo, local migration 20261113000000)

Local-only migration `supabase/migrations/20261113000000_set_value_origin.sql`
adds `workout_log_sets.value_origin` (`legacy | unknown | prefill | entered`),
its nonce and prefill snapshot, `workout_set_events.declared_origin`, the
`set_value_origin_guard` trigger, `apply_workout_set_event_v2` and keeps
`apply_workout_set_event` as a same-signature wrapper. It has not been applied
to any hosted database.

## Single connection (PGlite, WASM)

    PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node supabase/tests/value_origin/pglite-check.mjs

Each `0*.sql` file runs in its own rolled-back transaction with
`../pr120_repairs/fixtures.sql` plus `fixtures.sql`. Covers defaults, the guard
for every undeclared writer, v2 declarations, the snapshot rule (including a
prescription changed while completed), conflicts/replay/finished logs, trigger
ordering with the immutability and metrics triggers, the v1 signature and
grants. It proves function logic, not concurrent sessions.

## Two connections (disposable PostgreSQL 17)

    bash supabase/tests/value_origin/local-concurrency.sh

Creates, owns and deletes a throwaway Homebrew PostgreSQL 17 cluster (Unix
socket only, no TCP), using `cluster_guard.sh` and
`race_helpers.sql` in this folder (byte-identical copies of the cockpit harness helpers). Races: Undo vs plan edit,
plan edit vs explicit write, coach write vs Undo, another device vs Undo (with
a mutant negative control), Undo vs legacy PATCH. Evidence goes under
`evidence/pt-full-undo-20261112/cross-device-impl/pg17-races/`. It proves
PostgreSQL row-lock behaviour with a synthetic superuser and fictional data,
not hosted authentication, RLS or PostgREST.

## Client rules against real rows (Ultra F1/F2, 2026-11-12)

    PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node supabase/tests/value_origin/client-integration.mjs

Two disposable PGlite databases: every migration ('new') and every migration
except `20261113000000` ('old': a server not yet migrated). Each statement is
its own transaction, as separate requests are. The real frontend rule
functions (`ackPrefillMarker`, `annotateValueViews`, `unresolvedPrefillSet`,
`exerciseQuickPlan`) decide, and their quick-complete payload is applied
through the real RPCs. A small emulation of the backend request mapping
(event write, legacy no-event write, read) sits in between and is documented
at the top of the file. Vectors on both databases: a legacy write of 50 and of
55 after an acknowledged Undo (F1, revision and last event id unchanged); a
replayed Undo after another device entered 50 and 55 (F2); controls with no
false gate for this device's own acknowledged Undo and own same-value save; a
lost acknowledgement with no other writer; a legacy write after an own entered
save; recovery by an own explicit entry. It proves the client rules against
real rows, not HTTP, authorization, concurrency or hosted behaviour.
