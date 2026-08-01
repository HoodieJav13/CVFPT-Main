# Email notifications — design note (v3 item 7)

Status: **draft for owner review** — implements D2 (decided: email first).
This note is the "design note before build" the roadmap requires. Nothing
here is code yet; the build starts only after the owner signs off on the
recommendations and completes the provider setup.

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
| Unread messages count (since last digest, still unread at send time) | Clients and coaches |
| New assignments — programs / dated workouts added in the last day | Clients |

Recommendation to confirm: add **pending booking requests older than 24 h**
to the coach digest. It matches the digest's purpose (things waiting on
you), costs one query, and prevents requests from silently going stale.

**Out of scope**: SMS, push (roadmap: follows email + PWA), marketing or
broadcast email of any kind, message *content* in emails (counts and deep
links only — inboxes are often shared, chat content stays in the app).

## Architecture

**Instant sends are fire-and-forget from Express.** The route completes its
existing work first; the email is sent after the response logic succeeds,
wrapped so a provider failure is logged and never breaks a booking flow.
No queue, no new table. At CVF's volume (3 coaches, tens of clients) a lost
email during a rare provider outage is acceptable — the in-app state is
always the source of truth.

**The digest is a scheduled job, not a table.** A Vercel Cron entry on the
backend project hits `POST /api/internal/digest` once daily; the endpoint is
protected by a shared secret header (`CRON_SECRET`, owner-set env var, same
handling rule as all keys). It computes each person's digest from existing
data — `messages.read_at`, assignment `created_at` within the window — so
**no migration is needed for the core feature**.

**Preferences.** Instant emails are operational/transactional and launch
always-on. For the digest, people should be able to opt out; that is one
small migration ⚠ adding `digest_opt_out boolean not null default false` to
`clients` and `coaches`, surfaced as a toggle in the app (and honored via an
opt-out link in the digest footer). Options:

- **A (recommended):** include the tiny preferences migration in the build —
  it's two `alter table add column` lines, follows the one-migration-in-
  flight rule, and avoids shipping email with no off switch.
- B: launch with no opt-out, add it if anyone asks. Zero migration.

If A, the roadmap's "⚠?" on item 7 resolves to ⚠ (one small migration,
applied by the owner before merge, as always).

## Provider recommendation

**Resend** — free tier covers 3,000 emails/month and 100/day, which is an
order of magnitude above CVF's realistic volume; setup is a domain
verification (DNS records) plus one API key; the Node SDK is a single
dependency. Alternatives considered: Postmark (excellent deliverability,
$15/mo, overkill at this volume) and Amazon SES (cheapest at scale, most
setup friction). Nothing in the integration is Resend-specific beyond one
small send wrapper, so switching later is cheap.

**Owner-only setup steps** (same rule as Supabase keys — I never handle
keys):
1. Create the Resend account and verify the sending domain, e.g.
   `corevaluefitness.com`, sending as `CVF PT <notifications@corevaluefitness.com>`.
2. Add `RESEND_API_KEY` and `CRON_SECRET` env vars to the Vercel backend
   project.
3. Confirm the digest send time — recommendation: **6:00 AM America/Denver**
   (cron stored in UTC; DST shift of an hour either way is acceptable for a
   digest).

## Templates and copy

- Minimal branded HTML: dark-on-light for email-client compatibility, logo
  header, one clear line per fact, one button deep-linking into the app
  (e.g. `/client/sessions`). Plain-text alternative part included.
- Session times formatted in **America/Denver** with the day of week
  ("Thu Aug 6, 11:00 AM"), matching the in-app convention.
- Instant session emails carry date/time, duration, location, and the other
  party's first name. Digests carry counts and links, never message bodies.
- From-name "CVF PT"; `reply-to` set to the studio's real inbox so a reply
  reaches a human (owner to confirm which address).

## Failure and abuse posture

- Provider errors: logged via the existing `logError`, request still
  succeeds. No retries in v1 (volume doesn't justify a retry queue).
- The digest endpoint rejects calls without the secret header and is
  idempotent per day per recipient (computing "since last 24 h" from the
  clock, not from stored send state — a double-fire sends a duplicate
  digest, which is harmless; a missed fire is caught the next day).
- Email addresses come from the existing auth/profile records only; there
  is no address entry surface in this feature.

## Owner decisions needed before build

1. Preferences option **A** (tiny opt-out migration ⚠, recommended) or B
   (no migration)?
2. Include pending-requests-older-than-24 h in the coach digest?
3. Sending domain + reply-to address; then the provider setup steps above.
4. Digest send time (6:00 AM MT recommended).
