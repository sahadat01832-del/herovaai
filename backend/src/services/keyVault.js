/**
 * keyVault — the one place that answers "which API keys does this deployment actually hold?".
 *
 * Two sources, in priority order:
 *   1. keys saved at runtime from the dashboard (MongoDB `ApiKey` documents)
 *   2. keys baked into backend/.env
 *
 * A saved key therefore *overrides* the same .env slot instead of replacing the file, which is
 * what makes rotation possible without SSH or a restart.
 *
 * Resolution is synchronous by design: cloudAIService and catalogService read keys inside hot
 * paths and in their constructors. The vault keeps an in-memory snapshot, hydrated once at boot
 * and rewritten after every write, so callers never await a database round-trip to send a request.
 */
const axios = require('axios');
const ApiKey = require('../models/ApiKey');

const PROBE_TIMEOUT_MS = Number(process.env.KEY_PROBE_TIMEOUT_MS || 9000);

// ─── Masking ───────────────────────────────────────────────────────────────
/**
 * Show enough to recognise a key, never enough to use it: `sk-or-v1…f3a9`.
 * Values too short to mask safely are replaced entirely.
 */
function mask(value) {
  const v = String(value || '').trim();
  if (!v) return '';
  if (v.length <= 12) return '•'.repeat(Math.max(6, v.length));
  return `${v.slice(0, 6)}…${v.slice(-4)}`;
}

// ─── Probes ────────────────────────────────────────────────────────────────
// Each probe performs the cheapest real authenticated call a provider offers. A 200 proves the
// key works; a 401/403 proves it does not. Anything else is reported as-is rather than guessed.
function openAIProbe(url, extraHeaders = {}) {
  return async (value) => {
    const started = Date.now();
    const res = await axios.get(url, {
      headers: { Authorization: `Bearer ${value}`, ...extraHeaders },
      timeout: PROBE_TIMEOUT_MS,
      validateStatus: () => true,
    });
    return { status: res.status, latencyMs: Date.now() - started, ok: res.status >= 200 && res.status < 300 };
  };
}

/**
 * Gemini is special: Google rejects `?key=` when an Authorization header rides along, and the
 * `AQ.` keys in this deployment are OAuth-style and only work through the Bearer form.
 */
function geminiProbe() {
  return async (value) => {
    const started = Date.now();
    const isOAuth = String(value).startsWith('AQ.');
    const url = 'https://generativelanguage.googleapis.com/v1beta/models';
    const res = await axios.get(isOAuth ? url : `${url}?key=${encodeURIComponent(value)}`, {
      headers: isOAuth ? { Authorization: `Bearer ${value}` } : {},
      timeout: PROBE_TIMEOUT_MS,
      validateStatus: () => true,
    });
    return { status: res.status, latencyMs: Date.now() - started, ok: res.status >= 200 && res.status < 300 };
  };
}

/**
 * The agent platform key is only meaningful against a configured endpoint; with none set the
 * probe reports `unknown` instead of inventing a verdict.
 */
async function agentPlatformProbe(value) {
  const base = (process.env.CONTENTBOT_API_URL || '').trim().replace(/\/+$/, '');
  if (!base) {
    return { ok: false, skipped: true, status: 0, latencyMs: 0, message: 'Agent platform URL is not configured (CONTENTBOT_API_URL is empty)' };
  }
  const started = Date.now();
  const res = await axios.get(`${base}/health`, {
    headers: { Authorization: `Bearer ${value}` },
    timeout: PROBE_TIMEOUT_MS,
    validateStatus: () => true,
  }).catch(err => ({ status: 0, _err: err }));

  if (res._err) {
    return { ok: false, status: 0, latencyMs: Date.now() - started, message: `Could not reach ${base}: ${res._err.code || res._err.message}` };
  }
  return { status: res.status, latencyMs: Date.now() - started, ok: res.status >= 200 && res.status < 300 };
}

/**
 * Google OAuth is a credential *pair*, so the probe needs both halves: probing
 * either slot validates the pair. Google answers `invalid_grant` when the client
 * exists but the test code is bogus — which is exactly what we want to see — and
 * `invalid_client` when the ID or secret is wrong.
 */
