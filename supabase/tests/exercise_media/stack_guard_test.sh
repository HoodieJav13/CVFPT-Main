#!/usr/bin/env bash
# Regression tests for the media stack.sh safety rules. FAKE `docker`, `supabase` and `lsof`
# executables come first on PATH, so no real Docker/CLI is touched. They prove that no path
# stops another project or container, that a busy port refuses startup, and that inspection
# or teardown failures are never swallowed.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
ORIG_PATH="$PATH"
PASS=0
fail() { echo "FAIL [$CASE]: $*" >&2; [ -f "${OUT:-/dev/null}" ] && sed 's/^/    | /' "$OUT" >&2; exit 1; }

write_fakes() {
  cat > "$1/docker" <<'DOCKER'
#!/usr/bin/env bash
echo "docker $*" >> "$FAKE_DIR/docker.log"
if [ -f "$FAKE_DIR/docker_down" ]; then echo "Cannot connect to the Docker daemon" >&2; exit 1; fi
sub="${1:-}"; shift || true
args="$*"
case "$sub" in
  info) exit 0 ;;
  ps)
    if [ -f "$FAKE_DIR/ps_fail" ]; then echo "ps failed" >&2; exit 1; fi
    case "$args" in
      *"label=com.supabase.cli.project=cvfpt-media-test"*) cat "$FAKE_DIR/owned_containers" 2>/dev/null || true ;;
      *"label=com.cvfpt.owner=cvfpt-media-test"*) cat "$FAKE_DIR/owned_postgrest" 2>/dev/null || true ;;
      *"name=^/supabase_db_cvfpt-media-test"*)
        if [ -f "$FAKE_DIR/owned_container_running" ]; then echo running; elif [ -s "$FAKE_DIR/owned_containers" ]; then echo exited; fi ;;
    esac
    exit 0 ;;
  volume)
    if [ -f "$FAKE_DIR/volume_fail" ]; then echo "volume ls failed" >&2; exit 1; fi
    case "$args" in *"label=com.supabase.cli.project=cvfpt-media-test"*) cat "$FAKE_DIR/owned_volumes" 2>/dev/null || true ;; esac
    exit 0 ;;
  inspect) if [ -s "$FAKE_DIR/owned_containers" ]; then echo "cvfpt-media-test"; exit 0; fi; exit 1 ;;
  rm) if [ ! -f "$FAKE_DIR/rm_leaves" ]; then : > "$FAKE_DIR/owned_postgrest"; fi; exit 0 ;;
  run) echo restid > "$FAKE_DIR/owned_postgrest"; exit 0 ;;
  exec) exit 0 ;;
esac
exit 0
DOCKER
  cat > "$1/supabase" <<'SUPABASE'
#!/usr/bin/env bash
echo "supabase $*" >> "$FAKE_DIR/supabase.log"
sub=""
for a in "$@"; do case "$a" in start|stop|db) sub="$a" ;; esac; done
case "$sub" in
  start) echo cid1 > "$FAKE_DIR/owned_containers"; touch "$FAKE_DIR/owned_container_running"; exit 0 ;;
  stop)
    if [ -f "$FAKE_DIR/stop_fail" ]; then exit 1; fi
    if [ ! -f "$FAKE_DIR/stop_leaves" ]; then : > "$FAKE_DIR/owned_containers"; : > "$FAKE_DIR/owned_volumes"; rm -f "$FAKE_DIR/owned_container_running"; fi
    exit 0 ;;
esac
exit 0
SUPABASE
  cat > "$1/lsof" <<'LSOF'
#!/usr/bin/env bash
for a in "$@"; do case "$a" in -iTCP:*) port="${a#-iTCP:}" ;; esac; done
[ -f "$FAKE_DIR/busy_${port:-none}" ]
LSOF
  chmod +x "$1/docker" "$1/supabase" "$1/lsof"
}

sandbox() {
  CASE="$1"
  SB="$(mktemp -d "$WORK/sb.XXXXXX")"
  export FAKE_DIR="$SB/fake"
  mkdir -p "$FAKE_DIR" "$SB/bin" "$SB/tmp" "$SB/repo/supabase/migrations" "$SB/repo/supabase/tests/exercise_media"
  printf 'project_id = "CVFPT-main"\n[api]\nport = 54321\n[db]\nport = 54322\nshadow_port = 54320\n' > "$SB/repo/supabase/config.toml"
  cp "$HERE/stack.sh" "$SB/repo/supabase/tests/exercise_media/stack.sh"
  write_fakes "$SB/bin"
  : > "$FAKE_DIR/supabase.log"; : > "$FAKE_DIR/docker.log"
  export PATH="$SB/bin:$ORIG_PATH" TMPDIR="$SB/tmp"
  STACK="$SB/repo/supabase/tests/exercise_media/stack.sh"
  STACK_DIR="$SB/tmp/cvfpt-media-test-stack"
  OUT="$SB/out.log"
}
stack() { set +e; bash "$STACK" "$@" > "$OUT" 2>&1; CODE=$?; set -e; }
expect_code() { [ "$CODE" -eq "$1" ] || fail "expected exit $1, got $CODE"; }
expect_nonzero() { [ "$CODE" -ne 0 ] || fail "expected a non-zero exit, got 0"; }
expect_no_supabase_calls() { [ ! -s "$FAKE_DIR/supabase.log" ] || fail "supabase must not be called: $(cat "$FAKE_DIR/supabase.log")"; }
expect_never_foreign() { ! grep -q "CVFPT-main\|series-test\|quick-sessions" "$FAKE_DIR/supabase.log" "$FAKE_DIR/docker.log" || fail "a command named another project"; }
done_case() { PASS=$((PASS + 1)); echo "  ok  $CASE"; }
owned_running() { echo cid1 > "$FAKE_DIR/owned_containers"; echo vol1 > "$FAKE_DIR/owned_volumes"; touch "$FAKE_DIR/owned_container_running"; }
owned_config() { mkdir -p "$STACK_DIR/supabase"; printf 'project_id = "cvfpt-media-test"\n' > "$STACK_DIR/supabase/config.toml"; }
foreign_config() { mkdir -p "$STACK_DIR/supabase"; printf 'project_id = "CVFPT-main"\n' > "$STACK_DIR/supabase/config.toml"; }

