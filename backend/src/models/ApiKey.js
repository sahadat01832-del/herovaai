const mongoose = require('mongoose');

/**
 * A provider API key saved at runtime by an admin.
 *
 * `envName` is deliberate: the vault treats a saved key as a *better* value for the same slot
 * that backend/.env would fill (GEMINI_API_KEY_3, GROQ_API_KEY, …). That keeps one naming
 * scheme for both sources, so a key can be rotated from the dashboard without touching the
 * file and the .env value still acts as the fallback.
 *
 * The raw value is `select: false` — it is never returned by a list query, so a careless
 * `res.json({ keys })` cannot leak it.
 */
const ApiKeySchema = new mongoose.Schema({
  provider: { type: String, required: true, index: true },
  envName: { type: String, required: true, index: true },
  label: { type: String, default: '' },
  value: { type: String, required: true, select: false },
  enabled: { type: Boolean, default: true },
  addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  lastTestedAt: { type: Date, default: null },
  lastTestStatus: { type: String, enum: ['ok', 'failed', 'unknown'], default: 'unknown' },
  lastTestMessage: { type: String, default: '' },
  lastTestLatencyMs: { type: Number, default: null },
}, { timestamps: true });

ApiKeySchema.index({ provider: 1, envName: 1 });

module.exports = mongoose.model('ApiKey', ApiKeySchema);
