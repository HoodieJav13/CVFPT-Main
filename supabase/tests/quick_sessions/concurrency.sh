#!/usr/bin/env bash
# Committed-transaction races for quick sessions (A3, A6, A9). OWNED DISPOSABLE STACK ONLY:
# every statement goes through stack.sh, which refuses any container that is not the
# cvfpt-quick-sessions-test stack. A "holder" statement performs its write and then keeps its
# transaction (and locks) open with pg_sleep while a second connection starts; the second must
# queue behind the quick lock and then observe the COMMITTED result of the first.
# run.sh resets the database before calling this; the data is synthetic and removed by the reset
# or teardown of the owned stack.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
psql_db() { bash "$DIR/stack.sh" psql -At "$@"; }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

C1='d1000000-0000-4000-8000-000000000001'
K1='d2000000-0000-4000-8000-000000000001'
K2='d2000000-0000-4000-8000-000000000002'
L1='d3000000-0000-4000-8000-000000000001'
H() { printf "'v1:%s'" "$(printf '%s' "$1" | shasum -a 256 | cut -d' ' -f1)"; }
BODY() {  # BODY <custom name> <sets>
  printf "'[{\"exercise_library_id\":\"%s\",\"sets\":\"%s\",\"reps\":\"5\",\"tracking_type\":\"reps_weight\"},{\"custom_name\":\"%s\",\"sets\":\"2\",\"tracking_type\":\"reps_weight\"}]'::jsonb" "$L1" "$2" "$1"
}
assert_eq() { [ "$2" = "$3" ] || { echo "FAIL: $1 (expected '$3', got '$2')"; exit 1; }; echo "PASS: $1"; }
assert_contains() { grep -qF "$2" "$1" || { echo "FAIL: expected '$2' in $(basename "$1"):"; cat "$1"; exit 1; }; }
waited() { [ "$1" -ge 1 ] || { echo "FAIL: the second call returned in ${1}s; it should have waited on the quick lock"; exit 1; }; }

psql_db <<SQL
insert into public.coaches (id, name, email) values ('$C1', 'Race Coach', 'qs-race-coach@example.invalid');
insert into public.clients (id, coach_id, name, email) values
  ('$K1', '$C1', 'Race Client One', 'qs-race-1@example.invalid'),
  ('$K2', '$C1', 'Race Client Two', 'qs-race-2@example.invalid');
insert into public.exercise_library (id, name) values ('$L1', 'Race Squat');
SQL

# create <request> <hash-seed> <name> <sets> <hold-seconds> <outfile>
create() {
  psql_db -c "select r, pg_sleep($5) from (select public.create_quick_session('$C1','$K1','$1',$(H "$2"),'2031-05-01','$3',null,$(BODY "$3" "$4")) as r offset 0) s;" > "$6"
}
receipt_count() { psql_db -c "select count(*) from public.workout_assignments where create_request_id = '$1';"; }
private_workouts() { psql_db -c "select count(*) from public.workouts w join public.workout_assignments a on a.workout_id = w.id where a.create_request_id = '$1';"; }

echo "-- A3 race 1: two identical concurrent creates -> one created, one replayed, one workout"
RQ='e0000000-0000-4000-8000-000000000001'
create "$RQ" same Same 3 3 "$TMP/a1" & HOLD=$!; sleep 1
START=$(date +%s); create "$RQ" same Same 3 0 "$TMP/b1"; ELAPSED=$(( $(date +%s) - START )); wait "$HOLD"
assert_contains "$TMP/a1" '"state": "created"'; assert_contains "$TMP/b1" '"state": "replayed"'; waited "$ELAPSED"
assert_eq "A3 identical creates commit exactly one receipt" "$(receipt_count "$RQ")" 1
assert_eq "A3 identical creates commit exactly one private workout" "$(private_workouts "$RQ")" 1
assert_eq "A3 replay returned the committed assignment" "$(grep -o '"assignment_id": "[^"]*"' "$TMP/b1")" "$(grep -o '"assignment_id": "[^"]*"' "$TMP/a1")"

