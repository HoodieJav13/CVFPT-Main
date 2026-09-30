#!/usr/bin/env bash
# Self-test for check-migration-inflight.sh against fixed gh JSON fixtures.
set -u
cd "$(dirname "$0")/.."
fail=0
expect() {
  local fixture="$1" want="$2"
  bash scripts/check-migration-inflight.sh < "scripts/fixtures/migration-inflight/${fixture}" > /dev/null
  local got=$?
  if [ "$got" -eq "$want" ]; then echo "PASS ${fixture} (exit ${got})"; else echo "FAIL ${fixture}: exit ${got}, wanted ${want}"; fail=1; fi
}
expect one-unlabelled.json 0
expect two-unlabelled.json 1
expect two-one-labelled.json 0
exit $fail
