const mongoose = require('mongoose');

const MemoryEntrySchema = new mongoose.Schema({
  key: { type: String, required: true },
  value: { type: String, required: true },
  category: { 
    type: String, 
    enum: ['business', 'product', 'customer', 'preference', 'fact', 'other'],
    default: 'other'
  },
  createdAt: { type: Date, default: Date.now },
});

const AIMemorySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  ownerName: { type: String, default: '' },
  businessName: { type: String, default: '' },
  businessType: { type: String, default: '' },
  businessDescription: { type: String, default: '' },
  tone: { 
    type: String, 
    enum: ['professional', 'friendly', 'casual', 'formal', 'enthusiastic'],
    default: 'professional'
  },
  language: { type: String, default: 'English' },
  entries: [MemoryEntrySchema],
  // Generated system prompt from memory
  generatedSystemPrompt: { type: String, default: '' },
  updatedAt: { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model('AIMemory', AIMemorySchema);
