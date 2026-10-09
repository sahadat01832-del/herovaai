# Deploying HerovaAi (self-hosted, zero cost)

Everything runs on this PC. There is no cloud bill: the app is served by four
systemd user units, and a Cloudflare tunnel gives it a public HTTPS address.

```
browser ──► Cloudflare edge ──► cloudflared (herovaai-tunnel)
                                     │
                                     ▼
                              gateway :8088   ← the ONLY public port
                                 ├── /                 → Next.js  :3001
                                 ├── /api/…            → Express  :5000
                                 └── /socket.io/…      → Express  :5000 (WebSocket)
```

One origin is the whole point: the browser only ever talks to where it was
served from, so there is no CORS, no second hostname, no API address baked into
the frontend build, and nothing to change when the public hostname changes.

## The units

| unit | what it runs | notes |
| --- | --- | --- |
| `contentbot-backend` | `backend/src/index.js` | Express + Socket.IO + MongoDB, port 5000 |
| `contentbot-frontend` | `next start -p 3001` | production build from `frontend/.next` |
| `herovaai-gateway` | `scripts/gateway.js` | zero-dependency reverse proxy on 8088 |
| `herovaai-tunnel` | `scripts/tunnel-unit.sh` | Cloudflare quick tunnel → 8088 |

```bash
systemctl --user status  contentbot-backend contentbot-frontend herovaai-gateway herovaai-tunnel
systemctl --user restart contentbot-frontend          # after a rebuild
journalctl --user -u contentbot-backend -f            # live logs
```

The gateway and tunnel units live in [deploy/systemd/](../deploy/systemd/) and are
symlinked into `~/.config/systemd/user/`, so they stay in the repository.

`scripts/stack.sh start|stop|status` still exists for running the same three app
processes by hand (pidfiles in `logs/`), but systemd is the source of truth and
is what survives a crash or a reboot.

### Rebuilding the frontend

```bash
cd frontend && npm run build && systemctl --user restart contentbot-frontend
```

The build runs under the nvm Node 22/26 toolchain:

```bash
export PATH=/home/sahadat/.nvm/versions/node/v26.8.2/bin:$PATH
```

### The `PORT=0` landmine

`dotenv` never overrides a variable that is already exported, and interactive
shells on this desktop export `PORT=0`. A backend started from such a shell binds
to a *random* port and looks dead — that is exactly what happened once here. The
unit now sets `Environment=PORT=5000` explicitly, and `stack.sh` strips any key
that `backend/.env` defines from the ambient environment before launching.

## The public address

```bash
cat logs/public-url.txt          # current public URL
bash scripts/public.sh url
bash scripts/public.sh start     # (re)open the tunnel by hand
```

A **quick tunnel** is free and needs no account, but it is not a permanent
address:

- the hostname is new every time the tunnel restarts;
- the PC has to stay on, and `herovaai-tunnel` must be running;
- `scripts/tunnel-unit.sh` writes the new hostname into `logs/public-url.txt` and
  into `backend/.env` (`PUBLIC_URL`, `FRONTEND_URL`, `BACKEND_URL`,
  `GOOGLE_CALLBACK_URL`). Nothing else needs restarting: pages are same-origin and
  the Google redirect URI is derived per request.

**DNS lag on this machine:** a freshly created `*.trycloudflare.com` name often
does not resolve through the router (192.168.0.1) for a few minutes because of
negative caching. From anywhere else on the internet it resolves immediately.
To check the site before the local resolver catches up:

```bash
host=$(sed 's|https://||' logs/public-url.txt | sed 's|/.*||')
curl -s --resolve "$host:443:104.16.230.132" "https://$host/" | head -c 200
```

## Making it indexable (and permanent): a domain + named tunnel

Cloudflare's edge sends `x-robots-tag: none` on every response under
`*.trycloudflare.com` and serves its own content-signals `robots.txt` for the
zone. `none` means `noindex, nofollow`, so **a quick-tunnel hostname cannot be
indexed by search engines**, no matter what the app publishes. Everything in the
app is already correct for indexing (see below); the hostname is the blocker.

A named tunnel on a domain you own removes both limits — stable address,
ordinary headers, indexable:

