#!/usr/bin/env bash
#
# Point the public HerovaAi site at the live app.
#
# The app is served through a Cloudflare quick tunnel, whose hostname is
# regenerated whenever cloudflared restarts. The public site (GitHub Pages)
# links to that hostname in every CTA, so without this the buttons rot within
# days. Run from herovaai-site-sync.timer: it reads the current tunnel host from
# the tunnel log, refuses to publish it unless it actually answers, rewrites the
# site, and pushes only when something changed.
#
set -uo pipefail

SITE="/home/sahadat/herovaai-site"
TUNNEL_LOG="/home/sahadat/herovaai/logs/tunnel.log"
SELF_LOG="/home/sahadat/herovaai/logs/site-sync.log"

log() { printf '%s %s\n' "$(date -Is)" "$*" | tee -a "$SELF_LOG" >/dev/null 2>&1 || true; }

[ -d "$SITE/.git" ] || { log "no site checkout at $SITE — nothing to do"; exit 0; }

HOST=$(grep -ohE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null \
  | grep -v '//api\.trycloudflare\.com' \
  | tail -1 | sed 's#https://##')
[ -n "${HOST:-}" ] || { log "no tunnel hostname in $TUNNEL_LOG yet"; exit 0; }

# Never publish a hostname that does not answer: a dead link is worse than a
# slightly stale one.
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$HOST/" || true)
if [ "$CODE" != "200" ]; then
  log "current tunnel host $HOST answered $CODE — leaving the site as it is"
  exit 0
fi

cd "$SITE" || exit 0

find . -name '*.html' -print0 | xargs -0 sed -i -E \
  "s#https://[a-z0-9-]+\.trycloudflare\.com#https://$HOST#g"

if git diff --quiet; then
  log "already pointing at $HOST"
  exit 0
fi

git add -A
git -c user.name="sahadat01832-del" -c user.email="sahadat01832-del@users.noreply.github.com" \
  commit -q -m "Point the public site at the live app ($HOST)"
if git push -q; then
  log "repointed the public site to $HOST"
else
  log "rewrote the links to $HOST but the push failed"
fi
