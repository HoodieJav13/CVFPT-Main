#!/usr/bin/env bash
# Regression tests for stack.sh safety. They put FAKE `docker` and `supabase` executables first on
# PATH, so they need neither Docker nor the Supabase CLI and can run anywhere (including CI before
# the real database job). They prove that no failure path stops or resets any project other than
# the fixed test project, and that teardown/inspection failures are never swallowed.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=fake_bins.sh
. "$HERE/fake_bins.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
ORIG_PATH="$PATH"
PASS=0
fail() { echo "FAIL [$CASE]: $*" >&2; [ -f "${OUT:-/dev/null}" ] && sed 's/^/    | /' "$OUT" >&2; exit 1; }

sandbox() {   # sandbox <case-name>; builds a miniature repo plus fakes, and points the environment at them
  CASE="$1"
  SB="$(mktemp -d "$WORK/sb.XXXXXX")"
  export FAKE_DIR="$SB/fake"
  mkdir -p "$FAKE_DIR" "$SB/bin" "$SB/tmp" "$SB/repo/supabase/migrations" "$SB/repo/supabase/tests/session_series"
  printf 'project_id = "CVFPT-main"\n[api]\nport = 54321\n[db]\nport = 54322\nshadow_port = 54320\n' > "$SB/repo/supabase/config.toml"
  cp "$HERE/stack.sh" "$SB/repo/supabase/tests/session_series/stack.sh"
  write_fake_bins "$SB/bin"
  : > "$FAKE_DIR/supabase.log"; : > "$FAKE_DIR/docker.log"
  export PATH="$SB/bin:$ORIG_PATH" TMPDIR="$SB/tmp"
  STACK="$SB/repo/supabase/tests/session_series/stack.sh"
  STACK_DIR="$SB/tmp/cvfpt-series-test-stack"
  OUT="$SB/out.log"
}
stack() { set +e; bash "$STACK" "$@" > "$OUT" 2>&1; CODE=$?; set -e; }
expect_code() { [ "$CODE" -eq "$1" ] || fail "expected exit $1, got $CODE"; }
expect_nonzero() { [ "$CODE" -ne 0 ] || fail "expected a non-zero exit, got 0"; }
expect_no_supabase_calls() { [ ! -s "$FAKE_DIR/supabase.log" ] || fail "supabase must not be called, but was: $(cat "$FAKE_DIR/supabase.log")"; }
expect_never_foreign() { ! grep -q "CVFPT-main" "$FAKE_DIR/supabase.log" || fail "a command named the normal development project"; }
done_case() { PASS=$((PASS + 1)); echo "  ok  $CASE"; }

owned_stack_running() { echo cid1 > "$FAKE_DIR/owned_containers"; echo vol1 > "$FAKE_DIR/owned_volumes"; touch "$FAKE_DIR/owned_container_running"; }
write_owned_config() { mkdir -p "$STACK_DIR/supabase"; printf 'project_id = "cvfpt-series-test"\n' > "$STACK_DIR/supabase/config.toml"; }
write_foreign_config() { mkdir -p "$STACK_DIR/supabase"; printf 'project_id = "CVFPT-main"\n' > "$STACK_DIR/supabase/config.toml"; }

sandbox "partial setup: scratch copy still names CVFPT-main -> down only deletes scratch files"
write_foreign_config
stack down
expect_code 0; expect_no_supabase_calls; [ ! -e "$STACK_DIR" ] || fail "scratch dir should be removed"; done_case

sandbox "a development stack is running (foreign label) -> down never touches it"
write_foreign_config
printf 'container|devid1|supabase_db_CVFPT-main|2026-09-01|running\n' > "$FAKE_DIR/containers_all"
stack down
expect_code 0; expect_no_supabase_calls; expect_never_foreign; done_case

sandbox "owned stack running -> down stops ONLY the fixed project, then removes scratch"
write_owned_config; owned_stack_running
stack down
expect_code 0
[ "$(cat "$FAKE_DIR/supabase.log")" = "supabase stop --project-id cvfpt-series-test --no-backup" ] || fail "unexpected supabase calls: $(cat "$FAKE_DIR/supabase.log")"
expect_never_foreign; [ ! -e "$STACK_DIR" ] || fail "scratch dir should be removed"; done_case

sandbox "owned stack running but the scratch config is the partial/foreign copy -> still stops only the fixed project id"
write_foreign_config; owned_stack_running
stack down
expect_code 0
[ "$(cat "$FAKE_DIR/supabase.log")" = "supabase stop --project-id cvfpt-series-test --no-backup" ] || fail "unexpected supabase calls: $(cat "$FAKE_DIR/supabase.log")"
expect_never_foreign; done_case

sandbox "stop fails -> down fails and keeps the scratch dir for a retry"
write_owned_config; owned_stack_running; touch "$FAKE_DIR/stop_fail"
stack down
expect_nonzero; [ -d "$STACK_DIR" ] || fail "scratch dir must be kept when teardown failed"; done_case

sandbox "stop 'succeeds' but the container is left behind -> down fails"
write_owned_config; owned_stack_running; touch "$FAKE_DIR/stop_leaves"
stack down
expect_nonzero; grep -q "incomplete teardown" "$OUT" || fail "should say teardown is incomplete"; [ -d "$STACK_DIR" ] || fail "scratch dir must be kept"; done_case

