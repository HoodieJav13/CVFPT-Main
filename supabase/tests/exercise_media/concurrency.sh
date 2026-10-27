#!/usr/bin/env bash
# Committed-transaction races. OWNED DISPOSABLE STACK ONLY (every statement goes
# through stack.sh, which refuses any container that is not cvfpt-media-test).
# A "holder" call keeps its transaction open with pg_sleep while a competitor
# starts; the competitor must queue behind the row locks and then observe the
# COMMITTED result. Media rows can never be deleted (archive-only), so each run
# uses fresh random identities; the stack itself is reset/destroyed by run.sh.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
psql_db() { bash "$DIR/stack.sh" psql -At "$@"; }
with_helpers() { { cat "$DIR/helpers.sql"; cat; } | psql_db; }

uuid() { python3 -c 'import uuid; print(uuid.uuid4())'; }
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

A="$(uuid)"; B="$(uuid)"; ADM="$(uuid)"
EX1="$(uuid)"; EX2="$(uuid)"; EX3="$(uuid)"
psql_db <<SQL
insert into public.coaches (id, name, email, is_admin) values
  ('$A', 'Race Coach A', 'race-a-$A@example.invalid', false),
  ('$B', 'Race Coach B', 'race-b-$B@example.invalid', false),
  ('$ADM', 'Race Admin', 'race-admin-$ADM@example.invalid', true);
insert into public.exercise_library (id, name, source, review_status) values
  ('$EX1', 'Race Synthetic One', 'manual', 'approved'),
  ('$EX2', 'Race Synthetic Two', 'manual', 'approved'),
  ('$EX3', 'Race Synthetic Three', 'manual', 'approved');
SQL

# ready <actor> <exercise> -> approved, unpublished revision id (committed)
ready() { echo "select pg_temp.ready_photo('$1', '$2', gen_random_uuid());" | with_helpers | tail -1; }
publish_held() { psql_db -c "select r, pg_sleep($5) from (select public.exercise_media_publish('$1','$2','$3',$4) as r offset 0) s;" > "$6"; }
assert_contains() { grep -qF "$2" "$1" || { echo "FAIL: expected '$2' in $1:"; cat "$1"; exit 1; }; }

echo "-- race 1: two first publishes (no pointer row yet) -> one published, one stale"
X="$(ready "$A" "$EX1")"; Y="$(ready "$ADM" "$EX1")"
publish_held "$A" "$EX1" "$X" 0 3 "$TMP/r1a" &
HOLD=$!
sleep 1
START=$(date +%s)
publish_held "$ADM" "$EX1" "$Y" 0 0 "$TMP/r1b"
ELAPSED=$(( $(date +%s) - START ))
wait "$HOLD"
assert_contains "$TMP/r1a" '"outcome": "published"'
assert_contains "$TMP/r1b" '"outcome": "stale"'
assert_contains "$TMP/r1b" '"current_version": 1'
[ "$ELAPSED" -ge 1 ] || { echo "FAIL: competitor returned in ${ELAPSED}s; it should have waited on the exercise lock"; exit 1; }
[ "$(psql_db -c "select revision_id || ':' || version from public.exercise_media_current where exercise_library_id = '$EX1';")" = "$X:1" ] || { echo "FAIL: pointer not X:1"; exit 1; }

echo "-- race 2: withdraw (held) vs replacement publish with the same expected version -> serialized, replacement stale"
Z="$(ready "$ADM" "$EX1")"
psql_db -c "select r, pg_sleep(3) from (select public.exercise_media_archive('$A','$X',1) as r offset 0) s;" > "$TMP/r2a" &
HOLD=$!
sleep 1
publish_held "$ADM" "$EX1" "$Z" 1 0 "$TMP/r2b"
wait "$HOLD"
assert_contains "$TMP/r2a" '"outcome": "archived"'
assert_contains "$TMP/r2b" '"outcome": "stale"'
assert_contains "$TMP/r2b" '"current_version": 2'
[ "$(psql_db -c "select coalesce(revision_id::text, 'none') || ':' || version from public.exercise_media_current where exercise_library_id = '$EX1';")" = "none:2" ] || { echo "FAIL: withdrawal did not leave an empty pointer at version 2"; exit 1; }
# The withdrawn guide is never resurrected; the retry with the fresh version wins.
psql_db -c "select public.exercise_media_publish('$ADM','$EX1','$Z',2);" > "$TMP/r2c"
assert_contains "$TMP/r2c" '"outcome": "published"'