function googleOAuthProbe() {
  return async function probe(value) {
    const looksLikeId = /\.apps\.googleusercontent\.com$/.test(String(value || '').trim());
    const clientId = looksLikeId ? String(value).trim() : firstKey(['GOOGLE_CLIENT_ID']);
    const clientSecret = looksLikeId ? firstKey(['GOOGLE_CLIENT_SECRET']) : String(value || '').trim();
    const redirectUri = (process.env.GOOGLE_CALLBACK_URL || '').trim()
      || `${(process.env.BACKEND_URL || 'http://localhost:5000').replace(/\/+$/, '')}/api/auth/google/callback`;

    if (!clientId || !clientSecret) {
      return {
        ok: false, skipped: true, status: 0, latencyMs: 0,
        message: 'Google sign-in needs both a client ID and a client secret before it can be tested',
      };
    }

    const started = Date.now();
    const res = await axios.post(
      'https://oauth2.googleapis.com/token',
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: 'herovaai-connection-test',
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }).toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: PROBE_TIMEOUT_MS,
        validateStatus: () => true,
      }
    ).catch(err => ({ status: 0, _err: err }));

    const latencyMs = Date.now() - started;
    if (res._err) {
      return { ok: false, status: 0, latencyMs, message: `Could not reach Google: ${res._err.code || res._err.message}` };
    }

    const error = (res.data && res.data.error) || '';
    if (error === 'invalid_grant') {
      return { ok: true, status: res.status, latencyMs, message: 'Google accepted the client ID and secret (the test code was correctly rejected)' };
    }
    if (error === 'invalid_client') {
      return { ok: false, status: res.status, latencyMs, message: 'Google rejected the client ID or secret — copy both again from the OAuth client' };
    }
    if (error === 'redirect_uri_mismatch') {
      return { ok: false, status: res.status, latencyMs, message: `Google rejected the redirect URI — add ${redirectUri} to the OAuth client` };
    }
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      latencyMs,
      message: (res.data && res.data.error_description) || `Google replied HTTP ${res.status}`,
    };
  };
}

// ─── Provider registry ─────────────────────────────────────────────────────
/**
 * One entry per provider: the .env slots a key can fill, where to read its documentation, and
 * how to prove a key works. `envNames` order matters — it is the priority order the pools use.
 */
