# Exercise media — local runbook

Everything here is LOCAL and owned: a disposable database, an owned PostgREST,
a fictional loopback auth gateway, the real API/worker and the real frontend.
No credentials, no hosted services, no real people or exercise content. Do not
point any of it at a hosted project.

## Prerequisites (one time)

- Node 20+ and npm; `npm --prefix backend ci` and `npm --prefix frontend ci`.
- Docker running (this tooling never starts or restarts Docker).
- Supabase CLI (uses the cached `public.ecr.aws/supabase/postgres` image).
- The processor image, built from the pinned Dockerfile:

  ```bash
  docker build -f scripts/exercise-media/ffmpeg.Dockerfile -t cvfpt-media-ffmpeg:6.1.2-r2-a322 scripts/exercise-media
  ```

  Provenance (base digest, package list, licence): `scripts/exercise-media/tool-provenance.json`.
- Synthetic fixtures are generated on first use into `.exercise-media-local/fixtures`
  (or explicitly: `node backend/scripts/generate-exercise-media-fixtures.cjs .exercise-media-local/fixtures`).

## Run the demo

```bash
npm --prefix backend run dev:media-local
```

It resets the owned `cvfpt-media-test` database (ports 583xx), starts PostgREST
on a free 127.0.0.1 port, the gateway, API and worker, seeds synthetic data
(five synthetic identities, a "Synthetic media session" assigned to the
synthetic client, and published sample guides for the split squat photo, band
row video + instruction and plank stills via the real pipeline), then serves
the frontend at `http://127.0.0.1:42771`. Open
`http://127.0.0.1:42771/__media-demo` and pick a fictional account (coach A,
coach B, admin, client). The runtime manifest (ports, pids, run id) is written
to `.exercise-media-local/run/runtime.json` (no secrets).

Options: `-- --port 42781` (another frontend port), `-- --keep-db` (leave the
database for inspection on stop).

## Stop / resume

- `Ctrl+C` in the launcher stops everything it started and removes the owned
  stack.
- If the launcher was left running elsewhere:

  ```bash
  npm --prefix backend run dev:media-local:down
  ```

  It signals only processes whose recorded pid still matches this tooling and
  removes only containers/volumes carrying the `cvfpt-media-test` labels.
- Resume = run `dev:media-local` again (fresh reset; data is synthetic).
- Media bytes from a run live under `.exercise-media-local/media-dev/`
  (gitignored); delete the folder to reclaim space.

## Tests

| Command | What it proves |
|---|---|
| `npm --prefix backend run test:media` | validation, real-bytes processor (Docker; skips with a reason if the image is missing), authorization/serialization, mounted routes with the real auth middleware, hydration, limits parity |
| `bash supabase/tests/exercise_media/run.sh --down` | SQL contracts, ownership, lifecycle, grants and committed races on the owned stack |
| `bash supabase/tests/exercise_media/stack_guard_test.sh` | stack ownership, teardown and coordination-lock guards (18 cases, no Docker needed) |
| `npm --prefix backend run test:media:integration` | real HTTP → PostgREST → SQL → store → FFmpeg worker → capability bytes (21 cases) |
| `npm --prefix frontend run test:unit` | browser helpers incl. link cache |
| `npm --prefix frontend run test:e2e:preview` | preview lane incl. `exercise-media-preview.spec.mjs` |
| `npm --prefix frontend run test:e2e:media` | normal-mode mocked lane (network budgets, expiry, failures) |
| `npm --prefix frontend run test:e2e:media:local` | real frontend against the real local stack (starts/stops the launcher itself) |

Run the stack-owning commands (`run.sh`, `test:media:integration`,
`test:e2e:media:local`, `dev:media-local`) one at a time: they share the owned
`cvfpt-media-test` stack. They refuse a busy port instead of reusing an
unknown server.

Every stack-owning command first takes the host-wide disposable-database
coordination lock `~/.cvfpt/disposable-db.lock` (override with
`CVFPT_DISPOSABLE_DB_LOCK`), the same protocol the Quick sessions SQL suite
uses, and refuses while any other `supabase_db_cvfpt-*` test database is
running. A demo started with `--keep-db` keeps the lock until
`dev:media-local:down`. A lock held by another project, or left by a crash, is
never broken automatically: inspect its `owner` file and remove it by hand
only when that owner is gone.

## Safety notes

- `backend/integration/local-guard.cjs` is preloaded into the API and worker:
  any non-loopback fetch/http/https/socket is refused.
- The database container is published by the Supabase CLI on `0.0.0.0:58322`
  (CLI default, same as the repository's other test stacks); it holds only
  fictional data and is destroyed on stop.
- The upload limit can be raised for local runs only with
  `EXERCISE_MEDIA_UPLOADS_PER_WINDOW` (1–1000, default 10). The feature is off
  everywhere except the local adapter.
