# Coach analytics — design note (v3 item 8)

Status: **owner-reviewed 2026-08-01** — all five attention thresholds
are approved (including D and E, the coach-owned triggers), the
aggregate-only stance on any future studio view is confirmed, and four
factual corrections from review are applied. D4's "define the threshold
before code" requirement is satisfied; this note is now the build spec.
No schema change — every metric is computed from data the app already
stores.

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
- Counted as **distinct** `check_in_date` values. The database already
  enforces one active check-in per client per day —
  `idx_check_ins_one_active_per_day on check_ins(client_id,
  check_in_date) where archived = false` — so within the
  `archived = false` filter these queries use, duplicates cannot occur.
  `distinct` is kept as cheap defence: the index is *partial*, so an
  archived row and an active row can share a date, and any future query
  that forgets the archive filter would otherwise double-count.
- Check-ins created by a coach on the client's behalf
  (`created_by_role = 'coach'`) **do** count: the metric measures whether
  the coach has current information about the client, not who typed it.

### 4. Clients needing attention (the list)
Definition below — this is the metric that drives action, so it is the
one that gets the most care.

### 5. 30-day personal records (secondary)
Source: **`metric_entries`** (`value`, `recorded_on`) joined to
`metrics` (`client_id`, `improvement_direction`), evaluated with the
existing `backend/src/lib/progress.js` helpers. Not `workout_log_sets` —
logged training loads are not the PR system.

`is_personal_best` is **not a stored column**: `personalBestResult()`
decides it by comparing one entry against the others at call time. So a
"PRs in the last 30 days" count cannot be a `where` clause. The
aggregation must, per metric, load that metric's entries **in
`recorded_on` order** and walk them chronologically, marking an entry a
PR when it beats the best of everything strictly before it. Filtering to
the last 30 days *first* and then testing would mislabel the window's
opening entry as a PR whenever an older, better entry exists — the
window bounds which PRs are *reported*, never which history is
*compared against*.

Metrics with `improvement_direction = 'neutral'` (the column default)
never produce PRs by design, so a client tracking only neutral metrics
correctly shows zero rather than noise.

Presented as a positive-news strip, not a KPI — it exists so a coach has
something concrete to congratulate someone for. Explicitly *not* used in
the attention threshold; a client can be setting PRs and still be
drifting away.

## The attention threshold (approved 2026-08-01)

A client appears on the **needs attention** list when **any one** of
these is true:

| # | Trigger | Rationale |
|---|---------|-----------|
| A | No completed session in **21 days** *and* has at least one completed session ever | Three missed weeks is past "on holiday" and into "drifting". The second clause keeps brand-new clients off the list. |
| B | Dated-workout adherence **below 50%** over the last 30 days, with at least **3 eligible** assignments — `assigned_for` already past, matching the adherence denominator in §2 | Needs a real denominator; 1-of-2 missed is noise. Counting future-dated assignments toward the minimum would let not-yet-due work push a client onto the list. |
| C | **Zero** check-ins in the last **14 days** | The coach has no current information about this person. |
| D | A client message unanswered for more than **3 days**, measured from the **oldest** client message sent after the last coach reply | Coach-owned service failure, and the most fixable. Measuring from the *newest* client message would be wrong: a client who follows up on day 6 would reset their own timer and drop off the list precisely when they are being ignored hardest. |
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

**Owner decision (resolved):** all five thresholds approved as written
— 21 days / below 50% over ≥3 eligible / 14 days / 3 days / 48 hours —
and D and E stay on the list. The owner's reasoning is worth recording
because it shapes future additions: coach-owned service failures belong
precisely *because* they are the most immediately actionable.

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

**The toggle governs the tiles only.** Three things keep fixed windows
regardless of where the toggle sits, and the UI labels them with their
own window so the page never implies otherwise:

- the **attention thresholds** (§4) — a client is not "less overdue"
  because the coach is looking at a 7-day view, and letting the toggle
  move them would make the list mean something different on every visit;
- **30-day personal records** (§5);
- **7- and 30-day check-in consistency** (§3), which are defined as a
  pair and are not a single windowed rate.

Only the session counts, cancellation rate, and adherence rate follow
the selected range.

Caching: none in v1. The data is small and coaches will open this
occasionally; a stale-cache bug would cost more than the query does.

## Privacy

Consistent with D1: a coach sees only their own clients' data. Admin sees
all coaches and can switch which coach is being viewed. There is no
cross-coach comparison view — three coaches in one studio is exactly the
size where a leaderboard does more social damage than analytical good.
**Owner-confirmed:** any future studio view stays aggregate-only, with
no per-coach breakdown. Treat that as a standing constraint on this
surface, not a default to revisit per feature.

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
