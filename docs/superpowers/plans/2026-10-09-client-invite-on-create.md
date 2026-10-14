# Client Invite on Create Implementation Plan

> **For agentic workers:** Future execution uses superpowers:executing-plans task-by-task, after separate implementation authorization. This handoff authorizes no implementation or SQL creation/application. Independent review of this spec and plan comes first.

**Goal:** Let a coach optionally invite a newly created client with retry-safe creation, recoverable request identities and truthful email outcomes.

**Architecture:** Keep revision 3's atomic immutable create receipts and action results, client-row admission lock and fenced invitation attempts. The invite-only HTTP adapter retries the frozen body under the same attempt key; the browser stores only per-request identities and refreshes authorized state before treating historical action results as current.

**Tech Stack:** Existing React 19/Vite 6 frontend, Node/Express backend, Supabase/Postgres, pinned Resend 6.18.1 for unchanged email paths, native fetch for invitations; no new dependency.

**Spec:** [Revision 3 design](../specs/2026-10-08-client-invite-on-create-design.md), derived from `61a6305b5164af0edbf7a0ddf49aa7eca4732c6e`. Paths below are future repository paths, not files created by this documentation task.

**Readiness:** Prepared for independent spec/plan review. Review readiness is not approval of design, implementation, exact SQL, hosted application or release. No proposed test below has been run against an implementation. Quick Sessions has a separate 04:05 UTC proposal awaiting approval; no Quick Sessions work is included here.

## Global Constraints

- "Send app invite now" is **off by default**.
- `invited` stays account-claim permission; email outcomes never change it.
- Existing claim/ownership, admin target-coach and soft-archive rules stay unchanged; no email-uniqueness rule is added.
- CSV import is untouched and never invites; plain create without `request_id` keeps today's behavior.
- One permanent receipt per `(actor_coach_id, request_id)`; one permanent action result per `(actor_coach_id, action_id)`; neither expires with provider retention.
- Browser key: `cvf_client_create_pending:v1:<environment>:<actor coach id>:<request_id>`; value only `{v:1, request_id, state, created_at}`.
- Provider key: `invite/<attempt_id>`; complete frozen `from`, `to`, `reply_to`, `subject`, `html`, `text`; credentials/headers are never persisted or logged.
- 23-hour admission cutoff from first call, 30-second fenced lease, one 8-second HTTP deadline through body read/parse/validation.
- Unknown remains eligible for same-key retry while admissible; only accepted settles uncertainty. New key after uncertainty requires informed confirmation against the current attempt.
- Backend/frontend deploy independently; no imports across roots or root-shared module.
- No real provider calls in tests. Local database tests use an owned disposable stack; no hosted probes, seeds or writes under this plan's current authority.
- Both hosted DB ledgers were reported verified at 41/41 canonical on 2026-10-09; this is existing evidence, not new hosted verification or migration approval.
- Preview policy requires relevant responses/fixtures in the eventual feature PR unless explicitly waived. This bounded plan records that gate without designing or implementing preview fixtures now.

## Review Focus

1. Two independently generated request ids in two tabs must both survive reload; exact-entry clearing must preserve the neighbor (Task 4/5).
2. A lookup failure or lost authorization must retain the identity and block recovered re-entry; only successful authorized absence permits it (Task 3/4/5).
3. An absent lookup may precede the original commit; same-id re-entry must resolve to that receipt or mismatch, not create another client (Task 1/3/5).
4. Historical stale/on results cannot become current card state; fresh confirmation ids and fenced refreshes must honor a newer off intent (Task 1/4/5).
5. Headers may arrive before deadline while the body stalls; timeout, malformed JSON/id or unrecognized rejection must stay unknown, and admissible retry must reuse the key/body (Task 1/2/5).

## File and interface map

New future units:

- `backend/src/lib/clientCreateRequest.js`: normalized create fields/hash and summary-only serialization.
- `backend/src/services/clientInvites.js`: RPC orchestration and invite template body composition.
- `backend/src/services/inviteTransport.js`: bounded direct HTTP call and allowlisted classification.
- `frontend/src/lib/clientCreateRecovery.js`: per-entry identity storage and recovery classification.
- `frontend/src/lib/clientInviteCommands.js`: immutable command identities and response/refresh fencing.
- Focused backend/unit/browser/database test files named in the tasks below.

