# CVF PT - Product Requirements Document

## Product
Personal training management web app for Core Value Fitness (Albuquerque, NM).
Tagline: "Fitness Done Right". Dark theme, teal/cyan (#5BC2D4) brand, mobile-first.

## Tech stack (user-mandated, non-negotiable)
- Frontend: React 19 + Vite 6 + Tailwind CSS 3 + shadcn/ui (dark theme only)
- Backend: Node.js 20 + Express 4, all routes under /api
- Database/Auth: Supabase (project kzmsgwkmewbjnhmioduj) - Supabase Auth, service-role data access from server, RLS enabled (no policies; service role bypasses)
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
migration.sql at /app/backend/migration.sql (user already ran in Supabase SQL editor).
Tables: coaches, clients, sessions, session_notes, metrics, metric_entries, programs, program_exercises, program_assignments, messages, booking_requests, waiver_versions (append-only), waiver_signatures (append-only), packages, purchases, client_credits. All soft-delete via archived except append-only tables.

## Explicit exclusions
No public/coach signup, no emails/push, no nutrition/habits, no native app, no Stripe live/invoicing/refunds, no social beyond coach-client messaging.

## Status
- Phase 1 POC: PASSED 24/24 (auth, invite->claim, ownership enforcement at API level)
- Phase 2: full app built (backend + frontend), seeded; E2E testing in progress
