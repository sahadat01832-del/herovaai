const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const User = require('../models/User');
const PaymentOrder = require('../models/PaymentOrder');
const ssl = require('../services/sslcommerz');
const nagad = require('../services/nagad');
const plans = require('../config/plans');
const subs = require('../services/subscriptionService');

/**
 * Payments — three plans, priced in taka.
 *
 *   free ৳0 · pro ৳100/month · enterprise ৳300/month
 *
 * The browser never names an amount or a tier it may buy: the tier comes from
 * the request, the price comes from config/plans.js, and the plan only moves
 * when the money is confirmed — by the gateway (SSLCommerz, or Nagad with
 * merchant keys) or by a reviewer checking the Nagad TrxID.
 */

/** Where the buyer lands after a gateway. Same origin as the request. */
function frontendBase(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  if (!host) return (process.env.FRONTEND_URL || 'http://localhost:3001').replace(/\/+$/, '');
  return `${proto}://${host}`.replace(/\/+$/, '');
}

/** Absolute URL of this API, so a gateway can call home from anywhere. */
function apiBase() {
  return (process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 5000}`).replace(/\/+$/, '');
}

const newTranId = (prefix = 'HV') =>
  `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`.toUpperCase();

const paidTier = (tier) => plans.isPaidTier(tier);

/* ────────────────────────────── plan table ─────────────────────────────── */

// Public: the marketing page and the dashboard both render this, and it holds
// nothing private (no keys, no merchant numbers). Nagad's wallet number is
// deliberately not here — see /nagad/config, which is for signed-in owners.
router.get('/plans', (_req, res) => {
  res.json({
    success: true,
    currency: plans.CURRENCY,
    plans: plans.publicPlans(),
    gateways: {
      nagad: nagad.mode().manual ? 'available' : 'unconfigured',
      nagadAuto: nagad.autoReady(),
      sslcommerz: ssl.configured() ? (ssl.isSandbox() ? 'sandbox' : 'live') : 'unconfigured',
    },
  });
});

/* ──────────────────────────── Nagad (taka) ─────────────────────────────── */

/** What the checkout needs: the wallet to pay, the amounts, and auto-or-manual. */
router.get('/nagad/config', authenticate, (_req, res) => {
  const m = nagad.mode();
  res.json({
    success: true,
    auto: m.auto,
    manual: m.manual,
    wallet: m.wallet,
    holder: m.holder,
    reason: m.reason,
    currency: plans.CURRENCY,
    plans: plans.publicPlans().filter((p) => p.bdt > 0).map((p) => ({ id: p.id, name: p.name, amount: p.bdt })),
  });
});

/**
 * Open a Nagad order. With merchant keys this returns a redirect URL (Nagad's
 * gateway page); without them the buyer is told where to send the money and the
 * order waits for the TrxID.
 */
router.post('/nagad/order', authenticate, async (req, res) => {
  try {
    const tier = String(req.body?.tier || '').trim();
    if (!paidTier(tier)) {
      return res.status(400).json({ success: false, message: 'Choose the Pro or Enterprise plan to pay.' });
    }
    const m = nagad.mode();
    if (!m.manual && !m.auto) {
      return res.status(503).json({ success: false, message: 'Nagad is not switched on for this app yet.' });
    }

    const amount = plans.priceFor(tier);
    const tranId = newTranId('NGD');
    const order = await PaymentOrder.create({
      tranId,
      userId: req.user._id,
      tier,
      amount,
      currency: plans.CURRENCY,
      gateway: 'nagad',
      status: 'pending',
    });

    if (m.auto) {
      try {
        const { redirectUrl, paymentRefId } = await nagad.createCheckout({
          orderId: tranId,
          amount,
          callbackUrl: `${apiBase()}/api/payments/nagad/callback`,
        });
        order.paymentRefId = paymentRefId;
        await order.save();
        return res.json({ success: true, mode: 'auto', tranId, amount, currency: plans.CURRENCY, url: redirectUrl });
      } catch (err) {
        // A merchant outage must not dead-end the buyer: fall back to the
        // send-money flow, which always works, and say so in the response.
        order.gatewayPayload = { autoFailed: String(err.message || '').slice(0, 300) };
        await order.save();
        if (!m.manual) {
          return res.status(err.status || 502).json({ success: false, message: err.message });
        }
      }
    }

    res.json({
      success: true,
      mode: 'manual',
      tranId,
      amount,
      currency: plans.CURRENCY,
      wallet: m.wallet,
      holder: m.holder,
      reason: m.reason,
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

/**
 * The buyer says the money left. The TrxID + sender number are stored exactly as
 * normalised, then either Nagad's API confirms it (auto mode) or the order parks
 * in `awaiting_review` for a human. A TrxID already used on any order is refused.
 */
router.post('/nagad/submit', authenticate, async (req, res) => {
  try {
    const tranId = String(req.body?.tranId || '').trim();
    const order = await PaymentOrder.findOne({ tranId, userId: req.user._id });
    if (!order) return res.status(404).json({ success: false, message: 'That order is not yours (or does not exist).' });
    if (order.status === 'paid') {
      return res.json({ success: true, status: 'paid', message: 'This order is already paid — your plan is active.' });
    }
    if (['cancelled', 'expired'].includes(order.status)) {
      return res.status(409).json({ success: false, message: 'That order is closed — start a new payment.' });
    }

    const check = nagad.validateEvidence({ trxId: req.body?.trxId, senderNumber: req.body?.senderNumber });
    if (!check.ok) return res.status(400).json({ success: false, message: check.message });

    // One TrxID pays for one order: an agent cannot resell a screenshot.
    const clash = await PaymentOrder.findOne({
      nagadTrxId: check.trxId,
      _id: { $ne: order._id },
      status: { $in: ['awaiting_review', 'paid'] },
    });
    if (clash) {
      return res.status(409).json({
        success: false,
        message: 'That TrxID is already recorded on another order. Check the number and paste the newest one.',
      });
    }

    order.nagadTrxId = check.trxId;
    order.senderNumber = check.senderNumber;
    order.submittedAt = new Date();

    if (nagad.autoReady()) {
      try {
        const v = await nagad.verifyPayment({ paymentRefId: order.paymentRefId, orderId: order.tranId });
        order.gatewayPayload = v.raw || null;
        if (v.ok && (v.amount == null || v.amount === Number(order.amount))) {
          await order.save();
          await subs.settleOrder(order, { verifiedBy: 'auto', payload: v.raw || null });
          return res.json({ success: true, status: 'paid', message: 'Nagad confirmed the payment — your plan is on.' });
        }
        if (v.ok) {
          // Nagad says paid, but for a different amount: never auto-apply.
          order.status = 'awaiting_review';
          order.reviewNote = `Nagad reported ৳${v.amount} for an order of ৳${order.amount}`;
          await order.save();
          return res.json({
            success: true,
            status: 'awaiting_review',
            message: 'The amount Nagad reported differs from this plan — a person will check it shortly.',
          });
        }
      } catch (err) {
        order.reviewNote = `Auto check failed: ${String(err.message || '').slice(0, 200)}`;
      }
    }

    order.status = 'awaiting_review';
    await order.save();
    res.json({
      success: true,
      status: 'awaiting_review',
      message: 'TrxID recorded. We verify it against the Nagad statement and switch your plan on — usually within a few minutes.',
      order: { tranId: order.tranId, amount: order.amount, status: order.status, nagadTrxId: order.nagadTrxId },
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

/** Nagad posts the result here after the buyer finishes on the gateway page. */
router.post('/nagad/callback', async (req, res) => {
  const back = `${frontendBase(req)}/dashboard/subscription`;
  const body = req.body || {};
  const status = String(body.status || '').toLowerCase();
  const ref = String(body.payment_ref_id || body.paymentRefId || '').trim();
  try {
    const order = ref
      ? await PaymentOrder.findOne({ paymentRefId: ref, gateway: 'nagad' })
      : await PaymentOrder.findOne({ tranId: String(body.order_id || '').trim(), gateway: 'nagad' });
    if (!order) return res.redirect(`${back}?payment=invalid`);
    if (order.status === 'paid') return res.redirect(`${back}?payment=success`);

    if (status === 'success' || status === 'successful') {
      const v = await nagad.verifyPayment({ paymentRefId: order.paymentRefId, orderId: order.tranId }).catch(() => ({ ok: false }));
      if (v.ok && (v.amount == null || v.amount === Number(order.amount))) {
        await subs.settleOrder(order, { verifiedBy: 'auto', payload: v.raw || body });
        return res.redirect(`${back}?payment=success`);
      }
      order.status = 'awaiting_review';
      order.reviewNote = `Gateway reported success but verification said "${v.status || 'unknown'}"`;
      order.gatewayPayload = v.raw || body;
      await order.save();
      return res.redirect(`${back}?payment=review`);
    }

    if (['cancelled', 'canceled', 'aborted'].includes(status)) {
      order.status = 'cancelled';
      order.gatewayPayload = body;
      await order.save();
      return res.redirect(`${back}?payment=cancelled`);
    }

    order.status = 'failed';
    order.gatewayPayload = body;
    await order.save();
    return res.redirect(`${back}?payment=failed`);
  } catch (_e) {
    return res.redirect(`${back}?payment=error`);
  }
});

/** Ask Nagad again about a waiting order (owner-side "check now"). */
router.post('/nagad/verify/:tranId', authenticate, async (req, res) => {
  try {
    const order = await PaymentOrder.findOne({ tranId: String(req.params.tranId || '').trim(), userId: req.user._id });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.status === 'paid') return res.json({ success: true, status: 'paid', message: 'Already paid.' });
    if (!nagad.autoReady()) {
      return res.json({
        success: true,
        status: order.status,
        auto: false,
        message: 'Automatic checking needs the Nagad merchant keys — a person verifies this one.',
      });
    }
    const v = await nagad.verifyPayment({ paymentRefId: order.paymentRefId, orderId: order.tranId });
    if (v.ok && (v.amount == null || v.amount === Number(order.amount))) {
      await subs.settleOrder(order, { verifiedBy: 'auto', payload: v.raw || null });
      return res.json({ success: true, status: 'paid', auto: true, message: 'Nagad confirmed the payment — your plan is on.' });
    }
    res.json({ success: true, status: order.status, auto: true, nagad: v.status, message: 'Nagad has not confirmed this payment yet.' });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

/* ─────────────────────────── SSLCommerz (cards) ────────────────────────── */

router.post('/init', authenticate, async (req, res) => {
  try {
    const { tier } = req.body || {};
    if (!paidTier(tier)) {
      return res.status(400).json({ success: false, message: 'Only Pro and Enterprise check out — Free needs no payment.' });
    }
    if (!ssl.configured()) {
      return res.status(503).json({ success: false, message: 'Card payments are not switched on yet — ask the owner' });
    }
    const amount = plans.priceFor(tier);
    const tranId = newTranId('HV');
    const user = await User.findById(req.user._id);
    const { GatewayPageURL } = await ssl.initPayment({
      tranId,
      amount,
      currency: plans.CURRENCY,
      customer: { name: user.name, email: user.email, phone: user.phone },
      productName: `HerovaAi ${plans.plan(tier).name} (monthly)`,
    });
    await PaymentOrder.create({
      tranId, userId: user._id, tier, amount, currency: plans.CURRENCY, gateway: 'sslcommerz', status: 'pending',
    });
    res.json({ success: true, url: GatewayPageURL, tranId, amount, currency: plans.CURRENCY });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

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
        await subs.settleOrder(order, { verifiedBy: 'auto', payload: v.data });
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

/* ─────────────────────────────── receipts ─────────────────────────────── */

/** One order — owner of the order, or admin. */
router.get('/status/:tranId', authenticate, async (req, res) => {
  const order = await PaymentOrder.findOne({ tranId: String(req.params.tranId || '').trim() });
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
  if (String(order.userId) !== String(req.user._id) && req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Not your order' });
  }
  res.json({ success: true, order: shape(order) });
});

/** The owner's own payment history, newest first. */
router.get('/orders', authenticate, async (req, res) => {
  const orders = await PaymentOrder.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(20);
  res.json({ success: true, orders: orders.map(shape) });
});

function shape(order) {
  return {
    tranId: order.tranId,
    tier: order.tier,
    amount: order.amount,
    currency: order.currency,
    gateway: order.gateway,
    status: order.status,
    nagadTrxId: order.nagadTrxId,
    senderNumber: order.senderNumber,
    verifiedBy: order.verifiedBy,
    reviewNote: order.reviewNote,
    createdAt: order.createdAt,
    paidAt: order.paidAt,
  };
}

module.exports = router;
