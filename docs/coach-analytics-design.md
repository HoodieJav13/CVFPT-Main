# Coach analytics — design note (v3 item 8)

Status: **draft for owner review.** D4 settled *which* metrics; it also
required that the "clients needing attention" threshold be defined in a
design note before any code. That threshold is the main decision below.
No schema change, no new decisions beyond the threshold — every metric is
computed from data the app already stores.

## What this is for

Three coaches, tens of clients. This is not a BI dashboard; it is a
weekly "who needs me and how is the practice doing" surface. Every number
must either change a coach's next action or be cut. That test is applied
per metric below.

## Metric definitions (D4 set, made exact)

All windows are computed in **America/Denver** and all queries exclude
`archived = true` rows. "Coach's clients" means `clients.coach_id =` the
viewer; admin sees any coach (see Privacy).

### 1. Sessions — completed / scheduled / cancelled
Source: `sessions` filtered by `coach_id` and `scheduled_at` within the
selected range, grouped by `status`.

- **Completed**: `status = 'completed'`.
- **Scheduled**: `status = 'scheduled'`. Split visually into *upcoming*
  (`scheduled_at >= now()`) and **stale** (`scheduled_at < now()` and
  still `scheduled`) — the second group is a data-hygiene signal, not a
  metric: it means sessions happened but were never marked complete. It
  is the single most likely source of wrong numbers everywhere else, so
  it gets surfaced rather than silently folded into "scheduled".
- **Cancelled**: `status = 'cancelled'`.
- **Cancellation rate**: `cancelled / (completed + cancelled)`. The
  denominator deliberately excludes still-scheduled sessions so the rate
  doesn't swing as the future fills in.

### 2. Dated-workout adherence
Source: `workout_assignments` where `assignment_mode = 'dated'` and
`assigned_for` inside the range (this is the only assignment kind with a
date to be measured against), joined to `workout_logs` on
`dated_workout_assignment_id`.

- **Assigned**: count of dated assignments whose `assigned_for` has
  passed (future-dated assignments are excluded — they are not yet
  missable).
- **Completed**: those with a linked log at `status = 'completed'`.
- **Adherence** = completed / assigned. Started-but-abandoned logs count
  as not completed; they show in the drill-in so a coach can tell
  "never opened" from "quit halfway", which are different conversations.
- Clients with zero dated assignments in the range are **excluded from
  the rate entirely** rather than counted as 0% — a client training on an
  undated active program is not non-adherent. This is the most common way
  an adherence number lies, so it is worth the extra clause.

### 3. Check-in consistency (7- and 30-day)
Source: `check_ins.check_in_date`, distinct dates per client.

- **7-day**: distinct check-in dates in the last 7 days ÷ 7.
- **30-day**: distinct dates in the last 30 days ÷ 30.
- Multiple check-ins in one day count once (the `distinct` matters —
  `check_in_date` has no uniqueness constraint).
- Check-ins created by a coach on the client's behalf
  (`created_by_role = 'coach'`) **do** count: the metric measures whether
  the coach has current information about the client, not who typed it.

### 4. Clients needing attention (the list)
Definition below — this is the metric that drives action, so it is the
one that gets the most care.

### 5. 30-day personal records (secondary)
Count of `workout_log_sets` rows in the last 30 days that qualified as a
personal best under the existing `lib/progress.js` logic, per client.
Presented as a positive-news strip, not a KPI — it exists so a coach has
something concrete to congratulate someone for. Explicitly *not* used in
the attention threshold; a client can be setting PRs and still be
drifting away.

## The attention threshold (decision needed)

A client appears on the **needs attention** list when **any one** of
these is true:

| # | Trigger | Rationale |
|---|---------|-----------|
| A | No completed session in **21 days** *and* has at least one completed session ever | Three missed weeks is past "on holiday" and into "drifting". The second clause keeps brand-new clients off the list. |
| B | Dated-workout adherence **below 50%** over the last 30 days, with **at least 3** dated assignments in that window | Needs enough denominator to mean something; 1-of-2 missed is noise. |
| C | **Zero** check-ins in the last **14 days** | The coach has no current information about this person. |
| D | A client message unanswered for more than **3 days** — newest message in the thread is from the client and `read_by_recipient = false` (or read with no coach reply after it) | This one is the coach's own service failure rather than the client's behavior, and it is the most fixable. |
| E | A booking request still `pending` more than **48 hours** | Same reasoning as D. Overlaps the email digest's 24 h nudge deliberately — the digest prompts, the list escalates. |

Each row shows **which trigger(s) fired**, in plain language ("no session
in 24 days", "3 days without a reply"), and links straight to the client
detail page. A list that says "needs attention" without saying why is a
guilt generator, not a tool.

**Deliberately excluded from the threshold:** total revenue or package
state (payments live outside the app), PR counts (see 5), and anything
requiring a coach to configure a number. If these thresholds turn out
wrong in practice, the fix is to change the constants here after seeing
real data — not to build a settings screen for a 3-coach studio.

**Suppression:** archived clients never appear. Clients whose only
trigger is C, and who have been a client for fewer than 14 days, are
suppressed — a new client hasn't had time to establish a check-in habit.

**Owner decisions needed:** confirm or adjust the five thresholds
(21 days / 50% over ≥3 / 14 days / 3 days / 48 hours), and confirm that
D and E — the two that point at the coach rather than the client —
belong on the list at all. My recommendation is yes: they are the
triggers a coach can act on immediately and fix the same day.

## Endpoint and performance shape

`GET /api/analytics/coach?from=…&to=…` (requireCoach), returning tiles +
the attention list in one response. Validated `from`/`to` required, range
capped, same pattern as the studio week endpoint — no unbounded history
scan.

Aggregation runs as a **small number of grouped queries, never per
client**. The dashboard's existing N+1 mistake (fixed in review earlier
in v2) is the exact failure mode to avoid: five queries that each return
all rows for the coach's clients and are folded in JS, rather than one
query per client. With tens of clients this is a handful of indexed range
scans.

Range: default **last 30 days**, with 7 / 30 / 90 toggles reusing the
Progress page's existing range-toggle pattern so it feels familiar.

Caching: none in v1. The data is small and coaches will open this
occasionally; a stale-cache bug would cost more than the query does.

## Privacy

Consistent with D1: a coach sees only their own clients' data. Admin sees
all coaches and can switch which coach is being viewed. There is no
cross-coach comparison view — three coaches in one studio is exactly the
size where a leaderboard does more social damage than analytical good. If
the owner wants studio-wide totals later, that is an admin-only roll-up
with no per-coach breakdown, and it is a separate decision.

## UI shape

- Tile row: sessions completed / cancellation rate / adherence / check-in
  consistency, each with the range's delta versus the previous equal
  window (a number with no direction isn't actionable).
- **Needs attention** list directly under the tiles — it is the reason to
  open the page, so it is not below the fold.
- PR strip last, as positive news.
- Per-client drill-in reuses the existing client detail route rather than
  inventing a second client view.

## Why this is scheduled last

The roadmap puts analytics after everything else on purpose: it
aggregates session, attribution, and check-in data that only becomes
meaningful once the scheduling and tracking features have been in real
use. Building it earlier would mean tuning thresholds against fixture
data. Recommendation: land the threshold decision now, build after the
studio has a few weeks of real usage under the v3 features, and expect
one round of constant-tuning after the first month.
