const express = require('express');
const router = express.Router();
const path = require('path');
const WhatsAppSession = require('../models/WhatsAppSession');
const { authenticate } = require('../middleware/auth');
const wppConnectService = require('../services/wppConnectService');
const flowService = require('../services/flowService');
const User = require('../models/User');
const ChannelConnection = require('../models/ChannelConnection');
const ScheduledPost = require('../models/ScheduledPost');
const appSettings = require('../services/appSettings');

// Which model answered is an admin-only record (/api/admin/whatsapp/...), so every session the
// OWNER's API returns goes through here rather than each route remembering to strip it.
function forOwner(session) {
  if (!session) return session;
  const plain = typeof session.toObject === 'function' ? session.toObject() : { ...session };
  if (Array.isArray(plain.messages)) {
    plain.messages = plain.messages.map(({ aiModel, ...rest }) => rest);
  }
  return plain;
}

router.get('/analytics', authenticate, async (req, res) => {
  try {
    const [sessions, channels, scheduledCount] = await Promise.all([
      WhatsAppSession.find({ userId: req.user._id })
        .select('sessionName status totalMessagesReceived totalMessagesSent messages')
        .lean(),
      ChannelConnection.find({ userId: req.user._id })
        .select('channel label status stats activity')
        .lean(),
      ScheduledPost.countDocuments({ userId: req.user._id, status: 'scheduled' }),
    ]);

    const now = new Date();
    const firstDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 6));
    const byDay = new Map();
    for (let offset = 0; offset < 7; offset += 1) {
      const day = new Date(firstDay);
      day.setUTCDate(day.getUTCDate() + offset);
      byDay.set(day.toISOString().slice(0, 10), { date: day.toISOString().slice(0, 10), incoming: 0, replies: 0 });
    }
    let recentCustomers = 0;
    for (const session of sessions) {
      const contacts = new Set();
      for (const message of session.messages || []) {
        const timestamp = new Date(message.timestamp);
        const day = byDay.get(timestamp.toISOString().slice(0, 10));
        if (!day) continue;
        const customer = message.direction === 'incoming' ? message.from : message.to;
        if (customer && customer !== 'me') contacts.add(customer);
        if (message.direction === 'incoming') day.incoming += 1;
        else if (message.aiGenerated) day.replies += 1;
      }
      recentCustomers += contacts.size;
    }

    const recentActivity = channels.flatMap((connection) => (connection.activity || [])
      .filter((item) => new Date(item.at) >= firstDay)
      .map((item) => ({ channel: connection.channel, kind: item.kind, ok: item.ok, at: item.at })));
    const postsSent = channels.reduce((total, connection) => total + (connection.stats?.postsSent || 0), 0);
    const channelReplies = channels.reduce((total, connection) => total + (connection.stats?.repliesSent || 0), 0);

    res.json({
      success: true,
      range: { since: firstDay.toISOString(), through: now.toISOString() },
      whatsapp: {
        sessions: sessions.length,
        connectedSessions: sessions.filter((session) => session.status === 'connected').length,
        messagesReceived: sessions.reduce((total, session) => total + (session.totalMessagesReceived || 0), 0),
        messagesSent: sessions.reduce((total, session) => total + (session.totalMessagesSent || 0), 0),
        customersSeenInRecentHistory: recentCustomers,
        days: Array.from(byDay.values()),
      },
      channels: {
        connected: channels.filter((connection) => connection.status === 'connected').length,
        postsSent,
        repliesSent: channelReplies,
        activityLast7Days: recentActivity.length,
        failuresLast7Days: recentActivity.filter((item) => !item.ok).length,
        scheduledPosts: scheduledCount,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Get user's WhatsApp sessions ──────────────────────────────────────────
// The message log is deliberately NOT part of this payload. The dashboard polls this
// route every 3 seconds while a QR is on screen, and returning `messages` meant reading
// and re-serialising a business's entire chat history every 3 seconds — a cost that grew
// with success until the page crawled. The log has its own endpoint
// (GET /sessions/:id/messages) and the counters below are what the list actually shows.
router.get('/sessions', authenticate, async (req, res) => {
  try {
    const sessions = await WhatsAppSession.find({ userId: req.user._id })
      .select('-messages')
      .lean();
    res.json({ success: true, sessions: sessions.map(forOwner) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Get single session with QR ───────────────────────────────────────────
router.get('/sessions/:id', authenticate, async (req, res) => {
  try {
    const session = await WhatsAppSession.findOne({ _id: req.params.id, userId: req.user._id });
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
    res.json({ success: true, session: forOwner(session) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Create / Connect a new session ───────────────────────────────────────
router.post('/sessions', authenticate, async (req, res) => {
  try {
    if (!appSettings.flag('whatsappEnabled')) {
      return res.status(503).json({
        success: false,
        message: 'Connecting WhatsApp numbers is paused by the administrator. Existing sessions keep running.',
      });
    }

    const { sessionName, phoneNumber } = req.body;
    if (!sessionName) return res.status(400).json({ success: false, message: 'Session name is required' });

    let digits = String(phoneNumber || '').replace(/[^0-9]/g, '');
    if (/^01[3-9]\d{8}$/.test(digits)) {
      digits = '88' + digits;
    }

    // Clean session name
    const cleanName = sessionName.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    const fullSessionName = `${req.user._id}_${cleanName}`;

    let session = await WhatsAppSession.findOne({ userId: req.user._id, sessionName: fullSessionName });
    const live = await wppConnectService.getSessionState(fullSessionName);

    // ── Plan limit: how many WhatsApp numbers one owner may connect ────────
    // Checked only when this is a NEW session. Starting one that already exists
    // (a reconnect after a restart) is always allowed — the limit is on numbers,
    // not on clicking connect twice.
    if (!session) {
      const owner = await User.findById(req.user._id).select('subscription').lean();
      const tier = owner?.subscription?.tier || 'free';
      const limit = appSettings.limitFor(tier, 'whatsapp');
      const used = await WhatsAppSession.countDocuments({ userId: req.user._id });
      if (limit && used >= limit) {
        return res.status(409).json({
          success: false,
          message: `Your ${tier} plan connects ${limit} WhatsApp number${limit === 1 ? '' : 's'}. Delete one of your sessions, or upgrade to run more at the same time.`,
        });
      }
    }

    // The record exists before anything can queue it — a queued session with no
    // row to write its position onto would wait forever, invisibly.
    if (!session) {
      session = await WhatsAppSession.create({
        userId: req.user._id,
        sessionName: fullSessionName,
        status: 'qr_pending',
        phoneNumber: digits || null,
      });
    } else if (!live.active) {
      // No browser is running for this session, so "awaiting a scan" is the honest status for
      // the launch about to happen. When one IS running, its own state is left alone: a second
      // connect click must not downgrade a working session to qr_pending.
      session.status = 'qr_pending';
      session.qrCode = null;
      if (digits) session.phoneNumber = digits;
      await session.save();
    }

    // ── Host capacity: every live session is a Chromium process ────────────
    // The platform ceiling protects the machine that answers EVERY owner's
    // messages. At the limit the request joins the launch queue rather than being
    // refused: the browser starts by itself when a slot frees, and the owner is
    // told where they are in line instead of being told to come back later.
    const headroom = wppConnectService.launchHeadroom();
    if (!live.active && headroom.ceiling && headroom.headroom <= 0) {
      const position = await wppConnectService.enqueueLaunch(fullSessionName, req.user._id, req.io);
      const queued = await WhatsAppSession.findOne({ userId: req.user._id, sessionName: fullSessionName });
      return res.status(202).json({
        success: true,
        queued: true,
        position,
        session: forOwner(queued || session),
        running: headroom.running,
        ceiling: headroom.ceiling,
        message: `The server is running its limit of ${headroom.ceiling} live WhatsApp session(s). You are number ${position} in line — this number starts on its own the moment a slot frees, so you can leave this page open.`,
      });
    }

    // Start WPPConnect session. A failure to even start (missing library, unwritable profile)
    // is reported now; the scan-dependent outcome arrives later over the session record.
    const started = await wppConnectService.startSession(
      fullSessionName,
      req.user._id,
      req.io,
      digits ? { phoneNumber: digits } : {}
    );
    if (!started.ok) {
      return res.status(503).json({ success: false, message: started.error, session: forOwner(session) });
    }

    if (started.alreadyRunning) {
      return res.json({
        success: true,
        session: forOwner(session),
        alreadyRunning: true,
        pendingScan: Boolean(started.pendingScan),
        message: started.pendingScan
          ? 'This session is already waiting for a QR scan.'
          : 'This session is already running.',
      });
    }

    res.status(201).json({ success: true, session: forOwner(session) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Disconnect a session ──────────────────────────────────────────────────
// ─── Pairing-code login ("link with a code" instead of scanning a QR) ─────
// The login method is fixed when the session browser starts, so this closes any
// browser mid-scan and relaunches it in phone-number mode; the 8-char code then
// arrives over the `whatsapp-pairing-code` socket event.
router.post('/sessions/:id/pairing-code', authenticate, async (req, res) => {
  try {
    const session = await WhatsAppSession.findOne({ _id: req.params.id, userId: req.user._id });
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
    if (!appSettings.flag('whatsappEnabled')) {
      return res.status(503).json({ success: false, message: 'Connecting WhatsApp numbers is paused by the administrator.' });
    }
    const { phoneNumber } = req.body || {};
    const result = await wppConnectService.requestPairingCode(
      session.sessionName, req.user._id, phoneNumber, req.io);
    if (!result.ok) return res.status(400).json({ success: false, message: result.error });
    res.json({ success: true, message: result.message || 'Generating your pairing code…' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/sessions/:id/disconnect', authenticate, async (req, res) => {
  try {
    const session = await WhatsAppSession.findOne({ _id: req.params.id, userId: req.user._id });
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });

    await wppConnectService.closeSession(session.sessionName);
    session.status = 'disconnected';
    session.qrCode = null;
    session.pairingCode = null;
    session.pairingCodeAt = null;
    await session.save();

    res.json({ success: true, message: 'Session disconnected' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Delete session ────────────────────────────────────────────────────────
router.delete('/sessions/:id', authenticate, async (req, res) => {
  try {
    const session = await WhatsAppSession.findOne({ _id: req.params.id, userId: req.user._id });
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });

    // Deleting a session removes its stored WhatsApp login too: leaving the profile on disk
    // would let a session with the same name resume the old pairing without a scan.
    await wppConnectService.closeSession(session.sessionName, { removeProfile: true });
    await WhatsAppSession.findByIdAndDelete(req.params.id);

    res.json({ success: true, message: 'Session deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Update session settings ───────────────────────────────────────────────
router.put('/sessions/:id/settings', authenticate, async (req, res) => {
  try {
    const { autoReply, autoReplyMode, useMemory, customPrompt, tone, ownerMuteMinutes, handoffMessage } = req.body;
    const update = {};

    // Only the fields actually sent are written, and each is checked here so a bad value is
    // a 400 that names the field rather than a schema error surfacing as a 500.
    if (autoReply !== undefined) {
      if (typeof autoReply !== 'boolean') {
        return res.status(400).json({ success: false, message: 'autoReply must be true or false' });
      }
      update.autoReply = autoReply;
    }
    if (autoReplyMode !== undefined) {
      if (!['always', 'when_away', 'never'].includes(autoReplyMode)) {
        return res.status(400).json({ success: false, message: 'autoReplyMode must be one of: always, when_away, never' });
      }
      update.autoReplyMode = autoReplyMode;
    }
    if (useMemory !== undefined) {
      if (typeof useMemory !== 'boolean') {
        return res.status(400).json({ success: false, message: 'useMemory must be true or false' });
      }
      update.useMemory = useMemory;
    }
    // Too long is an error, not a silent truncation: the caller would otherwise be told its
    // instructions were saved while a shortened version is what the assistant actually gets.
    // An empty value is allowed and means "no session override, use the business default".
    if (customPrompt !== undefined) {
      if (typeof customPrompt !== 'string') {
        return res.status(400).json({ success: false, message: 'customPrompt must be text' });
      }
      if (customPrompt.length > 2000) {
        return res.status(400).json({ success: false, message: 'customPrompt must be at most 2000 characters' });
      }
      update.customPrompt = customPrompt;
    }
    if (tone !== undefined) {
      if (typeof tone !== 'string') {
        return res.status(400).json({ success: false, message: 'tone must be text' });
      }
      if (tone.length > 120) {
        return res.status(400).json({ success: false, message: 'tone must be at most 120 characters' });
      }
      update.tone = tone.trim();
    }
    // How long the AI stays silent after the owner speaks in a conversation
    // (single-speaker rule, default 5 min, hard cap 24 h).
    if (ownerMuteMinutes !== undefined) {
      const mins = Number(ownerMuteMinutes);
      if (!Number.isFinite(mins) || mins <= 0 || mins > 1440) {
        return res.status(400).json({ success: false, message: 'ownerMuteMinutes must be a number between 1 and 1440' });
      }
      update.ownerMuteMinutes = mins;
    }
    // Deterministic acknowledgment when a customer asks for the real owner.
    if (handoffMessage !== undefined) {
      if (typeof handoffMessage !== 'string') {
        return res.status(400).json({ success: false, message: 'handoffMessage must be text' });
      }
      if (handoffMessage.length > 500) {
        return res.status(400).json({ success: false, message: 'handoffMessage must be at most 500 characters' });
      }
      update.handoffMessage = handoffMessage.trim();
    }

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ success: false, message: 'No settings were provided' });
    }

    const session = await WhatsAppSession.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { $set: update },
      { new: true }
    );
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
    res.json({ success: true, session: forOwner(session) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Send a manual message ─────────────────────────────────────────────────
router.post('/sessions/:id/send', authenticate, async (req, res) => {
  try {
    const { to, message } = req.body;
    if (!to || !message) return res.status(400).json({ success: false, message: 'Recipient phone number and message are required' });

    const session = await WhatsAppSession.findOne({ _id: req.params.id, userId: req.user._id });
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
    if (session.status !== 'connected') {
      return res.status(400).json({ success: false, message: 'WhatsApp session is not connected yet' });
    }

    // The record saying "connected" and a live client existing in this process are two
    // different facts; sending needs the second one.
    const live = await wppConnectService.getSessionState(session.sessionName);
    if (!live.active) {
      return res.status(409).json({
        success: false,
        message: 'This session has no live browser in the current backend process. Reconnect (scan the QR again) and retry.',
        sessionState: live,
      });
    }

    const mediaUrl = req.body.mediaUrl || null;
    let localFile = null;
    if (mediaUrl) {
      localFile = flowService.findMediaFile(path.basename(mediaUrl));
    } else if (req.body.mediaPath) {
      localFile = req.body.mediaPath;
    }

    if (localFile) {
      await wppConnectService.sendMedia(session.sessionName, to, localFile, message);
    } else {
      await wppConnectService.sendMessage(session.sessionName, to, message);
    }

    const outgoing = {
      from: 'me',
      to,
      body: message,
      mediaUrl: mediaUrl || null,
      direction: 'outgoing',
      status: 'sent',
      timestamp: new Date(),
    };
    session.messages.push(outgoing);
    session.totalMessagesSent++;

    // Owner stepped into this conversation → mute the AI for it (single-speaker
    // rule). The timer re-arms on every further owner message.
    const { mute } = await wppConnectService.ownerTookOver(session._id, req.user._id, to).catch(() => ({ mute: null }));
    await session.save();

    res.json({
      success: true,
      message: 'Message sent successfully',
      data: outgoing,
      singleSpeaker: { muted: Boolean(mute), mutedUntil: mute ? mute.until : null },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Single-speaker: per-customer AI pause / resume / state ──────────────────
router.post('/sessions/:id/customers/:customer/mute', authenticate, async (req, res) => {
  try {
    const customer = String(req.params.customer || '').split('@')[0];
    if (!customer) return res.status(400).json({ success: false, message: 'Customer phone number is required' });
    const reason = ['manual', 'owner_reply', 'handoff_request'].includes(req.body?.reason) ? req.body.reason : 'manual';
    const { mute, windowMin } = await wppConnectService.ownerTookOver(req.params.id, req.user._id, customer, reason);
    res.json({ success: true, muted: Boolean(mute), mutedUntil: mute ? mute.until : null, reason, windowMin });
  } catch (err) {
    const status = err.message === 'Session not found' ? 404 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
});

router.post('/sessions/:id/customers/:customer/unmute', authenticate, async (req, res) => {
  try {
    const customer = String(req.params.customer || '').split('@')[0];
    if (!customer) return res.status(400).json({ success: false, message: 'Customer phone number is required' });
    const resumed = await wppConnectService.resumeAi(req.params.id, req.user._id, customer);
    res.json({ success: true, resumed });
  } catch (err) {
    const status = err.message === 'Session not found' ? 404 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
});

router.get('/sessions/:id/customers/:customer/mute', authenticate, async (req, res) => {
  try {
    const customer = String(req.params.customer || '').split('@')[0];
    if (!customer) return res.status(400).json({ success: false, message: 'Customer phone number is required' });
    const state = await wppConnectService.muteState(req.params.id, req.user._id, customer);
    res.json({ success: true, ...state });
  } catch (err) {
    const status = err.message === 'Session not found' ? 404 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
});
router.get('/sessions/:id/messages', authenticate, async (req, res) => {
  try {
    // The owner path sends `?from=` while the admin path sends `?contact=`; accept
    // both so a per-customer click actually filters instead of returning the whole
    // session log for every customer.
    const contact = req.query.contact || req.query.from;
    const session = await WhatsAppSession.findOne({ _id: req.params.id, userId: req.user._id });
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });

    let messages = (session.messages || []).map(m => (m.toObject ? m.toObject() : { ...m }));

    // Extract unique customer contacts
    const customerSet = new Set();
    messages.forEach(m => {
      const otherNumber = m.direction === 'incoming' ? m.from : m.to;
      if (otherNumber && otherNumber !== 'me') {
        customerSet.add(otherNumber);
      }
    });

    if (contact) {
      messages = messages.filter(m => m.from === contact || m.to === contact);
    }

    // The owner sees their own conversations, not which upstream model answered — that
    // record belongs to the admin view (/api/admin/whatsapp/...).
    messages = forOwner({ messages: messages.slice(-200) }).messages;

    res.json({
      success: true,
      customers: Array.from(customerSet),
      messages,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/sessions/:id/export', authenticate, async (req, res) => {
  try {
    const session = await WhatsAppSession.findOne({ _id: req.params.id, userId: req.user._id });
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
    const exportedAt = new Date();
    const label = String(session.sessionName.split('_').slice(1).join('_') || 'WhatsApp')
      .replace(/[^a-zA-Z0-9_-]/g, '_');
    const history = {
      format: 'herovaai-whatsapp-history',
      version: 1,
      exportedAt: exportedAt.toISOString(),
      note: 'This backup contains messages currently retained by HerovaAi for this number. It does not include WhatsApp login credentials or media file contents.',
      session: {
        label,
        phoneNumber: session.phoneNumber || '',
        createdAt: session.createdAt,
        totalMessagesReceived: session.totalMessagesReceived || 0,
        totalMessagesSent: session.totalMessagesSent || 0,
      },
      messages: forOwner(session).messages || [],
    };
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="herovaai-whatsapp-${label}-${exportedAt.toISOString().slice(0, 10)}.json"`);
    res.json(history);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
