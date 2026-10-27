# Verification follow-through — 2026-10-16

Resumed the preserved, clean branch `codex/pr114-p2-local-repairs` at
`507d23d426c4dcf7eb853d1535473fb0f6110915`. The original repairs, commits, paired
captures and historical failed/unavailable outcomes remain intact. This record
supersedes their readiness limitations only where fresh outcomes below support
it. No backend/frontend runtime source, migration, dependency, CI configuration,
or Vercel configuration changed during this follow-through.

## Preview timeout: reproduced and synchronized

A fresh full run at the previous test version, single worker, zero retries,
fresh Playwright contexts and no concurrent browser suite, again ended with
99 passed / 8 skipped / 1 timeout. This confirms the prior isolated-pass result
was insufficient to close the broader-suite failure.

The retained trace showed:

- The first completion reached the detail URL at time 140783.657ms.
- The test's second synthetic `history.pushState('/client/programs')` began at
  140824.191ms. Its after-snapshot, at 140879.352ms, was already back on the
  completed workout URL.
- The following start-workout click waited there until the test timeout.

[Extracted trace events](preview-navigation-race.json) retain those transitions.
`WorkoutTracker.jsx` sets `completedWorkoutId` during completion navigation;
`WorkoutLogDetail.jsx:169` consumes that marker through another replace
navigation. The test waited only for the URL, then raced that pending replace.
Unlike the test's synthetic history call, normal detail-page controls require a
rendered page. This is a test synchronization defect; no additional product
runtime fix is included.

The scoped test correction waits for
`window.history.state?.usr?.completedWorkoutId` to be absent before issuing its
synthetic navigation. No sleeps, timeout increases, skipped assertions, retries,
or application changes were added. All existing typed-reps/history assertions
remain. An independent reviewer checked the source relationship and test change
and found no issue; raw trace and full-suite execution were executor-verified.
The first run after the wait passed the original failing test, but three other
cases had blank pages. Their traces contain respectively34,20 and9
`ERR_NETWORK_CHANGED` failures loading local JS modules while disposable Docker
networks were being created or removed. [Extracted network errors](docker-network-interference.json)
retain samples. That invalidated run was explicitly stopped:54 passed,8 skipped,
3 failed,1 interrupted,42 not run. It is not reported as a passing full suite.

After all database suites and teardown completed, a fresh full run was started
with no concurrent Docker lifecycle or other browser suite. It passed **100 tests, with8 existing skips, zero failures and zero retries**.
The complete outcome is recorded in `followthrough-results.json`.

Browser settings: Node24.19.0, repository Playwright1.61.1, installed Chromium
151.0.7922.173, one worker, `fullyParallel:false`, `retries:0`, headless, local
preview server127.0.0.1:42731 with `reuseExistingServer:false`. The temporary
wrapper imports the repository config and changes only absolute paths,
report/artifact destinations and the Chromium executable. Each run starts a new
server; each test has its own context. No hosted-auth credentials or hosted
application endpoints were used. The eight existing hosted/live-auth gated
cases remain intentionally skipped. CI's Node22/bundled browser was not run in
this environment.

## Pinned CLI: corrected diagnosis and local database checks

The earlier CLI startup diagnosis was incomplete. The packaged Go executable is
a sidecar; its missing `start` command is not evidence that the pinned CLI
removed local development. The main2.118.0 executable supports `start` and the
`SUPABASE_HOME` override. Pointing it to fresh `/tmp` state resolves the
read-only home failure without changing `$HOME` or accessing personal CLI
state. Public source verification:

