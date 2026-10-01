#!/usr/bin/env bash
# Committed-transaction race tests. OWNED DISPOSABLE STACK ONLY (via stack.sh).
# A "holder" call keeps its transaction (and the scheduling advisory lock) open for
# a few seconds via pg_sleep while a second call starts; the second call must
# queue behind the lock and then observe the COMMITTED result of the first.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
# One owned target: every statement goes through stack.sh, which refuses any container that is
# not the disposable cvfpt-series-test stack. There is no environment override.
psql_db() { bash "$DIR/stack.sh" psql -At "$@"; }

C1='10000000-0000-4000-8000-0000000000e1'
K1='20000000-0000-4000-8000-0000000000e2'
K2='20000000-0000-4000-8000-0000000000e3'

cleanup_db() {
  # Test data in the owned disposable stack only (stack.sh refuses any other container).
  psql_db <<SQL || true
delete from public.sessions where coach_id = '$C1';
delete from public.session_series where coach_id = '$C1';
delete from public.clients where coach_id = '$C1';
delete from public.coaches where id = '$C1';
SQL
}
TMP="$(mktemp -d)"
cleanup() { cleanup_db; rm -rf "$TMP"; }
trap cleanup EXIT
cleanup_db   # start from a clean slate in case a previous run was interrupted

psql_db <<SQL
insert into public.coaches (id, name, email) values ('$C1', 'Race Coach', 'race-coach@example.invalid');
insert into public.clients (id, coach_id, name, email) values
  ('$K1', '$C1', 'Race Client One', 'race-client-1@example.invalid'),
  ('$K2', '$C1', 'Race Client Two', 'race-client-2@example.invalid');
SQL

SLOTS='[{"key":"s1","scheduled_at":"2031-06-03T17:00:00Z","workout_id":null},{"key":"s2","scheduled_at":"2031-06-10T17:00:00Z","workout_id":null}]'

# series <request_id> <hash> <client> <hold_seconds> <outfile>
series() {
  psql_db -c "select r, pg_sleep($4) from (select public.schedule_session_series('$1','$2','$C1','$3',60,'Studio','{}'::jsonb,null,false,'$SLOTS'::jsonb) as r offset 0) s;" > "$5"
}
count_sessions() { psql_db -c "select count(*) from public.sessions where coach_id = '$C1';"; }
count_series() { psql_db -c "select count(*) from public.session_series where coach_id = '$C1';"; }
assert_contains() { grep -qF "$2" "$1" || { echo "FAIL: expected '$2' in $1:"; cat "$1"; exit 1; }; }

echo "-- race 1: two simultaneous identical requests -> one creation, one replay"
RQ='b0000000-0000-4000-8000-000000000001'
series "$RQ" hash-race-1 "$K1" 3 "$TMP/a1" &
HOLD=$!
sleep 1
START=$(date +%s)
series "$RQ" hash-race-1 "$K1" 0 "$TMP/b1"
ELAPSED=$(( $(date +%s) - START ))
wait "$HOLD"
assert_contains "$TMP/a1" '"replayed": false'
assert_contains "$TMP/b1" '"replayed": true'
[ "$ELAPSED" -ge 1 ] || { echo "FAIL: the second call returned in ${ELAPSED}s; it should have waited on the lock"; exit 1; }
[ "$(count_sessions)" = "2" ] || { echo "FAIL: expected exactly 2 sessions, got $(count_sessions)"; exit 1; }
[ "$(count_series)" = "1" ] || { echo "FAIL: expected exactly 1 series, got $(count_series)"; exit 1; }

echo "-- race 2: different request ids competing for the same slots -> one winner, one conflict"
RQ_A='b0000000-0000-4000-8000-000000000002'
RQ_B='b0000000-0000-4000-8000-000000000003'
SLOTS='[{"key":"t1","scheduled_at":"2031-07-01T17:00:00Z","workout_id":null}]'
series "$RQ_A" hash-race-2a "$K1" 3 "$TMP/a2" &
HOLD=$!
sleep 1
series "$RQ_B" hash-race-2b "$K2" 0 "$TMP/b2"
wait "$HOLD"
assert_contains "$TMP/a2" '"outcome": "created"'
assert_contains "$TMP/b2" '"outcome": "conflicts"'
assert_contains "$TMP/b2" '"scope": "coach"'
[ "$(count_sessions)" = "3" ] || { echo "FAIL: expected 3 sessions total, got $(count_sessions)"; exit 1; }
[ "$(count_series)" = "2" ] || { echo "FAIL: expected 2 series total, got $(count_series)"; exit 1; }

echo "concurrency tests passed"
