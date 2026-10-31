#!/usr/bin/env bash
# Only the owned disposable stack; never a supplied URL, project or credentials.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
STACK="$DIR/../session_series/stack.sh"
psql_db() { bash "$STACK" psql -At "$@"; }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
psql_db < "$DIR/fixtures.sql"
ACTOR='10000000-0000-4000-8000-0000000000a1'
REQUEST='a0000000-0000-4000-8000-000000000099'
CLIENT_BODY='{"name":"Race Fictional","email":"race@example.invalid","coach_id":"10000000-0000-4000-8000-0000000000a1","invite_now":true}'
PROVIDER_BODY='{"from":"from@example.invalid","to":["race@example.invalid"],"reply_to":"reply@example.invalid","subject":"Frozen","html":"Frozen","text":"Frozen"}'
create() { psql_db -c "select r,pg_sleep($1) from (select public.create_client_with_request('$ACTOR','$REQUEST','${3:-race-hash}','$CLIENT_BODY','$PROVIDER_BODY') r offset 0) s;" > "$2"; }
assert_contains() { grep -qF "$2" "$1" || { cat "$1"; echo "FAIL: missing $2" >&2; exit 1; }; }
create 3 "$TMP/create-a" & HOLDER=$!
sleep 1
START=$(date +%s); create 0 "$TMP/create-b"; ELAPSED=$(( $(date +%s)-START )); wait "$HOLDER"
assert_contains "$TMP/create-a" '"replayed": false'; assert_contains "$TMP/create-b" '"replayed": true'
[ "$ELAPSED" -ge 1 ] || { echo 'FAIL: receipt did not wait for commit'; exit 1; }
[ "$(psql_db -c "select count(*) from public.clients where email='race@example.invalid';")" = 1 ]
CLIENT=$(psql_db -c "select client_id from public.client_create_requests where request_id='$REQUEST';")
ATTEMPT=$(psql_db -c "select create_attempt_id from public.client_create_requests where request_id='$REQUEST';")
# Withdrawal holds the shared client row lock. Admission must wait and refuse.
psql_db -c "select r,pg_sleep(3) from (select public.apply_invite_action('$ACTOR','$CLIENT','b0000000-0000-4000-8000-000000000099','switch_off',null,false,null) r offset 0) s;" > "$TMP/off" & HOLDER=$!
sleep 1
START=$(date +%s)
psql_db -c "select public.admit_invite_call('$ACTOR','$ATTEMPT');" > "$TMP/admission"
ELAPSED=$(( $(date +%s)-START )); wait "$HOLDER"
assert_contains "$TMP/admission" '"admitted": false'
[ "$ELAPSED" -ge 1 ] || { echo 'FAIL: admission did not serialize with withdrawal'; exit 1; }
# A selected historical on action never reapplies after later off.
psql_db -c "select public.apply_invite_action('$ACTOR','$CLIENT','b0000000-0000-4000-8000-000000000098','switch_on','$ATTEMPT',false,null);" > "$TMP/on"
psql_db -c "select public.apply_invite_action('$ACTOR','$CLIENT','b0000000-0000-4000-8000-000000000097','switch_off',null,false,null);" > "$TMP/off2"
psql_db -c "select public.apply_invite_action('$ACTOR','$CLIENT','b0000000-0000-4000-8000-000000000098','switch_on','$ATTEMPT',false,null);" > "$TMP/replayed-on"
assert_contains "$TMP/replayed-on" '"replayed": true'
[ "$(psql_db -c "select invited from public.clients where id='$CLIENT';")" = f ]
# Two simultaneous admissions: one lease, one refusal after the winner commits.
psql_db -c "update public.clients set invited=true where id='$CLIENT';" > /dev/null
psql_db -c "select r,pg_sleep(3) from (select public.admit_invite_call('$ACTOR','$ATTEMPT') r offset 0) s;" > "$TMP/lease-a" & HOLDER=$!
sleep 1
psql_db -c "select public.admit_invite_call('$ACTOR','$ATTEMPT');" > "$TMP/lease-b"; wait "$HOLDER"
assert_contains "$TMP/lease-a" '"admitted": true'; assert_contains "$TMP/lease-b" '"admitted": false'
# Different hashes queue behind the same identity and return the original binding.
REQUEST='a0000000-0000-4000-8000-000000000098'
create 3 "$TMP/hash-a" hash-a & HOLDER=$!
sleep 1
create 0 "$TMP/hash-b" hash-b; wait "$HOLDER"
assert_contains "$TMP/hash-a" '"outcome": "created"'; assert_contains "$TMP/hash-b" '"outcome": "request_mismatch"'
# Finish the first (fictional) admitted call as uncertain, then race two resend identities.
psql_db -c "select public.complete_invite_call('$ATTEMPT',(select lease_token from public.client_invite_attempts where id='$ATTEMPT'),'{\"kind\":\"unknown\",\"code\":\"timeout\"}');" > /dev/null
psql_db -c "select r,pg_sleep(3) from (select public.apply_invite_action('$ACTOR','$CLIENT','b0000000-0000-4000-8000-000000000096','resend','$ATTEMPT',false,null) r offset 0) s;" > "$TMP/resend-a" & HOLDER=$!
sleep 1
psql_db -c "select public.apply_invite_action('$ACTOR','$CLIENT','b0000000-0000-4000-8000-000000000095','resend','$ATTEMPT',false,null);" > "$TMP/resend-b"; wait "$HOLDER"
assert_contains "$TMP/resend-a" "$ATTEMPT"; assert_contains "$TMP/resend-b" "$ATTEMPT"
[ "$(psql_db -c "select count(*) from public.client_invite_attempts where client_id='$CLIENT';")" = 1 ]
# These ordinary profile writes use the same row lock as admission.
blocked_by_update() {
  psql_db -c "begin; $2; select pg_sleep(3); commit;" > "$TMP/$1-update" & HOLDER=$!
  sleep 1
  psql_db -c "select public.admit_invite_call('$ACTOR','$ATTEMPT');" > "$TMP/$1-admit"; wait "$HOLDER"
  assert_contains "$TMP/$1-admit" '"admitted": false'
  psql_db -c "$3" > /dev/null
}
blocked_by_update archive "update public.clients set archived=true where id='$CLIENT'" "update public.clients set archived=false where id='$CLIENT'"
blocked_by_update email "update public.clients set email='changed@example.invalid' where id='$CLIENT'" "update public.clients set email='race@example.invalid' where id='$CLIENT'"
psql_db -c "insert into public.coaches(id,name,email) values ('10000000-0000-4000-8000-0000000000e2','Other Fictional','other-race@example.invalid');" > /dev/null
blocked_by_update reassign "update public.clients set coach_id='10000000-0000-4000-8000-0000000000e2' where id='$CLIENT'" "update public.clients set coach_id='$ACTOR' where id='$CLIENT'"
psql_db -c "insert into auth.users(id) values ('d0000000-0000-4000-8000-000000000099'),('d0000000-0000-4000-8000-000000000091');" > /dev/null
blocked_by_update claim "update public.clients set auth_user_id='d0000000-0000-4000-8000-000000000099' where id='$CLIENT'" "update public.clients set auth_user_id=null where id='$CLIENT'"
echo 'Committed receipt, withdrawal/admission and lease races PASS'
# Opposite order: admission commits first, then a claim/withdrawal waits for its lock.
for MUTATION in claim off archive email reassign; do
  case "$MUTATION" in
    claim) SUFFIX=91; WRITE="auth_user_id='d0000000-0000-4000-8000-000000000091'";;
    off) SUFFIX=92; WRITE='invited=false';;
    archive) SUFFIX=93; WRITE='archived=true';;
    email) SUFFIX=94; WRITE="email='changed@example.invalid'";;
    reassign) SUFFIX=95; WRITE="coach_id='10000000-0000-4000-8000-0000000000e2'";;
  esac
  REQUEST="a0000000-0000-4000-8000-0000000000$SUFFIX"
  create 0 "$TMP/$MUTATION-created"
  NEXT_CLIENT=$(psql_db -c "select client_id from public.client_create_requests where request_id='$REQUEST';")
  NEXT_ATTEMPT=$(psql_db -c "select create_attempt_id from public.client_create_requests where request_id='$REQUEST';")
  psql_db -c "select r,pg_sleep(3) from (select public.admit_invite_call('$ACTOR','$NEXT_ATTEMPT') r offset 0) s;" > "$TMP/$MUTATION-first" & HOLDER=$!
  sleep 1
  START=$(date +%s);psql_db -c "update public.clients set $WRITE where id='$NEXT_CLIENT';" > /dev/null
  ELAPSED=$(( $(date +%s)-START ));wait "$HOLDER"
  [ "$ELAPSED" -ge 1 ] || { echo "FAIL: $MUTATION did not wait for admission"; exit 1; }
  assert_contains "$TMP/$MUTATION-first" '"admitted": true'
  psql_db -c "select public.complete_invite_call('$NEXT_ATTEMPT',(select lease_token from public.client_invite_attempts where id='$NEXT_ATTEMPT'),'{\"kind\":\"accepted\",\"provider_message_id\":\"c0000000-0000-4000-8000-000000000099\"}');" > "$TMP/$MUTATION-completed"
  assert_contains "$TMP/$MUTATION-completed" '"status": "accepted"'
  if [ "$MUTATION" = off ]; then [ "$(psql_db -c "select invited from public.clients where id='$NEXT_CLIENT';")" = f ]; fi
  psql_db -c "select public.admit_invite_call('$ACTOR','$NEXT_ATTEMPT');" > "$TMP/$MUTATION-later"
  assert_contains "$TMP/$MUTATION-later" '"admitted": false'
