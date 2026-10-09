# HerovaAi — Premium AI & WhatsApp Dashboard

> Obsidian-and-champagne control panel for a private AI assistant and WhatsApp Business
> automation. Built with **Next.js 14**, **Tailwind CSS**, **Node.js/Express**,
> **Socket.IO**, and **MongoDB**.

## Highlights

- **Public chat with on-demand local AI** — visiting the chat can wake LM Studio ("Bionic"),
  load a small model, and everything is unloaded again when the visitor leaves. Nothing
  boots implicitly, and RAM on the 5.8 GB host stays free otherwise.
- **Free cloud fallback** — guests are routed to free servable cloud models (20 requests/hour
  per IP) and never touch the local machine.
- **WhatsApp DM automation** — QR pairing via `@wppconnect-team/wppconnect`, AI auto-reply,
  live message log.
- **Business AI memory** — owner profile, persona/tone, custom knowledge base auto-injected
  into chats and WhatsApp replies.
- **Admin control center** — users, API keys, global chat inspection.

## Quick start

```bash
npm run install:all     # backend + frontend dependencies
npm start               # backend :5000 + frontend dev :3000
```

Production (as deployed on this machine via systemd user units):

```bash
cd frontend
NODE_OPTIONS="--max-old-space-size=1536" ./node_modules/.bin/next build
npm run start           # next start -H 0.0.0.0 -p 3001
```

MongoDB on `localhost:27017` (database `contentbot`). If it is down, the backend falls back
to an in-memory Mongo labeled as such (chats will not persist).

## Hosting on this machine (public, zero cost)

Four systemd user units serve the app: `contentbot-backend`, `contentbot-frontend`,
`herovaai-gateway` (one origin for pages, `/api` and `/socket.io`) and
`herovaai-tunnel` (Cloudflare tunnel to the gateway). The current public address is
always in `logs/public-url.txt`:

```bash
systemctl --user status contentbot-backend contentbot-frontend herovaai-gateway herovaai-tunnel
cat logs/public-url.txt
```

Full runbook, including Google sign-in setup, search-engine visibility and the
limits of a quick-tunnel hostname: [docs/DEPLOY.md](docs/DEPLOY.md).

An admin account is seeded on first start from `backend/.env` (`ADMIN_EMAIL` /
`ADMIN_PASSWORD`) — rotate the password in Settings after first login.

## Project tree

```
herovaai/
├── backend/
│   └── src/
│       ├── config/         # passport & auth strategies
│       ├── middleware/     # JWT auth, admin guard
│       ├── models/         # User, Conversation, AIMemory, WhatsAppSession
│       ├── routes/         # auth, admin, chat, memory, whatsapp, user
│       ├── services/       # lmStudioService, socketService, wppConnectService
│       ├── utils/          # seed.js, mongoMemory helper
│       └── index.js        # Express server & Mongo lifecycle
├── frontend/
│   └── src/
│       ├── app/            # landing, login, register, dashboard/*
│       ├── contexts/       # AuthContext
│       └── lib/            # api.ts, auth.ts
├── scripts/
│   ├── start.sh            # dev launcher (Mongo check, LM Studio check, both services)
│   ├── gateway.js          # one public origin: pages + /api + /socket.io (+ WebSocket)
│   ├── tunnel-unit.sh      # public tunnel for systemd; records the URL it gets
│   ├── public.sh           # open/close the tunnel, write the URL into backend/.env
│   ├── stack.sh            # manual start/stop/status of the three app processes
│   ├── oauth-check.sh      # Google sign-in wiring self-test (no real client needed)
│   ├── make-og.py          # draws public/og.png (1200×630 social card)
│   └── self-host-fonts.py  # downloads the fonts into public/fonts + fonts.css
├── deploy/systemd/         # gateway + tunnel user units (symlinked into ~/.config)
├── docs/
│   ├── DEPLOY.md           # hosting, OAuth, SEO, operations
│   ├── OPS.md              # runbook: services, paths, LM Studio lifecycle
│   └── MODELS.md           # local model inventory & public-safe rule
└── package.json            # root helpers (install:all, dev, build)
```

## Environment

- `backend/.env` — `MONGODB_URI`, `JWT_SECRET`, admin seed creds, LM Studio / Groq / Gemini /
  OpenRouter keys. Never commit.
- `frontend/.env.local` — nothing required. The app talks to its own origin
  (`/api`, `/socket.io`) and the gateway forwards both; set
  `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_SOCKET_URL` only to point the frontend at a
  *different* backend (they are compiled in, so a rebuild is needed).
- LM Studio server config lives outside the repo: `~/.lmstudio/.internal/http-server-config.json`
  (`autoStartOnLaunch: false`, port 1234). Ops details: [docs/OPS.md](docs/OPS.md).

## Internal naming note

Public branding is **HerovaAi**. Internal identifiers (`contentbot-standard`,
`contentbot-pro`, `CONTENTBOT_API_KEY`, systemd unit names `contentbot-*`) are intentionally
unchanged — renaming them would break running integrations. See [docs/OPS.md](docs/OPS.md).