for ORDER in original-first reentry-first; do
  echo "-- A3 race 2 ($ORDER): competing bodies under one request id -> one commit, loser mismatches"
  if [ "$ORDER" = original-first ]; then RQ='e0000000-0000-4000-8000-000000000002'; FIRST=Original; SECOND=Reentered
  else RQ='e0000000-0000-4000-8000-000000000003'; FIRST=Reentered; SECOND=Original; fi
  create "$RQ" "$RQ-$FIRST" "$FIRST" 3 3 "$TMP/a2" & HOLD=$!; sleep 1
  START=$(date +%s); create "$RQ" "$RQ-$SECOND" "$SECOND" 4 0 "$TMP/b2"; ELAPSED=$(( $(date +%s) - START )); wait "$HOLD"
  assert_contains "$TMP/a2" '"state": "created"'; assert_contains "$TMP/b2" '{"state": "request_mismatch"}'; waited "$ELAPSED"
  assert_eq "A3 ($ORDER) exactly one receipt" "$(receipt_count "$RQ")" 1
  STATUS="$(psql_db -c "select w.name from public.workout_assignments a join public.workouts w on w.id = a.workout_id where a.id = (public.get_quick_session_request('$C1','$RQ') ->> 'assignment_id')::uuid;")"
  assert_eq "A3 ($ORDER) guarded status shows the authorized winning body" "$STATUS" "$FIRST"
done

# Quick session used by the edit/start/library races.
new_quick() {  # new_quick <request> <client>
  psql_db -c "select r ->> 'assignment_id' from (select public.create_quick_session('$C1','$2','$1',$(H "$1"),'2031-05-02','Race session',null,$(BODY Race 3)) as r) s;"
}
workout_of() { psql_db -c "select workout_id from public.workout_assignments where id = '$1';"; }
edit_body() { printf "'[{\"custom_name\":\"Edited row\",\"sets\":\"%s\"}]'::jsonb" "$1"; }

echo "-- A9 race 3 (edit-first): edit holds the quick lock; start waits and snapshots the whole new prescription"
A="$(new_quick e1000000-0000-4000-8000-000000000001 "$K1")"; W="$(workout_of "$A")"
psql_db -c "select r, pg_sleep(3) from (select public.save_workout('$W','$C1','Edited title',null,null,$(edit_body 6)) as r offset 0) s;" > "$TMP/e3" & HOLD=$!; sleep 1
START=$(date +%s)
psql_db -c "select public.start_workout_log_v2('$K1',null,null,'$A','coach','$C1',null);" > "$TMP/s3"
ELAPSED=$(( $(date +%s) - START )); wait "$HOLD"; waited "$ELAPSED"
assert_contains "$TMP/s3" '"outcome": "started"'
assert_eq "A9 edit-first: start snapshots the edited title" "$(psql_db -c "select workout_name from public.workout_logs where workout_assignment_id = '$A';")" "Edited title"
assert_eq "A9 edit-first: start snapshots every edited row and nothing stale" \
  "$(psql_db -c "select string_agg(exercise_name || ':' || prescribed_sets, ',' order by position) from public.workout_log_exercises e join public.workout_logs l on l.id = e.workout_log_id where l.workout_assignment_id = '$A';")" "Edited row:6"
psql_db -c "update public.workout_logs set status = 'abandoned' where workout_assignment_id = '$A' and status = 'active';" >/dev/null

