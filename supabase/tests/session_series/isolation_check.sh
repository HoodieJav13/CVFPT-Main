#!/usr/bin/env bash
# Proves a complete database-test run leaves every OTHER local Supabase container and volume
# untouched, and that the owned test stack is really gone afterwards.
#
# Every Docker query must SUCCEED: an engine that cannot be queried makes this check FAIL
# (isolation unverified); it never passes on an inventory that is empty only because a query
# failed. The run is NOT started with --down: teardown is an explicit step whose failure fails
# the check. (It cannot read another stack's data and does not try to: an unchanged container
# id and creation time and an unchanged volume list are the evidence that nothing was reset.)
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ID="cvfpt-series-test"
LABEL="com.supabase.cli.project"
TIMEOUT=""
if command -v timeout >/dev/null 2>&1; then TIMEOUT="timeout 30"; fi

dk() { $TIMEOUT docker "$@"; }
fail() { echo "FAIL: $*" >&2; exit 1; }

dk info >/dev/null 2>&1 || fail "the Docker engine is not responding; isolation cannot be verified"

# Supabase-labelled containers and volumes OTHER than the owned stack. Enumerate first (a
# failure aborts), then filter; an empty result therefore means "queried, and there are none".
inventory() {
  local owned_c owned_v all_c all_v
  owned_c="$(dk ps -a --filter "label=${LABEL}=${PROJECT_ID}" -q)" || return 1
  owned_v="$(dk volume ls --filter "label=${LABEL}=${PROJECT_ID}" -q)" || return 1
  all_c="$(dk ps -a --filter "label=${LABEL}" --format 'container|{{.ID}}|{{.Names}}|{{.CreatedAt}}|{{.State}}')" || return 1
  all_v="$(dk volume ls --filter "label=${LABEL}" --format 'volume|{{.Name}}')" || return 1
  printf '%s\n' "$all_c" "$all_v" | awk -F'|' -v oc="$owned_c" -v ov="$owned_v" '
    BEGIN {
      n = split(oc, a, "\n"); for (i = 1; i <= n; i++) if (a[i] != "") owned[a[i]] = 1
      n = split(ov, b, "\n"); for (i = 1; i <= n; i++) if (b[i] != "") owned[b[i]] = 1
    }
    NF && !($2 in owned)' | sort
}

teardown_if_failed() {
  local status=$?
  if [ "$status" -ne 0 ]; then bash "$DIR/stack.sh" down >/dev/null 2>&1 || true; fi
}
trap teardown_if_failed EXIT

before="$(inventory)" || fail "could not inventory the other Supabase resources before the run"
bash "$DIR/run.sh"
bash "$DIR/stack.sh" down
after="$(inventory)" || fail "could not inventory the other Supabase resources after the run"

count() { printf '%s\n' "$1" | awk 'NF' | wc -l | tr -d ' '; }
echo "other Supabase resources before: $(count "$before")  after: $(count "$after")"
if [ "$before" != "$after" ]; then
  diff <(printf '%s\n' "$before") <(printf '%s\n' "$after") >&2 || true
  fail "other Supabase containers/volumes changed during the run"
fi

left_c="$(dk ps -a --filter "label=${LABEL}=${PROJECT_ID}" -q)" || fail "could not confirm the owned containers are gone"
left_v="$(dk volume ls --filter "label=${LABEL}=${PROJECT_ID}" -q)" || fail "could not confirm the owned volumes are gone"
if [ -n "$left_c" ] || [ -n "$left_v" ]; then
  fail "the owned stack was not fully removed (containers: ${left_c:-none}; volumes: ${left_v:-none})"
fi
echo "isolation check passed"
