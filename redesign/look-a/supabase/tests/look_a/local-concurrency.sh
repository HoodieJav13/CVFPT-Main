#!/usr/bin/env bash
# Real two-connection races for Look A (local migration
# 20261114120000_look_a_completion_undo.sql: finish_workout_log_v3 fences,
# the strict Undo, exercise done, and the completed-workout rechecks for coach
# responses and cues) against a NEW, disposable PostgreSQL 17 cluster that this
# run creates, owns and deletes. Reuses, unchanged, the ownership-guarded
# disposal (../value_origin/cluster_guard.sh) and lock handshake
# (../value_origin/race_helpers.sql); the cluster set-up below is copied from
# ../value_origin/local-concurrency.sh with only paths, names and fixtures changed.
#
#   bash supabase/tests/look_a/local-concurrency.sh
#
# Safety: no TCP (listen_addresses = ''), one 0700 Unix socket .s.PGSQL.1 in
# the worktree root that must not pre-exist, ambient PG* variables cleared,
# data_directory verified, bounded waits, and an exit trap that disposes only a
# verified run-owned cluster. Evidence goes to ../look-a-evidence/pg17-races/
# next to the worktree.
#
# This proves PostgreSQL row-lock behaviour with a synthetic superuser and
# fictional fixtures. It is not evidence of hosted authentication, RLS or
# PostgREST behaviour.
set -uo pipefail

PGBIN="/opt/homebrew/opt/postgresql@17/bin"
ROOT="$(cd "$(dirname "$0")/../../.." && pwd -P)"
TESTDIR="$ROOT/supabase/tests/look_a"
GUARDDIR="$ROOT/supabase/tests/value_origin"
MIG="$ROOT/supabase/migrations"
EVPARENT="$(cd "$ROOT/.." && pwd -P)/look-a-evidence"
EVID="$EVPARENT/pg17-races"
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
RUNDIR="$EVID/run-$RUN_ID"
DATA="$RUNDIR/data"
PORT=1
SOCK="$ROOT/.s.PGSQL.$PORT"
MARK="cvfpt-look-a-race-cluster $RUN_ID"
FN="public.apply_workout_set_event_v2(uuid,uuid,text,uuid,integer,integer,boolean,integer,jsonb,text)"
VOMIG="$MIG/20261114120000_look_a_completion_undo.sql"
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
mkdir -p "$RUNDIR/tmp" "$RUNDIR/races" "$RUNDIR/migrations"
# HOME is left alone. Private PostgreSQL client files are kept out instead:
# psql always runs with -X (no psqlrc) and explicit socket/port/user/dbname
# (no service file), and the only password file it may read is this run's
# own empty one.
LOOK_A_RACE_TMP="$RUNDIR/tmp"
: > "$LOOK_A_RACE_TMP/pgpass"; chmod 600 "$LOOK_A_RACE_TMP/pgpass"
export PGPASSFILE="$LOOK_A_RACE_TMP/pgpass"
echo "$MARK" > "$RUNDIR/OWNER"
RESULTS="$RUNDIR/RESULTS.tsv"
: > "$RESULTS"

