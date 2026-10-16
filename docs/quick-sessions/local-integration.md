# Invite and Quick Sessions local integration candidate

## Current October14 reconciliation

The accepted combined candidate9f7ea119 is reconciled in a new isolated worktree onto independently accepted released Invite main8d68a7893f7a84a658ff6545bb0b2b70a0df91ce. All223 runtime source files remain byte-identical to that accepted combined candidate; all42 applied migration files and22 released Invite visual-evidence files remain byte-identical to released main. Only the existing Quick draft remains unapplied; its accepted SQL/controller hashes are unchanged. The October9 record below is historical, including its then-unapplied Invite and then-pending combined review statements; task44 subsequently accepted9f7ea119, and Invite has since been applied/released.

The new resulting head needs independent local code/SQL review. No hosted application, push/PR, merge or deployment is authorized by this reconciliation. See [released-main integration](released-main-integration.md) for current scope and test provenance.

## Historical October9 combined record

This local branch combines independently accepted Quick Sessions repair `dfa6df5355c44c3bbd10f36208bbc430e4d1d1a6` and Invite candidate `0e4313780f1a0712badc20cc0148cc84894327b3` over verified current main `0d1a5398c6e2df65f04da513f0f5b99d10bfd36c`. It needs independent combined review. It is not a publishable two-migration release branch. Original author and accepted checkouts are preserved.

Only two merge conflicts needed mechanical resolution: retain both database CI test steps and both dedicated browser-suite exclusions. ClientDetail, preview adapters, package scripts and documentation auto-merge; accepted runtime route, auth, recovery and prescription semantics are retained. The accepted Quick controller, both migration SQL files, programs route and AuthContext remain byte-identical to the accepted Quick candidate; clients route remains byte-identical to accepted Invite.

## Combined contracts

Client creation and Quick creation have separate actor/request UUID namespaces and independent recovery storage. Invitation permission controls claim/send behavior; a coach can assign or start a private quick workout for an owned unclaimed client with invitation permission off. Switching invitation permission off does not delete or replace the workout. Reassignment blocks the original coach's recovery for both receipts. Existing backend middleware supplies actor identity.

Quick shared save, edit, Start, generic save-as-template and dedicated library copy retain the reviewed common lock discipline. Quick writers take the workout advisory lock, client share lock, assignment/workout locks, then log locks where needed. Invite actions take an action advisory lock, client update lock, then attempt locks; completion takes only the attempt lock. Invite paths do not acquire Quick locks or log locks. Their common client locks serialize, without an added reverse dependency. Real PostgreSQL races verify both arrival orders. Service-only RPC privileges, SECURITY INVOKER and empty search paths are unchanged and exercised against the combined schema.

New regression files are `frontend/e2e/invite-quick-integration.spec.mjs` (fictional preview flow), `supabase/tests/invite_quick_integration.sql` (transactional combined receipt/writer/reassignment contracts), and `backend/integration/invite-quick-local.cjs` (real Express, middleware, supabase-js and disposable PostgREST; synthetic Auth/provider fixtures). The auth-session interception now derives its allowed origin from the configured Playwright baseURL so isolated ports work. No production code changes are added by these integration checks.

The test-only launcher and raw logs are in the enclosing task's `integration-evidence/`; it verifies cached image digests, task container identities, exclusive host lock and cleanup. It does not load real credentials or `.env`; temporary local JWTs and provider responses are fictional. These tests establish local database/API contracts, not hosted Auth/provider behavior or email delivery.

## Mandatory serialized release

41 canonical main migrations remain byte-identical. Local resets verify main (41), Invite first (42), then Quick (43), with ordinary writer parity at each stage. Both drafts remain unapplied to hosted databases:

1. `20261009150951_client_invite_on_create.sql`, SHA256 `e8a02d74db9ec69371d31134c4460f99fde8f57e920ee08e9ed2c9eb5e867f41`.
2. `20261009200000_quick_sessions.sql`, SHA256 `8842d98ed4dec4abe57000240c2952712f220018d8af785ba0001938376e2119`.

Do not publish both as unapplied migration PRs. After separately authorized Invite release and owner merge, reconcile Quick against that exact released main, refresh migration/version coordination, review the exact diff, and seek separate release authorization. No hosted version is reserved here. An intervening migration requires renewed ordering/review. Applied migrations remain forward-only.

For each release, verify both development and production target identities and drift, apply/verify only that feature's exact migration under explicit authorization, and require both migration labels before owner merge. Merge auto-deploys both Vercel roots. Invite requires backend readiness first; old valid boolean-only invite controls receive no-write 409 `client_update_required` and manual reload guidance. Preserve unsaved work; no forced reload. Local acceptance does not prove hosted application, deploy order or real email acceptance/delivery. Publication, hosted access, owner merge and deployment were not performed.
