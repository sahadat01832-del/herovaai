const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, select: false },
  phone: { type: String, trim: true },
  role: { type: String, enum: ['admin', 'user'], default: 'user' },
  avatar: { type: String, default: null },
  isActive: { type: Boolean, default: true },
  googleId: { type: String, default: null },
  // ContentBot API Key (assigned by admin)
  contentbotApiKey: { type: String, default: null },
  // Business info for AI memory
  businessInfo: {
    name: { type: String, default: '' },
    industry: { type: String, default: '' },
    description: { type: String, default: '' },
    website: { type: String, default: '' },
    contactEmail: { type: String, default: '' },
  },
  // Chat settings
  chatSettings: {
    model: { type: String, default: 'local' }, // 'local' | 'contentbot' | 'api'
    temperature: { type: Number, default: 0.7 },
    systemPrompt: { type: String, default: '' },
  },
  // Subscription Tier
  subscription: {
    tier: { type: String, enum: ['free', 'pro', 'enterprise'], default: 'free' },
    status: { type: String, enum: ['active', 'cancelled', 'expired'], default: 'active' },
    startDate: { type: Date, default: Date.now },
    expiresAt: { type: Date, default: null },
  },
  // Token Quota (1M tokens per 7 days limit)
  tokenQuota: {
    weeklyLimit: { type: Number, default: 1000000 }, // 1 Million tokens per 7 days
    tokensUsed7d: { type: Number, default: 0 },
    lastResetDate: { type: Date, default: Date.now },
    history: [{
      date: { type: Date, default: Date.now },
      tokens: { type: Number, default: 0 },
      model: { type: String, default: '' },
    }],
  },
  lastSeen: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { timestamps: true });

// Index for fast lookups
UserSchema.index({ role: 1 });
UserSchema.index({ createdAt: -1 });

/**
 * Secrets never leave the API.
 *
 * `contentbotApiKey` used to travel in every login/`/me`/admin payload and land in
 * localStorage, so any XSS or screen-share leaked a live key. Serialisation now swaps it for a
 * masked preview plus a boolean, and the raw value is only reachable by the server-side callers
 * that read the document itself (chat.js sends it upstream).
 */
UserSchema.methods.toJSON = function toJSON() {
  const obj = this.toObject({ virtuals: false });
  const raw = String(obj.contentbotApiKey || '').trim();
  obj.hasContentbotApiKey = Boolean(raw);
  obj.contentbotApiKeyMasked = raw
    ? (raw.length <= 12 ? '•'.repeat(raw.length) : `${raw.slice(0, 6)}…${raw.slice(-4)}`)
    : '';
  delete obj.contentbotApiKey;
  delete obj.password;
  return obj;
};

module.exports = mongoose.model('User', UserSchema);
