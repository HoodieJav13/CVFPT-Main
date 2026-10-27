# Durable Program Change History — isolated SQL/HTTP/browser verification

This local-only harness uses the repository's existing test-only PGlite pattern. It loads all 50 canonical migrations into a fresh disk directory under `/tmp/cvf-history-db-*`, then inserts fictional fixtures. It never loads `.env`, credentials or hosted data. PGlite is reused read-only from an existing installation and is not a project/runtime dependency.

```sh
PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node supabase/tests/program_history/pglite-check.mjs
# With the fixture frontend at 127.0.0.1:58261:
PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node supabase/tests/program_history/browser-check.cjs
# Reopen a printed persisted directory, exposing only a synthetic loopback API:
PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node supabase/tests/program_history/pglite-check.mjs serve /tmp/cvf-history-db-PRINTED
```

`pglite-check.mjs` verifies no backfill; exact stored program before/after revisions; successful workout edits; rollback of program **and** workout edits when journal insertion fails; stable author-name snapshots after renaming a coach; denied other-coach writes; append-only grants/trigger; RLS with no browser policies; denied browser-role reads and RPC execution; unchanged completed log, exercise and nonempty completed-set snapshots; and refusal of an actual attempted completed-set modification. It closes the database and starts a **separate Node process** to read the persisted revisions and run the real frontend diff against them.

`http-check.cjs` mounts the actual Express programs router. A narrow SQL-backed test adapter replaces Supabase transport and a fictional role shim replaces the auth provider; the application access checks remain real. Program PUT calls the actual new transaction RPC, then GET history returns the stored DTO. Anonymous/client denials and current-client reassignment masking/admin access are checked. This is not hosted Supabase Auth/PostgREST certification.

`browser-check.cjs` starts and stops owned API child processes gracefully. A fictional preview shell has a test-only history-request binding to the actual local Express/SQL response. It makes a real program PUT, restarts the API process, then checks the persisted before/after diff in the existing dialog at390/1440px. The binding does not change any runtime preview gate or shipped routing. Screenshots explicitly retain the fictional surrounding shell; they prove stored-diff rendering after restart, not an authenticated deployed journey.

Single-connection PostgreSQL/WASM is sufficient for transactional rollback and process persistence here. It does **not** certify multi-connection races, PostgREST schema cache, a full Supabase/Docker reset, production, physical devices or hosted operation. Both supported edit wrappers serialize through the same PostgreSQL transaction advisory lock and hold a shared lock on the client's ownership row while saving. Real multi-connection verification remains a later environment check.

The new migration was applied only to these disposable local stores. The installed Supabase CLI's help path failed while attempting to write telemetry outside the sandbox; its bundled Go helper has no migration command. The parent explicitly authorized repository schema files, so the new unique forward-only migration filename was written locally after inventorying the existing49 versions. No user settings were changed, and no hosted migration ran.
