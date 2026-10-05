#!/usr/bin/env bash
# Synthetic data only, uniquely owned local stack. Never use a linked project.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
MIGRATION="$ROOT/supabase/migrations/20261005165134_workout_duration_distance.sql"
cleanup() { bash "$HERE/stack.sh" down; }
trap cleanup EXIT
bash "$HERE/stack.sh" up
bash "$HERE/stack.sh" reset --version 20261001120000
bash "$HERE/stack.sh" psql < "$ROOT/supabase/tests/exercise_history_pre_migration.sql"
# Prove additive migration can roll back as a transaction with legacy data kept.
{
  printf 'begin;\n'
  cat "$MIGRATION"
  sed '/^begin;$/d; /^rollback;$/d' "$HERE/assertions.sql"
  printf 'rollback;\n'
} | bash "$HERE/stack.sh" psql
bash "$HERE/stack.sh" psql -c "do \$\$ begin if exists(select from information_schema.columns where table_schema='public' and table_name='workout_log_sets' and column_name='actual_duration_value') then raise exception 'migration transaction did not roll back'; end if; if (select actual_load_value from public.workout_log_sets where id='90000000-0000-4000-8000-000000000001')<>42.5 then raise exception 'legacy data changed'; end if; raise notice 'PASS: migration transaction rolls back and preserves legacy data'; end \$\$;"
bash "$HERE/stack.sh" psql < "$MIGRATION"
bash "$HERE/stack.sh" psql < "$HERE/assertions.sql"
echo 'PASS: migration and lifecycle regressions; synthetic writes rolled back'
