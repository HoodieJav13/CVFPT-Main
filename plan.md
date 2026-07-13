# CVF PT — Original Development Plan (archived)

> Historical record only. Counts, paths, credentials, and deployment instructions
> below describe the original build and must not be used operationally. Current
> status lives in `CLAUDE.md`; deployment guidance lives in `DEPLOYMENT.md`; and
> evidence lives in `docs/hardening/`.

## 1) Objectives
- Deliver a complete, mobile-first **dark-theme** personal training management web app (**CVF PT**) for Core Value Fitness.
- Ensure **invitation-only client signup** with the required identity model: **client profiles are separate from login accounts** and can exist without any client ever logging in.
- Enforce **server-side role + ownership authorization** on every endpoint (coach-only access to their own clients; admin sees all; clients only see their own data).
- Provide a **Stripe test-ready payments system** that **fails gracefully** when keys are not configured.
- Ship a **Vercel-ready** codebase (standard build scripts, env-var configuration, rewrites) with seeded demo data and validated end-to-end flows.

---

## 2) Implementation Steps

### Phase 1 — Core POC (Isolation) — ✅ COMPLETE
**Goal:** Prove auth + invite→claim + DB access + API-level ownership enforcement before building the full app.

**POC user stories (verified)**
1. As an invited client, I can sign up **only** if my email matches an invited, unclaimed client profile.
2. As a coach, I can create a client profile without the client ever logging in.
3. As a coach, I can toggle a client as invited so they can claim their profile later.
4. As the backend, I can verify Supabase access tokens and derive user role securely.
5. As a system, I can block access so a coach never reads another coach’s client (API-level).

**Completed steps**
1. **Retooled runtime (this environment)**
   - Backend: Node/Express runs behind an ASGI proxy shim (uvicorn still starts `backend/server.py` on **0.0.0.0:8001**, which spawns Node on **8002** and proxies requests).
   - Frontend: Vite runs on **0.0.0.0:3000** with `envPrefix: ['REACT_APP_']` and host allowed.
2. **Supabase integration approach**
   - Server uses **service role key** for data + auth admin operations.
   - Requests authenticated via `auth.getUser(token)`; role resolved by presence in `coaches` or `clients`.
3. **Schema creation path**
   - `migration.sql` generated and **user executed it in Supabase SQL editor**.
4. **Single POC script**
   - `backend/scripts/poc.js` executed against real Supabase project.
   - Results: **24/24 passed**, including:
     - service-role CRUD
     - coach auth user creation
     - invited signup validation + profile claim (link `clients.auth_user_id`)
     - rejection of non-invited signup with friendly message
     - API-level ownership enforcement (cross-coach read returns 404; client blocked 403)

**Exit criteria**
- Met and verified via the POC script.

---

### Phase 2 — V1 App Development (MVP) — ✅ COMPLETE
**Goal:** Build the full MVP on the proven core, fully matching the spec.

**V1 user stories (implemented)**
1. Coach dashboard: view today’s sessions, booking requests, and recent messages.
2. Coaches manage clients (add/edit/archive) without client accounts.
3. Invited clients can sign in to see next session, programs, progress, messages.
4. Clients can sign the latest waiver and view signature status.
5. Completing a session decrements credits automatically (when available).

**Completed steps**
1. **Final DB schema + seed**
   - Schema applied via `backend/migration.sql`.
   - Seed script: `backend/scripts/seed.js` (idempotent) seeds:
     - 3 coaches (1 admin)
     - ~6 clients
     - sessions (upcoming + completed)
     - progress metrics + entries
     - a program + exercises + assignment
     - messages
     - waiver v1
     - 2 packages
     - initial credits + a manual purchase record
     - a pending booking request
