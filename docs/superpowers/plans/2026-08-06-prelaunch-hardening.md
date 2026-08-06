# CVF PT Pre-Launch Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the 2026-08-06 five-agent pre-launch review findings in seven phases, each ending at an owner check-in gate.

**Architecture:** Small, surgical fixes to the existing Express service-role backend and React frontend, plus one forward-only Supabase migration per database phase. No new subsystems; every change follows existing repo patterns (pure-helper extraction for testability, Node built-in test runner, migration-content regression tests).

**Tech Stack:** Node/Express, Supabase (service-role, Postgres 17), React 19 + Vite 6, Node `node:test`, Playwright (preview e2e).

## Global Constraints

- Locked invariants in `CLAUDE.md` apply to every task: soft-delete only, waivers append-only, server-side role+ownership on every endpoint, service-role-only backend, payments stay retired.
- Never edit an applied migration. All schema changes are **new forward-only migrations** in `supabase/migrations/`.
- Never import across the `frontend/` ↔ `backend/` deploy boundary.
- Design tokens only in frontend components — no hardcoded hex.
- Functional and docs/visual changes in **separate commits**; keep commits small and scoped.
- Migration-bearing PRs must NOT merge until the owner applies migrations to the hosted database (rule from `docs/hardening/2026-07-22-pr5-hosted-release.md` / `.agentic/PROJECT_POLICY.md`).
- Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Phase/PR structure

- **Phase 1** → branch `claude/prelaunch-phase-1` (Tasks 1–5). Check-in: owner reviews/merges PR, confirms deploy.
- **Phase 2** → branch `claude/prelaunch-phase-2-db-integrity` (Tasks 6–9). Check-in: owner applies the migration to hosted Supabase **before merge**, confirms `supabase migration list --linked` is clean, then merges.
- Phases 3–7 are roadmap (see end of file); each gets its own detailed plan at execution time.

---

## Phase 1 — Stop the bleeding (security + CI)

### Task 1: Escape ILIKE wildcards in the signup invite lookup

`%` and `_` are ILIKE wildcards and legal email characters; the raw `.ilike('email', normalized)` at `backend/src/routes/auth.js:59` lets `j_hn@x.com` claim `john@x.com`'s invite.

**Files:**
- Create: `backend/src/utils/like.js`
- Create: `backend/test/like-escape.test.js`
- Modify: `backend/src/routes/auth.js:59`

**Interfaces:**
- Produces: `escapeLikePattern(value: string): string` — escapes `\`, `%`, `_` with a backslash so an ILIKE match is exact-but-case-insensitive.

- [x] **Step 1: Write the failing test**

```js
// backend/test/like-escape.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { escapeLikePattern } = require('../src/utils/like');

