const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Conversation = require('../models/Conversation');
const WhatsAppSession = require('../models/WhatsAppSession');
const AIMemory = require('../models/AIMemory');
const bcrypt = require('bcryptjs');
const keyVault = require('../services/keyVault');
const googleAuth = require('../services/googleAuth');
const PaymentOrder = require('../models/PaymentOrder');
const subs = require('../services/subscriptionService');
const { authenticate, adminOnly } = require('../middleware/auth');

/** Same rule as the user routes: trim, sanity-check, never echo back. */
function cleanKey(raw) {
  const value = String(raw || '').trim();
  if (!value) return { error: 'Paste an API key first' };
  if (value.length < 8) return { error: 'That key is too short to be valid' };
  if (value.length > 512) return { error: 'API keys are at most 512 characters' };
  if (/\s/.test(value)) return { error: 'The key contains whitespace — it may have been copied with a line break' };
  return { value };
}

// All admin routes require authentication + admin role
router.use(authenticate, adminOnly);

// ─── Dashboard Stats ───────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const [totalUsers, totalConvos, totalWaSessions, activeWaSessions] = await Promise.all([
      User.countDocuments({ role: 'user' }),
      Conversation.countDocuments(),
      WhatsAppSession.countDocuments(),
      WhatsAppSession.countDocuments({ status: 'connected' }),
    ]);

    const recentUsers = await User.find({ role: 'user' })
      .select('name email createdAt lastSeen')
      .sort({ createdAt: -1 })
      .limit(5);

    const recentChats = await Conversation.find()
      .populate('userId', 'name email')
      .select('title mode updatedAt userId')
      .sort({ updatedAt: -1 })
      .limit(10);

    res.json({
      success: true,
      stats: { totalUsers, totalConvos, totalWaSessions, activeWaSessions },
      recentUsers,
      recentChats,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Users Management ──────────────────────────────────────────────────────
router.get('/users', async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '', role = 'user' } = req.query;
    const query = { role };
    if (search) query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
    ];

    const users = await User.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    const total = await User.countDocuments(query);
    res.json({ success: true, users, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/users', async (req, res) => {
  try {
    const { name, email, password, role, phone, contentbotApiKey } = req.body || {};
    if (!name || !email) {
      return res.status(400).json({ success: false, message: 'Name and email are required' });
    }

    const $set = {};
    if (contentbotApiKey !== undefined && contentbotApiKey !== null && String(contentbotApiKey).trim()) {
      const cleaned = cleanKey(contentbotApiKey);
      if (cleaned.error) return res.status(400).json({ success: false, message: cleaned.error });
      $set.contentbotApiKey = cleaned.value;
    }

    const hashedPassword = await bcrypt.hash(password || 'Password@123', 12);
    const user = await User.create({
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
      role: role || 'user',
      phone,
      ...$set,
    });
    await AIMemory.create({ userId: user._id });
    res.status(201).json({ success: true, user });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: 'That email is already registered' });
    }
    res.status(500).json({ success: false, message: err.message });
  }
});

// Partial update: only keys present in the body are written. An `undefined` field used to be
// harmless, but an explicitly empty API-key box must mean "revoke", not "ignore".
router.put('/users/:id', async (req, res) => {
  try {
    const allowed = ['name', 'email', 'role', 'isActive', 'phone'];
    const $set = {};
    const $unset = {};
    for (const field of allowed) {
      if (req.body[field] !== undefined) $set[field] = field === 'email' ? String(req.body[field]).toLowerCase() : req.body[field];
    }

    if (req.body.contentbotApiKey !== undefined) {
      const raw = req.body.contentbotApiKey;
      if (raw === null || String(raw).trim() === '') {
        $unset.contentbotApiKey = 1;
      } else {
        const cleaned = cleanKey(raw);
        if (cleaned.error) return res.status(400).json({ success: false, message: cleaned.error });
        $set.contentbotApiKey = cleaned.value;
      }
    }

    if (Object.keys($set).length === 0 && Object.keys($unset).length === 0) {
      return res.status(400).json({ success: false, message: 'Nothing to update' });
    }

    const update = {};
    if (Object.keys($set).length) update.$set = $set;
    if (Object.keys($unset).length) update.$unset = $unset;

    const user = await User.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, user });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: 'That email is already taken' });
    }
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/users/:id', async (req, res) => {
  try {
    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({ success: false, message: 'Cannot delete your own admin account' });
    }
    await User.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'User deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── View User Chats ───────────────────────────────────────────────────────
