# Surface QA audit — pre-launch checklist

A per-surface pass for catching completeness and correctness gaps in shipped
UI. This is **not** a visual-direction review (that's governed by
`design-principles.md`); every item here is a defect-or-fine judgment —
missing states, broken affordances, inconsistency with our own conventions.

How to run it:

- One surface at a time, on the device class that matters most for that role:
  clients phone-first (390 × 844), coaches desktop + phone.
- Use preview mode or the demo link so states are reproducible; use real auth
  for the flows preview can't fake (password reset, waiver, push).
- Annotate findings with Agentation (toolbar in dev/preview builds) so each
  lands as an exact selector, or note surface + item ID (e.g. `C-SES-4`).
- Anything ambiguous ("is this a defect or a decision?") goes to the owner —
  the checklist never overrides the design gate.

Legend: `[ ]` unchecked · `[x]` pass · `[!]` finding (link or note beside it).

---

## F. Foundations — apply to every surface

Check once per surface while doing its specific section.

- [ ] **F-1 Tokens only** — no raw hex/emerald/`gray-*` colors; everything
  routes through `--primary`, `--gold`, `--success`, `--destructive`, and the
  neutral scale (`bg-card`, `border-border`, `text-muted-foreground`).
- [ ] **F-2 Touch targets** — every tappable control is ≥ 44 px (`min-h-11` /
  `h-11`); no icon buttons smaller than `h-11 w-11` on mobile surfaces.
- [ ] **F-3 Focus visible** — keyboard focus shows the ring
  (`focus-visible:ring-2 ring-ring`) on links, buttons, rows, chips; tab
  order follows visual order; nothing traps focus.
- [ ] **F-4 Loading → error → empty** — the surface has all three: skeleton
  while loading, `LoadErrorState` with a working Retry on failure, and an
  intentional `EmptyState` (icon + line + next step) when there's no data —
  never a blank region or endless skeleton.
- [ ] **F-5 Text overflow** — long client names, workout names, locations,
  and notes truncate or wrap deliberately (`truncate` / `min-w-0` on flex
  children); nothing pushes controls off-screen at 390 px.
