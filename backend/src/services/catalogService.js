/**
 * CatalogService — ground truth about which models can actually answer.
 *
 * The curated catalog in cloudAIService states intent ("this is a model we want to offer").
 * This service checks fact: it asks each provider's own /models endpoint, caches the answer,
 * and tags every catalog entry with an availability, so nothing is advertised that cannot
 * serve and a request for a specific model is never silently answered by a different one.
 *
 * Availability states:
 *   available    - the provider's live list contains this id right now
 *   out_of_stock - the probe ran and the id is absent (the provider dropped or renamed it)
 *   key_missing  - this deployment holds no key for that provider at all
 *   unverified   - the probe itself failed (offline, rate-limited); we say so instead of
 *                  guessing in either direction, and a strict request is still attempted
 *                  once and reported truthfully if it fails
 */
const axios = require('axios');
const keyVault = require('./keyVault');

const AVAILABLE = 'available';
const OUT_OF_STOCK = 'out_of_stock';
const KEY_MISSING = 'key_missing';
const UNVERIFIED = 'unverified';

// Probes are cheap but not free: ten providers answered in ~2s when measured, so a ten minute
// window keeps /models instant while still catching a provider dropping a model the same day.
const TTL_MS = Number(process.env.CATALOG_TTL_MS || 10 * 60 * 1000);
const PROBE_TIMEOUT_MS = Number(process.env.CATALOG_PROBE_TIMEOUT_MS || 8000);

/** Where the operator's OmniRoute gateway lives. One place to change it. */
function omnirouteBase() {
  return (process.env.OMNIROUTE_BASE_URL || 'http://127.0.0.1:20128/v1').replace(/\/+$/, '');
}

/**
 * One entry per provider: where to ask, which env vars count as "we have a key", how that
 * provider spells ids in its own list, and whether it publishes pricing we can trust.
 * `strip` is the prefix the catalog id carries that the provider's own ids do not.
 *
 * There is exactly one entry, on purpose. This deployment holds a single credential —
 * OMNIROUTE_API_KEY — and the gateway behind it fronts every upstream provider itself
 * (Groq, Gemini, Cohere, …), so listing those providers here would only describe keys
 * nobody is allowed to spend. Keeping the map this short is what makes "the app runs on
 * the operator's OmniRoute key and nothing else" true by construction rather than by
 * convention: a probe round has nothing else it could reach.
 */
const PROVIDERS = {
  // `strip` removes the catalog's own prefix, which exists so an id like
  // `omniroute/groq/qwen/qwen3.8-27b` can never be confused with the upstream
  // spelling `groq/qwen/qwen3.8-27b`.
  omniroute: { keys: ['OMNIROUTE_API_KEY'], strip: 'omniroute/', style: 'openai',
    url: () => `${omnirouteBase()}/models` },
};

function firstKey(names) {
  return configuredKeys(names)[0] || '';
}

/** Slots resolve through the vault so a key rotated in the dashboard counts immediately. */
function configuredKeys(names) {
  return keyVault.resolveMany(names);
}

function hasKey(provider) {
  const def = PROVIDERS[provider];
  return Boolean(def) && configuredKeys(def.keys).length > 0;
}

/** Every id spelling that a provider's own list could legitimately use for this catalog id. */
function liveIdCandidates(provider, catalogId) {
  const def = PROVIDERS[provider] || {};
  const ids = [];
  if (def.strip && catalogId.startsWith(def.strip)) ids.push(catalogId.slice(def.strip.length));
  ids.push(catalogId);
  return ids;
}

function probeHeaders(provider) {
  const def = PROVIDERS[provider];
  if (def.authHeader === false) return {};
  const key = firstKey(def.keys);
  return key ? { Authorization: `Bearer ${key}` } : {};
}

