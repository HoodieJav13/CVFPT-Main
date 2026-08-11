# 012 — Web push (Phase E of the 011 signal work, owner-approved 2026-08-11)

Purpose: the signals shipped in 011 (started/completed workouts, cancel
requests, announcements, session changes, booking lifecycle) currently reach
people only in-app or via the conditional digest. Web push carries them to
lock screens — no App Store, no native shell.

Decisions and constraints:

- **Inert without configuration**, matching the Sentry/Resend pattern: three
  env vars (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`) that
  the owner generates (`npx web-push generate-vapid-keys`) — an owner
  check-in step, not agent-handled secrets.
- **Permission only ever via a deliberate tap** in the notification-settings
  dialog — never on page load. iOS receives web push **only as an
  installed-to-home-screen PWA** (the install nudge already exists); the UI
  states this honestly instead of failing silently.
- **Subscriptions are device artifacts** keyed by `auth_user_id` (only
  logged-in people can subscribe), unique per endpoint, soft-archived —
  including automatically when a push provider answers 404/410 (expired).
- **Send points mirror the existing signal moments** (same routes that write
  in-app notifications or send emails): coach ← workout started/completed,
  cancel requested, new booking request; client ← announcement posted,
  session scheduled/rescheduled/cancelled, booking approved/declined.
  Payloads carry title/body/url only — no message content beyond what the
  matching email already exposes, and chat content stays out entirely (same
  privacy rule as the digest).
- Delivery is best-effort fire-and-forget (`waitUntil` on Vercel, failures
  logged and swallowed) — a push failure can never fail a domain write.
