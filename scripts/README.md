# scripts/

| Script | Who runs it | What it does |
|---|---|---|
| `check-boundaries.sh` | CI (`ci.yml`, both jobs) or anyone | Fails if `frontend/src` reaches into `backend/` or vice versa. |
| `check-migration-inflight.sh` + `check-migration-inflight.test.sh` | CI (`migration-guard.yml`) | Fails when more than one open PR carries migrations without the `migration-applied` label. Fixtures in `fixtures/migration-inflight/`. |
| `prepare-test-accounts.mjs` | **owner-run; creates hosted users** | Creates the admin / coach A / coach B / client test accounts on the **development** Supabase project via the service-role admin API; writes `backend/.env.test-accounts` (gitignored). Refuses unless `SUPABASE_URL` matches `CVF_TEST_PROJECT_REF` and `--yes` is given. |
| `set-test-secrets.sh` | **owner-run; writes GitHub environment secrets** | Creates the `development` environment if needed and sets the ten `CVF_TEST_*` secrets consumed by `development-integration.yml`. Never prints a value. |

Agents must not run the two owner scripts. Passwords live only in the gitignored env file (mode 600) and GitHub secrets — move them to a password manager afterwards and delete the file.