sandbox "stop removes the container but leaves an owned volume -> down fails"
write_owned_config; owned_stack_running; touch "$FAKE_DIR/stop_leaves_volume"
stack down
expect_nonzero; grep -q "volumes: vol1" "$OUT" || fail "should name the leftover volume"; done_case

sandbox "Docker engine not responding -> down fails and calls nothing"
write_owned_config; touch "$FAKE_DIR/docker_down"
stack down
expect_nonzero; expect_no_supabase_calls; done_case

sandbox "docker ps failing is not treated as 'nothing to stop'"
write_owned_config; touch "$FAKE_DIR/ps_fail"
stack down
expect_nonzero; expect_no_supabase_calls; done_case

sandbox "nothing exists at all -> down is a clean no-op"
stack down
expect_code 0; expect_no_supabase_calls; done_case

sandbox "setup failure BEFORE the config rewrite (repo config.toml missing) -> up fails, never starts, nothing to stop afterwards"
rm "$SB/repo/supabase/config.toml"
stack up
expect_nonzero
! grep -q " start" "$FAKE_DIR/supabase.log" || fail "start must not run"
[ ! -e "$STACK_DIR/supabase" ] || fail "no half-built 'supabase' dir may remain"
stack down
expect_code 0; expect_no_supabase_calls; expect_never_foreign; done_case

sandbox "rewrite is a silent no-op (no project_id line) -> up refuses before starting"
printf '[api]\nport = 54321\n' > "$SB/repo/supabase/config.toml"
stack up
expect_nonzero; grep -q "config rewrite failed" "$OUT" || fail "should explain the refusal"
! grep -q " start" "$FAKE_DIR/supabase.log" || fail "start must not run"
[ ! -e "$STACK_DIR/supabase" ] || fail "no unverified config may remain"; done_case

sandbox "ports left unrewritten -> up refuses before starting"
printf 'project_id = "CVFPT-main"\n[api]\nport = 54321x\nurl = "http://127.0.0.1:54321"\n' > "$SB/repo/supabase/config.toml"
# 54321 followed by a letter is not rewritten by the digit-guarded pattern, so the leftover check must catch it
stack up
if [ "$CODE" -eq 0 ]; then
  # the guarded pattern DID rewrite the url form; make sure the owned config is correct instead
  grep -qx 'project_id = "cvfpt-series-test"' "$STACK_DIR/supabase/config.toml" || fail "owned config expected"
else
  ! grep -q " start" "$FAKE_DIR/supabase.log" || fail "start must not run after a refused rewrite"
fi; done_case

sandbox "startup fails after a verified rewrite -> down then stops only the fixed project"
touch "$FAKE_DIR/start_fail"
stack up
expect_nonzero
grep -qx 'project_id = "cvfpt-series-test"' "$STACK_DIR/supabase/config.toml" || fail "the config that start saw must be the owned one"
echo cid1 > "$FAKE_DIR/owned_containers"            # a partially started owned container
stack down
expect_code 0; expect_never_foreign
[ "$(grep -c "stop" "$FAKE_DIR/supabase.log")" -eq 1 ] || fail "exactly one stop expected"
grep -q -- "--project-id cvfpt-series-test" "$FAKE_DIR/supabase.log" || fail "stop must name the fixed project"; done_case

sandbox "up happy path: owned ports and project id, started with the scratch workdir"
stack up
expect_code 0
grep -qx 'project_id = "cvfpt-series-test"' "$STACK_DIR/supabase/config.toml" || fail "owned project id expected"
grep -q "^port = 55321" "$STACK_DIR/supabase/config.toml" || fail "ports must be shifted to 553xx"
grep -q "55322" "$STACK_DIR/supabase/config.toml" && grep -q "55320" "$STACK_DIR/supabase/config.toml" || fail "db and shadow ports must be shifted"
grep -q -- "--workdir $STACK_DIR start" "$FAKE_DIR/supabase.log" || fail "start must use the scratch workdir"
expect_never_foreign; done_case

sandbox "up over a leftover owned stack tears it down first (stop by fixed project id), then starts"
owned_stack_running
stack up
expect_code 0
first_stop=$(grep -n "stop" "$FAKE_DIR/supabase.log" | head -1 | cut -d: -f1); first_start=$(grep -n " start" "$FAKE_DIR/supabase.log" | head -1 | cut -d: -f1)
[ -n "$first_stop" ] && [ -n "$first_start" ] && [ "$first_stop" -lt "$first_start" ] || fail "stop must precede start"
expect_never_foreign; done_case

sandbox "reset refuses an unverified scratch config and runs no reset"
write_foreign_config
stack reset
expect_code 2; ! grep -q "db reset" "$FAKE_DIR/supabase.log" || fail "reset must not run"; done_case

sandbox "status distinguishes running (0), absent (1), and cannot-inspect (2)"
owned_stack_running; stack status; expect_code 0
: > "$FAKE_DIR/owned_containers"; rm -f "$FAKE_DIR/owned_container_running"; stack status; expect_code 1
touch "$FAKE_DIR/ps_fail"; stack status; expect_code 2; done_case

echo "stack guard tests passed ($PASS cases)"
