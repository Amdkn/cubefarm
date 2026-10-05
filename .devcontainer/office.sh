#!/usr/bin/env bash
# Run from a built checkout; state and logs belong outside the source tree.
set -euo pipefail
cd "$(dirname "$0")/.."
app_dir="$PWD"
export SWARM_HOME="${SWARM_HOME:-/workspaces/.aspace-cubefarm}"
export SWARM_PORT="${SWARM_PORT:-4417}"
mkdir -p "$SWARM_HOME"
chmod 700 "$SWARM_HOME"
exec 9>"$SWARM_HOME/office.lock"
flock -x 9
pid_file="$SWARM_HOME/office.pid"
owned() {
  [[ -f "$pid_file" ]] || return 1
  read -r office_pid < "$pid_file"
  [[ "$office_pid" =~ ^[0-9]+$ ]] || return 1
  [[ "$(readlink "/proc/$office_pid/cwd" 2>/dev/null)" == "$app_dir" ]] || return 1
  tr '\0' ' ' < "/proc/$office_pid/cmdline" 2>/dev/null | grep -Fq 'node dist-server/index.js'
}
case "${1:-start}" in
  start)
    if owned; then printf 'CubeFarm already running (PID %s).\n' "$office_pid"; exit 0; fi
    [[ -f dist-server/index.js && -f dist/index.html ]] || { echo 'Run bash .devcontainer/setup.sh first.'; exit 1; }
    if curl -fsS "http://127.0.0.1:$SWARM_PORT/api/state" >/dev/null 2>&1; then
      echo "Port $SWARM_PORT already serves an office not owned by this launcher."; exit 1
    fi
    nohup node dist-server/index.js </dev/null >>"$SWARM_HOME/office.log" 2>&1 9>&- &
    office_pid=$!
    printf '%s\n' "$office_pid" > "$pid_file"
    for attempt in {1..60}; do
      kill -0 "$office_pid" 2>/dev/null || { tail -30 "$SWARM_HOME/office.log"; exit 1; }
      if curl -fsS "http://127.0.0.1:$SWARM_PORT/api/state" >/dev/null 2>&1; then
        printf 'CubeFarm ready: port %s, PID %s, state %s\n' "$SWARM_PORT" "$office_pid" "$SWARM_HOME"; exit 0
      fi
      sleep 1
    done
    echo "Startup timed out; inspect $SWARM_HOME/office.log"; exit 1
    ;;
  status)
    owned && curl -fsS "http://127.0.0.1:$SWARM_PORT/api/state" >/dev/null && echo "CubeFarm running (PID $office_pid, port $SWARM_PORT)."
    ;;
  stop)
    if owned; then kill -TERM "$office_pid"; rm -f "$pid_file"; echo 'Office shutdown requested.'; else echo 'No owned office process.'; fi
    ;;
  *) echo 'Usage: bash .devcontainer/office.sh start|status|stop'; exit 2 ;;
esac