- [State-directory override](https://github.com/supabase/cli/blob/v2.118.0/apps/cli/src/shared/config/supabase-home.ts)
- [Local-only start and lazy credential behavior](https://github.com/supabase/cli/blob/v2.118.0/apps/cli/src/commands/start/start.command.ts)

Tool retrieval can be reproduced with `npm pack --cache /tmp/cvfpt-npm-cache
--pack-destination /tmp/cvfpt-followthrough @supabase/cli-linux-x64@2.118.0`,
then extracting that archive under `/tmp/cvfpt-followthrough/cli`.
Only the exact public npm package `@supabase/cli-linux-x64@2.118.0` was extracted
under `/tmp`; nothing was installed globally or added to repository dependencies.
Main binary SHA256:
`563ad5e20fdaa2e26235667d0de93c5d6e4eb31d58fa4a75b37eb20d06af54fa`.
CLI source tag resolves to commit`70b42b8bf64b8cf1fd14c02c013d99dd655626e2`.

The subprocess wrapper starts with an empty inherited environment and sets only
`PATH`, `TMPDIR`, fresh `SUPABASE_HOME`, `SUPABASE_NO_KEYRING=1`,
`SUPABASE_TELEMETRY_DISABLED=1`, `DO_NOT_TRACK=1`, and the image option described
below. Existing access tokens, project variables and credential-store state are
not passed to the CLI. Repository runners create and validate scratch configs,
strip hosted links, and operate only on their fixed owned Docker projects.

The default image pull tried the CLI's built-in registry fallbacks after ECR
returned403. The Docker daemon uses `vfs`; unpacking the full image failed with
`no space left on device`. That known failing pull was interrupted with SIGINT;
the runner removed its scratch stack and no containers remained. No global
Docker prune, daemon restart, disk expansion or paid resource was used.

The CLI's supported `SUPABASE_USE_SLIM_IMAGES=1` option selects the official
same-version image `ghcr.io/supabase/cli/postgres:17.6.1.171`, digest
`sha256:58e0eab0578c67a26500bc28c77e3993bf9d096f59ad7c0613b08fba35009ef4`.
[Version-preserving selection source](https://github.com/supabase/cli/blob/v2.118.0/apps/cli/src/shared/services/slim-images.ts).
This uses a real owned Postgres database, the unchanged repository migrations,
and the mandatory repository test scripts. It is not PGlite, a mocked database,
an alternate CLI version, or a replacement runner. **Image-variant limitation:**
this is not a successful run of CI's default full image; default-image CI still
must pass after authorized publication.

The suites run serially, with empty verified container inventories between
suites. The series/invite runner owns only`cvfpt-series-test`; Quick owns
only`cvfpt-quick-sessions-test`. For Quick, the runner's supported
`CVFPT_DISPOSABLE_DB_LOCK` override uses the shared path
`/tmp/cvfpt-disposable-db.lock`, because the default home directory is read-only.
Before acquiring it, the default home lock and any other CVF PT test database
are checked absent. The runner's exclusivity guard remains active; the lock is
not bypassed. All three scripts passed; Quick emitted93 PASS records and its parity report
matched26 rows. Containers, volumes and the coordination lock were all absent
after teardown. Detailed outcomes are recorded in `followthrough-results.json`.

The wrapper invokes the extracted main binary with:

```sh
env -i PATH=/usr/local/bin:/usr/bin:/bin TMPDIR=/tmp \
  SUPABASE_HOME=/tmp/cvfpt-followthrough/cli-home \
  SUPABASE_NO_KEYRING=1 SUPABASE_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 \
  SUPABASE_USE_SLIM_IMAGES=1 \
  /tmp/cvfpt-followthrough/cli/package/bin/supabase "$@"
```

Reproduction uses that fresh-state wrapper plus:

```sh
PATH=/tmp/cvfpt-followthrough/tools:$PATH bash supabase/tests/session_series/run.sh --down
PATH=/tmp/cvfpt-followthrough/tools:$PATH bash supabase/tests/client_invites/run.sh
PATH=/tmp/cvfpt-followthrough/tools:$PATH \
  CVFPT_DISPOSABLE_DB_LOCK=/tmp/cvfpt-disposable-db.lock \
  QS_REPORT_DIR=/tmp/cvfpt-followthrough/quick-reports \
  bash supabase/tests/quick_sessions/run.sh --all --down
```

The stack, isolation and Quick stack safety guards also reran:18 +11 +25 cases
passed. No SQL bytes or hosted schemas were changed.

## Automatic preview deployment: read-only inspection

Read-only Vercel inspection confirms both current projects remain Git-linked
to `HoodieJav13/CVFPT-Main`:

| Project | ID | Prior branch preview |
|---|---|---|
| cvfpt-frontend | prj_YvVQow09rIhmucl0cinJ8UdYYCB3 | [READY](https://vercel.com/cvf/cvfpt-frontend/9fiVArLG4a9Hd5aGY81ZJef4KgZW) |
| cvfpt-backend | prj_Nz1mtxPIh66opVQeLbzlVbai9t3f | [READY](https://vercel.com/cvf/cvfpt-backend/Ce5AFWgbSNyivTBWaFtQYt6ep9eh) |

Both prior branch deployments reference
`codex/quick-sessions-review-repairs` at
`a8a6a4958697c4d2d663ac9cc147a9b1ecc813b3`. A current query for
`codex/pr114-p2-local-repairs` returned zero deployments for each project.
No URLs serving the application, provider build/runtime logs, environment
variables, or secrets were fetched.

Both checked-in `vercel.json` files disable four other named branches, but
contain no disabling rule matching this repair branch. Vercel documents
unspecified branches as enabled by default:
[Git deployment configuration](https://vercel.com/docs/project-configuration/git-configuration#git.deploymentenabled).
Together with current Git links and branch deployment history, this means a
push must be treated as capable of triggering **both** previews without a PR.
A draft PR is not a no-deployment safeguard. Project-level ignore overrides
were not exposed by the connector; absence of a disabling rule is not an
assertion about every hidden dashboard setting.

No setting was changed. Before publication, the owner must either explicitly
authorize those preview deployments or authorize and verify a branch-specific
suppression in both deploy roots. The concrete repository suppression would
add `"codex/pr114-p2-local-repairs": false` to each existing
`git.deploymentEnabled` object; that proposed change has **not** been applied.
Push, PR creation, deployment, merge, hosted verification, production data and
new paid resources remain outside the authorization for this follow-through.

## Authority and judgment calls

Authority used: the owner's follow-through instruction permits local
investigation, tests and scoped commits. Vercel inspection is read-only.
Push/PR, deployment/merge, hosted application data, raw credentials and new paid
resources remain forbidden for this pass. No approval-gated install was used.

1. Added a test-only state-consumption wait because the raw trace and unchanged
   detail-page effect explain the synthetic-navigation race; preserved every
   original behavioral assertion and all runtime source.
2. Used the pinned main CLI with its supported fresh-state directory override;
   corrected the earlier sidecar-based diagnosis rather than changing versions
   or repository runners. Public tool files were extracted only under`/tmp`.
3. After the full image failed to unpack under`vfs`, used the official slim
   option at the same version. All required SQL scripts ran, while default-image
   CI equivalence remains a stated limit.
4. Stopped the Docker-network-interfered browser run instead of treating partial
   or isolated passes as acceptance. The final full run starts after database
   teardown, with no concurrent browser or Docker lifecycle operation.
5. Treated the repair branch as auto-preview eligible based on current Git links,
   checked-in rules, documented defaults and prior branch deployments. Kept all
   publication and config changes withheld for the owner's decision.
