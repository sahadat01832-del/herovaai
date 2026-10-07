const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
  content: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  tokens: { type: Number, default: 0 },
  model: { type: String, default: 'unknown' },
  attachments: [{
    name: { type: String, default: '' },
    mimeType: { type: String, default: '' },
    data: { type: String, default: '' }, // Base64 representation or URL
    size: { type: Number, default: 0 },
  }],
  artifacts: [{
    title: { type: String, default: 'Artifact' },
    type: { type: String, default: 'html' }, // 'html' | 'game' | 'react' | 'code' | 'svg'
    code: { type: String, default: '' },
    language: { type: String, default: 'html' },
  }],
});

const ConversationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false },
  isPublic: { type: Boolean, default: false },
  title: { type: String, default: 'New Chat' },
  messages: [MessageSchema],
  mode: { type: String, enum: ['local', 'contentbot', 'api'], default: 'local' },
  skill: { type: String, default: 'general' }, // 'general' | 'game' | 'webapp' | 'program' | 'visualizer'
  model: { type: String, default: '' },
  isArchived: { type: Boolean, default: false },
  totalTokens: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { timestamps: true });

ConversationSchema.index({ userId: 1, createdAt: -1 });
ConversationSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Conversation', ConversationSchema);
