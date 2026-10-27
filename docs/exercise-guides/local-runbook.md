# Exercise guides — local runbook

Everything here is LOCAL and owned:

- a disposable database and an owned PostgREST;
- a fictional loopback auth gateway;
- the real API and the real frontend.

There are no credentials, hosted services, real people or real exercise
content. Never point any of it at a hosted project. The API runs with
`backend/integration/local-guard.cjs` preloaded, which refuses any non-loopback
connection, so YouTube is never contacted by the backend. Do not weaken that
guard.

## Prerequisites (one time)

- **Node.** Node ≥ 20.9.0 (backend `engines`; `sharp` 0.35.5 requires it).
  - Verified on host Node 26.7.0.
  - Verified on Linux Node 24.22 (`node:24-bookworm-slim`, arm64 and amd64):
    `npm ci` plus the photo tests.
- **Dependencies.**

  ```bash
  npm --prefix backend ci
  ```

  ```bash
  npm --prefix frontend ci
  ```

- **Docker** must be running for the database stack. This tooling never starts
  or restarts Docker.
- **Supabase CLI**, using the cached `public.ecr.aws/supabase/postgres` image.
- **Photos mode needs no processor image or worker.** Only the full recipe
  needs the pinned FFmpeg image (see the media runbook).

## Recipe 1 — Photo + YouTube guides (default)

```bash
npm --prefix backend run dev:media-local
```

- **What starts.** The launcher resets the owned `cvfpt-media-test` database
  (ports 583xx) under the host-wide lock. It then starts PostgREST on a free
  127.0.0.1 port, the gateway and the API in `photos` mode (no worker).
- **Seed data:**
  - synthetic identities;
  - a "Synthetic guides session" with library-inheriting, custom-override and
    legacy rows;
  - published photo guides, uploaded through the real direct-upload grant
    with inline processing;
  - synthetic YouTube ids (`SYNTHdemo01`/`SYNTHdemo02`), which are
    syntactically valid but not CVF content. YouTube shows its own
    unavailable state for them.
- **Open it.** The frontend is served at `http://127.0.0.1:42771`. Open
  `http://127.0.0.1:42771/__media-demo` and pick a fictional account.
- **Runtime manifest.** `.exercise-media-local/run/runtime.json` records the
  mode, ports, pids and run id. It holds no secrets.

Options:

- `-- --port 42781` serves the frontend on another port;
- `-- --keep-db` leaves the database for inspection after stop.

To try a real playable demo, paste a link from CVF's own channel into a
library exercise or workout row. Only the browser contacts YouTube, and only
after Play.

## Recipe 2 — preserved full owned-video regression

```bash
npm --prefix backend run dev:media-local:full
```

This is the accepted FFmpeg pipeline with its background worker and video
seeds, exactly as documented in
[../exercise-media/local-runbook.md](../exercise-media/local-runbook.md). It
needs the pinned processor image. Its regression lanes are
`npm --prefix backend run test:media:integration` and
`npm --prefix frontend run test:e2e:media:local`; the latter starts the
launcher with `--full`.

## Stop, teardown and ownership

- **Stop.** `Ctrl+C` in the launcher stops everything it started and removes
  the owned stack.
- **A launcher left running elsewhere:**

  ```bash
  npm --prefix backend run dev:media-local:down
  ```

  It signals only processes whose recorded pid still matches this tooling. It
  removes only containers and volumes labelled `cvfpt-media-test`.
- **Locking.** Every stack-owning command takes the canonical host-wide lock
  `~/.cvfpt/disposable-db.lock` first. It refuses while another
  `supabase_db_cvfpt-*` test database runs.
  - A lock held by another project, or left by a crash, is never broken
    automatically. Inspect its `owner` file and remove it only when that
    owner is gone.
  - Do not set a per-checkout lock override to get around another holder.
- **Run stack-owning commands one at a time:** `run.sh`,
  `test:media:integration`, `test:guides:integration`, `test:e2e:media:local`,
  `test:e2e:guides:local` and `dev:media-local`.
- **Stale migrations.** `supabase/tests/exercise_media/stack.sh` copies
  migrations when the stack comes up. After a migration edit, run
  `bash supabase/tests/exercise_media/stack.sh down` before rerunning.
- **Files.** Media bytes and fixtures live under `.exercise-media-local/`
  (gitignored): `media-dev-photos/`, `fixtures-photos/`, `evidence/`. Delete
  that folder to reclaim space.

## Tests

| Command | What it proves |
|---|---|
| `npm --prefix backend test` | all backend unit/route tests, including parsing parity, reference modes, Quick v1 golden vectors, image processor, photo store, upload intents, Supabase adapter contract and content-stream abort |
| `npm --prefix frontend run test:unit` | browser helpers: demo parsing/DTO trust, player size/guard/error copy, local still helpers, photo upload transport |
| `bash supabase/tests/exercise_media/run.sh --down` | media SQL contracts, grants and committed races, plus `05_guides.sql` (modes, writers) and `06_photo_uploads.sql` (intents, leases) |
| `npm --prefix backend run test:guides:integration` | real HTTP → PostgREST → SQL → store in photos mode: grant/finalize/inline processing/resume, live reference propagation, Quick v1 replay; no worker |
| `npm --prefix backend run test:media:integration` | preserved full owned-video lane (FFmpeg worker) |
| `npm --prefix frontend run test:e2e:guides` | mocked browser lane: zero pre-Play provider traffic, one fixed-origin player, errors, 320px/200%-zoom sizing, focus, tracker/plan/history actions, still selection |
| `npm --prefix frontend run test:e2e:guides:local` | real frontend against the photos launcher (YouTube hosts stubbed in the browser) |
| `npm --prefix frontend run test:e2e:youtube-proof` | browser-only proof against the **real** YouTube embed with an approved public sample (see below) |
| `npm --prefix frontend run test:e2e:media`, `test:e2e:media:local`, `test:e2e:quick-sessions`, `test:e2e:preview` | preserved media, Quick and preview regressions |
| `CVF_GUIDES_BASELINE_DIR=<f3c063c clone> npm --prefix frontend run capture:guides-visual`, then `node scripts/exercise-guides/build-visual-review.mjs` | regenerates the paired before/after evidence in `visual-review/` |

### Real-provider proof

`test:e2e:youtube-proof` is the only lane that reaches Google.

- It runs headless Chromium against a test-only harness page with a public
  embeddable sample. It uses no app data, cookies or tokens.
- It records:
  - zero provider requests before Play;
  - `onReady`;
  - the nocookie embed src;
  - an origin-only `embed_referer`;
  - the hosts contacted after Play;
  - the real error for a missing id (150).
- It does not prove behavior on physical phones or Safari.

### Real-device manual matrix (not run)

The following has not been performed. Use an approved CVF channel link on
each device:

| Device / browser | Steps | Expect |
|---|---|---|
| iPhone Safari (current iOS) | tracker → View demo → Play; rotate; captions; full screen; close; log a set | inline playback (`playsinline`), captions toggle, close stops audio, logging unaffected |
| Android Chrome | same | same |
| Desktop Safari / Firefox / Chrome | same, plus keyboard only: Tab → Enter → Tab into player → Shift+Tab → Escape | focus visible, Escape closes from the player region |
| Any, with YouTube blocked (school/work network) | Play | limited or error state with Open on YouTube; workout continues |
| Any, embedding disabled on the video | Play | 101/150 copy plus Open on YouTube |