const PROVIDERS = [
  {
    id: 'gemini', label: 'Google Gemini', group: 'Multimodal',
    setupUrl: 'https://aistudio.google.com/app/apikey',
    envNames: ['GEMINI_API_KEY', ...Array.from({ length: 6 }, (_, i) => `GEMINI_API_KEY_${i + 2}`)],
    placeholder: 'AIza… (API key) or AQ.… (OAuth)',
    probe: geminiProbe(),
  },
  {
    id: 'agens', label: 'Agnes AI Hub', group: 'Multimodal',
    setupUrl: 'https://apihub.agnes-ai.com',
    envNames: ['AGENS_API_KEY', ...Array.from({ length: 5 }, (_, i) => `AGENS_API_KEY_${i + 2}`), 'AGNES_API_KEY'],
    placeholder: 'sk-…',
    probe: openAIProbe('https://apihub.agnes-ai.com/v1/models'),
  },
  {
    id: 'groq', label: 'Groq', group: 'Fast inference',
    setupUrl: 'https://console.groq.com/keys',
    envNames: ['GROQ_API_KEY'],
    placeholder: 'gsk_…',
    probe: openAIProbe('https://api.groq.com/openai/v1/models'),
  },
  {
    id: 'openrouter', label: 'OpenRouter', group: 'Aggregator',
    setupUrl: 'https://openrouter.ai/keys',
    envNames: ['OPENROUTER_API_KEY', 'OPENROUTER_API_KEY_2'],
    placeholder: 'sk-or-v1-…',
    probe: openAIProbe('https://openrouter.ai/api/v1/models'),
  },
  {
    id: 'openai', label: 'OpenAI', group: 'Frontier',
    setupUrl: 'https://platform.openai.com/api-keys',
    envNames: ['OPENAI_API_KEY'],
    placeholder: 'sk-proj-…',
    probe: openAIProbe('https://api.openai.com/v1/models'),
  },
  {
    id: 'deepseek', label: 'DeepSeek', group: 'Frontier',
    setupUrl: 'https://platform.deepseek.com/api_keys',
    envNames: ['DEEPSEEK_API_KEY', 'DEEPSEEK_API_KEY_2'],
    placeholder: 'sk-…',
    probe: openAIProbe('https://api.deepseek.com/models'),
  },
  {
    id: 'cohere', label: 'Cohere', group: 'Frontier',
    setupUrl: 'https://dashboard.cohere.com/api-keys',
    envNames: ['COHERE_API_KEY', 'CB_COHERE_API_KEY'],
    placeholder: '…',
    probe: openAIProbe('https://api.cohere.com/v1/models'),
  },
  {
    id: 'unorouter', label: 'UnoRouter', group: 'Aggregator',
    setupUrl: '',
    envNames: ['UNOROUTER_API_KEY', 'CB_UNOROUTER_API_KEY'],
    placeholder: 'sk-…',
    probe: openAIProbe('https://api.unorouter.com/v1/models'),
  },
  {
    id: 'llm7', label: 'LLM7', group: 'Aggregator',
    setupUrl: '',
    envNames: ['LLM7_API_KEY'],
    placeholder: '…',
    probe: openAIProbe('https://api.llm7.io/v1/models'),
  },
  {
    id: 'ollama_cloud', label: 'Ollama Cloud', group: 'Aggregator',
    setupUrl: 'https://ollama.com/settings/keys',
    envNames: ['OLLAMA_CLOUD_API_KEY', 'OLLAMA_API_KEY'],
    placeholder: '…',
    probe: openAIProbe('https://ollama.com/v1/models'),
  },
  {
    id: 'opencode_zen', label: 'OpenCode Zen', group: 'Aggregator',
    setupUrl: '',
    envNames: ['OPENCODE_ZEN_API_KEY', 'OPENCODE_ZEN_API_KEY_2'],
    placeholder: 'oc_sk_…',
    probe: openAIProbe('https://opencode.ai/zen/v1/models'),
  },
  // ── Verified 2026-10-08: keys valid, /models answers. Chat is account-gated
  // (top-up / check-in / plan) so these carry no catalog models until the
  // account condition clears — registered here so dashboard probes tell the truth.
  {
    id: 'apertis', label: 'Apertis', group: 'Aggregator',
    setupUrl: 'https://api.apertis.ai',
    envNames: ['APERTIS_API_KEY'],
    placeholder: 'sk-…',
    probe: openAIProbe('https://api.apertis.ai/v1/models'),
  },
  {
    id: 'apinex', label: 'APInex', group: 'Aggregator',
    setupUrl: 'https://apinex.bond',
    envNames: ['APINEX_API_KEY'],
    placeholder: 'sk-apx…',
    probe: openAIProbe('https://api.apinex.bond/v1/models'),
  },
  {
    id: 'orcarouter', label: 'OrcaRouter', group: 'Aggregator',
    setupUrl: 'https://api.orcarouter.ai',
    envNames: ['ORCAROUTER_API_KEY'],
    placeholder: 'sk-orca-…',
    probe: openAIProbe('https://api.orcarouter.ai/v1/models'),
  },
  {
    id: 'airforce', label: 'Airforce', group: 'Aggregator',
    setupUrl: 'https://api.airforce/dashboard',
    envNames: ['AIRFORCE_API_KEY'],
    placeholder: 'sk-air-…',
    probe: openAIProbe('https://api.airforce/v1/models'),
  },
  {
    id: 'apmix', label: 'Apmix', group: 'Aggregator',
    setupUrl: 'https://apmix.ai/dashboard/billing',
    envNames: ['APMIX_API_KEY', 'APMIX_API_KEY_2'],
    placeholder: 'apx_live_…',
    probe: openAIProbe('https://api.apmix.ai/v1/models'),
  },
  {
    id: 'contentbot', label: 'Agent platform', group: 'Internal',
    setupUrl: '',
    envNames: ['CONTENTBOT_API_KEY'],
    placeholder: 'cb-…',
    probe: agentPlatformProbe,
  },
  {
    id: 'google-signin', label: 'Google sign-in', group: 'Sign-in',
    setupUrl: 'https://console.cloud.google.com/apis/credentials',
    envNames: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    placeholder: '…apps.googleusercontent.com',
    probe: googleOAuthProbe(),
  },
];

const PROVIDER_BY_ID = new Map(PROVIDERS.map(p => [p.id, p]));
const ENV_TO_PROVIDER = new Map();
PROVIDERS.forEach(p => p.envNames.forEach(name => ENV_TO_PROVIDER.set(name, p)));

// ─── Snapshot ──────────────────────────────────────────────────────────────
/** envName → saved keys, best (newest enabled) first. Rebuilt by hydrate(). */
let snapshot = new Map();
let hydratedAt = 0;
let hydrationError = null;

function fromEnv(envName) {
  const value = (process.env[envName] || '').trim();
  return value || '';
}

