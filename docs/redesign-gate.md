# Redesign gate (Look A)

Local only as of 2026-11-19. Nothing here is pushed, merged, applied or deployed.

## What it is

The Look A client flow (source: `claude/pt-look-a-20261114` at `da82ee8`) is in this
repo behind one switch that is **off by default**.

- **Off (default):** the app is today's PT. Every file under `frontend/src`,
  `backend/src`, `supabase/migrations`, the tests and the docs is the same as
  `main` at `fb0c8dd`. A normal frontend build is byte-identical to main's
  (only the service worker's per-build id differs). The backend loads no Look A
  file and serves no Look A route.
- **On:** the app is Look A, file for file the same as `da82ee8`.

## Where Look A lives

Overlay folders that mirror the files they replace:

| Overlay | Stands in for | Loaded at runtime? |
|---|---|---|
| `frontend/redesign/look-a/src/**` | `frontend/src/**` | Only when the frontend switch is on |
| `backend/redesign/look-a/src/**` | `backend/src/**` | Only when the backend switch is on |
| `redesign/look-a/**` (repo root) | tests, e2e specs, SQL, docs, `CLAUDE.md` | Never. Test and reference material only |

The two runtime overlays sit inside their own deploy root, so the
frontend/backend deploy boundary in `CLAUDE.md` is kept.

## The switches

| Part | Switch | Where it is read |
|---|---|---|
| Frontend | `REACT_APP_PT_REDESIGN=look-a` in the real environment at build or dev-server start (not a `.env` file) | `frontend/vite.config.js`, `frontend/redesign/overlayPlugin.mjs`, `frontend/tailwind.config.js` |
| Backend | `PT_REDESIGN=look-a` in the server's environment | `backend/src/lib/redesignGate.js`, first line of `backend/src/app.js` |
| Database | The six migrations in `redesign/look-a/supabase/migrations/` | Not in `supabase/migrations/`, so no tool or merge applies them |

Any other value (`true`, `1`, `on`, empty) leaves the switch off. All three
must be on together: Look A's backend and screens call database functions that
only exist after those six migrations.

## Turning it on locally

```bash
node scripts/redesign.mjs materialize     # writes .redesign/look-a/, a full copy with the overlay applied
node scripts/redesign.mjs verify da82ee8  # proves that copy matches Look A file for file
```

Run Look A's own suites inside `.redesign/look-a/` with the usual commands.
To run the real tree with the switch on:

```bash
cd frontend && REACT_APP_PT_REDESIGN=look-a npm run dev
cd backend && PT_REDESIGN=look-a npm start   # only against a local database that has the six migrations
```

## Tests for the gate itself

- `backend/test/redesign-gate.test.js`: off for every value except `look-a`; on swaps only the changed modules.
- `frontend/tests/unit/redesignGate.test.mjs`: the frontend switch rule.
- `frontend/tests/redesign-gate/` via `npx playwright test --config playwright.redesign-gate.config.mjs`:
  two dev servers from the same folder, switch off and on, synthetic API only.
  On: create, edit, preview, save, reopen, Undo, and two interrupted saves.
  Off: today's tracker, no Look A panel, Undo or requests.

## Not done, on purpose

- No hosted setting was changed and no migration was applied anywhere.
- Hosted switch-on is untested. Before it is tried: the backend's Vercel
  function must be confirmed to bundle `backend/redesign/**` (the overlay is
  loaded by a resolver, not by a static `require`), and both hosted databases
  need the six migrations moved into `supabase/migrations/` under the normal
  migration guard.
- With the switch on through the Vite plugin, the stylesheet carries a few
  classes only today's screens use (Tailwind scans both folders). Harmless.
- When Look A is accepted for good, fold the overlay back into `src/` and
  delete the gate.
