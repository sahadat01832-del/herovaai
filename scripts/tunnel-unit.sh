#!/usr/bin/env bash
# Runs the public tunnel in the foreground for systemd.
#
# A Cloudflare quick tunnel gets a fresh hostname every time it starts, so this
# script stays parked on the log until the hostname appears, then records it in
# logs/public-url.txt and backend/.env (via `public.sh sync`). Nothing else needs
# restarting for the app to keep working at the new address: the frontend is
# same-origin, and the Google redirect URI is derived from the request.
set -uo pipefail

ROOT="/home/sahadat/herovaai"
PORT="${GATEWAY_PORT:-8088}"
LOG="$ROOT/logs/tunnel.log"
URL_FILE="$ROOT/logs/public-url.txt"
export PATH="/home/sahadat/.local/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"
CLOUDFLARED="${CLOUDFLARED:-/home/sahadat/.local/bin/cloudflared}"
[ -x "$CLOUDFLARED" ] || CLOUDFLARED="$(command -v cloudflared 2>/dev/null || true)"

# Real quick-tunnel hostnames are random word groups and always contain at least
# one hyphen (e.g. baby-equivalent-tattoo-oklahoma). The service endpoint
# "api.trycloudflare.com" appears in cloudflared's ERROR lines when a tunnel
# cannot be opened, and must never be mistaken for a public address — that is how
# a failed start once recorded https://api.trycloudflare.com as the public URL.
URL_RE='https://[a-z0-9]+(-[a-z0-9]+)+\.trycloudflare\.com'

mkdir -p "$ROOT/logs"
: > "$LOG"

# HTTP/2 over TCP instead of QUIC: on this line the UDP path stalls
# ("failed to dial to edge with quic: timeout: no recent network activity") while
# TCP/443 keeps working. Slower handshake, dramatically fewer dead tunnels.
"$CLOUDFLARED" tunnel --url "http://localhost:$PORT" --no-autoupdate --protocol http2 >> "$LOG" 2>&1 &
cf_pid=$!

# systemd stops the unit by signalling this script; pass it on to cloudflared
# and to the watcher below, so restarts leave no stray processes behind.
trap 'kill "$cf_pid" "${watch_pid:-}" 2>/dev/null; wait "$cf_pid" 2>/dev/null' TERM INT

(
  for _ in $(seq 1 90); do
    grep -qoE "$URL_RE" "$LOG" && break
    sleep 1
  done
  url=$(grep -oE "$URL_RE" "$LOG" | head -1)
  if [ -n "$url" ]; then
    prev="$(cat "$URL_FILE" 2>/dev/null || true)"
    if [ "$url" = "$prev" ]; then
      echo "public url unchanged: $url"
    else
      # Record it first — `public.sh sync` reads this file to fill in backend/.env.
      printf '%s' "$url" > "$URL_FILE"
      bash "$ROOT/scripts/public.sh" sync > /dev/null
      bash "$ROOT/scripts/sync-app-url.sh" > /dev/null 2>&1 || true
      echo "public url: $url"
    fi

    # Watchdog. Check cloudflared's local readiness endpoint first (proves edge connectivity).
    # Also fallback to upstream DNS (1.1.1.1) to avoid local router DNS NXDOMAIN false alarms.
    misses=0
    host=$(echo "$url" | sed 's~https://~~;s~/~~')
    while true; do
      sleep 45
      probe_ok=false
      if curl -sf --max-time 5 http://127.0.0.1:20241/ready 2>/dev/null | grep -q '"readyConnections":[1-9]'; then
        probe_ok=true
      else
        ip=$(dig +short @1.1.1.1 "$host" 2>/dev/null | grep -E '^[0-9.]+$' | head -1)
        if [ -n "$ip" ]; then
          if curl -sf -o /dev/null --resolve "$host:443:$ip" --max-time 12 "https://$host/"; then
            probe_ok=true
          fi
        elif curl -sf -o /dev/null --max-time 12 "$url/"; then
          probe_ok=true
        fi
      fi

      if [ "$probe_ok" = true ]; then
        misses=0
      else
        misses=$((misses + 1))
        echo "watchdog: probe failed ($misses/3)"
        if [ "$misses" -ge 3 ]; then
          echo "watchdog: $url stopped answering — restarting the tunnel"
          kill "$cf_pid" 2>/dev/null
          exit 0
        fi
      fi
    done
  fi
) &
watch_pid=$!

wait "$cf_pid"
