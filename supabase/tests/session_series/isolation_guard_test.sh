#!/usr/bin/env bash
# Regression tests for isolation_check.sh. Fake `docker` plus stub run.sh/stack.sh siblings (copied next to
# a private copy of the real isolation_check.sh) let every failure mode be injected without Docker.
# The check must PASS only when every Docker query succeeded, nothing else changed, teardown succeeded
# and the owned stack is confirmed gone; every inspection/teardown failure must make it FAIL.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=fake_bins.sh
. "$HERE/fake_bins.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
ORIG_PATH="$PATH"
PASS=0
fail() { echo "FAIL [$CASE]: $*" >&2; [ -f "${OUT:-/dev/null}" ] && sed 's/^/    | /' "$OUT" >&2; exit 1; }

sandbox() {
  CASE="$1"
  SB="$(mktemp -d "$WORK/sb.XXXXXX")"
  export FAKE_DIR="$SB/fake"
  mkdir -p "$FAKE_DIR" "$SB/bin" "$SB/suite"
  write_fake_bins "$SB/bin"
  : > "$FAKE_DIR/docker.log"; : > "$FAKE_DIR/steps.log"
  cp "$HERE/isolation_check.sh" "$SB/suite/isolation_check.sh"
  cat > "$SB/suite/run.sh" <<'RUN'
#!/usr/bin/env bash
echo "run" >> "$FAKE_DIR/steps.log"
if [ -f "$FAKE_DIR/run_fail" ]; then exit 1; fi
if [ -f "$FAKE_DIR/run_mutates_other" ]; then printf 'container|devid1|supabase_db_CVFPT-main|2026-09-02|running\n' > "$FAKE_DIR/containers_all"; fi
echo cid1 > "$FAKE_DIR/owned_containers"; echo vol1 > "$FAKE_DIR/owned_volumes"
exit 0
RUN
  cat > "$SB/suite/stack.sh" <<'STACK'
#!/usr/bin/env bash
echo "stack $*" >> "$FAKE_DIR/steps.log"
[ "${1:-}" = "down" ] || exit 0
if [ -f "$FAKE_DIR/down_fail" ]; then exit 1; fi
if [ ! -f "$FAKE_DIR/down_leaves_container" ]; then : > "$FAKE_DIR/owned_containers"; fi
if [ ! -f "$FAKE_DIR/down_leaves_volume" ]; then : > "$FAKE_DIR/owned_volumes"; fi
if [ -f "$FAKE_DIR/down_removes_other" ]; then : > "$FAKE_DIR/containers_all"; fi
exit 0
STACK
  chmod +x "$SB/suite/"*.sh
  export PATH="$SB/bin:$ORIG_PATH"
  OUT="$SB/out.log"
}
check() { set +e; bash "$SB/suite/isolation_check.sh" > "$OUT" 2>&1; CODE=$?; set -e; }
expect_pass() { [ "$CODE" -eq 0 ] || fail "expected the check to pass, exit $CODE"; grep -q "isolation check passed" "$OUT" || fail "missing the success line"; }
expect_fail() { [ "$CODE" -ne 0 ] || fail "expected the check to FAIL but it exited 0"; ! grep -q "isolation check passed" "$OUT" || fail "must not print the success line"; }
ok() { PASS=$((PASS + 1)); echo "  ok  $CASE"; }
other_container() { printf 'container|devid1|supabase_db_CVFPT-main|2026-09-01|running\n' > "$FAKE_DIR/containers_all"; echo "dev_vol" > "$FAKE_DIR/volumes_all"; }

sandbox "a legitimately EMPTY other-resource inventory passes"
check; expect_pass; grep -q "before: 0  after: 0" "$OUT" || fail "should report zero resources"; ok

sandbox "another stack present and unchanged passes (and is counted)"
other_container; check; expect_pass; grep -q "before: 2  after: 2" "$OUT" || fail "should report the two other resources"; ok

sandbox "another stack's container changes during the run -> FAIL"
other_container; touch "$FAKE_DIR/run_mutates_other"; check; expect_fail; ok

sandbox "another stack's container disappears during teardown -> FAIL"
other_container; touch "$FAKE_DIR/down_removes_other"; check; expect_fail; ok

sandbox "container enumeration fails -> FAIL, never a passing empty inventory"
touch "$FAKE_DIR/ps_fail"; check; expect_fail; ok

sandbox "volume enumeration fails -> FAIL"
touch "$FAKE_DIR/volume_fail"; check; expect_fail; ok

sandbox "Docker engine not responding -> FAIL (isolation unverified)"
touch "$FAKE_DIR/docker_down"; check; expect_fail; grep -qi "not responding" "$OUT" || fail "should say Docker is not responding"; ok

sandbox "teardown (stack.sh down) fails -> FAIL"
touch "$FAKE_DIR/down_fail"; check; expect_fail; ok

sandbox "the test run itself fails -> FAIL, and a best-effort teardown is still attempted"
touch "$FAKE_DIR/run_fail"; check; expect_fail
grep -q "stack down" "$FAKE_DIR/steps.log" || fail "teardown should still be attempted after a failed run"; ok

sandbox "an owned container is left behind after teardown -> FAIL"
touch "$FAKE_DIR/down_leaves_container"; check; expect_fail; grep -q "not fully removed" "$OUT" || fail "should say the owned stack remains"; ok

sandbox "an owned volume is left behind after teardown -> FAIL"
touch "$FAKE_DIR/down_leaves_volume"; check; expect_fail; ok

echo "isolation guard tests passed ($PASS cases)"
