#!/usr/bin/env bash
# Named-tunnel runner (stable address). TEMPLATE — do not start until
# docs/custom-domain.md steps 1-2 are done, then fill TUNNEL_ID + HOSTNAME.
#
#   ./scripts/named-tunnel.sh start | stop | status
#
# Deliberately separate from public.sh (quick tunnel): the two must never run
# together or the public site flaps between addresses. When this goes live,
# disable the quick tunnel in public.sh first.
set -uo pipefail

TUNNEL_ID="${TUNNEL_ID:-PASTE_TUNNEL_ID_HERE}"
HOSTNAME="${HOSTNAME:-app.example.com}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="$ROOT/logs/named-tunnel.log"

case "${1:-status}" in
  start)
    [ "$TUNNEL_ID" != "PASTE_TUNNEL_ID_HERE" ] || { echo "fill TUNNEL_ID/HOSTNAME first (see docs/custom-domain.md)"; exit 2; }
    pgrep -f "tunnel run $TUNNEL_ID" >/dev/null && { echo "named tunnel already running"; exit 0; }
    setsid nohup /home/sahadat/.local/bin/cloudflared tunnel --no-autoupdate run "$TUNNEL_ID" > "$LOG" 2>&1 < /dev/null &
    echo "named tunnel starting for $HOSTNAME (log: $LOG)"
    ;;
  stop)
    pkill -f "tunnel run $TUNNEL_ID" 2>/dev/null && echo "stopped" || echo "not running"
    ;;
  status)
    pgrep -af "tunnel run" | head -n 3 || echo "no named tunnel running"
    ;;
  *) echo "usage: $0 {start|stop|status}"; exit 1 ;;
esac
