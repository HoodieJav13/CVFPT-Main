#!/usr/bin/env bash
# Called only by the owned synthetic DB runner, after applying the migration.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
STACK="$HERE/stack.sh"
RACE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/cvfpt-metrics-race.XXXXXX")"
trap 'rm -rf "$RACE_DIR"' EXIT
bash "$STACK" psql <<'SQL'
do $$ declare w uuid; a uuid; r jsonb; begin
w:=public.save_workout(null,'10000000-0000-4000-8000-000000000001','Insert race',null,null,'[{"custom_name":"Race","sets":"1","default_load_value":55,"default_load_unit":"lb"}]');
a:=public.assign_workout_clone(w,'20000000-0000-4000-8000-000000000001','active',null,null,'[]');
r:=public.start_workout_log_v2('20000000-0000-4000-8000-000000000001',null,null,a,'client',null,null);
end $$;
SQL
bash "$STACK" psql <<'SQL' > "$RACE_DIR/completion.txt" 2>&1 &
begin;
select public.quick_complete_workout_log_v2((select id from public.workout_logs where workout_name='Insert race' and status='active'),'20000000-0000-4000-8000-000000000001');
select pg_sleep(4);
commit;
SQL
metrics_completion_pid=$!
metrics_completion_waiting=0
for attempt in {1..40}; do
  if [ "$(bash "$STACK" psql -Atc "select count(*) from pg_stat_activity where state='active' and wait_event='PgSleep'")" = 1 ]; then
    metrics_completion_waiting=1
    break
  fi
  sleep 0.1
done
[ "$metrics_completion_waiting" = 1 ] || { echo 'FAIL: race synchronization'; exit 1; }
set +e
bash "$STACK" psql <<'SQL' > "$RACE_DIR/insert.txt" 2>&1
insert into public.workout_log_sets(workout_log_exercise_id,set_number,set_origin)
select e.id,2,'extra' from public.workout_log_exercises e join public.workout_logs l on l.id=e.workout_log_id where l.workout_name='Insert race';
SQL
metrics_insert_status=$?
set -e
wait "$metrics_completion_pid"
if [ "$metrics_insert_status" = 0 ] || ! rg -q 'Completed workout logs cannot be changed' "$RACE_DIR/insert.txt"; then
  cat "$RACE_DIR/insert.txt"
  echo 'FAIL: insert raced into completed log'
  exit 1
fi
bash "$STACK" psql <<'SQL'
do $$ begin
if (select count(*) from public.workout_log_sets s join public.workout_log_exercises e on e.id=s.workout_log_exercise_id join public.workout_logs l on l.id=e.workout_log_id where l.workout_name='Insert race')<>1
or exists(select from public.workout_log_sets s join public.workout_log_exercises e on e.id=s.workout_log_exercise_id join public.workout_logs l on l.id=e.workout_log_id where l.workout_name='Insert race' and (l.status<>'completed' or s.status<>'completed' or s.set_origin<>'prescribed')) then
raise exception 'concurrent insert changed completed snapshot';
end if;
raise notice 'PASS: concurrent extra-set INSERT waits for completion and is rejected';
end $$;
SQL
