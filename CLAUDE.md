# CVF PT

## What this is

CVF PT is the internal personal training management app for Core Value Fitness (Albuquerque). It replaces My PT Hub. Users are three owner-coaches (one of whom is admin); clients are invite-only — there is no public signup.

- `frontend/` — React 19 + Vite 6 + Tailwind + shadcn/ui
- `backend/` — Node/Express + Supabase (service-role client)

See the [product overview](docs/product-overview.md) for product intent and role
scope, and the [design principles](docs/design-principles.md) for durable design
guidance. Implementation values remain in the code-level sources linked from
those documents.

Visual-direction changes (not bug fixes or accessibility corrections) are
approved by the owner from mockups or a live prototype before production
implementation, per `docs/design-principles.md` — a passing build is not
sufficient evidence of "done" for visual work. The design principles are
guidance; the owner removed the old review gates on 2026-10-01.

Design QA tooling (2026-08-11): `docs/design-qa-surface-audit.md` is the
per-surface pre-launch checklist; `docs/design-reference-links.md` is the
vetted external reference list (including tools evaluated and rejected — do
not re-propose those without new information). The Agentation annotate
overlay mounts in dev/preview builds only (never production, never under
test automation). The project-scoped `impeccable` Claude Code plugin is
**audit-only**: its findings are proposals; this file's brand tokens and
`docs/design-principles.md` always take precedence, and any restyle it
suggests still needs owner approval.

## Locked invariants — do not violate

- **Auth User ≠ Client.** `clients.auth_user_id` is nullable; clients are created by coaches and later claim their record via an invite flow.
- **Waivers are append-only.** `waiver_versions` and `waiver_signatures` are never updated or deleted.
- **Server-side role + ownership enforcement on every endpoint.** Never trust the client for authorization.
- **Soft-delete only** via the `archived` flag — no hard deletes of business records.
- **Payments are outside CVF PT.** Active package/payment/credit surfaces remain
  retired. Dormant Stripe source and historical data stay preserved and
  unreachable unless the owner explicitly reopens that product decision; any
  future Stripe work remains test-only until a separate launch decision.
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

Browser automation is Playwright: `frontend/e2e/preview-critical.spec.mjs` via `npm run test:e2e:preview` (secret-free preview mode, runs in `ci.yml`) and `frontend/e2e/live-auth.spec.mjs` via `npm run test:e2e:live` (real hosted auth, needs `CVF_E2E_*`). The `agent-browser` CLI is not installed; the repo still tracks only its discovery stub (`.agents/skills/agent-browser/SKILL.md`, symlinked from `.claude/skills/`), so do not depend on it.

## Deploy architecture — read before adding cross-cutting code

Frontend and backend deploy as **two separate Vercel projects**, each rooted at its own directory (`frontend/` and `backend/`). Neither project's build can see files outside its own root.

**Never `require`/`import` across the `frontend/` ↔ `backend/` boundary, and never reference a repo-root-level shared folder.** A prior bug (Training Builder import/export v1) reached outside `backend/` for both a shared validation module and a logo asset; it passed every local build/smoke-test and would have 500'd in production, because local checkouts have the full monorepo on disk and an isolated Vercel deploy does not. If logic or an asset is needed in both projects, duplicate it into both trees (see Known duplication below) — don't share a path across the deploy boundary.

## Brand system

