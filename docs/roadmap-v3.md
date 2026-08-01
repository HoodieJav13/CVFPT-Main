# CVF PT Roadmap v3 (2026-07-31)

Scope agreed with the owner on 2026-07-31, immediately after v2 closed
(all v2 items merged and applied through PR #39): **the five items the
v2 decisions earmarked as phase 2, plus three of the four bigger
swings.** The brand photography pass is explicitly deferred until the
owner is ready with consented assets; nothing else from v2's deferral
list changes.

## Standing rules (carried from v2, unchanged)

- One bounded feature per branch/PR.
- Migration-bearing PRs (⚠): owner applies to hosted **before** merge —
  merging `main` auto-deploys both Vercel projects.
- Never two unapplied migrations in flight; never edit an applied one.
- Functional and visual changes in separate commits.
- Merge-on-approval; ⚠ PRs always wait for the apply step.
- Payments stay entirely outside the app. Stripe (PR #3) and the retired
  credit/package code remain locked — never resumed or extended.
- New tables follow the locked API-boundary pattern: RLS on with no
  client policies, service-role grants without DELETE, soft delete only,
  Express as the sole caller.

## Decisions (D1–D4 resolved by the owner 2026-08-01; D5 open)

| ID | Decision | Resolution |
|----|----------|------------|
| D1 | Studio week view visibility | **Decided: shared studio calendar, privacy-scoped.** Every coach sees every coach's schedule as coach + time + duration + location + busy status; client identity is masked unless the viewer is that client's coach or an admin. Matches the PR-B cross-coach authorization rules (foreign clients are 404-masked everywhere else) — an all-visible calendar would have contradicted them. |
| D2 | Notification channel and events | **Decided: email first.** Instant: new booking requests → the coach; approved / declined / rescheduled / cancelled sessions → the client. Daily digest: unread messages and new assignments. Provider account and key are an owner-only setup step (same rule as Supabase keys). |
| D3 | Auto-book control | **Decided: each coach flips their own toggle**, default off, with a confirmation dialog stating that published hours become instantly bookable when enabled. |
| D4 | Analytics metric set | **Decided (revised):** sessions completed / scheduled / cancelled, dated-workout adherence, 7- and 30-day check-in consistency, a "clients needing attention" list, and 30-day PRs as a secondary metric. "Streak" alone was dropped as insufficiently actionable. The attention-list threshold (what qualifies a client) is defined in the build's design note before code. |
| D5 | **Group slot semantics — open; blocks item 3** | Capacity alone doesn't settle the product rules. To decide: does a capacity-N booking create **one shared event with a roster**, or **N overlapping individual session records**? Plus attendee privacy and cancellation behavior. Recommendation: N overlapping individual session records — each client keeps their own session row (notes, completion, attribution, and cancellation already work per client), the roster is derived, one cancellation frees one spot, attendees never see each other (consistent with D1's masking), and no new event entity is needed. Partners get a say, like the availability docket. |

## Track 1 — Scheduling phase 2 (builds on the availability system)

| # | Item | Contents | Owner check-in |
|---|------|----------|----------------|
| 1 | Time-off impact list | When a coach adds (or reviews) time off that overlaps booked sessions, list the affected sessions right in the Hours editor with jump links — resolves A2's "the app can list the affected sessions". Read-only; no schema change. | Screenshot review |
| 2 | Auto-book ⚠ | Per-coach `auto_book` flag (default off; per D3 each coach flips their own, behind a confirmation dialog explaining published hours become instantly bookable). A client picking an open slot books instantly through the existing transactional conflict RPC instead of filing a request; coaches with it off keep request → approve. The picker already guarantees slot membership server-side. | **Apply migration** |
| 3 | Group slots ⚠ | Hours editor exposes the capacity field (1–10) already modeled on windows; `get_open_slots` returns remaining capacity so the client picker can show "2 spots left". Booking/privacy/cancellation semantics per D5 once resolved. | **Resolve D5 (partners), then apply migration** |
| 4 | Studio week view | The coach calendar gains an all-coaches toggle composing the three coaches' **sessions** into one week grid — A7's seam. Per D1: foreign clients render as busy blocks (coach, time, duration, location) with identity masked; own clients and admin views show names. Read-only, week-bounded queries. **Sessions-only by owner decision (2026-08-01): published hours describe coach availability, not studio occupancy — composing them would create misleading density. If wanted later, hours become a separate optional overlay, not permanent strips.** | Screenshot review |
| 5 | Evidence-gated knobs | Per-coach lead/horizon overrides (A5) and cancellation-notice enforcement (A6) stay parked until real usage shows the defaults chafing. Not scheduled; listed so the parking is deliberate. | Owner raises it if usage demands |

## Track 2 — Reach & reliability

| # | Item | Contents | Owner check-in |
|---|------|----------|----------------|
| 6 | PWA installability | Web app manifest, icons, service worker with deploy-safe versioning (never cache-pin a stale bundle), install prompt. Groundwork for push later. No schema change. | Screenshot review + install test on a real phone |
| 7 | Email notifications ⚠? | Provider integration (owner creates the account and holds the key — same owner-only rule as Supabase keys), event wiring per D2, unsubscribe/preferences. Migration only if a preferences table proves necessary — decided at design time, and it must not collide with any other migration in flight. | **Resolve D2 + provider setup**; design note before build |
| 8 | Coach analytics | Adherence dashboard per coach: aggregation endpoints over the now-rich session/attribution/check-in data, dashboard tiles + per-client drill-in. Metric set per D4 (decided); the "clients needing attention" threshold is defined in a short design note before code. Deliberately last — it wants real usage data to aggregate. | Design note (attention threshold), then screenshot review |

## Deferred by explicit decision

- **Brand photography pass** — owner not ready; the asset slots, duotone
  tuning, and BrandBackdrop integration wait for consented photos.
- Stripe resumption, nav consolidation, location-as-hard-conflict,
  AI-assisted PDF parsing, My PT Hub migration — standing deferrals,
  unchanged from v2.
- Push notifications — follows email (7) and the PWA (6); not scheduled
  until both are live.

## Execution order (owner-revised 2026-08-01)

```
1 ──► 4 ──► 2 ⚠ ──► 3 ⚠   impact list, then studio view (read-only, no
                           migration), then auto-book, then group slots
                           (blocked on D5); one migration in flight at
                           a time
6 ──► 7                    PWA, then email — independent lane
8     ──► last             analytics waits for real usage data
```

⚠ migrations expected: #2 and #3 (small, sequential), possibly #7.
Applied before merge, never two pending, exactly as in v2.

## Status ledger

| Item | PR | State |
|------|----|-------|
| Roadmap v3 (this doc) | #40 | merged (amended per owner review: D1–D4 resolved, D5 added, order revised) |
| Time-off impact list | #41 | merged |
| Studio week view | #42 | merged |
| Auto-book ⚠ | #43 | merged (migration applied) |
| PWA installability | #44 | merged |
| Email notifications design note | #45 | merged — D2 spec settled; build awaits owner provider setup + ships one opt-out migration ⚠ |
| Coach analytics design note | #46 | open — D4 attention thresholds approved by owner; review corrections applied |
