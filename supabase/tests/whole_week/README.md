# Whole-week SQL verification (local only)

Tests for `supabase/migrations/20261030002155_whole_week_outside_activity.sql`.
Everything here is fictional (`example.invalid`, fixed `00000000-0000-4000-8000-…`
ids) and disposable. No hosted project id, URL, key or env file is read or
accepted.

## Single connection: `pglite-check.mjs`

```sh
PGLITE_MODULE=/abs/test-only/node_modules/@electric-sql/pglite/dist/index.js \
  node supabase/tests/whole_week/pglite-check.mjs          # standalone schema.sql + this migration
PGLITE_MODULE=... node supabase/tests/whole_week/pglite-check.mjs --full   # every repo migration, filename order
```

Each `0*.sql` group runs as `begin; fixtures.sql; group; rollback;`, and the
runner checks nothing leaked between groups. PGlite is a test-only module
outside the repository, not a project dependency.

| Group | Covers |
|---|---|
| `01_ledger.sql` | type/date required; unknown duration/effort/label/note stay NULL; known subtotal + missing-duration count; strict calendar dates (Feb 30, non-leap Feb 29, non-canonical shapes); Denver "today" accepted, Denver tomorrow refused; spring-forward and fall-back week bounds; empty week; strict envelope; reads never insert preferences |
| `02_replay_revisions.sql` | identical replay commits once; omitted vs explicit-null normalize alike; changed body/action/resource with the same id → `request_mismatch`; new id = legitimate repeat; per-actor receipts; stale revision edit → `revision_conflict` with no overwrite; older replay reports its own `committed_revision` beside the newer row; partial field masks retain omitted values and clear explicit nulls; direct writer still advances the revision; failed receipt insert rolls the write back; soft archive, archived tombstone replay, `archived` refusals |
| `03_authorization.sql` | unrelated coach/other client/unlinked user masked 404 for read/write/replay; forged client id; Auth User ≠ Client (client id as auth id, NULL auth id); admin on behalf; reassignment before replay (no receipt disclosure), new coach sees history; admin demotion, archived coach, removed client auth link, archived client |
| `04_preferences.sql` | missing row = off for client and coach; role-separated bits (403); early client opt-out; coach enable does not override opt-out; coach-on-behalf refused while opted out; client reversal; history stays visible/correctable after opt-out; pre-opt-out receipts still replay; check-in reminder bits; revision guard |
| `05_grants.sql` | RLS on, no policies, no anon/authenticated table or EXECUTE privilege, PUBLIC has no EXECUTE, least service grants (no DELETE/TRUNCATE; receipts select/insert), invoker functions with pinned empty `search_path`, owner-level triggers (no delete, immutable identity/author, append-only receipts, no un-archive), minimal receipt columns with no note text |

| `06_partial_and_workouts.sql` | partial correction/null mask replay semantics; PT workout counts and Denver DST ranges inside the authorized read RPC; unavailable table read stays unavailable |
| `07_paging.sql` |215 same-date rows across100/100/15 pages, exact order/no skips/duplicates, full-week totals, row201 correction, strict wrong-client/malformed cursor refusal, former-owner denial |

`read_whole_week` has optional fourth argument `p_cursor jsonb`: exactly
`{client_id,week_start,occurred_on,id}` from the preceding page. Each page
rechecks current authorization and takes the same client/actor locks. Concurrent
edits are live data; the cursor does not promise a transactionally frozen week.

This is not evidence of multi-connection behavior or hosted application.

## Two connections: `concurrency.sh`

```sh
bash supabase/tests/whole_week/concurrency.sh
```

Creates a throwaway cluster with `initdb` in a fresh `/tmp` directory (unix
socket only, no TCP), applies `schema.sql` and the migration, runs five
committed races, and deletes the cluster on exit. It clears libpq environment
overrides and takes no connection arguments. Races: in-flight identical replay
(one row; the waiting call replays), simultaneous stale edits (one
`revision_conflict`), reassignment committed while a coach write waits on the
client lock (404, no receipt), admin demotion committed while the admin write
waits on the coach row (404), client opt-out committed while a coach-on-behalf
create waits (`collection_off`). Requires local PostgreSQL server binaries;
without them it exits 2 (`BLOCKED-ENVIRONMENT`).

The standalone `schema.sql` copies the baseline `coaches`/`clients` columns.
It does not reproduce later migrations' triggers on those tables; `--full`
mode applies the real chain for the single-connection groups.