```bash
cloudflared tunnel login                                   # once, browser sign-in
cloudflared tunnel create herovaai                         # creates the credentials file
cloudflared tunnel route dns herovaai app.example.com      # DNS record in your zone
```

Then point the unit at it and drop the quick tunnel:

```bash
# ~/.config/systemd/user/herovaai-tunnel.service
Environment=TUNNEL_NAME=herovaai
Environment=TUNNEL_HOSTNAME=app.example.com
```

`scripts/public.sh` already understands both variables (`start` runs
`cloudflared tunnel run --url http://localhost:8088 <name>` and uses
`https://$TUNNEL_HOSTNAME` as the public URL). After that, add the site to Google
Search Console and submit `https://app.example.com/sitemap.xml`.

## Google sign-in

Credentials are ordinary key-vault slots (`GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`), so they can be saved from the dashboard and take effect
without a restart. Until they are saved, the button is *honestly* reported as off
instead of dead-ending.

1. Google Cloud Console → APIs & Services → Credentials → Create credentials →
   OAuth client ID → Web application.
2. Authorised JavaScript origin: the URL from **Settings → Security** (it is
   derived from the hostname you are looking at).
3. Authorised redirect URI: `<that host>/api/auth/google/callback` — character for
   character. Add the `localhost:8088` one as well if you also sign in locally.
4. Paste the client ID and secret into Settings → Security.
5. Verify:

```bash
BASE=http://127.0.0.1:8088      bash scripts/oauth-check.sh
BASE=$(cat logs/public-url.txt) bash scripts/oauth-check.sh
```

`scripts/oauth-check.sh` proves the parts that do not need Google's account picker
— redirect URI matches the host, an unconfigured deployment explains itself, the
consent redirect carries the right `redirect_uri` plus a signed `state`, and a
forged callback is rejected. It saves throwaway credentials into the vault to
reach the configured states and always removes them again, including on failure.

Two details that make this work on a moving hostname:

- the redirect URI and the return-to URL come from the request, and a strategy is
  registered per (credentials, redirect URI) pair — so localhost, the LAN address
  and today's tunnel hostname all work at once. Google rejects unregistered
  redirect URIs, so a spoofed `Host` header cannot redirect the flow anywhere.
- the flow carries a signed, 10-minute `state`; the callback refuses anything that
  does not verify (`/login?error=oauth_state`).

## SEO

Implemented in the app:

| what | where |
| --- | --- |
| host-aware `canonical`, Open Graph, Twitter card, `metadataBase` | `frontend/src/app/(marketing)/layout.tsx` |
| `robots.txt` (disallows `/dashboard`, `/api`, `/auth`) | `frontend/src/app/robots.ts` |
| `sitemap.xml` for `/`, `/register`, `/login` | `frontend/src/app/sitemap.ts` |
| JSON-LD (`Organization`, `WebSite`, `SoftwareApplication`, `Offer`) | marketing layout |
| `X-Robots-Tag: noindex, nofollow` on the product | `frontend/next.config.js` |
| 1200×630 social card | `frontend/public/og.png` (`scripts/make-og.py`) |
| self-hosted fonts (no third-party requests) | `frontend/public/fonts` (`scripts/self-host-fonts.py`) |

```
/robots.txt  /sitemap.xml  /og.png       # verify they answer 200 with the right host
```

The public pages render per request on purpose: a canonical link pointing at a
hostname the visitor is not on is worse than no canonical at all. Crawlers get
correct absolute URLs for whatever address they arrived at.

## Security notes for a public deployment

- Only the gateway port is published. MongoDB (27017) and the API (5000) are not
  reachable from outside; the API is reached through the gateway only.
- Private routes need a bearer JWT; checked in the public sweep —
  `/api/admin/stats` answers `401` without one.
- Socket.IO requires the token too: an unauthenticated socket is closed with
  `Authentication required`.
- `/dashboard*` is `noindex, nofollow`, and `X-Content-Type-Options: nosniff` +
  `Referrer-Policy: strict-origin-when-cross-origin` are set for every route.
- Rotate the admin password (`backend/.env` `ADMIN_PASSWORD`) in Settings after
  first login; the seeded account is the only way in until Google is configured.
- The whole deployment is one home connection: if the machine sleeps, the site is
  offline. `loginctl enable-linger` is already on for this user, so the units come
  back after a reboot without a login.
