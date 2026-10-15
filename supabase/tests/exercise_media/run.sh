#!/usr/bin/env bash
# Exercise media database tests on the OWNED disposable stack (stack.sh).
#   bash supabase/tests/exercise_media/run.sh                 # start if needed, reset, run all
#   bash supabase/tests/exercise_media/run.sh --no-reset      # reuse the stack's current database
#   bash supabase/tests/exercise_media/run.sh --only 02_boundaries.sql --no-reset
#   bash supabase/tests/exercise_media/run.sh --version V     # reset to an earlier migration (RED evidence)
#   bash supabase/tests/exercise_media/run.sh --down          # tear the stack down afterwards; a failed teardown fails the run
# Each 0*.sql group runs inside a transaction that is rolled back; concurrency.sh
# commits fresh random identities into this disposable database only.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
STACK="$DIR/stack.sh"
RESET=1
ONLY=""
DOWN=0
VERSION=""
while [ $# -gt 0 ]; do
  case "$1" in
    --no-reset) RESET=0 ;;
    --only) ONLY="$2"; shift ;;
    --version) VERSION="$2"; shift ;;
    --down) DOWN=1 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

cleanup() {
  local code=$?
  trap - EXIT
  if [ "$DOWN" = 1 ]; then bash "$STACK" down || code=1; fi
  exit "$code"
}
trap cleanup EXIT
if ! bash "$STACK" status >/dev/null 2>&1; then bash "$STACK" up; fi
if [ -n "$VERSION" ]; then bash "$STACK" reset --version "$VERSION"; elif [ "$RESET" = 1 ]; then bash "$STACK" reset; fi

passed=0
for f in "$DIR"/0*.sql; do
  if [ -n "$ONLY" ] && [ "$(basename "$f")" != "$ONLY" ]; then continue; fi
  echo "== $(basename "$f")"
  { echo 'begin;'; cat "$DIR/helpers.sql" "$DIR/fixtures.sql" "$f"; echo 'rollback;'; } | bash "$STACK" psql
  passed=$((passed + 1))
done

if [ -z "$ONLY" ]; then
  echo "== concurrency.sh"
  bash "$DIR/concurrency.sh"
fi
echo "exercise media database tests passed ($passed SQL groups${ONLY:+, concurrency skipped})"
