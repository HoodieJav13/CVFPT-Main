# Whole week — local implementation notes (2026-10-29)

**Status: local candidate only.** Authored under the 2026-10-30T00:15:39Z
approval ("Approve all seven builds") in an isolated candidate checkout. Tests
were written, not run, by the authoring session; the native executor owns
RED/GREEN runs and independent review. No hosted migration, push, deployment,
provider call or real client data. Workout Rescue, Program History, attempt
cues and the assigned-card acceptance remain unaccepted candidate features;
this change neither depends on them nor claims they are live.

## What it adds

A phone-first **Whole week** view (Mon–Sun, America/Denver dates) that puts
together, for one client:

1. **Outside activity ledger (new domain).** Optional sport practice, game,
   run, hike, extra training or other. Type and date are required; label
   (≤80), duration (1–86400 s), effort (RPE 1–10) and note (≤1000) are
   optional, and unknown values stay `NULL` — never 0. Soft archive only,
   revision per row, immutable creator metadata, per-actor request receipts.
2. **PT workouts** completed that week (existing `workout_logs`, bucketed by
   Denver completion day), counted separately from outside activity.
3. **Compact existing context**, read-only, from the existing
   `/check-ins/*` and `/progress/*` APIs: days checked in, latest answers with
   per-field "Not answered", and up to four goals with latest value and goal.
   No second check-in or goal system. Existing check-in/goal writers are
   untouched.

Entry points: a quiet "Whole week" link card on client Home
(`/client/week`) and on coach ClientDetail → Overview
(`/coach/clients/:id/week`). Neither entry makes a request, Start/Resume,
Mark done, the daily check-in card and all other Home/ClientDetail actions
are unchanged. No new top-level navigation tab.

## Data model — `supabase/migrations/20261030002155_whole_week_outside_activity.sql`

| Object | Notes |
|---|---|
| `outside_activities` | Domain checks mirror the API. One BEFORE trigger owns `revision` (every writer, guarded or direct, increments it), forbids DELETE, freezes `id/client_id/created_by_*/created_at`, makes archived rows read-only and stamps `archived_at`. |
| `outside_activity_receipts` | PK `(actor_auth_user_id, request_id)`; `action`, `client_id`, `activity_id`, SHA-256 of the server-normalized request, `committed_revision`. No note/body snapshot. Append-only trigger. Not shared with any other domain's receipts. |
| `client_context_preferences` | One row per client: `activity_coach_enabled`, `activity_client_off`, `checkin_prompt_coach_enabled`, `checkin_prompt_client_off`, revision, last updater. Missing row = collection off and reminder hidden. |
| `authorize_whole_week` | Resolves the current actor from the verified auth id each call: active coach (admin, or current owner) first, else the client whose `auth_user_id` equals it. Nullable `auth_user_id` is never equated with `clients.id`. Locks the client row FOR SHARE before the actor row FOR SHARE, so reassignment/auth-link changes and role changes serialize with the authorized read. |
| `read_whole_week` | Authorized read of one week and PT counts in one RPC transaction; never inserts. Totals cover all rows. Pages contain at most100 rows in `(occurred_on,id)` order, with a strict client/week-bound cursor and `next_cursor`; each page re-authorizes current ownership. Concurrent edits are live history, not a frozen snapshot. |
| `mutate_outside_activity` | create/update/archive. Validate → lock the client row `FOR UPDATE` (the same row reassignment, archive and auth-link updates write) → re-authorize → request advisory lock → receipt replay → gates → write → receipt. Identical replay returns the receipt's `committed_revision` beside the latest authorized row; a changed body/action/resource under the same id is `409 request_mismatch`. Stale revision `409 revision_conflict`; archived `409 archived`; collection off `409 collection_off` (for coach-on-behalf too). |
| `save_context_preferences` | Revision-guarded, role-separated bits (clients: `*_client_off`; coach/admin: `*_coach_enabled`), no receipt. |

RLS is enabled with no policies; anon/authenticated have no table or EXECUTE
privilege; PUBLIC EXECUTE is revoked; service role gets SELECT/INSERT/UPDATE on
the two mutable tables and SELECT/INSERT on receipts; every function is
`SECURITY INVOKER` with `search_path=''`.

## API (`backend/src/routes/wholeWeek.js`)