echo "-- A9 race 4 (start-first): start holds the quick lock; the waiting edit is rejected with no partial change"
A="$(new_quick e1000000-0000-4000-8000-000000000002 "$K1")"; W="$(workout_of "$A")"
BEFORE="$(psql_db -c "select w.name || '|' || string_agg(e.id::text || e.sets || e.archived, ',' order by e.id) from public.workouts w join public.workout_exercises e on e.workout_id = w.id where w.id = '$W' group by w.name;")"
psql_db -c "select r, pg_sleep(3) from (select public.start_workout_log_v2('$K1',null,null,'$A','coach','$C1',null) as r offset 0) s;" > "$TMP/s4" & HOLD=$!; sleep 1
START=$(date +%s)
set +e; psql_db -c "select public.save_workout('$W','$C1','Too late',null,null,$(edit_body 9));" > "$TMP/e4" 2>&1; CODE=$?; set -e
ELAPSED=$(( $(date +%s) - START )); wait "$HOLD"; waited "$ELAPSED"
[ "$CODE" -ne 0 ] || { echo "FAIL: the edit after a committed start succeeded"; exit 1; }
assert_contains "$TMP/e4" 'quick_session_started'
assert_eq "A9 start-first: rows, title and archive flags unchanged" \
  "$(psql_db -c "select w.name || '|' || string_agg(e.id::text || e.sets || e.archived, ',' order by e.id) from public.workouts w join public.workout_exercises e on e.workout_id = w.id where w.id = '$W' group by w.name;")" "$BEFORE"
psql_db -c "update public.workout_logs set status = 'abandoned' where workout_assignment_id = '$A' and status = 'active';" >/dev/null

echo "-- A9 race 5 (load edit vs start, both orders)"
A="$(new_quick e1000000-0000-4000-8000-000000000003 "$K1")"; W="$(workout_of "$A")"
EX="$(psql_db -c "select id from public.workout_exercises where workout_id = '$W' and exercise_library_id is not null;")"
LOADS="'[{\"workout_exercise_id\":\"$EX\",\"load_value\":185,\"load_unit\":\"lb\"}]'::jsonb"
psql_db -c "select r, pg_sleep(3) from (select public.save_workout_assignment_with_loads('$A','$K1','$W','dated','2031-05-02','Loaded',$LOADS) as r offset 0) s;" > "$TMP/l5" & HOLD=$!; sleep 1
START=$(date +%s); psql_db -c "select public.start_workout_log_v2('$K1',null,null,'$A','coach','$C1',null);" > "$TMP/s5"
ELAPSED=$(( $(date +%s) - START )); wait "$HOLD"; waited "$ELAPSED"
assert_eq "A9 load-edit-first: start snapshots the new assignment load" \
  "$(psql_db -c "select prescribed_load_value from public.workout_log_exercises e join public.workout_logs l on l.id = e.workout_log_id where l.workout_assignment_id = '$A' and e.source_workout_exercise_id = '$EX';")" "185"
psql_db -c "update public.workout_logs set status = 'abandoned' where workout_assignment_id = '$A' and status = 'active';" >/dev/null
A="$(new_quick e1000000-0000-4000-8000-000000000004 "$K1")"; W="$(workout_of "$A")"
EX="$(psql_db -c "select id from public.workout_exercises where workout_id = '$W' and exercise_library_id is not null;")"
LOADS="'[{\"workout_exercise_id\":\"$EX\",\"load_value\":185,\"load_unit\":\"lb\"}]'::jsonb"
psql_db -c "select r, pg_sleep(3) from (select public.start_workout_log_v2('$K1',null,null,'$A','coach','$C1',null) as r offset 0) s;" > "$TMP/s6" & HOLD=$!; sleep 1
START=$(date +%s)
set +e; psql_db -c "select public.save_workout_assignment_with_loads('$A','$K1','$W','dated','2031-05-02','Late',$LOADS);" > "$TMP/l6" 2>&1; CODE=$?; set -e
ELAPSED=$(( $(date +%s) - START )); wait "$HOLD"; waited "$ELAPSED"
[ "$CODE" -ne 0 ] || { echo "FAIL: the load edit after a committed start succeeded"; exit 1; }
assert_contains "$TMP/l6" 'quick_session_started'
assert_eq "A9 start-first: load edit rejected, notes and loads unchanged" \
  "$(psql_db -c "select coalesce(a.notes,'∅') || '|' || count(l.id) from public.workout_assignments a left join public.workout_assignment_exercise_loads l on l.workout_assignment_id = a.id and not l.archived where a.id = '$A' group by a.notes;")" "∅|0"
