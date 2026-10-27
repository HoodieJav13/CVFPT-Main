# Client invite on create — design

Status: proposed, revision 3 (2026-10-09), ready for independent spec/plan
review; not approved for implementation or release. Retains revision 2's
architecture and addresses `task-42/REREVIEW-r2.md` residuals 1–3 and preview
policy attribution. Prepared from commit
`61a6305b5164af0edbf7a0ddf49aa7eca4732c6e` in an isolated documentation copy.
No implementation or SQL is created by this revision. Exact SQL, future
implementation and hosted application each require their own applicable gate.

## Problem

A coach-requested quality-of-life fix: send the app invite as part of creating a
client instead of a second trip to the client page. Doing that honestly needs
two things the current code does not have:

1. **Retry-safe creation.** `POST /api/clients` is a plain insert. A lost
   response followed by a retry creates a second client. With the same email
   that is not cosmetic: `POST /api/auth/signup` refuses with 409 when more than
   one invited, unclaimed client shares an email.
2. **Truthful invite outcomes.** `PATCH /api/clients/:id/invite` fires the email
   in the background (`dispatchEmail`) and reports `invite_email: 'sent'`
   regardless of the provider result. Its key (`invite/<client>/<updated_at>`)
   is tied to the row, not to an attempt.

## What this does not change

- **`invited` stays account-claim permission.** It is read only by the signup
  lookup and `linkInvitedClient` (`auth.js`, `clientClaims.js`). Only an
  explicit coach action sets it (the new checkbox, the switch). Email outcomes
  never change it, and it stays true when delivery fails or is uncertain.
- **Access rules.** `canAccessClient`: admin → any client; coach → clients whose
  `coach_id` is theirs. Admin may create under an active coach, as today.
- **No email uniqueness rule.** Request idempotency deduplicates *one request*.
  It does not prevent distinct requests, other actors or tabs, or a Discard
  followed by a fresh create from producing separate same-email clients; signup
  may then answer 409, exactly as it can today. The UI warns honestly instead.
- **CSV import** (`/clients/import`) is untouched and never invites.
- **The invite template** (`sendInviteEmail` rendering) is reused unchanged:
  ordinary `/signup?email=` link, escaped, no tokens, no goals/health/phone.
- "Send app invite now" is **off by default**.

## Data model — one proposed additive migration

All new tables: RLS enabled, no policies, grants revoked from
`anon`/`authenticated`, `service_role` only.

### `client_create_requests` — immutable creation receipts

| column | notes |
|---|---|
| `id` uuid pk | |
| `actor_coach_id` uuid → coaches | the signed-in coach/admin; server-derived |
| `request_id` uuid | browser-generated identity |
| `request_hash` text | server-computed hash of the normalized request |
| `client_id` uuid → clients | the client this request created |
| `create_attempt_id` uuid null → client_invite_attempts | the attempt made by this request, if any |
| `created_at` | |
| unique (`actor_coach_id`, `request_id`) | |

A `BEFORE UPDATE OR DELETE` trigger raises, so the binding is permanent: it is
never expired with the provider's 24-hour cache, reset on archive, or repointed.
Replays return the bound client and the bound `create_attempt_id`, never "the
latest attempt". The client's *current* data may change; the receipt cannot.

### `client_invite_actions` — durable identity for switch/resend actions

| column | notes |
|---|---|
| `id` uuid pk | |
| `client_id` uuid → clients | |
| `actor_coach_id` uuid → coaches | |
| `action_id` uuid | browser-generated per explicit action |
| `kind` text | `switch_on`, `switch_off`, `resend` |
| `result` jsonb | the original outcome summary (no payload) |
| `attempt_id` uuid null | attempt created or retried by this action |
| `created_at` | |
| unique (`actor_coach_id`, `action_id`) | same update/delete trigger as receipts |

A replayed action returns its stored `result` and never reapplies: an old
`switch_on` replayed after a later `switch_off` does not re-enable permission.
This includes stored `stale` and `needs_confirmation` results: retrying their
original `action_id` always returns that historical result. Reconfirmation is
a new explicit command with a fresh `action_id`, the refreshed current
`supersedes_attempt_id` and the coach's confirmation choice. Transport retries
of any command preserve its exact id and command fields. Historical action
results are not authoritative current client/attempt state.

