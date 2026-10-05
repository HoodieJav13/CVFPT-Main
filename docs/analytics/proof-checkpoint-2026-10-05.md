# PostHog proof checkpoint — 2026-10-05

Implementation commit: `b60ab1e3eb7f5a64f1cb07d9323e7b5f728b661c`, isolated
branch `codex/posthog-coach-first-slice`, based on verified remote main
`3886fef15db67b1177a0d4cf468fd8d654d42b3e`. No push, merge or deployment.
Production collection remains hard-disabled. No real backend, DB or account data
was used in the app tests; no notification was sent.

## Implemented and tested

Allowlisted coach screen views, create/edit/series outcomes and workout
attachment/removal outcomes. API errors contribute only numeric status; exception
messages/types/fingerprints are constructed from fixed enums. Transport failure
cannot change app save behavior. No broad autocapture or replay SDK in the app.

Checks completed: unit 62/62; analytics browser 5/5; preview browser 77 passed,
8 existing live-auth skips; series browser 19/19; production Vite build;
actual compiled runtime production-off check; frontend boundary guard;
Git diff whitespace and CI YAML parse. No code changed after those checks.

## Exact fictional event run

The fixture browser performed actual coach navigation, create with attachment,
edit with removal, a second create with an injected 503, and retry. One browser
run, nine packets, zero external requests, zero uncaught application errors.
Every event has the constant common fields documented in the first-slice guide.

| # | Event | Coarse properties |
| --- | --- | --- |
| 1 | `cvfpt_coach_screen_viewed` | `screen=home` |
| 2 | `cvfpt_coach_screen_viewed` | `screen=sessions` |
| 3 | `cvfpt_coach_session_save` | `create, success, attached, none` |
| 4 | `cvfpt_coach_screen_viewed` | `screen=session_detail` |
| 5 | `cvfpt_coach_session_save` | `update, success, removed, none` |
| 6 | `cvfpt_coach_screen_viewed` | `screen=sessions` |
| 7 | `cvfpt_coach_session_save` | `create, unconfirmed, attached, server` |
| 8 | `$exception` | `operation=create, source=action, failure_kind=server`; constructed exception list/fingerprint/level |
| 9 | `cvfpt_coach_session_save` | `create, success, attached, none` |

Canonical compact JSON SHA-256:
`4c74b1fdd0d85a79561d6bccf537d3a4dc35ae8efa352f7d4f0b12434e781e9e`.
Inspected payloads contain no fictional names, IDs, notes, health text, URLs or
secrets. A one-shot sender independently reconstructs every payload, checks the
hash/count, journals attempts, and refuses any second execution. HTTP uncertainty
requires read-only verification; it must never cause a resend.

The existing public ingestion token was read through the connector and is held
only in ephemeral memory. The settings UI displayed it automatically; no token
was copied to disk/repository/environment, and no credential was created. The
provider UI confirms Default project 509463, US Cloud, free plan, zero current
product-event/error/web-replay usage before any test. Project IP discard is off.

**Hosted proof is pending approval to enable Discard client IP data.** The current
SDK source warns the legacy `ip` configuration has no effect; `$ip:null` is not
accepted as proof of receiver-side IP storage prevention. No capture request has
been sent. No provider setting has changed. After approval: verify discard on,
send only the inspected nine packets once to `https://us.i.posthog.com/i/v0/e/`,
verify received full properties and exception grouping, then clear ephemeral key
state. All application collection remains off.

## Actual local recorder outcome: fail, no cloud replay

Only the temporary harness uses pinned `posthog-js@1.436.1` and `rrweb@2.1.7`.
The app dependency/lock files were not changed. All external requests were
blocked. Initialization was opted out with replay disabled. Explicit local
start produced real SDK snapshots. Full compressed snapshots and mutation fields
were decompressed before inspection, rather than checking compressed bytes.

With the original fail-closed `before_send`, nothing is emitted. Allowing only
`$snapshot` in the local harness exposed further behavior: headless UA filtering
must be disabled for this test; dropping all replay URLs also removes rrweb Meta
records and produces blank playback. A local-only variant replaced metadata with
fictional URLs on the four approved coarse routes. It produced 34 rrweb events,
3 full snapshots, 140120 serialized request bytes and 2857ms of recorded activity.
No poisoned name/email/athlete ID/input/health/secret strings remained after full
decoding. Console/network plugins were absent.

However, attribute masking also masks CSS classes. Actual replay was unstyled
and its click positions no longer matched the shell. SDK custom events included
`$posthog_config`, `$remote_config_received` and `$session_options`, including the
fake local SDK token/configuration. These need removal before any hosted proof.
A snapshot-only event-name filter does not provide sufficient data minimization.

**Do not upload a replay.** The usefulness and metadata gates failed. The app
continues to have no recorder; the offline candidate still drops every event.
No real ingestion token was given to the recorder. A later corrected candidate
must pass real SDK packet inspection and playback again before the previously
bounded one-session/two-minute/two-MiB hosted test can proceed.

## Integration and release gates

Potential overlap with other work: `AppShell.jsx`, `AppErrorBoundary.jsx`,
`SessionEditorDrawer.jsx`, `SeriesComposer.jsx`, `previewMode.js`, `vite.config.js`,
frontend package scripts and Playwright/CI config. Backend untouched. Full touched
file list is available in the implementation commit.

No push: both Vercel projects are Git-connected and the checked-in branch rule
only excludes the separate email preview branch. Treat push as a deployment
trigger until independently disabled or approved. Production release, real-user
identity policy, actual received-field verification, dashboards/notifications and
replay remain separate gates. Claude/design/email work is preserved.
