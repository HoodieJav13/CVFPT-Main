# PostHog coach first slice — 2026-10-05

**Local implementation; collection off.** Production and non-preview production
builds are hard-disabled, even with enabling env values. Capture requires the
fixture-backed preview mode. No PostHog SDK, recorder, autocapture, automatic
pageviews, identification, cookies, persistent analytics storage, feature flags,
surveys or console capture is installed. Local verification needs no credentials.

## Existing flows and instrumentation

- `AppShell` maps mounted coach/admin coach-tree navigation to fixed screen enums.
  Clients, admin pages, unknown paths and auth/reset URLs emit none.
- The shared `SessionEditorDrawer` POST creates and PUT edits. Planned-workout
  attachment/removal belongs to that save. Only a resolved API response marks success.
- `SeriesComposer` saves a frozen request, retries it unchanged, and distinguishes
  a recovered receipt from a new successful batch. There is one summary event,
  not one per session. No new application retry behavior was added.
- Network/5xx failures are **unconfirmed**, since the real backend may have saved
  a session before a later attachment/read failure. Other 4xx outcomes are coarse
  failures; expected conflicts/validation/auth errors do not open error issues.
- Preview POST `/sessions` previously dropped `workout_id`; existing GET/PUT/detail
  fixtures supported it. A one-field correction makes attachment/removal testable.

## Exact event/field list

Every packet has `distinct_id: "cvfpt-synthetic-preview"`, and constant properties
`app: "cvfpt"`, `schema_version: 1`, `environment: "synthetic_preview"`,
`$process_person_profile: false`, `$ip: null`, `$geoip_disable: true`.

| Event | Additional allowlisted fields |
| --- | --- |
| `cvfpt_coach_screen_viewed` | `screen`: home/clients/client_detail/sessions/session_detail/calendar/programs/resources/messages/notifications/analytics/workout_detail/workout_tracker |
| `cvfpt_coach_session_save` | `operation`: create/update/series_create; `outcome`: success/failure/unconfirmed/recovered; `workout_change`: attached/removed/unchanged/none; `failure_kind`: none/network/server/conflict/authorization/validation/unknown |
| `$exception` | `source`: action/render/runtime/unhandled_rejection; `failure_kind`; either `operation` or `screen`; generated `$exception_list`, `$exception_fingerprint`, `$exception_level` |

Exceptions use constant type `CvfptCoachFailure`, an enum-generated value such as
`Coach create: action server`, and fingerprint `cvfpt-v1-create-action-server`.
There is no original message/type/stack/cause, component stack, HTTP body or URL.
Runtime listeners mount only with the coach shell; render errors use the boundary
and coach-route allowlist. Only numeric HTTP status is read from caught API errors.

No names, emails, auth/client/athlete/session/workout/program IDs, workout names,
notes, health data, locations, dates, URLs/query/hash, payloads, request IDs,
authorization headers or secrets enter these properties. The transport rebuilds
the allowlisted packet too. Identity is a shared synthetic label, not an auth ID.
These metrics count events, not unique coaches or user retention. Existing internal
telemetry and Sentry are unchanged; they are separate pre-existing systems and
are **not certified by this new-path privacy review**.

## Verification and defensive limits

Run from `frontend/`:

```sh
npm ci
npm run test:unit
npm run test:e2e:analytics
npm run test:e2e:preview
npm run test:e2e:series
VERCEL_ENV=production npm run build
```

The analytics browser suite boots local fictional fixtures at `127.0.0.1:42732`
and uses `REACT_APP_POSTHOG_MODE=local`: sanitized packets dispatch as in-memory
`cvfpt:analytics` CustomEvents. It blocks external requests and fails on any
PostHog/Sentry request. Tests cover navigation/privacy, create/attachment,
edit/removal, 409 conflict, 503 uncertainty, retry, recurring summary and a broken
analytics transport. Unit tests cover poisoned properties, status-only errors,
throwing/rejecting/hanging analytics, exact HTTP envelopes, gates, limits and the
offline replay proposal. The production test compiles the actual runtime with
the actual Vite build guard, enabling flags and a fake token, and verifies zero
network/local-event/listener delivery for Production and ordinary production builds.

Default off, real-data mode, missing token, invalid hosts and personal-key-shaped
values cannot collect. There is a 2-second request abort, no capture retries,
100 events/page boot, 20 exceptions/page boot, and 30-second fingerprint dedup.
These caps are defensive and reset on reload; they are not account billing limits.

## Bounded hosted fictional proof

