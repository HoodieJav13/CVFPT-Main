# Email notifications — design note (v3 item 7)

Status: **owner-reviewed 2026-08-01** — the four review corrections are
applied below and the four open decisions are resolved (recorded at the
end). The build is unblocked once the owner completes the provider setup
steps. One migration ⚠ (digest opt-out) ships with the build.

## Scope (per D2)

**Instant emails**
| Event | Recipient | Trigger point |
|-------|-----------|---------------|
| New booking request | Coach | `POST /api/bookings` when the outcome is `pending` |
| Session booked (auto-book) | Client **and** coach | `POST /api/bookings` when the outcome is `auto_booked` — the client gets a confirmation, the coach gets an FYI since no request ever appears in their queue |
| Request approved | Client | `PATCH /api/bookings/:id/approve` on success |
| Request declined | Client | `PATCH /api/bookings/:id/decline` |
| Session cancelled | Client | `PATCH /api/sessions/:id/cancel` |

D2 also lists "rescheduled". The app has no reschedule primitive today — a
change of time is a cancel plus a new booking — so a reschedule email would
be the cancel email followed by the new confirmation. If a true reschedule
flow is ever built, it gets its own template then. No extra work now.

**Daily digest** (one email per person, only when there is something to say)
| Content | Recipient |
|---------|-----------|
| Unread messages — **all** messages with `messages.read_by_recipient = false` at send time, with no `created_at` filter (the schema has no `read_at` column; unread is a boolean flag). Deliberately not windowed: a message that goes unread for three days should keep appearing until it is read, and this is what makes a skipped digest day self-healing | Clients and coaches |
| New assignments — programs / dated workouts created inside the window | Clients |
| Booking requests still `pending` more than 24 h after `created_at` | Coaches |

**Out of scope**: SMS, push (roadmap: follows email + PWA), marketing or
broadcast email of any kind, message *content* in emails (counts and deep
links only — inboxes are often shared, chat content stays in the app).

## Architecture

**Instant sends must outlive the response, safely.** Firing a promise
after `res.json()` and not awaiting it is unsafe on Vercel: the function
can be frozen before the send completes, which also loses the error log.
The send wrapper therefore hands the promise to `waitUntil()` (from
`@vercel/functions`), which keeps the invocation alive until it settles
without delaying the response. Where `waitUntil` is unavailable (local
dev, tests), the wrapper awaits the send before responding. Either way a
provider failure is logged via the existing `logError` and never fails the
API request — in-app state remains the source of truth. No queue, no new
table.

**The digest is a scheduled job, not a table.** A Vercel Cron entry on the
backend project invokes **`GET /api/internal/digest`** once daily. Vercel
Cron issues **GET** requests and authenticates with
`Authorization: Bearer ${CRON_SECRET}` (owner-set env var, same handling
rule as all keys); the endpoint rejects any request whose bearer token
doesn't match, and is registered before any `/:id`-style route. It computes
each person's digest from existing data, so the digest itself needs no
migration.

**Duplicate and missed-run posture (explicit trade-off).** The digest keeps
**no durable delivery checkpoints**, and the consequences are accepted
deliberately:

- *Duplicates are prevented at the provider.* Every send — instant and
  digest — carries a deterministic Resend **idempotency key**:
  `digest/{recipientId}/{YYYY-MM-DD}` for digests (date computed in
  America/Denver so a UTC-boundary double-fire still collides), and
  `{event}/{recordId}/{recipientId}` for instant emails (e.g.
  `booking-approved/{bookingId}/{clientId}`). The recipient segment is
  required, not decorative: an auto-booked session sends two different
  emails — a client confirmation and a coach FYI — off the same event and
  record, and reusing one key for two different payloads makes Resend
  reject the second send with a `409`. A double-fired cron, a retry, or a
  duplicate webhook re-sends the same key and Resend drops it.