Existing integration surfaces: `backend/src/routes/clients.js`, `backend/src/services/accountRecovery.js`, `backend/src/services/email.js` (export the existing `FROM` constant only), `frontend/src/pages/coach/Clients.jsx`, `frontend/src/pages/coach/ClientDetail.jsx`; browser configuration/package script and CI. Existing email sending, claim/linking and signup policy keep their behavior. Factoring invite rendering into an export preserves its exact content and existing wrapper colors.

Shared contracts (duplicate small definitions inside each deploy root if needed):

- `InviteSummary = {attempt_id: UUID, status: pending|accepted|failed|unknown|unconfigured, retryable: boolean, next_retry_at: ISO|null, needs_confirmation: boolean, message_key: string}`; nullable when no attempt. No provider body/errors/headers.
- `CreateInput = {name, email, phone, goals, health_notes, coach_id?, invite_now: boolean, request_id: UUID}`. Target coach and actor are resolved server-side; normalized fields determine the hash.
- `ActionCommand = {action_id: UUID, kind: switch_on|switch_off|resend, supersedes_attempt_id: UUID|null, confirm_duplicate_risk: boolean}`. Server-generated provider body and actor are not browser inputs.
- `ActionReply = {action: {action_id, replayed: boolean, result: immutable summary-only result}, invite: InviteSummary|null}`. The action result remains historical even if delivery later advances its bound attempt; `invite` is a separately authorized observation, never a rewrite of the stored result.
- `RecoveryReply = {status: committed, client: client summary, invite: InviteSummary|null} | {status: absent}` only on successful authorized HTTP 200; every error/malformed reply classifies blocked/unknown.
- `ProviderOutcome = {kind: accepted, provider_message_id: UUID} | {kind: unknown|backoff|disabled|rejected, code: allowlisted string, http_status?: number, retry_after_at?: ISO}`. No raw message/body/header data. Completion uses stored uncertainty to decide failed versus unknown; the adapter never infers that an earlier uncertain call failed.

## Task 1: Atomic receipt/action and admission contracts

**Files:** Future migration under `supabase/migrations/`, created by `supabase migration new client_invite_on_create` only after implementation authorization; never preallocate its timestamp or create it in this task. Future tests: `supabase/tests/client_invites/{fixtures.sql,01_receipts.sql,02_actions.sql,03_admission.sql,04_grants.sql,concurrency.sh,run.sh}`. Reuse the guarded disposable-stack pattern of `supabase/tests/session_series/`, without weakening its isolation checks.

**Interfaces:** Produce the four RPCs with the exact signatures in revision 3: `create_client_with_request`, `apply_invite_action`, `admit_invite_call`, `complete_invite_call`. The first two return summary-only results and their bound attempt id; admission returns the token/frozen body only to the backend. Exact SQL argument types, constraints and grants require independent SQL review.

- [ ] Write receipt tests (`same_identity_one_client`, `different_hash_mismatch`, `permanent_binding`, `distinct_identity_separate_client`): identical concurrent `(actor,id,hash)` creates yield one client/receipt/attempt and replay the bound create attempt; differing hash yields mismatch without a losing client; receipt/action update/delete raises; a later resend never repoints the create receipt. Different actors or distinct ids remain separate, including same-email creates.
- [ ] Write action tests: replay `stale`/`needs_confirmation` unchanged; reconfirm under a new id/current supersedes id/choice and select or create the one allowed attempt. Two concurrent resend ids produce one new attempt and a stale result. Replay old on after off leaves permission off. Retry an admissible unknown attempt binds the existing attempt, not a new key.
- [ ] Write admission/completion tests for each ordering in the spec: off/claim/edit/archive/reassignment versus retry, two live admissions, expired-lease takeover, old token completion no-op, accepted terminal, crash before completion, completion-write failure, backoff, 22:59 versus 23:00 cutoff. Off after claim returns `already_claimed`; off before claim prevents linking. No transaction spans provider HTTP.
- [ ] Write per-function grant/search-path and table RLS/grant tests: public/anon/authenticated execution denied, service-role-only execution, internal active actor/current ownership reauthorization on replay. Former owner returns masked not_found; admin may target an active coach. Redact body at closure/cutoff observation, retain deduplication bindings permanently.
- [ ] With later authorization, generate one forward-only migration and implement only these contracts; verify the new focused tests fail before the implementation and pass afterward. The actual SQL needs its own review before any hosted action; do not edit historical migrations.
- [ ] Run `bash supabase/tests/client_invites/run.sh --down` on the owned disposable local stack, including committed concurrency tests and cleanup; expect all assertions pass and teardown succeeds. Commit only the reviewed local SQL/test changes after checks, with future task authority.

