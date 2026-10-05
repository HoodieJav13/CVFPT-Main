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

Design QA tooling (2026-08-11): `docs/design-qa-surface-audit.md` is the
per-surface pre-launch checklist; `docs/design-reference-links.md` is the
vetted external reference list (including tools evaluated and rejected — do
not re-propose those without new information). The Agentation annotate
overlay mounts in dev/preview builds only (never production, never under
test automation). The project-scoped `impeccable` Claude Code plugin is
**audit-only**: its findings are proposals; this file's brand tokens and
`docs/design-principles.md` always take precedence, and any restyle it
suggests still goes through the visual gate.

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
- **Two hosted databases.** Development (`hhzpzcxcurmhpmfgriqb`, the linked CLI
  project, backend Preview) and `cvfpt-production` (`dacqdoohqqcqgtpacerk`,
  backend Production, real users). A migration PR must be applied to **both**
  before merge — labels `migration-applied` and `prod-migration-applied` — because
  merging deploys Production immediately. Never run seeds or test-account
  scripts against production. See DEPLOYMENT.md → Migration guard.

## Browser Automation

Browser automation is Playwright: `frontend/e2e/preview-critical.spec.mjs` via `npm run test:e2e:preview` (secret-free preview mode, runs in `ci.yml`) and `frontend/e2e/live-auth.spec.mjs` via `npm run test:e2e:live` (real hosted auth, needs `CVF_E2E_*`). The `agent-browser` CLI is not installed; the repo still tracks only its discovery stub (`.agents/skills/agent-browser/SKILL.md`, symlinked from `.claude/skills/`), so do not depend on it.

## Deploy architecture — read before adding cross-cutting code

Frontend and backend deploy as **two separate Vercel projects**, each rooted at its own directory (`frontend/` and `backend/`). Neither project's build can see files outside its own root.

**Never `require`/`import` across the `frontend/` ↔ `backend/` boundary, and never reference a repo-root-level shared folder.** A prior bug (Training Builder import/export v1) reached outside `backend/` for both a shared validation module and a logo asset; it passed every local build/smoke-test and would have 500'd in production, because local checkouts have the full monorepo on disk and an isolated Vercel deploy does not. If logic or an asset is needed in both projects, duplicate it into both trees (see Known duplication below) — don't share a path across the deploy boundary.

## Brand system

- **Fonts:** Oswald (display, weights 500/600/700), Inter (body).
- **Color tokens** (`frontend/src/index.css`): `--primary` (teal, brand/action), `--gold` (Zia gold, synced from the CVF Leagues repo — achievement/pending accents only), `--success` (tokenized, not raw `emerald-*`), `--destructive` (alerts/destructive only). Never hardcode hex in components — semantic rules are documented in the CSS itself.
- **Surfaces are warm graphite** (owner decision 2026-08-13, "desert night", matched to the Leagues app): every neutral surface token lives at hue 25–45 with saturation ≤ 20% — arithmetically incapable of reading navy or green — and `backend/test/design-tokens.test.js` fails the suite if the ramp drifts. Cards get their gradient/depth/teal-edge from the single `[class*="bg-card"]` rule at the bottom of index.css, not per-callsite classes. Teal survives as accents and the Sandia ridge — the one deliberate cool identity element. To mint a new dark shade: keep the hue in band, keep saturation low, move only lightness.
- **Assets:** logo at `frontend/public/logo.png` (fallback: CVF lettermark if the image 404s), Sandia ridge background at `frontend/public/backgrounds/sandia-wide-hero-bg.svg`. The shared `BrandBackdrop` owns all ridge usage and the optional build-time photo slots documented in `frontend/src/assets/photos/README.md`; the approved active target is the no-photo fallback until consented photography exists. Two unused CTA-background SVGs (`sandia-free-agent-cta-bg.svg`, `sandia-team-interest-cta-bg.svg`) also live in that folder, carried over from Leagues — not currently wired to any PT screen.
- **PDF export** (`backend/src/lib/programPdf.js` — the coach `generateProgramPdf` and the client `generateLogSheetPdf`) cannot read CSS variables — its teal/gold are hardcoded hex literals kept manually in sync with the tokens above. If you change `--primary` or `--gold`, update the matching hex constants at the top of that file too.
- **Notification emails** use backend-local literal colors in `backend/src/lib/emailBrand.js`, checked against the app tokens by `backend/test/email-appearance.test.js`. The shared wrapper uses the original public `/logo.png` at the action link's app origin, without copying invite/reset query data. The owner accepted the compact/stronger comparison on 2026-10-02; the selected stronger direction uses an 88px logo, live wordmark and teal masthead. Browser light/dark checks do not establish actual mail-client rendering or delivery.

