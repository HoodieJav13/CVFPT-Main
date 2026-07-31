# Offline workout completion — design (roadmap #13)

Status: **conformance review in progress.** Direction pre-approved
2026-07-30; the one flagged open question (completion timestamp) was
answered by the owner on 2026-07-31: performance time. Merge of this doc
constitutes approval to build.

## What changes and why

Today `Finish workout` and `Complete all remaining` are disabled unless
the outbox is fully flushed and the device is online
(`WorkoutTracker.jsx`), and `finish()` aborts with "Reconnect and wait."
That was the approved safety contract: completion is the one mutation
that seals a log, so it never queued.

The cost: a client in a dead-signal corner of a gym cannot finish their
workout — precisely the environment this app serves. This design makes
completion itself queueable while preserving every guarantee the block
existed to protect.

The server side is already strong and is NOT being redesigned:
`complete_workout_log` runs under row locking, rejects non-active logs,
requires ≥1 completed set, marks stragglers skipped, and notification
inserts are unique-constrained (`20260717043317`). The
`prevent_completed_workout_*` triggers seal completed logs at the
database. This project is a client-side reliability design plus two small
server additions.

## The four hard parts

### 1. Queue ordering

Completion becomes a queued operation with a strict rule: **it is only
eligible to send when it is the head of the queue.** The existing outbox
is already FIFO with head-blocking retry (`flush()` processes
`queueRef.current[0]` and stops on retryable failure), so ordering falls
out of the current design — set writes queued before completion always
land first. New rule added: after a `complete` operation is enqueued, the
UI enters read-only mode (part 4), so nothing can be enqueued behind it
except nothing — the queue drains to exactly `[...setWrites, complete]`.

### 2. "Finished locally" state

New save-state value `finished_locally` alongside
`saved | saving | not_saved`:

- Entering it: user confirms the finish dialog while offline or with a
  non-empty queue. The dialog copy changes to "Saved on this phone —
  will sync when you reconnect." Navigation proceeds to the workout
  detail route, which renders from a local snapshot (the optimistic log
  state) with a persistent `Waiting to sync` banner instead of the
  completion celebration. The celebration fires only on confirmed server
  completion — a deliberate emotional-honesty choice: we do not
  celebrate unsynced data.
- Persistence: the queued `complete` operation lives in the same
  `localStorage` outbox (`cvf_workout_outbox_<logId>`), so
  `finished_locally` survives reload and app restart, reconstructed by
  the existing `hydrate` path plus queue inspection (a `complete` op in
  the queue ⇒ `finished_locally`).
- Programs page: the active-workout "Resume" banner shows
  "Finishing — waiting to sync" and links to the read-only detail view,
  not the tracker.

### 3. Rejection recovery

Terminal (4xx, not 408/429) rejection of the queued `complete` follows
the outbox's existing recovery shape (drop op → refetch server log →
re-apply remaining queue) with one addition — because completion has
consequences the user walked away from, silent drop is not acceptable:

- The log leaves `finished_locally` and returns to `active`; the tracker
  becomes writable again.
- A persistent, dismiss-only notice explains what happened, e.g.
  "Complete at least one set" (the only business rejection the RPC
  emits) or a fresh-load reconciliation if the log was mutated elsewhere
  (e.g. a coach abandoned it — possible since PR-B).
- If refetch shows the log is already `completed` (a duplicate send after
  an ambiguous network failure), treat as success: the RPC's row-lock +
  status check makes double-completion a no-op rejection, so "already
  completed" maps to confirmed sync, not error.
- Retryable failures (5xx/408/429/offline) keep the existing exponential
  backoff, capped at 30s, forever — completion never expires.

### 4. Post-completion write sealing

Two layers, one existing and one new:

- **Database (existing):** `prevent_completed_workout_log_change` and
  `prevent_completed_workout_child_change` already reject mutations to
  completed logs and their children — the ultimate seal, verified again
  in PR-A probes (including the new attribution columns).
- **Client (new):** the moment a `complete` op is enqueued, the tracker
  flips to read-only: inputs disabled, add/remove-set and notes hidden,
  toggle buttons inert. This prevents the footgun of edits queued
  *behind* a completion, which would drain into the sealed log and be
  rejected as spurious errors. Escape hatch: "Keep editing instead"
  removes the queued `complete` (it is client-local until sent) and
  returns to normal tracking — cheap undo while offline.

## Server additions (small)

1. **Idempotency echo:** completion request carries the log id (already
   does — path param) and the RPC already no-ops on non-active logs. Add
   an Express branch mapping "not active" + current status `completed`
   to 200-with-log instead of 409, so a duplicate queued send after an
   ambiguous failure resolves as success. (Read-only change to the
   route's error mapping; no RPC change.)
2. **Completion timestamp — DECIDED (owner, 2026-07-31): performance
   time.** The queued `complete` operation persists the local timestamp
   at which the user confirmed the finish dialog; the sync sends it and
   the server records it as `completed_at`. Because the applied
   `complete_workout_log` signature cannot grow a defaulted parameter
   without creating an ambiguous overload, this lands as
   `complete_workout_log_v2(uuid, uuid, text, text, timestamptz)` in a
   new forward-only migration (same versioning pattern as
   `start_workout_log_v2`). The server clamps the value to
   `(started_at, now()]` — anything missing, malformed, or out of bounds
   falls back to `now()`, so a device with a wrong clock cannot write an
   impossible history.

## Not in scope

Coach-side offline logging (coaches log on gym Wi-Fi; revisit if real
need appears), multi-device active-workout merging (single active log
per client is DB-enforced), and any change to the one-active-log
invariant or the notification uniqueness rules.

## Verification plan

- Unit: queue-ordering property (complete never sends before earlier
  ops), finished-locally reconstruction from a persisted outbox,
  rejection→reactivation flow, already-completed→success mapping.
- Preview e2e: offline finish → banner state → reconnect → celebration
  fires exactly once; "Keep editing instead" restores tracking.
- Backend: route-mapping test for duplicate completion returning 200.
