#!/usr/bin/env bash
# Real two-connection races for program application (independent review
# findings P2 cross-program shared workout, P2 same-application replay), in an
# OWNED disposable PostgreSQL container (no ports; psql via docker exec).
#   PR121_DB_CONTAINER=<name> PR121_DB_OWNER=<label> [MIGRATIONS_DIR=<dir>] bash concurrency.sh
# Refuses unless the container carries cvfpt.owner=$PR121_DB_OWNER. Never
# starts, pulls or stops containers. MIGRATIONS_DIR (default: this repo's)
# lets the same races run against an older chain to show the old behaviour.
# Each race uses a fresh clone of a template with the chain, the PR120 repair
# fixtures and fixtures_shared_program.sql. The first session holds its
# transaction open 2 s after applying; the second starts 0.7 s later.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/../../.." && pwd)"
MIG="${MIGRATIONS_DIR:-$ROOT/supabase/migrations}"
C="${PR121_DB_CONTAINER:?container name required}"
OWNER="${PR121_DB_OWNER:?owner label required}"
label="$(docker inspect --format '{{ index .Config.Labels "cvfpt.owner" }}' "$C" 2>/dev/null || true)"
[ "$label" = "$OWNER" ] || { echo "refusing: $C is not labelled cvfpt.owner=$OWNER (got '$label')" >&2; exit 2; }
psqlc() { docker exec -i "$C" psql -U postgres -X -q -v ON_ERROR_STOP=1 "$@"; }
T=pr121_template
psqlc -d postgres -c "drop database if exists $T" -c "create database $T" > /dev/null
psqlc -d $T > /dev/null <<'SQL'
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
n=0; for f in "$MIG"/*.sql; do psqlc -d $T < "$f" > /dev/null 2>&1 || { echo "migration failed: $f" >&2; exit 1; }; n=$((n + 1)); done
echo "template: $n migrations from $MIG, last $(basename "$(ls "$MIG"/*.sql | tail -1)")"
psqlc -d $T < "$ROOT/supabase/tests/pr120_repairs/fixtures.sql" > /dev/null
psqlc -d $T < "$DIR/fixtures_shared_program.sql" > /dev/null

U() { printf '00000000-0000-4000-8000-%012d' "$1"; }
fresh() { psqlc -d postgres -c "drop database if exists $1" -c "create database $1 template $T" > /dev/null; }
q() { psqlc -d "$1" -At -c "$2"; }
fail=0
check() { if [ "$2" = "$3" ]; then echo "PASS $1: $2"; else echo "FAIL $1: got '$2' expected '$3'"; fail=1; fi; }
race() {
  local db="$1" first="$2" second="$3" out1 out2 holder t0 t1
  out1="$(mktemp)"; out2="$(mktemp)"
  { printf 'begin;\nselect %s;\nselect pg_sleep(2);\ncommit;\n' "$first" | psqlc -d "$db" -At > "$out1" 2>&1; } &
  holder=$!
  sleep 0.7
  t0=$(python3 -c "import time; print(time.time())")
  printf 'select %s;\n' "$second" | psqlc -d "$db" -At > "$out2" 2>&1 || true
  t1=$(python3 -c "import time; print(time.time())")
  wait "$holder" || true
  FIRST="$(head -1 "$out1")"; SECOND="$(cat "$out2")"
  WAITED="$(python3 -c "print(round($t1-$t0,2))")"
  rm -f "$out1" "$out2"
}
o() { python3 -c 'import json,sys; t=sys.stdin.read().strip(); print(json.loads(t)["outcome"] if t.startswith("{") else ("preview_mismatch" if "preview_mismatch" in t else t.splitlines()[0][:100] if t else "(empty)"))'; }
APPLY() { echo "public.apply_program_substitution('$(U "$1")','$(U "$2")','$(U 73)','$(U 1)',$3,'{\"sets\":2}'::jsonb)"; }
P1IDS="array['$(U 61)','$(U 61)']::uuid[]"; P2IDS="array['$(U 61)']::uuid[]"
active() { q "$1" "select count(*) from public.workout_exercises where workout_id = '$(U 5)' and not archived"; }
receipts() { q "$1" "select count(*) from public.program_substitution_applications"; }

# E: two private programs sharing one workout, different applications, both previews valid.
fresh pr121_race_e
race pr121_race_e "$(APPLY 301 7 "$P1IDS")" "$(APPLY 302 17 "$P2IDS")"
echo "E second: $SECOND (waited ${WAITED}s)"
check "E cross-program outcomes" "$(echo "$FIRST" | o)/$(echo "$SECOND" | o)" "applied/preview_mismatch"
check "E one replacement in the shared workout" "$(active pr121_race_e)" "1"
check "E one receipt" "$(receipts pr121_race_e)" "1"

# E2: the same, second program first.
fresh pr121_race_e2
race pr121_race_e2 "$(APPLY 302 17 "$P2IDS")" "$(APPLY 301 7 "$P1IDS")"
echo "E2 second: $SECOND (waited ${WAITED}s)"
check "E2 cross-program outcomes (reverse)" "$(echo "$FIRST" | o)/$(echo "$SECOND" | o)" "applied/preview_mismatch"
check "E2 one replacement in the shared workout" "$(active pr121_race_e2)" "1"

# F: the same application id sent twice concurrently (retry after a lost reply).
fresh pr121_race_f
race pr121_race_f "$(APPLY 401 7 "$P1IDS")" "$(APPLY 401 7 "$P1IDS")"
echo "F second: $SECOND (waited ${WAITED}s)"
check "F same application id" "$(echo "$FIRST" | o)/$(echo "$SECOND" | o)" "applied/replayed"
check "F one replacement" "$(active pr121_race_f)" "1"
check "F one receipt" "$(receipts pr121_race_f)" "1"

# G: the same application id reused for a different payload (other program)
# while the first is in flight: never a second write.
fresh pr121_race_g
race pr121_race_g "$(APPLY 501 7 "$P1IDS")" "$(APPLY 501 17 "$P2IDS")"
echo "G second: $SECOND (waited ${WAITED}s)"
check "G reused id, different payload: one replacement" "$(active pr121_race_g)" "1"
check "G reused id: one receipt, for the first payload" "$(q pr121_race_g "select count(*) || '/' || min(program_assignment_id::text) from public.program_substitution_applications")" "1/$(U 7)"

# Single-session assertions on a fresh clone.
fresh pr121_check
if psqlc -d pr121_check < "$DIR/04_cross_program_sequential.sql" > /dev/null 2>&1; then echo "PASS 04_cross_program_sequential.sql (real PostgreSQL)"; else echo "FAIL 04_cross_program_sequential.sql"; fail=1; fi

for db in pr121_race_e pr121_race_e2 pr121_race_f pr121_race_g pr121_check $T; do psqlc -d postgres -c "drop database if exists $db" > /dev/null; done
echo "databases dropped"
exit $fail
