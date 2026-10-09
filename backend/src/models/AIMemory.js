const mongoose = require('mongoose');

/**
 * One thing the business sells.
 *
 * `kind` separates a physical product from a service so the assistant can talk
 * about them differently ("in stock / sizes" vs "we book you in"), while both
 * live in one list — a shop owner thinks in one list of "what we sell".
 */
const CatalogItemSchema = new mongoose.Schema({
  kind: { type: String, enum: ['product', 'service'], default: 'product' },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  price: { type: String, default: '', trim: true, maxlength: 120 },
  summary: { type: String, default: '', trim: true, maxlength: 300 },
  details: { type: String, default: '', trim: true, maxlength: 4000 },
  available: { type: Boolean, default: true },
}, { _id: true });

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

/** Opening hours, where they deliver, how customers pay — the practical facts. */
const OperationsSchema = new mongoose.Schema({
  openingHours: { type: String, default: '', trim: true, maxlength: 600 },
  serviceAreas: { type: String, default: '', trim: true, maxlength: 600 },
  delivery: { type: String, default: '', trim: true, maxlength: 600 },
  payment: { type: String, default: '', trim: true, maxlength: 600 },
  address: { type: String, default: '', trim: true, maxlength: 400 },
  phone: { type: String, default: '', trim: true, maxlength: 80 },
  email: { type: String, default: '', trim: true, maxlength: 160 },
  website: { type: String, default: '', trim: true, maxlength: 300 },
  bookingLink: { type: String, default: '', trim: true, maxlength: 300 },
}, { _id: false });

const AIMemorySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },

  /**
   * Business memory is optional. When this is false the assistant answers from
   * the generic system prompt only — the owner can pause personalisation
   * without losing anything they typed.
   */
  enabled: { type: Boolean, default: true },

  // ── Who they are ────────────────────────────────────────────────────────
  ownerName: { type: String, default: '', trim: true, maxlength: 120 },
  ownerRole: { type: String, default: '', trim: true, maxlength: 80 },
  businessName: { type: String, default: '', trim: true, maxlength: 160 },
  businessType: { type: String, default: '', trim: true, maxlength: 160 },
  businessDescription: { type: String, default: '', trim: true, maxlength: 4000 },

  // ── What they sell ──────────────────────────────────────────────────────
  catalog: { type: [CatalogItemSchema], default: [] },

  // ── How the business runs ───────────────────────────────────────────────
  operations: { type: OperationsSchema, default: () => ({}) },

  // ── Ground rules ────────────────────────────────────────────────────────
  policies: { type: String, default: '', trim: true, maxlength: 4000 },
  guardrails: { type: String, default: '', trim: true, maxlength: 4000 },
  escalationContact: { type: String, default: '', trim: true, maxlength: 200 },

  // ── Voice ───────────────────────────────────────────────────────────────
  greeting: { type: String, default: '', trim: true, maxlength: 600 },
  signoff: { type: String, default: '', trim: true, maxlength: 300 },
  replyLength: { type: String, enum: ['short', 'balanced', 'detailed'], default: 'balanced' },
  tone: { 
    type: String, 
    enum: ['professional', 'friendly', 'casual', 'formal', 'enthusiastic'],
    default: 'professional'
  },
  language: { type: String, default: 'English', trim: true, maxlength: 80 },

  entries: [MemoryEntrySchema],

  // Generated system prompt from memory
  generatedSystemPrompt: { type: String, default: '' },
  updatedAt: { type: Date, default: Date.now },
}, { timestamps: true });

AIMemorySchema.pre('save', function touchUpdatedAt(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('AIMemory', AIMemorySchema);
