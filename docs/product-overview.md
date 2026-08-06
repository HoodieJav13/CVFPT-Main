# CVF PT product overview

CVF PT is Core Value Fitness's internal personal-training workspace. It replaces
My PT Hub with a focused, mobile-first system for owner-coaches and their invited
clients. It is not a public fitness marketplace or a self-service consumer app.

## People and access

- **Admin owner-coach:** performs normal coaching work and manages business-wide
  settings, coaches, client reassignment, and waiver versions.
- **Coach:** manages assigned clients, training, sessions, communication, and
  client-facing resources. A coach cannot access another coach's private client
  records unless acting through an approved business-wide workflow.
- **Client:** joins by invitation, sees only their own coaching relationship and
  permitted resources, and never selects another client's records.

A client profile may exist without a login. Inviting a client allows that person
to claim the existing profile; it does not create a second source of client truth.

## Product capabilities

- Client profiles, invitations (with emailed claim links), ownership, and soft
  archival
- Account recovery: forgot/reset password, in-app password change, and
  coach-triggered reset emails for locked-out clients
- Scheduling, booking requests, session notes, and completion
- Coach availability templates, date overrides, and time off, with published
  open slots and optional instant auto-booking
- A privacy-scoped shared studio calendar across coaches
- Progress metrics, daily check-ins, and coach/client review workflows
- Training programs, assigned workouts, in-workout tracking, performed-exercise
  history, coach feedback, exercise libraries, assignments, and exports
- In-app coach notifications for completed client workouts
- Transactional email notifications (booking lifecycle, session scheduled/
  rescheduled/cancelled) and an opt-out daily digest with next-24h session
  reminders
- Coach analytics (adherence and activity views)
- Coach-managed PDF resources with public or client-assigned access
- Coach/client messaging
- Append-only digital and paper waiver records
- Installable PWA experience and privacy-safe product telemetry

## Product rules

- Authorization and ownership are enforced by the service, never trusted to the
  browser.
- Business records are archived rather than hard-deleted.
- Existing waiver versions and signatures are permanent records.
- Payments are handled outside CVF PT. Session and workout completion never
  read, grant, require, or deduct credits.
- Legal waiver wording is supplied and approved by the business; the application
  must not invent it.

## Current exclusions

- Public or coach self-signup
- Push notifications, SMS, and marketing/broadcast email campaigns
  (transactional email and the daily digest are in scope — see capabilities)
- Full nutrition or habit-tracking programs
- Native iOS or Android applications
- In-app packages, credits, checkout, charges, invoicing, subscriptions, or
  refunds. Historical payment data and dormant source/schema are preserved for
  reversibility but are not mounted or reachable.
- Social/community features beyond coach-client communication
