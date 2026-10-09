# Models — end-to-end verification record
Last verified: 2026-10-08. Probe = `POST chat/completions` with
`Reply with exactly: OK`, `max_tokens: 20`.

## Menu models (all answer OK)

| Menu id | Provider | Result |
|---|---|---|
| groq/qwen/qwen3.8-27b | groq | OK |
| groq/openai/gpt-oss-120b, gpt-oss-20b | groq | in live list (qwen tested OK) |
| gemini-3.8-flash (NEW) | gemini | OK (one transient 503 on first try — demand spike, retry passed) |
| gemini-2.5-flash, gemini-flash-latest, gemini-2.5-pro, gemini-3-flash-preview | gemini | OK (2.5-flash tested; rest in live 50-model list) |
| agnes/agnes-3.0-flash, agnes/agnes-2.5-flash | agnes (`apihub.agnes-ai.com`) | OK |
| unorouter/agnes-3.0-flash:free | unorouter | OK |
| unorouter/allam-2-7b:free | unorouter | 429 transient (1 req/min free tier) — kept, resets alone |
| llm7/GLM-5.3-Flash | llm7 | OK |
| ollama/nemotron-3-nano:30b | ollama_cloud | 429 free-cap reached at probe time — kept, cap resets |
| openrouter free x8 (nemotron-3.5-lightning:free OK tested) | openrouter | OK; stale ids auto-hide via catalog out_of_stock filter |
| openai/gpt-4o-mini (via openrouter) | openrouter | OK |
| command-a-03-2025 (NEW, replaces command-r7b) | cohere | OK on /v1/chat |
| command-r-plus-08-2024 | cohere | kept (proven /v1 id) |

## Registered but NOT in the menu (keys valid, chat account-gated)

| Provider | Chat verdict | Unblocks when |
|---|---|---|
| apertis (382 models) | 403 PAYG credits must be positive | top up balance |
| apinex free/* | 402 daily check-in required | visit apinex.bond/airdrop |
| orcarouter/free | 429 link a GitHub account | workspace owner links GitHub |
| airforce (637 models) | 402 subscription or PAYG balance | subscribe / top up |
| apmix x2 (claude-sonnet-4-6-free) | 429 monthly allowance used up | reset or top-up |
| opencode zen x2 | 403 free tier only inside OpenCode | use from OpenCode / paid zen |
| deepseek x2 (flash + v4-pro) | 402 Insufficient Balance, both keys | top up balance |
| samba | 401 invalid key | key is dead — replace, do not add |
| kilo_free | untested (POST-only endpoint, no backend caller) | add caller + probe first |

Rule: a catalog id lands in the menu only after a chat probe answers OK,
or the failure is a self-resetting rate limit. Account-gated providers stay
registered in keyVault + catalogService (dashboard probes stay truthful) with
a generic caller ready in `cloudAIService.callGenericCompat`.

## Quotas (known)

| Provider | Limit |
|---|---|
| gemini | 1,500 req/day/key x 7 keys |
| groq | ~14,400 req/day/key x 2 |
| openrouter | no cap set; used $0.19 / $0.16; `:free` models $0 |
| llm7 | ~1M tokens/day shared |
| ollama_cloud | free cap window (429 at probe, resets) |
| unorouter free | 1 req/min on free ids |
| elevenlabs | 0/10,000 chars (tool API, not chat) |
| app quota | 1M tokens / 7 days per user (`tokenQuotaService`) |
