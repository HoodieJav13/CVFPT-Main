#!/usr/bin/env bash
# Independent review F2 regression. Real committed connections, synthetic owned-stack data.
# The clone-first trigger pauses AFTER the source header read and BEFORE the exercise read,
# reproducing the exact old-title/new-prescription boundary from the controlling review.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
db() { bash "$DIR/stack.sh" psql -At "$@"; }
TMP="$(mktemp -d)"
cleanup() {
  db -c 'drop trigger if exists qs_pause_generic_clone on public.workouts; drop function if exists public.qs_pause_generic_clone();' >/dev/null
  rm -rf "$TMP"
}
trap cleanup EXIT
C='f1000000-0000-4000-8000-000000000001'
K='f2000000-0000-4000-8000-000000000001'
db <<SQL
insert into coaches(id,name,email) values('$C','Generic Race Coach','generic-race@example.invalid');
insert into clients(id,coach_id,name,email) values('$K','$C','Generic Race Client','generic-client@example.invalid');
SQL
wait_for() {
  for tick in {1..60}; do
    if [ "$(db -c "$1")" = 1 ]; then return; fi
    sleep 0.05
  done
  echo "FAIL: did not observe $2" >&2; return 1
}
for ORDER in clone-first edit-first; do
  A="$(db -c "select public.create_quick_session('$C','$K',gen_random_uuid(),'v1:' || repeat('f',64),'2031-05-01','Old title',null,'[{\"custom_name\":\"Race row\",\"sets\":\"1\"}]'::jsonb)->>'assignment_id';")"
  W="$(db -c "select workout_id from workout_assignments where id='$A';")"
  CLONE="select public.save_workout_as_template('$W','$C',null,null);"
  EDIT="select public.save_workout('$W','$C','New title',null,null,'[{\"custom_name\":\"Race row\",\"sets\":\"9\"}]'::jsonb);"
  echo "-- F2 generic template versus quick edit ($ORDER)"
  if [ "$ORDER" = clone-first ]; then
    db <<SQL
create function public.qs_pause_generic_clone() returns trigger language plpgsql as \$\$
begin
 if new.is_template and new.source_workout_id='$W'::uuid then perform pg_sleep(5); end if;
 return new;
end;\$\$;
create trigger qs_pause_generic_clone before insert on public.workouts for each row execute function public.qs_pause_generic_clone();
SQL
    db -c "set application_name='qs_generic_holder'; $CLONE" > "$TMP/holder" & HOLDER=$!
    wait_for "select count(*) from pg_stat_activity where application_name='qs_generic_holder' and wait_event='PgSleep';" 'clone at header/exercise boundary'
    db -c "set application_name='qs_generic_waiter'; $EDIT" > "$TMP/waiter" & WAITER=$!
    EXPECTED='Old title|1'
  else
    db -c "set application_name='qs_generic_holder'; begin; $EDIT select pg_sleep(5); commit;" > "$TMP/holder" & HOLDER=$!
    wait_for "select count(*) from pg_stat_activity where application_name='qs_generic_holder' and wait_event='PgSleep';" 'edited source held before commit'
    db -c "set application_name='qs_generic_waiter'; $CLONE" > "$TMP/waiter" & WAITER=$!
    EXPECTED='New title|9'
  fi
  # Prove actual waiting and lock graph, not elapsed-time inference.
  BLOCKED=0
  if wait_for "select count(*) from pg_stat_activity w join pg_stat_activity h on h.pid=any(pg_blocking_pids(w.pid)) where w.application_name='qs_generic_waiter' and h.application_name='qs_generic_holder' and w.wait_event='advisory';" 'waiter blocked by holder on common quick advisory lock'; then BLOCKED=1; fi
  wait "$HOLDER"; wait "$WAITER"
  RESULT="$(db -c "select w.name || '|' || e.sets from workouts w join workout_exercises e on e.workout_id=w.id where w.source_workout_id='$W' and w.is_template and not e.archived;")"
  echo "F2 persisted generic template: $RESULT; expected $EXPECTED"
  [ "$RESULT" = "$EXPECTED" ] || { echo 'FAIL: generic clone persisted mixed content'; exit 1; }
  [ "$BLOCKED" = 1 ] || exit 1
  echo "PASS: F2 $ORDER common-lock wait and coherent committed template"
  [ "$(db -c "select name from workouts where id='$W';")" = 'New title' ] || exit 1
  echo "PASS: F2 $ORDER edit commits to original private source"
  db -c 'drop trigger if exists qs_pause_generic_clone on public.workouts; drop function if exists public.qs_pause_generic_clone();' >/dev/null
done
