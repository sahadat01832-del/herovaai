# Models — one gateway, free models only

Last verified: 2026-10-10 with `node scripts/verify-catalog.js`
(**13/13 advertised models available, 0 out of stock, 0 key missing, exit 0**).

## The rule

- This deployment holds **one AI credential**: `OMNIROUTE_API_KEY`, against
  `OMNIROUTE_BASE_URL` (default `http://127.0.0.1:20128/v1`). OmniRoute fronts the
  upstream providers itself, so their keys are never needed here, and `backend/.env`
  carries no other provider's key.
- `catalogService.PROVIDERS` has **exactly one entry**. A probe round therefore has
  nothing else it could reach, which makes "the app runs on the operator's OmniRoute
  key alone" true by construction rather than by convention.
- Every menu model is a **free tier** behind that gateway. `free: true` on a catalog
  entry is an explicit operator claim, used because OmniRoute's `/models` publishes no
  prices (see `catalogService.annotate`).
- **`generateCompletion` refuses any id outside the catalog before calling the
  gateway.** The gateway also serves paid models and holds the upstream credentials, so
  without this gate a crafted request (`model: "openai/gpt-4o"`) could spend the
  operator's account on a model the menu never offered. Refusals are `409` with
  `"<id> is not one of the free models this deployment serves"`.
- What a plan buys is throughput, bigger local models, channels and automation —
  never access to a paid model. `config/plans.js` says only that.

## The menu (13 — every one verified available, every one free)

| Menu id | Upstream | Sees images | Badge |
|---|---|---|---|
| `omniroute/gemini/gemini-2.5-flash` | gemini | yes | ⭐ Recommended |
| `omniroute/gemini/gemini-3-flash-preview` | gemini | yes | ✨ Newer |
| `omniroute/gemini/gemini-3.1-flash-lite` | gemini | no | 🪶 Light |
| `omniroute/groq/qwen/qwen3.8-27b` | groq | no | ⚡ Instant |
| `omniroute/groq/openai/gpt-oss-120b` | groq | no | ⚡ 120B |
| `omniroute/groq/openai/gpt-oss-20b` | groq | no | 🪶 Light |
| `omniroute/agnes/agnes-3.0-flash` | agnes | no | 🆓 Uncapped |
| `omniroute/agnes/agnes-2.5-flash` | agnes | no | 🆓 Uncapped |
| `omniroute/cohere/command-a-03-2025` | cohere | no | 🗣️ Writing |
| `omniroute/cohere/command-a-reasoning-08-2025` | cohere | no | 🧠 Thinking |
| `omniroute/cohere/command-a-vision-07-2025` | cohere | yes | 📷 Vision |
| `omniroute/cohere/command-r-plus-08-2024` | cohere | no | 🗣️ Writing |
| `omniroute/nara/laguna-s-2.1` | nara | no | 🍃 Alternative |

Default when a caller names no model: `omniroute/gemini/gemini-2.5-flash`
(`cloudAIService.DEFAULT_MODEL` — the one constant the chat route and the website both
read, so they cannot drift).

Only models observed to actually answer are listed. OmniRoute's own free catalogue is
far larger, but most of those entries 404, sit behind a per-user rate limit, or have run
out of credits — listing them would put dead options in front of customers. (33 free
candidates were probed end-to-end; 18 replied, and near-duplicates were folded away.)

### Adding a model

Verify it first, then add it to `ALL_MODELS_CATALOG`:

```bash
cd backend
node -e "…POST /chat/completions with the id, max_tokens 20, expecting 'OK'…"
node scripts/verify-catalog.js      # must stay exit 0
```

Do **not** add a paid id, and do not add a second provider to `catalogService.PROVIDERS`
— either would break the single-key guarantee this file describes.

## Local models (LM Studio) are a separate path

Local ids are not catalog ids and never touch the gateway. They are served by the
LM Studio server on `LM_STUDIO_BASE_URL` (default `http://localhost:1234/v1`) and are the
private, unmetered option. When LM Studio is not serving a model, the local tier honestly
reports that instead of substituting a cloud answer — `backend/scripts/verify-reply-tiers.js`
covers exactly that (its two local-tier cases need LM Studio running).

## Image generation

Image requests use Google Flow MCP with **Nano Banana Pro** by default; they do
not use the OmniRoute text-model catalog. The shared Flow pool tries FF2 first,
then FF3 and FF1 if an account is unavailable. The account sessions must be
connected and verified in Flow MCP before the site can generate images.

## Quotas (known)

| Scope | Limit |
|---|---|
| App quota | 1,000,000 tokens / 7 days per user (`tokenQuotaService`) |
| Upstream free tiers | per-provider caps, enforced by the gateway — a saturated model is reported `out_of_stock` and drops out of the menu |

## History

Before 2026-10-10 this deployment carried keys for ~15 providers and the catalog mixed
free and paid ids across them. That is what let a request for one provider be answered by
another, and what let an unlisted id reach a paid model. The provider registry, the vault
and the service were reduced to OmniRoute alone; the raw verification record for the old
multi-provider menu is in git history.
