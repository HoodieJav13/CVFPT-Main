# 011 — Home rhythm and signals (owner + partner decisions, 2026-08-07)

Origin: partner feedback on the hosted demo, refined with the owner. The six
requests converge on one thesis: **client Home is the daily rhythm surface** —
today's work, the week at a glance, streaks — and every client action emits a
signal the coach can act on. Apple Health is parked (native-only; excluded
while CVF PT is a web/PWA product). Group chat is parked (announcements cover
the need at current scale).

## Decisions of record

- **One-tap "I did it"** exists for clients who won't track sets: open app,
  tap, close app, under ten seconds. Same-day only. Completion is recorded
  **without set detail** (sets completed, values empty) so exercise
  performance history is never polluted with phantom prescribed weights.
  Coach-side display distinguishes "completed — not tracked" from
  "completed — N sets logged."
- **No delayed follow-up nudge** after one-tap (completed logs are immutable
  by locked invariant, and it fights the ten-second goal). Instead the
  post-tap moment offers a non-blocking handoff into the existing daily
  check-in ("want to say how it went?").
- **Next-day catch-up**: if yesterday had an assigned workout with no log,
  Home shows "Did you forget to log yesterday's workout?" with the same
  one-tap. Catch-up counts toward the week.
- **Week calendar strip + checklist** on client Home (and per-client in coach
  ClientDetail): done / today / upcoming / to-make-up. Missed days read as
  opportunity ("1 to make up"), never as failure states. Scheduling needs no
  new primitive — dated workout assignments already exist.
- **Streaks are week-based** (consecutive weeks completing all assigned
  work), not daily chains — rest days and make-ups can't break them; morale
  protected by design. Streak feeds retention/adherence and may use the
  achievement-gold family.
- **Start notification** (in-app only): tracked workout start notifies the
  coach; completion auto-reads the started notification so the list never
  shows stale twins. One-tap emits only the completion signal.
- **Session detail page** for clients (time, coach, shared notes, calendar,
  cancel) + optional coach-attached workout on a session (new nullable link,
  forward-only migration) so "what we'll do" is visible ahead of time.
- **Announcements**: one-way, coach → their clients (admin may go
  studio-wide). Surfaces: client Home + notifications + a line in the
  existing conditional daily digest. **Never a standalone email.** Coach sees
  a seen-count. Replies impossible by design.
- **Ask-to-cancel replaces the <24h dead-end for everyone**: inside the
  cutoff, the client taps "Ask to cancel" → in-app notification (+ email via
  existing service) to the coach, who cancels from it. This makes the
  per-coach **messages-off flag** safe and small.
- **Daily digest stays as shipped** (conditional, opt-out, max one/day; a
  quiet week sends nothing). Owner will reassess frequency (weekly?) against
  real usage — config decision later, not a rebuild.
- **Web push is the immediate follow-up program**, not part of this one:
  device subscriptions + server keys + send-on-notification; iOS delivers
  only to installed PWAs; permission via deliberate tap. Ships after these
  signals exist so it has something worth pushing.

## Build order

- **A — Rhythm core**: one-tap complete (uses existing complete-all/complete
  RPCs; no schema change), post-tap check-in handoff, next-day catch-up,
  week strip + checklist, week streaks, coach ClientDetail week view,
  started/completed notification logic. The Home reorganization is a
  **genuine visual-direction decision**: baseline + bold variants per
  docs/design-principles.md before production, owner picks cold.
- **B — Session detail**: client session page + coach workout attachment
  (migration: nullable workout reference on sessions; migration-applied
  label flow).
- **C — Announcements**: tables (announcements + per-client seen),
  coach composer, client surfaces, digest line, seen-count (migration).
- **D — Cancellation signals**: ask-to-cancel notification path + coach
  messages-off flag (migration) + client messaging UI fallback copy.
- **E (next program) — Web push.**