router.get('/users/:id/chats', async (req, res) => {
  try {
    const conversations = await Conversation.find({ userId: req.params.id })
      .sort({ updatedAt: -1 });
    res.json({ success: true, conversations });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── All Conversations (admin view) ───────────────────────────────────────
router.get('/conversations', async (req, res) => {
  try {
    const { page = 1, limit = 20, userId } = req.query;
    const query = userId ? { userId } : {};
    const conversations = await Conversation.find(query)
      .populate('userId', 'name email')
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));
    const total = await Conversation.countDocuments(query);
    res.json({ success: true, conversations, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── WhatsApp: every user's sessions (admin view) ─────────────────────────
// The admin could only see dashboard conversations before this; WhatsApp customers and the
// model that answered them were invisible.
router.get('/whatsapp/sessions', async (req, res) => {
  try {
    const sessions = await WhatsAppSession.find()
      .populate('userId', 'name email')
      .sort({ lastActive: -1, createdAt: -1 });

    const rows = sessions.map(session => {
      const messages = session.messages || [];
      const customers = new Set();
      messages.forEach(m => {
        const other = m.direction === 'incoming' ? m.from : m.to;
        if (other && other !== 'me') customers.add(other);
      });
      const lastAi = [...messages].reverse().find(m => m.aiGenerated && m.aiModel);

      return {
        _id: session._id,
        sessionName: session.sessionName,
        owner: session.userId
          ? { id: session.userId._id, name: session.userId.name, email: session.userId.email }
          : null,
        status: session.status,
        phoneNumber: session.phoneNumber,
        autoReply: session.autoReply,
        autoReplyMode: session.autoReplyMode,
        useMemory: session.useMemory,
        tone: session.tone,
        customPrompt: session.customPrompt,
        totalMessagesReceived: session.totalMessagesReceived,
        totalMessagesSent: session.totalMessagesSent,
        lastActive: session.lastActive,
        lastError: session.lastError,
        lastErrorAt: session.lastErrorAt,
        customerCount: customers.size,
        lastAiModel: lastAi ? lastAi.aiModel : null,
      };
    });

    res.json({ success: true, sessions: rows, total: rows.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── WhatsApp: one session's customer threads, with reply provenance ──────
router.get('/whatsapp/sessions/:id/messages', async (req, res) => {
  try {
    const { contact } = req.query;
    const session = await WhatsAppSession.findById(req.params.id).populate('userId', 'name email');
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });

    let messages = (session.messages || []).map(m => (m.toObject ? m.toObject() : { ...m }));

    const customerSet = new Set();
    messages.forEach(m => {
      const other = m.direction === 'incoming' ? m.from : m.to;
      if (other && other !== 'me') customerSet.add(other);
    });

    if (contact) messages = messages.filter(m => m.from === contact || m.to === contact);

    res.json({
      success: true,
      session: {
        _id: session._id,
        sessionName: session.sessionName,
        status: session.status,
        phoneNumber: session.phoneNumber,
        autoReply: session.autoReply,
        autoReplyMode: session.autoReplyMode,
        lastError: session.lastError,
        owner: session.userId
          ? { id: session.userId._id, name: session.userId.name, email: session.userId.email }
          : null,
      },
      customers: Array.from(customerSet),
      messages: messages.slice(-200),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Settings (LM Studio URL, ContentBot key, etc.) ───────────────────────
router.get('/settings', async (req, res) => {
  const stats = keyVault.stats();
  res.json({
    success: true,
    settings: {
      lmStudioUrl: process.env.LM_STUDIO_BASE_URL || 'http://localhost:1234/v1',
      contentbotApiUrl: process.env.CONTENTBOT_API_URL || '',
      contentbotApiKey: process.env.CONTENTBOT_API_KEY ? '***configured***' : '',
      vault: { runtimeSlots: stats.slots, hydratedAt: stats.hydratedAt || null, error: stats.hydrationError || null },
    }
  });
});

// ─── API key vault (provider keys: list / add / rotate / test / revoke) ───
// Keys added here take effect on the next AI call — no .env edit, no restart. The .env value
// stays as the fallback for that slot, so a revoked saved key degrades instead of breaking.
router.get('/api-keys', async (req, res) => {
  try {
    const [keys, inventory] = await Promise.all([keyVault.savedKeys(), Promise.resolve(keyVault.inventory())]);

    const configuredProviders = inventory.filter(p => p.configured > 0);
    res.json({
      success: true,
      providers: keyVault.PROVIDERS,
      inventory,
      keys,
      summary: {
        providersConfigured: configuredProviders.length,
        providersTotal: inventory.length,
        savedKeys: keys.length,
        enabledKeys: keys.filter(k => k.enabled).length,
        failingKeys: keys.filter(k => k.lastTestStatus === 'failed').length,
        runtimeSlots: keyVault.stats().slots,
        hydratedAt: keyVault.stats().hydratedAt || null,
        hydrationError: keyVault.stats().hydrationError || null,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Google sign-in setup ──────────────────────────────────────────────────
// The client ID and secret are ordinary vault slots (so they are saved, rotated
// and tested like every other key); this route adds the two URLs that have to be
// pasted into Google Cloud Console and the current readiness of the button.
router.get('/google-signin', async (req, res) => {
  try {
    // Passing the request means the URLs below are the ones for the hostname the
    // administrator is actually looking at.
    res.json({ success: true, ...googleAuth.status(req) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/api-keys', async (req, res) => {
  try {
    const { envName, value, label } = req.body || {};
    const cleaned = cleanKey(value);
    if (cleaned.error) return res.status(400).json({ success: false, message: cleaned.error });

    const doc = await keyVault.saveKey({ envName, value: cleaned.value, label, userId: req.user._id });
    res.status(201).json({
      success: true,
      message: `Key saved for ${envName}`,
      key: {
        _id: String(doc._id),
        provider: doc.provider,
        envName: doc.envName,
        label: doc.label,
        enabled: doc.enabled,
        masked: keyVault.mask(cleaned.value),
      },
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.put('/api-keys/:id', async (req, res) => {
  try {
    const { label, value, enabled } = req.body || {};
    if (value !== undefined) {
      const cleaned = cleanKey(value);
      if (cleaned.error) return res.status(400).json({ success: false, message: cleaned.error });
      req.body.value = cleaned.value;
    }
    const doc = await keyVault.updateKey(req.params.id, { label, value: req.body.value, enabled });
    res.json({
      success: true,
      message: 'Key updated',
      key: {
        _id: String(doc._id),
        provider: doc.provider,
        envName: doc.envName,
        label: doc.label,
        enabled: doc.enabled,
        masked: keyVault.mask(doc.value),
      },
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.delete('/api-keys/:id', async (req, res) => {
  try {
    const doc = await keyVault.deleteKey(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: 'Key not found' });
    res.json({ success: true, message: 'Key revoked and removed', envName: doc.envName });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

/** Live probe. With no body it tests a saved key; with { envName, value } it tests a draft. */
router.post('/api-keys/test', async (req, res) => {
  try {
    const { id, envName, value } = req.body || {};
    if (value !== undefined && value !== '') {
      const cleaned = cleanKey(value);
      if (cleaned.error) return res.status(400).json({ success: false, message: cleaned.error });
      const result = await keyVault.testKey({ envName, value: cleaned.value });
      return res.json({ success: true, result });
    }
    const result = await keyVault.testKey({ id, envName });
    res.json({ success: true, result });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

// ─── Subscription & Token Quota Management (Admin) ─────────────────────────
router.put('/users/:id/subscription', async (req, res) => {
  try {
    const { tier, weeklyLimit, status } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (!user.subscription) user.subscription = {};
    if (tier) user.subscription.tier = tier;
    if (status) user.subscription.status = status;

    if (!user.tokenQuota) {
      user.tokenQuota = { weeklyLimit: 1000000, tokensUsed7d: 0, lastResetDate: new Date(), history: [] };
    }
    if (weeklyLimit !== undefined) {
      user.tokenQuota.weeklyLimit = Number(weeklyLimit);
    }

    await user.save();
    res.json({ success: true, message: 'Subscription & token quota updated successfully', user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/users/:id/reset-tokens', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (!user.tokenQuota) {
      user.tokenQuota = { weeklyLimit: 1000000, tokensUsed7d: 0, lastResetDate: new Date(), history: [] };
    }
    user.tokenQuota.tokensUsed7d = 0;
    user.tokenQuota.lastResetDate = new Date();
    await user.save();

    res.json({ success: true, message: 'Token quota reset to 0 tokens used', tokenQuota: user.tokenQuota });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/subscriptions', async (req, res) => {
  try {
    // contentbotApiKey is selected so the serializer can report hasContentbotApiKey accurately;
    // its value is stripped on the way out (see User.toJSON).
    const users = await User.find()
      .select('name email role subscription tokenQuota createdAt lastSeen contentbotApiKey updatedAt')
      .sort({ createdAt: -1 });

    const totalTokensUsed = users.reduce((acc, u) => acc + (u.tokenQuota?.tokensUsed7d || 0), 0);
    const proUsers = users.filter(u => u.subscription?.tier === 'pro').length;
    const enterpriseUsers = users.filter(u => u.subscription?.tier === 'enterprise').length;

    res.json({
      success: true,
      users,
      summary: {
        totalTokensUsed,
        proUsers,
        enterpriseUsers,
        totalUsers: users.length,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ─── Nagad settings (where the money goes, and who confirms it) ────────── */
// The wallet number is what buyers see on the checkout screen, so it is
// validated hard: 11 digits starting 01, no spaces, or it is refused. The RSA
// keys for automatic confirmation are NOT editable here — they are secrets and
// belong in backend/.env or the key vault.
const appSettings = require('../services/appSettings');
const nagadService = require('../services/nagad');

router.get('/nagad', async (_req, res) => {
  const stored = appSettings.get(appSettings.NAGAD) || {};
  const mode = nagadService.mode();
  res.json({
    success: true,
    settings: {
      wallet: stored.wallet || nagadService.config().wallet || '',
      holder: stored.holder || nagadService.config().holder || '',
      autoVerify: stored.autoVerify !== false,
      note: stored.note || '',
    },
    live: {
      auto: mode.auto,
      manual: mode.manual,
      reason: mode.reason,
      merchantId: Boolean(nagadService.config().merchantId),
      merchantKeys: Boolean(nagadService.config().merchantPrivateKey && nagadService.config().pgwPublicKey),
    },
  });
});

router.put('/nagad', async (req, res) => {
  try {
    const body = req.body || {};
    const patch = {};

    if (body.wallet !== undefined) {
      const wallet = String(body.wallet || '').replace(/[^\d]/g, '');
      if (!wallet) return res.status(400).json({ success: false, message: 'Enter the Nagad number buyers should send money to.' });
      if (!/^01[3-9]\d{8}$/.test(wallet)) {
        return res.status(400).json({ success: false, message: 'That is not an 11-digit Nagad number (example: 01712345678).' });
      }
      patch.wallet = wallet;
    }
    if (body.holder !== undefined) patch.holder = String(body.holder || '').slice(0, 80);
    if (body.autoVerify !== undefined) patch.autoVerify = Boolean(body.autoVerify);
    if (body.note !== undefined) patch.note = String(body.note || '').slice(0, 200);

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ success: false, message: 'Nothing to update' });
    }

    const saved = await appSettings.set(appSettings.NAGAD, patch, { userId: req.user._id });
    const mode = nagadService.mode();
    res.json({
      success: true,
      settings: { wallet: saved.wallet, holder: saved.holder, autoVerify: saved.autoVerify !== false, note: saved.note },
      live: { auto: mode.auto, manual: mode.manual, reason: mode.reason },
      message: mode.manual ? 'Nagad checkout is ready.' : 'Saved, but without a wallet number Nagad stays off.',
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ─── Payment review (Nagad TrxIDs the owner has to confirm) ────────────── */
// Nagad's personal (send-money) number has no API, so these orders cannot
// confirm themselves: they wait in `awaiting_review` until someone here says
// the money really arrived. Approving goes through subscriptionService, the
// same code path as a gateway callback, so a plan can never be granted twice.
router.get('/payments', async (req, res) => {
  try {
    const status = String(req.query.status || '').trim();
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const filter = { gateway: 'nagad' };
    if (status) filter.status = status;
    // Waiting orders first: this list exists to be emptied.
    const orders = await PaymentOrder.find(filter)
      .populate('userId', 'name email phone subscription')
      .sort({ status: 1, createdAt: -1 })
      .limit(limit);

    const [waiting, paidToday] = await Promise.all([
      PaymentOrder.countDocuments({ gateway: 'nagad', status: 'awaiting_review' }),
      PaymentOrder.countDocuments({ status: 'paid', paidAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } }),
    ]);

    res.json({
      success: true,
      orders: orders.map((order) => ({
        tranId: order.tranId,
        tier: order.tier,
        amount: order.amount,
        currency: order.currency,
        gateway: order.gateway,
        status: order.status,
        nagadTrxId: order.nagadTrxId,
        senderNumber: order.senderNumber,
        submittedAt: order.submittedAt,
        reviewNote: order.reviewNote,
        verifiedBy: order.verifiedBy,
        user: order.userId
          ? { id: order.userId._id, name: order.userId.name, email: order.userId.email, phone: order.userId.phone, tier: order.userId.subscription?.tier }
          : null,
        createdAt: order.createdAt,
        paidAt: order.paidAt,
      })),
      summary: { awaitingReview: waiting, paidLast24h: paidToday },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/payments/:tranId/approve', async (req, res) => {
  try {
    const order = await PaymentOrder.findOne({ tranId: String(req.params.tranId || '').trim() });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    const note = String(req.body?.note || '').slice(0, 300);
    const result = await subs.settleOrder(order, {
      verifiedBy: 'reviewer',
      reviewerId: req.user._id,
      note: note || `Confirmed by ${req.user.name || req.user.email}`,
    });
    res.json({
      success: true,
      alreadyPaid: Boolean(result.alreadyPaid),
      message: result.alreadyPaid
        ? 'That order was already paid — nothing changed.'
        : `${order.tier.toUpperCase()} switched on for this customer.`,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/payments/:tranId/reject', async (req, res) => {
  try {
    const order = await PaymentOrder.findOne({ tranId: String(req.params.tranId || '').trim() });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    const note = String(req.body?.note || '').slice(0, 300) || 'No matching Nagad payment found';
    const result = await subs.rejectOrder(order, { reviewerId: req.user._id, note });
    if (!result.ok) {
      return res.status(409).json({ success: false, message: 'That order is already paid — refusing it would not refund the plan. Refund in Nagad instead.' });
    }
    res.json({ success: true, message: 'Order marked rejected. The customer can submit a new TrxID.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
