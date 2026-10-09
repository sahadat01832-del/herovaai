# Operations Runbook — HerovaAi

Local paths and service names for the deployed instance. Internal ids (`contentbot-standard`,
`contentbot-pro`, `CONTENTBOT_API_KEY`) are kept for compatibility with running integrations.

## Location

- Project root: `/home/sahadat/herovaai`
- Previously: `/home/sahadat/.gemini/antigravity/scratch/contentbot-dashboard` (moved 2026-10-07)

## Services (systemd user units)

| Unit | Serves | Command |
|---|---|---|
| `contentbot-backend.service` | Express API on :5000 | `node src/index.js` under `backend/` |
| `contentbot-frontend.service` | Next.js 14 production on :3001 | `npm run start` under `frontend/` |

```bash
systemctl --user restart contentbot-backend contentbot-frontend
journalctl --user -u contentbot-backend -n 50
```

MongoDB on localhost:27017 (`mongod`), database `contentbot`. Data lives on the ext4
partition at `/mnt/storage/mongodb/data` (moved off the root disk on 2026-10-07; config:
`~/.config/mongodb/mongod.conf`, pre-migration backup:
`/mnt/storage/mongodb/pre-migration-backup-2026-10-07.tar.gz`). Bind is 127.0.0.1 only —
never expose it.

## LM Studio ("Bionic")

- App binary: `/mnt/storage/home/sahadat/apps/bionic/Bionic-app/bionic`
- CLI: `~/.lmstudio/bin/lms` (symlinked at `~/.local/bin/lms`)
- Server config: `~/.lmstudio/.internal/http-server-config.json` — `autoStartOnLaunch: false`, port 1234
- Models: `/mnt/hdd_sda6/lmstudio/models` (symlinked from `~/.lmstudio/models`)
- Public local models are capped at ≤3B params (`MAX_PUBLIC_PARAMS_B=3` in
  `backend/src/services/lmStudioService.js`)
- RAM is 5.8 GB — the lifecycle service boots the daemon on demand (public chat picking a
  "local" model or pressing warm-up), loads the smallest model with a TTL, and stops the
  daemon ~90 s after the visitor leaves or after 3 min idle. Ownership is recorded in
  `backend/.lmstudio-daemon.json` (gitignored).
- Never call `lms` from scripts/cron — any CLI call wakes the daemon. Use the backend HTTP
  endpoints instead: `POST /api/chat/lm-studio/warm`, `POST /api/chat/lm-studio/unload`,
  `GET /api/chat/lm-studio/status`.

## Env files (never commit, never print)

- `backend/.env` — Mongo URI, JWT secret, admin seed, LM/Groq/Gemini/OpenRouter keys
- `frontend/.env.local` — `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SOCKET_URL`

## Environment knobs (backend)

`LM_START_BUDGET_MS`, `LM_IDLE_STOP_MS`, `LM_MODEL_TTL_SECONDS`, `LM_SERVER_STOP_GRACE_MS`,
`LM_SESSION_IDLE_MS`, `LMS_CLI`, `LM_STUDIO_APP`, `LM_DAEMON_PID_FILE`,
`MONGODB_SELECTION_TIMEOUT_MS` (default 15000).

## Node versions

- systemd units use nvm Node v26.8.2 (`~/.nvm/versions/node/v26.8.2/bin/node`)
- Frontend builds must go through `./node_modules/.bin/next` directly (npm v26 CLI wrapper
  hits ERR_REQUIRE_ESM), e.g.:
  `NODE_OPTIONS="--max-old-space-size=1536" ./node_modules/.bin/next build`

## Secrets hygiene

The default admin password is seeded from `backend/.env` (`ADMIN_PASSWORD`) — it is not
documented anywhere in the repo. Rotate it in Settings after first login.
