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

## Decisions needed before their items build (D1–D4)

| ID | Decision | Recommendation |
|----|----------|----------------|
| D1 | Studio week view visibility: do all three coaches see each other's calendars, or admin only? | All coaches — it's a three-person studio and the data isn't sensitive between partners |
| D2 | Notifications: channel and events. Email first or wait for push? Which events are instant vs daily digest? Provider account is an owner-only setup step (like Supabase keys) | Email first (push needs the PWA installed); instant for booking approved/declined, digest for unread messages and newly assigned workouts |
| D3 | Auto-book: who flips the toggle — each coach for themselves, or admin only? Default stays off | Each coach for themselves, in the Hours editor — trusting your own template is a personal call |
| D4 | Analytics metric set for the coach dashboard | Sessions kept/week, workout completion rate, check-in streak, PRs in the last 30 days — argue at build time from real data shapes |

## Track 1 — Scheduling phase 2 (builds on the availability system)

| # | Item | Contents | Owner check-in |
|---|------|----------|----------------|
| 1 | Time-off impact list | When a coach adds (or reviews) time off that overlaps booked sessions, list the affected sessions right in the Hours editor with jump links — resolves A2's "the app can list the affected sessions". Read-only; no schema change. | Screenshot review |
| 2 | Auto-book ⚠ | Per-coach `auto_book` flag (default off, D3 decides who flips it). A client picking an open slot books instantly through the existing transactional conflict RPC instead of filing a request; coaches with it off keep request → approve. The picker already guarantees slot membership server-side. | **Apply migration; confirm D3** |
| 3 | Group slots ⚠ | Hours editor exposes the capacity field (1–10) already modeled on windows; `get_open_slots` returns remaining capacity so the client picker can show "2 spots left". Capacity > 1 remains RPC-enforced only (known v2 ceiling, unchanged). | **Apply migration** (RPC signature change) |
| 4 | Studio week view | The coach calendar gains an all-coaches toggle composing the three calendars (sessions + published hours) into one week grid — A7's seam. Read-only. | **Resolve D1**, then screenshot review |
| 5 | Evidence-gated knobs | Per-coach lead/horizon overrides (A5) and cancellation-notice enforcement (A6) stay parked until real usage shows the defaults chafing. Not scheduled; listed so the parking is deliberate. | Owner raises it if usage demands |

## Track 2 — Reach & reliability

| # | Item | Contents | Owner check-in |
|---|------|----------|----------------|
| 6 | PWA installability | Web app manifest, icons, service worker with deploy-safe versioning (never cache-pin a stale bundle), install prompt. Groundwork for push later. No schema change. | Screenshot review + install test on a real phone |
| 7 | Email notifications ⚠? | Provider integration (owner creates the account and holds the key — same owner-only rule as Supabase keys), event wiring per D2, unsubscribe/preferences. Migration only if a preferences table proves necessary — decided at design time, and it must not collide with any other migration in flight. | **Resolve D2 + provider setup**; design note before build |
| 8 | Coach analytics | Adherence dashboard per coach: aggregation endpoints over the now-rich session/attribution/check-in data, dashboard tiles + per-client drill-in. Metric set per D4. Read-only; no schema change expected. | **Resolve D4**, then screenshot review |

## Deferred by explicit decision

- **Brand photography pass** — owner not ready; the asset slots, duotone
  tuning, and BrandBackdrop integration wait for consented photos.
- Stripe resumption, nav consolidation, location-as-hard-conflict,
  AI-assisted PDF parsing, My PT Hub migration — standing deferrals,
  unchanged from v2.
- Push notifications — follows email (7) and the PWA (6); not scheduled
  until both are live.

## Execution order

```
1 ──► 2 ⚠ ──► 3 ⚠      scheduling chain; one migration in flight at a time
4     ──► after D1      independent read-only build
6     ──► anytime       independent; before push ever becomes possible
7     ──► after D2 + provider setup (owner)
8     ──► after D4      last; wants a few weeks of real usage data anyway
```

⚠ migrations expected: #2 and #3 (small, sequential), possibly #7.
Applied before merge, never two pending, exactly as in v2.

## Status ledger

| Item | PR | State |
|------|----|-------|
| Roadmap v3 (this doc) | — | open |
