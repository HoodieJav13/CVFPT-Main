# Durable cue/retry local verification

Run from the repository root with the existing test-only PGlite installation (no runtime dependency or package install):

```sh
PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node supabase/tests/cue_retry/pglite-check.mjs
PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node supabase/tests/cue_retry/browser-check.cjs
```

The second command runs the first proof, then normal-mode Vite/Chromium on loopback58423 plus an owned Express API on58420. It starts/stops and restarts its own API process. A busy port fails rather than reusing another task's server. The scripts never load `.env` or contact Supabase. Use a sanitized environment without provider/push/reporting credentials. `PGLITE_MODULE` must refer to a local existing module; it is only a test tool.

`pglite-check.mjs` loads every actual repository migration into a new disk-backed `/tmp/cvf-cue-db-*` PostgreSQL/WASM store and inserts only synthetic clients/coaches/auth mappings/program/attempts. It checks creation, editing, soft cancellation, exact-source/day linking, pending/fixed/partial/nochange, replay and body mismatch, missing attempts, wrong client/coach, Auth User≠Client, current ownership and reassignment, stale source and retry versions, failed cue-receipt rollback, failed link rollback of the canonical workout and children, protected completed history, invoker/service-only grants and RLS/no browser policies. It reopens the store in separate Node processes and runs the actual mounted HTTP lifecycle.

`http-check.cjs` uses the **real requireAuth middleware and workout router**, including actual Start, set PATCH and Complete handlers. The provider's getUser is a fictional token-to-auth-id map; subsequent profile resolution is real SQL. A narrow test transport maps Supabase queries/RPC calls to parameterized PGlite SQL under `SET LOCAL ROLE service_role`. It is not a replacement runtime adapter. A controlled reassignment between middleware and RPC proves stale HTTP ownership cannot authorize the write. Anonymous/invalid-provider/other-client/other-coach requests are denied. Request bodies cannot forge the start actor/client. The cue/attempt/verdict are read through a new API process after closing the prior database connection.

`browser-check.spec.mjs` runs normal auth/API mode: no preview API binding, no IndexedDB cue adapter, no toolbar, no fixture response substitution for the cue/workout journey. It uses the actual cue form, real HTTP start, actual guided tracker set completion and Finish, coach verdict, API stop/reopen, then reloads the stored cue/verdict at390 and1440px. Only the synthetic provider verifier, SQL transport and empty shell notification counter are adapters. `/api/cue-test/ids` is a test-only fixture locator inside this harness, never a runtime route. Browser contexts and owned API processes close after the test.

Optional compatibility proof:

```sh
CUE_HISTORY_MIGRATION=/absolute/path/to/20261027190000_program_change_history.sql \
PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js \
node supabase/tests/cue_retry/browser-check.cjs
```

The extra independently completed History migration is applied in filename order with the actual chain, without copying it into this branch or modifying its worktree. A future integrated chain has51 files; this branch alone has50. It verifies compilation and the cue/HTTP/browser lifecycle with both installed, not a merge or an exhaustive History feature retest.

For interactive synthetic review, reopen a printed store with `pglite-check.mjs serve /tmp/cvf-cue-db-PRINTED`. This loopback API's fake provider identities must never be exposed publicly. Tokens `cue-coach`/`cue-client` only select fictional records; they are not credentials for any hosted service.

Limitations: single-connection PGlite does not certify concurrent PostgreSQL connections, hosted Auth/PostgREST/schema cache, a full Docker/Supabase reset, production deployment or physical devices. SQL transaction behavior and disk/process persistence are real local evidence. No hosted migration, raw credentials, model calls, cost, push/CI, merge or deploy is performed.
