# Stable address for HerovaAi (ends the tunnel-rotation churn)

## Why

The app currently serves through a Cloudflare **quick tunnel**
(`https://<random>.trycloudflare.com`). The hostname changes on every
restart, which breaks, each time:

- Google OAuth redirect URIs (must be re-registered per hostname),
- `.env` callback URLs,
- the public site's CTA links,
- any customer bookmark — and a business cannot be found twice at two
  addresses (this also hurts search indexing).

A **named tunnel on your own domain** (`app.yourdomain.com`) fixes all four
permanently and stays free (Cloudflare Tunnel is free; only the ~$10/yr
domain costs money).

## Steps (owner, ~20 min, one time)

1. Buy a domain (any registrar), add it to a free Cloudflare account,
   change the registrar nameservers to Cloudflare's.
2. On this machine, one time:
   ```
   cloudflared tunnel login
   cloudflared tunnel create herovaai
   cloudflared tunnel route dns herovaai app.yourdomain.com
   ```
3. Edit `scripts/named-tunnel.sh` (tunnel ID + hostname), then:
   ```
   ./scripts/named-tunnel.sh start   # replaces public.sh's quick tunnel
   ```
4. Update once: `backend/.env` (`FRONTEND_URL`, `GOOGLE_CALLBACK_URL`,
   `BACKEND_URL`), Google Console URIs, and run `./scripts/sync-app-url.sh`.
   Afterwards the address never changes again, so those stay valid.

## What changes in the app

Almost nothing: request-derived URLs (`googleAuth.callbackUrlFor`,
`frontendBase`, `site.ts`) already serve any hostname. Stored-origin URLs are
resolved per request by `backend/src/services/publicUrl.js`, which prefers the
tunnel's live record (`logs/public-url.txt`) over the `PUBLIC_URL`/`BACKEND_URL`
value the process read at boot — so a webhook URL or a payment callback never
points at yesterday's hostname, even before a restart. Only the values external
parties pin (Google OAuth redirect URIs, Meta's callback URL, TikTok's) need one
final edit — and once the hostname is stable, they stay valid.

Until this step is done, a quick-tunnel rotation still invalidates the redirect
URIs registered inside Google/Meta/TikTok consoles, because those are stored on
their side and only the owner can change them. `docs/CHANNELS.md` lists which
consoles need which URL.
