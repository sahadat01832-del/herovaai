const mongoose = require('mongoose');

// One row per checkout attempt. The tier changes ONLY when a validated
// gateway callback (or IPN) marks an order paid — never from user input.
const PaymentOrderSchema = new mongoose.Schema({
  tranId: { type: String, required: true, unique: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  tier: { type: String, enum: ['pro', 'enterprise'], required: true },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'USD' },
  gateway: { type: String, default: 'sslcommerz' },
  status: {
    type: String,
    enum: ['pending', 'paid', 'failed', 'cancelled', 'expired'],
    default: 'pending',
    index: true,
  },
  gatewayPayload: { type: mongoose.Schema.Types.Mixed, default: null },
  paidAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.models.PaymentOrder || mongoose.model('PaymentOrder', PaymentOrderSchema);
