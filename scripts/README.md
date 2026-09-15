# scripts/

| Script | Who runs it | What it does |
|---|---|---|
| `check-boundaries.sh` | CI (`ci.yml`, both jobs) or anyone | Fails if `frontend/src` reaches into `backend/` or vice versa. |
| `check-migration-inflight.sh` + `check-migration-inflight.test.sh` | CI (`migration-guard.yml`) | Fails when more than one open PR carries migrations without the `migration-applied` label. Fixtures in `fixtures/migration-inflight/`. |
| `prepare-test-accounts.mjs` | **owner-run; creates hosted users** | Creates dedicated admin / coach A / coach B / client accounts on an independently confirmed development project; requires `--yes`, validates the exact HTTPS target and rejects shared/linked projects. Saves credentials and progress to `backend/.env.test-accounts` before each hosted creation. |
| `prepare-test-accounts.test.mjs` | CI backend job or anyone | `node --test scripts/prepare-test-accounts.test.mjs` executes the actual CLI in temporary repositories with a fake SDK. No hosted calls, real credentials or installed SDK required. |
| `set-test-secrets.sh` | **owner-run; writes GitHub environment secrets** | Creates the `development` environment if needed and sets the ten `CVF_TEST_*` secrets consumed by `development-integration.yml`. Never prints a value. |

Agents must not run the two owner scripts. Passwords live only in the gitignored env file (mode 600) and GitHub secrets — move them to a password manager afterwards and delete the file.

## Target guard

The URL must be exactly `https://<CVF_TEST_PROJECT_REF>.supabase.co` (no credentials, custom port, path, query or fragment). The script refuses the repo's `supabase/.temp/project-ref` when present and independently denies the known shared Preview/Production project `hhzpzcxcurmhpmfgriqb`. An unreadable linked-project file also causes refusal.

This proves **not the known shared/linked project**, not **is development**. The owner must independently confirm the target is a dedicated development project before supplying its service key. A checkout linked to that development project is also conservatively refused; do not remove a denial just to get a run through.

## Recovery from partial creation

The file is always `backend/.env.test-accounts` relative to the script's repository, regardless of the current directory. It is created exclusively with mode 600; an existing file, symlink or inaccessible location is refused before client initialization. Keep it private and never paste it into logs or review messages.

Each email/password pair and `# LABEL PENDING` record is written and flushed before its Auth creation. After the profile insert succeeds, `# LABEL DONE` is appended and flushed. **The last status for each label wins.** Appending preserves earlier credentials if a later operation fails. The eight `CVF_TEST_*` credential lines remain compatible with `set-test-secrets.sh`.

On failure, the command exits 1, prints account labels with `DONE`, `PENDING` or `NOT_STARTED`, and stops. `PENDING` means the Auth user or profile may already exist, including after a network timeout. Do not rerun or upload secrets from an incomplete file; `set-test-secrets.sh` does not validate these progress markers.

Owner recovery:

1. Preserve the file in secure storage. In the target project's dashboard, look up each attempted test email and inspect its Auth identity and linked coach/client profile. Use the saved credentials; do not reset passwords merely to recover them.
2. Reconcile the incomplete test accounts manually. If choosing to restart, remove only newly created disposable test Auth users after checking their profile links and the consequences. Never delete pre-existing identities or hard-delete business rows; unresolved profile links need an explicit recovery decision first.
3. Only after resolving existing test identities should the owner move the journal aside and rerun creation. Do not reuse an email that still exists. Upload secrets only after all four accounts and their role/profile relationships are confirmed complete.

There is no automatic deletion, password reset or resume mode. Exit 2 means preflight refusal; no hosted account creation was attempted. Exit 0 means all four Auth/profile pairs completed, not that real-auth integration tests have passed.