| Route | Who |
|---|---|
| `GET /api/whole-week/capability` | any signed-in user; `{feature:'whole_week', contract:1, outside_activity_writes:'guarded'}` |
| `GET /api/whole-week/mine?week_start=YYYY-MM-DD` | client (own linked profile) |
| `GET /api/whole-week/clients/:clientId?week_start=` | coach/admin |
| `POST /api/outside-activities/mine` · `POST …/clients/:clientId` | client · coach/admin (on behalf) |
| `PATCH /api/outside-activities/:id` · `PATCH …/:id/archive` | client self, current coach, admin |
| `PATCH /api/context-preferences/mine` · `…/clients/:clientId` | client bits · coach bits |

Strict allowlists (unknown keys, forged actor/owner fields → 400), strict
calendar dates, Denver future-date refusal, 16 KiB body cap, 120 writes / 15 min
per user. Corrections may send a partial field set: omitted values stay unchanged; explicit null clears an optional field. The normalized request hash preserves that property mask, so a retry is independent of later row contents. `week_start` must be a past/current Monday; omitted = this Denver week.
PT completions are read inside the authorized RPC using Denver wall-clock instant ranges (167 h / 169 h on DST weeks). Optional `cursor` is a serialized object with exactly `client_id`, `week_start`, `occurred_on` and `id`; dates, UUID and scope are validated at both API and SQL boundaries.
A failed PT-workout read is reported as `pt_workouts.status: "unavailable"`
next to the ledger; a failed ledger read is an error, never an empty week.

## Browser behavior

* **Explicit week:** chosen once and kept in `?week=`; it does not move at
  Denver midnight or DST. Stored day strings render as calendar days, never
  shifted by the device timezone.
* **Network-required guarded saves** (`frontend/src/lib/contextEntry.js`):
  capability is probed before every send/retry. The frozen request body lives
  only in memory. Local storage receives only a content-free `1` interruption
  marker scoped to profile/client, never type/date/duration/effort/notes/body.
  Lost response/5xx/timeout or a malformed/mismatched success stays **Saved
  status unknown**. Retry sends the exact same ID/body while the page remains
  open; creation and edits wait. A matching request ID, committed revision and
  authoritative resource shape are required before success. Authorization
  denial clears private state. Reload loses the body, warns and requires a
  fresh authorized history read plus explicit history-check acknowledgment
  before a replacement can be entered; no automatic resend or persistent draft
  recovery. There is no unresolved-save discard shortcut. Revision conflicts
  require explicit latest-version reload. Older replay receipts never replace
  newer rows. Preference responses are validated before claiming saved;
  ambiguous outcomes refetch current settings without attributing a save.
* **Paging:** Load more appends deduplicated rows only for the original current
  client/week/generation. Week change, refresh and corrections reset pages;
  authorization errors clear the ledger. Whole-week totals remain independent
  of page size. Copy explains that entries can change and refresh updates the
  list. SQL proves215 same-date rows; browser proof reaches and edits row201
  in208 rows, rejects delayed old-week responses and clears on access loss.
* **Copy:** totals read "Logged 1 h 30 min across 3 activities; 1 has unknown
  duration." Empty is "No outside activities logged this week." Days with
  nothing and available PT history say "Nothing logged"; unavailable PT history
  is named explicitly — never rest, ready, recovered, zero effort,
  risk or a score. No program, Rescue, cue, workout or check-in is written
  from this view (the optional reminder opens the existing manual check-in
  form and its unchanged route).
* **Visibility:** "Shared with <coach> (assigned coach) and CVF admins." /
  "Visible to the client, <coach> (assigned coach) and CVF admins."; each
  activity shows who logged it.
* **Preferences:** collapsed "Sharing settings". Coach turns collection and
  the reminder on; the client can opt out (even before the coach enables it)
  and reverse only its own choice. Opt-out keeps earlier shared records visible
  and correctable. Manual check-ins on Today stay available regardless.

## Preview

`frontend/src/lib/previewWholeWeek.js` adds separate fictional scenario data:
David (collection on, partial week with one unknown duration, one coach-logged
hike, one prior-week entry) and Emily (opted out after one shared entry).
Sarah's fixtures are unchanged; she shows the default-off state. All six save
routes are in `PREVIEW_SAVE_ROUTES`. Review switches (cleared by Reset):
`cvf_preview_whole_week_lose_next_response=1` (commit, then lose the response)
and `cvf_preview_whole_week_capability=missing` (older backend). Preview proves
UI only.

