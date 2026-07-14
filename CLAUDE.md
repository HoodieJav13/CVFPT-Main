# CVF PT

## What this is

CVF PT is the internal personal training management app for Core Value Fitness (Albuquerque). It replaces My PT Hub. Users are three owner-coaches (one of whom is admin); clients are invite-only — there is no public signup.

- `frontend/` — React 19 + Vite 6 + Tailwind + shadcn/ui
- `backend/` — Node/Express + Supabase (service-role client)

See the [product overview](docs/product-overview.md) for product intent and role
scope, and the [design principles](docs/design-principles.md) for durable design
guidance. Implementation values remain in the code-level sources linked from
those documents.

## Locked invariants — do not violate

- **Auth User ≠ Client.** `clients.auth_user_id` is nullable; clients are created by coaches and later claim their record via an invite flow.
- **Waivers are append-only.** `waiver_versions` and `waiver_signatures` are never updated or deleted.
- **Server-side role + ownership enforcement on every endpoint.** Never trust the client for authorization.
- **Soft-delete only** via the `archived` flag — no hard deletes of business records.
- **Stripe is test mode only** until go-live.
- **Service-role-only backend.** RLS is enabled with no policies — Express is the security boundary. Treat every route change as security-sensitive.

## Toolchain

Vite ONLY. CRA/craco were removed — never reintroduce `react-scripts`.

## Migrations

- `supabase/migrations/` is the single source of truth for the database schema
  and migration history. Manage it with the Supabase CLI.
- Every schema change must be captured in a **new numbered migration**. Never
  edit, rename, replace, or delete a migration that has already been applied.
- `backend/migration.sql` is frozen as a historical record of the schema before
  versioned migrations. Do not edit it or run it against a database where the
  versioned migrations have been applied.

## Browser Automation

Use `agent-browser` for web automation. Run `agent-browser --help` for all commands.

## Deploy architecture — read before adding cross-cutting code

Frontend and backend deploy as **two separate Vercel projects**, each rooted at its own directory (`frontend/` and `backend/`). Neither project's build can see files outside its own root.

**Never `require`/`import` across the `frontend/` ↔ `backend/` boundary, and never reference a repo-root-level shared folder.** A prior bug (Training Builder import/export v1) reached outside `backend/` for both a shared validation module and a logo asset; it passed every local build/smoke-test and would have 500'd in production, because local checkouts have the full monorepo on disk and an isolated Vercel deploy does not. If logic or an asset is needed in both projects, duplicate it into both trees (see Known duplication below) — don't share a path across the deploy boundary.

## Brand system

- **Fonts:** Oswald (display, weights 500/600/700), Inter (body).
- **Color tokens** (`frontend/src/index.css`): `--primary` (teal, brand/action), `--gold` (Zia gold, synced from the CVF Leagues repo — credits/achievement/pending only), `--success` (tokenized, not raw `emerald-*`), `--destructive` (alerts/destructive only). Never hardcode hex in components — semantic rules are documented in the CSS itself.
- **Assets:** logo at `frontend/public/logo.png` (fallback: CVF lettermark if the image 404s), Sandia ridge background at `frontend/public/backgrounds/sandia-wide-hero-bg.svg`. The shared `BrandBackdrop` owns all ridge usage and the optional build-time photo slots documented in `frontend/src/assets/photos/README.md`; the approved active target is the no-photo fallback until consented photography exists. Two unused CTA-background SVGs (`sandia-free-agent-cta-bg.svg`, `sandia-team-interest-cta-bg.svg`) also live in that folder, carried over from Leagues — not currently wired to any PT screen.
- **PDF export** (`backend/src/routes/programs.js`, `generateProgramPdf`) cannot read CSS variables — its teal/gold are hardcoded hex literals kept manually in sync with the tokens above. If you change `--primary` or `--gold`, update the matching hex in that function too.

## Known duplication

- Program Draft logic is intentionally duplicated as browser ESM at `frontend/src/lib/programDraft.js` and backend CommonJS at `backend/src/lib/programDraft.cjs` — see Deploy architecture above. Changes to the paste/CSV/PDF Program Draft schema must be applied to both copies.
- The real CVF logo is duplicated at `frontend/public/logo.png` (served to the browser) and `backend/src/assets/cvf-logo.png` (used by PDF export) for the same reason.