psql_db -c "update public.workout_logs set status = 'abandoned' where workout_assignment_id = '$A' and status = 'active';" >/dev/null

echo "-- A6 race 6: concurrent library saves -> one hidden template, both see the same pointer"
A="$(new_quick e1000000-0000-4000-8000-000000000005 "$K2")"
TEMPLATES="$(psql_db -c "select count(*) from public.workouts where is_template;")"
psql_db -c "select r, pg_sleep(3) from (select public.save_quick_session_to_library('$C1','$A') as r offset 0) s;" > "$TMP/t6a" & HOLD=$!; sleep 1
START=$(date +%s); psql_db -c "select public.save_quick_session_to_library('$C1','$A');" > "$TMP/t6b"; ELAPSED=$(( $(date +%s) - START )); wait "$HOLD"; waited "$ELAPSED"
assert_contains "$TMP/t6a" '"state": "saved"'; assert_contains "$TMP/t6b" '"state": "replayed"'
assert_eq "A6 concurrent saves create exactly one template" "$(psql_db -c "select count(*) from public.workouts where is_template;")" "$((TEMPLATES + 1))"
assert_eq "A6 both callers return the same template id" "$(grep -o '"template_id": "[^"]*"' "$TMP/t6b")" "$(grep -o '"template_id": "[^"]*"' "$TMP/t6a")"

echo "-- A9 race 7: library clone versus edit (both orders) copies one coherent prescription"
A="$(new_quick e1000000-0000-4000-8000-000000000006 "$K2")"; W="$(workout_of "$A")"
psql_db -c "select r, pg_sleep(3) from (select public.save_workout('$W','$C1','Coherent new',null,null,$(edit_body 7)) as r offset 0) s;" > "$TMP/e7" & HOLD=$!; sleep 1
START=$(date +%s); psql_db -c "select public.save_quick_session_to_library('$C1','$A');" > "$TMP/t7"; ELAPSED=$(( $(date +%s) - START )); wait "$HOLD"; waited "$ELAPSED"
assert_eq "A9 edit-first: the template copies the whole edited prescription" \
  "$(psql_db -c "select w.name || '|' || string_agg(e.custom_name || ':' || e.sets, ',' order by e.position) from public.workouts w join public.workout_exercises e on e.workout_id = w.id and not e.archived where w.id = (select library_template_id from public.workout_assignments where id = '$A') group by w.name;")" "Coherent new|Edited row:7"
A="$(new_quick e1000000-0000-4000-8000-000000000007 "$K2")"; W="$(workout_of "$A")"
psql_db -c "select r, pg_sleep(3) from (select public.save_quick_session_to_library('$C1','$A') as r offset 0) s;" > "$TMP/t8" & HOLD=$!; sleep 1
START=$(date +%s); psql_db -c "select public.save_workout('$W','$C1','Edited after copy',null,null,$(edit_body 8));" > "$TMP/e8"; ELAPSED=$(( $(date +%s) - START )); wait "$HOLD"; waited "$ELAPSED"
assert_eq "A9 library-first: the template keeps the whole original prescription" \
  "$(psql_db -c "select w.name || '|' || string_agg(coalesce(e.custom_name, 'lib') || ':' || e.sets, ',' order by e.position) from public.workouts w join public.workout_exercises e on e.workout_id = w.id and not e.archived where w.id = (select library_template_id from public.workout_assignments where id = '$A') group by w.name;")" "Race session|lib:3,Race:2"
assert_eq "A9 library-first: the later edit still applies to the private session" "$(psql_db -c "select name from public.workouts where id = '$W';")" "Edited after copy"

echo "quick_sessions concurrency tests passed"