test('escapes ILIKE wildcards so patterns match literally', () => {
  assert.equal(escapeLikePattern('j_hn@x.com'), 'j\\_hn@x.com');
  assert.equal(escapeLikePattern('j%@x.com'), 'j\\%@x.com');
  assert.equal(escapeLikePattern('a\\b@x.com'), 'a\\\\b@x.com');
  assert.equal(escapeLikePattern('plain@x.com'), 'plain@x.com');
  assert.equal(escapeLikePattern(''), '');
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test test/like-escape.test.js`
Expected: FAIL (module not found)

- [x] **Step 3: Write minimal implementation**

```js
// backend/src/utils/like.js
// Escape LIKE/ILIKE wildcards so user-supplied text matches literally.
// `%` and `_` are legal characters in an email local part — an unescaped
// pattern lets one address wildcard-match another's invitation.
function escapeLikePattern(value) {
  return String(value).replace(/[\\%_]/g, '\\$&');
}

module.exports = { escapeLikePattern };
```

- [x] **Step 4: Wire into auth.js**

In `backend/src/routes/auth.js`, add `const { escapeLikePattern } = require('../utils/like');` to the imports, and change line 59 from `.ilike('email', normalized)` to `.ilike('email', escapeLikePattern(normalized))`. (`ilike` is kept — not `.eq` — to stay case-insensitive for any legacy mixed-case rows.)

- [x] **Step 5: Run tests to verify pass**

Run: `cd backend && node --test test/like-escape.test.js && npm test`
Expected: PASS

- [x] **Step 6: Commit**

```bash
git add backend/src/utils/like.js backend/test/like-escape.test.js backend/src/routes/auth.js
git commit -m "fix: escape ILIKE wildcards in signup invite lookup"
```

### Task 2: Waiver signature IP must come from the trusted proxy value

**Files:**
- Modify: `backend/src/routes/waivers.js:15-19`

`clientIp()` currently trusts the caller-controlled leftmost `x-forwarded-for` entry; `app.set('trust proxy', 1)` already makes `req.ip` the correct trusted value on Vercel. The stored IP is a legal-evidentiary field.

- [x] **Step 1: Replace the function**

```js
// req.ip is derived via Express `trust proxy` (set to 1 for Vercel) and
// cannot be overridden by a caller-supplied X-Forwarded-For header —
// signature IPs are an evidentiary field on a legal record.
function clientIp(req) {
  return req.ip || null;
}
```

- [x] **Step 2: Run backend tests**

Run: `cd backend && npm test`
Expected: PASS

- [x] **Step 3: Commit**

```bash
git add backend/src/routes/waivers.js
git commit -m "fix: record waiver signature IP from trusted proxy value only"
```

### Task 3: Validate admin coach reassignment in PUT /api/clients/:id

**Files:**
- Modify: `backend/src/routes/clients.js:92`

`POST /api/clients` and `PATCH /api/admin/clients/:id/reassign` verify the target coach exists and is not archived; the admin branch of `PUT /api/clients/:id` does not.

- [x] **Step 1: Replace line 92 with the checked version**

```js
    if (req.user.role === 'admin' && req.body.coach_id) {
      const { data: targetCoach } = await supabaseAdmin.from('coaches').select('id')
        .eq('id', req.body.coach_id).eq('archived', false).maybeSingle();
      if (!targetCoach) return res.status(404).json({ error: 'Coach not found' });
      updates.coach_id = req.body.coach_id;
    }
```

- [x] **Step 2: Run backend tests**

Run: `cd backend && npm test`
Expected: PASS

- [x] **Step 3: Commit**

```bash
git add backend/src/routes/clients.js
git commit -m "fix: validate target coach on admin client update"
```

### Task 4: Sanitize coach-authored video URLs at render sites

**Files:**
- Create: `frontend/src/lib/safeUrl.js`
- Modify: `frontend/src/pages/client/Programs.jsx:270` (the `exerciseVideo` helper)
- Modify: `frontend/src/pages/coach/Programs.jsx:219`
- Modify: `frontend/src/pages/coach/ClientDetail.jsx:1293-1296`

A `javascript:` URL — typed or arriving via CSV/paste/PDF program import — currently renders as a clickable `href` in the client's session.

**Interfaces:**
- Produces: `safeHttpUrl(url: any): string` — returns the URL when it parses as `http:`/`https:`, else `''` (falsy, so existing `&&` render guards skip the link).

- [x] **Step 1: Create the helper**

```js
// frontend/src/lib/safeUrl.js
// Only http(s) URLs may render as hrefs. Coach-authored video links can
// arrive via CSV/paste/PDF import, so scheme-check before rendering.
export function safeHttpUrl(url) {
  if (!url) return '';
  try {
    const parsed = new URL(String(url));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '';
  } catch {
    return '';
  }
}
```

- [x] **Step 2: Apply at the three render sites**

`client/Programs.jsx` — change the helper on line 270 to:
```js
function exerciseVideo(exercise) { return safeHttpUrl(exercise.video_url || exercise.library_exercise?.video_url); }
```
(add `import { safeHttpUrl } from '@/lib/safeUrl';` — match the file's existing import alias style.)

`coach/Programs.jsx:219` — wrap: `{safeHttpUrl(exercise.video_url) && <a href={safeHttpUrl(exercise.video_url)} ...>Video</a>}`.

`coach/ClientDetail.jsx:1293-1296` — same pattern for `exercise.video_url || exercise.library_exercise?.video_url`.

- [x] **Step 3: Build to verify**

Run: `cd frontend && npm run build`
Expected: build succeeds

- [x] **Step 4: Commit**

```bash
git add frontend/src/lib/safeUrl.js frontend/src/pages/client/Programs.jsx frontend/src/pages/coach/Programs.jsx frontend/src/pages/coach/ClientDetail.jsx
git commit -m "fix: only render http(s) exercise video links"
```

### Task 5: Fix the failing backend CI audit step

**Files:**
- Modify: `backend/package-lock.json` (lockfile-only)

`ip-address <=10.3.0` (via `express-rate-limit`) has a high advisory; CI runs `npm audit --omit=dev` as a hard step and currently exits 1.

- [x] **Step 1: Fix and verify**

Run: `cd backend && npm audit fix && npm audit --omit=dev`
Expected: `found 0 vulnerabilities`

- [x] **Step 2: Full backend suite still green**

Run: `cd backend && npm test`
Expected: PASS

- [x] **Step 3: Commit**

```bash
git add backend/package-lock.json
git commit -m "chore: bump ip-address past audit advisory"
```

**Phase 1 exit:** push branch, open PR. **⏸ OWNER CHECK-IN:** review/merge, confirm both Vercel deploys healthy.

---

## Phase 2 — Database integrity migration set

### Task 6: Forward-only migration `20260806120000_prelaunch_integrity.sql`

**Files:**
- Create: `supabase/migrations/20260806120000_prelaunch_integrity.sql`

Five independent protections in one migration (full SQL in the migration file; summarized here):

1. **Denver-timezone date defaults** — `metric_entries.recorded_on` and `check_ins.check_in_date` currently default to `current_date` (UTC): evening entries land on tomorrow's date.
```sql
alter table public.metric_entries
  alter column recorded_on set default ((now() at time zone 'America/Denver')::date);
alter table public.check_ins
  alter column check_in_date set default ((now() at time zone 'America/Denver')::date);
```
2. **Waiver append-only triggers** (verified: nothing legitimately updates either table — `create_waiver_version` only inserts):
```sql
create or replace function public.prevent_waiver_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Waiver records are append-only';
end;
$$;
create trigger waiver_versions_append_only
  before update or delete on public.waiver_versions
  for each row execute function public.prevent_waiver_mutation();
create trigger waiver_signatures_append_only
  before update or delete on public.waiver_signatures
  for each row execute function public.prevent_waiver_mutation();
```
3. **Duration CHECKs** — zero-duration sessions produce an empty `tstzrange` that evades every conflict protection:
```sql
alter table public.sessions
  add constraint sessions_duration_minutes_check
  check (duration_minutes between 1 and 480) not valid;
alter table public.sessions validate constraint sessions_duration_minutes_check;
alter table public.booking_requests
  add constraint booking_requests_duration_minutes_check
  check (duration_minutes between 1 and 480) not valid;
alter table public.booking_requests validate constraint booking_requests_duration_minutes_check;
```
4. **Client-keyed hot-path indexes**:
```sql
create index if not exists idx_messages_client_created
  on public.messages (client_id, created_at) where archived = false;
create index if not exists idx_booking_requests_client_created
  on public.booking_requests (client_id, created_at desc);
```
5. **Advisory lock in `commit_program_import`** — full `create or replace` of the function body from `20260715005846_honor_import_exercise_choices.sql`, unchanged except one line added immediately after the frequency/day-count validation block:
```sql
  -- Serialize normalized-name lookup/insert so concurrent imports cannot
  -- create duplicate exercise_library rows (same pattern as
  -- create_waiver_version's cvf_pt_waiver_version lock).
  perform pg_advisory_xact_lock(hashtextextended('cvf_exercise_library', 0));
```
Re-issue the existing `revoke`/`grant execute` statements after the function body.

- [x] **Step 1: Write the migration** (content above, function body copied verbatim from `20260715005846` plus the lock line)
- [x] **Step 2: Add migration-content regression test** (Task 8's test file covers this — see below)
- [x] **Step 3: Commit**

```bash
git add supabase/migrations/20260806120000_prelaunch_integrity.sql
git commit -m "feat: pre-launch integrity migration (tz dates, waiver immutability, duration checks, indexes, import lock)"
```

### Task 7: Denver dates + validation in progress routes

**Files:**
- Modify: `backend/src/routes/progress.js:130-164` (entry create), `:167-192` (entry update)

**Interfaces:**
- Consumes: `todayDateInTz` from `backend/src/utils/time.js` (existing, used by checkins/dashboard).

- [x] **Step 1: Import and add a date guard**

Add to imports: `const { todayDateInTz } = require('../utils/time');` and a module-level `const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;`

- [x] **Step 2: Entry create — replace the `recorded_on` handling**

Before the insert:
```js
    if (recorded_on !== undefined && recorded_on !== null && recorded_on !== '' && !DATE_RE.test(String(recorded_on))) {
      return res.status(400).json({ error: 'recorded_on must be a YYYY-MM-DD date' });
    }
```
and in the insert object: `recorded_on: recorded_on || todayDateInTz(),`

- [x] **Step 3: Entry update — same guard**

```js
    if ('recorded_on' in (req.body || {})) {
      const { recorded_on } = req.body;
      if (recorded_on && !DATE_RE.test(String(recorded_on))) {
        return res.status(400).json({ error: 'recorded_on must be a YYYY-MM-DD date' });
      }
      updates.recorded_on = recorded_on || todayDateInTz();
    }
```

- [x] **Step 4: Run backend tests**

Run: `cd backend && npm test`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add backend/src/routes/progress.js
git commit -m "fix: stamp metric entries with Denver-local dates and validate recorded_on"
```

### Task 8: Clamp availability capacity to 1 until group slots ship

**Files:**
- Modify: `backend/src/lib/availability.js:21-24`
- Modify: `backend/test/availability.test.js:42-51`
- Create: `backend/test/prelaunch-integrity.test.js`

Capacity >1 windows are offerable by `get_open_slots` but unbookable (every session row is capacity 1), producing contradictory availability.

- [x] **Step 1: Update the failing tests first**

In `availability.test.js`, extend the capacity assertions:
```js
  assert.equal(validateWindow({ weekday: 1, start_time: '06:00', end_time: '11:00', capacity: 2 }).ok, false);
  assert.equal(validateWindow({ weekday: 1, start_time: '06:00', end_time: '11:00', capacity: 1 }).ok, true);
```

New `prelaunch-integrity.test.js` (migration-content regression, matching the style of `availability.test.js`'s migration assertions):
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(
  path.join(__dirname, '../../supabase/migrations/20260806120000_prelaunch_integrity.sql'),
  'utf8'
);

test('metric/check-in date defaults are Denver-local', () => {
  assert.match(migration, /metric_entries[\s\S]*?at time zone 'America\/Denver'/);
  assert.match(migration, /check_ins[\s\S]*?at time zone 'America\/Denver'/);
});

test('waiver tables get append-only triggers', () => {
  assert.match(migration, /before update or delete on public\.waiver_versions/);
  assert.match(migration, /before update or delete on public\.waiver_signatures/);
  assert.match(migration, /Waiver records are append-only/);
});

test('session durations are bounded so ranges can never be empty', () => {
  assert.match(migration, /sessions_duration_minutes_check[\s\S]*?between 1 and 480/);
  assert.match(migration, /booking_requests_duration_minutes_check[\s\S]*?between 1 and 480/);
});

test('client-keyed hot paths are indexed', () => {
  assert.match(migration, /idx_messages_client_created/);
  assert.match(migration, /idx_booking_requests_client_created/);
});

test('program import serializes exercise creation', () => {
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\('cvf_exercise_library', 0\)\)/);
});
```

- [x] **Step 2: Run to verify the capacity test fails**

Run: `cd backend && node --test test/availability.test.js`
Expected: FAIL (capacity 2 currently ok)

- [x] **Step 3: Clamp in validateWindow**

Replace lines 21–24 of `backend/src/lib/availability.js`:
```js
  const capacity = row.capacity === undefined || row.capacity === null ? 1 : Number(row.capacity);
  // Group slots are deferred (A8): sessions are all capacity-1, so a >1
  // window would be offerable by get_open_slots but never bookable.
  if (capacity !== 1) {
    return { ok: false, error: 'Group capacity is not available yet — capacity must be 1' };
  }
```

- [x] **Step 4: Run backend tests**

Run: `cd backend && npm test`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add backend/src/lib/availability.js backend/test/availability.test.js backend/test/prelaunch-integrity.test.js
git commit -m "fix: clamp availability capacity to bookable value, add integrity migration tests"
```

### Task 9: Phase 2 PR

- [x] **Step 1:** Push branch, open PR titled "Pre-launch DB integrity (DO NOT MERGE until migration applied)" with the owner's migration-first steps in the body.

**Phase 2 exit / ⏸ OWNER CHECK-IN:** apply `20260806120000_prelaunch_integrity.sql` to hosted Supabase via `supabase db push` (or CLI equivalent), verify `supabase migration list --linked` shows no drift, then merge.

---

## Roadmap — Phases 3–7 (detailed plans written at each phase's start)

### Phase 3 — Account recovery + invite email
Forgot-password endpoint + reset page (Supabase `resetPasswordForEmail`), change-password in account menu, coach/admin-triggered reset for locked-out clients, real invite email via existing Resend service, fix claimed-client profile/auth email divergence.
**⏸ Check-in:** owner sets/verifies `RESEND_API_KEY`, `NOTIFY_REPLY_TO`, `FRONTEND_URL`, `CRON_SECRET` in Vercel + Supabase auth email settings; approves email copy; runs one real invite→claim→reset round-trip.

### Phase 4 — Silent sessions + doc truth
Email + in-app signal on coach session create and reschedule; next-24h sessions in the daily digest; correct `docs/product-overview.md` (stale "Automated email" exclusion, missing shipped features) and `docs/email-notifications-design.md` (denies the reschedule flow exists).
**⏸ Check-in:** owner verifies the new emails with a test client; signs off docs.

### Phase 5 — Observability + deploy safety
Sentry (backend + `AppErrorBoundary`, `beforeSend` scrubbing), `helmet` + `vercel.json` security headers, global JSON 404/error middleware, outbound timeouts (Supabase fetch wrapper + axios), complete `backend/.env.example` + DEPLOYMENT.md env tables, startup warning when email unconfigured in production, fail-fast on missing Supabase secrets, CI guard failing PRs that touch `supabase/migrations/` without explicit acknowledgment.
**⏸ Check-in (owner dashboard session):** create Sentry + UptimeRobot accounts, set env vars/monitors, confirm Supabase backup tier, enable PITR/Pro backups, one test restore, enable branch protection. **Launch-ready after this phase.**

### Phase 6 — Frontend correctness + performance
AuthContext network-vs-401 distinction; Messages polling visibility gating + toast dedupe; outbox `flush()` returns in-flight promise; `toggleSet` load normalization; ClientDetail `?tab=` controlled tabs; double-tap guards (booking approve, session complete/cancel); CSV input reset + busy state; AssignDialog partial-failure refetch; route-level code splitting (lazy coach/admin trees, lazy chart module, dynamic-import preview fixtures); drop unused `@tanstack/react-query`; a11y fixes (RatingField semantics/44px targets, icon-button labels, deep-link-safe back button).
**⏸ Check-in:** owner does a hands-on phone pass (fresh PWA install, workout on bad Wi-Fi, messaging, booking) and receives the Phase 7 decision menu.

### Phase 7 — Product fast-follows (scope set by owner's Phase 6 decisions)
Client cancel/withdraw + cancellation-policy text; `no_show` session status; coach lifecycle (deactivate/edit/reset); ICS "Add to calendar"; optimistic message send; durable rate-limit store (Upstash); reconfirm My PT Hub manual re-entry vs importer.
**⏸ Check-in:** final review + the DEPLOYMENT.md launch condition (separate Production Supabase project once the real domain exists).
