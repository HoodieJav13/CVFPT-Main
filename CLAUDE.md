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

## Preview mode

`previewMode.js` is a DEV-only mock layer, double-gated, pending a keep/kill decision. Do not extend it without being asked.

## Conventions

- Functional and visual changes go in **separate commits**; keep commits small and scoped.
- Design tokens only — no hardcoded hex colors in components.