## Task 2: Frozen invite rendering and bounded provider adapter

**Files:** Create `backend/src/services/inviteTransport.js`, `backend/test/invite-transport.test.js`; modify `backend/src/services/accountRecovery.js`, `backend/src/services/email.js` (constant export only); create `backend/test/invite-body.test.js`. Existing `backend/test/email-appearance.test.js` and `email-provider-error.test.js` remain regression checks.

**Interfaces:** Export `renderInviteMessage({client, coachName}, env = process.env) -> {to, subject, html, text}` from accountRecovery; existing `sendInviteEmail` calls it without changing rendered content. Export the existing `FROM` constant from email.js, retaining `CVF PT <notifications@corevaluefit.com>`. Export `callInviteProvider({attemptId, providerBody}, {env, fetchImpl, clock}) -> Promise<ProviderOutcome>` from inviteTransport. `clock` supplies monotonic `now`, `setTimeout`, `clearTimeout`; production uses normal runtime functions and tests use controlled time. Task 3's `renderInviteBody` adds that sender and `env.NOTIFY_REPLY_TO` once when an attempt is created, using HTTP `reply_to`, not SDK `replyTo`.

- [ ] Write exact-content rendering tests: ordinary escaped signup link and current email wrapper are unchanged, body has no health/goals/phone/tokens; complete frozen body remains unchanged after subsequent recipient/template/config changes.
- [ ] Write stubbed-fetch assertions for `POST https://api.resend.com/emails`, JSON content type, `Idempotency-Key: invite/<attemptId>` and existing server-side bearer configuration. Use only fictional test credentials, never read credentials for tests. Two calls on the same attempt must have identical serialized body and key.

Representative assertions in test `uncertain_retry_uses_frozen_key_and_body`, after the stub records two admitted calls:

```js
assert.equal(calls[0].url, 'https://api.resend.com/emails');
assert.equal(calls[0].options.method, 'POST');
assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
assert.equal(calls[0].options.headers['Idempotency-Key'], `invite/${attemptId}`);
assert.equal(calls[1].options.body, calls[0].options.body);
assert.equal(calls[1].options.headers['Idempotency-Key'], calls[0].options.headers['Idempotency-Key']);
```
- [ ] Write transport boundary tests: complete 2xx object with UUID id accepts; missing/empty/whitespace/numeric/invalid id, malformed/truncated JSON and 2xx array stay unknown. Headers at 7 seconds plus hung body expire at 8 seconds; body abort and late valid result stay unknown, clear timer and never trigger a second completion. Deadline must not reset at headers.
- [ ] Table-test recognizable documented status/name/message combinations: 409 concurrent backoff 5s/30s/2min; invalid-idempotent unknown+disabled; 429 rate-limit retry-after or bounded 2s→60s fallback; daily quota next 00:00 UTC; monthly disabled; known 400/401/403/422 rejection; 5xx/network/timeout unknown. Bare 4xx, unknown name and mismatched status/name stay unknown. Test a later recognized 403 after uncertainty through Task 1/3 completion, never clearing uncertainty.
- [ ] Spy on logging/error reporting outside production; place fictional canaries in from/to/reply-to/body/raw provider errors/header values. Assert none is logged, stored in outcomes or returned to the browser. Only allowlisted codes survive; arbitrary names map to unclassified.
- [ ] Run `node --test test/invite-transport.test.js test/invite-body.test.js` from backend before/after implementing the adapter and renderer export; expect meaningful failing assertions then all pass. Run the two existing email tests and confirm other send/reset paths still use their existing SDK transport. Commit scoped changes after checks with future authority.

