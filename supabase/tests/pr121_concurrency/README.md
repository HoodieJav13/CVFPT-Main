# PR121 program-application concurrency checks

These checks cover the forward migration `20261024180520_pr121_program_substitution_concurrency.sql`, which replaces `apply_program_substitution`. They use fictional data and never reach a hosted project.

## Fixtures

They reuse `../pr120_repairs/fixtures.sql` and add `fixtures_shared_program.sql`: a second client-private program for the same client that uses the same private workout. `save_program` accepts this arrangement.

## Single session: `04_cross_program_sequential.sql`

- After the first program's application, the second program's earlier preview is stale.
- A fresh preview of the second program is empty.
- There is one active row in the shared workout.

`pglite-check.mjs` runs this file together with `../pr120_repairs/0*.sql` in disposable PGlite. That is a **single connection**, so it cannot show races.

## Real races: `concurrency.sh`

```bash
PR121_DB_CONTAINER=<name> PR121_DB_OWNER=<label> [MIGRATIONS_DIR=<dir>] bash concurrency.sh
```

The script runs two overlapping psql sessions in an owned, disposable PostgreSQL container. It refuses unless the container carries the label `cvfpt.owner=<label>`, and it never starts, pulls or stops containers. The first session holds its transaction for 2 s after applying.

| Race | Scenario | Expected result |
|---|---|---|
| E / E2 | Two private programs share a workout, in both orders | The later one waits, then gets `preview_mismatch`; one replacement and one receipt |
| F | The same application id twice, as a retry after a lost reply | `applied` / `replayed`; one replacement and one receipt |
| G | The same application id reused with another program's payload | `replayed` with the first application; never a second write |

## Showing the old behaviour

Point `MIGRATIONS_DIR` at an older migrations directory to run the same races against it. Before this migration:
- E and E2 both applied, leaving two replacements;
- F returned `preview_mismatch`;
- G raised a unique-key error.