### `client_invite_attempts` — one row per invitation attempt

| column | notes |
|---|---|
| `id` uuid pk | Resend idempotency key is `invite/<id>` |
| `client_id`, `created_by` | |
| `origin` text | `create`, `switch`, `resend` |
| `recipient_email` text | email at attempt time |
| `provider_body` jsonb null | frozen **complete** request body: `from`, `to`, `reply_to`, `subject`, `html`, `text` (no credentials). Redacted to null on closure (below). |
| `status` text | `pending`, `accepted`, `failed`, `unknown`, `unconfigured` |
| `uncertain` boolean | some admitted call may have been accepted; sticky |
| `retry_disabled` boolean | e.g. key burned, monthly quota, uncertain + later rejection |
| `provider_message_id` text | on `accepted` |
| `last_error_code` text | allowlisted code only (see Privacy) |
| `retry_after_at` timestamptz | |
| `first_provider_call_at` timestamptz | set once, at first admission |
| `lease_token` uuid, `lease_expires_at` timestamptz | fencing |
| `admitted_calls` int | |
| `closed_at` timestamptz | |
| `created_at`, `updated_at` | |
| index (`client_id`, `created_at desc`, `id desc`) | deterministic "latest" |

## Database functions

All functions: `language plpgsql`, `security invoker`, `set search_path = ''`,
schema-qualified objects, and explicit
`revoke execute … from public, anon, authenticated; grant execute … to service_role`
(the `schedule_session_series` pattern). Every argument that carries authority —
actor, target coach, hash, provider body — is computed by the route, never
taken from the browser. Each function re-checks authorization itself: the actor
is an active coach, and is admin or the client's current `coach_id`. Replays are
re-authorized too.

**One serialization point: the client row.** Every function that changes
invite permission or admits a send takes `select … from public.clients where id
= … for update` first. Signup's `linkInvitedClient`, archive, email edit and
reassignment already `UPDATE` that row, so they serialize against it.

1. `create_client_with_request(actor, request_id, hash, client jsonb,
   provider_body jsonb|null)`
   - `pg_advisory_xact_lock` on (actor, request_id) **before** any read or
     write, so concurrent same-identity requests — same or different hash —
     run one at a time. No client is inserted until the identity is known to
     be unused, so there is nothing to roll back.
   - Receipt exists → re-authorize (`not_found` if the actor can no longer
     access the client); different hash → `request_mismatch`; same →
     `replayed` with the bound client and bound attempt.
   - Else insert the client (`invited = true` iff an invite was requested), the
     `pending` create attempt, and the receipt in this one transaction.
2. `apply_invite_action(actor, client_id, action_id, kind, supersedes_attempt_id,
   confirm_duplicate_risk, provider_body)`
   - Advisory lock on (actor, action_id), then the client row lock.
   - Existing action → re-authorize, return stored `result` unchanged.
   - `switch_off`: set `invited = false` only where `auth_user_id is null`; if
     the row is already claimed, the result is `already_claimed`, not
     "withdrawn".
   - `switch_on` / `resend`: refuse unless the client is unclaimed,
     non-archived and has an email. `switch_on` then sets `invited = true`
     (permission is granted even when the email step below stops at `stale`
     or `needs_confirmation`). `resend` requires `invited` already true.
     Compute the current latest attempt.
     - If `supersedes_attempt_id` differs from it → `stale` with the current
       summary at decision time; after refreshing current state, the browser
       reconfirms with a new `action_id`. Nothing is created.
     - If the latest is retryable (same recipient, not closed, within the
       cutoff, not `retry_disabled`) → bind the action to that attempt; no new
       key. This includes `unknown`/uncertain attempts: uncertainty alone does
       not force a new attempt or duplicate-risk confirmation for a same-key
       retry. Admission still enforces current eligibility, backoff and lease.
     - If the latest is uncertain (`uncertain`, or has admitted calls without a
       recorded completion) and `confirm_duplicate_risk` is false →
       `needs_confirmation`, bound to that attempt id.
     - Otherwise insert a new attempt.
     - Store the action with its result in every case.
       A reconfirmation never updates an old action/result.