## Task 3: Authorized routes, recovery lookup and RPC orchestration

**Files:** Create `backend/src/lib/clientCreateRequest.js`, `backend/src/services/clientInvites.js`, `backend/test/client-create-request.test.js`, `backend/test/client-invite-routes.test.js`; modify `backend/src/routes/clients.js`. Mount tests at Express HTTP boundary, following `backend/test/session-series-routes.test.js` stubs; use no backend/provider network.

**Interfaces:** `normalizeClientCreate(body, targetCoachId) -> normalized fields`; `hashClientCreate(normalized) -> hash`; `toInviteSummary(attempt) -> InviteSummary|null`; `renderInviteBody({client, coachName}, env) -> provider_body` combines Task 2's unchanged rendered message, exported sender and current reply-to once, before RPC attempt creation. `deliverInviteAttempt({actorId, attemptId}, deps) -> InviteSummary` runs admission→Task 2 adapter→fenced completion. `lookupCreateRequest({actorId, requestId}, deps) -> RecoveryReply` queries only that actor's receipt, rechecks bound-client access and throws on read errors. Existing middleware establishes actor/current role; functions retain their own authorization checks.

Route contracts:

- `POST /api/clients`: with request id, normalized fields/invite flag call the transactional create RPC; reply `{client, replayed, invite}`. Shape error is 400/no_write before lookup; retain identity. Mismatch is 409 with authorized original summary, otherwise generic no-id conflict; inaccessible bound client is 404. Without request id, keep legacy plain create behavior.
- `GET /api/clients/create-requests/:request_id`: validated actor-scoped lookup returns the 200 discriminated recovery contract, never absence on an error. Register before the generic `/:id` handler. Recovery client summary includes only needed id/name/email/coach_id/invited/auth_user_id/archived fields; no create draft health fields.
- `PATCH /api/clients/:id/invite`: `{invited: boolean, action_id, supersedes_attempt_id, confirm_duplicate_risk}` maps to switch kind. `POST /api/clients/:id/invite/resend` accepts the same action fields without `invited`, with kind fixed to resend. Action ids are required for this revised action interface; no fire-and-forget invite dispatch.
- `GET /api/clients/:id`: preserve existing client data contract and add `invite` containing the authorized latest attempt summary. Distinguish read failure from masked access denial.

- [ ] Write mounted tests for create/replay/mismatch, server-derived actor/target/hash/body, UUID/boolean validation, invite-without-email refusal, admin active-coach resolution and its DB read error. Verify legacy plain create and unchanged CSV response/behavior without provider dispatch.
- [ ] Write recovery tests (`authorized_absent_only`, `lookup_failure_not_absence`, `lost_access_keeps_receipt_private`, `absent_then_commit_same_identity`): 200 committed with bound create attempt, 200 absent only after successful authorized no-receipt read; DB error→500, expired auth→401, denial/masked reassignment→403/404, no leaked client/receipt/body. Test absent followed by original commit then changed same-id re-entry→mismatch; no second client.
- [ ] Write orchestration tests: no HTTP on denied/backoff/live-lease/expired admission; not configured and never admitted→unconfigured; completion-write failure leaves recovery unknown until lease takeover; late completion token cannot overwrite accepted. Same-key unknown retry reuses Task 2 body and key. Recognized rejection after uncertainty leaves unknown+disabled.
- [ ] Write action replay tests: stored result remains identical and permission is never reapplied. Only a successful action that selected a send/retry may run admission on replay for its already bound eligible attempt; return its observation separately from the immutable action result. Stale/needs_confirmation never admit delivery or create a new attempt on replay. Test the authorized current read after old on replay reports off/latest state.
- [ ] Run `node --test test/client-create-request.test.js test/client-invite-routes.test.js test/client-claims.test.js` from backend before/after implementing; expect the new assertions initially fail then pass. Run `npm test` and `bash scripts/check-boundaries.sh backend` from their proper roots; commit scoped code/tests after checks with future authority.

