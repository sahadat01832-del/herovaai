const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const User = require('../models/User');
const PaymentOrder = require('../models/PaymentOrder');
const ssl = require('../services/sslcommerz');

const QUOTA_BY_TIER = { free: 1000000, pro: 2000000, enterprise: 5000000 };

/** Where the buyer lands after the gateway. Same origin as the request. */
function frontendBase(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  if (!host) return (process.env.FRONTEND_URL || 'http://localhost:3001').replace(/\/+$/, '');
  return `${proto}://${host}`.replace(/\/+$/, '');
}

async function applyPaidTier(userId, tier) {
  const user = await User.findById(userId);
  if (!user) return null;
  if (!user.subscription) user.subscription = {};
  user.subscription.tier = tier;
  user.subscription.status = 'active';
  user.subscription.startDate = new Date();
  if (!user.tokenQuota) {
    user.tokenQuota = { weeklyLimit: 1000000, tokensUsed7d: 0, lastResetDate: new Date(), history: [] };
  }
  user.tokenQuota.weeklyLimit = QUOTA_BY_TIER[tier] || QUOTA_BY_TIER.free;
  await user.save();
  return user;
}

// ─── Start checkout ─────────────────────────────────────────────────────────
router.post('/init', authenticate, async (req, res) => {
  try {
    const { tier } = req.body || {};
    if (!['pro', 'enterprise'].includes(tier)) {
      return res.status(400).json({ success: false, message: 'Only pro/enterprise check out (free needs no payment)' });
    }
    if (!ssl.configured()) {
      return res.status(503).json({ success: false, message: 'Card payments are not switched on yet — ask the owner' });
    }
    const amount = ssl.priceFor(tier);
    const tranId = `HV_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`.toUpperCase();
    const user = await User.findById(req.user._id);
    const { GatewayPageURL } = await ssl.initPayment({
      tranId,
      amount,
      currency: 'USD',
      customer: { name: user.name, email: user.email, phone: user.phone },
      productName: `HerovaAi ${tier} (monthly)`,
    });
    await PaymentOrder.create({
      tranId, userId: user._id, tier, amount, currency: 'USD', status: 'pending',
    });
    res.json({ success: true, url: GatewayPageURL, tranId, amount });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

// ─── Gateway callbacks (public: the gateway has no token; validation decides) ──
// success carries val_id; only a server-to-server VALID + matching tran_id +
// matching amount flips the tier. fail/cancel just record the outcome.
async function settleFromCallback(req, res, kind) {
  const b = req.body || {};
  const tranId = String(b.tran_id || '').trim();
  const valId = String(b.val_id || '').trim();
  const back = `${frontendBase(req)}/dashboard/subscription`;
  try {
    const order = tranId ? await PaymentOrder.findOne({ tranId }) : null;
    if (!order || order.status !== 'pending') {
      return res.redirect(`${back}?payment=${order && order.status === 'paid' ? 'success' : 'invalid'}`);
    }
    if (kind === 'success' && valId) {
      const v = await ssl.validatePayment({ tranId: valId, amount: order.amount, currency: order.currency });
      const tranMatch = !v.data?.tran_id || String(v.data.tran_id).toUpperCase() === order.tranId.toUpperCase();
      if (v.ok && tranMatch) {
        order.status = 'paid';
        order.paidAt = new Date();
        order.gatewayPayload = v.data;
        await order.save();
        await applyPaidTier(order.userId, order.tier);
        return res.redirect(`${back}?payment=success`);
      }
      order.status = 'failed';
      order.gatewayPayload = v.data || b;
      await order.save();
      return res.redirect(`${back}?payment=failed`);
    }
    order.status = kind === 'cancel' ? 'cancelled' : 'failed';
    order.gatewayPayload = b;
    await order.save();
    return res.redirect(`${back}?payment=${order.status}`);
  } catch (_e) {
    return res.redirect(`${back}?payment=error`);
  }
}

router.post('/callback/success', express.urlencoded({ extended: true }), (req, res) => settleFromCallback(req, res, 'success'));
router.post('/callback/fail', express.urlencoded({ extended: true }), (req, res) => settleFromCallback(req, res, 'fail'));
router.post('/callback/cancel', express.urlencoded({ extended: true }), (req, res) => settleFromCallback(req, res, 'cancel'));

// ─── Order status (owner of the order, or admin) ────────────────────────────
router.get('/status/:tranId', authenticate, async (req, res) => {
  const order = await PaymentOrder.findOne({ tranId: String(req.params.tranId || '').trim() });
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
  if (String(order.userId) !== String(req.user._id) && req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Not your order' });
  }
  res.json({ success: true, order: { tranId: order.tranId, tier: order.tier, amount: order.amount, status: order.status, paidAt: order.paidAt } });
});

module.exports = router;