3. `admit_invite_call(actor, attempt_id)` — the only admission point.
   - Client row lock, then the attempt row.
   - Re-check, under both locks: actor authorized; client `invited`, unclaimed,
     non-archived; `recipient_email` equals the client's current email; attempt
     not closed or `retry_disabled`; `first_provider_call_at` null or less than
     23 hours old; `retry_after_at` passed; no unexpired lease.
   - Taking over an **expired** lease marks `uncertain = true` (the earlier call's
     outcome was never recorded).
   - Set `first_provider_call_at = coalesce(first_provider_call_at, now())`, a new
     `lease_token`, `lease_expires_at = now() + 30 s`, `admitted_calls + 1`.
     Return the token and the frozen body.
4. `complete_invite_call(attempt_id, lease_token, outcome)`
   - Updates only where `lease_token` matches and status is not `accepted`
     (accepted is terminal), so a stale completion after takeover writes
     nothing. Clears the lease. Applies the outcome table below. Sets
     `closed_at` and redacts `provider_body` on `accepted` or `failed`.

Withdrawal (switch off), archive, email edit and reassignment take the client
row lock, so a send admitted *after* them is refused. A call admitted *before*
them may still be accepted by the provider; switching off cannot recall an
email already handed over, and the UI says so. Signup still refuses the claim
once `invited` is false.

## Request identity and hashing

The route computes the hash from the normalized insert fields: trimmed name,
lowercased email, phone, goals, health notes, resolved target coach, invite
flag. The browser supplies only `request_id` (and `action_id` for actions).

## `POST /api/clients`

1. Shape validation (name; uuid `request_id`; invite requires an email). A
   failure here answers 400 with `no_write: true` — it runs before any lookup.
2. Admin target-coach validation, as today.
3. Render the invite body once with the existing template, adding `from` and
   the current `reply_to` so the frozen body is the complete request.
4. Call `create_client_with_request`. Any database error is a 500 — never read
   as "no earlier write".
   - `request_mismatch` → 409 with the original client summary only if the actor
     can access it; otherwise a generic conflict with no ids.
   - `not_found` → 404.
5. If there is a create attempt that is admissible, run delivery. Respond
   `{ client, replayed, invite: summary | null }`.

Requests without `request_id` keep today's plain insert, so older callers are
unaffected.

## Delivery

`deliverInviteAttempt` = `admit_invite_call` → provider call →
`complete_invite_call`. Not configured and never admitted → `unconfigured`.

**Transport.** Invites call `POST https://api.resend.com/emails` with `fetch`
directly. This is an invite-only transport change using the existing Resend
provider and server-side configuration, with no new dependency. The request
uses `Content-Type: application/json`, `Idempotency-Key: invite/<attempt_id>`
and `Authorization: Bearer <existing server-side RESEND_API_KEY>`. Serialize
only the persisted complete `provider_body`; retries never rebuild it from
current template, sender, recipient or reply-to settings. Headers and
credentials stay outside that body, receipts, responses and logs.

One 8-second deadline begins immediately before dispatch and covers fetch,
response-body reading, JSON parsing and response validation. Keep the
`AbortController` active through those steps; use a deadline race and an
elapsed-time check so even a stalled body or late result cannot report success
after the deadline. Abort on expiry; settle that call as `unknown`/`timeout`,
ignore any later transport result and clear the timer in `finally` only after
classification. No deadline resets between headers and body.

A success must arrive within the deadline as complete, valid JSON containing
an object with a nonempty valid email `id`: for this adapter, UUID syntax
(8-4-4-4-12 hexadecimal digits, case-insensitive, without coercion or trimming).
Missing/empty/whitespace/non-string/invalid ids, invalid or truncated JSON,
abort while reading and unrecognized error responses remain `unknown`.
An error is recognizable only when a complete parsed object has a documented
error `name`, a string `message` and its matching documented HTTP status;
the message is used neither for classification nor storage/logging. A bare
4xx, unknown name or status/name mismatch cannot establish rejection.

