#!/usr/bin/env bash
# Committed two-connection races for the whole-week RPCs on a THROWAWAY local
# PostgreSQL cluster: initdb into a fresh temp dir, unix socket only (no TCP
# listener), destroyed on exit. It accepts no URL/host/project argument, clears
# libpq environment overrides and never touches an existing database.
# Requires local PostgreSQL server binaries (initdb, pg_ctl, psql) on PATH.
set -euo pipefail
for bin in initdb pg_ctl psql; do
  command -v "$bin" >/dev/null 2>&1 || { echo "BLOCKED-ENVIRONMENT: $bin not on PATH"; exit 2; }
done
unset PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER PGPASSWORD PGSERVICE PGSERVICEFILE PGPASSFILE DATABASE_URL
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../.." && pwd)"
migration="$(ls "$root"/supabase/migrations/*_whole_week_outside_activity.sql)"
# Short path: unix socket paths are limited to ~100 bytes on macOS.
work="$(mktemp -d /tmp/cvf-ww-XXXXXX)"
cleanup() { pg_ctl -D "$work/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT
initdb -D "$work/data" -U postgres -A trust --no-sync >/dev/null
port=$(( 20000 + RANDOM % 20000 ))
pg_ctl -D "$work/data" -o "-k $work -c listen_addresses='' -p $port" -l "$work/server.log" -w start >/dev/null
q() { psql -X -q -t -A -v ON_ERROR_STOP=1 -h "$work" -p "$port" -U postgres -d postgres "$@"; }
id() { printf '00000000-0000-4000-8000-%012d' "$1"; }
fail() { echo "FAIL: $*"; exit 1; }
pass() { echo "PASS: $*"; }

q -f "$here/schema.sql" >/dev/null
q -f "$migration" >/dev/null
q >/dev/null <<SQL
insert into auth.users(id) values ('$(id 101)'),('$(id 102)'),('$(id 103)'),('$(id 111)');
insert into public.coaches(id,auth_user_id,name,email,is_admin) values
 ('$(id 1)','$(id 101)','Week Coach','week-coach@example.invalid',false),
 ('$(id 2)','$(id 102)','Other Coach','other-coach@example.invalid',false),
 ('$(id 3)','$(id 103)','Admin Coach','admin-coach@example.invalid',true);
insert into public.clients(id,coach_id,name,auth_user_id) values ('$(id 11)','$(id 1)','Week Client','$(id 111)');
insert into public.client_context_preferences(client_id,activity_coach_enabled,updated_by_role,updated_by_id) values ('$(id 11)',true,'coach','$(id 1)');
SQL

create_req() { printf '{"action":"create","request_id":"%s","revision":0,"fields":{"activity_type":"run","occurred_on":"2026-03-03","duration_seconds":1800}}' "$(id "$1")"; }
update_req() { printf '{"action":"update","request_id":"%s","revision":%s,"fields":{"activity_type":"run","occurred_on":"2026-03-03","label":null,"duration_seconds":%s,"effort_rpe":null,"note":null}}' "$(id "$1")" "$2" "$3"; }
# Session A holds its transaction open for 2s before committing; B starts 0.7s in.
hold() { q >"$work/$1" 2>&1 <<SQL &
begin;
$2;
select pg_sleep(2);
commit;
SQL
}

# 1. Same request replayed while the original is still in flight: one row, B replays.
hold a1 "set local role service_role; select public.mutate_outside_activity('$(id 111)','$(id 11)',null,'$(create_req 901)')"
sleep 0.7
b1=$(q -c "set role service_role" -c "select public.mutate_outside_activity('$(id 111)','$(id 11)',null,'$(create_req 901)')->>'replayed'" 2>&1)
wait
[ "$b1" = "true" ] || fail "in-flight replay should wait and replay, got: $b1"
[ "$(q -c "select count(*) from public.outside_activities")" = "1" ] || fail "in-flight replay created a second row"
[ "$(q -c "select count(*) from public.outside_activity_receipts where request_id='$(id 901)'")" = "1" ] || fail "receipt count"
pass "same request in flight commits once; the waiting replay returns the receipt"
activity=$(q -c "select activity_id from public.outside_activity_receipts where request_id='$(id 901)'")

# 2. Two devices both edit revision 1: the second waits, then fails without overwriting.
hold a2 "set local role service_role; select public.mutate_outside_activity('$(id 111)',null,'$activity','$(update_req 902 1 2400)')"
sleep 0.7
b2=$(q -c "set role service_role" -c "select public.mutate_outside_activity('$(id 101)',null,'$activity','$(update_req 903 1 600)')" 2>&1 || true)
wait
grep -q 'revision_conflict' <<<"$b2" || fail "stale concurrent edit should conflict, got: $b2"
[ "$(q -c "select duration_seconds||':'||revision from public.outside_activities where id='$activity'")" = "2400:2" ] || fail "stale edit overwrote the winner"
pass "simultaneous stale revision edits: one winner, one revision_conflict"

# 3. Reassignment commits while coach A's write waits on the client row lock: A is refused.
hold a3 "update public.clients set coach_id='$(id 2)' where id='$(id 11)'"
sleep 0.7
b3=$(q -c "set role service_role" -c "select public.mutate_outside_activity('$(id 101)','$(id 11)',null,'$(create_req 904)')" 2>&1 || true)
wait
grep -q 'Client week not found' <<<"$b3" || fail "write racing a reassignment should be refused after it, got: $b3"
[ "$(q -c "select count(*) from public.outside_activity_receipts where request_id='$(id 904)'")" = "0" ] || fail "refused write left a receipt"
pass "ownership change committed first: the former coach's waiting write is refused (404)"

# 4. Admin demotion commits while the admin's write waits on the coach row: refused.
hold a4 "update public.coaches set is_admin=false where id='$(id 3)'"
sleep 0.7
b4=$(q -c "set role service_role" -c "select public.mutate_outside_activity('$(id 103)','$(id 11)',null,'$(create_req 905)')" 2>&1 || true)
wait
grep -q 'Client week not found' <<<"$b4" || fail "write racing a role change should see the new role, got: $b4"
pass "active role change committed first: the waiting admin write is refused (404)"

# 5. Client opt-out commits while the coach's on-behalf create waits: collection_off.
hold a5 "set local role service_role; select public.save_context_preferences('$(id 111)','$(id 11)','{\"revision\":1,\"activity_client_off\":true}')"
sleep 0.7
b5=$(q -c "set role service_role" -c "select public.mutate_outside_activity('$(id 102)','$(id 11)',null,'$(create_req 906)')" 2>&1 || true)
wait
grep -q 'collection_off' <<<"$b5" || fail "on-behalf create racing an opt-out should be refused, got: $b5"
[ "$(q -c "select count(*) from public.outside_activities where not archived")" = "1" ] || fail "opt-out race created a row"
pass "client opt-out committed first: the waiting coach-on-behalf create is refused"

for f in a1 a2 a3 a4 a5; do grep -q 'ERROR' "$work/$f" && fail "holding session $f errored: $(cat "$work/$f")"; done
echo "PASS whole-week committed races (5) on a throwaway local cluster"
