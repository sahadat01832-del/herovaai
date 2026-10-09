#!/usr/bin/env bash
# Public URL manager for HerovaAi — runs entirely on this PC at zero cost.
#
#   ./scripts/public.sh start    # gateway + Cloudflare tunnel, then write the URL into backend/.env
#   ./scripts/public.sh stop
#   ./scripts/public.sh url      # prints the current public URL
#   ./scripts/public.sh status
#
# What is published: ONLY the gateway port. The gateway serves the frontend and
# forwards /api + /socket.io to the backend, so the database, the WhatsApp
# service and port 5000 itself never leave this machine.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOGS="$ROOT/logs"
ENV_FILE="$ROOT/backend/.env"
URL_FILE="$LOGS/public-url.txt"
TUNNEL_LOG="$LOGS/tunnel.log"
GW_LOG="$LOGS/gateway.log"

GATEWAY_PORT="${GATEWAY_PORT:-8088}"
WEB_PORT="${WEB_PORT:-3001}"
API_PORT="${API_PORT:-5000}"
NODE_BIN="${NODE_BIN:-/home/sahadat/.nvm/versions/node/v26.8.2/bin/node}"
CLOUDFLARED="${CLOUDFLARED:-$(command -v cloudflared)}"

mkdir -p "$LOGS"

gw_pid()   { pgrep -f "node .*scripts/gateway.js" | head -1; }
tun_pid()  { pgrep -f "cloudflared tunnel --url http://localhost:$GATEWAY_PORT" | head -1; }
web_up()   { curl -sf -o /dev/null --max-time 3 "http://127.0.0.1:$WEB_PORT/"; }
gw_up()    { curl -sf -o /dev/null --max-time 3 "http://127.0.0.1:$GATEWAY_PORT/_gateway/health"; }

set_env() {
  # Idempotent key=value write that never prints the value.
  local key="$1" value="$2"
  [ -f "$ENV_FILE" ] || : > "$ENV_FILE"
  python3 - "$ENV_FILE" "$key" "$value" <<'PY'
import sys
path, key, value = sys.argv[1], sys.argv[2], sys.argv[3]
lines = open(path).read().splitlines()
out, found = [], False
for line in lines:
    if line.startswith(key + '='):
        out.append(f'{key}={value}')
        found = True
    else:
        out.append(line)
if not found:
    out.append(f'{key}={value}')
open(path, 'w').write('\n'.join(out).rstrip('\n') + '\n')
PY
}

# Record the current public URL in backend/.env. Called by `sync`, and by the
# systemd tunnel unit whenever it reconnects with a fresh hostname.
sync_env() {
  local url
  url="$(cat "$URL_FILE" 2>/dev/null)"
  [ -n "$url" ] || { echo "no public URL recorded yet — run: $0 start"; return 1; }
  set_env PUBLIC_URL         "$url"
  set_env FRONTEND_URL       "$url"
  set_env BACKEND_URL        "$url"
  set_env GOOGLE_CALLBACK_URL "$url/api/auth/google/callback"
  printf '%s\n' "$url"
}

start() {
  if ! web_up; then
    echo "⚠️  frontend is not answering on :$WEB_PORT — start it first (npm run start in frontend/)"
  fi

  if ! gw_up; then
    echo "starting gateway…"
    setsid nohup "$NODE_BIN" "$ROOT/scripts/gateway.js" > "$GW_LOG" 2>&1 < /dev/null &
    for _ in $(seq 1 20); do gw_up && break; sleep 0.5; done
  fi
  gw_up || { echo "❌ gateway failed to start — see $GW_LOG"; return 1; }
  echo "gateway ok  → http://127.0.0.1:$GATEWAY_PORT"

  local pid url
  pid="$(tun_pid || true)"
  if [ -z "$pid" ]; then
    if [ -n "${TUNNEL_NAME:-}" ] && [ -n "${TUNNEL_HOSTNAME:-}" ]; then
      # Named tunnel on a domain you own: a STABLE url you can put in front of
      # customers and register with Google once. See docs/DEPLOY.md — this is also
      # the only mode that can be indexed, because Cloudflare sends
      # `x-robots-tag: none` on *.trycloudflare.com.
      echo "starting named tunnel '$TUNNEL_NAME' for $TUNNEL_HOSTNAME…"
      : > "$TUNNEL_LOG"
      setsid nohup "$CLOUDFLARED" tunnel --no-autoupdate \
        run --url "http://localhost:$GATEWAY_PORT" "$TUNNEL_NAME" \
        > "$TUNNEL_LOG" 2>&1 < /dev/null &
      url="https://$TUNNEL_HOSTNAME"
      sleep 3
    else
      echo "opening Cloudflare quick tunnel…"
      : > "$TUNNEL_LOG"
      setsid nohup "$CLOUDFLARED" tunnel --url "http://localhost:$GATEWAY_PORT" --no-autoupdate \
        > "$TUNNEL_LOG" 2>&1 < /dev/null &
      for _ in $(seq 1 40); do
        grep -qoE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" && break
        sleep 0.5
      done
    fi
  fi

  url="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" | head -1)"
  # A named tunnel has no generated hostname in the log; it is the one you chose.
  [ -n "$url" ] || url="https://${TUNNEL_HOSTNAME:-}"
  [ "$url" != "https://" ] || { echo "❌ no tunnel URL yet — see $TUNNEL_LOG"; return 1; }

  printf '%s' "$url" > "$URL_FILE"
  sync_env > /dev/null
  echo "public url  → $url"
  echo "wrote PUBLIC_URL / FRONTEND_URL / BACKEND_URL / GOOGLE_CALLBACK_URL into backend/.env"
  echo "(the Google redirect URI is also derived from each request, so a rotated URL"
  echo " needs no restart to keep signing people in.)"
}

stop() {
  local p
  p="$(tun_pid || true)";       [ -n "$p" ] && kill "$p" 2>/dev/null && echo "tunnel stopped ($p)"
  p="$(gw_pid || true)";        [ -n "$p" ] && kill "$p" 2>/dev/null && echo "gateway stopped ($p)"
  return 0
}

case "${1:-status}" in
  start)  start ;;
  stop)   stop ;;
  sync)   sync_env ;;
  url)    cat "$URL_FILE" 2>/dev/null || echo "(no URL yet — run: $0 start)" ;;
  status)
    printf 'gateway : %s\n' "$(gw_pid || echo '-')"
    printf 'tunnel  : %s\n' "$(tun_pid || echo '-')"
    printf 'url     : %s\n' "$(cat "$URL_FILE" 2>/dev/null || echo '-')"
    ;;
  *) echo "usage: $0 {start|stop|sync|url|status}"; exit 1 ;;
esac
