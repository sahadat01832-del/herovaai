# Channels — what each platform can really do, and what it needs

One connected account per platform per owner. The dashboard's Connections page is
driven entirely by `backend/src/services/channels/registry.js`: the badges, the
forms, the setup steps and the permission notes all come from that file, so this
document exists to explain the *decisions* behind those entries rather than to
repeat them.

## Capability matrix

| Channel | Daily post | Auto-reply | Media | What "reply" means |
|---|---|---|---|---|
| YouTube | — | ✅ | video (Shorts or standard) | answers new comments on your videos |
| Facebook Page | ✅ | ✅ | text, photo, video/Reel | answers comments on your recent posts |
| TikTok | ✅ | ✅* | video | answers comments on your recent videos |
| Instagram | ✅ | ✅ | image | answers DMs on the linked Page |
| Messenger | — | ✅ | — | answers Page messages (webhook) |
| Telegram | ✅ | ✅ | text, photo, video | answers messages (webhook, self-registering) |
| WhatsApp | — | ✅ | any | its own page (`/dashboard/whatsapp`) |
| Webhook / Zapier / Make / n8n | ✅ | — | JSON payload | — |
| imo, Google Business | ❌ | ❌ | — | no usable public API; the card says so |

`*` TikTok comment reading and replying require a Creator access token from an app
TikTok has granted its Comment API to. Posting works without it; the refusal is
written to the connection's Activity list in TikTok's own words, never swallowed.

## How replies travel

Two paths, and the difference is set by the platform, not by us:

- **Push (webhooks):** Messenger, Instagram, Telegram. Meta verifies the payload
  with the app secret (`metaSignatureOk`), Telegram with the secret we registered.
  A POST without a valid signature is refused with 403.
- **Pull (polling):** YouTube, Facebook Page posts, TikTok videos. Every 60 s the
  scheduler asks each due connection for comments newer than the last one it
  answered (`channelScheduler.runCommentReplies`, minimum 5 minutes between calls
  per connection). Publishers record the post/video id in `connection.meta.recentMedia`
  so the poller knows where to look; a connection that predates that record falls
  back to the Page feed once, then uses the record.

Both paths end in the same place: `channelService.handleInbound` → the shared AI
helper (`channels/aiReply.js`) → the platform's replier. Rules that hold everywhere:

- No model available → **nothing is sent**, and the reason is logged. A wrong price
  quoted automatically is worse than a slow reply.
- Comments/posts written by the account itself are never answered (no self-loops).
- A per-connection daily reply cap (`CHANNEL_REPLIES_PER_DAY`, default 200) stops a
  loop from emptying a quota.
- Every action leaves a receipt in `connection.activity`, failures included.

## One-off scheduled posts

The daily topic automation remains available on each channel. For a specific
caption and piece of generated media, the post composer can also queue a one-off
post for a chosen local date and time. Scheduled items appear under
`/dashboard/publishing`, are scoped to the owner who created them, and can be
cancelled until publishing starts. The server accepts times 2 minutes to 90 days
ahead and validates media links as HerovaAi-hosted media before storing them.

The Publishing page also includes a Facebook commercial-post creator. It can
start from a text brief, an optional product/reference image, and the signed-in
owner's saved business profile. Recent generated and scheduled Page copy is used
to avoid close repeats; the image is only stored for publication if the owner
chooses to publish or schedule it. The result stays editable, and is sent only
after an explicit publish or schedule action. This creates an organic Page post,
not a paid Ads Manager campaign.

Delivery is deliberately at-most-once: if the process stops after claiming a
post, HerovaAi marks it for review rather than blindly retrying and potentially
publishing duplicates. A failed delivery shows the platform's error; it is not
reported as published. The existing platform-wide scheduled-post switch pauses
both daily posts and queued posts.

The composer can save up to 20 caption drafts per signed-in account in that
browser's local storage. Drafts store caption/topic and the media link, not the
media bytes; they are not synced between devices and can no longer restore media
that has been removed from the server.

WhatsApp history can be exported from the number's chat view as a JSON backup.
It contains only the messages currently retained by HerovaAi for that number,
not WhatsApp login material or media file contents. The Analytics page shows
lifetime message/post counters and a seven-day chart based on retained message
history.

## Permissions each platform needs

- **Facebook Page (posts + comments):** `pages_manage_posts` (post),
  `pages_read_engagement` (read comments), `pages_manage_engagement` (reply).
  Missing the last one is the usual cause of "replied 0 comments".
- **Messenger / Instagram:** Page token + app secret (signatures) + a verify token
  you invent; subscribe the Page to `messages` / the Instagram product to `messages`.
- **YouTube:** `youtube.upload` (publish) and `youtube.force-ssl` (read and answer
  comments). A refresh token + client id/secret lets the app renew access by itself.
