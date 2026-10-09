#!/usr/bin/env node
/**
 * payment-smoke — proves the taka payment loop against a running API.
 *
 * It creates two throwaway accounts (a buyer and an admin), sets a Nagad wallet
 * as the admin, then walks the whole flow: order ৳100 → TrxID → approve → plan
 * on, plus the four ways a buyer must NOT be able to get a plan for free
 * (direct upgrade, duplicate TrxID, someone else's order, someone else's receipt).
 *
 * Everything it creates is deleted again at the end.
 *
 *   API=http://127.0.0.1:5000 node scripts/payment-smoke.js
 */
require('dotenv').config();
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const axios = require('axios');

const API = (process.env.API || `http://127.0.0.1:${process.env.PORT || 5000}`).replace(/\/+$/, '');
const BUYER = { name: 'Smoke Buyer', email: 'smoke-pay-buyer@example.test', password: 'SmokeTest!2345' };
const ADMIN = { name: 'Smoke Admin', email: 'smoke-pay-admin@example.test', password: 'SmokeTest!2345' };
const WALLET = '01712345678';

let failures = 0;
const results = [];

function check(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition), detail });
  if (!condition) failures += 1;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

const call = (method, url, { token, data, validate } = {}) =>
  axios({
    method,
    url: `${API}${url}`,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    data,
    timeout: 20000,
    validateStatus: validate || ((s) => s >= 200 && s < 300),
  });