/** Rebuild the in-memory snapshot from MongoDB. Safe to call on a database that is down. */
async function hydrate() {
  try {
    const docs = await ApiKey.find({ enabled: true }).select('+value').sort({ updatedAt: -1 }).lean();
    const next = new Map();
    for (const doc of docs) {
      const value = String(doc.value || '').trim();
      if (!value) continue; // A blank saved key must never shadow a real .env value.
      if (!next.has(doc.envName)) next.set(doc.envName, []);
      next.get(doc.envName).push({ id: String(doc._id), value, label: doc.label || '' });
    }
    snapshot = next;
    hydratedAt = Date.now();
    hydrationError = null;
  } catch (err) {
    hydrationError = err.message;
  }
  return snapshot;
}

/** Re-read the vault after a write. */
const refresh = hydrate;

// ─── Resolution (synchronous) ──────────────────────────────────────────────
/** Every usable value for one slot: saved keys first, then the .env value. */
function valuesFor(envName) {
  const saved = snapshot.get(envName) || [];
  const values = saved.map(entry => entry.value);
  const envValue = fromEnv(envName);
  if (envValue) values.push(envValue);
  return Array.from(new Set(values));
}

/** Values for a pool of slots, in priority order, de-duplicated. */
function resolveMany(envNames = []) {
  const out = [];
  for (const name of envNames) out.push(...valuesFor(name));
  return Array.from(new Set(out));
}

/** The first usable key for a pool, or '' when the provider is unconfigured. */
function firstKey(envNames = []) {
  for (const name of envNames) {
    const value = valuesFor(name)[0];
    if (value) return value;
  }
  return '';
}

/** Where a slot's active value comes from — what the settings UI reports per key. */
function sourceOf(envName) {
  if ((snapshot.get(envName) || []).length > 0) return 'vault';
  if (fromEnv(envName)) return 'env';
  return 'missing';
}

// ─── Inventory (for the dashboard) ─────────────────────────────────────────
/** One row per provider slot, masked. Contains no usable secret. */
function inventory() {
  return PROVIDERS.map(provider => ({
    id: provider.id,
    label: provider.label,
    group: provider.group,
    setupUrl: provider.setupUrl,
    placeholder: provider.placeholder,
    probeable: Boolean(provider.probe),
    slots: provider.envNames.map(envName => {
      const saved = snapshot.get(envName) || [];
      const envValue = fromEnv(envName);
      const active = valuesFor(envName)[0] || '';
      return {
        envName,
        source: sourceOf(envName),
        masked: mask(active),
        savedCount: saved.length,
        hasEnvFallback: Boolean(envValue),
        saved: saved.map(entry => ({ id: entry.id, label: entry.label })),
      };
    }),
    configured: resolveMany(provider.envNames).length,
    keys: provider.envNames
      .flatMap(envName => (snapshot.get(envName) || []).map(entry => ({ ...entry, envName })))
      .map(entry => ({ id: entry.id, label: entry.label, envName: entry.envName })),
  }));
}

/** Detailed rows for saved keys (metadata + last probe result), never the value. */
async function savedKeys() {
  const docs = await ApiKey.find().sort({ provider: 1, updatedAt: -1 }).lean();
  return docs.map(doc => ({
    _id: String(doc._id),
    provider: doc.provider,
    providerLabel: (PROVIDER_BY_ID.get(doc.provider) || {}).label || doc.provider,
    envName: doc.envName,
    label: doc.label || '',
    enabled: doc.enabled,
    addedBy: doc.addedBy ? String(doc.addedBy) : null,
    lastTestedAt: doc.lastTestedAt,
    lastTestStatus: doc.lastTestStatus,
    lastTestMessage: doc.lastTestMessage,
    lastTestLatencyMs: doc.lastTestLatencyMs,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  }));
}

// ─── Writes ────────────────────────────────────────────────────────────────
function providerOf(envName) {
  return ENV_TO_PROVIDER.get(envName) || null;
}

/** Validate a slot name against the registry so a typo cannot create a key nothing reads. */
function assertSlot(envName) {
  const provider = providerOf(envName);
  if (!provider) {
    const err = new Error(`Unknown key slot "${envName}"`);
    err.status = 400;
    throw err;
  }
  return provider;
}

