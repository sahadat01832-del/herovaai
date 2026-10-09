/**
 * subscriptionService — the only two ways a plan ever changes hands.
 *
 * Both the gateway callbacks (routes/payments.js) and the admin reviewer
 * (routes/admin.js) come through here, so there is exactly one implementation of
 * "this order is paid": flip the tier, the status, the start date and the token
 * allowance together, and stamp who confirmed it.
 *
 * Nothing in here reads the request body directly — the tier comes from the
 * stored order, never from a client.
 */
const User = require('../models/User');
const plans = require('../config/plans');

/** Ensure the nested objects exist before writing into them. */
function ensureShapes(user) {
  if (!user.subscription) user.subscription = {};
  if (!user.tokenQuota) {
    user.tokenQuota = { weeklyLimit: plans.quotaFor('free'), tokensUsed7d: 0, lastResetDate: new Date(), history: [] };
  }
  return user;
}

/**
 * Put a user on a tier. Called for a real payment (paid) or an admin override
 * (also paid, but with verifiedBy 'reviewer' and a note).
 */
async function applyTier(userId, tier, { verifiedBy = 'auto', reviewerId = null, note = '', months = 1 } = {}) {
  const user = await User.findById(userId);
  if (!user) return null;
  ensureShapes(user);

  user.subscription.tier = tier;
  user.subscription.status = 'active';
  user.subscription.startDate = new Date();
  // A paid month ends when it ends: the dashboard can then say "renews on…"
  // instead of pretending the plan is eternal.
  user.subscription.expiresAt = tier === 'free'
    ? null
    : new Date(Date.now() + months * 30 * 24 * 60 * 60 * 1000);
  user.subscription.verifiedBy = verifiedBy;
  if (reviewerId) user.subscription.verifiedByAdmin = reviewerId;
  if (note) user.subscription.lastPaymentNote = note;

  user.tokenQuota.weeklyLimit = plans.quotaFor(tier);
  await user.save();
  return user;
}

/**
 * Mark an order paid and move the user onto its tier.
 * Idempotent: a second call on an already-paid order changes nothing, so a
 * duplicated gateway callback or a double-clicked Approve cannot double-apply.
 */
async function settleOrder(order, { verifiedBy = 'auto', reviewerId = null, note = '', payload = null } = {}) {
  if (!order) return { ok: false, reason: 'missing-order' };
  if (order.status === 'paid') return { ok: true, alreadyPaid: true, order };

  order.status = 'paid';
  order.paidAt = new Date();
  order.verifiedBy = verifiedBy;
  if (reviewerId) {
    order.reviewedBy = reviewerId;
    order.reviewedAt = new Date();
  }
  if (note) order.reviewNote = note;
  if (payload) order.gatewayPayload = payload;
  await order.save();

  const user = await applyTier(order.userId, order.tier, { verifiedBy, reviewerId, note });
  return { ok: true, order, user };
}

/** Record a refusal: no tier change, evidence kept for the paper trail. */
async function rejectOrder(order, { reviewerId = null, note = '', status = 'rejected' } = {}) {
  if (!order) return { ok: false, reason: 'missing-order' };
  if (order.status === 'paid') return { ok: false, reason: 'already-paid' };
  order.status = status;
  order.reviewedBy = reviewerId || null;
  order.reviewedAt = new Date();
  order.reviewNote = note || order.reviewNote || '';
  await order.save();
  return { ok: true, order };
}

module.exports = { applyTier, settleOrder, rejectOrder };
