#!/usr/bin/env bash
# OWNER-RUN. Pushes the ten CVF_TEST_* values into the GitHub `development`
# environment so .github/workflows/development-integration.yml can run.
# Reads backend/.env.test-accounts (written by prepare-test-accounts.mjs)
# plus two non-secret values given here. Never echoes a value.
#
#   scripts/set-test-secrets.sh <CVF_TEST_BASE_URL> <CVF_TEST_ALLOWED_HOSTS> [path/to/.env.test-accounts]
set -euo pipefail
REPO="HoodieJav13/CVFPT-Main"
ENV_NAME="development"
BASE_URL="${1:?CVF_TEST_BASE_URL, e.g. https://<dev-backend>.vercel.app/api}"
ALLOWED_HOSTS="${2:?CVF_TEST_ALLOWED_HOSTS, comma-separated exact hostnames}"
ENV_FILE="${3:-$(dirname "$0")/../backend/.env.test-accounts}"
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE — run prepare-test-accounts.mjs first" >&2; exit 2; }

# The environment does not exist yet (checked 2026-09-14: only the four
# Vercel-created ones do); PUT creates it idempotently with no protection rules.
gh api -X PUT "repos/${REPO}/environments/${ENV_NAME}" > /dev/null
echo "environment ${ENV_NAME}: present"

set_secret() { gh secret set "$1" --repo "$REPO" --env "$ENV_NAME" --body "$2" > /dev/null; echo "set $1"; }
set_secret CVF_TEST_BASE_URL "$BASE_URL"
set_secret CVF_TEST_ALLOWED_HOSTS "$ALLOWED_HOSTS"
for name in CVF_TEST_ADMIN_EMAIL CVF_TEST_ADMIN_PASSWORD CVF_TEST_COACH_A_EMAIL CVF_TEST_COACH_A_PASSWORD \
            CVF_TEST_COACH_B_EMAIL CVF_TEST_COACH_B_PASSWORD CVF_TEST_CLIENT_EMAIL CVF_TEST_CLIENT_PASSWORD; do
  value=$(grep -E "^${name}=" "$ENV_FILE" | head -1 | cut -d= -f2-)
  [ -n "$value" ] || { echo "missing ${name} in ${ENV_FILE}" >&2; exit 2; }
  set_secret "$name" "$value"
done
echo "done — dispatch: gh workflow run development-integration.yml --repo ${REPO}"
