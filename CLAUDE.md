# CVF PT

## What this is

CVF PT is the internal personal training management app for Core Value Fitness (Albuquerque). It replaces My PT Hub. Users are three owner-coaches (one of whom is admin); clients are invite-only — there is no public signup.

- `frontend/` — React 19 + Vite 6 + Tailwind + shadcn/ui
- `backend/` — Node/Express + Supabase (service-role client)

## Locked invariants — do not violate

- **Auth User ≠ Client.** `clients.auth_user_id` is nullable; clients are created by coaches and later claim their record via an invite flow.
- **Waivers are append-only.** `waiver_versions` and `waiver_signatures` are never updated or deleted.
- **Server-side role + ownership enforcement on every endpoint.** Never trust the client for authorization.
- **Soft-delete only** via the `archived` flag — no hard deletes of business records.
- **Stripe is test mode only** until go-live.
- **Service-role-only backend.** RLS is enabled with no policies — Express is the security boundary. Treat every route change as security-sensitive.

## Toolchain

Vite ONLY. CRA/craco were removed — never reintroduce `react-scripts`.

## Deploy architecture — read before adding cross-cutting code

Frontend and backend deploy as **two separate Vercel projects**, each rooted at its own directory (`frontend/` and `backend/`). Neither project's build can see files outside its own root.

**Never `require`/`import` across the `frontend/` ↔ `backend/` boundary, and never reference a repo-root-level shared folder.** A prior bug (Training Builder import/export v1) reached outside `backend/` for both a shared validation module and a logo asset; it passed every local build/smoke-test and would have 500'd in production, because local checkouts have the full monorepo on disk and an isolated Vercel deploy does not. If logic or an asset is needed in both projects, duplicate it into both trees (see Known duplication below) — don't share a path across the deploy boundary.

## Brand system

- **Fonts:** Oswald (display, weights 500/600/700), Inter (body).
- **Color tokens** (`frontend/src/index.css`): `--primary` (teal, brand/action), `--gold` (Zia gold, synced from the CVF Leagues repo — credits/achievement/pending only), `--success` (tokenized, not raw `emerald-*`), `--destructive` (alerts/destructive only). Never hardcode hex in components — semantic rules are documented in the CSS itself.
- **Assets:** logo at `frontend/public/logo.png` (fallback: CVF lettermark if the image 404s), Sandia ridge background at `frontend/public/backgrounds/sandia-wide-hero-bg.svg`. Two unused CTA-background SVGs (`sandia-free-agent-cta-bg.svg`, `sandia-team-interest-cta-bg.svg`) also live in that folder, carried over from Leagues — not currently wired to any PT screen.
- **PDF export** (`backend/src/routes/programs.js`, `generateProgramPdf`) cannot read CSS variables — its teal/gold are hardcoded hex literals kept manually in sync with the tokens above. If you change `--primary` or `--gold`, update the matching hex in that function too.

## Known duplication

- Program Draft logic is intentionally duplicated as browser ESM at `frontend/src/lib/programDraft.js` and backend CommonJS at `backend/src/lib/programDraft.cjs` — see Deploy architecture above. Changes to the CSV/PDF Program Draft schema must be applied to both copies.
- The real CVF logo is duplicated at `frontend/public/logo.png` (served to the browser) and `backend/src/assets/cvf-logo.png` (used by PDF export) for the same reason.

## Preview mode

`previewMode.js` is a DEV-only mock layer, double-gated, pending a keep/kill decision. Do not extend it without being asked.

## Conventions

- Functional and visual changes go in **separate commits**; keep commits small and scoped.
- Design tokens only — no hardcoded hex colors in components (PDF export is the one necessary exception — see Brand system above).
- Cross-project code/assets get duplicated, never shared via a path that crosses the frontend/backend deploy boundary.

## Status (updated as of this session)

- Toolchain/scaffolding cleanup, brand token foundation, and visual elevation pass: **done**.
- Session "past"-bucketing bug (client + coach Sessions pages): **fixed**.
- Training Builder import/export v1 (CSV/PDF import, `commit_program_import` transactional RPC, branded PDF export): **done**, deploy-root and browser-module bugs fixed, verified locally and in preview-mode browser CI — a real isolated Vercel deploy of `backend/` still needs smoke testing.
- Hosted development schema: **current** — four versioned migrations applied to PostgreSQL 17; 23/23 tables use RLS with no policies, eight RPCs are service-role-only invoker functions, and direct anon/authenticated table grants are revoked.
- Vercel isolation: **projects created and Git-connected** — `cvfpt-frontend` is rooted at `frontend/` with Vite; `cvfpt-backend` is rooted at `backend/` with Express. Preview variables and deployments remain pending.
- Outstanding: securely configure and verify a current Supabase secret key, confirm the legacy service-role key is disabled, deploy both Vercel previews, and complete real-auth coach/client verification.
