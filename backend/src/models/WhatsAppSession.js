const mongoose = require('mongoose');

const WhatsAppMessageSchema = new mongoose.Schema({
  from: { type: String, required: true },
  to: { type: String, required: true },
  body: { type: String, required: true },
  mediaUrl: { type: String, default: null },
  direction: { type: String, enum: ['incoming', 'outgoing'], required: true },
  status: { type: String, enum: ['pending', 'sent', 'delivered', 'read', 'failed'], default: 'pending' },
  aiGenerated: { type: Boolean, default: false },
  // Which tier/model actually produced an AI reply. Admin-only: it is never sent to the
  // customer and is omitted from the owner's message view.
  aiModel: { type: String, default: '' },
  timestamp: { type: Date, default: Date.now },
});

const WhatsAppSessionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  sessionName: { type: String, required: true },
  phoneNumber: { type: String, default: '' },
  status: { 
    type: String, 
    enum: ['disconnected', 'qr_pending', 'connected', 'error'],
    default: 'disconnected'
  },
  // AI Settings
  autoReply: { type: Boolean, default: false },
  autoReplyMode: { type: String, enum: ['always', 'when_away', 'never'], default: 'never' },
  useMemory: { type: Boolean, default: true },
  customPrompt: { type: String, default: '' },
  tone: { type: String, default: '' },
  // ── Single-speaker rule: when the owner steps into a conversation the AI
  // goes silent there and auto-resumes after ownerMuteMinutes of owner silence.
  // One mute per customer (phone number); absolute `until` timestamps mean
  // expiry needs no scheduler — each incoming message just checks the clock.
  aiMutes: [{
    customer: { type: String, required: true },
    until: { type: Date, required: true },
    reason: { type: String, enum: ['owner_reply', 'handoff_request', 'manual'], default: 'owner_reply' },
    createdAt: { type: Date, default: Date.now },
  }],
  ownerMuteMinutes: { type: Number, default: 5 },
  // Deterministic reply when a customer asks for the real owner. Empty = let
  // the AI model handle the handoff (ack still tracked the same way).
  handoffMessage: { type: String, default: '' },
  // Last connect/handshake failure, so the UI can say why instead of guessing
  lastError: { type: String, default: null },
  lastErrorAt: { type: Date, default: null },
  // Place in the launch queue while the host is at its browser ceiling. Null unless
  // this session is waiting for a slot; it starts by itself when one frees.
  queuePosition: { type: Number, default: null },
  // Analytics
  totalMessagesReceived: { type: Number, default: 0 },
  totalMessagesSent: { type: Number, default: 0 },
  messages: [WhatsAppMessageSchema],
  qrCode: { type: String, default: null },
  // One-time "Link with phone number" pairing code (8 chars) and when it was
  // minted, as an alternative to scanning the QR. Null unless a code was asked
  // for; the phone enters it under Settings → Linked Devices → Link a Device.
  pairingCode: { type: String, default: null },
  pairingCodeAt: { type: Date, default: null },
  lastActive: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { timestamps: true });

// Embedded history, bounded. Left unbounded it marches toward Mongo's 16 MB
// document cap (writes start failing, messages silently stop being recorded) and
// every owner/admin read loads a whole archive. Totals live in the counters
// above, so only the oldest of the recent thread is dropped.
const MESSAGE_HISTORY_LIMIT = 500;
WhatsAppSessionSchema.pre('save', function limitMessageHistory(next) {
  if (this.isModified('messages') && this.messages.length > MESSAGE_HISTORY_LIMIT) {
    this.messages = this.messages.slice(-MESSAGE_HISTORY_LIMIT);
  }
  next();
});

WhatsAppSessionSchema.index({ userId: 1 });
WhatsAppSessionSchema.index({ status: 1 });

module.exports = mongoose.model('WhatsAppSession', WhatsAppSessionSchema);
