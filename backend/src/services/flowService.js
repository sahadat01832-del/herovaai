const axios = require('axios');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const os = require('os');
const crypto = require('crypto');

const GATEWAY_URL = process.env.CONTENTBOT_API_URL || 'http://127.0.0.1:8787';
const FLOW_STATUS_CACHE_MS = 5000;

// Website images try the selected Flow Nano Banana model first, then Nano
// Banana 2.1 through OmniRoute, and only then the Agnes image fallback.
const OMNIROUTE_URL  = process.env.OMNIROUTE_BASE_URL || 'http://127.0.0.1:20128/v1';
const OMNIROUTE_KEY  = process.env.OMNIROUTE_API_KEY  || '';
const OMNIROUTE_IMAGE_MODELS = [
  'agy/gemini-3.1-flash-image',
  'agnes/agnes-image-2.0-flash',
];
const IMAGE_MODEL_NAMES = {
  'agy/gemini-3.1-flash-image': 'Nano Banana 2.1',
  'agnes/agnes-image-2.0-flash': 'Agnes Image 2.0 Flash',
};

// Video fallback chain (added 2026-10-11). Flow MCP video needs a connected
// Google account; when none is available we fall back here instead of failing:
//   1. OmniRoute video route (currently 404s for Agnes — wrong upstream path
//      join `/v1/v1/videos` — but kept as a fast-fail first try in case the
//      gateway fixes it or another provider serves video through it).
//   2. Agnes direct `POST https://apihub.agnes-ai.com/v1/videos`
//      `{prompt, model, mode:'text-to-video'}` — proven live 2026-10-11
//      (endpoint + auth OK; free-tier quota is per-key and rotates below).
const OMNIROUTE_VIDEO_MODELS = [
  'agnes/agnes-video-2.5-flash',
];
const AGNES_VIDEO_MODELS = [
  'agnes-video-2.5-flash',
  'agnes-video-2.5',
  'agnes-video-v2.0',
];
const AGNES_VIDEO_URL = process.env.AGNES_VIDEO_URL || 'https://apihub.agnes-ai.com/v1/videos';

/** Agnes video keys: explicit env first, then the shared ContentBot key file. */
let _agnesKeys = null;
function agnesVideoKeys() {
  if (_agnesKeys) return _agnesKeys;
  const fromEnv = String(process.env.AGNES_API_KEYS || '')
    .split(',').map((k) => k.trim()).filter(Boolean);
  if (fromEnv.length) {
    _agnesKeys = fromEnv;
    return _agnesKeys;
  }
  const found = [];
  const tryFiles = [
    path.resolve(process.env.HOME || '', 'content-bot/config/api_keys.json'),
    '/media/sahadat/New Volume/ContentBot/config/api_keys.json',
  ];
  for (const file of tryFiles) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      const list = Array.isArray(data?.agnes) ? data.agnes : [];
      for (const key of list) {
        if (typeof key === 'string' && key.trim()) found.push(key.trim());
      }
      if (found.length) break;
    } catch {}
  }
  try {
    const opencodeEnv = fs.readFileSync(
      path.resolve(process.env.HOME || '', '.config/opencode/.env'), 'utf8');
    const match = opencodeEnv.match(/^OPENCODE_AGNES_API_KEY=(.+)$/m);
    if (match && match[1].trim()) found.push(match[1].trim().replace(/^"|"$/g, ''));
  } catch {}
  _agnesKeys = [...new Set(found)];
  return _agnesKeys;
}

// Local dir that is already served via GET /api/media/:filename
const LOCAL_MEDIA_DIR = path.resolve(__dirname, '../../public/media');
const EXTENSION_DIR = fs.existsSync(path.resolve(process.env.HOME || '', 'content-bot/tools/google-flow-mcp/extension'))
  ? path.resolve(process.env.HOME || '', 'content-bot/tools/google-flow-mcp/extension')
  : path.resolve(process.env.HOME || '', '.local/share/google-flow-mcp/extension');

const MEDIA_DIRS = [
  path.resolve(process.env.HOME || '', 'content-bot/outputs/flow'),
  path.resolve(process.env.HOME || '', 'content-bot/outputs/final'),
  path.resolve(process.env.HOME || '', 'content-bot/data/google_flow_mcp/jobs'),
  path.resolve(__dirname, '../../public/media'),
];

// Ensure local media dirs exist
for (const dir of MEDIA_DIRS) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {}
}