function assertValue(value) {
  const cleaned = String(value || '').trim();
  if (!cleaned) {
    const err = new Error('The key value is empty');
    err.status = 400;
    throw err;
  }
  if (cleaned.length < 8) {
    const err = new Error('That does not look like an API key (too short)');
    err.status = 400;
    throw err;
  }
  if (cleaned.length > 512) {
    const err = new Error('API keys are at most 512 characters');
    err.status = 400;
    throw err;
  }
  if (/\s/.test(cleaned)) {
    const err = new Error('The key contains whitespace — check for a copy/paste artefact');
    err.status = 400;
    throw err;
  }
  return cleaned;
}

async function saveKey({ envName, value, label, userId }) {
  const provider = assertSlot(envName);
  const cleaned = assertValue(value);
  const existing = await ApiKey.findOne({ envName, value: cleaned }).select('+value');
  if (existing) {
    // Rotating to the same value should not create a duplicate slot in the pool.
    existing.enabled = true;
    if (label !== undefined) existing.label = String(label || '').slice(0, 80);
    await existing.save();
    await refresh();
    return existing;
  }
  const doc = await ApiKey.create({
    provider: provider.id,
    envName,
    label: String(label || '').slice(0, 80),
    value: cleaned,
    addedBy: userId || null,
  });
  await refresh();
  return doc;
}

async function updateKey(id, { label, value, enabled }) {
  const doc = await ApiKey.findById(id).select('+value');
  if (!doc) {
    const err = new Error('Key not found');
    err.status = 404;
    throw err;
  }
  if (label !== undefined) doc.label = String(label || '').slice(0, 80);
  if (value !== undefined) doc.value = assertValue(value);
  if (enabled !== undefined) doc.enabled = Boolean(enabled);
  await doc.save();
  await refresh();
  return doc;
}

async function deleteKey(id) {
  const doc = await ApiKey.findByIdAndDelete(id);
  await refresh();
  return doc;
}

// ─── Probing ───────────────────────────────────────────────────────────────
/**
 * Live-test a key. Returns a verdict and always records it on the document (when the value came
 * from the vault) so the dashboard can show "this key failed 4 minutes ago" without re-probing.
 */
async function testKey({ id, envName, value }) {
  let doc = null;
  let slot = envName;
  let secret = value;

  if (id) {
    doc = await ApiKey.findById(id).select('+value');
    if (!doc) {
      const err = new Error('Key not found');
      err.status = 404;
      throw err;
    }
    slot = doc.envName;
    secret = secret || doc.value;
  }
  if (!secret) secret = firstKey([slot]);
  if (!secret) {
    const err = new Error('No value to test for that slot');
    err.status = 400;
    throw err;
  }

  const provider = providerOf(slot);
  if (!provider) {
    const err = new Error(`Unknown key slot "${slot}"`);
    err.status = 400;
    throw err;
  }

  let result;
  if (!provider.probe) {
    result = { ok: false, skipped: true, message: `${provider.label} publishes no endpoint we can probe; the key is stored but not verified` };
  } else {
    try {
      result = await provider.probe(secret);
    } catch (err) {
      result = { ok: false, status: 0, message: err.code || err.message };
    }
  }

  const message = result.message
    || (result.ok ? `Verified against ${provider.label}` : `Rejected by ${provider.label} (HTTP ${result.status || '—'})`);

  if (doc) {
    doc.lastTestedAt = new Date();
    doc.lastTestStatus = result.skipped ? 'unknown' : (result.ok ? 'ok' : 'failed');
    doc.lastTestMessage = message.slice(0, 240);
    doc.lastTestLatencyMs = result.latencyMs ?? null;
    await doc.save();
  }

  return {
    ok: Boolean(result.ok),
    skipped: Boolean(result.skipped),
    status: result.status || 0,
    latencyMs: result.latencyMs ?? null,
    provider: provider.id,
    providerLabel: provider.label,
    envName: slot,
    testedValue: mask(secret),
    message,
  };
}

/** Provider registry exposed for the dashboard (no keys). */
const publicProviders = PROVIDERS.map(p => ({
  id: p.id,
  label: p.label,
  group: p.group,
  setupUrl: p.setupUrl,
  placeholder: p.placeholder,
  envNames: p.envNames,
  probeable: Boolean(p.probe),
}));

module.exports = {
  PROVIDERS: publicProviders,
  providerOf,
  mask,
  hydrate,
  refresh,
  valuesFor,
  resolveMany,
  firstKey,
  sourceOf,
  inventory,
  savedKeys,
  saveKey,
  updateKey,
  deleteKey,
  testKey,
  stats: () => ({ hydratedAt, hydrationError, slots: snapshot.size }),
};