function parseIds(provider, body) {
  const style = PROVIDERS[provider].style;
  if (style === 'gemini') {
    return (body?.models || [])
      .map(m => String(m.name || '').replace(/^models\//, ''))
      .filter(Boolean);
  }
  if (style === 'cohere') {
    return (body?.models || []).map(m => String(m.name || m.id || '')).filter(Boolean);
  }
  return (body?.data || []).map(m => String(m.id || m.name || '')).filter(Boolean);
}

/** Only a provider that publishes per-token pricing gets prices; OmniRoute publishes none. */
function parsePricing(provider, body) {
  const pricing = new Map();
  if (!PROVIDERS[provider]?.pricing) return pricing;
  for (const model of body?.data || []) {
    const raw = model?.pricing;
    if (!model?.id || !raw) continue;
    const prompt = Number(raw.prompt);
    const completion = Number(raw.completion);
    if (Number.isFinite(prompt) && Number.isFinite(completion)) {
      pricing.set(String(model.id), { prompt, completion });
    }
  }
  return pricing;
}

const state = {
  at: 0,            // epoch ms of the last completed probe round
  providers: {},    // provider -> { ok, ids: Set, pricing: Map, error }
  refreshing: null, // in-flight promise, so ten callers cause one probe round
};

async function probeProvider(provider) {
  const def = PROVIDERS[provider];
  const response = await axios.get(typeof def.url === 'function' ? def.url() : def.url, {
    headers: probeHeaders(provider),
    timeout: PROBE_TIMEOUT_MS,
  });
  return {
    ok: true,
    ids: new Set(parseIds(provider, response.data)),
    pricing: parsePricing(provider, response.data),
    error: null,
  };
}

async function refresh({ force = false } = {}) {
  if (!force && state.at && Date.now() - state.at < TTL_MS) return state;
  if (state.refreshing) return state.refreshing;

  state.refreshing = (async () => {
    const names = Object.keys(PROVIDERS).filter(hasKey);
    const results = await Promise.allSettled(names.map(name => probeProvider(name)));
    const providers = {};
    names.forEach((name, index) => {
      const result = results[index];
      if (result.status === 'fulfilled') {
        providers[name] = result.value;
      } else {
        providers[name] = {
          ok: false,
          ids: new Set(),
          pricing: new Map(),
          error: result.reason?.message || 'probe failed',
        };
      }
    });
    for (const name of Object.keys(PROVIDERS)) {
      if (!hasKey(name)) {
        providers[name] = { ok: false, ids: new Set(), pricing: new Map(), error: 'no key configured' };
      }
    }
    state.providers = providers;
    state.at = Date.now();
    return state;
  })();

  try {
    return await state.refreshing;
  } finally {
    state.refreshing = null;
  }
}

/** Probe if the cache is stale; callers can await this before composing a model list. */
async function ensureFresh() {
  if (!state.at || Date.now() - state.at >= TTL_MS) await refresh();
  return state;
}

/** Fire-and-forget warm-up so the first /models request does not pay for the probe round. */
function warm() {
  ensureFresh().catch(() => {});
}

function availabilityOf(provider, catalogId) {
  const def = PROVIDERS[provider];
  if (!def) return UNVERIFIED;
  if (!hasKey(provider)) return KEY_MISSING;
  const probed = state.providers[provider];
  if (!probed || !probed.ok) return UNVERIFIED;
  // No id asked about: UNVERIFIED is the honest answer. (Callers that pass an
  // unpinned model used to crash here on `undefined.startsWith` and report a
  // confusing "cloud tier failed" instead of "no model was requested".)
  if (!catalogId) return UNVERIFIED;
  return liveIdCandidates(provider, catalogId).some(id => probed.ids.has(id))
    ? AVAILABLE
    : OUT_OF_STOCK;
}

function pricingOf(provider, catalogId) {
  const probed = state.providers[provider];
  if (!probed?.ok || !probed.pricing?.size) return null;
  for (const id of liveIdCandidates(provider, catalogId)) {
    const pricing = probed.pricing.get(id);
    if (pricing) return pricing;
  }
  return null;
}

/**
 * Tag catalog entries for display. `isPaid` is only claimed when the provider published a
 * price; otherwise it stays null and the tier reads "unknown" rather than a blanket "free".
 */
function annotate(models) {
  return models.map(model => {
    const availability = availabilityOf(model.provider, model.id);
    const pricing = pricingOf(model.provider, model.id);
    // `free: true` on a catalog entry is an explicit claim by the operator — used
    // for gateways like OmniRoute whose /models publishes no prices, where the
    // alternative would be to label a free model "unknown" forever.
    const isPaid = model.free === true ? false : (pricing ? pricing.prompt > 0 || pricing.completion > 0 : null);
    return {
      ...model,
      availability,
      servable: availability === AVAILABLE,
      isPaid,
      tier: isPaid === null ? 'unknown' : (isPaid ? 'paid' : 'free'),
      pricing,
    };
  });
}

/**
 * Can this exact model be sent a request right now?
 *
 * `ok` is true only for a proven-live id. `unverified` is deliberately not fatal: the probe
 * failed, which tells us nothing about this model, so a strict request still tries it once
 * and reports the upstream error instead of pretending the model does not exist.
 */
async function checkServable(provider, catalogId) {
  await ensureFresh();
  const availability = availabilityOf(provider, catalogId);
  const probed = state.providers[provider];
  let reason = null;
  if (!catalogId) {
    reason = 'no model was requested';
  } else if (availability === OUT_OF_STOCK) {
    reason = `${catalogId} is not in ${provider}'s live model list`;
  } else if (availability === KEY_MISSING) {
    reason = `no ${provider} API key is configured`;
  } else if (availability === UNVERIFIED) {
    reason = `could not verify ${provider}'s model list (${probed?.error || 'probe failed'})`;
  }
  return { ok: availability === AVAILABLE, availability, reason };
}

/** Diagnostics for the admin/health surface: what was probed, when, and what it said. */
function snapshot() {
  const providers = {};
  for (const [name, probed] of Object.entries(state.providers)) {
    providers[name] = {
      probed: Boolean(probed.ok),
      count: probed.ids?.size || 0,
      error: probed.error,
    };
  }
  return { probedAt: state.at ? new Date(state.at).toISOString() : null, ttlMs: TTL_MS, providers };
}

module.exports = {
  AVAILABLE, OUT_OF_STOCK, KEY_MISSING, UNVERIFIED,
  PROVIDERS, annotate, availabilityOf, checkServable, ensureFresh, hasKey, refresh, snapshot, warm,
};