## Known duplication

- Workout metric validation/formatting is duplicated as browser ESM at `frontend/src/lib/workoutMetrics.js` and backend CommonJS at `backend/src/lib/workoutMetrics.js`. Keep tracking types, units, and validation in sync; `backend/test/workout-metrics.test.js` checks parity. Never import across deploy roots.
- Program Draft logic is intentionally duplicated as browser ESM at `frontend/src/lib/programDraft.js` and backend CommonJS at `backend/src/lib/programDraft.cjs` — see Deploy architecture above. Changes to the paste/CSV/PDF Program Draft schema must be applied to both copies.
- Superset/giant-set grouping helpers (`supersetBlocks`, `exerciseMarkers`, label generation) are duplicated at `frontend/src/lib/supersets.js` (display + builder edits) and `backend/src/lib/supersets.js` (save normalization + PDF markers). `backend/test/supersets.test.js` asserts the two produce identical markers.
- The recurring-session rule, Denver wall-clock conversion, and suggestion times are ported for preview mode at `frontend/src/lib/previewSeries.js` from `backend/src/lib/sessionSeries/rule.js`, `backend/src/lib/sessionSeries/alternatives.js`, and `backend/src/utils/time.js`. `frontend/tests/unit/previewSeries.test.mjs` holds the backend's test vectors; a backend rule change must update the port and those vectors together.
- The real CVF logo is duplicated at `frontend/public/logo.png` (served to the browser) and `backend/src/assets/cvf-logo.png` (used by PDF export) for the same reason.

## Preview mode

**Kept (owner decision 2026-10-01).** `frontend/src/lib/previewMode.js` is the
fixture-backed mock API behind the preview toolbar. Its jobs are owner review
of unreleased features and UI on Vercel preview links, design QA, and the
`npm run test:e2e:preview` regression suite.

- **Gate:** on only for local opt-in (`npm run dev:preview`) and Vercel preview
  deployments (owner decision 2026-07-31). Vercel Production builds force-define
  it off in `frontend/vite.config.js`; other builds stay off unless both preview
  flags are set. Never weaken that gate.
- **User-facing features must be reviewable in preview.** Changes ship with the
  preview responses and fixtures needed to exercise their UI in the same PR.
  Backend-only changes need none unless they change API behavior visible to the
  UI. Deliberately unsupported flows show an explicit "Not available in preview"
  state and are listed, with a reason, in `PREVIEW_UNSUPPORTED` in the mock.
  Any unexpected missing mock exercised by the preview browser suite must fail
  that suite.
- New preview browser specs import `test` from `frontend/e2e/preview-test.mjs`,
  not `@playwright/test`; that shared fixture enforces the missing-mock,
  unlisted-save, and data-changing-read checks.
- **Preview verifies UI behavior.** It does not prove real authorization,
  server validation, database behavior, or delivery of emails and push
  notifications. Use backend/database tests and relevant integration checks
  as evidence for those.
- **Fixtures:** fake data only, dated relative to load time, held in memory
  and reset on reload. Sarah is the stable baseline — keep her existing
  fixtures; additional edge cases go on separate scenario data.
- **Controls:** failure and slow-loading switches live in the preview toolbar
  and are accessible on a phone, with `cvf_preview_`-prefixed storage keys.
- Fixture ids are used by the preview browser suite — rerun it after changing
  them.

## Conventions

- Functional and visual changes go in **separate commits**; keep commits small and scoped.
- Design tokens only — no hardcoded hex colors in components (PDF export and email-client-compatible HTML use backend-local literals with parity checks — see Brand system above).
- Cross-project code/assets get duplicated, never shared via a path that crosses the frontend/backend deploy boundary.

## Status (updated as of this session)

