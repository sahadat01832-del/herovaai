#!/usr/bin/env bash
#
# DISABLED — 2026-10-13.
#
# This script used to repoint the public site at the rotating Cloudflare
# quick-tunnel hostname every 10 minutes (via herovaai-site-sync.timer).
# That made every CTA link rot whenever cloudflared restarted.
#
# The site now links to the STABLE Tailscale Funnel address
# (https://sahadat-ms-challenger-b450m-1.tail494859.ts.net), which never
# rotates and proxies to the app on :8088. There is nothing to keep in sync
# anymore, so this script is a no-op. The timer is stopped + disabled.
#
# If you ever move the app to a new permanent hostname, update the links in
# /home/sahadat/herovaai-site by hand and do NOT reintroduce a rotating URL.
#
exit 0
