# CVF PT

## What this is

CVF PT is the internal personal training management app for Core Value Fitness (Albuquerque). It replaces My PT Hub. Users are three owner-coaches (one of whom is admin); clients are invite-only — there is no public signup.

- `frontend/` — React 19 + Vite 6 + Tailwind + shadcn/ui
- `backend/` — Node/Express + Supabase (service-role client)

See the [product overview](docs/product-overview.md) for product intent and role
scope, and the [design principles](docs/design-principles.md) for durable design
guidance. Implementation values remain in the code-level sources linked from
those documents.

Any genuine visual-direction decision (not a bug fix or accessibility
correction) must follow the visual quality review, directional-variant, and
cold-visibility rules in `docs/design-principles.md` before production
implementation — a passing build is not sufficient evidence of "done" for
identity/signature work.

## Locked invariants — do not violate

- **Auth User ≠ Client.** `clients.auth_user_id` is nullable; clients are created by coaches and later claim their record via an invite flow.
- **Waivers are append-only.** `waiver_versions` and `waiver_signatures` are never updated or deleted.
- **Server-side role + ownership enforcement on every endpoint.** Never trust the client for authorization.
- **Soft-delete only** via the `archived` flag — no hard deletes of business records.
- **Stripe is test mode only** until go-live.
- **Service-role-only backend.** RLS is enabled with no policies — Express is the security boundary. Treat every route change as security-sensitive.

## Toolchain

Vite ONLY. CRA/craco were removed — never reintroduce `react-scripts`.

## Agentic execution contract

Strategist/executor tasks use the version-pinned contract in
`.agentic/protocol.md`, the executor role in `.agentic/EXECUTOR.md`, and the
CVF-specific layer in `.agentic/PROJECT_POLICY.md`. Read all three before acting
on a DIAL prompt. They supplement this file; this file's locked invariants and
the host instruction hierarchy remain authoritative.

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
- High Desert visual system: **implemented and passed the visual-quality gate
  for the no-photo target** (see `docs/design-principles.md` and
  `design-qa.md`). The owner's first cold-baseline review classified all six
  signature surfaces UNDERPOWERED; the selected Poster, Medal, and Surge
  corrections then passed paired desktop/mobile comparison and preview
  regression. The implementation retains the shared BrandBackdrop and its
  restrained/cinematic/spectacle recipes, spectacle fixed as the active
  runtime intensity, one-time reduced-motion-safe dashboard/auth
  choreography, data-keyed Progress chart drawing, and genuine
  direction-aware PR celebration. Optional consented photography remains
  intentionally absent and is documented in `frontend/src/assets/photos/README.md`.
- Session "past"-bucketing bug (client + coach Sessions pages): **fixed**.
- Training Builder import/export (deterministic pasted text, CSV/PDF import, `commit_program_import` transactional RPC, branded PDF export): **done for the approved deterministic scope**. Paste import uses the same Program Draft review/edit and atomic commit path, supports one to five days, reuses normalized exercise matches, and tags new exercises `source='manual'` with `review_status='needs_review'`. CSV/PDF draft behavior remains three to five days. AI-assisted PDF parsing is explicitly deferred and remains safely disabled without OpenAI preview configuration.
- Resource Library: **done** — coaches/admins globally manage private-bucket PDF handouts, categories, public visibility, and soft-state client assignments; clients can list/download only public or actively assigned resources through 60-second signed URLs. Storage paths remain backend-only, uploads require PDF MIME plus signature and are capped/rate-limited at 10 MB/10 per 15 minutes, and preview mode contains deterministic public/assigned fixtures.
- Hosted development schema (2026-07-18): **14 migrations applied to PostgreSQL 17** through `20260718191925_retire_session_credit_deduction.sql`. The repository now contains 15 migrations; `20260720173000_exercise_performance_history.sql` is forward-only and has been replayed locally but has not been applied to a hosted environment. The applied history includes the Stripe/credit and dormant payment-era migrations already on `main`; do not edit, remove, reorder, or roll back those applied migrations. Any correction requires explicit owner approval and a new forward-only migration.
- Client exercise history: **implemented** for the active workout tracker with optional performed reps/RPE, snapshotted library identity (and recoverable legacy backfill), exact-source custom matching, completed-set-only occurrence pagination, network-only inline retry states, and preview coverage. Prescribed reps/RPE remain instructions and are never substituted for performed history.
- Stripe/credit system (owner + partners decision, 2026-07-18): active credit/package runtime surfaces are **retired**. Clients continue paying outside the app, with coaches assigning access after payment is handled separately. Session completion never reads, grants, or deducts credits and always records `credit_deducted = false`; workout completion was already credit-independent. Package/payment navigation and UI are absent, `/client/packages` redirects to `/client`, and `/api/packages` plus `/api/payments` are unmounted. Historical balances, transactions, purchases, session flags, dormant source files, and applied schema remain preserved for reversibility. Do not resume or extend this system, including PR #3 (`codex/stripe-payments-and-credits`), without an explicit decision to revisit it. Programs and Resources have never depended on credits or payment status.
- Dormant payment-code reconciliation note (2026-07-18): `main` retains the mixed historical payment source/schema state for reversibility. The workout backend commit accidentally carried over `stripe_subscriptions_offline_payments_and_credit_reviews`, `snapshot_subscription_entitlements`, `audited_payment_review_adjustments`, `archive_resource_with_assignment_choice`, and `honor_import_exercise_choices`; their SQL content matches PR #3 after blank-line normalization. `main` also retains `backend/src/routes/payments.js`, `backend/src/routes/packages.js`, the Stripe npm dependency, and `frontend/src/pages/client/Packages.jsx`; none are mounted or reachable in the active application. `backend/src/services/stripeCatalog.js` remains absent. Do not reconcile, remove, or clean up this dormant code, data, or schema without an explicit decision; removal requires dependency review, backup, and a new forward-only migration rather than ad hoc deletion.
- Vercel isolation: **verified** — `cvfpt-frontend` is rooted at `frontend/` with Vite and `cvfpt-backend` is rooted at `backend/` with Express. Preview and Production variables are configured for their respective aliases. On 2026-07-18 Production was deployed backend-first then frontend, with passing health, CORS, auth, retired-route, and real-auth checks.
- Supabase credential migration: **verified with owner-managed rotation** — Preview and Production intentionally share the same hosted Supabase project and surviving current-format server secret until a real launch domain triggers a separate Production project. Both legacy JWT-based keys remain disabled, the superseded current-format secret was manually deleted by the owner, and safe service reads pass in both environments. Key creation, copying, rotation, and retirement are manual owner-only dashboard actions; agents must stop and ask rather than handle a key.
- Real-auth coach/client verification: **complete for the accepted scope** in `docs/hardening/phase-3-4-flow-verification.md`. The historical expanded API matrix passes 88/88; the current backend regressions pass 60/60, preview browser regressions pass 10/10, and the Production real-auth browser suite passes 7/7 across auth-negative, recoverable load-error, client, coach/Training Builder/Resource Library, session/progress, admin, and workout/notification flows. On 2026-07-11 the owner explicitly deferred successful waiver signing/paper-sign verification until business-approved legal text exists; no legal content was invented or changed. AI-assisted PDF parsing is also explicitly deferred; Stripe live activation and My PT Hub migration remain outside this goal.
- API load failures: **fixed** — top-level coach/client/admin pages and async client-detail tabs retain their skeletons while loading, then expose an accessible retry state instead of an endless skeleton or blank page; live fault-injection/retry coverage passes for both roles.