## Task 4: Per-request browser recovery and immutable commands

**Files:** Create `frontend/src/lib/clientCreateRecovery.js`, `frontend/src/lib/clientInviteCommands.js`, `frontend/tests/unit/clientCreateRecovery.test.mjs`, `frontend/tests/unit/clientInviteCommands.test.mjs`; modify `frontend/src/pages/coach/Clients.jsx`, `frontend/src/pages/coach/ClientDetail.jsx`. Use existing form/card components and semantic tokens; no restyle.

**Interfaces:** `pendingKey({environment, actorId, requestId}) -> string`; `writePending(context, record, storage) -> {durable: boolean}`; `listPending({environment, actorId}, storage) -> entries`; `clearPending(context, storage)` removes only that key. `classifyRecovery({status, data}|error) -> committed|absent|blocked` validates discriminated 200 reply. `makeInviteCommand({kind, supersedesAttemptId, confirmDuplicateRisk}, uuid) -> ActionCommand`; `createIntentGuard() -> {next(context), isCurrent(token)}` tokens capture namespace, client/request identity and sequence. No imports from backend.

- [ ] Write unit tests for two distinct same-actor request keys, enumerate both, restore each, clear/discard A preserves B, same-id retries share A, actor/environment namespace isolation, logout preservation, malformed record handling, storage failure warning and no sensitive fields serialized. No age-based rotation and no automatic deletion of corrupt entries.

Representative assertions in test `distinct_pending_requests_survive_exact_entry_clear`, using fixture storage and UUID contexts A/B:

```js
assert.notEqual(pendingKey(A), pendingKey(B));
writePending(A, {v: 1, request_id: A.requestId, state: 'pending', created_at}, storage);
writePending(B, {v: 1, request_id: B.requestId, state: 'pending', created_at}, storage);
assert.equal(listPending(A, storage).length, 2);
clearPending(A, storage);
assert.equal(storage.getItem(pendingKey(A)), null);
assert.equal(JSON.parse(storage.getItem(pendingKey(B))).request_id, B.requestId);
```
- [ ] Write unit tests that only authorized well-formed HTTP 200 absent allows recovered re-entry. 401/403/404/500/network/malformed replies retain id and block. Capture context before dispatch; delayed response for another actor/environment/request or superseded lookup cannot update UI/clear storage. Discard invalidates pending response tokens.
- [ ] Write command tests: exact transport retry retains action id and every command field; stale/needs_confirmation replay remains immutable; explicit reconfirmation generates a new id/current supersedes id/coach choice. A new off intent supersedes pending on; old on response/refresh token is not current. Failed refresh does not assert current permission.
- [ ] Implement these small modules and integrate the dialog: write identity before first dispatch; keep in-memory details for same-body retries; after reload list pending identities without sensitive drafts. Select one and perform lookup; 200 absent permits same-id re-entry, committed/mismatch shows authorized existing client and clears only its key. Default invite checkbox off; email required when checked. Discard warns local abandonment cannot cancel server work and a fresh id can create a same-email client.
- [ ] Integrate card commands using Task 3 endpoints: distinguish claim permission from email outcome/next retry time, preserve action id on transport retry and require explicit new command for reconfirmation. Fence command and refresh responses; refresh authorized GET state before displaying historical results as current. An admitted-before-off call may still be accepted, and UI wording says it cannot recall that email.
- [ ] Run `node --test tests/unit/clientCreateRecovery.test.mjs tests/unit/clientInviteCommands.test.mjs` from frontend before/after implementing, then `npm run test:unit`, `npm run build` and root `bash scripts/check-boundaries.sh frontend`; expect pass. Commit functional changes after checks, separate from any later visual change.

## Task 5: Browser proof and independent handoff gates

**Files:** Future `frontend/e2e/client-invites-mocked.spec.mjs`, `frontend/playwright.invites.config.mjs`; modify `frontend/playwright.config.mjs` to exclude the mocked suite from preview, `frontend/package.json` with `test:e2e:invites`, `.github/workflows/ci.yml` with a dedicated mocked-invite browser job and owned-local DB coverage. These are future changes, not executed here.