const flowService = {
  extensionDirectory: EXTENSION_DIR,
  flowStatusCache: { at: 0, value: null },
  flowStatusRequest: null,

  async getStatus() {
    const cached = flowService.flowStatusCache;
    if (cached.value && Date.now() - cached.at < FLOW_STATUS_CACHE_MS) return cached.value;
    if (flowService.flowStatusRequest) return flowService.flowStatusRequest;

    flowService.flowStatusRequest = (async () => {
      try {
        const res = await axios.get(`${GATEWAY_URL}/flow/status`, { timeout: 15000 });
        const value = {
          ...res.data,
          success: true,
          extensionDirectory: EXTENSION_DIR,
          availableModels: flowService.FLOW_MODELS,
        };
        flowService.flowStatusCache = { at: Date.now(), value };
        return value;
      } catch (err) {
        return {
          success: false,
          ready: false,
          extensionDirectory: EXTENSION_DIR,
          availableModels: flowService.FLOW_MODELS,
          error: err.message,
          message: 'ContentBot gateway or Flow MCP is initializing. Check `contentbot flow status`.',
        };
      } finally {
        flowService.flowStatusRequest = null;
      }
    })();
    return flowService.flowStatusRequest;
  },

  invalidateStatusCache() {
    flowService.flowStatusCache = { at: 0, value: null };
  },

  FLOW_MODELS: {
    image: [
      { id: 'nano-banana-pro', name: 'Nano Banana Pro', isDefault: true, desc: 'Maximum aesthetic quality & complex lighting' },
      { id: 'nano-banana-2', name: 'Nano Banana 2.1', isDefault: false, desc: 'High-detail photorealism & fast render' },
      { id: 'nano-banana-2-lite', name: 'Nano Banana 2 Lite', isDefault: false, desc: 'Ultra-low latency generation' },
      { id: 'ui-default', name: 'Workspace Default', isDefault: false, desc: 'Auto-selected by Flow workspace' },
    ],
    video: [
      { id: 'omni-flash', name: 'Omni Flash 1.1', isDefault: true, desc: 'Fluid camera motion & prompt-to-video' },
      { id: 'veo-3-1-quality', name: 'Veo 3.1 Quality', isDefault: false, desc: 'High-definition cinematic renders' },
      { id: 'veo-3-1-fast', name: 'Veo 3.1 Fast', isDefault: false, desc: 'Fast rendering for rapid iteration' },
      { id: 'ui-default', name: 'Workspace Default', isDefault: false, desc: 'Auto-selected by Flow workspace' },
    ],
    aspectRatios: [
      { id: '16:9', label: '16:9 (Landscape / YouTube / Desktop)' },
      { id: '9:16', label: '9:16 (Vertical / Reels / TikTok)' },
      { id: '1:1',  label: '1:1 (Square / Feed / Profile)' },
      { id: '4:3',  label: '4:3 (Standard Photo)' },
    ],
  },

  /** The owner’s verified-in-app Flow connection, if one is linked. */
  accountIdForGeneration(user, mediaType) {
    const id = user?.flowAccountId;
    if (!id) return null;
    if (String(mediaType || '').toLowerCase() === 'video') return String(id);
    return user?.flowAccountStatus === 'connected' ? String(id) : null;
  },

  /* ───────────────────────── house account pool ────────────────────────── */

  /**
   * The shared account pool, in primary/failover order.
   *
   * These are the operator's own Flow accounts. Nobody using the app has to
   * connect anything: image generation (and video, when the visitor has no
   * account of their own) is answered by this pool. One account running out of
   * quota is not an outage — the next one answers.
   *
   * HerovaAi defaults to FF2, then FF3 and FF1. An explicit
   * `FLOW_HOUSE_ACCOUNTS` value overrides that ordered website-only pool; only
   * accounts verified as connected by Flow are returned.
   */
  houseAccountsCache: { at: 0, ids: [] },

  async houseAccounts({ fresh = false, status = null } = {}) {
    const configured = String(process.env.FLOW_HOUSE_ACCOUNTS || 'ff2,ff3,ff1')
      .split(',').map((id) => id.trim()).filter(Boolean);

    // Cached briefly: a status call is seconds of MCP round-trips, and the
    // account list only changes when someone connects or disconnects an account.
    const cache = flowService.houseAccountsCache;
    if (!fresh && cache.at && Date.now() - cache.at < 60000) return cache.ids;

    try {
      const res = status ? null : await axios.get(`${GATEWAY_URL}/flow/status`, { timeout: 20000 });
      const statusData = status || res?.data;
      const ids = statusData?.accounts?.connectedAccountIds;
      if (!Array.isArray(ids)) return cache.ids || [];
      const accounts = statusData.accounts;
      const connected = ids.map(String).filter((id) => id && !id.startsWith('user_'));
      const house = configured.length
        ? configured.filter((id) => connected.includes(id))
        : connected;
      const ordered = house.length
        ? house
        : (!configured.length && accounts.defaultAccountId && accounts.readyForGeneration
          ? [String(accounts.defaultAccountId)]
          : []);
      flowService.houseAccountsCache = { at: Date.now(), ids: ordered };
      return ordered;
    } catch (_err) {
      return flowService.houseAccountsCache.ids || [];
    }
  },

  /** Cool-down list for shared accounts that just failed. */
  housePool: { cooldown: new Map() },
  HOUSE_COOLDOWN_MS: Number(process.env.FLOW_ACCOUNT_COOLDOWN_MS || 5 * 60 * 1000),

  /**
   * Try a caller-selected account first, then the configured house pool in its
   * declared primary/failover order, skipping accounts that just failed.
   */
  async candidateAccounts(preferred, preferHouse = false) {
    const house = await flowService.houseAccounts();
    const now = Date.now();
    const pool = flowService.housePool;
    const live = house.filter((id) => (pool.cooldown.get(id) || 0) < now);
    const usable = live.length ? live : house; // all cooling? try them anyway

    const preferredUsable = preferred && (pool.cooldown.get(String(preferred)) || 0) < now
      ? [String(preferred)]
      : [];
    const ordered = preferHouse
      ? [...usable.map(String), ...preferredUsable]
      : [...preferredUsable, ...usable.map(String)];
    return [...new Set(ordered)];
  },

  /** Remember that an account just failed, so the next request skips it briefly. */
  coolDownAccount(accountId) {
    if (!accountId) return;
    flowService.housePool.cooldown.set(String(accountId), Date.now() + flowService.HOUSE_COOLDOWN_MS);
  },

  /**
   * Generate media, trying each account in turn.
   *
   * `accountId` is a caller's own account when applicable; otherwise the house
   * pool answers the request. When an account fails, the next one is tried
   * before the request is given up on, and the failing account is skipped for a
   * few minutes so the retry does not cost the next visitor a timeout.
   */
  async generateMedia({
    prompt,
    mediaType = 'image',
    duration = 6,
    ratio = '16:9',
    model = null,
    accountId = null,
  }) {
    if (!prompt || typeof prompt !== 'string') {
      throw new Error('Prompt is required for Flow generation');
    }

    const type = mediaType.toLowerCase();
    const defaultModel = type === 'video' ? 'omni-flash' : 'nano-banana-pro';
    // Images use the platform pool first; when it is unavailable, an explicitly
    // connected personal account can serve as a fallback using that owner's Flow
    // allowance. Videos retain their existing personal-account-first behavior.
    const candidates = await flowService.candidateAccounts(accountId, type === 'image');
    if (type === 'image' && !candidates.length) {
      // No connected Flow account (the shared Google session signs out every
      // few days). Images must NOT hard-fail here — videos got an equivalent
      // fallback chain on 2026-10-11, but the image one
      // (generateImageViaOmniRoute) was written and never called, so the site
      // answered every image request with "not connected". Try the local
      // Nano Banana and Agnes image models first and preserve their failure
      // reason if the backup gateway cannot serve the request.
      const fallback = await flowService.generateImageViaOmniRoute({ prompt: prompt.trim(), ratio });
      if (fallback && fallback.ok) return fallback;
      return {
        ...fallback,
        ok: false,
        code: fallback?.code || 'FLOW_IMAGE_POOL_UNAVAILABLE',
        error: fallback?.error || 'Google Flow and the configured image backup providers are unavailable. Please try again later.',
      };
    }
    const attempts = candidates.length ? candidates : [null]; // null = engine's own default

    let lastError = '';
    for (const candidate of attempts) {
      const payload = {
        prompt: prompt.trim(),
        mediaType: type,
        duration: Number(duration) || 6,
        ratio,
        model: model || defaultModel,
        accountId: candidate || null,
      };

      try {
        const res = await axios.post(`${GATEWAY_URL}/flow/generate`, payload, {
          timeout: 300000, // up to 5 min for video / heavy Flow jobs
        });
        const body = res.data || {};
        if (body.url || body.pending) {
          return { ...body, servedBy: candidate || 'house-default' };
        }
        lastError = body.error || 'Flow returned no file';
        flowService.coolDownAccount(candidate);
      } catch (err) {
        lastError = err.response?.data?.error || err.message;
        flowService.coolDownAccount(candidate);
        // A rejected request (bad prompt/model) will fail on every account — stop
        // immediately instead of burning the whole pool on it.
        if (err.response && err.response.status === 400) {
          break;
        }
      }
    }

    // Videos fall back to the Agnes-direct video chain (OmniRoute video route
    // is broken upstream, Flow needs an account) — see generateVideoFallback.
    if (type === 'video') {
      const fallback = await flowService.generateVideoFallback({ prompt: prompt.trim(), ratio, duration });
      if (fallback?.ok) {
        const providerName = fallback.servedBy === 'agnes-direct'
          ? 'Agnes'
          : fallback.servedBy === 'omniroute-video'
            ? 'OmniRoute'
            : 'Google Flow';
        return { ...fallback, providerName };
      }
      return fallback;
    }

    if (type === 'image') {
      // Flow accounts exist but none could serve it (signed out mid-run,
      // rejected, timed out). Same fallback as above — a dead Google session
      // must degrade to the local image models instead of breaking the page.
      const fallback = await flowService.generateImageViaOmniRoute({ prompt: prompt.trim(), ratio });
      if (fallback && fallback.ok) return fallback;
      return {
        ...fallback,
        ok: false,
        code: fallback?.code || 'FLOW_IMAGE_POOL_UNAVAILABLE',
        error: fallback?.error || lastError || 'Google Flow and the configured image backup providers could not serve this request.',
      };
    }

    return { ok: false, error: lastError || 'No Flow account could serve this generation' };
  },

  /**
   * Video fallback when Flow MCP has no account: OmniRoute video route first
   * (fast-fail), then Agnes direct with per-key rotation.
   * Saves the result to LOCAL_MEDIA_DIR and returns { url, filename, mediaType }.
   */
  async generateVideoFallback({ prompt, ratio = '16:9', duration = 6 }) {
    fs.mkdirSync(LOCAL_MEDIA_DIR, { recursive: true });

    // 1. OmniRoute video route (kept for when the gateway fixes its path join).
    if (OMNIROUTE_URL && OMNIROUTE_KEY) {
      for (const model of OMNIROUTE_VIDEO_MODELS) {
        try {
          const res = await axios.post(`${OMNIROUTE_URL}/videos/generations`, {
            prompt: String(prompt).trim(),
            model,
            n: 1,
          }, {
            headers: {
              Authorization: `Bearer ${OMNIROUTE_KEY}`,
              'Content-Type': 'application/json',
            },
            timeout: 30000,
          });
          const saved = await flowService._saveVideoResult(res.data, model, 'omniroute-video');
          if (saved) return saved;
        } catch (_err) {
          // try next path
        }
      }
    }

    // 2. Agnes direct — proven endpoint shape, free-tier quota is per key.
    const keys = agnesVideoKeys();
    if (!keys.length) {
      return { ok: false, error: 'No video provider is configured on this server.' };
    }
    let lastError = '';
    for (const key of keys) {
      for (const model of AGNES_VIDEO_MODELS) {
        try {
          const res = await axios.post(AGNES_VIDEO_URL, {
            prompt: String(prompt).trim(),
            model,
            mode: 'text-to-video',
          }, {
            headers: {
              Authorization: `Bearer ${key}`,
              'Content-Type': 'application/json',
            },
            timeout: 300000, // video renders take minutes
          });
          const saved = await flowService._saveVideoResult(res.data, model, 'agnes-direct', axios, key);
          if (saved) return saved;
          lastError = flowService._shortError(res.data);
        } catch (err) {
          lastError = flowService._shortError(
            err.response?.data?.message || err.response?.data?.error
            || err.response?.data?.code || err.response?.data || err.message);
          // Rate/quota limits are per key — a different key may still serve.
        }
      }
    }
    return { ok: false, error: `All video providers declined (${String(lastError).slice(0, 160)}). Free quota resets periodically — try again later.` };
  },

  /** Short printable form of any provider error shape (never "[object Object]"). */
  _shortError(value) {
    if (typeof value === 'string') return value.slice(0, 200);
    try {
      const text = JSON.stringify(value);
      return (text || String(value)).slice(0, 200);
    } catch {
      return String(value).slice(0, 200);
    }
  },

  /**
   * Normalize a video-generation response (immediate file or async job) into a
   * saved local file. Returns the result object or null when nothing usable.
   */
  async _saveVideoResult(data, model, servedBy, httpClient, agnesKey) {
    const client = httpClient || axios;
    const authHeaders = agnesKey ? { Authorization: `Bearer ${agnesKey}` } : {};

    // Async job shape: {job_id / id, status_url / status} — poll briefly.
    const jobId = data?.job_id || data?.jobId || data?.id;
    const statusUrl = data?.status_url || data?.statusUrl || data?.url;
    if (jobId && (data?.status === 'processing' || data?.status === 'queued' || statusUrl)) {
      const deadline = Date.now() + 4 * 60 * 1000;
      let current = data;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 15000));
        try {
          const pollUrl = /^https?:/.test(statusUrl || '')
            ? statusUrl
            : `${AGNES_VIDEO_URL}/${jobId}`;
          const poll = await client.get(pollUrl, {
            headers: { ...authHeaders, 'Content-Type': 'application/json' },
            timeout: 30000,
          });
          current = poll.data || {};
          if (current?.status === 'completed' || current?.data?.[0]) break;
          if (current?.status === 'failed') return null;
        } catch {
          break;
        }
      }
      data = current;
    }

    const item = data?.data?.[0] || data?.result || data;
    let videoBuffer = null;
    if (item?.b64_json) {
      videoBuffer = Buffer.from(item.b64_json, 'base64');
    } else if (item?.url || item?.video_url || item?.download_url) {
      const fileUrl = item.url || item.video_url || item.download_url;
      try {
        if (/^https?:/.test(fileUrl)) {
          const dl = await client.get(fileUrl, {
            responseType: 'arraybuffer', timeout: 120000,
            headers: authHeaders,
          });
          videoBuffer = Buffer.from(dl.data);
        }
      } catch {}
    }

    if (!videoBuffer || videoBuffer.length < 50000) return null;

    const slug = crypto.randomBytes(8).toString('hex');
    const filename = `ai_vid_${slug}.mp4`;
    fs.writeFileSync(path.join(LOCAL_MEDIA_DIR, filename), videoBuffer);
    return { ok: true, url: `/api/media/${filename}`, filename, mediaType: 'video', model, servedBy };
  },

  /**
   * Generate an image via the local OmniRoute /v1/images/generations endpoint.
   * Tries models in OMNIROUTE_IMAGE_MODELS order and returns the first success.
   * Saves the result to LOCAL_MEDIA_DIR and returns { url, filename, mediaType }.
   */
  async generateImageViaOmniRoute({ prompt, ratio = '1:1' }) {
    // Only the URL is mandatory: local OmniRoute (:20128) answers unauthenticated
    // too, so an empty OMNIROUTE_API_KEY must not disable the whole fallback.
    if (!OMNIROUTE_URL) {
      return { ok: false, error: 'OmniRoute is not configured on this server.' };
    }
    fs.mkdirSync(LOCAL_MEDIA_DIR, { recursive: true });
    let authenticationRejected = false;

    for (const model of OMNIROUTE_IMAGE_MODELS) {
      try {
        const res = await axios.post(`${OMNIROUTE_URL}/images/generations`, {
          prompt: String(prompt).trim(),
          model,
          size: ratio === '9:16' ? '768x1344' : ratio === '1:1' ? '1024x1024' : '1344x768',
          n: 1,
        }, {
          headers: {
            'Content-Type': 'application/json',
            ...(OMNIROUTE_KEY ? { Authorization: `Bearer ${OMNIROUTE_KEY}` } : {}),
          },
          timeout: 60000,
        });

        const item = res.data?.data?.[0];
        if (!item) continue;

        let imageBuffer = null;
        if (item.b64_json) {
          imageBuffer = Buffer.from(item.b64_json, 'base64');
        } else if (item.url) {
          const imgRes = await axios.get(item.url, { responseType: 'arraybuffer', timeout: 30000 });
          imageBuffer = Buffer.from(imgRes.data);
        }

        if (!imageBuffer || imageBuffer.length < 5000) continue;

        // Name the file for the bytes we actually got: the free image models
        // return PNG (89 50 4E 47) while this used to hardcode ".jpg", so the
        // route answered image/png data as "image/jpeg" with X-Content-Type-Options:
        // nosniff — a mismatch that strict clients/previewers refuse to render.
        const isPng = imageBuffer[0] === 0x89 && imageBuffer[1] === 0x50
        const isJpg = imageBuffer[0] === 0xff && imageBuffer[1] === 0xd8
        const isWebp = imageBuffer.length > 12 && imageBuffer.toString('ascii', 0, 4) === 'RIFF'
          && imageBuffer.toString('ascii', 8, 12) === 'WEBP'
        const ext = isJpg ? '.jpg' : isWebp ? '.webp' : isPng ? '.png' : '.png'
        const slug = crypto.randomBytes(8).toString('hex');
        const filename = `ai_img_${slug}${ext}`;
        const dest = path.join(LOCAL_MEDIA_DIR, filename);
        fs.writeFileSync(dest, imageBuffer);

        return {
          ok: true,
          url: `/api/media/${filename}`,
          filename,
          mediaType: 'image',
          model,
          modelName: IMAGE_MODEL_NAMES[model] || model,
          servedBy: 'omniroute-fallback',
        };
      } catch (_err) {
        authenticationRejected ||= _err.response?.status === 401 || _err.response?.status === 403;
        // try next model
      }
    }
    if (authenticationRejected) {
      return {
        ok: false,
        code: 'IMAGE_PROVIDER_AUTH_REQUIRED',
        error: 'The image gateway rejected its server-side credentials. Configure a valid image provider key or connect a verified Google Flow account.',
      };
    }
    return {
      ok: false,
      error: 'Nano Banana 2.1 and the Agnes image fallback are currently unavailable. Please retry later or check the server image gateway.',
    };
  },

  async beginConnect({ accountId, label } = {}) {
    const payload = {};
    if (accountId) payload.accountId = accountId;
    if (label) payload.label = label;
    const res = await axios.post(`${GATEWAY_URL}/flow/connect/begin`, payload, { timeout: 60000 });
    return res.data;
  },

  async completeConnect({ connectionId, accountId, label } = {}) {
    const payload = {
      connectionId,
      accountId,
      label,
    };
    // The gateway holds this request open while the owner clicks Connect Flow in
    // the extension (it starts the exchange in the background at "begin"), so the
    // timeout must cover that human step, not just a quick round-trip.
    // Wrapped so a gateway 400 ({ok:false, error:"…"}) surfaces its real reason
    // instead of axios's "Request failed with status code 400".
    let res;
    try {
      res = await axios.post(`${GATEWAY_URL}/flow/connect/complete`, payload, { timeout: 260000 });
    } catch (err) {
      throw new Error(flowService.gatewayError(err, 'The Flow connection could not be completed'));
    }
    if (res.data && res.data.ok === false) {
      throw new Error(flowService.gatewayError(res.data));
    }
    flowService.invalidateStatusCache();
    return res.data;
  },

  /**
   * The gateway answers 400 with {ok:false,error} when a connection genuinely
   * fails, and axios only hands back "Request failed with status code 400". Turn
   * that back into the sentence the owner can act on.
   */
  gatewayError(err, fallback = 'The Flow connection could not be completed') {
    const data = err?.response?.data || err;
    if (data && typeof data === 'object') {
      if (typeof data.error === 'string' && data.error) return data.error;
      if (typeof data.message === 'string' && data.message) return data.message;
    }
    return fallback;
  },

  async connectWithCookies({ rawCookies, accountId, label } = {}) {
    let cookiesList = [];
    if (Array.isArray(rawCookies)) {
      cookiesList = rawCookies;
    } else if (typeof rawCookies === 'string') {
      try {
        const parsed = JSON.parse(rawCookies);
        if (Array.isArray(parsed)) cookiesList = parsed;
      } catch {
        // Parse cookie header string format: key=val; key2=val2
        const parts = rawCookies.split(';').map(p => p.trim()).filter(Boolean);
        cookiesList = parts.map(part => {
          const eqIdx = part.indexOf('=');
          if (eqIdx === -1) return null;
          const name = part.slice(0, eqIdx).trim();
          const value = part.slice(eqIdx + 1).trim();
          return {
            name,
            value,
            domain: '.google.com',
            path: '/',
            secure: true,
            httpOnly: false,
          };
        }).filter(Boolean);
      }
    }

    if (!cookiesList.length) {
      throw new Error('No valid Google cookies found in payload. Provide a JSON cookie array or cookie string.');
    }

    // ONE call on purpose. The Flow login bridge and its connection token live in
    // the memory of a single MCP process, so arming it, posting the session and
    // completing the handshake across separate calls can never work: the process
    // that armed it has already exited. The gateway runs the whole exchange as one
    // process instead.
    try {
      const res = await axios.post(`${GATEWAY_URL}/flow/connect/cookies`, {
        cookies: cookiesList,
        accountId,
        label,
      }, { timeout: 300000 });
      if (res.data && res.data.ok === false) {
        throw new Error(flowService.gatewayError(res.data));
      }
      return res.data;
    } catch (err) {
      throw new Error(flowService.gatewayError(err, 'Those cookies were not accepted by Google Flow'));
    }
  },

  async generateSocialPost({
    mediaUrl = '',
    prompt = '',
    mediaType = 'image',
    platform = 'facebook',
    customTopic = '',
    user = null,
    memory = null,
    commercialMode = false,
    referenceImage = null,
    recentPosts = [],
    variationId = '',
  }) {
    const cloudAIService = require('./cloudAIService');
    const businessName = memory?.businessName || user?.businessInfo?.name || 'Our Brand';
    const industry = memory?.businessType || memory?.industry || user?.businessInfo?.industry || '';
    const website = memory?.operations?.website || user?.businessInfo?.website || '';
    const businessDescription = memory?.enabled !== false
      ? memory?.businessDescription || user?.businessInfo?.description || ''
      : user?.businessInfo?.description || '';
    const catalogContext = memory?.enabled !== false && Array.isArray(memory?.catalog)
      ? memory.catalog.filter((item) => item.available !== false).slice(0, 12)
        .map((item) => [item.kind, item.name, item.price, item.summary, item.details].filter(Boolean).join(': '))
        .join('\n')
      : '';
    const operationsContext = memory?.enabled !== false ? memory?.operations || {} : {};
    const recentPostContext = Array.isArray(recentPosts)
      ? recentPosts.slice(0, 12).map((item, index) => `${index + 1}. ${String(item).slice(0, 900)}`).join('\n')
      : '';

    // Step 1: Detect physical media and extract visual frames + metadata
    let detectedType = mediaType;
    let visualAttachment = referenceImage || null;
    let mediaMeta = {
      isVertical: false,
      aspectRatio: '16:9',
      dimensions: 'Standard',
      duration: '',
      hasVisualAnalysis: false,
      summary: '',
    };
    if (referenceImage) {
      detectedType = 'image';
      mediaMeta = {
        ...mediaMeta,
        hasVisualAnalysis: true,
        dimensions: 'Reference image',
        summary: 'User-provided reference image',
      };
    }

    // A path from the request is NEVER used directly. It used to be: any signed-in
    // owner could pass `/home/sahadat/herovaai/backend/.env` as `mediaUrl`, the server
    // read that file, attached it to the AI call as an "image" and handed the model's
    // description back — an arbitrary-file-read on a box that holds ~30 provider keys.
    // Media is only ever resolved inside the app's own media directories, by filename
    // (basename), so `..` and absolute paths cannot escape them.
    const filePath = mediaUrl ? this.findOwnedMediaFile(mediaUrl) : null;

    if (filePath && fs.existsSync(filePath)) {
      const ext = path.extname(filePath).toLowerCase();
      const isVideo = ['.mp4', '.webm', '.mov', '.mkv', '.m4v'].includes(ext);
      detectedType = isVideo ? 'video' : 'image';

      if (isVideo) {
        // Inspect video dimensions and duration via ffprobe. Arguments are passed as an
        // array — a filename that reached a shell string would be a command injection.
        try {
          const probeOut = execFileSync(
            'ffprobe',
            ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,duration', '-of', 'json', filePath],
            { timeout: 3000 }
          ).toString();
          const parsed = JSON.parse(probeOut);
          const stream = parsed?.streams?.[0];
          if (stream?.width && stream?.height) {
            const w = stream.width;
            const h = stream.height;
            const dur = stream.duration ? `${parseFloat(stream.duration).toFixed(1)}s` : '';
            const isVert = h > w;
            mediaMeta = {
              isVertical: isVert,
              aspectRatio: isVert ? '9:16 (Vertical Short/Reel/TikTok)' : (w === h ? '1:1 (Square)' : '16:9 (Landscape)'),
              dimensions: `${w}x${h}`,
              duration: dur,
              hasVisualAnalysis: true,
              summary: `${isVert ? 'Vertical 9:16 Short Video' : 'Widescreen Video'} (${w}x${h}${dur ? `, ${dur}` : ''})`,
            };
          }
        } catch {}

        // Extract thumbnail snapshot via ffmpeg for Gemini Vision
        try {
          const tempThumb = path.join(os.tmpdir(), `ai_thumb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.jpg`);
          const thumbArgs = (seek) => [
            '-y', ...(seek ? ['-ss', '00:00:01'] : []),
            '-i', filePath, '-vframes', '1', '-q:v', '2', tempThumb,
          ];
          try {
            execFileSync('ffmpeg', thumbArgs(true), { timeout: 4000, stdio: 'ignore' });
          } catch {
            execFileSync('ffmpeg', thumbArgs(false), { timeout: 4000, stdio: 'ignore' });
          }
          if (fs.existsSync(tempThumb)) {
            const thumbBuffer = fs.readFileSync(tempThumb);
            visualAttachment = {
              mimeType: 'image/jpeg',
              data: thumbBuffer.toString('base64'),
            };
            fs.unlinkSync(tempThumb);
          }
        } catch (e) {
          console.warn('[flowService] Video thumbnail extraction note:', e.message);
        }
      } else {
        // Image: read directly
        try {
          const imgBuffer = fs.readFileSync(filePath);
          const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
          visualAttachment = {
            mimeType: mime,
            data: imgBuffer.toString('base64'),
          };
          mediaMeta.hasVisualAnalysis = true;
          mediaMeta.dimensions = 'Image (Visual analysis attached)';
          mediaMeta.summary = 'High-Resolution Still Image';
        } catch (e) {
          console.warn('[flowService] Image read note:', e.message);
        }
      }
    }

    // Step 2: Psychological Viral Copywriting System Prompt
    const platformGuidelines = {
      youtube: `Target Platform: YouTube Shorts / YouTube Video.
- Format: High-energy thumb-stopping hook in line 1. Title must include #Shorts if vertical or under 60s.
- Retention: Add an intriguing open-loop or question in the first sentence to keep viewers watching past 3 seconds.
- Algorithmic SEO: Include 3 high-volume search keywords in the description.
- CTA: "Subscribe & drop your reaction below 👇"`,
      tiktok: `Target Platform: TikTok.
- Format: Punchy, trend-aware, colloquial hook. No corporate fluff.
- Retention: Pattern interrupt that stops the high-speed feed thumb scroll.
- Algorithmic SEO: Natural TikTok SEO keywords + viral hashtag mix.
- CTA: "Save this for later 📌 and tell me what you think in the comments!"`,
      instagram: `Target Platform: Instagram Feed / Reel.
- Format: Clean aesthetic layout with line breaks and selective emojis.
- Structure: Bold 1-sentence hook -> 2-line relatable micro-story -> engaging CTA.
- CTA: "Double tap if you feel this & save to your collection ✨"`,
      facebook_page: `Target Platform: Facebook Page.
- Format: Conversational, community-focused storytelling.
- Retention: Pose a genuine question that invites people in the comments to share their experience.
- CTA: "Share this with someone who needs to see this, and leave your thoughts below!"`,
      telegram: `Target Platform: Telegram Channel.
- Format: Clean, bulleted broadcast with crisp bold headings and value points.
- CTA: "Tap the link below to get started or forward to your friends."`,
    };

    const targetGuideline = commercialMode
      ? `Target Platform: Facebook Page commercial post.
- Write for customers in a natural, trustworthy brand voice. Explain the product, service, or useful idea clearly.
- Use a direct, relevant next step (for example, ask a question or invite the reader to learn more); do not use generic engagement bait.`
      : platformGuidelines[platform] || platformGuidelines.facebook_page;

    const systemPrompt = `You are a skilled social media marketing copywriter.
You NEVER write bland, robotic, or generic corporate filler.
${commercialMode
  ? 'Write useful, customer-facing business copy. Choose a natural structure for this particular offer; do not force clickbait, emojis, questions, or a fixed template.'
  : `You understand why humans click, watch, comment, and share.
Every post you generate applies proven human attraction principles:
1. PATTERN INTERRUPT: The very first sentence must break expectations, spark instant curiosity, or trigger an emotional reaction.
2. VISUAL ANCHOR: Mention specific visual elements, lighting, vibe, or details visible in the attached media so the post feels authentic to what the human viewer is seeing.
3. CURIOSITY GAP: Open a loop that compels people to read the full caption or watch the video.
4. ENGAGEMENT CATALYST: Ask a question or give a CTA that has zero friction to reply to.
`}
${commercialMode
  ? `5. COMMERCIAL CLARITY: Make the offer, product, or service understandable and useful to a Facebook customer. Write natural, concise Page copy, not a paid-ad campaign plan.
6. TRUTHFULNESS: Never invent prices, discounts, guarantees, stock, results, testimonials, deadlines, or business/contact details. Only use facts present in the brief, profile, catalog, operations, or image.
7. ORIGINALITY: Choose a fresh angle suited to this request. Do not reuse or lightly rewrite recent posts. Vary the opening, message structure, vocabulary, and CTA. Do not use a fixed template.
8. HASHTAGS: Use 0-4 genuinely relevant hashtags; Facebook commercial copy should not be cluttered.
`
  : '5. STRATEGIC HASHTAGS: Exactly 10-14 relevant hashtags.\n'}

Brand Context: "${businessName}" ${industry ? `(Industry: ${industry})` : ''} ${website ? `(Website: ${website})` : ''}
${businessDescription ? `Business bio: "${String(businessDescription).slice(0, 2000)}"` : ''}
${catalogContext ? `Available products/services:\n${catalogContext.slice(0, 3500)}` : ''}
${operationsContext.serviceAreas ? `Service areas: ${operationsContext.serviceAreas}` : ''}
${operationsContext.delivery ? `Delivery: ${operationsContext.delivery}` : ''}
${operationsContext.bookingLink ? `Booking link: ${operationsContext.bookingLink}` : ''}
${memory?.enabled !== false && memory?.policies ? `Business policies: ${String(memory.policies).slice(0, 1200)}` : ''}
${memory?.enabled !== false && memory?.guardrails ? `Business-specific restrictions: ${String(memory.guardrails).slice(0, 1200)}` : ''}
${memory?.enabled !== false && memory?.tone ? `Brand voice: ${memory.tone}` : ''}
${memory?.enabled !== false && memory?.language ? `Write in: ${memory.language}` : ''}
Media Specs: ${detectedType} (${mediaMeta.aspectRatio}${mediaMeta.duration ? `, duration: ${mediaMeta.duration}` : ''}).
${targetGuideline}

Output MUST be valid JSON ONLY in this exact structure:
{
  "headline": "Concise opening line suited to the requested post",
  "caption": "Persuasive, truthful copy tailored to the brief, business, and visual",
  "hashtags": ["Only relevant hashtags; 0-4 for commercial posts"],
  "cta": "Frictionless call to action",
  "thumbnailNote": "Optional visual suggestion, or an empty string when not useful",
  "hookType": "Pattern Interrupt / Curiosity Gap / Story / Bold Question",
  "fullPost": "The complete, ready-to-publish post with headline, caption, CTA, and hashtags formatted beautifully with clean line breaks."
}`;

    const userPrompt = `Media inspection:
- Type: ${detectedType}
- Dimensions / Format: ${mediaMeta.dimensions} (${mediaMeta.aspectRatio})
${mediaMeta.duration ? `- Duration: ${mediaMeta.duration}` : ''}
- Visual subject/intent: "${prompt}"
- Target Platform: ${platform}
${customTopic ? `- Campaign Focus / Angle: "${customTopic}"` : ''}
${commercialMode ? `- Unique variation request: ${variationId || crypto.randomUUID()}
- Recent posts to avoid repeating:
${recentPostContext || '(No recent posts available.)'}
- Create one polished, customer-facing Facebook Page commercial post. Use the available brand profile and reference where relevant. If a key fact is missing, omit it rather than inventing it. Ensure this version has a distinct idea and wording.
` : ''}

${commercialMode
  ? `Use the business details and visual reference${visualAttachment ? ' (inspect the attached image directly)' : ''} to write one truthful, original Facebook commercial post. Return JSON only.`
  : `Analyze the visual content${visualAttachment ? ' (inspect the attached frame directly)' : ''} and craft a high-converting, human-attracting viral post. Return JSON only.`}`;

    try {
      const messages = [{ role: 'user', content: userPrompt }];
      const attachments = visualAttachment ? [visualAttachment] : [];

      // The free gateway default sees images, and `allowFailover` lets the service
      // answer from another free model that can also see them — so the fallback
      // order lives in the service rather than being copied out here, where it
      // would drift away from the catalog.
      const res = await cloudAIService.generateCompletion({
        model: cloudAIService.DEFAULT_MODEL,
        messages,
        systemPrompt,
        attachments,
        temperature: 0.7,
        allowFailover: true,
      });

      const raw = res?.text || '';
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (commercialMode && (!parsed.fullPost || !parsed.headline || !parsed.caption)) {
          throw new Error('The AI response did not include the required post fields.');
        }
        return {
          ...parsed,
          hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.slice(0, commercialMode ? 4 : 14) : [],
          mediaMeta,
        };
      }
      if (commercialMode) {
        throw new Error('The AI response was not valid post JSON.');
      }
    } catch (err) {
      if (commercialMode) {
        throw new Error(`Could not generate a commercial post: ${err.message}`);
      }
      console.warn('[flowService] AI social post generation fallback:', err.message);
    }

    if (commercialMode) {
      throw new Error('Could not generate a commercial post. Please try again.');
    }

    // High quality template fallback if AI is offline
    const cleanTags = [
      `#${businessName.replace(/\s+/g, '')}`,
      `#${detectedType === 'video' ? 'Shorts' : 'Photography'}`,
      '#Viral', '#Trending', '#CreativeDirection', '#VisualStorytelling',
      '#MustWatch', '#ExplorePage', '#DailyInspo', '#ContentCreator'
    ];
    const headline = `⚡ You need to see this from ${businessName}`;
    const caption = prompt
      ? `We pushed the visual limits on this one: "${prompt}". Look closely at the details and tell us what stands out most to you.`
      : `Behind the scenes of something truly unique. Crafted to catch the eye and inspire.`;
    const cta = platform === 'youtube'
      ? `Subscribe and let us know your reaction in the comments! 👇`
      : platform === 'tiktok'
      ? `Save this for later 📌 & drop your thoughts below!`
      : `Drop a comment with your favorite detail below!`;
    const fullPost = `${headline}\n\n${caption}\n\n👉 ${cta}\n\n${cleanTags.join(' ')}`;

    return {
      headline,
      caption,
      hashtags: cleanTags,
      cta,
      thumbnailNote: `Optimal framing: vibrant focal point centered in ${mediaMeta.aspectRatio}. Overlay text: "WAIT FOR IT" or "HOW WE MADE THIS".`,
      hookType: 'Pattern Interrupt',
      mediaMeta,
      fullPost,
    };
  },

  /** Inside one of the app's own media directories? (After resolving `..`.) */
  isOwnedMediaPath(filePath) {
    if (!filePath) return false;
    const resolved = path.resolve(filePath);
    return MEDIA_DIRS.some((dir) => resolved === dir || resolved.startsWith(dir + path.sep));
  },

  /**
   * Turn a client-supplied media reference (`/api/media/x.mp4`, a full URL, or a bare
   * name) into a real path, but only if that path is one of ours. Returns null otherwise,
   * so an unowned path simply means "no attached visual" instead of a file read.
   */
  findOwnedMediaFile(mediaUrl) {
    const clean = String(mediaUrl || '').split('?')[0];
    const filename = path.basename(clean);
    if (!filename || filename === '.' || filename === '..' || filename.includes('/') || filename.includes('\\')) {
      return null;
    }
    const found = this.findMediaFile(filename);
    return this.isOwnedMediaPath(found) ? found : null;
  },

  findMediaFile(filename) {
    const safeName = path.basename(filename);
    for (const dir of MEDIA_DIRS) {
      const full = path.join(dir, safeName);
      if (fs.existsSync(full)) {
        return full;
      }
    }
    // Deep search in jobs subdirectories if needed
    const jobsDir = path.resolve(process.env.HOME || '', 'content-bot/data/google_flow_mcp/jobs');
    if (fs.existsSync(jobsDir)) {
      try {
        const subdirs = fs.readdirSync(jobsDir);
        for (const sub of subdirs) {
          const nested = path.join(jobsDir, sub, safeName);
          if (fs.existsSync(nested)) return nested;
        }
      } catch {}
    }
    return null;
  },
};

module.exports = flowService;
