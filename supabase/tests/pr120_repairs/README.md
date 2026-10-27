# PR120 repair SQL checks

These checks cover the forward migration `20261024144208_pr120_atomic_substitution_and_program_dedupe.sql`, which fixes two PR120 review findings:

- **4366537631:** `decide_workout_substitution` makes one atomic decision on a swap. The first decision wins, the same event replays, and a failure rolls everything back.
- **4366537642:** `apply_program_substitution` changes a workout that is reused on several program days only once. It keeps the per-day preview and the per-day audit.

All data is fictional. No check accepts a database URL or reaches a hosted project.

| File | What it covers |
|---|---|
| `fixtures.sql` | Fictional coach, clients, a private workout reused on days 1 and 2, logs and swaps |
| `01_substitution_decision.sql` | Approve first and decline first; competing decisions; replay; rollback on activation failure; refusal on a finished workout; log scoping; history kept |
| `02_program_dedupe.sql` | One replacement for a reused workout; audit for both days; partial and stale previews refused; replay; logged history unchanged |
| `03_grants.sql` | `service_role`-only execute; SECURITY INVOKER; empty `search_path`; no PUBLIC, RLS or policy change |
| `pglite-check.mjs` | Optional disposable check for PGlite 0.3.x in WASM |
| `concurrency.sh` | Real multi-connection races in an owned, disposable PostgreSQL container |

## How to run

### PGlite check

```bash
PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node supabase/tests/pr120_repairs/pglite-check.mjs [migrations-dir]
```

- It applies the whole migration chain with a minimal Supabase-shaped prelude, then runs each `0*.sql` file with the fixtures inside a transaction that is rolled back.
- Pass another migrations directory, such as an export of an older commit, to see that commit's behaviour.
- It uses a **single connection**, so it does not show concurrent sessions.

### Real-connection races

```bash
PR120_DB_CONTAINER=<name> PR120_DB_OWNER=<label> bash supabase/tests/pr120_repairs/concurrency.sh
```

The script never starts, pulls or stops a container. You provide one, and the script refuses unless it carries the label `cvfpt.owner=<label>`.

It:
1. builds a template database with the chain and fixtures;
2. runs `0*.sql` in real PostgreSQL;
3. runs four overlapping two-session races, each in a fresh clone:
   - approve while a decline waits;
   - decline while an approve waits;
   - the same event twice;
   - two program applications.

The first session holds its transaction for 2 s, so the second must wait for the lock and then see the committed result. The script drops its databases at the end.

## What these checks do not prove

None of this proves hosted application, PostgREST behaviour or production load.