- Coach aggregate analytics activation candidate (2026-10-05): owner approved limited ongoing usage/scrubbed errors, no paid upgrade/replay. Candidate adds explicit Vercel Production opt-in, exact coach-role/route gates and a memory-only random visit UUID; fixture/demo gates remain intact. Production remains off pending release configuration and received schema2/privacy proof. No provider events are sent during fictional-only candidate tests; no dependency/migration is added. See `docs/analytics/coach-production-activation.md`. The first-slice status below records the original fictional proof.

- Visible UI changes now require actual paired before/after evidence in change documentation per the owner's 2026-10-05 request. See `docs/design-principles.md` and `docs/workout-ux-visual-review/index.html`. The owner approved the revised workout comparison on2026-10-06; PR publication, merge and exact Production verification are now authorized. The original paired capture checkpoint is retained.

- Workout layout/accessibility follow-up (2026-10-05): **visually approved; release verification in progress** on released main `cda1bea`. Phone decimal loads, narrow builder containment, durable labels and44px targets remain. Owner feedback now restores pinned timer/Finish via separate reserved entry/control rows; entries scroll above the controls. Very short /panned keyboard viewports use document scrolling with focus clearance. Validation uses calm neutral status/icon guidance; PDF/Start keep44px height with their original compact widths/title wrapping. Typed/offline contracts, shell/navigation and backend source are unchanged. The separately owner-approved release repair updates only the backend lockfile proxy-addr entry from2.0.7 to2.0.8; no broader dependency update is included. The owner cleared the visual hold on2026-10-06 and explicitly authorized PR/CI/merge/Production verification. No schema/data change or PostHog activation is included. Actual numbered before/after evidence retains refreshed #6/#7/timer views. See `docs/workout-ux-followup-2026-10-05.md`; optimistic offline detail rendering remains separate.

- PostHog coach usage/error first slice (2026-10-05): **completed fictional proof, production collection off**. Fixture-only coarse navigation/session/workout outcomes and scrubbed errors tested; nine fictional events received and one scrubbed issue verified in Default project509463. Owner-approved IP discard enabled/verified. Corrected offline recorder passed full decoded packet/privacy and four-route playback checks; one fictional recording (two packets, 388119 bytes, 2495ms activity) acknowledged once and indexed; hosted visual playback and usage checks passed at approximately 18:27 UTC: all four routes masked, no canaries; displayed usage 8 analytics / 1 replay / 1 error within free allocations. Production collection remains hard-disabled; no app recorder or real-user collection is enabled. See `docs/analytics/proof-checkpoint-2026-10-05.md`.

