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

/** Defaults: what the app does before the owner has configured anything. */
const DEFAULTS = {
  [NAGAD]: { wallet: '', holder: '', autoVerify: true, note: '' },
};

function withDefaults(key, value) {
  const base = DEFAULTS[key] || null;
  if (!base) return value == null ? null : value;
  if (!value || typeof value !== 'object') return { ...base };
  return { ...base, ...value };
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
  const merged = withDefaults(key, { ...current, ...(patch && typeof patch === 'object' ? patch : {}) });
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

module.exports = { NAGAD, DEFAULTS, hydrate, get, set, stats };
