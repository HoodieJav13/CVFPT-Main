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

## Bounded cloud event proof — prepared, not transmitted

Target is connected **Default project 509463**, after the parent verifies its
region, project-level **Discard client IP data**, free-plan status and remaining
usage. Destination is that region's allowlisted `https://us.i.posthog.com/i/v0/e/`
or EU equivalent; never the hosted app/backend. HTTP necessarily exposes network
metadata to the receiver despite `$ip: null`, disabled geolocation and omitted
cookies/referrer. Payload-only tests cannot establish provider-side storage.

`synthetic-packets.json` contains the exact constructed event examples without
credentials. For transmission, the transport adds only `api_key`, supplied by the
owner through secure scoped configuration as a **public project ingestion token**,
not an account/personal key. The existing public project ingestion token was read
through the supported connector for the separately authorized fictional proof and held only in ephemeral
memory. No credential was generated or persisted in the repository or environment.
The project settings UI also displayed this public token automatically. No personal
API key or account credential was read. Local work requires no token.

The authorized first proof is **one isolated fictional browser run, at most 12
allowlisted packets, no replay**, home → sessions → create/attach → edit/remove
→ injected 503
→ retry. First intercept all packets locally; approve the exact inspected set and
then allow only that set/count through a test-runner network gate. Stop at the
bound; do not reload or browse other flows with collection enabled. The app's
100-per-boot cap does not enforce this proof's 12-packet bound. Parent verifies
received fields and exception grouping, then turns collection off immediately.

**Actual checkpoint:** nine packets from real local fixture UI actions were
inspected, with zero external requests. The account UI confirms US Cloud, free
plan and zero event/error/web-recording usage. Project IP discard is off; approval
to enable it is pending. Nothing has been sent. See
[proof checkpoint](proof-checkpoint-2026-10-05.md) for the exact nine-event list
and local real-recorder outcome.

No provider settings, dashboards, alerts, billing/plan, production data or
notification destinations were changed. Current formats were checked through
PostHog docs: [Capture API](https://posthog.com/docs/api/capture),
[API tutorial](https://posthog.com/tutorials/api-capture-events),
[exceptions](https://posthog.com/docs/error-tracking/capture) and
[privacy controls](https://posthog.com/docs/privacy/data-collection).

## Bounded replay proposal — offline policy only

`replayProofPolicy.js` is **not imported by the app**. Its candidate options and
eligibility have unit checks. No SDK is installed in the app. A separately pinned
`posthog-js@1.436.1` recorder and `rrweb@2.1.7` player were installed only in a
temporary offline harness. Real snapshots were decoded and played locally; none
were transmitted. **The replay proof failed**, so hosted replay remains blocked.

Proposed scope: **one fictional fixture session, at most 120 seconds and 2 MiB**,
one parent-approved local/isolated preview origin, coach role, no real login.
Only `/coach` → `/coach/sessions` → `/coach/programs` → `/coach/resources`, no
query/hash. Exclude client/session details, messages, workout tracker/logs,
notifications, admin, auth/reset/invite, downloads and external links. Fictional
fixture names/health text stay local and may not enter the recording.

Candidate controls: disabled recorder at initialization; no autocapture,
automatic pageviews/exceptions, console, network/performance/headers/bodies;
mask every input/text/element attribute; block `main`, portals/dialogs/listboxes/
menus, user menu, images/SVG/canvas/media/iframes. The network/URL callback drops
requests, including snapshot URL metadata. Only shell geometry and interaction
timing could remain. Production is never eligible. A future runner must destroy
the recorder **before** any disallowed SPA navigation, not after its DOM renders.

Before collection approval, pin/review the SDK and record to an in-memory **local
sink**, intercepting all traffic. Decode complete snapshots and mutations,
including URLs, text/inputs, attributes/styles, console and network entries.
Poison fictional data with ID/name/email/health/note/token strings and assert none
remain; assert prohibited routes never get recorded. Enforce one session/two
minutes/two MiB independently of sampling. Any prohibited field or blank/unusable
playback fails the proof. No cloud packet passes until this is directly verified.

The proposed navigation usefulness **failed the actual local playback check**:
the SDK masks CSS classes along with other attributes, destroying the layout
and alignment of click positions. Coarse events still identify screens. Blocking
`main` prevents replay from showing the editor/workout or diagnosing its contents;
A corrected candidate must pass local packet/playback checks before any cloud
recording. Its only eligible destination is Default project 509463's verified
region. Parent coordinates any temporary project replay setting. Production
recorder and global broad capture remain disabled.

Docs currently advertise **5,000 free web recordings/month**. Verify account
status/remaining usage before a single recording; do not add a card, upgrade,
create a paid project or alter billing. Use the one-run hard stop and verify the
count afterward. Consulted 2026-10-05:
[replay privacy](https://posthog.com/docs/session-replay/privacy),
[network recording](https://posthog.com/docs/session-replay/network-recording),
[manual controls](https://posthog.com/docs/session-replay/how-to-control-which-sessions-you-record#programmatic-start-and-stop-controls),
[config](https://posthog.com/docs/references/posthog-js/types/SessionRecordingRemoteConfig),
[pricing](https://posthog.com/session-replay/pricing).

## Release gates / rollback

1. **No push.** Both Vercel projects are Git-connected. Their checked-in
   `deploymentEnabled` excludes only `codex/email-brand-preview`, not this branch.
   Treat push as a preview-deploy trigger; secure separate approval or independently
   verify disabled hooks before any remote push/PR. No Vercel setting was changed.
2. Approve exact synthetic payload/destination/count and verify provider privacy/
   free usage before a cloud proof. Secure token setup is unnecessary until then.
3. Replay needs pinned-SDK local packet/playback verification and its own bounded
   collection decision. This offline proposal never activates it.
4. Production usage/errors need separate release approval and a reviewed change to
   fixture/build gates, an appropriate coarse anonymous identity policy and
   received-property verification. Environment settings alone cannot enable it.
5. Alerts/notifications, dashboards, push/merge/deploy, backend/schema/data changes
   and real-user collection remain separate authorization gates.

Rollback: set `REACT_APP_POSTHOG_MODE=off` or revert the scoped local commit. There
are no migrations, new application dependencies, provider changes or hosted
cleanup steps at this checkpoint. Temporary recorder packages are outside the app.
