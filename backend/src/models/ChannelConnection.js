const mongoose = require('mongoose');

/**
 * ChannelConnection — one account per platform, per owner.
 *
 * Facebook, Messenger, Instagram, Telegram, YouTube, a generic webhook, and the
 * WhatsApp session that already has its own model. Credentials live in
 * `credentials` and are NEVER serialised: toJSON swaps every value for a
 * `configured` map, so an owner's page token cannot leak through a list call,
 * an error message or a screenshot of the API.
 *
 * `automations` is the promise the product makes — "post every day at 9",
 * "answer customers automatically" — and `activity` is the receipt: the last
 * few things that actually happened, good or bad, so nothing is silent.
 */
const ActivitySchema = new mongoose.Schema({
  at: { type: Date, default: Date.now },
  kind: { type: String, default: 'info' }, // test | post | reply | inbound | error | setup
  ok: { type: Boolean, default: true },
  message: { type: String, default: '' },
}, { _id: false });

const ChannelConnectionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  channel: { type: String, required: true, index: true },
  label: { type: String, default: '', trim: true },

  // Field-level credentials (page token, bot token, webhook URL…). Mixed on
  // purpose: every channel asks for a different set, and the registry is the
  // single source of truth for which keys are valid.
  credentials: { type: mongoose.Schema.Types.Mixed, default: {} },
  // Public configuration that is safe to show (page id, chat id, webhook secret
  // is NOT here — it lives with the credentials).
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },

  status: {
    type: String,
    enum: ['not_configured', 'connected', 'error'],
    default: 'not_configured',
    index: true,
  },

  automations: {
    autoReply: { type: Boolean, default: false },
    autoPost: { type: Boolean, default: false },
    autoPostTime: { type: String, default: '09:00' }, // local server time, HH:MM
    postTopic: { type: String, default: '', trim: true },
    replyNote: { type: String, default: '', trim: true }, // extra instruction for replies
  },

  stats: {
    postsSent: { type: Number, default: 0 },
    repliesSent: { type: Number, default: 0 },
    repliesToday: { type: Number, default: 0 },
    repliesDay: { type: String, default: '' }, // YYYY-MM-DD that repliesToday counts
    lastPostAt: { type: Date, default: null },
    lastReplyAt: { type: Date, default: null },
    lastInboundAt: { type: Date, default: null },
  },

  lastTest: {
    at: { type: Date, default: null },
    ok: { type: Boolean, default: null },
    message: { type: String, default: '' },
  },
  lastError: { type: String, default: '' },

  activity: { type: [ActivitySchema], default: [] },
}, { timestamps: true });

// One connection per platform per owner: reconnecting a page replaces it
// instead of silently creating a second, half-configured one.
ChannelConnectionSchema.index({ userId: 1, channel: 1 }, { unique: true });
ChannelConnectionSchema.index({ 'automations.autoPost': 1, 'automations.autoReply': 1 });

/** Keep only the newest 25 activity rows — this is a receipt, not a log sink. */
ChannelConnectionSchema.methods.pushActivity = function pushActivity(kind, ok, message) {
  this.activity = [...(this.activity || []), { at: new Date(), kind, ok, message: String(message || '').slice(0, 400) }].slice(-25);
};

/** Credentials must never leave the server. */
ChannelConnectionSchema.methods.toJSON = function toJSON() {
  const obj = this.toObject({ virtuals: false });
  const credentials = obj.credentials || {};
  obj.configured = Object.keys(credentials).reduce((acc, key) => {
    acc[key] = Boolean(String(credentials[key] ?? '').trim());
    return acc;
  }, {});
  delete obj.credentials;
  return obj;
};

module.exports = mongoose.models.ChannelConnection || mongoose.model('ChannelConnection', ChannelConnectionSchema);