Revision 2's source inspection reported that pinned SDK 6.18.1 prints raw
provider errors (which can contain addresses) whenever `NODE_ENV` is not
`production`, before our redactor runs. Its package version is still pinned;
that installed source is unavailable in this documentation copy, so this
specific behavior is prior reported evidence, not a new runtime verification.
Other emails keep `sendEmail` unchanged.

Provider references checked 2026-10-09: [send endpoint and headers](https://resend.com/docs/api-reference/emails/send-email),
[idempotency window](https://resend.com/docs/dashboard/emails/idempotency-keys),
[documented errors](https://resend.com/docs/api-reference/errors). The 8-second
deadline, UUID validation and 23-hour cutoff are this application's contract.

**Outcomes** (applied by `complete_invite_call`):

| provider answer | effect |
|---|---|
| 2xx with complete valid JSON and a valid nonempty provider `id`, within deadline | `accepted`; terminal; redact body |
| 2xx without a valid `id` | `unknown`, `uncertain` |
| 409 `concurrent_idempotent_requests` | status unchanged; `retry_after_at` = bounded backoff (5 s, 30 s, 2 min) |
| 409 `invalid_idempotent_request` | `unknown`, `uncertain`, `retry_disabled` (key already used; logged as an error) |
| 429 `rate_limit_exceeded` | status unchanged (`pending` stays `pending`); `retry_after_at` from `retry-after`, else bounded fallback 2 s → 60 s |
| 429 `daily_quota_exceeded` | as above, `retry_after_at` = next 00:00 UTC (the 23-hour cutoff may close it first) |
| 429 `monthly_quota_exceeded` | `retry_disabled` |
| recognizable documented 4xx rejection (401, 403, 422, 400 key/validation error), excluding rows above | if `uncertain` is false → `failed`, closed; if true → stays `unknown`, `retry_disabled` (a later rejection does not prove an earlier timed-out call was refused) |
| 5xx, network error, timeout (including body read), malformed/missing response or unclassified status/name | `unknown`, `uncertain` |

Named error rows above require the recognizable error contract. Do not treat
every documented error as terminal: retry/conflict rows retain their stated
semantics, and unsupported error cases remain unclassified/unknown. Any
`uncertain` attempt remains `unknown` when backoff or `retry_disabled` is set;
record the allowlisted error code separately. Never log raw request bodies,
addresses, response/error objects or headers, even outside production.

**Ending uncertainty.** Uncertainty is never cleared by inference. Only an
`accepted` result settles it. An `unknown`/uncertain attempt remains eligible
for an explicit retry using exactly the same frozen body and
`invite/<attempt_id>` key while admission permits it. No new key or informed
duplicate-risk confirmation is needed merely to retry that same attempt.
When it is past its 23-hour cutoff, `retry_disabled`, or otherwise no longer
retryable, a deliberate new attempt/key after uncertainty requires informed
duplicate-risk confirmation bound to the current `supersedes_attempt_id`.
Backoff and a live lease block admission temporarily; they do not mint a new
key. An attempt with admitted calls but no recorded completion counts as
uncertain. `accepted` remains terminal; never resend it under the same key.

**Body retention.** `provider_body` contains the recipient email, coach name and
signup link. It contains no goals, health or phone data. It is redacted when the
attempt closes (`accepted`/`failed`). An attempt past its cutoff is redacted by
the next action or admission that observes the cutoff. Known limit: an attempt
that is never touched again keeps its body until then. Redaction never touches
the receipt or action bindings.

## Privacy and responses

- API responses carry only an attempt summary: `attempt_id`, `status`,
  `retryable`, `next_retry_at`, `needs_confirmation`, and a message key. They
  never carry the body, HTML or text, or raw provider errors.
- `last_error_code` keeps only allowlisted codes (provider error names from
  Resend's documented error list, plus `timeout`/`network`). Anything else is
  stored as `unclassified`.
- No new credential access. No token links. No email restyle.

## Browser

New-client dialog (`Clients.jsx`) and invite card (`ClientDetail.jsx`):

- **One identity per dialog lifetime.** `request_id` is created when the dialog
  opens. It rotates only after a known success or an explicit Discard. It never
  rotates on 400, 401, 403, 404, 409 or a network error. Editing and
  resubmitting under the same id is safe: if an earlier send already
  committed, the server answers `request_mismatch` and the dialog shows that
  client instead of creating another.
- **Persisted before dispatch, identity only.** Before the first send, the
  browser writes `{v:1, request_id, state, created_at}` to `localStorage` under
  `cvf_client_create_pending:v1:<environment>:<actor coach id>:<request_id>`.
  This is one entry per request, not one mutable actor slot. Enumerate every
  entry for the current environment/actor on recovery and let the coach select
  each pending identity; writing B cannot overwrite A. Restore, update,
  discard and clear only that exact entry. It stores no
  name, email, phone, goals, health notes, tokens or email content. In-memory
  form fields support identical retries without a reload.
- **After a reload or close.** The Clients page asks `GET
  /api/clients/create-requests/:request_id` (actor-scoped, re-authorized),
  which distinguishes successful authorized lookup from failure:
  - **200 `{status: 'committed', client, invite}`** — authorized client and
    bound-create-attempt summary; clear only that request's record;
  - **200 `{status: 'absent'}`** — the authorized actor lookup succeeded and
    found no receipt. Only this result enables re-entry bound to the *same*
    `request_id`. Absence is a snapshot: the original may still commit later,
    so same-id resubmission then replays or returns `request_mismatch`;
  - **blocked/unknown** — network/timeout, malformed response, database/read
    error (500), expired authentication, denied access or masked 404 all retain
    the identity and exact entry. Disable recovered re-entry until an
    authorized lookup succeeds; show Retry lookup (and the existing explicit
    Discard warning). Never turn an HTTP error into `{status: 'absent'}`.
  The endpoint validates the UUID, scopes receipts to the signed-in actor and
  re-checks current access to any bound client, including after reassignment.
- **Storage blocked, full or corrupt.** The save proceeds, and the dialog says
  recovery after reload is unavailable. A corrupt record shows "An earlier
  client save couldn't be read — check your client list before adding again",
  with Discard. The app never claims durable recovery it does not have.
- **Tabs and stale responses.** A `storage` event refreshes the affected entry
  in other tabs. Two tabs retrying the same id is harmless; two independent
  dialogs with distinct ids both survive reload and recover independently.
  Apply create/recovery responses only when environment + actor + request_id
  still match the captured dispatch context; also fence superseded lookup
  responses within that identity. A delayed result never clears another entry
  or restores a discarded identity. No namespace-wide clearing on success.
- **Logout or account switch.** Records are actor-namespaced and hold no
  sensitive fields, so they stay put and are invisible to other actors. They
  are never aged out into a new identity.
- **Discard** only abandons local recovery. It warns that the client may
  already exist and that a fresh save can create a separate client with the
  same email. It never cancels anything on the server.
- **Commands and current card state.** Switch and Resend transport retries
  preserve the `action_id` and exact command. `stale`/`needs_confirmation` are
  final immutable results for that command; after refreshing authorized current
  state, an explicit reconfirmation carries a new `action_id`, the current
  `supersedes_attempt_id` and the coach's confirmation choice. Reusing the old
  id cannot advance it. A new switch intent supersedes older UI actions.
  Fence action responses by environment + actor + client_id + action_id and a
  local intent sequence; ignore delayed responses from superseded identities.
  Refresh authorized current client and latest-attempt state before presenting
  any historical replay as today's state. Fence the refresh too; failed refresh
  leaves the card unable to assert current permission/outcome, with Retry.
  Use `GET /api/clients/:id` with an additive summary-only `invite` field for
  this refresh; it reauthorizes and reports read errors as errors. An old
  successful on-response arriving after a newer off-response must never turn
  the card back on. No permission-version schema change is required.
  An action API reply keeps its immutable `action` result separate from any
  newly authorized `invite` observation. Only a successful action that selected
  a send/retry may run admission for its bound attempt on a transport replay;
  stored `stale`/`needs_confirmation` results never admit delivery. The UI
  still refreshes before presenting historical results as current.
- The invite card states claim permission ("Can claim account: yes/no") apart
  from the latest email outcome, and shows the next retry time.

## Testing

No real provider calls anywhere: transport and SDK are stubbed.

- **Ordering races, both orders each:** switch-off vs retry, switch-off vs claim
  (claim wins → `already_claimed`), email edit vs retry, archive vs retry,
  reassignment vs retry. Database suite on a disposable local Supabase stack
  (pattern of `supabase/tests/session_series/`).
- **Concurrency:** identical and differing-hash concurrent creates (one client,
  one receipt); two concurrent Resend actions (one new attempt, or one `stale`);
  two delivery admissions (one lease); a stale completion after lease takeover
  writes nothing; `accepted` stays terminal.
- **Durability:** crash after the provider call and before completion (takeover
  marks it uncertain and asks for confirmation before a new send); completion
  write failure; cutoff boundary at 22:59 and 23:00; old `switch_on` replayed
  after `switch_off`.
- **Outcome table:** every row, including a missing id, a later 403 after a
  timeout, the three 429 variants, absent or invalid `retry-after`, and a real
  `AbortController` timeout. Stubbed fetch asserts the exact method, endpoint,
  headers and same frozen JSON body/key across uncertain retries; test 22:59
  admission versus 23:00 refusal. Test empty/whitespace/non-string/invalid id,
  invalid/truncated JSON, headers-before-deadline with a stalled/aborted body,
  late results ignored, unrecognized 4xx and status/name mismatch as unknown.
  Only recognizable documented rejection with no earlier uncertainty fails.
- **Security:** function `EXECUTE` grants and `search_path`; table grants and
  RLS; receipt/action update and delete triggers.
- **Authorization:** a former owner replaying after reassignment gets
  `not_found`; a receipt is visible only to its actor; another actor's identical
  `request_id` is a separate identity, so no global request-id or email rule is
  added; admin creating for another coach.
- **Privacy:** responses contain no body or HTML; error codes outside the
  allowlist are stored as `unclassified`; assert no raw address, body, headers,
  credentials or response/error logging in a non-production `NODE_ENV`.
- **Browser** (unit + mocked-API browser spec): persisted before dispatch;
  reload during the in-flight request; committed and authorized-absent recovery;
  lookup 500/network/auth/404/malformed errors retain identity and block re-entry;
  absent snapshot followed by original commit resolves under the same id;
  mismatch shows the existing client; blocked/corrupt storage; two tabs with
  distinct pending ids and same-id retries; exact-entry clear/discard; actor/
  environment switch; Discard warning. Replay a stale action unchanged, then
  reconfirm with a fresh id/current attempt/choice; delay on-response until after
  a newer off-response and assert current permission stays off. Delay/fail the
  authorized refresh and assert historical results cannot assert current state.
- **Unchanged paths:** plain create without `request_id`, and CSV import.

**Preview policy and scope of acceptance.** `CLAUDE.md` requires user-facing
changes to ship with the preview responses and fixtures needed for their UI
in the same PR; it does not prohibit extending `previewMode.js` unless asked.
This spec-only correction does not implement preview fixtures. The mocked-API
browser cases above are spec acceptance criteria, not completed test evidence
or a waiver of preview policy. Full preview integration remains a later
implementation/release gate unless explicitly waived by the owner. It must
preserve the production-off gate, fictional fixtures and preview-test harness.
Neither mocked browser tests nor preview establish real authorization,
database persistence or actual email delivery.

## Release

Future implementation adds one new forward-only migration. Both hosted ledgers (Production and
Development) were verified at 41/41 canonical migrations on 2026-10-09
(`MIGRATION-STATUS-REPORT.md`, task-29), so no earlier migration is pending
ahead of it; existing migrations are never reapplied or rewritten.

The migration needs its own SQL review and a separate owner approval before any
hosted application. Ordinary repository rules then apply: verify both hosted
targets, carry both applied labels before merge, respect the
one-unapplied-migration-in-flight rule, and never deploy backend code that uses
the new tables or function before the migration is applied.

## Out of scope

Duplicate-email policy, CSV-import invites, token invite links, webhooks or a
background delivery queue, delivery guarantees, and the workout-tracker
"Complete remaining sets" change (separate repair/re-review stream).
Quick Sessions (#3) has a reconciled 2026-10-09 04:05 UTC design proposal
awaiting its own design approval; it is separate from this invite spec and plan.