## Verification by the native executor

The external author wrote tests but did not execute them. Native execution
proved backend747/747, frontend310/310, production build, all seven SQL groups
on the complete54-migration chain in both PGlite and native PostgreSQL17,
23 native behavior checks, six committed write races, the ownership read race,
and five independently authored committed races. Eighteen focused fixture browser cases pass. Final full-suite result and exact source identity are in
the execution evidence report. No hosted auth tests ran.

Independent red-to-green regressions cover the ownership-read disclosure,
private browser persistence, invalid success responses, inherited nested goal
read failure and missing pagination. Implementation was authored before most
tests; this is not a claim of a fully TDD-authored feature.

| File | Kind |
|---|---|
| `backend/test/whole-week-routes.test.js` | real Express HTTP with a recording fake DB: refusals before any DB call, exact RPC arguments, auth id vs client id, DST week ranges, partial/unavailable reads, replay status, error/hint mapping, role-separated preferences |
| `backend/test/whole-week-lib.test.js` | strict dates, DST week math, summary, Denver bucketing, normalization, **parity with the browser copy** |
| `backend/test/whole-week-mounted.test.js` | real `app.js` mounts the routers behind auth; unknown routes still 404 |
| `frontend/tests/unit/contextEntry*.test.mjs` | capability gate, memory-only exact retry, content-free storage, reload limitation, malformed/mismatched response, preference validation, denial and replay ordering |
| `frontend/tests/unit/outsideActivities.test.mjs` | no TZ shift (run under Pacific/Kiritimati), stable week across Denver midnight, blank = unknown, exact stored duration kept, copy never implies rest/score |
| `supabase/tests/whole_week/0[1-7]_*.sql` + `pglite-check.mjs` | real SQL behavior/authorization/grants (single connection, standalone schema or `--full`) |
| `supabase/tests/whole_week/concurrency.sh` | five committed two-connection races on a throwaway local cluster |
| `frontend/e2e/whole-week-preview.spec.mjs` | preview browser suite via `preview-test.mjs` (missing-mock / unlisted-save / mutating-read guards) |

## Scope decisions and gates

* Task 3 performance protocols and Task 2 check-in hardening are **not**
  implemented; legacy check-in/goal writes are untouched (read-only context).
  The known legacy `CheckInForm` UTC default date remains; the whole-week
  reminder passes the Denver date explicitly.
* Outside activity is a brand-new domain with no legacy writer, so it starts
  in strict guarded mode; the plan's 428 cutover applies to future check-in /
  progress hardening, not here.
* Hosted Development/Production migration, CI, PR, merge, deployment, owner
  visual review (local paired before/after captures supplied) and real-device checks remain
  separate gates. Merging a migration-bearing PR auto-deploys both roots.

## Review evidence and execution boundaries

Actual-source captures at320/390/1440 pair baseline Today/coach Overview
against their new entry points, with additional client/coach whole-week and
form views. See `visual/index.html` and its hash manifest. The new route has no
prior equivalent. These are headless fictional fixtures, with external
network blocked; they do not certify device, hosted auth or owner acceptance.

The initial distinct first-party Claude Opus5.5 Max session completed. Its
restricted-cwd guard denied one mistaken outside-candidate Write; no file was
created. Automatic approval review denied a later same-session repair resume
because it did not recognize exact payload/destination authorization. That
resume did not execute and was not retried. Repairs and verification proceeded
locally under the approved native execution scope.

Fresh independent review also reproduced and repaired cached private content after definitive save denial (403/404) and loss of the frozen request after an uncertain retry receives a pre-RPC refusal. The same purge helper now handles read, paging, activity saves, preference saves and check-in access loss. Uncertain retry400/413/422/429 remains unknown; a fresh refusal remains editable. Exact red/green evidence is in the execution report.

Reply-side state changes use a dedicated access epoch and actor/client/week ticket, independent of read refresh sequencing. Revocation clears all private views and invalidates concurrent activity, settings and check-in responses; changing scope resets transient controls while preserving an already frozen operation. Unmount invalidates late callbacks. Post-capability fencing prevents a revoked request from being stored or sent. The reachable concurrent preference403→late activity transport failure is browser RED→GREEN; two helper units cover revocation before dispatch and after an in-flight response.
