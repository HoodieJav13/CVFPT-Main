# Shared helper sourced by the guard tests: writes fake `docker` and `supabase` executables.
# State lives in plain files under $FAKE_DIR so each test can arrange exactly the world it needs.
write_fake_bins() {   # write_fake_bins <bin-dir>
  cat > "$1/docker" <<'DOCKER'
#!/usr/bin/env bash
echo "docker $*" >> "$FAKE_DIR/docker.log"
if [ -f "$FAKE_DIR/docker_down" ]; then echo "Cannot connect to the Docker daemon" >&2; exit 1; fi
sub="${1:-}"; shift || true
args="$*"
case "$sub" in
  info) exit 0 ;;
  ps)
    if [ -f "$FAKE_DIR/ps_fail" ]; then echo "ps failed" >&2; exit 1; fi
    case "$args" in
      *"label=com.supabase.cli.project=cvfpt-series-test"*) cat "$FAKE_DIR/owned_containers" 2>/dev/null || true ;;
      *"name=^/supabase_db_cvfpt-series-test"*)
        if [ -f "$FAKE_DIR/owned_container_running" ]; then echo running
        elif [ -s "$FAKE_DIR/owned_containers" ]; then echo exited; fi ;;
      *"label=com.supabase.cli.project"*) cat "$FAKE_DIR/containers_all" 2>/dev/null || true ;;
    esac
    exit 0 ;;
  volume)
    if [ -f "$FAKE_DIR/volume_fail" ]; then echo "volume ls failed" >&2; exit 1; fi
    case "$args" in
      *"label=com.supabase.cli.project=cvfpt-series-test"*) cat "$FAKE_DIR/owned_volumes" 2>/dev/null || true ;;
      *"label=com.supabase.cli.project"*) cat "$FAKE_DIR/volumes_all" 2>/dev/null || true ;;
    esac
    exit 0 ;;
  inspect) if [ -s "$FAKE_DIR/owned_containers" ]; then echo "cvfpt-series-test"; exit 0; fi; exit 1 ;;
  exec) exit 0 ;;
esac
exit 0
DOCKER
  cat > "$1/supabase" <<'SUPABASE'
#!/usr/bin/env bash
echo "supabase $*" >> "$FAKE_DIR/supabase.log"
sub=""
for a in "$@"; do case "$a" in start|stop|db) sub="$a" ;; esac; done
case "$sub" in
  start)
    if [ -f "$FAKE_DIR/start_fail" ]; then exit 1; fi
    echo cid1 > "$FAKE_DIR/owned_containers"; touch "$FAKE_DIR/owned_container_running"; exit 0 ;;
  stop)
    if [ -f "$FAKE_DIR/stop_fail" ]; then exit 1; fi
    if [ ! -f "$FAKE_DIR/stop_leaves" ]; then : > "$FAKE_DIR/owned_containers"; rm -f "$FAKE_DIR/owned_container_running"; fi
    if [ ! -f "$FAKE_DIR/stop_leaves" ] && [ ! -f "$FAKE_DIR/stop_leaves_volume" ]; then : > "$FAKE_DIR/owned_volumes"; fi
    if [ -f "$FAKE_DIR/stop_leaves_volume" ]; then : > "$FAKE_DIR/owned_containers"; rm -f "$FAKE_DIR/owned_container_running"; fi
    exit 0 ;;
  db) exit 0 ;;
esac
exit 0
SUPABASE
  chmod +x "$1/docker" "$1/supabase"
}
