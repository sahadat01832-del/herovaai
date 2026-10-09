#!/usr/bin/env bash
# HerovaAi stack manager — frontend, backend, gateway (+ the public tunnel via public.sh).
#
#   ./scripts/stack.sh start | stop | restart | status
#
# Two deliberate details, both learned the hard way on this box:
#
# 1. dotenv never overrides a variable that is already exported, and this desktop
#    exports PORT=0. A backend started from such a shell binds to a random port and
#    looks "down". So every key the app reads is stripped from the ambient
#    environment before launch and comes from backend/.env alone.
# 2. The pidfile records the PID that actually owns the port (read from `ss`), not
#    the shell's `$!`, which can point at a short-lived wrapper. Stopping is then a
#    kill of a known listener rather than a pattern match.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOGS="$ROOT/logs"
NODE="${NODE:-/home/sahadat/.nvm/versions/node/v26.8.2/bin/node}"
WEB_PORT="${WEB_PORT:-3001}"
API_PORT="${API_PORT:-5000}"
GATEWAY_PORT="${GATEWAY_PORT:-8088}"
mkdir -p "$LOGS"

up()         { curl -sf -o /dev/null --max-time 3 "$1"; }
pidf()       { echo "$LOGS/$1.pid"; }
pid_on_port(){ ss -ltnp 2>/dev/null | grep -E ":$1[[:space:]]" | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2; }
alive()      { local pid; pid="$(cat "$(pidf "$1")" 2>/dev/null)"; [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; }

# ── strip env keys the app reads, so .env is the only source ────────────────
CLEAN_ENV=()
if [ -f "$ROOT/backend/.env" ]; then
  while IFS= read -r key; do
    [ -n "$key" ] || continue
    if [ -n "${!key+x}" ]; then CLEAN_ENV+=(-u "$key"); fi
  done < <(grep -oE '^[A-Za-z_][A-Za-z0-9_]*' "$ROOT/backend/.env" | sort -u)
fi

stop_one() { # stop_one <name>
  local f; f="$(pidf "$1")"
  if alive "$1"; then
    local pid; pid="$(cat "$f")"
    kill "$pid" 2>/dev/null
    for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done
    if kill -0 "$pid" 2>/dev/null; then kill -9 "$pid" 2>/dev/null; fi
    echo "stopped $1 ($pid)"
  else
    echo "$1: not running"
  fi
  rm -f "$f"
}

start_one() { # start_one <name> <dir> <log> <port> <health-path> <cmd...>
  local name="$1" dir="$2" log="$3" port="$4" path="$5"; shift 5
  local health="http://127.0.0.1:$port$path"
  if alive "$name" && up "$health"; then echo "$name: already up (pid $(cat "$(pidf "$name")"))"; return 0; fi
  ( cd "$dir" && setsid nohup env "${CLEAN_ENV[@]}" "$@" > "$log" 2>&1 < /dev/null & )
  local ok=''
  for _ in $(seq 1 60); do up "$health" && { ok=1; break; }; sleep 1; done
  if [ -n "$ok" ]; then
    local pid; pid="$(pid_on_port "$port")"
    [ -n "$pid" ] && echo "$pid" > "$(pidf "$name")"
    echo "$name: up (pid ${pid:--}) → $health"
  else
    echo "$name: FAILED to answer on :$port — last log lines:"
    tail -n 8 "$log" 2>/dev/null | sed 's/^/    /'
    return 1
  fi
}

start_backend()  { start_one backend  "$ROOT/backend"  "$LOGS/backend.log"  "$API_PORT"     "/api/health"      "$NODE" src/index.js; }
start_frontend() { start_one frontend "$ROOT/frontend" "$LOGS/frontend.log" "$WEB_PORT"     "/"                "$NODE" node_modules/next/dist/bin/next start -H 0.0.0.0 -p "$WEB_PORT"; }
start_gateway()  { start_one gateway  "$ROOT"          "$LOGS/gateway.log"  "$GATEWAY_PORT" "/_gateway/health" "$NODE" "$ROOT/scripts/gateway.js"; }

start() {
  start_backend
  start_frontend
  start_gateway
  echo "--- public tunnel ---"
  # Idempotent: an existing tunnel is reused, so the public URL only changes when
  # it has to (a tunnel restarted on purpose).
  bash "$ROOT/scripts/public.sh" start
}

stop() {
  stop_one gateway
  bash "$ROOT/scripts/public.sh" stop >/dev/null 2>&1 || true
  stop_one frontend
  stop_one backend
}

status() {
  printf '%-9s %-8s %s\n' NAME PID STATE
  for n in backend frontend gateway; do
    if alive "$n"; then printf '%-9s %-8s running\n' "$n" "$(cat "$(pidf "$n")")"; else printf '%-9s %-8s stopped\n' "$n" '-'; fi
  done
  printf 'public    %s\n' "$(cat "$LOGS/public-url.txt" 2>/dev/null || echo '-')"
}

case "${1:-status}" in
  start)  start ;;
  stop)   stop ;;
  restart)
    # `restart` alone restarts the app processes but LEAVES THE TUNNEL ALONE, so the
    # public URL survives a code change. Name components to restart only those:
    #   ./scripts/stack.sh restart frontend gateway
    shift || true
    if [ "$#" -eq 0 ]; then set -- gateway frontend backend; fi
    for name in "$@"; do stop_one "$name"; "start_$name"; done
    ;;
  status) status ;;
  *) echo "usage: $0 {start|stop|restart [component...]|status}"; exit 1 ;;
esac
