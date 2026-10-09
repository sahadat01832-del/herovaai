/**
 * appSettings — runtime configuration with a synchronous read path.
 *
 * The same shape as the key vault, on purpose: a small map hydrated once at
 * boot, so hot paths (nagad.mode(), the channel scheduler) can read a setting
 * with a plain function call instead of an await. Writes go through set(), which
 * saves the row and refreshes the cache, so a change takes effect immediately
 * without a restart.
 *
 * Values here are visible in the admin UI — never put an API key, private key or
 * password in this store.
 */
const AppSetting = require('../models/AppSetting');

const cache = new Map();
let hydratedAt = null;
let lastError = null;

const NAGAD = 'payments.nagad';
const PLATFORM = 'platform';

/**
 * Anything falsy/absent that is still a boolean switch — pulls the typed value
 * out of a platform setting without the caller repeating the default.
 */
const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Deep merge for the nested `limits` block; scalars simply overwrite. */
function deepMerge(base, patch) {
  const out = isPlainObject(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(isPlainObject(patch) ? patch : {})) {
    out[key] = isPlainObject(value) && isPlainObject(out[key]) ? deepMerge(out[key], value) : value;
  }
  return out;
}

/**
 * Who may do what, per plan. Enforced where a session is created, not in the UI,
 * because the UI is not a security boundary: the free plan gets one WhatsApp
 * number, Pro two, Enterprise five, and channels are counted the same way.
 */
const TIER_LIMITS = {
  free: { whatsapp: 1, channels: 3 },
  pro: { whatsapp: 2, channels: 8 },
  enterprise: { whatsapp: 5, channels: 20 },
};

/** Plan name to limit row, tolerant of a missing or unknown tier. */
function limitsFor(tier) {
  return TIER_LIMITS[String(tier || 'free').toLowerCase()] || TIER_LIMITS.free;
}

/** Defaults: what the app does before the owner has configured anything. */
const DEFAULTS = {
  [NAGAD]: { wallet: '', holder: '', autoVerify: true, note: '' },
  // Platform-wide switches. These are the "stop" buttons: when something is
  // misbehaving at 3am, the owner turns off AI replies or auto-posting here
  // without touching code, keys or the database.
  [PLATFORM]: {
    aiReplies: true,        // master switch for every automatic reply (WhatsApp + channels)
    autoPosts: true,        // master switch for scheduled channel posts
    whatsappEnabled: true,  // allow new WhatsApp sessions to be created
    channelsEnabled: true,  // allow new channel connections
    signupsOpen: true,      // allow new accounts to register
    paymentsOpen: true,     // allow checkout
    notice: '',             // shown as a banner in every dashboard; empty = hidden
    maxActiveWhatsapp: 6,   // platform-wide ceiling on live WhatsApp browsers (RAM guard)
    channelRepliesPerDay: 200,
    defaultOwnerMuteMinutes: 5,
    limits: TIER_LIMITS,
  },
};

function withDefaults(key, value) {
  const base = DEFAULTS[key] || null;
  if (!base) return value == null ? null : value;
  if (!isPlainObject(value)) return { ...base };
  return deepMerge(base, value);
}

/** Load every row into memory. Called once from startServer(). */
async function hydrate() {
  try {
    const rows = await AppSetting.find({}).lean();
    cache.clear();
    rows.forEach((row) => cache.set(row.key, row.value));
    hydratedAt = new Date();
    lastError = null;
  } catch (err) {
    // Never fail the boot for optional configuration — defaults still serve.
    lastError = String(err.message || err);
  }
  return stats();
}

/** Synchronous read with defaults filled in. */
function get(key) {
  return withDefaults(key, cache.has(key) ? cache.get(key) : null);
}

/** Write + refresh the cache. Returns the stored (merged) value. */
async function set(key, patch, { userId = null, replace = false } = {}) {
  const current = replace ? {} : (cache.has(key) ? cache.get(key) || {} : {});
  const merged = withDefaults(key, deepMerge(current, patch));
  await AppSetting.findOneAndUpdate(
    { key },
    { $set: { value: merged, updatedBy: userId } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  cache.set(key, merged);
  return merged;
}

function stats() {
  return { keys: cache.size, hydratedAt, lastError };
}

/* ───────────────────────── platform control shortcuts ─────────────────── */

/** The whole platform switchboard, defaults filled in. */
const platform = () => get(PLATFORM);

/** One switch, e.g. `flag('aiReplies')`. */
const flag = (name) => Boolean(platform()[name]);

/**
 * The session/channel ceiling for a plan, e.g. `limitFor('pro', 'whatsapp')`.
 *
 * Reads the OWNER'S configured limits first and only falls back to the shipped
 * constants — the admin's number is the one that must be enforced, otherwise the
 * screen would show 3 and the server would still refuse at 1.
 */
function limitFor(tier, kind) {
  const configured = get(PLATFORM) || {};
  const row = configured.limits?.[String(tier || 'free').toLowerCase()] || limitsFor(tier);
  const value = Number(row?.[kind]);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

module.exports = {
  NAGAD, PLATFORM, DEFAULTS, TIER_LIMITS,
  hydrate, get, set, stats,
  platform, flag, limitFor, limitsFor,
};
