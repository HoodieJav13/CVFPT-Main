# Coach Notes database boundary check (local, disposable)

`pglite-check.mjs` applies the actual `*_client_coach_notes.sql` migration to the minimum baseline coach/client schema in a disposable single-connection PGlite database. It runs twice: once with Supabase's permissive new-project defaults only, and once with the repository's `restrict_data_api_to_service_role` migration applied first.

In both runs it checks:

- `anon` and `authenticated` (the browser roles PostgREST uses) are denied select, insert, update and delete (`42501`).
- `service_role` can select, insert and update, but not delete.
- RLS is enabled, there are no policies, and the table is in no publication, so there is no realtime path.
- The grants are exactly `service_role` INSERT, SELECT and UPDATE.
- The content, author and foreign-key constraints hold.

Run it with `PGLITE_MODULE` pointing to a test-only `@electric-sql/pglite` build outside this repository. PGlite is never a project dependency.

This is **not** a full Supabase reset, not hosted evidence and not a multi-connection test. The owned Docker stack in `supabase/tests/session_series/stack.sh` remains the full local database path. Application authorization (which coach may see which client's notes) lives in Express and is tested in `backend/test/coach-notes.test.js`.