- **Fonts:** Oswald (display, weights 500/600/700), Inter (body).
- **Themes (Sky Field, owner 2026-10-01):** a sunrise light theme (`:root` tokens) and a sunset dark theme (`.dark` tokens) in `frontend/src/index.css`. The theme follows the device, with a remembered override in the account menu (`src/lib/theme.js`; `index.html` applies it before first paint). Neutral surfaces stay warm in both themes (hue 0–50, or white), guarded by `backend/test/design-tokens.test.js`.
- **Color tokens:** accents are the logo's own colours, teal `#5CC9E0` (`--primary` in the sunset theme) and gold `#FECD2A` (`--gold`). On the light ground those fail as text, so the sunrise theme uses a teal ink for `--primary` and `--gold-ink` / `--success-ink` / `--achievement-ink` for text (wired as `textColor` in `tailwind.config.js`; fills and borders keep the bright values). `--destructive` stays for alerts and destructive actions. Materials come from tokens too: `--action-*` (the default button, lit from above), `--card-*` (the single `[class*="bg-card"]` rule), and `--glass*` (the `.glass-surface` utility for floating controls). Never hardcode hex in components — semantic rules are documented in the CSS itself.
- **Scenery:** `SkyScene` (`src/components/SkyScene.jsx`, styles under `.sky-scene` in index.css) draws the dashboard and sign-in sky: the real Sandia skyline from Uptown Albuquerque in three haze layers (`src/lib/sandiaSkyline.js`, computed from terrain tiles), sunrise or sunset sky, real full moon, stars, clouds, rare critters, parallax, film grain; all motion stops under reduced motion. `SkyHero`/`SkySheet`/`AuthSky` (`src/components/SkyHero.jsx`) place it. `BrandBackdrop` now only backs the personal-record moment on Progress.
- **Navigation:** phones use one corner menu button (`src/components/layout/CornerMenu.jsx`, tap or press-and-slide); desktop uses a top bar with wide glass tabs (`AppShell.jsx`). The top bar is clear over the sky and turns to glass on scroll; it publishes its height as `--shell-top`.
- **Assets:** logo at `frontend/public/logo.png` (fallback: CVF lettermark if the image 404s). The old ridge SVG `frontend/public/backgrounds/sandia-wide-hero-bg.svg` and the optional photo slots in `frontend/src/assets/photos/README.md` belong to `BrandBackdrop`. Two unused CTA-background SVGs (`sandia-free-agent-cta-bg.svg`, `sandia-team-interest-cta-bg.svg`) also live in that folder, carried over from Leagues — not wired to any PT screen.
- **PDF export** (`backend/src/lib/programPdf.js` — the coach `generateProgramPdf` and the client `generateLogSheetPdf`) cannot read CSS variables — its teal/gold are hardcoded hex literals kept in sync with the sunset `--primary` and `--gold` tokens (the token test pins them). If you change those tokens, update the hex constants at the top of that file too.

## Known duplication

- Program Draft logic is intentionally duplicated as browser ESM at `frontend/src/lib/programDraft.js` and backend CommonJS at `backend/src/lib/programDraft.cjs` — see Deploy architecture above. Changes to the paste/CSV/PDF Program Draft schema must be applied to both copies.
- The real CVF logo is duplicated at `frontend/public/logo.png` (served to the browser) and `backend/src/assets/cvf-logo.png` (used by PDF export) for the same reason.

## Preview mode

