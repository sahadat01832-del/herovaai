const mongoose = require('mongoose');

const WhatsAppMessageSchema = new mongoose.Schema({
  from: { type: String, required: true },
  to: { type: String, required: true },
  body: { type: String, required: true },
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
  // Last connect/handshake failure, so the UI can say why instead of guessing
  lastError: { type: String, default: null },
  lastErrorAt: { type: Date, default: null },
  // Analytics
  totalMessagesReceived: { type: Number, default: 0 },
  totalMessagesSent: { type: Number, default: 0 },
  messages: [WhatsAppMessageSchema],
  qrCode: { type: String, default: null },
  lastActive: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { timestamps: true });

WhatsAppSessionSchema.index({ userId: 1 });
WhatsAppSessionSchema.index({ status: 1 });

module.exports = mongoose.model('WhatsAppSession', WhatsAppSessionSchema);