echo "-- race 3: replacement while another replacement holds the pointer -> exactly one wins"
P="$(ready "$A" "$EX2")"
psql_db -c "select public.exercise_media_publish('$A','$EX2','$P',0);" >/dev/null
Q1="$(ready "$A" "$EX2")"; Q2="$(ready "$ADM" "$EX2")"
publish_held "$A" "$EX2" "$Q1" 1 3 "$TMP/r3a" &
HOLD=$!
sleep 1
publish_held "$ADM" "$EX2" "$Q2" 1 0 "$TMP/r3b"
wait "$HOLD"
assert_contains "$TMP/r3a" '"outcome": "published"'
assert_contains "$TMP/r3b" '"outcome": "stale"'
[ "$(psql_db -c "select revision_id from public.exercise_media_current where exercise_library_id = '$EX2';")" = "$Q1" ] || { echo "FAIL: pointer not Q1"; exit 1; }

echo "-- race 4: two workers claim concurrently -> distinct jobs, no double claim"
queue() {
  echo "select (public.exercise_media_request_processing('$1', rev, (public.exercise_media_update_draft('$1', rev, (public.exercise_media_attach_source('$1', rev, 1, pg_temp.source(gen_random_uuid(), 'source_image', gen_random_uuid()))->>'version')::int,
    '{\"alt_text\":\"Race synthetic\",\"poster_crop\":{\"x\":0,\"y\":0,\"width\":1,\"height\":1}}')->>'version')::int)->>'job_id')
   from (select (public.exercise_media_create_draft('$1', '$2', gen_random_uuid(), null)->>'revision_id')::uuid as rev) d;" | with_helpers | tail -1
}
J1="$(queue "$B" "$EX3")"; J2="$(queue "$B" "$EX3")"
psql_db -c "select (r->'job'->>'id'), pg_sleep(3) from (select public.exercise_media_claim_job('race-worker-1', 60) as r offset 0) s;" > "$TMP/r4a" &
HOLD=$!
sleep 1
START=$(date +%s)
psql_db -c "select r->'job'->>'id' from (select public.exercise_media_claim_job('race-worker-2', 60) as r) s;" > "$TMP/r4b"
ELAPSED=$(( $(date +%s) - START ))
wait "$HOLD"
CLAIMED_A="$(cut -d'|' -f1 "$TMP/r4a")"; CLAIMED_B="$(cat "$TMP/r4b")"
[ -n "$CLAIMED_A" ] && [ -n "$CLAIMED_B" ] && [ "$CLAIMED_A" != "$CLAIMED_B" ] || { echo "FAIL: workers claimed '$CLAIMED_A' and '$CLAIMED_B'"; exit 1; }
case " $J1 $J2 " in *" $CLAIMED_A "*) ;; *) echo "FAIL: unexpected job $CLAIMED_A"; exit 1 ;; esac
case " $J1 $J2 " in *" $CLAIMED_B "*) ;; *) echo "FAIL: unexpected job $CLAIMED_B"; exit 1 ;; esac
[ "$ELAPSED" -le 1 ] || { echo "FAIL: second worker blocked ${ELAPSED}s; claims must skip locked jobs"; exit 1; }

echo "-- race 5: identical draft-create requests at once -> one creation, one replay"
RQ="$(uuid)"
psql_db -c "select r, pg_sleep(3) from (select public.exercise_media_create_draft('$A','$EX3','$RQ',null) as r offset 0) s;" > "$TMP/r5a" &
HOLD=$!
sleep 1
psql_db -c "select public.exercise_media_create_draft('$A','$EX3','$RQ',null);" > "$TMP/r5b"
wait "$HOLD"
assert_contains "$TMP/r5a" '"replayed": false'
assert_contains "$TMP/r5b" '"replayed": true'
[ "$(psql_db -c "select count(*) from public.exercise_media_revisions where uploaded_by_coach_id = '$A' and create_request_id = '$RQ';")" = "1" ] || { echo "FAIL: duplicate draft"; exit 1; }

echo "exercise media concurrency tests passed (5 races)"