- Duration/distance workout logging (2026-10-05): **implemented; both hosted schemas verified**. Coaches explicitly configure reps/weight, duration, distance, or duration + distance per workout exercise. Targets and modes snapshot at start; actual duration/distance stay blank until entered, retain s/min or m/km/mi/yd, and survive offline/reload/retry, copies, import, history, and PDF flows. Legacy logs retain reps/weight. See `docs/workout-metrics/design.md` and `docs/workout-metrics/validation.md`; owner-approved additive migration `20261005165134` is applied and independently verified in development and Production (41/41, no pending migration); PR #107 merged as `cda1bea` after all required checks and both migration labels; both Production projects were verified READY at that exact merge. See `docs/workout-metrics/hosted-release-2026-10-05.md`.
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
- Production split (2026-09-29): **done** — the launch domain `app.corevaluefit.com` is live, and backend Production now runs on its own Supabase project `cvfpt-production` (all migrations applied, first admin created) while Preview stays on the development project. The owner approved moving the new project's keys into Vercel with a script run in the owner's own terminal; the standing owner-only key rule below is unchanged. Transactional email (Resend) is being connected for production.
- Supabase credential migration (development project, historical): **verified with owner-managed rotation** — Preview and Production shared the development project and its surviving current-format server secret until the 2026-09-29 production split. Both legacy JWT-based keys remain disabled, the superseded current-format secret was manually deleted by the owner, and safe service reads pass in both environments. Key creation, copying, rotation, and retirement are manual owner-only dashboard actions; agents must stop and ask rather than handle a key.
- Real-auth coach/client verification: **complete for the previously accepted scope** in `docs/hardening/phase-3-4-flow-verification.md`. Historical evidence remains 88/88 for the expanded API matrix and 7/7 for the Production real-auth browser suite. The PR #5 release passes current backend regressions 94/94 and preview browser regressions 16/16, plus the public/auth/schema checks in `docs/hardening/2026-07-22-pr5-hosted-release.md`; the dedicated real-auth suite was **not rerun for that release** because its `CVF_E2E_*` credentials were unavailable. Do not describe the historical 7/7 result as a PR #5 release run. On 2026-07-11 the owner explicitly deferred successful waiver signing/paper-sign verification until business-approved legal text exists; no legal content was invented or changed. AI-assisted PDF parsing is also explicitly deferred; My PT Hub migration remains outside this goal.
- Session and booking API validation (2026-07-21): **hardened and locally verified** at the mounted handler boundary for malformed identifiers, timestamps, statuses, optional text, note content, and boolean sharing fields; rejected input performs no service-role mutation and existing ownership masking remains intact.
- API load failures: **fixed** — top-level coach/client/admin pages and async client-detail tabs retain their skeletons while loading, then expose an accessible retry state instead of an endless skeleton or blank page; live fault-injection/retry coverage passes for both roles.
- Session↔workout linkage and session detail surfaces (2026-08-11): **implemented** — workout starts (tracked and quick-complete) auto-link to the client's same-Denver-day scheduled session (plan match first, then closest start; explicit coach session context wins; best-effort, never blocks a start). The coach Sessions list surfaces live "In the gym now"/"Workout done" chips with a surfaced one-tap completion approval, rows open a new coach session detail page (`/coach/sessions/:id`: actions, notes, plan, linked workout activity), cancel-request notifications deep-link to that session, and no-show sessions remain visible under Past. Completing a future Denver-day session is refused server-side, client past-session rows link to the detail page, and ask-to-cancel state persists via a server-derived `cancel_requested` flag. No schema change — the existing `workout_logs.session_id` column and start RPC carry the link.
- Recurring sessions (2026-09-30): **implemented, locally and hosted verified**. Coaches create a weekly batch of ordinary sessions (`session_series` + `sessions.series_id`) from the session editor's Repeat mode with a conflict-fixing preview, optional program-day workout mapping, all-or-nothing retry-safe saving (idempotent `request_id`, immutable receipt, pending save and editor snapshot persisted across reloads, Create held until a referenced program's details load), one summary notification, and "this and all future" cancellation. Verified locally on 2026-10-01: backend 441/441, frontend unit 29/29, production build, preview browser suite 29 passed / 8 skipped / 0 failed, the new mocked-API series browser suite 19/19, Docker-free stack/isolation guard tests (18 + 11), and the database suite on a disposable local Supabase stack (Postgres 17: SQL behavior, grants/RLS, and both committed-transaction concurrency races, with isolation and teardown confirmed). The earlier-seen preview failure ("session conflicts surface inline…") was an ambiguous day-number selector that booked the previous month's leading day on month-end dates; it now selects the calendar day by full date and runs under fixed month-boundary clocks. Four additive migrations (`20260930100000`–`20260930130000`, including a behavior-preserving refactor of `schedule_session` onto the shared `find_session_conflict` helper) were applied and independently verified in both development (`hhzpzcxcurmhpmfgriqb`) and Production (`dacqdoohqqcqgtpacerk`) on 2026-10-01; both ledgers are 39/39 and dry runs show no pending migration. Create/replay/conflict probes rolled back with zero probe rows remaining. The branch was reconciled with current `main`: shared templates from any coach are usable, optional program assignment clones a private client program and skips existing legacy or cloned assignments, and hidden templates cannot be assigned. The release requires both development and Production migration verification and both migration labels. All four code/database CI jobs passed on reconciled head `a647c29` (PR #90); the release documentation commit also runs the full CI before merge. Production deployments follow `main`. Hosted evidence: `docs/hardening/2026-10-01-recurring-sessions-hosted-release.md`. Spec: `docs/superpowers/specs/2026-09-30-recurring-sessions-design.md`. Preview support (2026-10-01): the four series routes, series badges on coach session reads, and one seeded series are mocked in `previewMode.js`; cross-reload recovery, replay, and `request_mismatch` remain covered only by the mocked-API series suite. Spec: `docs/superpowers/specs/2026-10-01-preview-mode-post-launch-design.md`.