**Interfaces:** Normal non-preview Vite build with intercepted API calls, fictional signed-in actor/client fixtures and stubbed fetch server responses. Model the separate config after `playwright.series.config.mjs`, reserve its own local port and `reuseExistingServer: false`. No real auth, delivery or hosted database dependency.

- [ ] Write browser tests for checkbox default/no-email, save before response loss, close/reload, committed recovery and authorized absent re-entry. Delay original success until after absence and resubmit changed details under the same id; show mismatch/original instead of second create.
- [ ] Use one browser context with two pages and distinct dialog request ids; lose both replies, reload both and assert both persisted entries remain selectable. Resolve/clear A while B remains recoverable; separately test two pages retrying A. Verify actor/environment switch and Discard invalidate delayed callbacks without removing neighbors.
- [ ] Intercept recovery to return 500/network failure/401/403/404/malformed data; assert recovery remains blocked and same id retained until successful Retry lookup. Exercise full/corrupt/blocked localStorage and truthful durability warning.
- [ ] Add browser tests `stale_replay_then_fresh_confirmation` and `delayed_on_after_newer_off`: intercept stale/needs_confirmation, verify replay keeps its old id/result, then explicit confirmation uses a different id/current attempt/choice. Delay on reply until a newer off reply and fenced current-state refresh; assert card stays off. Delay/fail refresh; historical result must not become permission truth. Show unknown same-key retry, next retry time and confirmed new-send warning after cutoff.
- [ ] Run `npm run test:e2e:invites` before/after completing UI integration; expect all fictional cases pass. Record paired desktop/mobile UI evidence required by CLAUDE.md, plus backend/local DB/unit/build/browser outputs tied to exact future commit. Run existing preview suite as regression evidence, while recording that passing it alone cannot satisfy the unimplemented invite preview gate.
- [ ] Self-review complete spec coverage and get independent review of exact future diff/SQL/tests, including both race orders, privacy logs and source-preservation evidence. Do not self-certify independent acceptance. Commit reviewed CI/config/test changes only with future task authority; publishing remains a separate gate.

## Deferred preview and release gates

Full invite preview support has not been designed or implemented in this bounded correction. The eventual feature cannot be called release-ready until the needed fictional responses/fixtures and preview browser coverage ship in the same PR, or the owner explicitly waives that gate. Preview tests must import `test` from `frontend/e2e/preview-test.mjs`, preserve Sarah's baseline and the production-off build gate, and surface listed unsupported states rather than silently skipping mocks. This handoff grants no waiver.

Exact new SQL needs independent review. Any hosted application requires separate owner authorization, current checks of both targets and verification against the exact reviewed migration. Existing 41/41 convergence is not certification of future function bodies. Both migration-applied labels precede merge; merge triggers both Production projects, so code using the new schema cannot deploy first. Push, merge, hosted mutation, external email sends and deployment are outside this task and are not authorized by this plan.

## Plan self-review and acceptance matrix

| Spec area | Owning task / required evidence |
|---|---|
| Permanent receipts, no uniqueness policy, hashes | 1 + 3: real local SQL races and mounted routes |
| Action identity, new confirmation, stale responses | 1 + 4 + 5: stored-result replay plus new-id and delayed on/off tests |
| Row-lock ordering, current eligibility, fencing | 1 + 3: both orderings and stale-token SQL tests |
| Frozen HTTP body/key, deadline and classification | 2 + 3: stubbed transport boundaries and monotonic completion |
| Per-request recovery, absence/errors, privacy | 3 + 4 + 5: discriminated route errors, exact-entry storage and two distinct tabs |
| Off default, legacy create/CSV, template/claim rules | 2 + 3 + 4 + 5: targeted unchanged-path tests and checkbox proof |
| Preview policy | Deferred explicit implementation/release gate; no fixture expansion in this task |
| Hosted readiness and approval | Separate SQL/hosted/release gates; existing 41/41 evidence only |

Self-review: each review-focus case has an owning task; method names and reply types are consistent across tasks; current observations never replace immutable action results; recovery absence is not a 404; uncertain retries do not rotate attempt keys. No task in this document has been executed. No design approval is inferred from preparing this plan.
