# Ownership-guarded disposal for local-concurrency.sh. Sourced (bash 3.2).
#
# The caller sets MARK EVID RUNDIR DATA SOCK PGPID STARTED START_ATTEMPTED
# CREATED_DBS (and PGBIN plus a sql() function for the default hooks).
# cleanup-guard-regression.sh replaces the guard_* process/SQL hooks with
# stubs, so the decision code below is exactly what the real harness runs.
#
# Data is removed on exactly two paths:
#  - after a start: the ownership marker matches, postmaster.pid names the
#    recorded PGPID, that live process runs "postgres -D $DATA", the stop
#    succeeded, the process is gone, the socket and its lock are absent, and
#    $DATA is a real (non-symlink) directory at $EVID/run-*/data;
#  - before any start: no start was attempted, no postmaster.pid exists, and
#    the marker and path checks pass.
# Guarantees, in order:
#  - Failed ownership, postmaster PID or process verification (marker,
#    postmaster.pid = recorded PGPID, that live PID runs postgres -D $DATA)
#    prevents every drop and stop: no database is dropped, no process is
#    signalled (never a newly discovered PID), the data directory and marker
#    are kept, and cleanup fails.
#  - Once that verification passes, this run's databases are dropped and its
#    server is stopped. If a later post-start disposal check then fails (stop,
#    process still running, socket or lock present, path or symlink check),
#    the data directory is kept and cleanup fails; the earlier drop/stop
#    already happened.
#  - Before any start, a start attempt or an existing postmaster.pid keeps the
#    data directory, and cleanup fails.

GUARD_WAIT_TENTHS="${GUARD_WAIT_TENTHS:-100}"

# ---- Hooks (stubbed by the regression) ----
guard_alive() { kill -0 "$1" 2>/dev/null; }
guard_proc_cmd() { ps -o command= -p "$1" 2>/dev/null; }
guard_drop_db() { sql postgres -c "drop database if exists \"$1\" with (force)"; }
guard_stop() { "$PGBIN/pg_ctl" -D "$DATA" -m fast -w -t 30 stop >> "$RUNDIR/pg_ctl-stop.log" 2>&1; }
guard_sleep() { sleep "$1"; }

# ---- Checks (never stubbed) ----
guard_owner_ok() { [ -f "$DATA/COCKPIT_TEST_OWNER" ] && [ "$(cat "$DATA/COCKPIT_TEST_OWNER")" = "$MARK" ]; }
guard_pidfile_pid() { if [ -f "$DATA/postmaster.pid" ]; then head -1 "$DATA/postmaster.pid"; fi; }
guard_path_ok() {
  [ ! -L "$RUNDIR" ] && [ ! -L "$DATA" ] && [ -d "$DATA" ] || return 1
  case "$DATA" in "$EVID"/run-*/data) return 0 ;; *) return 1 ;; esac
}
guard_cmd_ok() {
  case "$(guard_proc_cmd "$PGPID")" in *"postgres -D $DATA") return 0 ;; *) return 1 ;; esac
}
guard_remove() {
  rm -rf -- "$DATA"
  if [ -e "$DATA" ] || [ -L "$DATA" ]; then echo "data_dir $DATA: REMOVE FAILED ($1)" >> "$2"; return 1; fi
  echo "data_dir $DATA: removed ($1)" >> "$2"
}

# guard_dispose <disposal record file>: 0 only when every step was verified.
guard_dispose() {
  local D="$1" fail=0 verified=0 stopped=0 gone=0 sock_clear=1 reason="" filepid db out f i
  echo "server_start_attempted: $START_ATTEMPTED" >> "$D"
  echo "server_started_by_this_run: $STARTED (recorded postmaster pid: ${PGPID:-none})" >> "$D"
  if [ "$STARTED" = 1 ]; then
    filepid="$(guard_pidfile_pid)"
    if ! guard_owner_ok; then reason="ownership marker missing or changed"
    elif [ -z "$PGPID" ]; then reason="no postmaster pid was recorded"
    elif [ "$filepid" != "$PGPID" ]; then reason="postmaster.pid names '${filepid:-missing}', not the recorded $PGPID"
    elif ! guard_alive "$PGPID"; then reason="recorded postmaster $PGPID is not running"
    elif ! guard_cmd_ok; then reason="process $PGPID does not run postgres -D $DATA"
    else verified=1; fi
    if [ "$verified" = 1 ]; then
      echo "ownership: verified (marker; postmaster.pid = $PGPID; live process runs postgres -D $DATA)" >> "$D"
      for db in $CREATED_DBS; do
        if out="$(guard_drop_db "$db" 2>&1)"; then echo "drop_database $db: ok" >> "$D"
        else echo "drop_database $db: FAILED: $out" >> "$D"; fail=1; fi
      done
      if guard_stop; then stopped=1; echo "pg_ctl_stop: ok" >> "$D"
      else echo "pg_ctl_stop: FAILED (see pg_ctl-stop.log)" >> "$D"; fail=1; fi
      i=0
      while guard_alive "$PGPID" && [ "$i" -lt "$GUARD_WAIT_TENTHS" ]; do guard_sleep 0.1; i=$((i + 1)); done
    else
      echo "ownership: NOT verified ($reason): no database dropped, no process signalled, data and marker kept" >> "$D"
      fail=1
    fi
    if guard_alive "$PGPID"; then echo "server_process $PGPID: STILL RUNNING" >> "$D"; fail=1
    else gone=1; echo "server_process ${PGPID:-none}: not running" >> "$D"; fi
    for f in "$SOCK" "$SOCK.lock"; do
      if [ -e "$f" ] || [ -L "$f" ]; then sock_clear=0; echo "socket_file $f: STILL PRESENT" >> "$D"; fail=1
      else echo "socket_file $f: absent" >> "$D"; fi
    done
  fi

  if [ ! -e "$DATA" ] && [ ! -L "$DATA" ]; then
    echo "data_dir $DATA: absent" >> "$D"
  elif [ "$STARTED" = 1 ]; then
    if [ "$verified" = 1 ] && [ "$stopped" = 1 ] && [ "$gone" = 1 ] && [ "$sock_clear" = 1 ] && guard_path_ok && guard_owner_ok; then
      guard_remove "verified owned server stopped" "$D" || fail=1
    else
      echo "data_dir $DATA: KEPT (post-start disposal not fully verified)" >> "$D"; fail=1
    fi
  elif [ "$START_ATTEMPTED" = 1 ]; then
    echo "data_dir $DATA: KEPT (a start was attempted but no postmaster was recorded)" >> "$D"; fail=1
  elif [ -e "$DATA/postmaster.pid" ]; then
    echo "data_dir $DATA: KEPT (postmaster.pid present although no start was attempted)" >> "$D"; fail=1
  elif guard_path_ok && guard_owner_ok; then
    guard_remove "no start was attempted" "$D" || fail=1
  else
    echo "data_dir $DATA: KEPT (ownership marker or path not verified)" >> "$D"; fail=1
  fi
  return "$fail"
}
