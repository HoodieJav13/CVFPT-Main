# Disposable Workout Rescue proof

Requires the existing test-only `@electric-sql/pglite` package, Playwright/Chromium and the repository's backend/frontend dependencies. Adds no manifest dependency. All fixtures use example.invalid identities. No secrets or .env are loaded by the SQL/API harness. The SQL store must be an owned `/tmp/cvf-rescue-db-*` directory; servers bind only127.0.0.1.

```sh
PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node supabase/tests/workout_rescue/pglite-check.mjs
```

This creates a fresh disk-backed store, applies all50 actual migrations in this branch, seeds fictional data, and verifies:

- Actual service-role SQL read/save/start, current coach/client/admin boundaries, unauthenticated table/function denial and RLS.
- Save CAS and original-plan freshness, changed assignment loads, missing/incompatible branch, spoofed actor/target rejection, receipt replay and active override refusal.
- An injected receipt-insert failure after the canonical start rolls back the new log and selected snapshot.
- Original source rows and prior completed logs remain unchanged; completed Rescue receipts remain immutable and replayable after later source edits.
- Saved choices and completed receipt survive a separate Node process reopening the same disk store.
- Actual mounted Express GET/PUT/start and actual `requireAuth` profile/role lookups execute the SQL; current ownership changing after HTTP authentication but before the transaction still denies the write.

The provider token verifier accepts only the four fictional fixture identity tokens; it does not certify real JWT/provider behavior. The narrow PostgREST-shaped test transport executes actual SQL, with Rescue RPCs under `service_role`. Media/telemetry and surrounding program/shell reads are bounded adapters. These adapters live under tests, never in production auth or app configuration.

To test the documented Program History interface without merging branches, additionally set `RESCUE_COMPAT_HISTORY_SQL` to its reviewed `20261027190000_program_change_history.sql` path. Only the disposable local store receives that file; its branch remains untouched.

The proof prints `LOCAL_DB /tmp/cvf-rescue-db-...`. For a **fresh proof store with no active browser-started workout**, run:

```sh
PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node supabase/tests/workout_rescue/browser-check.cjs /tmp/cvf-rescue-db-...
```

The browser check owns normal-mode Vite on58417 and the SQL API on58416, saves an option, stops/restarts the API process, reloads saved choices, verifies desktop1440×1000/mobile390×844 differences, starts via the real handler/RPC and renders the existing tracker. It asserts no page/console errors and cleans up its servers/browser. Screenshots and receipt JSON go to `/tmp/workout-rescue-durable-browser` or `RESCUE_EVIDENCE_DIR`. It deliberately leaves its fictional started workout in the disposable store; use a new proof store for a fresh run.

`pglite-check.mjs serve <directory>` reopens an existing proof store as a loopback interactive synthetic API. Never expose that test adapter publicly. No hosted migrations, credentials, provider calls, CI, paid services or production data are used. PGlite verifies real PostgreSQL/WASM semantics on one connection, not native multi-connection races or hosted PostgREST behavior.

For interactive review without owner-entered test credentials:

```sh
env -i PATH="$PATH" HOME="$HOME" PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node supabase/tests/workout_rescue/local-preview.mjs /tmp/cvf-rescue-db-...
```

Open <http://127.0.0.1:58417/__rescue_demo> and choose the clearly labeled fictional coach/client. The launcher owns both loopback servers and exposes its persona bootstrap only in a local test Vite middleware, outside application runtime/auth. Ctrl-C stops both. It reopens the existing proof store; it does not apply migrations or reset data. A browser-started active workout must be resumed or abandoned before choosing another option.
