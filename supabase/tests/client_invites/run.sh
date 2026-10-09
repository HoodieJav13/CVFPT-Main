#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
STACK="$DIR/../session_series/stack.sh"
trap 'bash "$STACK" down' EXIT
bash "$STACK" up
bash "$STACK" reset
for f in "$DIR"/0*.sql; do
 { echo 'begin;'; cat "$DIR/fixtures.sql" "$f"; echo 'rollback;'; } | bash "$STACK" psql
done
bash "$DIR/concurrency.sh"
