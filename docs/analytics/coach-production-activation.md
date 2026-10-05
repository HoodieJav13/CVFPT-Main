# Limited coach analytics release candidate — 2026-10-05

Owner approved limited ongoing coach screen/session-save counts and scrubbed errors after privacy/free-plan checks, with no paid upgrade or replay. This candidate is **not activated, pushed or deployed**. No real-client data or provider ingestion was used in its tests.

## Activation and rollback

Production remains off unless a Vercel Production build explicitly has all of:

- `REACT_APP_POSTHOG_MODE=production-coach`
- `REACT_APP_POSTHOG_HOST=https://us.i.posthog.com`
- the existing project's public ingestion token in `REACT_APP_POSTHOG_PUBLIC_TOKEN`
- authenticated role exactly `coach`, on an allowlisted coach route, with secure UUID generation available

There is no default-on behavior. Missing/invalid config, non-Production builds, fixture/demo mode, client/admin/unknown roles, and non-coach routes cannot collect. The locked demo build gate is unchanged. Fixture/local analytics still use their separate gates and synthetic identity. Admin users are excluded even when using the coach tree.

The transport retains the documented existing single-event `https://us.i.posthog.com/i/v0/e/` path. Packets are reconstructed again at the transport boundary; stale/injected visit IDs are rejected. Cookies and referrer are omitted, requests abort after 2 seconds, and delivery never retries or affects the original save/error. See [Capture API](https://posthog.com/docs/api/capture#single-event).

Rollback sets `REACT_APP_POSTHOG_MODE=off` and rebuilds/redeploys the frontend, or reverts only this activation commit. There is no timed pilot/expiry infrastructure, SDK, replay, dependency or migration. Keep provider IP discard and unrelated metrics/email work intact; stored-event deletion is not part of rollback.

## Exact production data

The envelope contains `event`, `distinct_id`, `properties`, and the public ingestion `api_key`. A random cryptographic UUID is created only in eligible memory context, reused within the coach visit, and discarded on logout, role loss, provider unmount or page end. It is not saved to cookies/localStorage/sessionStorage, derived from identity/device/IP, or passed to the app backend. A fresh page/login gets a new ID. Events within a visit are linkable; no persistent cross-visit linkage, identify/alias/person/group operation, or separate `$session_id` is added. See [anonymous-event guidance](https://posthog.com/docs/data/anonymous-vs-identified-events#how-to-capture-anonymous-events).

Common properties: `app:cvfpt`, `schema_version:2`, `environment:production`, `$process_person_profile:false`, `$ip:null`, `$geoip_disable:true`.

| Event | Additional allowlisted fields |
| --- | --- |
| `cvfpt_coach_screen_viewed` | `screen`: home/clients/client_detail/sessions/session_detail/calendar/programs/resources/messages/notifications/analytics/workout_detail/workout_tracker |
| `cvfpt_coach_session_save` | `operation`: create/update/series_create; `outcome`: success/failure/unconfirmed/recovered; `workout_change`: attached/removed/unchanged/none; `failure_kind`: none/network/server/conflict/authorization/validation/unknown |
| `$exception` | `source`: action/render/runtime/unhandled_rejection; `failure_kind` excluding none; action `operation` or non-action `screen`; `$exception_list`, `$exception_fingerprint`, `$exception_level:error` |

The exception-list entry has type `CvfptCoachFailure`, an enum-generated value such as `Coach create: action server`, and mechanism `{type:generic, handled:<true only for action>, synthetic:true}`. Here `synthetic:true` describes the manually constructed exception mechanism, not the production data environment. Fingerprints are `cvfpt-v2-{operation-or-screen}-{source}-{failure_kind}`. Only numeric HTTP status contributes to failure classification. Expected validation/conflict/auth failures remain save outcomes rather than issues. Recurring saves emit one summary. Pending saves finishing after a role/login/visit change are excluded while preserving their API result.

No names, contact/auth/client/session/workout/program IDs, client details, workout values, messages, notes, health/schedule/location data, URL/query/hash, original errors/stacks/component stacks, request bodies/headers, or secrets are sent. No SDK adds browser/device/pageview/autocapture metadata. PostHog still receives ordinary network IP, browser Origin and User-Agent; stored-event suppression does not imply zero operational transport exposure. Provider timestamps/event/issue IDs and ingestion metadata may be added. Existing internal telemetry and configured Sentry are unchanged and outside this path's privacy certification.

## Limits, free-plan conditions, and release proof

The existing cap is 100 total events, including at most 20 exceptions, per page boot, with 30-second exception-fingerprint deduplication. Counts do not reset on role/UUID changes; reload creates a new boot. **These are not account/monthly billing caps and do not guarantee a dollar ceiling.**

Parent reports a fresh Free-plan/add-card-prompt UI check and official free hard allowances; owner confirms choosing Free plan and directs leaving a card unadded. No card/subscription/paid-overage/limit/alert setting was changed here. These current conditions are reported evidence, not an independent new billing UI inspection in this task. Earlier proof showed 8 analytics / 1 error / 1 replay within free allocations; those counts are historical. Maintain Free plan and IP discard before activation. Configured per-product billing limits stop ingestion above limits; do not equate docs with account-saved limits or change billing for this release. See [billing limits](https://posthog.com/docs/billing/limits-alerts).

Existing hosted fictional schema1 proof verified scrubbed properties; Task7 freshly reports an existing fictional error had `$geoip_disable:true` and `$process_person_profile:false` with no IP/location keys. This does not prove new schema2 UUID enrichment. Before live activation, verify complete receipts for a bounded fictional schema2 screen/save/exception envelope using this serializer/endpoint. Do not resend old proof, open real-client recordings, induce production errors, or create PT records. Check temporary UUID, schema/environment, profile suppression, no IP/geolocation/raw/SDK data, expected provider enrichment and resulting free usage. No new provider proof was sent in candidate preparation.

Review the exact diff, required CI and both Git-connected deployment consequences before release. No push/merge/configuration/deploy happens here. Overlap with separate PT UX work is limited to two analytics effects and an added boolean in `AppShell.jsx`; reconcile that block when rebasing without touching the other worktree.

## Local verification

Directly verified against the final candidate: 74/74 frontend unit tests (including compiled actual Vite/runtime gates and poisoned-payload assertions), 6/6 fictional analytics browser tests, 79/79 preview regressions with 8 existing credential-dependent live-auth skips, 19/19 recurring-session regressions, explicit Production build using a fictional token, frontend deployment-boundary guard, protocol v1.1 validator, whitespace check, and production dependency audit with 0 vulnerabilities. All analytics HTTP calls were intercepted or blocked; no provider or real-client data was used. An initial recurring-session browser run failed one drawer-visibility assertion; the isolated test and full standalone suite passed unchanged. The cause is not established. Existing build chunk-size and Node module-type warnings were retained. Hosted CI/deployment/configuration and received schema2 proof remain release checks.
