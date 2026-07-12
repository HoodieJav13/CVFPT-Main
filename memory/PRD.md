# CVF PT - Product Requirements Document (historical baseline)

> This captures the original product brief and is not an operational deployment
> guide or current verification report. Use `CLAUDE.md`, `DEPLOYMENT.md`, and
> `docs/hardening/` for the current architecture, project target, schema, and
> evidence.

## Product
Personal training management web app for Core Value Fitness (Albuquerque, NM).
Tagline: "Fitness Done Right". Dark theme, teal/cyan (#5BC2D4) brand, mobile-first.

## Tech stack (user-mandated, non-negotiable)
- Frontend: React 19 + Vite 6 + Tailwind CSS 3 + shadcn/ui (dark theme only)
- Backend: Node.js 20 + Express 4, all routes under /api
- Database/Auth: Supabase Auth with service-role data access from the server and RLS enabled without policies. The current development project is recorded in the hardening audit rather than duplicated here.
- Payments: Stripe TEST mode, env: STRIPE_SECRET_KEY / STRIPE_PUBLISHABLE_KEY / STRIPE_WEBHOOK_SECRET (currently EMPTY -> graceful "not configured" state)
- Deployment target: Vercel (handled by user). Local dev: supervisor runs uvicorn ASGI proxy (backend/server.py) that spawns Node on port 8002 and proxies 8001 -> Node. On Vercel the Node app runs directly.

## Identity model (critical)
- Client PROFILE (clients table) is separate from LOGIN (auth.users). clients.auth_user_id nullable.
- Coaches manage clients who never log in. Invite flow: coach toggles invited -> client signs up with matching email -> auth_user_id linked. Non-matching signup rejected (friendly message). NO emails sent by system.
- Coaches see only their own clients; admin sees all. Enforced server-side everywhere.

## Roles
- admin (Marcus Rivera), coach (Jordan Banks, Alex Trujillo), client (invited only). No public signup.

## Features
Coach: dashboard (today/requests/messages), clients CRUD+archive (soft delete), sessions (create/edit/cancel/complete; complete decrements 1 credit), session notes (+share flag), progress metrics + dated entries + charts, programs (exercises w/ sets/reps/notes/video_url) + assignment, threaded messaging, booking request approve/decline, record manual purchase, view payment history/credits, record paper waiver.
Client: home (next session, credits, waiver alert), sessions + booking requests, progress charts, assigned programs w/ video links, messaging, waiver signing (typed name, append-only signatures w/ ip), packages purchase (Stripe checkout when configured) + payment history.
Admin: everything + all-coach visibility, reassign clients, manage coaches, waiver versions (append-only), packages CRUD (soft archive).

## DB schema
The original schema grew beyond this baseline. Versioned migrations under
`supabase/migrations/` are authoritative; `backend/migration.sql` mirrors the
review baseline. See `docs/hardening/phase-2a-schema-audit.md` for the current
23-table inventory, transactional routines, grants, and parity signatures.

## Explicit exclusions
No public/coach signup, no emails/push, no nutrition/habits, no native app, no Stripe live/invoicing/refunds, no social beyond coach-client messaging.

## Status
The original Phase 1 POC passed. Current Phase 2–5 hardening status and verification
counts are maintained in `CLAUDE.md` and `docs/hardening/`.
