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

Checks completed: unit 67/67 (including five replay sanitizer regressions); analytics browser 5/5; preview browser 77 passed,
8 existing live-auth skips; series browser 19/19; production Vite build;
actual compiled runtime production-off check; frontend boundary guard;
Git diff whitespace and CI YAML parse. The offline replay repair also passed actual SDK packet inspection and rrweb playback on all four allowed routes; the app code remains unchanged after its initial checks.

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

The existing public ingestion token was read through the connector, used only in ephemeral stdin/tool memory, then cleared. The settings UI displayed it automatically; no token was copied to disk/repository/environment and no credential was created. Provider UI confirmed Default project509463, US Cloud, free plan and zero usage before the test.

The owner approved enabling **Discard client IP data**. It was enabled in the exact Privacy setting and verified through the UI and connector (`anonymize_ips:true`). Geolocation suppression remains explicit in every packet; IP discard alone does not prevent every provider transformation before storage.

**Hosted event proof passed.** Exactly nine packets were attempted and acknowledged once (zero retries), then all nine received records were read in full. No stored IP, geolocation, URL, client identity, notes, health text or raw errors appeared. Provider exception enrichment adds generated issue/exception identifiers and manual fingerprint metadata only. One synthetic `CvfptCoachFailure` issue contains one occurrence, one synthetic identity and zero sessions:
[synthetic issue](https://us.posthog.com/project/509463/error_tracking/01a10d0b-539a-7fa3-8b0d-d0749fef74f3).
No alert or notification was configured or sent. App collection remained off throughout the manual proof.

## Corrected real recorder proof

Only the temporary harness uses pinned `posthog-js@1.436.1` and `rrweb@2.1.7`. App dependencies/lock files are unchanged. `replayProofPolicy.js` remains an unimported disabled baseline; `replayProofSanitizer.js` is separate unimported proof tooling and cannot start an SDK. Production and non-fictional fixtures are ineligible.

The first local attempt exposed unusable CSS-class masking, blank playback when rrweb Meta was removed, and SDK custom configuration records. The corrected proof preserves only reviewed literal layout classes, exact reviewed static stylesheets with resource URLs/imports/comments removed, four fixed public navigation labels and numeric blocked-node dimensions. Everything else is rebuilt or dropped. Media becomes empty layout placeholders; whitespace stays empty to preserve cursor alignment.

The actual SDK's individually compressed snapshot/mutation fields are decoded before sanitization. The outgoing envelope is reconstructed, eliminating default URL/device/person fields and custom configuration, console, network, input, selection, canvas and unknown extension records. Text is redacted; main content, dialogs, menus, input controls and user menu remain blocked. Metadata/hrefs use only `https://cvfpt-synthetic.invalid` plus `/coach`, `/coach/sessions`, `/coach/programs`, `/coach/resources`. Technical rrweb node/session/window IDs are generated recording data, never application/client IDs. The one-shot sender substitutes only the existing public ingestion authentication token after inspection.

**Local privacy and playback passed:** initialization opted out/recorder stopped; explicit start; actual four-route sidebar navigation; forbidden Clients navigation destroys capture before transition; zero external requests or app errors. Poisoned name/email/athlete ID/health/input/attribute/style/console/header/body strings and SDK config are absent from full decoded outgoing packets. Actual rrweb playback matches all four active screens, retains public labels and aligns link geometry with the live shell exactly (8px tolerance test). Main contents are empty; replay requests no external assets.

Inspected result: one generated session `01a10d1d-77bc-715c-8aca-611dfa7ab80d`, two packets, 30 rrweb events, three full snapshots, **388119 bytes**, **2495ms** activity. Compact inspected packet SHA-256:
`a602c1c4b2d73d464eef65754ede7b8e799ba3ff2d7ed20825d23ce4dec89c86`.
The authorized limit was one fictional session / 120 seconds / 2 MiB.

**Hosted replay attempted once:** both exact inspected packets acknowledged HTTP200 at `https://us.i.posthog.com/s/`; zero retries. Journal exists and prevents a second execution. Hosted indexing is verified: one synthetic identity, 30 events, three clicks, zero keystrokes, zero console log/warn/error entries, fictional start URL, and 388161 provider bytes (under the 2-MiB cap). Provider timestamp normalization moves the stored time; raw rrweb activity span remains 2495ms. Hosted visual playback and post-test usage were subsequently verified at approximately 18:27 UTC; see the completed proof below. Do not resend.
[recording](https://us.posthog.com/project/509463/replay/01a10d1d-77bc-715c-8aca-611dfa7ab80d).
No real token was given to the recorder; the SDK only ever used a fake local token against an intercepted local sink. No SDK is installed or started in the app.

## Completed read-only hosted proof — approximately 18:27 UTC

The separately authorized playback retry opened the exact fictional recording above. Settled screenshots and DOM sampling verified Overview, Sessions, Programs and Resources: active navigation retained, main contents blank, non-public text redacted, input/select values empty; no POISON, example.invalid or poison.invalid canaries. This verifies only the fictional fixture, not production replay. No retransmission, AI summary/scanner, settings change or notification occurred.

The current billing overview showed Free plan, September 10–October 10 cycle: product analytics 8 / 1,000,000 free, web replay 1 / 5,000 free, errors 1 / 100,000 free. Historical Usage/Spend states daily UTC reporting with today's numbers appearing tomorrow; the older default date range had no historical data. These checks do not establish a settled current-day invoice or authorize paid usage.

Source evidence: the read-only proof task's report and settled screenshots, `posthog-hosted-proof-result-2026-10-05.md`, dated 2026-10-05 18:27 UTC. Both previously pending proof checks are complete. App collection/replay, real identities and alerts remain off; no send is repeated for integration.

## Integration and release gates

Potential overlap with other work: `AppShell.jsx`, `AppErrorBoundary.jsx`,
`SessionEditorDrawer.jsx`, `SeriesComposer.jsx`, `previewMode.js`, `vite.config.js`,
frontend package scripts and Playwright/CI config. Backend untouched. Full touched
file list is available in the implementation commit.

No push: both Vercel projects are Git-connected and the checked-in branch rule
only excludes the separate email preview branch. Treat push as a deployment
trigger until independently disabled or approved. Production release, real-user
identity policy, dashboards/notifications and application replay remain separate gates. Hosted replay visual playback and post-test usage verification are complete; real-user collection and application replay remain separate gates. Claude/design/email work is preserved.
