#!/usr/bin/env bash
# Owned, disposable Supabase stack for the exercise media database tests and the
# local media integration/demo harness. LOCAL ONLY.
#
#   stack.sh up                    create the scratch work dir and start the database
#   stack.sh reset [--version V]   rebuild THIS stack's database from the copied migrations
#   stack.sh psql [psql args...]   run psql inside THIS stack's database container
#   stack.sh postgrest-up PORT ENVFILE  start THIS stack's PostgREST on 127.0.0.1:PORT
#   stack.sh postgrest-down        remove only the PostgREST carrying this stack's owner label
#   stack.sh status                exit 0 running, 1 not running, 2 Docker could not be queried
#   stack.sh down                  stop THIS stack + its PostgREST, delete volumes and scratch dir
#
# Identity is FIXED: project id "cvfpt-media-test", container "supabase_db_cvfpt-media-test",
# ports shifted from 543xx to 583xx (series uses 553xx, Quick 573xx), work dir
# "$TMPDIR/cvfpt-media-test-stack", PostgREST container "cvfpt-media-test-postgrest" carrying
# label com.cvfpt.owner=cvfpt-media-test. It never touches the repository's normal local
# stack, another test stack or any other container, and it never restarts Docker.
#
# Safety rules (regression tests in stack_guard_test.sh):
#  - The configuration is built and VERIFIED in a staging directory and only then moved into
#    place, so "$STACK_DIR/supabase" never holds a copy that still names another project.
#  - `up` refuses to start when any of the stack's ports already has a listener.
#  - Nothing is stopped because a directory exists. `down` stops only containers/volumes
#    carrying this project's labels. Every Docker query must SUCCEED; a failed query is a
#    failure, never "nothing there".
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PROJECT_ID="cvfpt-media-test"
LABEL="com.supabase.cli.project"
OWNER_LABEL="com.cvfpt.owner"
STACK_DIR="${TMPDIR:-/tmp}/${PROJECT_ID}-stack"
DB_CONTAINER="supabase_db_${PROJECT_ID}"
POSTGREST_CONTAINER="${PROJECT_ID}-postgrest"
POSTGREST_IMAGE="postgrest/postgrest:v16.4"
NETWORK="supabase_network_${PROJECT_ID}"
PORTS="58320 58321 58322 58323 58324 58327 58329"
EXCLUDE="gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor"
TIMEOUT=""
if command -v timeout >/dev/null 2>&1; then TIMEOUT="timeout 60"; fi

dk() { $TIMEOUT docker "$@"; }
sb() { supabase --workdir "$STACK_DIR" "$@"; }   # only ever used after config_is_owned

config_is_owned() {
  [ -f "$STACK_DIR/supabase/config.toml" ] && grep -qx "project_id = \"$PROJECT_ID\"" "$STACK_DIR/supabase/config.toml"
}

owned_containers() { dk ps -a --filter "label=${LABEL}=${PROJECT_ID}" -q; }
owned_volumes() { dk volume ls --filter "label=${LABEL}=${PROJECT_ID}" -q; }
owned_postgrest() { dk ps -a --filter "label=${OWNER_LABEL}=${PROJECT_ID}" -q; }

assert_owned() {
  local label
  label="$(dk inspect --format "{{ index .Config.Labels \"${LABEL}\" }}" "$DB_CONTAINER" 2>/dev/null || true)"
  if [ "$label" != "$PROJECT_ID" ]; then
    echo "refusing: container $DB_CONTAINER is not owned by project $PROJECT_ID (label='$label')" >&2
    exit 2
  fi
}

port_busy() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

teardown() {
  dk info >/dev/null 2>&1 || { echo "cannot verify teardown: the Docker engine is not responding" >&2; return 1; }
  local containers volumes where rest
  rest="$(owned_postgrest)"
  if [ -n "$rest" ]; then
    # shellcheck disable=SC2086
    dk rm -f $rest >/dev/null
    rest="$(owned_postgrest)"
    if [ -n "$rest" ]; then echo "incomplete teardown: owned PostgREST remains ($rest)" >&2; return 1; fi
  fi
  containers="$(owned_containers)"
  volumes="$(owned_volumes)"
  if [ -n "$containers" ] || [ -n "$volumes" ]; then
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
    for port in $PORTS; do
      if port_busy "$port"; then echo "refusing: port $port already has a listener that this stack does not own" >&2; exit 1; fi
    done
    mkdir -p "$STACK_DIR/staging"
    cp -R "$ROOT/supabase" "$STACK_DIR/staging/supabase"
    rm -rf "$STACK_DIR/staging/supabase/.temp" "$STACK_DIR/staging/supabase/.branches"   # never inherit a hosted-project link
    sed -E -i.bak \
      -e "s/^project_id = .*/project_id = \"$PROJECT_ID\"/" \
      -e 's/([^0-9])543([0-9]{2})([^0-9]|$)/\1583\2\3/g' \
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
  postgrest-up)
    port="${1:?port required}"; envfile="${2:?env file required}"
    assert_owned
    case "$port" in ''|*[!0-9]*) echo "invalid port" >&2; exit 2 ;; esac
    [ -f "$envfile" ] || { echo "env file missing" >&2; exit 2; }
    if port_busy "$port"; then echo "refusing: port $port already has a listener" >&2; exit 1; fi
    if [ -n "$(owned_postgrest)" ]; then echo "refusing: an owned PostgREST already exists; run down first" >&2; exit 1; fi
    dk run -d --name "$POSTGREST_CONTAINER" --label "${OWNER_LABEL}=${PROJECT_ID}" \
      --network "$NETWORK" -p "127.0.0.1:${port}:3000" --env-file "$envfile" \
      -e "PGRST_DB_URI=postgres://authenticator:postgres@${DB_CONTAINER}:5432/postgres" \
      -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_DB_POOL=10 \
      "$POSTGREST_IMAGE" >/dev/null
    ;;
  postgrest-down)
    dk info >/dev/null 2>&1 || { echo "Docker engine is not responding" >&2; exit 1; }
    rest="$(owned_postgrest)"
    if [ -n "$rest" ]; then
      # shellcheck disable=SC2086
      dk rm -f $rest >/dev/null
      [ -z "$(owned_postgrest)" ] || { echo "owned PostgREST remains" >&2; exit 1; }
    fi
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
    echo "usage: stack.sh up|reset [--version V]|psql [args]|postgrest-up PORT ENVFILE|postgrest-down|status|down" >&2; exit 2 ;;
esac