## Preview mode

`previewMode.js` is a DEV-only mock layer, double-gated, pending a keep/kill decision. Do not extend it without being asked.

## Conventions

- Functional and visual changes go in **separate commits**; keep commits small and scoped.
- Design tokens only — no hardcoded hex colors in components (PDF export is the one necessary exception — see Brand system above).
- Cross-project code/assets get duplicated, never shared via a path that crosses the frontend/backend deploy boundary.

## Status (updated as of this session)

- Toolchain/scaffolding cleanup, brand token foundation, and visual elevation pass: **done**.
- High Desert visual system: **done for the no-photo target** — shared BrandBackdrop with restrained/cinematic/spectacle intensity, cinematic default, one-time reduced-motion-safe dashboard/auth choreography, data-keyed Progress chart drawing, and genuine direction-aware PR celebration. Optional consented photography remains intentionally absent and is documented in `frontend/src/assets/photos/README.md`.
- Session "past"-bucketing bug (client + coach Sessions pages): **fixed**.
- Training Builder import/export (deterministic pasted text, CSV/PDF import, `commit_program_import` transactional RPC, branded PDF export): **done for the approved deterministic scope**. Paste import uses the same Program Draft review/edit and atomic commit path, supports one to five days, reuses normalized exercise matches, and tags new exercises `source='manual'` with `review_status='needs_review'`. CSV/PDF draft behavior remains three to five days. AI-assisted PDF parsing is explicitly deferred and remains safely disabled without OpenAI preview configuration.
- Resource Library: **done** — coaches/admins globally manage private-bucket PDF handouts, categories, public visibility, and soft-state client assignments; clients can list/download only public or actively assigned resources through 60-second signed URLs. Storage paths remain backend-only, uploads require PDF MIME plus signature and are capped/rate-limited at 10 MB/10 per 15 minutes, and preview mode contains deterministic public/assigned fixtures.
- Hosted development schema: **six migrations applied to PostgreSQL 17; one pending on this branch** — `20260714004350_add_metric_improvement_direction.sql` is the seventh versioned migration and must be applied before deploying the metric-direction/PR feature. The applied schema has 26/26 tables using RLS with no policies, eight RPCs as service-role-only invoker functions, and revoked direct anon/authenticated table grants. Program storage accepts one to five days and the private `resource-library` bucket is PDF-only with a 10 MB limit.
- Vercel isolation: **verified** — `cvfpt-frontend` is rooted at `frontend/` with Vite and `cvfpt-backend` is rooted at `backend/` with Express. Both protected previews are deployed, required preview variables are configured, the frontend bundle targets the backend branch alias, and the backend Preview alias was redeployed on 2026-07-13 with passing health/CORS/auth/service-read checks.
- Supabase credential migration: **verified with owner-managed rotation** — Preview and Production intentionally share the same hosted Supabase project and surviving current-format server secret until a real launch domain triggers a separate Production project. Both legacy JWT-based keys remain disabled, the superseded current-format secret was manually deleted by the owner, and safe service reads pass in both environments. Key creation, copying, rotation, and retirement are manual owner-only dashboard actions; agents must stop and ask rather than handle a key.
- Real-auth coach/client verification: **complete for the accepted scope** in `docs/hardening/phase-3-4-flow-verification.md`. The expanded API matrix passes 88/88, backend regressions pass 50/50, preview browser regressions pass 6/6, and the real-auth browser suite passes 6/6 across auth-negative, recoverable load-error, client, coach/Training Builder/Resource Library, session/payment/progress, and admin flows. On 2026-07-11 the owner explicitly deferred successful waiver signing/paper-sign verification until business-approved legal text exists; no legal content was invented or changed. AI-assisted PDF parsing is also explicitly deferred; Stripe live activation and My PT Hub migration remain outside this goal.
- API load failures: **fixed** — top-level coach/client/admin pages and async client-detail tabs retain their skeletons while loading, then expose an accessible retry state instead of an endless skeleton or blank page; live fault-injection/retry coverage passes for both roles.
