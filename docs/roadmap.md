# CVF PT Roadmap v2 (2026-07-30)

Consolidated from: full-repo audit (backend, schema, all pages), preview-mode
rendered audit (39 states, desktop + 390px), owner corrections, and the
decision docket resolved with the owner on 2026-07-30.

## Standing rules

- One bounded feature per branch/PR.
- Migration-bearing PRs (marked ⚠): apply the migration to hosted **before**
  merging — merging `main` auto-deploys both Vercel projects
  (see `docs/hardening/2026-07-22-pr5-hosted-release.md`).
- Never two unapplied migrations in flight at once.
- Functional and visual changes in separate commits.
- Backend deploys before frontend within each pair.
- Every ⚠ PR description leads with the migration file path and the exact
  apply command, so the owner's apply-before-merge stop is one command.

## Decisions locked (owner, 2026-07-30)

| ID | Decision |
|----|----------|
| D1 | Per-set attribution (`entered_by`), immutable; workout-level badge derived |
| D2 | No lock on active workouts; both actors may edit; last write wins per set |
| D3 | Session → many workouts allowed |
| D4 | Workout → at most one session (nullable FK) |
| D5 | Coach-entered displays as verified; three display states via derivation |
| D6 | Session linkage optional |
| S1 | Conflicts: coach + client hard blocks in transactional RPC; location advisory (free-text, unreliable to constrain) |
| S2 | Back-to-back sessions allowed; no buffer rule |
| S3 | Cancelled sessions free their slot |
| S4 | `capacity` modeled now, default 1 |

