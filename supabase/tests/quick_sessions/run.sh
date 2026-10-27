#!/usr/bin/env bash
# Quick-sessions database tests on the OWNED disposable stack (stack.sh). LOCAL ONLY.
#   bash supabase/tests/quick_sessions/run.sh --parity [--down]   A10: shared-writer parity, pre-feature vs migrated schema
#   bash supabase/tests/quick_sessions/run.sh --all [--down]      parity + behavior/grant files + committed-transaction races
#   bash supabase/tests/quick_sessions/run.sh --race [--down]     races only (on a freshly reset database)
# Every run first takes the host-wide disposable-database coordination lock (stack.sh lock) and
# releases it on exit; stack.sh also refuses while any other cvfpt test database is running.
# Reports go to $QS_REPORT_DIR (default: a fresh mktemp dir). Synthetic data only.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/../../.." && pwd)"
STACK="$DIR/stack.sh"
PRE_FEATURE_VERSION="20261005165134"
MODE=""; DOWN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --parity|--all|--race) MODE="$1" ;;
    --down) DOWN=1 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done
[ -n "$MODE" ] || { echo "usage: run.sh --parity|--all|--race [--down]" >&2; exit 2; }
REPORTS="${QS_REPORT_DIR:-$(mktemp -d)}"; mkdir -p "$REPORTS"

LOCKED=0
cleanup() {
  local code=$?
  trap - EXIT
  if [ "$DOWN" = 1 ]; then bash "$STACK" down || code=1; fi
  if [ "$LOCKED" = 1 ]; then bash "$STACK" unlock || code=1; fi
  exit "$code"
}
trap cleanup EXIT
CVFPT_LOCK_PID=$$ bash "$STACK" lock; LOCKED=1
if ! bash "$STACK" status >/dev/null 2>&1; then bash "$STACK" up; fi

schema_state() {
  bash "$STACK" psql -At -c "select 'quick_sessions_migration=' || exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'workout_assignments' and column_name = 'create_request_hash');
    select 'sync_helper=' || (to_regprocedure('public.sync_workout_exercises(uuid,jsonb)') is not null);
    select 'latest_migration=' || max(version) from supabase_migrations.schema_migrations;"
}

parity() {
  echo "== parity: pre-feature schema ($PRE_FEATURE_VERSION)"
  bash "$STACK" reset --version "$PRE_FEATURE_VERSION"
  schema_state > "$REPORTS/schema-before.txt"
  grep -qx "quick_sessions_migration=false" "$REPORTS/schema-before.txt" || { echo "FAIL: pre-feature schema already has the quick-sessions migration"; exit 1; }
  bash "$STACK" psql < "$DIR/parity.sql" > "$REPORTS/parity-before.txt"
  echo "== parity: migrated schema (all migrations)"
  bash "$STACK" reset
  schema_state > "$REPORTS/schema-after.txt"
  grep -qx "quick_sessions_migration=true" "$REPORTS/schema-after.txt" || { echo "FAIL: the quick-sessions migration was not applied"; exit 1; }
  bash "$STACK" psql < "$DIR/parity.sql" > "$REPORTS/parity-after.txt"
  if ! diff -u "$REPORTS/parity-before.txt" "$REPORTS/parity-after.txt" > "$REPORTS/parity.diff"; then
    echo "FAIL: shared-writer relational reports differ (see $REPORTS/parity.diff)"; cat "$REPORTS/parity.diff"; exit 1
  fi
  echo "PASS: parity reports identical ($(wc -l < "$REPORTS/parity-after.txt" | tr -d ' ') report rows)"
}

behavior() {
  bash "$STACK" reset
  for f in grants.sql receipts.sql library.sql edits.sql reads.sql; do
    [ -f "$DIR/$f" ] || { echo "missing $f" >&2; exit 1; }
    echo "== $f"
    { echo 'begin;'; cat "$DIR/fixtures.sql" "$DIR/$f"; echo 'rollback;'; } | bash "$STACK" psql
  done
}

case "$MODE" in
  --parity) parity ;;
  --all) parity; behavior; echo "== concurrency.sh"; bash "$DIR/concurrency.sh"; bash "$DIR/generic_template_concurrency.sh" ;;
  --race) bash "$STACK" reset; bash "$DIR/concurrency.sh"; bash "$DIR/generic_template_concurrency.sh" ;;
esac
echo "quick_sessions database tests passed ($MODE); reports in $REPORTS"