done
echo 'Admission-before-claim and admission-before-withdrawal races PASS'
# Accepted prior attempt: two new resend intents cannot allocate two new provider keys.
psql_db -c "select public.admit_invite_call('$ACTOR','$ATTEMPT');" > /dev/null
psql_db -c "select public.complete_invite_call('$ATTEMPT',(select lease_token from public.client_invite_attempts where id='$ATTEMPT'),'{\"kind\":\"accepted\",\"provider_message_id\":\"c0000000-0000-4000-8000-000000000098\"}');" > /dev/null
psql_db -c "select r,pg_sleep(3) from (select public.apply_invite_action('$ACTOR','$CLIENT','b0000000-0000-4000-8000-000000000094','resend','$ATTEMPT',false,'$PROVIDER_BODY') r offset 0) s;" > "$TMP/new-resend-a" & HOLDER=$!
sleep 1
psql_db -c "select public.apply_invite_action('$ACTOR','$CLIENT','b0000000-0000-4000-8000-000000000093','resend','$ATTEMPT',false,'$PROVIDER_BODY');" > "$TMP/new-resend-b";wait "$HOLDER"
assert_contains "$TMP/new-resend-a" '"outcome": "selected"';assert_contains "$TMP/new-resend-b" '"outcome": "stale"'
[ "$(psql_db -c "select count(*) from public.client_invite_attempts where client_id='$CLIENT';")" = 2 ]
# The claim route's existing conditional UPDATE must serialize with withdrawal.
for ORDER in off_first claim_first; do
  if [ "$ORDER" = off_first ]; then REQUEST='a0000000-0000-4000-8000-000000000088'; ACTION='b0000000-0000-4000-8000-000000000088'; else REQUEST='a0000000-0000-4000-8000-000000000087'; ACTION='b0000000-0000-4000-8000-000000000087'; fi
  create 0 "$TMP/$ORDER-created"
  CLAIM_CLIENT=$(psql_db -c "select client_id from public.client_create_requests where request_id='$REQUEST';")
  CLAIM_SQL="update public.clients set auth_user_id='d0000000-0000-4000-8000-000000000099' where id='$CLAIM_CLIENT' and invited=true and auth_user_id is null and archived=false"
  OFF_SQL="select public.apply_invite_action('$ACTOR','$CLAIM_CLIENT','$ACTION','switch_off',null,false,null)"
  if [ "$ORDER" = off_first ]; then FIRST="$OFF_SQL"; SECOND="$CLAIM_SQL"; else FIRST="$CLAIM_SQL"; SECOND="$OFF_SQL"; fi
  psql_db -c "begin; $FIRST; select pg_sleep(3); commit;" > "$TMP/$ORDER-first" & HOLDER=$!
  sleep 1;psql_db -c "$SECOND" > "$TMP/$ORDER-second";wait "$HOLDER"
  if [ "$ORDER" = off_first ]; then
    [ "$(psql_db -c "select auth_user_id is null and not invited from public.clients where id='$CLAIM_CLIENT';")" = t ]
  else
    assert_contains "$TMP/$ORDER-second" '"outcome": "already_claimed"'
    [ "$(psql_db -c "select auth_user_id is not null and invited from public.clients where id='$CLAIM_CLIENT';")" = t ]
  fi
done
echo 'New-attempt resend and conditional claim/withdrawal races PASS'
