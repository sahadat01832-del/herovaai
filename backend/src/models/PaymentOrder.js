const mongoose = require('mongoose');

// One row per checkout attempt. The tier changes ONLY when a validated
// gateway callback (or IPN) marks an order paid — never from user input.
//
// Nagad has two ways in, and both land here:
//   • auto    — the buyer pays through Nagad's Payment Gateway and the server
//               confirms it with Nagad's verify API (`gateway: 'nagad'`).
//   • manual  — the buyer sends money to the owner's Nagad number and records
//               the TrxID from the SMS. Nagad publishes no API for personal
//               (send-money) accounts, so the order parks in `awaiting_review`
//               until the owner/admin approves it.
const PaymentOrderSchema = new mongoose.Schema({
  tranId: { type: String, required: true, unique: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  tier: { type: String, enum: ['pro', 'enterprise'], required: true },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'BDT' },
  gateway: { type: String, enum: ['sslcommerz', 'nagad'], default: 'sslcommerz', index: true },
  status: {
    type: String,
    // `awaiting_review` = buyer says the money left, nobody has confirmed it yet.
    enum: ['pending', 'awaiting_review', 'paid', 'failed', 'cancelled', 'expired', 'rejected'],
    default: 'pending',
    index: true,
  },
  gatewayPayload: { type: mongoose.Schema.Types.Mixed, default: null },

  // ─── Nagad send-money evidence, typed by the buyer ───────────────────────
  nagadTrxId: { type: String, default: null, trim: true },
  senderNumber: { type: String, default: null, trim: true },
  submittedAt: { type: Date, default: null },
  // Filled only on the automatic path (Nagad's own payment reference).
  paymentRefId: { type: String, default: null },

  // ─── Who said the money was real, and when ──────────────────────────────
  verifiedBy: { type: String, enum: ['auto', 'reviewer', null], default: null },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedAt: { type: Date, default: null },
  reviewNote: { type: String, default: '' },
  paidAt: { type: Date, default: null },
}, { timestamps: true });

PaymentOrderSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.models.PaymentOrder || mongoose.model('PaymentOrder', PaymentOrderSchema);
