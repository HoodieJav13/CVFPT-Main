#!/usr/bin/env bash
# Real two-connection races for set value origin (local migration
# 20261113000000_set_value_origin.sql: apply_workout_set_event_v2, the
# set_value_origin_guard trigger and the backend's plan-propagation filter)
# against a NEW, disposable PostgreSQL 17 cluster that this run creates, owns
# and deletes. Uses the ownership-guarded disposal (cluster_guard.sh) and lock
# handshake (race_helpers.sql) kept next to this script, byte-identical to the
# cockpit harness copies they came from.
#
#   bash supabase/tests/value_origin/local-concurrency.sh
#
# Safety: no TCP (listen_addresses = ''), one 0700
# Unix socket .s.PGSQL.1 in the candidate root that must not pre-exist, ambient
# PG* variables cleared, data_directory verified, bounded waits, and an exit
# trap that disposes only a verified run-owned cluster. Evidence goes to
# evidence/pt-full-undo-20261112/cross-device-impl/pg17-races/run-<id>/ (or
# another direct child of that folder named by VALUE_ORIGIN_RACE_EVIDENCE_DIR).
#
# This proves PostgreSQL row-lock behaviour with a synthetic superuser and
# fictional fixtures. It is not evidence of hosted authentication, RLS or
# PostgREST behaviour.
set -uo pipefail

PGBIN="/opt/homebrew/opt/postgresql@17/bin"
ROOT="$(cd "$(dirname "$0")/../../.." && pwd -P)"
TESTDIR="$ROOT/supabase/tests/value_origin"
GUARDDIR="$TESTDIR"
MIG="$ROOT/supabase/migrations"
EVPARENT="$ROOT/evidence/pt-full-undo-20261112/cross-device-impl"
EVID="${VALUE_ORIGIN_RACE_EVIDENCE_DIR:-$EVPARENT/pg17-races}"
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
RUNDIR="$EVID/run-$RUN_ID"
DATA="$RUNDIR/data"
PORT=1
SOCK="$ROOT/.s.PGSQL.$PORT"
MARK="cvfpt-value-origin-race-cluster $RUN_ID"
FN="public.apply_workout_set_event_v2(uuid,uuid,text,uuid,integer,integer,boolean,integer,jsonb,text)"
VOMIG="$MIG/20261113000000_set_value_origin.sql"
STARTED=0
START_ATTEMPTED=0
PGPID=""
CREATED_DBS=""
PASSES=0
FAILS=0

# Ambient connection selectors must never pick the server.
for v in PGHOST PGHOSTADDR PGPORT PGUSER PGDATABASE PGSERVICE PGSERVICEFILE PGPASSWORD PGPASSFILE PGAPPNAME \
         PGOPTIONS PGSSLMODE PGSYSCONFDIR PGCONNECT_TIMEOUT PGTARGETSESSIONATTRS PGREQUIRESSL PGCLIENTENCODING \
         PGDATA PGLOCALEDIR PGGSSENCMODE PGKRBSRVNAME PGTZ PGDATESTYLE; do unset "$v"; done

log() { echo "[$(date -u +%H:%M:%S)] $*"; }
die() { echo "ABORT: $*" >&2; exit 1; }

# ---------- Prechecks (nothing created yet) ----------
[ -x "$PGBIN/postgres" ] && [ -x "$PGBIN/initdb" ] && [ -x "$PGBIN/pg_ctl" ] && [ -x "$PGBIN/psql" ] || die "PostgreSQL 17 programs not found in $PGBIN"
VERSION="$("$PGBIN/postgres" --version)"
case "$VERSION" in *" 17."*) ;; *) die "need PostgreSQL 17, found: $VERSION" ;; esac
[ "${#SOCK}" -lt 104 ] || die "socket path ${#SOCK} bytes exceeds the macOS limit: $SOCK"
if [ -e "$SOCK" ] || [ -e "$SOCK.lock" ]; then die "refusing: $SOCK or its lock already exists; it is not ours and is not replaced"; fi
case "$(basename "$EVID")" in .|..|"") die "invalid evidence directory: $EVID" ;; esac
[ "$(dirname "$EVID")" = "$EVPARENT" ] || die "evidence directory must be a direct child of $EVPARENT: $EVID"
mkdir -p "$EVID" || die "cannot create $EVID"
[ "$(cd "$EVID" && pwd -P)" = "$EVID" ] || die "evidence directory resolves elsewhere (symlink?): $EVID"
mkdir "$RUNDIR" || die "run directory already exists: $RUNDIR"
mkdir -p "$RUNDIR/home" "$RUNDIR/races" "$RUNDIR/migrations"
export HOME="$RUNDIR/home"
echo "$MARK" > "$RUNDIR/OWNER"
RESULTS="$RUNDIR/RESULTS.tsv"
: > "$RESULTS"