sandbox "foreign scratch config and nothing owned -> down only removes scratch files"
foreign_config; stack down
expect_code 0; expect_no_supabase_calls; [ ! -e "$STACK_DIR" ] || fail "scratch dir should be removed"; done_case

sandbox "owned stack running -> down stops ONLY the fixed project"
owned_config; owned_running; stack down
expect_code 0
[ "$(cat "$FAKE_DIR/supabase.log")" = "supabase stop --project-id cvfpt-media-test --no-backup" ] || fail "unexpected: $(cat "$FAKE_DIR/supabase.log")"
expect_never_foreign; done_case

sandbox "owned PostgREST present -> removed by its owned id only, then the stack"
owned_config; owned_running; echo restid > "$FAKE_DIR/owned_postgrest"; stack down
expect_code 0; grep -q "docker rm -f restid" "$FAKE_DIR/docker.log" || fail "owned PostgREST not removed"
! grep -q "docker rm -f .*cvfpt-media-test-postgrest\|docker rm -f [^r]" "$FAKE_DIR/docker.log" || fail "removed something other than the owned id"; done_case

sandbox "owned PostgREST survives removal -> down fails loudly"
owned_config; echo restid > "$FAKE_DIR/owned_postgrest"; touch "$FAKE_DIR/rm_leaves"; stack down
expect_nonzero; grep -q "owned PostgREST remains" "$OUT" || fail "should name the leftover PostgREST"; [ -d "$STACK_DIR" ] || fail "scratch kept"; done_case

sandbox "stop fails -> down fails and keeps scratch"
owned_config; owned_running; touch "$FAKE_DIR/stop_fail"; stack down
expect_nonzero; [ -d "$STACK_DIR" ] || fail "scratch dir must be kept"; done_case

sandbox "stop leaves the container -> incomplete teardown"
owned_config; owned_running; touch "$FAKE_DIR/stop_leaves"; stack down
expect_nonzero; grep -q "incomplete teardown" "$OUT" || fail "should say incomplete"; done_case

sandbox "Docker not responding -> down cannot verify and fails"
owned_config; touch "$FAKE_DIR/docker_down"; stack down
expect_nonzero; expect_no_supabase_calls; done_case

sandbox "a failed ps is a failure, never 'nothing there'"
owned_config; touch "$FAKE_DIR/ps_fail"; stack down
expect_nonzero; expect_no_supabase_calls; done_case

sandbox "a busy stack port refuses startup before anything starts"
touch "$FAKE_DIR/busy_58322"; stack up
expect_nonzero; grep -q "refusing: port 58322" "$OUT" || fail "should name the busy port"; expect_no_supabase_calls; [ ! -d "$STACK_DIR/supabase" ] || fail "no config staged"; done_case

sandbox "up rewrites the copy to the owned id and 583xx ports, never starting another project"
stack up
expect_code 0; grep -q 'project_id = "cvfpt-media-test"' "$STACK_DIR/supabase/config.toml" || fail "id not rewritten"
grep -q "port = 58322" "$STACK_DIR/supabase/config.toml" || fail "db port not shifted"
! grep -qE "543[0-9]{2}" "$STACK_DIR/supabase/config.toml" || fail "543xx survived"
grep -q "supabase --workdir $STACK_DIR start" "$FAKE_DIR/supabase.log" || fail "start not scoped to workdir"; expect_never_foreign; done_case

sandbox "postgrest-up refuses a busy port, bad port and a second owned instance"
owned_config; owned_running
stack postgrest-up abc /dev/null; expect_nonzero
printf 'PGRST_JWT_SECRET=x\n' > "$SB/env"; touch "$FAKE_DIR/busy_58400"; stack postgrest-up 58400 "$SB/env"; expect_nonzero
rm "$FAKE_DIR/busy_58400"; echo restid > "$FAKE_DIR/owned_postgrest"; stack postgrest-up 58400 "$SB/env"; expect_nonzero
grep -q "already exists" "$OUT" || fail "second instance should be refused"
: > "$FAKE_DIR/owned_postgrest"; stack postgrest-up 58400 "$SB/env"; expect_code 0
grep -q "127.0.0.1:58400:3000" "$FAKE_DIR/docker.log" || fail "PostgREST must bind loopback only"; done_case

sandbox "postgrest-down removes only the owned PostgREST id and never the stack"
owned_config; owned_running; echo restid > "$FAKE_DIR/owned_postgrest"; stack postgrest-down
expect_code 0; grep -q "docker rm -f restid" "$FAKE_DIR/docker.log" || fail "owned PostgREST not removed"; expect_no_supabase_calls; done_case

sandbox "reset/psql refuse when the owned container is absent"
owned_config; stack reset; expect_code 2; stack psql -c 'select 1'; expect_code 2; expect_no_supabase_calls; done_case

echo "media stack guard tests passed ($PASS cases)"