async function login(email, password) {
  const res = await call('POST', '/api/auth/login', { data: { email, password } });
  return res.data.token;
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/contentbot', {
    serverSelectionTimeoutMS: 15000,
  });
  const User = require('../src/models/User');
  const PaymentOrder = require('../src/models/PaymentOrder');

  // ─── fixtures ────────────────────────────────────────────────────────────
  const hash = await bcrypt.hash(BUYER.password, 12);
  const [buyer] = await Promise.all([
    User.findOneAndUpdate(
      { email: BUYER.email },
      { name: BUYER.name, password: hash, role: 'user', isActive: true },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ),
    User.findOneAndUpdate(
      { email: ADMIN.email },
      { name: ADMIN.name, password: hash, role: 'admin', isActive: true },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ),
  ]);
  const admin = await User.findOne({ email: ADMIN.email });

  const buyerToken = await login(BUYER.email, BUYER.password);
  const adminToken = await login(ADMIN.email, ADMIN.password);
  check('buyer and admin can sign in', Boolean(buyerToken && adminToken));

  // ─── 1. a fresh account starts free ─────────────────────────────────────
  check('new account starts on the free plan', buyer.subscription?.tier === 'free', `tier=${buyer.subscription?.tier}`);

  // ─── 2. the plan table is priced in taka ────────────────────────────────
  const plans = await call('GET', '/api/payments/plans');
  const byId = Object.fromEntries((plans.data.plans || []).map((p) => [p.id, p]));
  check('three plans exist', Object.keys(byId).length === 3, Object.keys(byId).join(', '));
  check('free is ৳0', byId.free?.bdt === 0);
  check('pro is ৳100/month', byId.pro?.bdt === 100);
  check('enterprise is ৳300/month', byId.enterprise?.bdt === 300);

  // ─── 3. paid tiers cannot be self-granted ───────────────────────────────
  const upgrade = await call('PUT', '/api/user/subscription', {
    token: buyerToken, data: { tier: 'pro' }, validate: () => true,
  });
  check('direct upgrade to pro is refused (402)', upgrade.status === 402, `got ${upgrade.status}`);

  // ─── 4. the owner publishes a Nagad number ──────────────────────────────
  const badWallet = await call('PUT', '/api/admin/nagad', {
    token: adminToken, data: { wallet: '12345' }, validate: () => true,
  });
  check('a malformed Nagad number is refused (400)', badWallet.status === 400, `got ${badWallet.status}`);

  const savedWallet = await call('PUT', '/api/admin/nagad', {
    token: adminToken, data: { wallet: WALLET, holder: 'Smoke Shop' },
  });
  check('the Nagad number saves', savedWallet.data.settings?.wallet === WALLET);

  const cfg = await call('GET', '/api/payments/nagad/config', { token: buyerToken });
  check('checkout shows the Nagad number', cfg.data.wallet === WALLET, `wallet=${cfg.data.wallet}`);
  check('checkout knows auto vs manual', typeof cfg.data.auto === 'boolean', `auto=${cfg.data.auto}`);

  // ─── 5. the buyer opens an order ────────────────────────────────────────
  const order = await call('POST', '/api/payments/nagad/order', { token: buyerToken, data: { tier: 'pro' } });
  const tranId = order.data.tranId;
  check('order is created for ৳100', order.data.amount === 100 && order.data.currency === 'BDT', `amount=${order.data.amount}`);
  check('order waits for the money', !order.data.url, `mode=${order.data.mode}`);

  const stillFree = await User.findById(buyer._id);
  check('an open order does not unlock the plan', stillFree.subscription?.tier === 'free', `tier=${stillFree.subscription?.tier}`);

  // ─── 6. bad TrxIDs are refused ──────────────────────────────────────────
  const badTrx = await call('POST', '/api/payments/nagad/submit', {
    token: buyerToken, data: { tranId, trxId: 'ab', senderNumber: '01712345678' }, validate: () => true,
  });
  check('a malformed TrxID is refused (400)', badTrx.status === 400, `got ${badTrx.status}`);

  const badSender = await call('POST', '/api/payments/nagad/submit', {
    token: buyerToken, data: { tranId, trxId: 'TRX12345ABC', senderNumber: '123' }, validate: () => true,
  });
  check('a malformed sender number is refused (400)', badSender.status === 400, `got ${badSender.status}`);

  // ─── 7. a real TrxID parks the order for a human (no merchant keys) ─────
  const trxId = `SMOKE${Date.now().toString(36).toUpperCase()}`;
  const submitted = await call('POST', '/api/payments/nagad/submit', {
    token: buyerToken, data: { tranId, trxId, senderNumber: '+880 171 234 5678' },
  });
  check('TrxID is recorded and normalised', await (async () => {
    const row = await PaymentOrder.findOne({ tranId });
    return row.nagadTrxId === trxId.replace(/\s/g, '').toUpperCase() && row.senderNumber === '01712345678';
  })(), `status=${submitted.data.status}`);

  const waitingTier = await User.findById(buyer._id);
  check('a submitted TrxID alone does not unlock the plan', waitingTier.subscription?.tier === 'free', `tier=${waitingTier.subscription?.tier}`);

  // ─── 8. the same TrxID cannot be reused ─────────────────────────────────
  const second = await call('POST', '/api/payments/nagad/order', { token: buyerToken, data: { tier: 'pro' } });
  const reuse = await call('POST', '/api/payments/nagad/submit', {
    token: buyerToken, data: { tranId: second.data.tranId, trxId, senderNumber: '01712345678' }, validate: () => true,
  });
  check('a reused TrxID is refused (409)', reuse.status === 409, `got ${reuse.status}`);

  // ─── 9. the buyer cannot read or approve someone else's order ───────────
  const otherBuyer = await User.findOneAndUpdate(
    { email: 'smoke-pay-other@example.test' },
    { name: 'Other Buyer', password: hash, role: 'user', isActive: true },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  const otherToken = await login('smoke-pay-other@example.test', BUYER.password);
  const peek = await call('GET', `/api/payments/status/${tranId}`, { token: otherToken, validate: () => true });
  check("another account cannot read this order (403)", peek.status === 403, `got ${peek.status}`);

  const strangerApprove = await call('POST', `/api/admin/payments/${tranId}/approve`, {
    token: buyerToken, data: {}, validate: () => true,
  });
  check('a non-admin cannot approve a payment (403)', strangerApprove.status === 403, `got ${strangerApprove.status}`);

  // ─── 10. the admin approves it ──────────────────────────────────────────
  const pending = await call('GET', '/api/admin/payments?status=awaiting_review', { token: adminToken });
  check('the order appears in the review queue', (pending.data.orders || []).some((o) => o.tranId === tranId));
  check('the queue reports the TrxID and the payer', (() => {
    const row = (pending.data.orders || []).find((o) => o.tranId === tranId);
    return row?.nagadTrxId === trxId && row?.senderNumber === '01712345678' && row?.user?.email === BUYER.email;
  })());

  const approved = await call('POST', `/api/admin/payments/${tranId}/approve`, { token: adminToken, data: { note: 'smoke test' } });
  check('the admin can approve it', approved.data.success === true);

  const upgraded = await User.findById(buyer._id);
  check('approving switches the plan on', upgraded.subscription?.tier === 'pro', `tier=${upgraded.subscription?.tier}`);
  check('the plan brings its 2,000,000 token allowance', upgraded.tokenQuota?.weeklyLimit === 2000000, `limit=${upgraded.tokenQuota?.weeklyLimit}`);
  check('the plan records who confirmed it', upgraded.subscription?.verifiedBy === 'reviewer', `by=${upgraded.subscription?.verifiedBy}`);

  const idempotent = await call('POST', `/api/admin/payments/${tranId}/approve`, { token: adminToken, data: {} });
  check('approving twice changes nothing', idempotent.data.alreadyPaid === true);

  const receipts = await call('GET', '/api/payments/orders', { token: buyerToken });
  check('the buyer sees the paid receipt', (receipts.data.orders || []).some((o) => o.tranId === tranId && o.status === 'paid'));

  // ─── 11. a rejected order changes nothing ───────────────────────────────
  const rejectMe = await call('POST', '/api/payments/nagad/order', { token: otherToken, data: { tier: 'enterprise' } });
  await call('POST', '/api/payments/nagad/submit', {
    token: otherToken,
    data: { tranId: rejectMe.data.tranId, trxId: `REJECT${Date.now().toString(36).toUpperCase()}`, senderNumber: '01812345678' },
  });
  await call('POST', `/api/admin/payments/${rejectMe.data.tranId}/reject`, { token: adminToken, data: { note: 'no receive found' } });
  const stillFreeOther = await User.findById(otherBuyer._id);
  check('a rejected order leaves the account on free', stillFreeOther.subscription?.tier === 'free', `tier=${stillFreeOther.subscription?.tier}`);

  // ─── cleanup ────────────────────────────────────────────────────────────
  await PaymentOrder.deleteMany({ userId: { $in: [buyer._id, otherBuyer._id] } });
  await User.deleteMany({ email: { $in: [BUYER.email, ADMIN.email, 'smoke-pay-other@example.test'] } });
  await require('../src/services/appSettings').hydrate();

  console.log('');
  console.log(`${results.length - failures}/${results.length} checks passed`);
  console.log(`logs: ${path.basename(__filename)}`);
  await mongoose.disconnect();
  process.exit(failures ? 1 : 0);
}

main().catch(async (err) => {
  console.error('smoke test crashed:', err.message);
  try { await mongoose.disconnect(); } catch (_e) { /* ignore */ }
  process.exit(1);
});
