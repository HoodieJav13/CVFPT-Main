# Limited coach analytics release — reconciled 2026-10-08

Owner approved limited ongoing coach screen/session-save counts and scrubbed errors after privacy/free-plan checks, with no paid upgrade or replay. The reviewed candidate `5262b0c` is reconciled onto released main `0a39d07` in an isolated checkout; all analytics runtime/test files are byte-identical to the reviewed candidate. This release is **not activated or deployed yet**. Local tests use fictional data and intercept analytics delivery. The owner separately sent the three reviewed schema2 proof envelopes once; their hosted receipts passed privacy checks.

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

Owner-run schema2 proof completed once at 2026-10-07 23:47:32 UTC. Task7 verified exactly three receipts in project509463 for fictional visit `052cdca6-6b73-4375-af79-5d48c02c28d1`: one screen, one successful save outcome and one generated action/server exception. All use production/schema2 and profile/geo suppression. Stored keys match the allowlist plus expected generated exception metadata, with no IP/location, raw error/stack, URL/referrer, identity, device/session/SDK or real PT record fields. This is proof of the fictional envelopes, not activation or real-user collection. Do not rerun the sender, remove its journal or send replacement proof. No replay or PT records were created for this proof.

The owner subsequently authorized scoped PR/CI/merge/deployment when the privacy/free-plan gates pass. Main now includes the released UX branch. Reconciliation changed only the CLAUDE status conflict and preserves all UX records; analytics runtime/test files remain identical to `5262b0c`. The active PT migration-order/Git-repair checkout is untouched. Main merge deploys both Git-connected Vercel roots; this change adds no migration, backend/dependency change or automatic paid commitment. Required CI and exact deployment verification remain release gates.

## Local verification

Directly verified against the original candidate `e9a5867`: 74/74 frontend unit tests (including compiled actual Vite/runtime gates and poisoned-payload assertions), 6/6 fictional analytics browser tests, 79/79 preview regressions with 8 existing credential-dependent live-auth skips, 19/19 recurring-session regressions, explicit Production build using a fictional token, frontend deployment-boundary guard, protocol v1.1 validator, whitespace check, and production dependency audit with 0 vulnerabilities. All analytics HTTP calls were intercepted or blocked; no provider or real-client data was used. An initial recurring-session browser run failed one drawer-visibility assertion; the isolated test and full standalone suite passed unchanged. The cause is not established. Existing build chunk-size and Node module-type warnings were retained. Hosted CI/deployment/configuration and received schema2 proof remain release checks.

Independent release review subsequently found a stale-auth race: a pending `/auth/me` could restore coach eligibility after logout while navigation was pending. A follow-up uses an auth epoch to discard outdated verdicts/retries/token writes after logout, newer auth requests or provider cleanup, preserving action results/errors and finishing current login/signup loading. Seven actual-provider lifecycle regressions raise frontend units to 81/81. Independent re-review verified both the logout and signup-loading reproductions and found no remaining local release blockers. At that October5 local checkpoint, no hosted schema2 proof had been attempted and sender/billing/browser access was unavailable. Those proof/current-Free-evidence blockers are superseded by the October7 owner-run proof and October8 parent UI verification below; owner-managed production configuration and current IP-discard readiness remain release checks.

Follow-up final verification also passed fictional analytics 6/6, preview 79/79 with the same 8 live-auth skips, explicit Production build, boundary/contract/whitespace checks. Original series/audit results above are prior-candidate evidence; dependencies and series implementation are unchanged.

## October8 release gates and cost interpretation

Parent reports a fresh signed-in Chrome check for project509463: Free plan, cycle September10–October10, displayed usage through October6 of 8 analytics events, 1 exception and one historical synthetic 2-second replay; allowances 1M/100k/5k. Today lag means these displayed counts do not yet account for the October7 proof and are not a settled invoice. Analytics/error volume billing limits match their free allowances; Add Card is shown. A saved card or saved `$0` dollar cap was not visible, and neither is asserted. Current PostHog pricing states the Free plan is not a trial and adding a card is needed for higher limits; billing-limit documentation states ingestion/processing stops above a configured limit. This supports staying within the verified Free-volume limits without adding paid capacity, not an independent guarantee of every possible account invoice. No billing/card/overage/limit/alert setting changes are authorized. Default provider free-allotment/limit emails may occur; no new alert is configured.

Before activation, confirm current receiver-side IP discard and that the existing public project509463 ingest token is owner-configured for Production in cvfpt-frontend. Set only the approved Production non-secret mode/US host through the normal release path once those checks and CI pass; no token is retrieved or copied by an agent. Per-boot100/20 counters are traffic bounds only; provider volume limits supply account protection. Missing/invalid token/flags keep collection off. Preserve explicit off/rebuild rollback and do not certify event counts as unique coaches.

Reconciled October8 local verification passed 83/83 frontend units, 6/6 fictional analytics browser tests, 79/79 preview tests with 8 existing live-auth skips, explicit Production build with a fictional token, frontend boundary/protocol/whitespace checks and production dependency audit0 vulnerabilities. Hosted CI must still pass on the published head.
