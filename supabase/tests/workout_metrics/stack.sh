#!/usr/bin/env bash
# Owned, disposable Supabase stack for the workout-metrics database tests. LOCAL ONLY.
#
#   stack.sh up                    create the scratch work dir and start the database
#   stack.sh reset [--version V]   rebuild THIS stack's database from the copied migrations
#   stack.sh psql [psql args...]   run psql inside THIS stack's database container
#   stack.sh status                exit 0 running, 1 not running, 2 Docker could not be queried
#   stack.sh down                  stop THIS stack, delete its volumes and scratch dir (fails loudly if it cannot)
#
# The identity is FIXED so every start, reset, test, race and cleanup targets the same owned
# stack:  project id "cvfpt-metrics-test", container "supabase_db_cvfpt-metrics-test",
# ports shifted from 543xx to 563xx, work dir "$TMPDIR/cvfpt-metrics-test-stack". It never
# touches the repository's normal local stack (project id "CVFPT-main") or any other
# container, and it never restarts Docker.
#
# Safety rules (each has a regression test in stack_guard_test.sh):
#  - The configuration is built and VERIFIED in a staging directory and only then moved into
#    place, so "$STACK_DIR/supabase" never holds a copy that still names another project.
#  - Nothing is stopped because a directory exists. `down` stops only the fixed test project
#    (`supabase stop --project-id cvfpt-metrics-test`), and only when Docker shows containers or
#    volumes carrying that project's label. Before that, it only removes scratch files.
#  - Every Docker query must SUCCEED. A failed query is a failure, never "nothing there".
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PROJECT_ID="cvfpt-metrics-test"
LABEL="com.supabase.cli.project"
STACK_DIR="${TMPDIR:-/tmp}/${PROJECT_ID}-stack"
DB_CONTAINER="supabase_db_${PROJECT_ID}"
# Start only the database: the SQL tests need nothing else.
EXCLUDE="gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor"
TIMEOUT=""
if command -v timeout >/dev/null 2>&1; then TIMEOUT="timeout 30"; fi

dk() { $TIMEOUT docker "$@"; }
sb() { supabase --workdir "$STACK_DIR" "$@"; }   # only ever used after config_is_owned

config_is_owned() {
  [ -f "$STACK_DIR/supabase/config.toml" ] && grep -qx "project_id = \"$PROJECT_ID\"" "$STACK_DIR/supabase/config.toml"
}

owned_containers() { dk ps -a --filter "label=${LABEL}=${PROJECT_ID}" -q; }
owned_volumes() { dk volume ls --filter "label=${LABEL}=${PROJECT_ID}" -q; }

assert_owned() {
  local label
  label="$(dk inspect --format "{{ index .Config.Labels \"${LABEL}\" }}" "$DB_CONTAINER" 2>/dev/null || true)"
  if [ "$label" != "$PROJECT_ID" ]; then
    echo "refusing: container $DB_CONTAINER is not owned by project $PROJECT_ID (label='$label')" >&2
    exit 2
  fi
}

teardown() {
  dk info >/dev/null 2>&1 || { echo "cannot verify teardown: the Docker engine is not responding" >&2; return 1; }
  local containers volumes where
  containers="$(owned_containers)"
  volumes="$(owned_volumes)"
  if [ -n "$containers" ] || [ -n "$volumes" ]; then
    # Run from the scratch dir (or TMPDIR) so the repository's own config can never be picked up.
    where="${TMPDIR:-/tmp}"; if [ -d "$STACK_DIR" ]; then where="$STACK_DIR"; fi
    ( cd "$where" && supabase stop --project-id "$PROJECT_ID" --no-backup )
    containers="$(owned_containers)"
    volumes="$(owned_volumes)"
    if [ -n "$containers" ] || [ -n "$volumes" ]; then
      echo "incomplete teardown: owned resources remain (containers: ${containers:-none}; volumes: ${volumes:-none})" >&2
      return 1
    fi
  fi
  rm -rf "$STACK_DIR"
}

cmd="${1:-}"; shift || true
case "$cmd" in
  up)
    command -v supabase >/dev/null || { echo "supabase CLI not found" >&2; exit 1; }
    dk info >/dev/null 2>&1 || { echo "Docker engine is not responding; not starting (this script never restarts Docker)" >&2; exit 1; }
    teardown                                         # any previous owned stack, verified gone
    mkdir -p "$STACK_DIR/staging"
    cp -R "$ROOT/supabase" "$STACK_DIR/staging/supabase"
    rm -rf "$STACK_DIR/staging/supabase/.temp" "$STACK_DIR/staging/supabase/.branches"   # never inherit a hosted-project link
    sed -E -i.bak \
      -e "s/^project_id = .*/project_id = \"$PROJECT_ID\"/" \
      -e 's/([^0-9])543([0-9]{2})([^0-9]|$)/\1563\2\3/g' \
      "$STACK_DIR/staging/supabase/config.toml"
    rm -f "$STACK_DIR/staging/supabase/config.toml.bak"
    if ! grep -qx "project_id = \"$PROJECT_ID\"" "$STACK_DIR/staging/supabase/config.toml"; then
      echo "config rewrite failed: the copy does not name project $PROJECT_ID; refusing to start" >&2
      rm -rf "$STACK_DIR"; exit 1
    fi
    if grep -nE '(^|[^0-9])543[0-9]{2}([^0-9]|$)' "$STACK_DIR/staging/supabase/config.toml"; then
      echo "port rewrite incomplete; refusing to start" >&2
      rm -rf "$STACK_DIR"; exit 1
    fi
    mv "$STACK_DIR/staging/supabase" "$STACK_DIR/supabase"
    rmdir "$STACK_DIR/staging"
    config_is_owned || { echo "internal error: staged config is not owned" >&2; rm -rf "$STACK_DIR"; exit 1; }
    sb start -x "$EXCLUDE"
    assert_owned
    ;;
  reset)
    config_is_owned || { echo "refusing: no verified owned config in $STACK_DIR" >&2; exit 2; }
    assert_owned
    if [ "${1:-}" = "--version" ]; then sb db reset --local --version "${2:?version required}"; else sb db reset --local; fi
    ;;
  psql)
    assert_owned
    dk exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 "$@"
    ;;
  status)
    echo "project=$PROJECT_ID container=$DB_CONTAINER workdir=$STACK_DIR"
    if ! state="$(dk ps -a --filter "name=^/${DB_CONTAINER}\$" --format '{{.State}}')"; then
      echo "cannot inspect: Docker did not answer" >&2; exit 2
    fi
    if [ "$state" = "running" ]; then echo "running: yes"; exit 0; fi
    echo "running: no (${state:-absent})"; exit 1
    ;;
  down)
    teardown
    echo "owned stack removed"
    ;;
  *)
    echo "usage: stack.sh up|reset [--version V]|psql [args]|status|down" >&2; exit 2 ;;
esac
