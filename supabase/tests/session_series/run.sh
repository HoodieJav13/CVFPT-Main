#!/usr/bin/env bash
# Database behavioral tests for recurring sessions, on the OWNED disposable stack (stack.sh).
#   bash supabase/tests/session_series/run.sh                      # start if needed, reset, run all
#   bash supabase/tests/session_series/run.sh --no-reset           # reuse the stack's current database
#   bash supabase/tests/session_series/run.sh --only 01_conflict_matrix.sql --no-reset
#   bash supabase/tests/session_series/run.sh --down               # tear the stack down afterwards (CI); a failed teardown fails the run
# Each 0*.sql file runs inside a transaction that is rolled back, so reruns are safe.
# concurrency.sh uses committed transactions and cleans up after itself.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
STACK="$DIR/stack.sh"
RESET=1
ONLY=""
DOWN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --no-reset) RESET=0 ;;
    --only) ONLY="$2"; shift ;;
    --down) DOWN=1 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

# A failed teardown must fail the run: an EXIT trap's own status is otherwise lost.
cleanup() {
  local code=$?
  trap - EXIT
  if [ "$DOWN" = 1 ]; then bash "$STACK" down || code=1; fi
  exit "$code"
}
trap cleanup EXIT
if ! bash "$STACK" status >/dev/null 2>&1; then bash "$STACK" up; fi
if [ "$RESET" = 1 ]; then bash "$STACK" reset; fi

for f in "$DIR"/0*.sql; do
  if [ -n "$ONLY" ] && [ "$(basename "$f")" != "$ONLY" ]; then continue; fi
  echo "== $(basename "$f")"
  { echo 'begin;'; cat "$DIR/fixtures.sql"; cat "$f"; echo 'rollback;'; } | bash "$STACK" psql
done

if [ -z "$ONLY" ] && [ -f "$DIR/concurrency.sh" ]; then
  echo "== concurrency.sh"
  bash "$DIR/concurrency.sh"
fi
echo "session_series database tests passed"