Also standing: payments remain outside the app entirely. App access is
granted and removed directly by coaches/admin — having access means the
client has already paid outside the app. The retired credit/package/payment
behavior stays retired and is never an access mechanism (locked repository
decision; do not resume or extend it, including PR #3).

## Owner process decisions (ballot, 2026-07-30)

1. **Goal semantics (#16):** coach-set, client-visible.
2. **Offline completion (#13):** direction pre-approved. Owner stop is a
   conformance review of the design doc against the four named hard parts
   (queue ordering, finished-locally state, rejection recovery, write
   sealing) — not a re-decision.
3. **PR-B authz matrix blessed:** coach-on-own-client allow · coach-on-other
   404-masked · client-on-own-log allow · client-on-other 404-masked ·
   client forging `entered_by: 'coach'` ignored. At-PR review = all rows green.
4. **Default-forward:** ungated UI PRs (#3, 5, 6, 8, 10, 15, 17) proceed to
   merge-ready if the owner hasn't responded within 72h. Never applies to
   ⚠ PRs, PR-B, #13, or #14.
5. **Merge-on-approval:** owner screenshot approval doubles as merge
   authorization (⚠ PRs still require the apply-migration step first).
6. **#18 availability:** partners get a formal say (as with the Stripe
   decision). Initial session-type list: 30/45/60/90 min + assessment.
   Granularity and time-off mechanics decided at build time.
7. **#14 flagship surface:** Messages two-pane sets the pattern; builder and
   Client Detail follow it.

## Track 1 — Coach-assisted workout logging + session linkage

| # | PR | Contents | Owner check-in |
|---|----|----------|----------------|
| 1 | PR-A ⚠ | Columns: `workout_log_sets.entered_by`/`entered_by_coach_id`; `workout_logs.session_id`, `started_by`, `started_by_coach_id`. Backfill `'client'` (factually correct — all historical writes were `requireClient`). Inert. | **Apply migration to hosted; merge = deploy** |
| 2 | PR-B | `start_workout_log_v2` (versioned RPC — not an overload of v1; v1 left dormant per no-cleanup rule). `loadWorkoutLogForActor` guard replaces blanket `requireClient` on the 11 mutating workout-log routes: client → own log; coach/admin → `canAccessClient` on the log's client. `entered_by` stamped server-side from the resolved actor, never from the request body. | **Review authz matrix results** (security boundary) |
| 3 | PR-C | Coach `workouts/:id/track` route + entry points (session row, Client Detail). Folds in: tab-overflow affordance (shared TabsList fix), `h1` name wrap, email `break-words`. | Screenshot review at PR |
| 4 | PR-D′ | Backend only: `attribution: client\|coach\|mixed` computed field on log detail. Display lands in UI-2. | — |

## Track 2 — Tracker & review UI (immediately after Track 1)

| # | PR | Contents | Owner check-in |
|---|----|----------|----------------|
| 5 | UI-1 | Tracker ergonomics: ghost prescription targets in inputs; "same as last time" one-tap chip (absorbs the planned "Last time" history summary — same endpoint, same surface); progress bar in sticky dock; per-exercise done-count chips. | Screenshot review at PR |
| 6 | UI-2 | Review surface: prescribed-vs-performed table (surfaces the `actual_reps`/`actual_rpe` the page currently omits — `WorkoutLogDetail.jsx` renders weight + status only); per-exercise volume totals; delta vs previous occurrence; verified/self-reported/mixed badges from PR-D′. Frontend-only. | Screenshot review at PR |

## Track 3 — Scheduling (E → picker → F)

| # | PR | Contents | Owner check-in |
|---|----|----------|----------------|
| 7 | PR-E ⚠ | `sessions.capacity` (default 1). Transactional conflict RPC extending the transactional-mutations pattern: overlap via `tstzrange`, excluding cancelled/archived; reject when coach overlap count reaches capacity or client has any overlap; location → advisory warning. Backstop: partial `btree_gist` exclusion constraint for `capacity = 1` rows (hard DB guarantee; capacity > 1 is RPC-enforced only — known ceiling). | **Apply migration to hosted; merge = deploy** |
| 8 | UI-3 | Branded date + time-slot picker replacing native `datetime-local` (vendored `calendar.jsx`). Sequenced before PR-F: it is where conflict errors render. | Screenshot review at PR |
| 9 | PR-F | Conflict surfacing in picker + booking-approve flow; coach-conflict vs client-conflict distinguished; location warning non-blocking. | — |

## Track 4 — Independent improvements (parallelizable)

| # | PR | Contents | Owner check-in |
|---|----|----------|----------------|
| 10 | UI-4 | Remove global FAB → one contextual header action per screen (fixes occlusion over chat send, builder cards, waiver timestamps). Usability correction, ungated. | Screenshot review at PR |
| 11 | UI-5 | Jump-to-client search (vendored `cmdk`). Authorization-safe: coach's own roster only. | — |
| 12 | Rest ⚠ | `prescribed_rest_seconds` + SQL backfill port of `parseRest`; text fallback during transition; numeric authoring input; delete runtime parser after verified backfill. Then durable rest timer: `localStorage` persistence; sound/vibration **opt-in** behind capability checks. Schedule after UI-1 (same file). | **Apply migration to hosted; merge = deploy** |
| 13 | Offline completion | Standalone reliability project — overturns the approved block-completion-until-saved invariant. **Design doc before any code**: queue-ordered completion, "finished locally" state, rejection recovery, post-completion write sealing. Server completion is already idempotent (row locking, status handling, unique notifications). | **Approve design doc before build** |

## Track 5 — Desktop identity pass

| # | PR | Contents | Owner check-in |
|---|----|----------|----------------|
| 14 | UI-6 | Two-pane desktop layouts: Messages (thread list + conversation + client-context header; chat polish — day separators, bubble grouping, auto-grow composer — rides along), Training builder (list + editor), Client Detail (identity rail + tabs). Full `docs/design-principles.md` gate. | **Directional-variant selection + cold-visibility review + paired desktop/mobile comparison** (heaviest owner involvement in the roadmap) |

## Track 6 — Progress & calendar

| # | PR | Contents | Owner check-in |
|---|----|----------|----------------|
| 15 | UI-7 | Progress FE: range toggle (30/90/all), full-history sheet, session markers. No gate. | Screenshot review at PR |
| 16 | Goals ⚠ | `metrics.target_value` migration + API; goal line on `MetricChart` (visual seam built in UI-7). | **Apply migration to hosted**; confirm goal semantics per metric |
| 17 | Calendar | Read-only coach week grid over existing sessions. | Screenshot review at PR |
| 18 | Availability ⚠ | Design docket first (publish granularity, time-off model, session types; likely partner input). Then `coach_availability` / `time_off` / `session_types` + client slot-picking. | **Resolve docket (product decisions) + apply migration** |

## Deferred by explicit decision

- Nav consolidation — revisit on observed usage only; six-tab concern was
  disproven in the rendered audit.
- Location as hard conflict scope — requires a real `locations` table (#18+).
- AI-assisted PDF parsing, My PT Hub migration, Stripe resumption — standing
  deferrals, unchanged.

## Execution order

```
1→2→3→4 ──► 5→6          coach logging, then the UI that compounds it
        └─► 7→8→9        scheduling chain (start once #4 merges)
10, 11  ──► anytime       gap-fillers between reviews
12      ──► after 5       same-file collision avoidance with UI-1
13      ──► doc anytime; build after 6
14      ──► after 6 and 9 desktop pass over stabilized surfaces
15→16, 17→18 ──► last     15/17 interleave with 14's review cycles
```

⚠ migrations total five: #1, #7, #12, #16, #18 — each applied before its
merge, never two pending simultaneously.

## Verification scope decision (owner, 2026-07-30)

PR-B is verified via preview coverage plus the API authorization matrix.
The real-auth E2E rerun is **waived** — `CVF_E2E_*` credentials remain
unprovisioned. Do not describe historical real-auth results as covering
Track 1 changes.

## Status ledger (2026-07-31, review round closed)

Merged and, where ⚠, applied to hosted:

| Item | PR | State |
|------|----|-------|
| PR-A ⚠ attribution schema + v2 RPCs | #8 | merged, applied |
| Audit fix (owner branch minus demo-mode) | #9 | merged |
| PR-B actor-aware guards | #10 | merged (matrix approved) |
| PR-C coach tracker entry points | #11 | merged |
| PR-D′ attribution API field | #12 | merged |
| PR-E ⚠ session conflict protection | #13 | merged, applied |
| UI-4 FAB removal | #14 | merged |
| UI-5 ⌘K client jump | #15 | merged |
| Offline completion design doc | #16 | merged (owner conformance review) |
| Performance-time completion RPC ⚠ | #17 | merged, applied |
| Offline completion frontend | #18 → #20 | merged (rescued via #20) |
| btree_gist → extensions schema ⚠ | #19 | merged, applied |
| Offline-flow e2e port | #21 | merged (owner approved) |
| UI-1 tracker ergonomics + spin-button unclip | #22 | merged (owner approved) |
| UI-2 review surface + bulk history expansion (O(1): five queries incl. the id lookup, was ~201) | #23 | merged after review-hold fix |
| UI-3 date/time picker (held date survives reopen; 44px targets) | #24 | merged after review-hold fix |
| UI-7 progress charts (dates-only marker endpoint; 44px range buttons) | #25 | merged after review-hold fix |
| Calendar week grid (DST-safe day arithmetic) | #26 | merged after review-hold fix |
| Coach-readable exercise history (backend) | #28 | merged (owner approved) |
| Coach history/last-time unhide in tracker | #29 | merged (owner approved) |
| Roadmap doc (this file) | #27 | merged last, ledger final for this round |

Sequenced next: PR-F conflict surfacing in the merged picker + booking
approve (roadmap Track 3 item 9); structured rest ⚠ (unblocked by #22's
merge); UI-6 desktop pass (owner design gate); Goals ⚠ and Availability ⚠
(owner decisions).

Old PR #7 is superseded by #9 and can be closed. PR #3 (Stripe) stays
untouched per the standing deferral.
