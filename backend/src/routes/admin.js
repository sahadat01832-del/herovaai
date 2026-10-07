const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Conversation = require('../models/Conversation');
const WhatsAppSession = require('../models/WhatsAppSession');
const AIMemory = require('../models/AIMemory');
const bcrypt = require('bcryptjs');
const { authenticate, adminOnly } = require('../middleware/auth');

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
    const { name, email, password, role, phone } = req.body;
    const hashedPassword = await bcrypt.hash(password || 'Password@123', 12);
    const user = await User.create({ name, email: email.toLowerCase(), password: hashedPassword, role: role || 'user', phone });
    await AIMemory.create({ userId: user._id });
    res.status(201).json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/users/:id', async (req, res) => {
  try {
    const { name, email, role, isActive, contentbotApiKey, phone } = req.body;
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { $set: { name, email, role, isActive, contentbotApiKey, phone } },
      { new: true }
    );
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, user });
  } catch (err) {
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
  res.json({
    success: true,
    settings: {
      lmStudioUrl: process.env.LM_STUDIO_BASE_URL || 'http://localhost:1234/v1',
      contentbotApiUrl: process.env.CONTENTBOT_API_URL || '',
      contentbotApiKey: process.env.CONTENTBOT_API_KEY ? '***configured***' : '',
    }
  });
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
    const users = await User.find()
      .select('name email role subscription tokenQuota createdAt lastSeen')
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

module.exports = router;
