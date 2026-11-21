-- Test-only helper, installed only in the disposable race cluster's template
-- database (never by a migration). A holding session calls it while its
-- transaction is open: it returns once a backend with the challenger's
-- application_name is waiting on a heavyweight lock (wait_event_type 'Lock')
-- AND pg_blocking_pids() names this holding backend, i.e. the challenger is
-- actually blocked BY the holder. Bounded: returns 'NOT_BLOCKED' at timeout.
-- pg_stat_activity is snapshotted per transaction, so the snapshot is cleared
-- on every poll.
create schema race_test;
create function race_test.wait_for_blocked(p_app text, p_timeout_s numeric) returns text
language plpgsql as $$
declare
  v_deadline timestamptz := clock_timestamp() + make_interval(secs => p_timeout_s);
  r record;
begin
  loop
    perform pg_stat_clear_snapshot();
    select a.pid, a.wait_event_type, a.wait_event, pg_blocking_pids(a.pid) as blockers,
           (select string_agg(l.locktype || ':' || l.mode, ',' order by l.locktype) from pg_locks l where l.pid = a.pid and not l.granted) as waiting_for
      into r
      from pg_stat_activity a
     where a.application_name = p_app and a.wait_event_type = 'Lock'
       and pg_backend_pid() = any(pg_blocking_pids(a.pid))
     limit 1;
    if found then
      return format('BLOCKED challenger_pid=%s wait_event=%s/%s waiting_for=%s blocked_by=%s', r.pid, r.wait_event_type, r.wait_event, r.waiting_for, r.blockers);
    end if;
    if clock_timestamp() > v_deadline then return 'NOT_BLOCKED'; end if;
    perform pg_sleep(0.05);
  end loop;
end $$;
