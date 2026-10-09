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
CLOUDFLARED="${CLOUDFLARED:-$(command -v cloudflared)}"

mkdir -p "$ROOT/logs"
: > "$LOG"

"$CLOUDFLARED" tunnel --url "http://localhost:$PORT" --no-autoupdate >> "$LOG" 2>&1 &
cf_pid=$!

# systemd stops the unit by signalling this script; pass it on to cloudflared.
trap 'kill "$cf_pid" 2>/dev/null; wait "$cf_pid" 2>/dev/null' TERM INT

(
  for _ in $(seq 1 90); do
    grep -qoE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" && break
    sleep 1
  done
  url=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1)
  if [ -n "$url" ]; then
    # Record it first — `public.sh sync` reads this file to fill in backend/.env.
    printf '%s' "$url" > "$ROOT/logs/public-url.txt"
    bash "$ROOT/scripts/public.sh" sync > /dev/null
    echo "public url: $url"
  fi
) &

wait "$cf_pid"
