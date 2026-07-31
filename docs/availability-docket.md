# Availability & Booking — Decision Docket

Status: **awaiting decisions** (owner + partners). This docket resolves the
product questions for roadmap item 18 before any schema or code is built.
Each decision lists a recommended default, alternatives, and what deferring
costs. Circulate to both partners — the ballot decision of 2026-07-30 gives
them a formal say on availability.

Context already locked (not up for re-decision here):

- Session types: 30 / 45 / 60 / 90 minutes + assessment (owner ballot).
- Conflicts: coach + client overlaps are hard blocks in the transactional
  scheduler; location is advisory free text (S1–S4, live since PR #13).
- Booking flow: client requests → coach approves; a conflicting approval is
  refused and the request stays pending (PR #13/#30).
- Payments stay entirely outside the app; nothing here may gate booking on
  payment.
- Capacity is modeled (default 1); group slots are possible later (S4).

---

## A1. Publish granularity — how does a coach say when they work?

**Recommended: weekly recurring template + per-date overrides.** Each coach
publishes recurring windows (e.g., Mon 6–11 AM and 4–8 PM), and can add
date-specific overrides ("this Friday only until 2 PM"). Time off (A2) blocks
either.

- Alternative — per-date slots only: maximum control, but coaches must
  re-publish constantly; stale-calendar risk is high with three busy coaches.
- Alternative — template only, no overrides: simplest, but every real-life
  deviation becomes fake "time off".
- Defer cost: none of A4 (client slot-picking) can build without this.

## A2. Time off — what does "I'm out" look like?

**Recommended: date-time ranges** (`tstzrange`), covering both full days
("out July 14–18") and partial days ("gone after 1 PM"), with an optional
private reason. Overrides the template; existing booked sessions are NOT
auto-cancelled — the coach resolves those explicitly (the app can list the
affected sessions).

- Alternative — full-day only: simpler UI, but partial days are the common
  case for personal training.
- Decide: should clients see *why* a slot is gone? (Recommended: no — slots
  simply don't appear.)

## A3. Session types — which can clients request, and how long is an assessment?

Durations are locked for the timed types (30/45/60/90). Two things to decide:
**which types are client-requestable vs coach-initiated**, and **the
assessment's duration** — the ballot named the type but never set its length,
and `session_types.duration_minutes` needs a number to derive slots.

**Recommended (requestability):** clients may request 30/45/60; the 90-minute
and assessment types are coach-initiated only (assessments are how you onboard
someone — the coach schedules them deliberately). Every type stays available
to coaches in the session editor.

- Alternative: everything requestable — simplest, but a new client
  self-booking a 90 into a tight day is exactly the calendar noise the
  approve step exists to catch.

**Recommended (assessment duration): 90 minutes.** An onboarding assessment is
movement screen + goals conversation + usually a first mini-workout; a 60 that
runs long collides with the next booked slot, and since assessments are
coach-initiated (above), the longer block costs no client-facing flexibility.

- Alternative — 60 minutes: fits more assessments into a day; right answer if
  your intake is talk-first and the first real session is booked separately.
- This is per-type, not per-booking: whatever number lands here seeds
  `session_types` and every assessment occupies exactly that long a slot.

## A4. Client slot-picking — what does the client see and do?

**Recommended: pick-from-open-slots, still request → approve.** The client
picker shows only slots that are inside the coach's published windows, not
blocked by time off, and conflict-free against existing sessions (capacity
aware). Picking one files the normal booking request; approval re-checks
conflicts transactionally, exactly like today.

- Alternative — auto-book (no approval) inside published windows: fewer taps
  for everyone; recommended as a **phase 2 toggle per coach** once the
  published templates have proven accurate, not on day one.
- Defer cost of the approve step: none — it is today's behavior.

## A5. Lead time and horizon

**Recommended: 12 hours minimum notice, 21 days booking horizon** (both
per-coach-overridable later if needed). Requests outside the window aren't
offered as slots.

- Decide: are these the right numbers for how the three of you actually book?
  This is the question the partners can answer best.

## A6. Cancellation policy

**Recommended: advisory only, with a 24-hour notice window.** Show the policy
text in the client booking flow ("please cancel at least 24 hours ahead");
no enforcement, no penalties — payments and accountability live outside the
app (locked decision). Client cancellation requests notify the coach; the
coach cancels the session. 24 hours is the personal-training norm and matches
a coach's realistic chance of refilling the slot from the request queue.

- Alternative — 12 hours: matches the A5 booking lead time, so the two
  windows read as one rule; kinder to clients, but a morning slot cancelled
  the evening before rarely refills.
- Alternative — enforced cutoffs (client cannot cancel within the window in
  the app): decide only if late cancellations actually become a problem.
- The number is stored as policy text only (no schema impact), so changing
  it later is a copy edit, not a migration.

## A7. Whose hours — per coach or per studio?

**Recommended: per coach.** You train out of a shared gym today; studio-level
hours become meaningful when you have your own location. Per-coach templates
compose into a studio view naturally later (the week calendar from PR #26 is
the seam).

## A8. Group slots (capacity > 1)

**Recommended: defer.** Capacity is already modeled (S4); when a coach wants
a group slot, publishing a window with capacity N is a small follow-up. Only
decide now if a partner wants group sessions at launch.

---

## Schema sketch (for scale only — built after decisions, one ⚠ migration)

- `session_types(key, duration_minutes, client_requestable)` seeded with the
  five locked types.
- `coach_availability(coach_id, weekday, start_time, end_time, capacity)` —
  the weekly template (A1).
- `coach_availability_overrides(coach_id, on_date, start_time, end_time)` —
  per-date replacements (A1).
- `coach_time_off(coach_id, span tstzrange, reason)` (A2).
- Slot derivation happens in a service-role RPC (template − overrides −
  time off − existing sessions), same transactional pattern as
  `schedule_session`.

## Sign-off

| Decision | Owner | Partner 1 | Partner 2 |
|----------|-------|-----------|-----------|
| A1 granularity | | | |
| A2 time off | | | |
| A3 requestable types + assessment duration | | | |
| A4 slot-picking + approve | | | |
| A5 lead time / horizon | | | |
| A6 cancellation policy + notice window | | | |
| A7 per-coach hours | | | |
| A8 group slots | | | |

When every row has three initials (or "default"), the build starts.