Connected Default project509463 is US Cloud on the free plan, verified through its UI before the test. The owner approved enabling project **Discard client IP data**; UI/connector confirmed `anonymize_ips:true`. No other provider setting, billing, dashboard, alert or notification destination changed. HTTP exposes network metadata to the receiver; explicit `$ip:null` and `$geoip_disable:true` plus receiver-side discard prevent stored IP/geolocation in the verified event records.

Nine exact fictional events from actual fixture UI actions were independently reconstructed and sent once to `https://us.i.posthog.com/i/v0/e/`. All nine received records and the single scrubbed exception issue were read in full. No forbidden data appeared. The existing public ingestion token was read through the supported connector, held only in ephemeral tool/stdin memory, then cleared. No personal/account key was read; no credential created or persisted. The settings UI displayed the public token automatically. No token is needed for local tests.

[Proof checkpoint](proof-checkpoint-2026-10-05.md) records the exact event sequence, hashes, provider enrichment and actual checks. Evidence outside the repo includes inspected/received events and an attempt journal. The one-shot sender refuses any second execution; uncertain delivery requires read-only receipt checking.

## Bounded replay proof — separate from app collection

Both `replayProofPolicy.js` and `replayProofSanitizer.js` are **not imported by the app**. No recorder or PostHog SDK dependency is installed in the app. A temporary pinned `posthog-js@1.436.1` recorder and `rrweb@2.1.7` player were used entirely against intercepted fictional local fixtures.

The corrected real recorder passed complete decoded packet inspection and actual four-route rrweb playback. Only fixed public Overview/Sessions/Programs/Resources labels, allowlisted static layout classes, exact reviewed resource-free styles, blocked-node geometry, generated technical rrweb IDs/coordinates/timestamps and a fictional coarse origin remain. Arbitrary attributes/text/styles, inputs, main contents, client IDs/notes/health, real URLs, SDK config/debug, console and network records are removed. Production/real-data gates fail closed; initialization stays opted out and replay disabled until an explicit local start. Before any forbidden SPA route the runner opts out/stops the recorder. One-session/120-second/2-MiB limits are enforced before outgoing packets; external requests are blocked.

The owner-authorized single clip was two packets / 388119 bytes / 2495ms activity. Both were HTTP200 acknowledged once at the verified US replay endpoint; no retry. Hosted indexing is verified (30 events, three clicks, zero keypresses/console entries, fictional URL). Hosted visual playback and current usage were subsequently verified at approximately 18:27 UTC: all four allowed routes masked, no fictional canaries; Free-plan overview 8 analytics / 1 replay / 1 error within displayed allocations. Historical usage/spend updates daily in UTC; no settled invoice claim. Do not resend. Local playback shows navigation only because main contents are blocked. This cannot diagnose editor/workout contents and does not approve production replay.

Current format references, consulted 2026-10-05: [Capture API](https://posthog.com/docs/api/capture), [exceptions](https://posthog.com/docs/error-tracking/capture), [privacy controls](https://posthog.com/docs/privacy/data-collection), [replay privacy](https://posthog.com/docs/session-replay/privacy), [replay ingestion](https://posthog.com/docs/how-posthog-works/recordings-ingestion), [timestamps](https://posthog.com/docs/data/timestamps). Account UI showed 5000 free web recordings/month before proof. No card, upgrade or paid project was added.

## Release gates / rollback

1. **No push.** Both Vercel projects are Git-connected. Their checked-in
   `deploymentEnabled` excludes only `codex/email-brand-preview`, not this branch.
   Treat push as a preview-deploy trigger; secure separate approval or independently
   verify disabled hooks before any remote push/PR. No Vercel setting was changed.
2. Hosted fictional events, replay visual playback and current usage checks are complete. Do not repeat transmissions. Integration/merge is owner-authorized; these findings do not authorize real-user collection.
3. App replay remains disabled/uninstalled. Any further replay collection needs its own scope/approval; the proof tooling never activates it.
4. Production usage/errors need separate release approval and a reviewed change to
   fixture/build gates, an appropriate coarse anonymous identity policy and
   received-property verification. Environment settings alone cannot enable it.
5. Alerts/notifications, dashboards, push/merge/deploy, backend/schema/data changes
   and real-user collection remain separate authorization gates.

Rollback: set `REACT_APP_POSTHOG_MODE=off` or revert the scoped local commit. There
are no migrations or new application dependencies. Provider IP discard is an independently approved privacy improvement and remains on. Nine fictional events and one attempted fictional clip remain in PostHog; no cleanup/deletion was authorized. Temporary recorder packages are outside the app.