- **TikTok:** Content Posting API to publish; Comment API for replies.
- **Telegram:** a bot token is enough; the webhook registers itself.

## Image and video generation

- **Images** use Google Flow's Nano Banana Pro through HerovaAi's shared account
  pool. A customer does not connect a personal Google account or provide an API
  key. Free includes 10 successful images per UTC day, Pro (৳100/month) includes
  100 per 30-day billing cycle, and Enterprise (৳300/month) has no image-generation
  cap. Failed generations release their reservation; the paid-cycle allowance
  follows the subscription start date.
- **Video** prefers the visitor's own linked Flow account when they have one,
  because that spends *their* quota and lets them generate past the shared daily
  limit. No linked account, no problem: the house pool answers.
- Linking is per user (`/api/flow/connect/*`, account id `user_<id>`), stored on the
  User document, and disconnectable from Settings.

### The house account pool

The pool is the operator's own Flow accounts, and it is what "free for everyone"
actually means. HerovaAi uses the website-only order FF2 → FF3 → FF1; set
`FLOW_HOUSE_ACCOUNTS` (comma-separated Flow account IDs) to override it. Only IDs
the Flow engine reports as connected and verified are eligible. This website pool
does not change ContentBot's separate Google account policy.

Requests try the primary first, then each backup in order. A failing account —
quota spent, session logged out — is skipped for `FLOW_ACCOUNT_COOLDOWN_MS`
(5 minutes by default) while the next one answers. A rejected request (HTTP 400:
bad prompt/model) stops immediately instead of walking the whole pool, and the
response says which account served it (`servedBy`).

`GET /api/flow/status` reports `houseAccounts.count` and `freeForEveryone`, which
is what the dashboard's "Start here" panel reads to tell the truth about whether
media works right now.

The Flow engine itself lives outside this app: `contentbot/scripts/gateway_server.py`
on `127.0.0.1:8787` fronts the Google Flow MCP. If no Flow account is verified there,
generation cannot run for anyone — the status endpoint reports `ready: false` and the
UI says so instead of pretending. Check it with:

```bash
curl -s http://127.0.0.1:8787/flow/status | head -c 400
```

## Connecting without a developer console

Two routes exist for every platform, because the two audiences are different:

- **One click, using the app's own Google client** — YouTube only, today. The
dashboard asks `POST /api/auth/google/youtube/start` for a signed, expiring state
that names the owner, then sends the browser to `/api/auth/google/youtube`, which
runs Google's consent screen with `youtube.upload` + `youtube.force-ssl`,
`access_type=offline` and `prompt=consent`. The callback stores the access token,
refresh token and client id/secret on that owner's YouTube connection, exactly
where a hand-pasted token would go, then tests it. No console, no copied keys.
  Two details worth keeping: the connect flow shares the sign-in redirect URI (so
  an owner still has exactly one URL to register with Google, not two), and it
  resolves **no user** — someone who signed up with an email may connect a
  different Google account, and creating a User row for it would be wrong. Scope
  approvals are Google's call: while the OAuth app is unverified, one-click works
  for accounts added as test users, and the UI says so rather than failing mutely.
- **Paste the values** — Facebook Page, Messenger, Instagram, Telegram and TikTok.
  The card names the exact screen each value comes from. Honestly: Meta does not
  offer a one-click connect for posting, and TikTok gates comment access behind an
  app review, so the paste route is not laziness — it is the only route that works
  for a fresh deployment.

`imo` has no API for anyone, so its card says that and points to WhatsApp instead.

## Webhook URLs and a rotating tunnel

Callback URLs shown in the dashboard are resolved **per request** by
`backend/src/services/publicUrl.js`, which prefers the tunnel's live record
(`logs/public-url.txt`) over the `PUBLIC_URL`/`BACKEND_URL` value the process read at
boot. That matters because a Cloudflare quick tunnel changes hostname on every
restart: a webhook registered against the old hostname — or a payment callback URL
pinned to it — fails silently, hours later, somewhere else.

What this does **not** fix: every external party that pins a URL (Google OAuth
redirect URIs, Meta's callback URL field, TikTok's) must be re-pasted after a
rotation. For production, put the app on a stable hostname
(see `docs/custom-domain.md`) and those values stay valid forever.

## Verifying a change here

```bash
cd backend
node scripts/channels-smoke.js     # 34 checks: connect, test, post, webhooks, capabilities
node scripts/platform-smoke.js     # whole-platform regression, includes the channel catalogue
```

Both run offline. Live platform calls (a real YouTube upload, a real Meta comment
reply) can only be verified with real credentials — the focused stub harnesses used
while building this (`/tmp/channel-flow-check.cjs`, `/tmp/channel-comments-check.cjs`)
prove the request shape, not the platform's answer.