connstr() { printf 'host=%s port=%s user=postgres dbname=%s application_name=%s connect_timeout=10' "$ROOT" "$PORT" "$1" "$2"; }
sqlx() { local db="$1" app="$2"; shift 2; "$PGBIN/psql" "$(connstr "$db" "$app")" -X -q -At -v ON_ERROR_STOP=1 "$@"; }
sql() { local db="$1"; shift; sqlx "$db" race_admin "$@"; }
check() {
  # An empty answer (a failed query) never passes.
  if [ -z "$2" ]; then FAILS=$((FAILS + 1)); printf 'FAIL\t%s\tgot=(empty)\texpected=%s\n' "$1" "$3" | tee -a "$RESULTS"; return; fi
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
  if [ -f "$VOMIG" ]; then echo "look a migration sha256: $(shasum -a 256 "$VOMIG" | cut -c1-64)"; else echo "look a migration: ABSENT"; fi
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

# look a race run $RUN_ID: no TCP; owner-only Unix socket inside the candidate
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
# Rows only: the per-transaction deep-equality helpers at the end of the file
# belong to the single-connection suite.
sed '/^-- Exact full rows/,$d' "$TESTDIR/fixtures.sql" > "$RUNDIR/fixtures-look-a-rows.sql"
sql vo_template -f "$RUNDIR/fixtures-look-a-rows.sql" > "$RUNDIR/fixtures-look-a.log" 2>&1 || { cat "$RUNDIR/fixtures-look-a.log"; die "look a fixtures failed"; }
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

# ---------- Look A races ----------
LOG="00000000-0000-4000-8000-0000000000a1"; CLIENT="00000000-0000-4000-8000-000000000014"; COACH="00000000-0000-4000-8000-000000000001"
SQUAT="00000000-0000-4000-8000-0000000a0001"; PRESS="00000000-0000-4000-8000-0000000a0004"
B1="00000000-0000-4000-8000-0000000b0001"; B3="00000000-0000-4000-8000-0000000b0003"; B11="00000000-0000-4000-8000-0000000b0011"
B31="00000000-0000-4000-8000-0000000b0031"; B32="00000000-0000-4000-8000-0000000b0032"
E() { printf '00000000-0000-4000-8000-0000000e%04d' "$1"; }
V3FN="public.finish_workout_log_v3(uuid,uuid,uuid,text,uuid,text,text,text,timestamptz,jsonb)"
HAVE="$(sql vo_template -c "select count(*) from pg_proc where oid = to_regprocedure('$V3FN')")"
check "template: finish_workout_log_v3 present" "$HAVE" "1"
finish() { echo "select '$1 ' || coalesce(r->>'outcome','?') || '/' || coalesce(r->>'reason','-') || '/' || coalesce(r->>'quick_completed','-') from (select public.finish_workout_log_v3('$LOG', '$CLIENT', '$(E "$2")', 'client', null, '$3', '', '', null) r) x;"; }
undo() { echo "select '$1 ' || coalesce(r->>'outcome','?') || '/' || coalesce(r->>'reason','-') from (select public.undo_workout_material_change('$LOG', '$(E "$2")', '$(E "$3")', 'client', null) r) x;"; }
done_ex() { echo "select '$1 ' || coalesce(r->>'outcome','?') from (select public.mark_workout_exercise_not_set_tracked('$LOG', '$2', '$(E "$3")', 'client', null) r) x;"; }
v3() { echo "select '$1 ' || (public.apply_workout_set_event_v3('$2', '$(E "$3")', 'client', null, null, $3, false, 0, '$4'::jsonb, 'entered') ->> 'outcome');"; }
said() { grep -c "^$2$" "$1"; }
cell() { q "$1" "$2"; }
nothing_logged() { q "$1" "update public.workout_log_sets set status = 'pending', completed_at = null, actual_reps = null, actual_duration_value = null, actual_duration_unit = null where id in ('$B1', '$B11')" > /dev/null; }
finished() {  # one logged set, then a normal Finish (event 900): a finished workout whose Undo is current
  q "$1" "$(v3 SETUP "$B31" 901 '{"status":"completed","actual_reps":5}')" | grep -q '^SETUP applied$' || die "setup set failed in $1"
  q "$1" "$(finish SETUP 900 finish)" | grep -q '^SETUP applied' || die "setup finish failed in $1"
}
LEGACY_SET="update public.workout_log_sets set status = 'completed', actual_reps = 5, completed_at = now(), entered_by = 'client', updated_at = now() where id = '$B3';"
LEGACY_NOTE="update public.workout_log_exercises set client_notes = 'fictional late note', updated_at = now() where id = '$SQUAT';"
LEGACY_PLAN="update public.workout_log_exercises set prescribed_load_value = 175, plan_revision = plan_revision + 1 where id = '$SQUAT';
update public.workout_log_sets set actual_load_value = 175, value_origin_nonce = gen_random_uuid(), updated_at = now() where workout_log_exercise_id = '$SQUAT' and status = 'pending';"
EXTRA_SET="insert into public.workout_log_sets(workout_log_exercise_id, set_number, set_origin, actual_load_value, actual_load_unit) values ('$PRESS', 3, 'extra', 40, 'kg');"
RESPONSE="select public.save_workout_coach_response('$LOG', '$COACH', 'Fictional reply');"
CUE="insert into public.exercise_attempt_cues(client_id, source_log_id, source_exercise_id, source_workout_exercise_id, workout_assignment_id, text, source_version, author_coach_id, author_name_snapshot)
  values ('$CLIENT', '$LOG', '$PRESS', '00000000-0000-4000-8000-000000000061', '00000000-0000-4000-8000-00000000000b', 'Fictional cue', 'v1', '$COACH', 'Fictional Coach');"

if [ "$HAVE" = 1 ]; then
# L1. A legacy set PATCH already holds a pending set when Finish (normal) runs
# on a workout with nothing logged yet: Finish waits, then counts that set.
fresh la_l1; nothing_logged la_l1
race L1 la_l1 "$LEGACY_SET" "" "$(finish FIN 1 finish)"
check "L1 exits" "$HRC/$CRC" "0/0"; no_errors L1
check "L1 Finish waits for the in-flight set write" "${HS%% *}" "BLOCKED"
check "L1 Finish applied, not quick" "$(said "$COUT" 'FIN applied/-/false')" "1"
check "L1 written set kept completed" "$(cell la_l1 "select status from public.workout_log_sets where id = '$B3'")" "completed"

# L2. Same, whole workout done, not set-tracked: no 'quick completed' workout
# that also has a recorded set.
fresh la_l2; nothing_logged la_l2
race L2 la_l2 "$LEGACY_SET" "" "$(finish FIN 2 not_set_tracked)"
check "L2 exits" "$HRC/$CRC" "0/0"; no_errors L2
check "L2 completion waits" "${HS%% *}" "BLOCKED"
check "L2 applied, quick_completed false (a set was logged)" "$(said "$COUT" 'FIN applied/-/false')" "1"
check "L2 log flag-only, set kept" "$(cell la_l2 "select l.not_set_tracked::text || '/' || l.quick_completed::text || '/' || s.status from public.workout_logs l, public.workout_log_sets s where l.id = '$LOG' and s.id = '$B3'")" "true/false/completed"

# L3. A direct v2 set event holds the set (legacy caller): same fence.
fresh la_l3; nothing_logged la_l3
race L3 la_l3 "select public.apply_workout_set_event_v2('$B3', '$(E 30)', 'client', null, null, 1, false, 0, '{\"status\":\"completed\",\"actual_reps\":5}'::jsonb, 'entered');" "" "$(finish FIN 3 finish)"
check "L3 exits" "$HRC/$CRC" "0/0"; no_errors L3
check "L3 Finish waits for v2" "${HS%% *}" "BLOCKED"
check "L3 Finish applied" "$(said "$COUT" 'FIN applied/-/false')" "1"

# L4. A legacy exercise note holds its exercise row: Finish waits; the note is
# part of the finished workout.
fresh la_l4
race L4 la_l4 "$LEGACY_NOTE" "" "$(finish FIN 4 finish)"
check "L4 exits" "$HRC/$CRC" "0/0"; no_errors L4
check "L4 Finish waits for the exercise write" "${HS%% *}" "BLOCKED"
check "L4 Finish applied" "$(said "$COUT" 'FIN applied/-/false')" "1"
check "L4 note kept" "$(cell la_l4 "select client_notes from public.workout_log_exercises where id = '$SQUAT'")" "fictional late note"

# L5. Finish holds the fence; a delayed exercise note waits, then is refused by
# the completed-workout guard. Nothing lands after Finish.
fresh la_l5
race L5 la_l5 "$(finish FIN 5 finish)" "" "$LEGACY_NOTE"
check "L5 holder exit" "$HRC" "0"
check "L5 note waits for Finish" "${HS%% *}" "BLOCKED"
check "L5 late note refused" "$(grep -c 'ERROR' "$COUT")" "1"
check "L5 no note on the finished workout" "$(cell la_l5 "select coalesce(client_notes, 'none') from public.workout_log_exercises where id = '$SQUAT'")" "none"

# L6. A plan edit (exercise row, then its sets, one transaction) racing Finish:
# same order as the fence, so no deadlock in either direction.
fresh la_l6
race L6 la_l6 "$LEGACY_PLAN" "" "$(finish FIN 6 finish)"
check "L6 exits" "$HRC/$CRC" "0/0"; no_errors L6
check "L6 Finish waits for the plan edit" "${HS%% *}" "BLOCKED"
fresh la_l6b
race L6b la_l6b "$(finish FIN 7 finish)" "" "$LEGACY_PLAN"
check "L6b holder exit" "$HRC" "0"
check "L6b plan edit waits" "${HS%% *}" "BLOCKED"
check "L6b late plan edit refused, not deadlocked" "$(grep -c 'deadlock' "$COUT")/$(grep -c 'ERROR' "$COUT")" "0/1"
check "L6b prescription unchanged" "$(cell la_l6b "select prescribed_load_value::int from public.workout_log_exercises where id = '$SQUAT'")" "170"

# L7. A newer set event holds the workout while Undo of an older change runs:
# Undo waits, then is refused (a later change replaced it).
fresh la_l7
q la_l7 "$(done_ex SETUP "$PRESS" 70)" | grep -q '^SETUP applied$' || die "setup done failed"
race L7 la_l7 "$(v3 SET "$B3" 71 '{"status":"completed","actual_reps":5}')" "" "$(undo UNDO 70 72)"
check "L7 exits" "$HRC/$CRC" "0/0"; no_errors L7
check "L7 Undo waits" "${HS%% *}" "BLOCKED"
check "L7 Undo refused" "$(said "$COUT" 'UNDO refused/A later change replaced this Undo.')" "1"
check "L7 exercise still done" "$(cell la_l7 "select not_set_tracked from public.workout_log_exercises where id = '$PRESS'")" "t"

# L8. Extra-set insert (metrics trigger: FOR SHARE on the workout) against
# exercise done (workout, then exercise), both directions: waits, no deadlock,
# no set changed by exercise done.
fresh la_l8
race L8 la_l8 "$EXTRA_SET" "" "$(done_ex DONE "$PRESS" 80)"
check "L8 exits" "$HRC/$CRC" "0/0"; no_errors L8
check "L8 exercise done waits for the insert" "${HS%% *}" "BLOCKED"
check "L8 exercise done applied" "$(said "$COUT" 'DONE applied')" "1"
fresh la_l8b
race L8b la_l8b "$(done_ex DONE "$PRESS" 81)" "" "$EXTRA_SET"
check "L8b exits" "$HRC/$CRC" "0/0"; no_errors L8b
check "L8b insert waits" "${HS%% *}" "BLOCKED"
check "L8b extra set present" "$(cell la_l8b "select count(*) from public.workout_log_sets where workout_log_exercise_id = '$PRESS'")" "3"

# L9. Undo of Finish holds the reopen; a coach response that already read
# 'completed' waits, re-reads, and is refused. Negative control without the
# recheck shows the race is real.
fresh la_l9; finished la_l9
race L9 la_l9 "$(undo UNDO 900 902)" "" "$RESPONSE"
check "L9 holder exit" "$HRC" "0"
check "L9 Undo applied" "$(said "$HOUT" 'UNDO applied/-')" "1"
check "L9 response waits" "${HS%% *}" "BLOCKED"
check "L9 response refused by the recheck after the lock" "$(grep -q 'ERROR:  Only completed workouts accept coach responses' "$COUT" && grep -q 'look_a_require_completed_log(uuid,text,boolean) line 15 at RAISE' "$COUT" && echo refused-after-lock)" "refused-after-lock"
check "L9 no response on the reopened workout" "$(cell la_l9 "select count(*) || '/' || (select status from public.workout_logs where id = '$LOG') from public.workout_coach_responses where workout_log_id = '$LOG'")" "0/active"
fresh la_l9_neg; finished la_l9_neg
q la_l9_neg "drop trigger look_a_completed_log_guard on public.workout_coach_responses" > /dev/null
race L9_neg la_l9_neg "$(undo UNDO 900 903)" "" "$RESPONSE"
check "L9_neg without the recheck a response lands on the reopened workout" "$(cell la_l9_neg "select count(*) || '/' || (select status from public.workout_logs where id = '$LOG') from public.workout_coach_responses where workout_log_id = '$LOG'")" "1/active"

# L10. A cue created from the finished attempt while Undo of Finish holds the
# reopen. A cue write holds its exercise row, so it never waits for the
# workout (see L13): it is refused at once with a retryable message, and no
# cue lands on the reopened workout.
fresh la_l10; finished la_l10
race L10 la_l10 "$(undo UNDO 900 904)" "" "$CUE" 4
check "L10 holder exit" "$HRC" "0"
check "L10 cue does not wait" "${HS%% *}" "NOT_BLOCKED"
check "L10 cue refused at once (lock not waited for)" "$(grep -q 'ERROR:  This workout is changing right now. Try again.' "$COUT" && grep -q 'look_a_require_completed_log(uuid,text,boolean) line 10 at RAISE' "$COUT" && echo refused-nowait)" "refused-nowait"
check "L10 no cue" "$(cell la_l10 "select count(*) from public.exercise_attempt_cues where source_log_id = '$LOG'")" "0"
check "L10 Undo applied" "$(said "$HOUT" 'UNDO applied/-')/$(cell la_l10 "select status from public.workout_logs where id = '$LOG'")" "1/active"

# L11. A coach response committed first (holding the workout FOR SHARE): the
# Undo of Finish waits for it, then sees it and keeps the workout finished.
fresh la_l11; finished la_l11
race L11 la_l11 "$RESPONSE" "" "$(undo UNDO 900 905)"
check "L11 exits" "$HRC/$CRC" "0/0"; no_errors L11
check "L11 Undo waits" "${HS%% *}" "BLOCKED"
check "L11 Undo refused" "$(grep -c '^UNDO refused/Your coach already responded' "$COUT")" "1"

# L12. Conflict resolution on the finished workout against Undo of Finish.
# The resolution records its event against the workout (foreign key KEY SHARE),
# which the reopening Undo's FOR UPDATE waits for. Undo then sees the resolved
# set and keeps the workout finished. (a) a set the Undo does not restore, (b) a
# set Finish skipped, which the Undo would restore. No deadlock, no error, and
# the resolution is never lost or reverted.
fresh la_l12a; finished la_l12a
q la_l12a "select public.apply_workout_set_event_v2('$B31', '$(E 120)', 'coach', '$COACH', 0, 1, false, 0, '{\"actual_reps\":6}'::jsonb, 'entered')" > /dev/null
CID="$(cell la_l12a "select id from public.workout_set_conflicts where workout_log_set_id = '$B31' and status = 'open'")"
check "L12a conflict open" "$([ -n "$CID" ] && echo yes || echo no)" "yes"
race L12a la_l12a "select public.resolve_workout_set_conflict('$CID', '$(E 121)', 'incoming', null, '$COACH');" "" "$(undo UNDO 900 906)" 4
check "L12a exits" "$HRC/$CRC" "0/0"; no_errors L12a
check "L12a Undo waits for the resolution" "${HS%% *}" "BLOCKED"
check "L12a Undo refused: workout changed" "$(grep -c '^UNDO refused/This workout changed since' "$COUT")" "1"
check "L12a workout stays finished" "$(cell la_l12a "select status from public.workout_logs where id = '$LOG'")" "completed"
check "L12a resolution landed after" "$(cell la_l12a "select actual_reps || '/' || (select status from public.workout_set_conflicts where id = '$CID') from public.workout_log_sets where id = '$B31'")" "6/resolved"
fresh la_l12b; finished la_l12b
q la_l12b "select public.apply_workout_set_event_v2('$B32', '$(E 122)', 'coach', '$COACH', 0, 1, false, 0, '{\"actual_reps\":6}'::jsonb, 'entered')" > /dev/null
CID="$(cell la_l12b "select id from public.workout_set_conflicts where workout_log_set_id = '$B32' and status = 'open'")"
check "L12b conflict open on a skipped set" "$([ -n "$CID" ] && echo yes || echo no)" "yes"
race L12b la_l12b "select public.resolve_workout_set_conflict('$CID', '$(E 123)', 'incoming', null, '$COACH');" "" "$(undo UNDO 900 907)" 4
check "L12b exits" "$HRC/$CRC" "0/0"; no_errors L12b
check "L12b Undo waits, then refused: workout changed" "$(grep -c '^UNDO refused/This workout changed since' "$COUT")/${HS%% *}" "1/BLOCKED"
check "L12b resolution kept" "$(cell la_l12b "select actual_reps || '/' || status from public.workout_log_sets where id = '$B32'")" "6/skipped"
check "L12b workout stays finished" "$(cell la_l12b "select status from public.workout_logs where id = '$LOG'")" "completed"
# L13. The reviewer's three-operation interleaving (LOOK-A-API-REVIEW.md):
# a cue write holds its exercise row FOR SHARE (as mutate_exercise_cue does)
# and its first, unlocked status read was stale ('completed'); Undo has since
# reopened the workout; a re-Finish holds the workout and waits for that
# exercise row. The guard's two reads run inside one trigger and cannot be
# paused between them natively, so the holder runs the guard's exact second
# read at that point. With NOWAIT (the guard's cue branch) the cue fails at
# once and the re-Finish completes; the negative control (a waiting FOR SHARE,
# as before this change) shows the cycle is a real deadlock.
fresh la_l13; finished la_l13
q la_l13 "$(undo SETUP 900 908)" | grep -q '^SETUP applied' || die "L13 setup undo failed"
race L13 la_l13 "select 1 from public.workout_log_exercises where id = '$PRESS' for share;" \
  "select status from public.workout_logs where id = '$LOG' for share nowait;" "$(finish FIN 909 finish)"
check "L13 re-Finish waits for the cue's exercise row" "${HS%% *}" "BLOCKED"
check "L13 cue's workout read fails at once" "$(grep -c 'ERROR:  could not obtain lock on row in relation \"workout_logs\"' "$HOUT")" "1"
check "L13 no deadlock in either session" "$(cat "$HOUT" "$COUT" | grep -c 'deadlock detected')" "0"
check "L13 re-Finish applied" "$(grep -c '^FIN applied' "$COUT")/$CRC" "1/0"
check "L13 workout finished again" "$(cell la_l13 "select status from public.workout_logs where id = '$LOG'")" "completed"
fresh la_l13_neg; finished la_l13_neg
q la_l13_neg "$(undo SETUP 900 910)" | grep -q '^SETUP applied' || die "L13_neg setup undo failed"
race L13_neg la_l13_neg "select 1 from public.workout_log_exercises where id = '$PRESS' for share;" \
  "select status from public.workout_logs where id = '$LOG' for share;" "$(finish FIN 911 finish)"
check "L13_neg a waiting read deadlocks" "$(cat "$HOUT" "$COUT" | grep -c 'deadlock detected')" "1"

# L14-L15. Integration review 2: one new event id used at once on two
# different workouts. Every Look A writer takes the shared event lock first,
# so the second caller waits, then sees the first change and is refused with
# event_id_reused (a 409) instead of a duplicate-key error (a 500).
LOG2="00000000-0000-4000-8000-0000000000a2"; CLIENT2="00000000-0000-4000-8000-000000000015"
EX2="00000000-0000-4000-8000-0000000a0101"; SET2="00000000-0000-4000-8000-0000000b0101"
second_log() {
  q "$1" "insert into public.clients(id, coach_id, name, email) values ('$CLIENT2', '$COACH', 'Fictional Look A Client Two', 'looka2@example.invalid');
insert into public.workout_assignments(id, client_id, workout_id) values ('00000000-0000-4000-8000-00000000000d', '$CLIENT2', '00000000-0000-4000-8000-000000000005');
insert into public.workout_logs(id, client_id, coach_id, source_workout_id, workout_assignment_id, workout_name, status, started_at) values ('$LOG2', '$CLIENT2', '$COACH', '00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-00000000000d', 'Fictional Lower B', 'active', now());
insert into public.workout_log_exercises(id, workout_log_id, exercise_library_id, exercise_name, position, tracking_type, prescribed_load_value, prescribed_load_unit) values ('$EX2', '$LOG2', '00000000-0000-4000-8000-000000000051', 'Fictional Hinge', 0, 'reps_weight', 100, 'lb');
insert into public.workout_log_sets(id, workout_log_exercise_id, set_number, status, actual_load_value, actual_load_unit) values ('$SET2', '$EX2', 1, 'pending', 100, 'lb');" > /dev/null || die "second workout setup failed in $1"
}
done_on() { echo "select '$1 ' || coalesce(r->>'outcome','?') from (select public.mark_workout_exercise_not_set_tracked('$2', '$3', '$(E "$4")', 'client', null) r) x;"; }
cross_log() {  # name: the challenger is refused as a reuse, never a duplicate key
  check "$1 challenger waited for the event" "${HS%% *}" "BLOCKED"
  check "$1 holder applied" "$(grep -c ' applied$' "$HOUT")" "1"
  check "$1 challenger refused as reuse" "$(grep -c 'event_id_reused' "$COUT")" "1"
  check "$1 no duplicate key" "$(cat "$HOUT" "$COUT" | grep -c 'duplicate key')" "0"
  check "$1 one change recorded for the id" "$(cell "$2" "select count(*) from public.workout_material_changes where id = '$(E "$3")'")" "1"
}
fresh la_l14; second_log la_l14
race L14 la_l14 "$(done_on DONE "$LOG" "$PRESS" 140)" "" "$(done_on DONE "$LOG2" "$EX2" 140)"
cross_log L14 la_l14 140
fresh la_l14b; second_log la_l14b
race L14b la_l14b "$(v3 SET "$B31" 145 '{"status":"completed","actual_reps":5}')" "" "$(v3 SET "$SET2" 145 '{"status":"completed","actual_reps":5}')"
cross_log L14b la_l14b 145
check "L14b one set event for the id" "$(cell la_l14b "select count(*) from public.workout_set_events where id = '$(E 145)'")" "1"
fresh la_l15; second_log la_l15
race L15 la_l15 "$(v3 SET "$B31" 150 '{"status":"completed","actual_reps":5}')" "" "$(done_on DONE "$LOG2" "$EX2" 150)"
cross_log L15 la_l15 150
fresh la_l15b; second_log la_l15b
race L15b la_l15b "$(done_on DONE "$LOG2" "$EX2" 151)" "" "$(v3 SET "$B31" 151 '{"status":"completed","actual_reps":5}')"
cross_log L15b la_l15b 151
check "L15b no set event written for the reused id" "$(cell la_l15b "select count(*) from public.workout_set_events where id = '$(E 151)'")" "0"
check "L15b the refused set is unchanged" "$(cell la_l15b "select status from public.workout_log_sets where id = '$B31'")" "pending"

# L16. Start/resume against a new material writer (LOOK-A-START-RACE-REVIEW.md).
# Start takes the client FOR UPDATE, then the active workout. A material
# writer that took the workout first and then needed the client (its ledger
# row's client_id key) closed a cycle. Every Look A writer now takes client
# KEY SHARE before the workout (20261114150000), so it waits for start first.
AUTH="00000000-0000-4000-8000-0000000000f1"
auth_client() {
  q "$1" "insert into auth.users(id, email) values ('$AUTH', 'looka@example.invalid'); update public.clients set auth_user_id = '$AUTH' where id = '$CLIENT';" > /dev/null || die "auth setup failed in $1"
}
START="select 'START ' || (public.start_workout_log_with_cues('$CLIENT', null, null, '00000000-0000-4000-8000-00000000000b', 'client', null, null, '$AUTH') ->> 'outcome');"
# The challenger's row lock on the workout, read by the holder: 0 means it is
# waiting before it took the workout.
loglock() { echo "select 'LOGLOCK ' || count(*) from pg_locks l join pg_stat_activity a on a.pid = l.pid where a.application_name = 'ch_$1' and l.relation = 'public.workout_logs'::regclass and l.mode = 'RowShareLock';"; }
# Negative control: a writer that already holds the workout (the old lock
# point) while start holds the client and waits for the workout: still a
# cycle, so the order, not luck, is what removes it.
fresh la_l16_neg; auth_client la_l16_neg
race L16_neg la_l16_neg "select 1 from public.workout_logs where id = '$LOG' for no key update;" "$(done_ex DONE "$PRESS" 160)" "$START"
check "L16_neg the workout-first order deadlocks" "$(cat "$HOUT" "$COUT" | grep -c 'deadlock detected')" "1"
positive_start() {  # name db: start holds the client; the writer waits before the workout
  check "$1 writer waited" "${HS%% *}" "BLOCKED"
  check "$1 writer had not taken the workout" "$(grep '^LOGLOCK ' "$HOUT" | cut -d' ' -f2)" "0"
  check "$1 start resumed" "$(grep -c '^START resumed$' "$HOUT")" "1"
  check "$1 no deadlock" "$(cat "$HOUT" "$COUT" | grep -c 'deadlock detected')" "0"
  no_errors "$1"
}
fresh la_l16; auth_client la_l16
race L16 la_l16 "select 1 from public.clients where id = '$CLIENT' for update;" "$(loglock L16)
$START" "$(done_ex DONE "$PRESS" 161)"
positive_start L16 la_l16
check "L16 Done applied after start" "$(grep -c '^DONE applied$' "$COUT")" "1"
fresh la_l16b; auth_client la_l16b
race L16b la_l16b "select 1 from public.clients where id = '$CLIENT' for update;" "$(loglock L16b)
$START" "$(v3 SET "$B31" 162 '{"status":"completed","actual_reps":5}')"
positive_start L16b la_l16b
check "L16b set write applied after start" "$(grep -c '^SET applied$' "$COUT")" "1"

# L17. A coach-backup swap against a set write on the exercise it replaces
# (LOOK-A-HANDOFF-REVIEW.md item 1). The page showed 4 - 2 = 2 sets; a set
# completed first makes the server's count 1, so the swap is refused with the
# new count and writes nothing. In the other order the swap is saved with 2
# sets and the later set write ends its Undo. The replaced rows are only read.
BACKUP="00000000-0000-4000-8000-0000000d0017"
swap_setup() {
  q "$1" "update public.workout_log_exercises set source_workout_exercise_id = '00000000-0000-4000-8000-000000000061' where id = '$SQUAT';
insert into public.workout_exercise_backups(id, workout_exercise_id, backup_exercise_library_id, target_sets, created_by_coach_id)
  values ('$BACKUP', '00000000-0000-4000-8000-000000000061', '00000000-0000-4000-8000-000000000052', 4, '$COACH');" > /dev/null || die "swap setup failed in $1"
}
swap() {  # label event expected-sets
  local ids="" i
  for i in $(seq 1 "$3"); do ids="$ids${ids:+,}'$(printf '00000000-0000-4000-8000-0000000f%02d%02d' "$2" "$i")'"; done
  echo "select '$1 ' || coalesce(r->>'outcome','?') || '/' || coalesce(r->>'reason','-') || '/' || coalesce(r->>'sets','-') from (select public.create_workout_substitution_v3(jsonb_build_object('id', '$(E "$2")', 'workout_log_id', '$LOG', 'client_id', '$CLIENT', 'original_log_exercise_id', '$SQUAT', 'original_name', 'Fictional Squat', 'replacement_log_exercise_id', '$(printf '00000000-0000-4000-8000-0000000f%04d' "$2")', 'replacement_exercise_library_id', '00000000-0000-4000-8000-000000000052', 'replacement_name', 'Replacement', 'source', 'coach_backup', 'backup_id', '$BACKUP', 'trigger', 'other', 'targets', '{}'::jsonb, 'actor_role', 'client'), true, $3, array[$ids]::uuid[]) r) x;"
}
# The replaced exercise's set rows as one fingerprint, optionally without one
# set. A failed query or an empty answer stops the run (never compares equal).
squat_rows() {
  local out
  out="$(cell "$1" "select md5(string_agg(to_jsonb(s)::text, ',' order by s.id)) from public.workout_log_sets s where workout_log_exercise_id = '$SQUAT' and s.id is distinct from nullif('${2:-}', '')::uuid" 2>&1)" || die "squat_rows query failed in $1: $out"
  [[ "$out" =~ ^[0-9a-f]{32}$ ]] || die "squat_rows gave no fingerprint in $1: $out"
  echo "$out"
}
fresh la_l17; swap_setup la_l17
race L17 la_l17 "$(v3 SET "$B3" 170 '{"status":"completed","actual_reps":5}')" "" "$(swap SWAP 71 2)"
no_errors L17
check "L17 swap waits for the set write" "${HS%% *}" "BLOCKED"
check "L17 swap refused with the new count" "$(said "$COUT" 'SWAP refused/count_changed/1')" "1"
check "L17 nothing swapped" "$(cell la_l17 "select count(*) from public.workout_log_substitutions where id = '$(E 71)'") / $(cell la_l17 "select count(*) from public.workout_log_exercises where id = '$(printf '00000000-0000-4000-8000-0000000f%04d' 71)'")" "0 / 0"
check "L17 the set write kept" "$(cell la_l17 "select status from public.workout_log_sets where id = '$B3'")" "completed"
L17ROWS="$(squat_rows la_l17)" || die "L17 rows"
q la_l17 "$(swap REPLAY 71 2)" > "$RUNDIR/races/L17/replay.out"
check "L17 the same swap replays its refusal" "$(said "$RUNDIR/races/L17/replay.out" 'REPLAY replayed/count_changed/1')" "1"
q la_l17 "$(swap SWAP2 72 1)" > "$RUNDIR/races/L17/again.out"
check "L17 swap with the new count applies" "$(said "$RUNDIR/races/L17/again.out" 'SWAP2 created/-/1')" "1"
L17AFTER="$(squat_rows la_l17)" || die "L17 rows after"
check "L17 replaced rows unchanged by the swap" "$L17AFTER" "$L17ROWS"
fresh la_l17b; swap_setup la_l17b
L17BROWS="$(squat_rows la_l17b "$B3")" || die "L17b rows"
race L17b la_l17b "$(swap SWAP 73 2)" "" "$(v3 SET "$B3" 174 '{"status":"completed","actual_reps":5}')"
no_errors L17b
check "L17b set write waits for the swap" "${HS%% *}" "BLOCKED"
check "L17b swap applied with 2 sets" "$(said "$HOUT" 'SWAP created/-/2')" "1"
check "L17b set write applied after" "$(said "$COUT" 'SET applied')" "1"
check "L17b replacement has the page's 2 sets" "$(cell la_l17b "select count(*) from public.workout_log_sets where workout_log_exercise_id = '$(printf '00000000-0000-4000-8000-0000000f%04d' 73)'")" "2"
check "L17b the later set write ended the swap Undo" "$(cell la_l17b "select public.workout_current_undo('$LOG', 'client', null) ->> 'kind'")" "set"
L17BAFTER="$(squat_rows la_l17b "$B3")" || die "L17b rows after"
check "L17b swap only read the replaced rows" "$L17BAFTER" "$L17BROWS"

# L18. An Add Set that passed its check against a swap Undo that archives the
# replacement (LOOK-A-SWAP-RACE-REVIEW.md item 2). The set insert re-reads its
# exercise under a row lock (20261114170000), so it waits for the Undo and is
# refused. Negative control: with that check disabled the late set lands
# under the archived replacement (it waits, then inserts). Reverse order: the
# Undo waits for the insert and is then refused because the workout changed.
REP18="$(printf '00000000-0000-4000-8000-0000000f%04d' 80)"
swapped_now() {  # db: a saved coach-backup swap of 2 sets (event 80)
  swap_setup "$1"
  q "$1" "update public.workout_log_sets set status = 'pending' where workout_log_exercise_id = '$SQUAT'" > /dev/null
  q "$1" "$(swap SETUP 80 4)" | grep -q '^SETUP created/-/4$' || die "swap setup failed in $1"
}
UNDO_SWAP="$(undo UNDO 80 81)"
ADD_SET="insert into public.workout_log_sets(workout_log_exercise_id, set_number, set_origin, client_operation_id) values ('$REP18', 5, 'extra', gen_random_uuid());"
live_sets() { cell "$1" "select count(*) from public.workout_log_sets s join public.workout_log_exercises e on e.id = s.workout_log_exercise_id where e.id = '$REP18' and not s.archived"; }
fresh la_l18_neg; swapped_now la_l18_neg
q la_l18_neg "alter table public.workout_log_sets disable trigger look_a_require_live_exercise" > /dev/null
race L18_neg la_l18_neg "$UNDO_SWAP" "" "$ADD_SET"
check "L18_neg Undo applied" "$(said "$HOUT" 'UNDO applied/-')" "1"
check "L18_neg without the check the insert still waits (a lock alone only delays it)" "${HS%% *}" "BLOCKED"
check "L18_neg without the check a live set lands under the archived replacement" "$(live_sets la_l18_neg)/$(cell la_l18_neg "select archived from public.workout_log_exercises where id = '$REP18'")" "1/t"
fresh la_l18; swapped_now la_l18
race L18 la_l18 "$UNDO_SWAP" "" "$ADD_SET"
check "L18 holder exit" "$HRC" "0"
check "L18 Undo applied" "$(said "$HOUT" 'UNDO applied/-')" "1"
check "L18 the late insert waits for the Undo" "${HS%% *}" "BLOCKED"
check "L18 the late insert is refused" "$(grep -c 'no longer in the workout' "$COUT")" "1"
check "L18 no deadlock" "$(cat "$HOUT" "$COUT" | grep -c 'deadlock detected')" "0"
check "L18 no live set under the archived replacement" "$(live_sets la_l18)" "0"
check "L18 swap undone" "$(cell la_l18 "select status from public.workout_log_substitutions where id = '$(E 80)'")" "undone"
fresh la_l18b; swapped_now la_l18b
race L18b la_l18b "$ADD_SET" "" "$UNDO_SWAP"
no_errors L18b
check "L18b the Undo waits for the insert's workout write" "${HS%% *}" "BLOCKED"
check "L18b then the Undo is refused: the workout changed" "$(grep -c '^UNDO refused/This workout changed since' "$COUT")" "1"
check "L18b the added set kept, swap still active" "$(live_sets la_l18b)/$(cell la_l18b "select status from public.workout_log_substitutions where id = '$(E 80)'")" "5/active"
q la_l18b "$(undo LATER 80 82)" > "$RUNDIR/races/L18b/later.out"
check "L18b a later Undo is refused: the workout changed" "$(grep -c '^LATER refused/This workout changed' "$RUNDIR/races/L18b/later.out")" "1"

# L19. An older create for ANOTHER workout with the same swap id as a Look A
# swap (LOOK-A-SWAP-LEGACY-COLLISION.md). The older create holds its new row;
# the Look A swap then runs for workout A. It must be refused as a reuse and
# never add sets to, record an Undo for, or change workout B's swap.
# L19 uses the fenced older create (it takes the shared event lock, so the
# Look A swap waits before its check). L19_unfenced reinstalls the original
# older create (no event lock) in its own database, so the Look A swap passes
# its check, waits on the row insert and gets the helper's replay of B's row:
# the result check alone must refuse it.
REPB="00000000-0000-4000-8000-0000000f9002"; REPA="00000000-0000-4000-8000-0000000f9001"
LEGACY_B="select 'LEGACY ' || (public.create_workout_substitution(jsonb_build_object('id', '$(E 90)', 'workout_log_id', '$LOG2', 'client_id', '$CLIENT2', 'original_log_exercise_id', '$EX2', 'original_name', 'Fictional Hinge', 'replacement_log_exercise_id', '$REPB', 'replacement_exercise_library_id', '00000000-0000-4000-8000-000000000052', 'replacement_name', 'Replacement', 'source', 'catalog_suggestion', 'trigger', 'equipment_busy', 'targets', '{\"sets\":2}'::jsonb, 'actor_role', 'client', 'create_target_sets', false), true) ->> 'outcome');"
catalog_a() {  # label event replacement
  echo "select '$1 ' || (public.create_workout_substitution_v3(jsonb_build_object('id', '$(E "$2")', 'workout_log_id', '$LOG', 'client_id', '$CLIENT', 'original_log_exercise_id', '$SQUAT', 'original_name', 'Fictional Squat', 'replacement_log_exercise_id', '$3', 'replacement_exercise_library_id', '00000000-0000-4000-8000-000000000052', 'replacement_name', 'Replacement', 'source', 'catalog_suggestion', 'trigger', 'other', 'targets', '{\"sets\":2}'::jsonb, 'actor_role', 'client'), true, 2, array['00000000-0000-4000-8000-0000000f9101', '00000000-0000-4000-8000-0000000f9102']::uuid[]) ->> 'outcome');"
}
collision() {  # name db
  check "$1 holder (older create, workout B) created" "$(said "$HOUT" 'LEGACY created')" "1"
  check "$1 holder exit" "$HRC" "0"
  check "$1 the Look A swap is refused as a reuse" "$(grep -c 'event_id_reused' "$COUT")/$(grep -c 'ERROR' "$COUT")" "1/1"
  check "$1 no deadlock, no other error" "$(cat "$HOUT" "$COUT" | grep -c 'deadlock detected')/$HERR" "0/0"
  check "$1 workout B's swap unchanged" "$(cell "$2" "select workout_log_id || '/' || status || '/' || replacement_log_exercise_id from public.workout_log_substitutions where id = '$(E 90)'")" "$LOG2/active/$REPB"
  check "$1 no set added under B's replacement" "$(cell "$2" "select count(*) from public.workout_log_sets where workout_log_exercise_id = '$REPB'")" "0"
  check "$1 the page's set ids exist nowhere" "$(cell "$2" "select count(*) from public.workout_log_sets where id in ('00000000-0000-4000-8000-0000000f9101', '00000000-0000-4000-8000-0000000f9102')")" "0"
  check "$1 no Undo recorded for the id" "$(cell "$2" "select count(*) from public.workout_material_changes where id = '$(E 90)'")" "0"
  check "$1 workout A has no replacement" "$(cell "$2" "select count(*) from public.workout_log_exercises where id = '$REPA'")" "0"
  q "$2" "$LEGACY_B" > "$RUNDIR/races/$1/legacy-replay.out"
  check "$1 the older create still replays its own row" "$(said "$RUNDIR/races/$1/legacy-replay.out" 'LEGACY replayed')" "1"
  q "$2" "$(catalog_a OWN 91 '00000000-0000-4000-8000-0000000f9003')" > "$RUNDIR/races/$1/own.out"
  check "$1 a Look A swap with its own id still works" "$(said "$RUNDIR/races/$1/own.out" 'OWN created')" "1"
}
fresh la_l19; second_log la_l19
race L19 la_l19 "$LEGACY_B" "" "$(catalog_a SWAP 90 "$REPA")"
check "L19 the Look A swap waited for the event" "${HS%% *}" "BLOCKED"
collision L19 la_l19
fresh la_l19_unfenced; second_log la_l19_unfenced
awk '/^create or replace function public.create_workout_substitution\(p_row jsonb, p_activate boolean\)/{on=1} on{print} on&&/^\$\$;/{exit}' "$MIG/20261023000000_session_conductor_events.sql" > "$RUNDIR/legacy-unfenced.sql"
grep -q "pg_advisory_xact_lock" "$RUNDIR/legacy-unfenced.sql" && die "unfenced legacy body unexpectedly has the event lock"
sql la_l19_unfenced -f "$RUNDIR/legacy-unfenced.sql" > /dev/null || die "cannot install the unfenced older create"
check "L19_unfenced the older create has no event lock" "$(cell la_l19_unfenced "select (pg_get_functiondef('public.create_workout_substitution(jsonb,boolean)'::regprocedure) like '%advisory%')::text")" "false"
race L19_unfenced la_l19_unfenced "$LEGACY_B" "" "$(catalog_a SWAP 90 "$REPA")"
check "L19_unfenced the Look A swap waited on the row, past its check" "${HS%% *}" "BLOCKED"
collision L19_unfenced la_l19_unfenced

# L19_neg (negative control): the unfenced older create AND a Look A swap
# with its result check removed (the draft before the collision review). The
# same ordering then adds the page's sets under workout B's replacement and
# records an Undo for workout A: the hazard the two fixes close.
fresh la_l19_neg; second_log la_l19_neg
sql la_l19_neg -f "$RUNDIR/legacy-unfenced.sql" > /dev/null || die "cannot install the unfenced older create (neg)"
python3 - "$MIG/20261114170000_look_a_swap_count_undo.sql" "$RUNDIR/v3-unchecked.sql" <<'PY' || die "cannot build the unchecked swap"
import sys
src = open(sys.argv[1]).read()
a = src.index('create function public.create_workout_substitution_v3(')
b = src.index('$$;', a) + 3
f = src[a:b].replace('create function', 'create or replace function', 1)
start = f.index('  -- Only a row this call created is built on.')
end = f.index('  if p_activate then\n    v_load')
f = f[:start] + f[end:]
assert 'Only a row this call created' not in f
open(sys.argv[2], 'w').write(f)
PY
sql la_l19_neg -f "$RUNDIR/v3-unchecked.sql" > /dev/null || die "cannot install the unchecked swap"
race L19_neg la_l19_neg "$LEGACY_B" "" "$(catalog_a SWAP 90 "$REPA")"
check "L19_neg without both fixes the page's sets land under B's replacement" "$(cell la_l19_neg "select count(*) from public.workout_log_sets where workout_log_exercise_id = '$REPB'")" "2"
check "L19_neg and an Undo is recorded under workout A for B's swap" "$(cell la_l19_neg "select workout_log_id from public.workout_material_changes where id = '$(E 90)'")" "$LOG"
else
  log "finish_workout_log_v3 absent: races not run"
fi

# ---------- Summary ----------
log "results: $PASSES passed, $FAILS failed"
echo "summary: $PASSES passed, $FAILS failed" >> "$RESULTS"
[ "$FAILS" = 0 ]
