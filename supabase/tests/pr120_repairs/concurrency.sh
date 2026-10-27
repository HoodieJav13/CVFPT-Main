#!/usr/bin/env bash
# Real multi-connection races for the PR120 repair SQL, run inside an OWNED,
# disposable PostgreSQL container (no published ports; psql via docker exec).
#   PR120_DB_CONTAINER=<name> PR120_DB_OWNER=<label value> bash concurrency.sh
# Refuses unless the container carries label cvfpt.owner=$PR120_DB_OWNER. It
# never starts, pulls or stops containers; the caller owns the container.
# Each race runs in a fresh database cloned from a template that holds the
# full migration chain and fixtures.sql. Two psql sessions overlap: the first
# keeps its transaction open (pg_sleep) while the second must wait on the row
# lock and then see the first one's committed decision.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/../../.." && pwd)"
C="${PR120_DB_CONTAINER:?container name required}"
OWNER="${PR120_DB_OWNER:?owner label required}"
label="$(docker inspect --format '{{ index .Config.Labels "cvfpt.owner" }}' "$C" 2>/dev/null || true)"
[ "$label" = "$OWNER" ] || { echo "refusing: $C is not labelled cvfpt.owner=$OWNER (got '$label')" >&2; exit 2; }
psqlc() { docker exec -i "$C" psql -U postgres -X -q -v ON_ERROR_STOP=1 "$@"; }

psqlc -d postgres -c 'drop database if exists pr120_template' -c 'create database pr120_template'
# Minimal Supabase-shaped prerequisites that a database-only container lacks.
psqlc -d pr120_template <<'SQL'
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
for f in "$ROOT"/supabase/migrations/*.sql; do psqlc -d pr120_template < "$f" > /dev/null; n=$((n + 1)); done
echo "template: $n migrations, last $(basename "$(ls "$ROOT"/supabase/migrations/*.sql | tail -1)")"
psqlc -d pr120_template < "$DIR/fixtures.sql" > /dev/null
for f in "$DIR"/0*.sql; do
  psqlc -d postgres -c 'drop database if exists pr120_check' -c 'create database pr120_check template pr120_template' > /dev/null
  psqlc -d pr120_check < "$f" > /dev/null && echo "PASS $(basename "$f") (real PostgreSQL, single session)"
done

U() { printf '00000000-0000-4000-8000-%012d' "$1"; }
fresh() { psqlc -d postgres -c "drop database if exists $1" -c "create database $1 template pr120_template" > /dev/null; }
q() { psqlc -d "$1" -At -c "$2"; }
fail=0
check() { if [ "$2" = "$3" ]; then echo "PASS $1: $2"; else echo "FAIL $1: got '$2' expected '$3'"; fail=1; fi; }

# race <db> <first sql> <second sql>: the first holds its transaction 2 s.
race() {
  local db="$1" first="$2" second="$3" out1 out2
  out1="$(mktemp)"; out2="$(mktemp)"
  { printf 'begin;\nselect %s;\nselect pg_sleep(2);\ncommit;\n' "$first" | psqlc -d "$db" -At > "$out1" 2>&1; } &
  local holder=$!
  sleep 0.7
  local t0 t1
  t0=$(python3 -c "import time; print(time.time())")
  printf 'select %s;\n' "$second" | psqlc -d "$db" -At > "$out2" 2>&1 || true
  t1=$(python3 -c "import time; print(time.time())")
  wait "$holder" || true
  FIRST="$(head -1 "$out1")"; SECOND="$(cat "$out2")"
  WAITED="$(python3 -c "print(round($t1-$t0,2))")"
  rm -f "$out1" "$out2"
}
o() { python3 -c 'import json,sys; t=sys.stdin.read().strip(); print(json.loads(t)["outcome"] if t.startswith("{") else t.splitlines()[0][:80])'; }

L=$(U 21); C1=$(U 1)
fresh pr120_race_a
race pr120_race_a "public.decide_workout_substitution('$L','$(U 71)','approve','$(U 101)','$C1')" "public.decide_workout_substitution('$L','$(U 71)','decline','$(U 102)','$C1')"
check "A approve holds, competing decline" "$(echo "$FIRST" | o)/$(echo "$SECOND" | o)" "approve/already_decided"
echo "     decline waited ${WAITED}s for the approve transaction"
check "A final state" "$(q pr120_race_a "select s.status || '/' || (select count(*) from public.workout_log_exercises where id = '$(U 41)') from public.workout_log_substitutions s where id = '$(U 71)'")" "active/1"

fresh pr120_race_b
race pr120_race_b "public.decide_workout_substitution('$L','$(U 71)','decline','$(U 103)','$C1')" "public.decide_workout_substitution('$L','$(U 71)','approve','$(U 104)','$C1')"
check "B decline holds, competing approve" "$(echo "$FIRST" | o)/$(echo "$SECOND" | o)" "decline/already_decided"
echo "     approve waited ${WAITED}s for the decline transaction"
check "B final state" "$(q pr120_race_b "select s.status || '/' || (select count(*) from public.workout_log_exercises where id = '$(U 41)') from public.workout_log_substitutions s where id = '$(U 71)'")" "declined/0"

fresh pr120_race_c
race pr120_race_c "public.decide_workout_substitution('$L','$(U 71)','approve','$(U 105)','$C1')" "public.decide_workout_substitution('$L','$(U 71)','approve','$(U 105)','$C1')"
check "C same event twice" "$(echo "$FIRST" | o)/$(echo "$SECOND" | o)" "approve/replayed"
check "C one activation" "$(q pr120_race_c "select count(*) from public.workout_log_exercises where substitution_id = '$(U 71)'")" "1"

fresh pr120_race_d
IDS="array['$(U 61)','$(U 61)']::uuid[]"
race pr120_race_d "public.apply_program_substitution('$(U 201)','$(U 7)','$(U 73)','$C1',$IDS,'{\"sets\":2}'::jsonb)" "public.apply_program_substitution('$(U 202)','$(U 7)','$(U 73)','$C1',$IDS,'{\"sets\":2}'::jsonb)"
check "D concurrent program applications" "$(echo "$FIRST" | o)/$(echo "$SECOND" | grep -o 'preview_mismatch' | head -1)" "applied/preview_mismatch"
echo "     second application waited ${WAITED}s for the first"
check "D one replacement in the reused workout" "$(q pr120_race_d "select count(*) from public.workout_exercises where workout_id = '$(U 5)' and not archived")" "1"

for db in pr120_race_a pr120_race_b pr120_race_c pr120_race_d pr120_check pr120_template; do psqlc -d postgres -c "drop database if exists $db" > /dev/null; done
echo "databases dropped"
exit $fail