- *The protection window is 24 hours.* Resend deduplicates a given key for
  24 hours from first use; after that the same key sends again. Both key
  shapes are built for that: digest keys carry the date, so the next day's
  digest is a new key anyway, and instant keys are tied to a single
  record-and-recipient event that never legitimately repeats. The window
  only matters for retries — a retry more than 24 h after the original
  send would duplicate, which is well outside any retry we would attempt.
- *Missed runs are not recovered.* The windowed part of the digest — new
  assignments — queries a fixed 24 hours; if a day's cron never fires,
  that day's digest is skipped with no catch-up. This is acceptable
  because everything time-critical (requests, approvals, cancellations)
  already went out as an instant
  email, and unread messages carry forward automatically because that
  count is not windowed — a message unread through a skipped day still
  appears the next day. Only "new assignments" from the missed day are
  genuinely lost, and those are visible in-app.
- If that ever proves insufficient, the upgrade path is a small
  `digest_sends` checkpoint table (recipient, digest date, sent_at) that
  lets the job backfill skipped days. Not planned now; noted so the choice
  is reversible.

**Preferences (owner decision: Option A).** Instant emails are
operational/transactional and launch always-on. The digest ships with an
off switch: one small migration ⚠ adding
`digest_opt_out boolean not null default false` to `clients` and
`coaches`, surfaced as a toggle in the app and honored via an opt-out link
in the digest footer. Applied by the owner before merge, one migration in
flight, exactly as always. This resolves the roadmap's "⚠?" on item 7 to ⚠.

## Provider (decided)

**Resend** — the free tier covers 3,000 emails/month and 100/day, an order
of magnitude above CVF's realistic volume; it supports the idempotency
keys the duplicate posture above depends on; setup is a domain
verification plus one API key; the Node SDK is a single dependency.
Alternatives considered: Postmark (excellent deliverability, $15/mo,
overkill at this volume) and Amazon SES (cheapest at scale, most setup
friction). Nothing in the integration is Resend-specific beyond one small
send wrapper, so switching later is cheap.

**Owner-only setup steps** (same rule as Supabase keys — I never handle
keys):
1. Create the Resend account and verify `corevaluefitness.com`, sending as
   `CVF PT <notifications@corevaluefitness.com>`.
2. Add `RESEND_API_KEY` and `CRON_SECRET` env vars to the Vercel backend
   project, plus the monitored studio inbox as `NOTIFY_REPLY_TO`.
3. Digest cron: **13:00 UTC** — 6:00 AM in Denver during winter, 7:00 AM
   during summer, so it never lands at 5 AM.

## Templates and copy

- Minimal branded HTML: dark-on-light for email-client compatibility, logo
  header, one clear line per fact, one button deep-linking into the app
  (e.g. `/client/sessions`). Plain-text alternative part included.
- Session times formatted in **America/Denver** with the day of week
  ("Thu Aug 6, 11:00 AM"), matching the in-app convention.
- Instant session emails carry date/time, duration, location, and the other
  party's first name. Digests carry counts and links, never message bodies.
- From-name "CVF PT"; `reply-to` is the monitored studio inbox so a reply
  reaches a human.

## Failure and abuse posture

- Provider errors are logged and the API request still succeeds; because
  the send rides `waitUntil`, the log lands before the function freezes.
  No retry queue in v1 — the idempotency keys make ad-hoc retries safe if
  one is ever added.
- The digest endpoint rejects any request without the matching bearer
  secret.
- Email addresses come from the existing auth/profile records only; there
  is no address entry surface in this feature.

## Owner decisions (resolved 2026-08-01)

1. Preferences: **Option A** — digest opt-out column migration ⚠ ships
   with the build.
2. Coach digest **includes** booking requests pending more than 24 h.
3. Sending domain `corevaluefitness.com`, from
   `notifications@corevaluefitness.com`; reply-to is the monitored studio
   inbox.
4. Digest cron at **13:00 UTC** (6 AM MST / 7 AM MDT).