- [ ] **F-6 Times and numbers** — all times render in the app's Denver
  convention, numbers align with `tabular-nums`, and relative times ("2h
  ago") appear only where freshness matters.
- [ ] **F-7 Motion respect** — `prefers-reduced-motion` disables every
  nonessential animation on the surface; no information is conveyed by
  motion alone.
- [ ] **F-8 Toast discipline** — every mutation gives success/failure
  feedback exactly once; no double toasts; errors name the problem, not
  "something went wrong" (except true 500s).
- [ ] **F-9 Destructive friction** — destructive or irreversible actions
  (cancel session, abandon workout, archive) require the two-tap confirm or
  a dialog, styled `destructive`, never one accidental tap.
- [ ] **F-10 Dark surface legibility** — contrast holds on the dark cards
  and the gradient poster cards; muted text stays ≥ AA against its actual
  background, including on `bg-gold/5` and `bg-primary/10` tints.

---

## P. Public / auth surfaces

**Login** (`/login`)
- [ ] P-LOG-1 Password manager autofill works (proper `autocomplete`
  attributes; no fighting the browser).
- [ ] P-LOG-2 Wrong-credential error is specific, non-enumerating, and
  clears on retype.
- [ ] P-LOG-3 "Forgot password" is findable without hunting.
- [ ] P-LOG-4 Enter submits from either field; button shows a busy state.

**Signup / invite claim** (`/signup`)
- [ ] P-SIG-1 Arriving without a valid invite explains the invite-only model
  instead of dead-ending.
- [ ] P-SIG-2 Password rules are stated before failure, not after.

**Forgot / reset password**
- [ ] P-RES-1 Request flow confirms without account enumeration.
- [ ] P-RES-2 Expired/used reset links get a clear recovery path.

---

## C. Client surfaces (phone-first)

**Home** (`/client`)
- [ ] C-HOM-1 Every card answers "what do I do next" — check-in, today's
  workout, next session all have a working primary action.
- [ ] C-HOM-2 The week strip and streak read correctly with zero history
  (new client) and after a missed week (morale-safe copy).
- [ ] C-HOM-3 One-time choreography plays once, never on every navigation.

**Sessions** (`/client/sessions`)
- [ ] C-SES-1 Upcoming and past rows both open the detail page; whole-row
  tap target, not just the text.
- [ ] C-SES-2 Pending booking requests show withdraw with two-tap confirm.
- [ ] C-SES-3 Cancel vs ask-to-cancel appears correctly around the 24 h
  cutoff; "Asked" state survives reload.
- [ ] C-SES-4 Cancellation policy is reachable but not shouting.
- [ ] C-SES-5 Request drawer: slot picker when the coach published hours,
  free picker with explanatory copy otherwise; the submit label matches the
  actual outcome (instant book vs request).

**Session detail** (`/client/sessions/:id`)
- [ ] C-SDT-1 Plan card matches what the coach attached; empty-plan copy is
  reassuring, not apologetic.
- [ ] C-SDT-2 Add-to-calendar downloads a valid .ics on iOS Safari.
- [ ] C-SDT-3 Status changes (completed, cancelled, no-show) render sensibly
  when the client revisits an old link.

**Programs & tracker** (`/client/programs`, `/client/workouts/:id/track`)
- [ ] C-PRG-1 Start vs quick-complete ("I did it") are visually distinct and
  both reachable in one tap from the assigned day.
- [ ] C-TRK-1 Set entry works one-handed at 390 px; number inputs bring up
  numeric keyboards.
- [ ] C-TRK-2 Rest timer is visible while scrolled anywhere in the list, and
  stops with one tap.
- [ ] C-TRK-3 Offline: completing sets and finishing queue cleanly, the
  save-state chip tells the truth, and reconnect syncs without duplicating.
- [ ] C-TRK-4 Exercise history disclosure loads, paginates, and retries
  inline without disturbing entry.
- [ ] C-TRK-5 Abandon is possible but guarded; finish dialog summarizes
  skipped sets honestly.

**Progress** (`/client/progress`)
- [ ] C-PRO-1 Charts render with 0, 1, and many data points (no broken axes
  on single-entry metrics).
- [ ] C-PRO-2 Chart drawing is keyed to data changes, not remounts.
- [ ] C-PRO-3 PR celebration triggers only on a genuine
  direction-aware improvement.

**Resources / Messages / Waiver**
- [ ] C-RES-1 Download produces the PDF within the signed-URL window;
  failure has retry copy.
- [ ] C-MSG-1 Unread markers clear when read; coach messages-paused state
  explains itself.
- [ ] C-WVR-1 Unsigned-waiver nudge appears where intended and nowhere else.

---

## H. Coach surfaces (desktop + phone)

**Dashboard** (`/coach`)
- [ ] H-DSH-1 Every stat tile and signal row navigates somewhere useful.
- [ ] H-DSH-2 Stale-session nudges complete/review correctly from the row.
- [ ] H-DSH-3 Degraded state (signals fail, sessions load) keeps the page
  usable and says what's missing.

**Sessions** (`/coach/sessions`)
- [ ] H-SES-1 Filters (Upcoming/Today/Past/Cancelled) each contain exactly
  what they claim — including no-shows in Past.
- [ ] H-SES-2 Live chips: "In the gym now" while a linked log is active,
  "Workout done" + surfaced Complete when finished; chip never shows on
  non-scheduled rows.
- [ ] H-SES-3 Row click opens detail; dropdown still carries every action;
  the two never fight (mis-taps on mobile).
- [ ] H-SES-4 Booking banner: approve/decline with per-row conflict reasons
  that persist until resolved.
- [ ] H-SES-5 Editor drawer: conflict panel appears on 409, clears when the
  relevant field changes, and location-overlap warnings don't block saving.

**Session detail** (`/coach/sessions/:id`)
- [ ] H-SDT-1 Complete hidden for future days; No-show only after start
  time; Cancel two-tap; all server guards mirrored, none contradicted.
- [ ] H-SDT-2 Linked workout activity opens the right log; quick-completed
  is labeled "not tracked".
- [ ] H-SDT-3 Notes dialog round-trips share/private state; shared notes
  appear on the client side promptly.

**Clients & client detail**
- [ ] H-CLI-1 Archive is reversible-feeling (soft-delete), never adjacent to
  a primary action.
- [ ] H-CLD-1 Every tab (overview, programs, progress, sessions, resources)
  has its own loading/error/empty triplet — no tab assumes another loaded.
- [ ] H-CLD-2 "Log workout" with session context lands with the session
  preselected.

**Calendar / studio view**
- [ ] H-CAL-1 Masked colleague sessions show as busy blocks with no client
  identity leakage in DOM or tooltip.
- [ ] H-CAL-2 Week navigation is keyboard-reachable; today is visually
  anchored.

**Training builder** (`/coach/programs`)
- [ ] H-BLD-1 Import review: parse errors are per-field and recoverable;
  nothing loses typed work on a failed parse.
- [ ] H-BLD-2 Long exercise names and 5-day programs stay usable at tablet
  width.
- [ ] H-BLD-3 PDF export brand colors match the app tokens (manual-sync rule
  in CLAUDE.md).

**Notifications** (`/coach/notifications`)
- [ ] H-NOT-1 Every row navigates to its subject (log or session); read
  state updates on open and on "mark all".
- [ ] H-NOT-2 Started/completed pairs never both appear unread for the same
  log.

**Analytics / Admin**
- [ ] H-ANL-1 Empty ranges and single-client datasets render without
  divide-by-zero artifacts.
- [ ] H-ADM-1 Admin-only controls are absent (not just disabled) for
  non-admin coaches.

---

## X. Cross-cutting flows

- [ ] X-1 **Push round-trip** — with VAPID keys set: subscribe on one
  device, trigger each 011 signal, verify the notification deep-link lands
  on the right surface (session detail for cancel requests).
- [ ] X-2 **Role boundaries** — a client pasting coach URLs (and vice versa)
  gets redirected, never a broken shell.
- [ ] X-3 **Session lifecycle end-to-end** — book → approve → attach plan →
  client starts (chip) → finishes (chip + confirm) → coach completes → Past,
  with the client's view consistent at every step.
- [ ] X-4 **Stale-tab behavior** — a tab left open overnight recovers on
  focus (auth refresh, data reload) instead of silently failing.
- [ ] X-5 **iOS PWA install** — installed-to-home-screen: safe-area insets
  respected, no double status bar, push still delivered.

---

## Findings log

Record findings as you go; triage after the pass, fix in scoped commits.

### 2026-08-11 first pass (agent)

Method: code sweeps for the grep-able foundations (F-1/F-2/F-3, autocomplete,
input modes), a preview-mode browser walk of every client surface at 375 px
and every coach surface at desktop width with console-error harvesting, plus
the standing e2e record for loading/error/empty, reduced motion, and offline
behavior. Items that need a real device or live credentials were left for
the owner phone pass: C-SDT-2 (iOS .ics), X-1 (push round-trip), X-5 (PWA
install), and the P-RES real-email flows.

| ID | Item | Surface | Severity (defect / polish) | Status |
|----|------|---------|---------------------------|--------|
| AUD-1 | F-foundations | Client Home check-in card | defect | fixed — Badge (a div) rendered inside a `<p>`; invalid DOM nesting flagged by React ([Home.jsx](../frontend/src/pages/client/Home.jsx)) |
| AUD-2 | P-LOG-1 / P-SIG / P-RES | All four auth forms | defect | fixed — no `autoComplete` attributes anywhere; password managers now get `email` / `current-password` / `new-password` |
| AUD-3 | F-2 | Admin coach menu; coach Resources edit/archive | defect | fixed — three 36 px icon buttons raised to the 44 px convention |
| AUD-4 | Tooling | Agentation overlay (dev/preview) | defect | fixed — default placement covered the mobile tab bar and collided with the preview toolbar on desktop; offset via scoped CSS |
| AUD-5 | Dev ergonomics | vite config | polish | fixed — hardcoded `hmr.clientPort: 443` (cloud-IDE leftover) broke local HMR and logged websocket errors on every page; now env-gated behind `CVF_DEV_TUNNEL` |
| AUD-6 | F-1 | Poster cards (client/coach session detail, client sessions row) | polish | deferred — inline `hsl(202 35% …)` gradient literals in three files; token-derived but not tokens. Candidate for a `--poster-gradient` token; cosmetic-neutral refactor |
| AUD-7 | C-TRK-5 | Tracker abandon | polish | deferred — uses `window.confirm` rather than the app's two-tap/dialog pattern; functional and accessible, just off-pattern |

Everything else checked in this pass rendered correctly: session lifecycle
chips and detail pages on both roles, cancel/ask-to-cancel around the 24 h
cutoff, booking approve/decline with conflict notes, calendar masking,
progress charts with PR badge and goal line, and role-boundary redirects.

### 2026-08-12 second pass (impeccable plugin, fresh headless session)

Report-only run over the seven core surfaces + token system; findings
verified against source before fixing. 23 items: 4 P1, 9 P2, 10 P3.

| ID | Finding | Status |
|----|---------|--------|
| IMP-1 | Rest-complete FAB ink was the `--success-foreground` tint on solid `--success` — measured 2.01:1; now dark ink at 7.16:1 | fixed |
| IMP-2 | Coach row-menu "Cancel session" was one-tap destructive; now confirms in a dialog like every other surface | fixed |
| IMP-3 | 44 px touch-target rule violated as a pattern (~20 call sites at 32–40 px across client surfaces + tracker inputs) | fixed |
| IMP-4 | Row-menu "Mark complete" offered future-day completion the server refuses; now guarded like the detail page | fixed |
| IMP-5 | Signed-in users saw a login-screen flash before redirect | fixed |
| IMP-6 | Login errors styled in brand primary instead of destructive | fixed |
| IMP-7 | Prescribed load existed only as an input placeholder; now printed in the prescription chips | fixed |
| IMP-8 | ~14 buttons lost their accessible name while showing a spinner | fixed |
| IMP-9 | Form-primitive focus ring was 1 px against the project's 2 px spec | fixed |
| IMP-10 | Client `isPast` omitted `no_show` — roles disagreed about the same session | fixed |
| IMP-11 | Rest timer re-rendered the whole tracker 4×/sec; tick now isolated in a `RestTimerFab` component | fixed |
| IMP-12 | Dead `todayCheckIn` conditionals in Home's falsy-branch card | fixed |
| IMP-13 | Ask-to-cancel confirmation dropped focus and never announced; now a focusable `role="status"` | fixed |
| IMP-14 | Active linked workout log rendered the "Pending" badge; now "In progress" | fixed |
| IMP-15 | Coach filter chips signaled selection by color alone; `aria-pressed` added | fixed |
| IMP-16 | Save-state live region wrapped the rest-alerts toggle; toggle moved out | fixed |
| IMP-17 | `role="status"` + `aria-live="assertive"` conflict on the rest announcement | fixed |
| IMP-18 | Past list bare-`<p>` empty state; now the shared `EmptyState` | fixed |
| IMP-19 | Stray empty flex child in Home's dominant card | fixed |
| IMP-20 | index.css hygiene: fourth hardcoded gold, three color duplicates, five dead tokens, render-blocking font `@import` | deferred — dedicated token/visual-diff PR with AUD-6 |

AUD-7 (`window.confirm` abandon) remains open as previously triaged.