`previewMode.js` is a DEV-only mock layer, double-gated. Owner decision (2026-09-30): keep it, and use it as the place to try new features on sample data. When a feature adds or changes an API response, extend the preview fixtures and handlers to mirror it (same fields, same validation and limits) so the feature can be seen and e2e-tested without a hosted database. It stays DEV-only: never real client data, never reachable in production.

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
- Hosted development schema: **34 migrations on `main`** (as of `c8adc6d`, latest `20260811090000_push_subscriptions.sql`). The last hosted ledger record in the repo is 2026-07-22 (16/16 through `20260720173000_exercise_performance_history.sql`, `docs/hardening/2026-07-22-pr5-hosted-release.md`); every later migration was applied per-PR under the `migration-applied` label (`migration-guard.yml`), and the repo holds no consolidated ledger after that date — run `supabase migration list --linked` before assuming hosted state. The applied history includes the Stripe/credit and dormant payment-era migrations already on `main`; do not edit, remove, reorder, or roll back those applied migrations. Any correction requires explicit owner approval and a new forward-only migration. See `docs/hardening/2026-07-22-pr5-hosted-release.md`.
- Coach feedback v3 (2026-07-22): **implemented, hosted, and verified** as separate soft-state records with one response per authorized coach/admin author per completed workout, immutable author-name snapshots, client unread/read state, assignment-aware server authorization, deterministic preview fixtures, and client Programs badges/history markers. Hosted schema/grant checks and rollback-only create/update probes passed; existing completion notifications, completed-workout snapshots, and credit-independent behavior remain unchanged.
- Client exercise history (2026-07-22): **implemented, hosted, and verified** for the active workout tracker with optional performed reps/RPE, snapshotted library identity (and complete hosted legacy backfill), exact-source custom matching, completed-set-only cursor pagination, network-only inline retry states, and preview coverage. Hosted schema/grant checks and a rollback-only completed-history probe passed. Prescribed reps/RPE remain instructions and are never substituted for performed history.
- Stripe/credit system (owner + partners decision, 2026-07-18): active credit/package runtime surfaces are **retired**. Clients continue paying outside the app, with coaches assigning access after payment is handled separately. Session completion never reads, grants, or deducts credits and always records `credit_deducted = false`; workout completion was already credit-independent. Package/payment navigation and UI are absent, `/client/packages` redirects to `/client`, and `/api/packages` plus `/api/payments` are unmounted. Historical balances, transactions, purchases, session flags, dormant source files, and applied schema remain preserved for reversibility. Do not resume or extend this system, including PR #3 (`codex/stripe-payments-and-credits`), without an explicit decision to revisit it. Programs and Resources have never depended on credits or payment status.
- Dormant payment-code reconciliation note (2026-07-18): `main` retains the mixed historical payment source/schema state for reversibility. The workout backend commit accidentally carried over `stripe_subscriptions_offline_payments_and_credit_reviews`, `snapshot_subscription_entitlements`, `audited_payment_review_adjustments`, `archive_resource_with_assignment_choice`, and `honor_import_exercise_choices`; their SQL content matches PR #3 after blank-line normalization. `main` also retains `backend/src/routes/payments.js`, `backend/src/routes/packages.js`, the Stripe npm dependency, and `frontend/src/pages/client/Packages.jsx`; none are mounted or reachable in the active application. `backend/src/services/stripeCatalog.js` remains absent. Do not reconcile, remove, or clean up this dormant code, data, or schema without an explicit decision; removal requires dependency review, backup, and a new forward-only migration rather than ad hoc deletion.
- Vercel isolation: **verified** — `cvfpt-frontend` is rooted at `frontend/` with Vite and `cvfpt-backend` is rooted at `backend/` with Express. Preview and Production variables are configured for their respective aliases. The 2026-07-18 controlled backend-first/frontend-second release passed health, CORS, auth, retired-route, and real-auth checks. On 2026-07-22, merging PR #5 auto-deployed both Production projects at merge commit `2786aa3` before the authorized hosted-migration step could begin; backend became ready before frontend, then the two pending migrations were applied and independently verified. Post-convergence health, CORS, unauthenticated feature boundaries, retired-route `404`s, public login rendering, and one-hour backend error/5xx scans passed. This sequencing exception and its prevention rule are recorded in `docs/hardening/2026-07-22-pr5-hosted-release.md` and `.agentic/PROJECT_POLICY.md`.
- Supabase credential migration: **verified with owner-managed rotation** — Preview and Production intentionally share the same hosted Supabase project and surviving current-format server secret until a real launch domain triggers a separate Production project. Both legacy JWT-based keys remain disabled, the superseded current-format secret was manually deleted by the owner, and safe service reads pass in both environments. Key creation, copying, rotation, and retirement are manual owner-only dashboard actions; agents must stop and ask rather than handle a key.
- Real-auth coach/client verification: **complete for the previously accepted scope** in `docs/hardening/phase-3-4-flow-verification.md`. Historical evidence remains 88/88 for the expanded API matrix and 7/7 for the Production real-auth browser suite. The PR #5 release passes current backend regressions 94/94 and preview browser regressions 16/16, plus the public/auth/schema checks in `docs/hardening/2026-07-22-pr5-hosted-release.md`; the dedicated real-auth suite was **not rerun for that release** because its `CVF_E2E_*` credentials were unavailable. Do not describe the historical 7/7 result as a PR #5 release run. On 2026-07-11 the owner explicitly deferred successful waiver signing/paper-sign verification until business-approved legal text exists; no legal content was invented or changed. AI-assisted PDF parsing is also explicitly deferred; My PT Hub migration remains outside this goal.
- Session and booking API validation (2026-07-21): **hardened and locally verified** at the mounted handler boundary for malformed identifiers, timestamps, statuses, optional text, note content, and boolean sharing fields; rejected input performs no service-role mutation and existing ownership masking remains intact.
- API load failures: **fixed** — top-level coach/client/admin pages and async client-detail tabs retain their skeletons while loading, then expose an accessible retry state instead of an endless skeleton or blank page; live fault-injection/retry coverage passes for both roles.
- Focused set entry (round-2 design decision, 2026-09-29): **implemented, opt-in** — `?entry=focused` on the tracker URL turns it on for that device (`?entry=list` turns it off); clients stay on the set table by default until phone validation. It reuses the table's save/log/rest/finish handlers, so stored data is identical; blank reps/RPE stay "Not recorded" and RPE keeps 1–10 in half steps. Starting a workout (and "Add set") still pre-fills each set's weight with the prescribed load; the owner chose to keep that on 2026-09-30.
- Round-2 structure, client home and coach dashboard (2026-09-30): **implemented in the current look**. Client home puts today's plan before the reminders and tells apart done today, in progress (with set progress), planned rest (dated week with nothing today), no program yet, and plan not loaded ("not a rest day"); the week strip has a legend. The coach dashboard replaces the four count tiles with one summary line, shows today's sessions as a compact agenda (past faded, a Now line, "In the gym now"/"Workout done" chips with one-tap Complete, from `GET /sessions`), and puts "Needs you" beside it on desktop. Clients by goal is built on coach-picked goal measures (below).
- Sky Field visual direction (owner 2026-10-01, chosen from round-1 C and refined through a live prototype): **implemented on this branch**. Sunrise/sunset themes following the device with an override, logo-colour tokens with light-theme ink tokens, lit buttons, soft-depth cards and glass floating controls, the real-skyline `SkyScene` on the client home, coach dashboard and sign-in screens with a time-of-day greeting (Albuquerque time), a phone corner menu (tap or press-and-slide) and a desktop top bar. Fonts are unchanged on purpose: the owner wants one app-wide font pass later. Not yet restyled: the workout tracker header and the remaining inner pages beyond their token-driven light/dark support. Review fixes (2026-10-01): Home never offers a new workout when assignments, history or the active workout failed to load (a loaded active workout still offers Resume); the desktop top bar fits every role from 1024 px; the closed corner menu is inert and hidden from assistive tech, and the open one is modal (focus in, page behind inert, Escape/outside close, focus back to the button, including when the current page is chosen); an empty day reads "No workout scheduled today" until an explicit planned-rest record exists; JS sky motion follows a live reduced-motion change; tokens and PDF use the exact logo hex. Still owed before merge: a real-phone VoiceOver check of the corner menu (the navigation affects everyone). Focused entry stays opt-in, so its phone validation can wait while ordinary clients don't get it; whether clients read the check icon as "I did it" is optional research (a visible label is the alternative). Who does each release step is in `docs/hardening/2026-10-01-goal-measures-migration.md`. Preview mode has a home-state switch (all six states), a busy coach day and a strength/run goal client (Ana).
- Goal measures (round-2 decision, 2026-09-30): **implemented on this branch, migration not yet applied to hosted**. New forward-only migration `20260930150000_metric_goal_measures.sql` adds `metrics.is_goal_measure` (default false, no backfill). Coaches turn it on per metric in the client's Progress tab (max three per client, enforced by the API and mirrored in the dialog); the client home shows a "Your goal" card (goal text plus each measure's latest value, change since the first entry, and target) and the coach dashboard shows "Clients by goal" under the agenda. Dashboards load measures best-effort, so a missing column yields no measures rather than a failed dashboard; creating a metric only sends the flag when it is on. Apply the migration to hosted before merging (`migration-applied` label); the exact pending set, compatibility notes and verification SQL are in `docs/hardening/2026-10-01-goal-measures-migration.md`. Hosted save/read is verified with the real-auth test "hosted goal measures…" (`npm run test:e2e:live -- -g "hosted goal measures"`) against this branch's backend Preview: auth, coach-only role, ownership, the three-measure limit, both dashboards (API and UI) and cleanup. A Vercel frontend Preview always runs on sample data, so saving there verifies nothing. Metric edits only send the flag when it changes, so edits keep working before the column exists.
- Session↔workout linkage and session detail surfaces (2026-08-11): **implemented** — workout starts (tracked and quick-complete) auto-link to the client's same-Denver-day scheduled session (plan match first, then closest start; explicit coach session context wins; best-effort, never blocks a start). The coach Sessions list surfaces live "In the gym now"/"Workout done" chips with a surfaced one-tap completion approval, rows open a new coach session detail page (`/coach/sessions/:id`: actions, notes, plan, linked workout activity), cancel-request notifications deep-link to that session, and no-show sessions remain visible under Past. Completing a future Denver-day session is refused server-side, client past-session rows link to the detail page, and ask-to-cancel state persists via a server-derived `cancel_requested` flag. No schema change — the existing `workout_logs.session_id` column and start RPC carry the link.