2. **Complete backend API (Express)**
   - Auth: login, invitation-only signup/claim, refresh, /me.
   - Clients: CRUD + invite toggle + soft archive.
   - Sessions: schedule/edit/cancel/complete; completion decrements credits; session notes with share flag.
   - Progress: metrics + dated entries; client read-only view.
   - Programs: CRUD, exercises, assignment/unassignment; client assigned view.
   - Messaging: threaded coach↔client messages; read/unread basics.
   - Booking requests: client requests; coach approve/decline; approve creates session.
   - Waivers: append-only versions/signatures; coach paper-sign support.
   - Packages/payments: package CRUD (admin), manual purchases (coach), Stripe checkout endpoints (graceful unconfigured), webhook + verify fallback.
   - Admin: coaches CRUD, reassign clients, overview.
   - Dashboards: coach + client.
   - All endpoints enforce **role + ownership server-side**.
3. **Complete frontend (React/Vite/Tailwind + shadcn/ui)**
   - Dark theme applied (teal #5BC2D4 accents; Space Grotesk/Figtree).
   - Mobile bottom tabs + desktop sidebar; coach FAB quick action.
   - Coach UI: dashboard, clients list/detail (tabs), sessions, programs, messages.
   - Client UI: home, sessions + booking requests, progress charts, programs, messages, waiver signing, packages/credits.
   - Admin UI: overview + coaches + waiver versions + packages.
   - `data-testid` coverage across key elements for automated testing.
4. **Stripe-ready, graceful failure state**
   - When Stripe keys are absent: payments UI renders; checkout endpoints return friendly “not configured” state.

---

### Phase 3 — Stabilization + Testing — ✅ COMPLETE
**Goal:** Validate end-to-end flows, confirm ownership enforcement, and ensure UX completeness.

**Completed steps**
1. **Testing Agent iteration 1**
   - Backend: **96.6% pass (56/58)**; the 2 “failures” were **test errors / expected ownership behavior**, not product bugs.
   - Coach-side frontend: **100%** for tested flows.
2. **Testing Agent iteration 2 (client portal focus)**
   - Client portal frontend: **100% (12/12)** including:
     - client home, sessions + booking flow
     - progress charts
     - programs with video links
     - messaging
     - waiver signing
     - packages page “payments not configured” state
     - role guard, logout, signup rejection, and mobile bottom tabs
3. **Outcome**
   - No critical bugs or ownership leaks reported.

---

### Phase 4 — Vercel Readiness + Final Hardening — ✅ COMPLETE
**Goal:** Ensure clean external deployment on Vercel with env-only configuration.

**Completed steps**
1. **Vercel backend readiness**
   - Added `backend/api/index.js` serverless entry.
   - Added `backend/vercel.json` rewrite to the function.
2. **Vercel frontend readiness**
   - Added `frontend/vercel.json` SPA fallback rewrite.
   - Verified `vite build` passes.
3. **Deployment documentation**
   - `/app/DEPLOYMENT.md` includes:
     - required env vars: `SUPABASE_*`, `REACT_APP_BACKEND_URL`, `FRONTEND_URL`, Stripe keys
     - optional Stripe webhook setup
4. **Project documentation**
   - `/app/memory/PRD.md`
   - `/app/memory/test_credentials.md`

---

## 3) Next Actions
All planned phases are complete. Optional next steps (future iterations):
1. **Enable Stripe** by providing test keys (`STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`) and setting `FRONTEND_URL` for success/cancel redirects.
2. If recurring packages are desired: implement Stripe **Subscriptions/Prices** (currently packages are treated as one-time payments; recurring flag is informational).
3. Enhance messaging (optional): richer read receipts, typing indicators (still within exclusions: no push notifications).

---

## 4) Success Criteria
- **Phase 1:** Invite→claim works reliably; non-invited signup rejected; token verification + role/ownership enforcement proven at the API level; required ports/hosts operational. ✅
- **Phase 2:** All MVP features accessible per role with clean mobile UX; seed data visible; Stripe checkout gracefully disabled when keys missing. ✅
- **Phase 3:** Testing reports no critical issues or ownership/auth leaks; workflows pass end-to-end. ✅
- **Phase 4:** Vercel deployment works via env vars only; build succeeds; documentation + seeded credentials provided. ✅
