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

Nothing in code: every URL that matters is already request-derived
(`googleAuth.callbackUrlFor`, `frontendBase`, `site.ts`), so the app serves
any hostname with zero reconfiguration. Only the registered values above
(the ones external parties pin: Google, the .env fallbacks) get one final
edit.