connstr() { printf 'host=%s port=%s user=postgres dbname=%s application_name=%s connect_timeout=10' "$ROOT" "$PORT" "$1" "$2"; }
sqlx() { local db="$1" app="$2"; shift 2; "$PGBIN/psql" "$(connstr "$db" "$app")" -X -q -At -v ON_ERROR_STOP=1 "$@"; }
sql() { local db="$1"; shift; sqlx "$db" race_admin "$@"; }
check() {
  if [ "$2" = "$3" ]; then PASSES=$((PASSES + 1)); printf 'PASS\t%s\t%s\n' "$1" "$2" | tee -a "$RESULTS"
  else FAILS=$((FAILS + 1)); printf 'FAIL\t%s\tgot=%s\texpected=%s\n' "$1" "$2" "$3" | tee -a "$RESULTS"; fi
}
. "$GUARDDIR/cluster_guard.sh" || die "cannot load cluster_guard.sh"

# ---------- Cleanup (exit trap) ----------
cleanup() {
  local rc=$? clean_fail=0 D="$RUNDIR/DISPOSAL.txt"
  trap - EXIT
  set +e
  {
    echo "run_id: $RUN_ID"
    echo "cleanup_start_utc: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "exit_code_before_cleanup: $rc"
  } >> "$D"
  guard_dispose "$D" || clean_fail=1
  echo "cleanup_end_utc: $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$D"
  if [ "$clean_fail" = 0 ]; then echo "cleanup_result: ok" >> "$D"; else echo "cleanup_result: FAILED" >> "$D"; fi
  echo "--- disposal record ($D)"; cat "$D"
  if [ "$rc" = 0 ] && [ "$clean_fail" = 1 ]; then rc=1; fi
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# ---------- Source identity ----------
{
  echo "run_id: $RUN_ID"
  echo "start_utc: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "postgres: $VERSION ($PGBIN)"
  echo "head: $(git -C "$ROOT" rev-parse HEAD)"
  echo "evidence_dir: $EVID"
  echo "migrations: $(ls "$MIG"/*.sql | wc -l | tr -d ' ') files, combined sha256 $(cat "$MIG"/*.sql | shasum -a 256 | cut -c1-64)"
  if [ -f "$VOMIG" ]; then echo "value origin migration sha256: $(shasum -a 256 "$VOMIG" | cut -c1-64)"; else echo "value origin migration: ABSENT"; fi
  for f in local-concurrency.sh fixtures.sql; do echo "harness $f sha256: $(shasum -a 256 "$TESTDIR/$f" | cut -c1-64)"; done
  for f in cluster_guard.sh race_helpers.sql; do echo "reused $f sha256: $(shasum -a 256 "$GUARDDIR/$f" | cut -c1-64)"; done
  echo "pr120 fixtures sha256: $(shasum -a 256 "$ROOT/supabase/tests/pr120_repairs/fixtures.sql" | cut -c1-64)"
} > "$RUNDIR/SOURCE.txt"
cat "$RUNDIR/SOURCE.txt"

# ---------- New disposable cluster ----------
log "initdb $DATA"
"$PGBIN/initdb" -D "$DATA" -U postgres --auth-local=trust --auth-host=reject --no-locale -E UTF8 > "$RUNDIR/initdb.log" 2>&1 \
  || { tail -20 "$RUNDIR/initdb.log"; die "initdb failed"; }
echo "$MARK" > "$DATA/COCKPIT_TEST_OWNER" || die "cannot write ownership marker"
cat >> "$DATA/postgresql.conf" <<EOF

# value origin race run $RUN_ID: no TCP; owner-only Unix socket inside the candidate
listen_addresses = ''
port = $PORT
unix_socket_directories = '$ROOT'
unix_socket_permissions = 0700
deadlock_timeout = '1s'
log_lock_waits = on
log_line_prefix = '%m [%p] %a '
EOF
log "starting the run-owned server"
START_ATTEMPTED=1
"$PGBIN/pg_ctl" -D "$DATA" -l "$RUNDIR/server.log" -w -t 30 start > "$RUNDIR/pg_ctl-start.log" 2>&1
start_rc=$?
if [ -f "$DATA/postmaster.pid" ]; then PGPID="$(head -1 "$DATA/postmaster.pid")"; STARTED=1; fi
[ "$start_rc" = 0 ] || { cat "$RUNDIR/pg_ctl-start.log"; tail -20 "$RUNDIR/server.log"; die "pg_ctl start failed ($start_rc)"; }

DD="$(sql postgres -c 'show data_directory')" || die "cannot query the run-owned server"
[ "$DD" = "$(cd "$DATA" && pwd -P)" ] || die "server data_directory '$DD' is not this run's cluster"
LA="$(sql postgres -c 'show listen_addresses')" || die "show listen_addresses failed"
SP="$(sql postgres -c 'show unix_socket_permissions')" || die "show unix_socket_permissions failed"
SPORT="$(sql postgres -c 'show port')" || die "show port failed"
[ -z "$LA" ] || die "listen_addresses is '$LA', expected empty"
[ "$SP" = "0700" ] || die "unix_socket_permissions is $SP"
SOCK_MODE="$(stat -f '%Sp' "$SOCK")" || die "socket $SOCK missing"
[ "$SOCK_MODE" = "srwx------" ] || die "socket mode is $SOCK_MODE"
TCP_LISTEN="$(lsof -nP -a -p "$PGPID" -iTCP 2>/dev/null | tail -n +2)"
[ -z "$TCP_LISTEN" ] || die "the server has TCP sockets: $TCP_LISTEN"
{
  echo "postmaster_pid: $PGPID"
  echo "postmaster_command: $(ps -o command= -p "$PGPID")"
  echo "data_directory: $DD"
  echo "listen_addresses: '$LA'"
  echo "port: $SPORT (socket suffix only)"
  echo "unix_socket_permissions: $SP"
  echo "socket: $SOCK ($SOCK_MODE)"
  echo "tcp_sockets_of_server: none"
} | tee "$RUNDIR/CLUSTER.txt"
guard_cmd_ok || die "postmaster $PGPID does not run postgres -D $DATA"

# ---------- Template: stand-ins, all migrations, fixtures, helper ----------
sql postgres -c "create database vo_template" > /dev/null || die "create template failed"
CREATED_DBS="$CREATED_DBS vo_template"
# Minimal Supabase stand-ins, as in ../pr121_concurrency/concurrency.sh.
sql vo_template > "$RUNDIR/standins.log" 2>&1 <<'SQL' || { cat "$RUNDIR/standins.log"; die "stand-ins failed"; }
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users(id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql as 'select null::uuid';
create schema if not exists extensions;
create schema if not exists storage;
create table if not exists storage.buckets(id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[], owner uuid, created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid, metadata jsonb, path_tokens text[], version text, created_at timestamptz default now(), updated_at timestamptz default now(), last_accessed_at timestamptz);
create or replace function storage.foldername(name text) returns text[] language sql as 'select string_to_array(name, ''/'')';
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
do $$ begin if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then create publication supabase_realtime; end if; end $$;
SQL
n=0
for f in "$MIG"/*.sql; do
  b="$(basename "$f")"
  if ! sql vo_template -f "$f" > "$RUNDIR/migrations/$b.log" 2>&1; then
    echo "migration FAILED: $b"; tail -20 "$RUNDIR/migrations/$b.log"; die "migration $b failed"
  fi
  n=$((n + 1))
done
log "applied $n migrations"
check "template: every migration applied" "$n" "$(ls "$MIG"/*.sql | wc -l | tr -d ' ')"
check "template: extensions present" "$(sql vo_template -c "select string_agg(extname, ',' order by extname) from pg_extension where extname in ('btree_gist','pgcrypto')")" "btree_gist,pgcrypto"
sql vo_template -f "$ROOT/supabase/tests/pr120_repairs/fixtures.sql" > "$RUNDIR/fixtures-pr120.log" 2>&1 || { cat "$RUNDIR/fixtures-pr120.log"; die "pr120 fixtures failed"; }
sql vo_template -f "$TESTDIR/fixtures.sql" > "$RUNDIR/fixtures-value-origin.log" 2>&1 || { cat "$RUNDIR/fixtures-value-origin.log"; die "value origin fixtures failed"; }
sql vo_template -f "$GUARDDIR/race_helpers.sql" > "$RUNDIR/race-helpers.log" 2>&1 || { cat "$RUNDIR/race-helpers.log"; die "race helper failed"; }
V2="$(sql vo_template -c "select count(*) from pg_proc where oid = to_regprocedure('$FN')")"
check "template: apply_workout_set_event_v2 present" "$V2" "1"
if [ "$V2" = 1 ]; then
  sql vo_template -c "select pg_get_functiondef('$FN'::regprocedure)" > "$RUNDIR/function-real.sql" || die "cannot read the real function"
  echo "real v2 md5: $(sql vo_template -c "select md5(pg_get_functiondef('$FN'::regprocedure))")" | tee -a "$RUNDIR/SOURCE.txt"
fi

# ---------- Race machinery ----------
fresh() { sql postgres -c "create database \"$1\" template vo_template" > /dev/null || die "create database $1 failed"; CREATED_DBS="$CREATED_DBS $1"; }
q() { sql "$1" -c "$2"; }
wait_deadline() {  # pid seconds -> the process exit code, or 124 after killing it at the deadline
  local pid="$1" limit=$(( $2 * 10 )) t=0
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$t" -ge "$limit" ]; then kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null; return 124; fi
    sleep 0.1; t=$((t + 1))
  done
  wait "$pid"
}

# race <name> <db> <holder work> <holder after handshake> <challenger sql> [handshake timeout s]
# Sets: HRC, CRC (exit codes), HS (BLOCKED / NOT_BLOCKED / none), HOUT, COUT (output files).
race() {
  local name="$1" db="$2" hwork="$3" hafter="$4" challenger="$5" hs_timeout="${6:-15}"
  local dir="$RUNDIR/races/$name" happ="hd_$1" capp="ch_$1" hpid cpid ready=no i c
  mkdir -p "$dir"
  cat > "$dir/holder.sql" <<EOF
set statement_timeout = '45s';
set lock_timeout = '40s';
begin;
$hwork
select 'HOLDER_PID ' || pg_backend_pid();
select 'HANDSHAKE ' || race_test.wait_for_blocked('$capp', $hs_timeout);
$hafter
select 'HOLDER_END ' || extract(epoch from clock_timestamp());
commit;
EOF
  cat > "$dir/challenger.sql" <<EOF
set statement_timeout = '45s';
set lock_timeout = '40s';
select 'CHALLENGER_START ' || extract(epoch from clock_timestamp());
$challenger
select 'CHALLENGER_END ' || extract(epoch from clock_timestamp());
EOF
  HOUT="$dir/holder.out"; COUT="$dir/challenger.out"
  sqlx "$db" "$happ" -f "$dir/holder.sql" > "$HOUT" 2>&1 &
  hpid=$!
  # The challenger starts only once the holder's work is done and it sits in
  # the handshake with its transaction open.
  for i in $(seq 1 200); do
    kill -0 "$hpid" 2>/dev/null || break
    c="$(sql postgres -c "select count(*) from pg_stat_activity where application_name = '$happ' and state = 'active' and query like '%race_test.wait_for_blocked%'" 2>> "$dir/poll.err")"
    if [ "$c" = 1 ]; then ready=yes; break; fi
    sleep 0.1
  done
  if [ "$ready" = yes ]; then
    sqlx "$db" "$capp" -f "$dir/challenger.sql" > "$COUT" 2>&1 &
    cpid=$!
    wait_deadline "$cpid" 60; CRC=$?
  else
    CRC="not_started"; : > "$COUT"
  fi
  wait_deadline "$hpid" 60; HRC=$?
  HS="$(grep '^HANDSHAKE ' "$HOUT" | head -1 | cut -d' ' -f2)"; HS="${HS:-none}"
  { echo "holder_ready: $ready"; echo "holder_exit: $HRC"; echo "challenger_exit: $CRC"; grep '^HANDSHAKE ' "$HOUT"; } > "$dir/meta.txt"
  log "$name: holder_ready=$ready holder_exit=$HRC challenger_exit=$CRC $(grep '^HANDSHAKE ' "$HOUT" | head -1)"
  check "$name: holder reached its handshake" "$ready" "yes"
  HERR="$(grep -c 'ERROR' "$HOUT")"; CERR="$(grep -c 'ERROR' "$COUT")"
}
# Sessions that must succeed have no ERROR line at all.
no_errors() { check "$1 no ERROR in either session" "$HERR/$CERR" "0/0"; }

# ---------- Value origin races ----------
EX="00000000-0000-4000-8000-0000000e0001"
S2="00000000-0000-4000-8000-0000000f0002"; S3="00000000-0000-4000-8000-0000000f0003"
COACH="00000000-0000-4000-8000-000000000001"
EV() { printf '00000000-0000-4000-8000-0000000c%04d' "$1"; }
# v2 <label> <set> <event#> <role> <coach|null> <base> <payload json> <origin>
v2() {
  local coach="null"; [ "$5" = null ] || coach="'$5'"
  echo "select '$1 ' || (public.apply_workout_set_event_v2('$2', '$(EV "$3")', '$4', $coach, $6, $3, false, 0, '$7'::jsonb, '$8') ->> 'outcome');"
}
QC='{"status":"completed","actual_load_value":null,"actual_load_unit":null,"actual_reps":null,"actual_rpe":null}'
UNDO50='{"status":"pending","actual_load_value":50,"actual_load_unit":"lb","actual_reps":null,"actual_rpe":null}'
# The backend's new plan propagation, as one statement pair.
PROPAGATE="update public.workout_log_exercises set prescribed_load_value = 60, plan_revision = plan_revision + 1 where id = '$EX';
update public.workout_log_sets set actual_load_value = 60, actual_load_unit = 'lb', value_origin = 'prefill', value_origin_nonce = gen_random_uuid(), updated_at = now()
 where workout_log_exercise_id = '$EX' and status = 'pending' and not archived
   and (value_origin = 'prefill' or (value_origin = 'legacy' and revision = 0 and last_actor_role is null));"
LEGACY_PATCH="update public.workout_log_sets set actual_load_value = 55, entered_by = 'client', updated_at = now() where id = '$S2';"
row() { q "$1" "select status || '/' || coalesce(actual_load_value::text, 'null') || '/' || value_origin || '/' || revision from public.workout_log_sets where id = '$2'"; }
said() { grep -c "^$2$" "$1"; }
qc_setup() { q "$1" "$(v2 SETUP "$S2" 1 client null 0 "$QC" entered)" | grep -q '^SETUP applied$' || die "setup quick complete failed in $1"; }

if [ "$V2" = 1 ]; then
# R1. Undo (prefill) holds the set while the coach's plan edit runs. The plan
# UPDATE evaluates the committed row, which is still completed, so it neither
# waits nor touches it: the prescription changed while the set was completed,
# and the Undo keeps the previous prefill value and its meaning (coordinator
# rule), never the new prescription and never a performed value. (A first
# draft of this race expected a wait and the new value; that was wrong.)
fresh vo_r1; qc_setup vo_r1
race R1 vo_r1 "$(v2 UNDO "$S2" 11 client null 1 "$UNDO50" prefill)" "" "$PROPAGATE" 6
check "R1 exits" "$HRC/$CRC" "0/0"; no_errors R1
check "R1 plan edit does not wait on the completed set" "$HS" "NOT_BLOCKED"
check "R1 Undo applied" "$(said "$HOUT" 'UNDO applied')" "1"
check "R1 set = previous prefill, prefill" "$(row vo_r1 "$S2")" "pending/50/prefill/2"
check "R1 prescription changed" "$(q vo_r1 "select prescribed_load_value::int from public.workout_log_exercises where id = '$EX'")" "60"

# R2. The plan edit holds an untouched set; the person's explicit write lands
# after it and is kept as entered (never overwritten by the prescription).
fresh vo_r2
race R2 vo_r2 "$PROPAGATE" "" "$(v2 TYPED "$S3" 12 client null 0 '{"actual_load_value":55,"actual_load_unit":"lb"}' entered)"
check "R2 exits" "$HRC/$CRC" "0/0"; no_errors R2
check "R2 explicit write blocked by the plan edit" "$HS" "BLOCKED"
check "R2 explicit write applied" "$(said "$COUT" 'TYPED applied')" "1"
check "R2 set = typed value, entered" "$(row vo_r2 "$S3")" "pending/55/entered/1"

# R3. The coach's explicit value holds; the client's Undo at the same base is a
# retained conflict and the coach's value stays entered.
fresh vo_r3; qc_setup vo_r3
race R3 vo_r3 "$(v2 COACHSET "$S2" 13 coach "$COACH" 1 '{"status":"completed","actual_load_value":60,"actual_load_unit":"lb"}' entered)" "" "$(v2 UNDO "$S2" 14 client null 1 "$UNDO50" prefill)"
check "R3 exits" "$HRC/$CRC" "0/0"; no_errors R3
check "R3 Undo blocked by the coach write" "$HS" "BLOCKED"
check "R3 Undo kept as a conflict" "$(said "$COUT" 'UNDO conflict')" "1"
check "R3 set = coach value, entered" "$(row vo_r3 "$S2")" "completed/60/entered/2"

# R4. Another device of the same client saves an explicit value first; this
# device's Undo still applies (same-actor rule) but cannot claim prefill: the
# snapshot was cleared by the explicit write, so the set is unknown (gated).
fresh vo_r4; qc_setup vo_r4
race R4 vo_r4 "$(v2 OTHERDEVICE "$S2" 15 client null 1 '{"status":"pending","actual_load_value":55,"actual_load_unit":"lb"}' entered)" "" "$(v2 UNDO "$S2" 16 client null 1 "$UNDO50" prefill)"
check "R4 exits" "$HRC/$CRC" "0/0"; no_errors R4
check "R4 Undo blocked by the other device" "$HS" "BLOCKED"
check "R4 Undo applied" "$(said "$COUT" 'UNDO applied')" "1"
check "R4 set = Undo value, unknown (not prefill)" "$(row vo_r4 "$S2")" "pending/50/unknown/3"

# R4 negative control: a v2 that keeps the old snapshot across an explicit
# write lets the late Undo claim prefill.
fresh vo_r4_neg; qc_setup vo_r4_neg
dir="$RUNDIR/races/vo_r4_neg-function"; mkdir -p "$dir"
q vo_r4_neg "select pg_get_functiondef('$FN'::regprocedure)" > "$dir/before.sql" || die "read v2 failed"
python3 - "$dir/before.sql" "$dir/mutant.sql" <<'PY' || die "mutation not applicable"
import sys
t = open(sys.argv[1]).read()
for old, new in [("then v_set.actual_load_value else null end", "then v_set.actual_load_value else v_set.prefill_load_value end"),
                 ("then v_set.actual_load_unit else null end", "then v_set.actual_load_unit else v_set.prefill_load_unit end")]:
    if t.count(old) != 1: sys.exit(f"expected one {old!r}, found {t.count(old)}")
    t = t.replace(old, new)
open(sys.argv[2], "w").write(t)
PY
sql vo_r4_neg -f "$dir/mutant.sql" > "$dir/apply.log" 2>&1 || { cat "$dir/apply.log"; die "installing mutant failed"; }
q vo_r4_neg "select pg_get_functiondef('$FN'::regprocedure)" > "$dir/after.sql"; diff -u "$dir/before.sql" "$dir/after.sql" > "$dir/mutation.diff"
check "R4_neg mutant installed only in this clone" "$(cmp -s "$dir/after.sql" "$dir/mutant.sql" && echo installed || echo mismatch)" "installed"
race R4_neg vo_r4_neg "$(v2 OTHERDEVICE "$S2" 15 client null 1 '{"status":"pending","actual_load_value":55,"actual_load_unit":"lb"}' entered)" "" "$(v2 UNDO "$S2" 16 client null 1 "$UNDO50" prefill)"
check "R4_neg Undo blocked" "$HS" "BLOCKED"
check "R4_neg mutant lets the late Undo claim prefill" "$(row vo_r4_neg "$S2")" "pending/50/prefill/3"

# R5. An old undeclared writer (legacy PATCH) lands after a declared Undo: the
# guard makes the set unknown even though the Undo's nonce is the latest.
fresh vo_r5; qc_setup vo_r5
race R5 vo_r5 "$(v2 UNDO "$S2" 17 client null 1 "$UNDO50" prefill)" "" "$LEGACY_PATCH"
check "R5 exits" "$HRC/$CRC" "0/0"; no_errors R5
check "R5 legacy write blocked by the Undo" "$HS" "BLOCKED"
check "R5 set = legacy value, unknown" "$(row vo_r5 "$S2")" "pending/55/unknown/2"
else
  log "v2 absent: races not run"
fi

# ---------- Summary ----------
log "results: $PASSES passed, $FAILS failed"
echo "summary: $PASSES passed, $FAILS failed" >> "$RESULTS"
[ "$FAILS" = 0 ]
