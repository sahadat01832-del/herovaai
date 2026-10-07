const express = require('express');
const router = express.Router();
const WhatsAppSession = require('../models/WhatsAppSession');
const { authenticate } = require('../middleware/auth');
const wppConnectService = require('../services/wppConnectService');

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

// ─── Get user's WhatsApp sessions ──────────────────────────────────────────
router.get('/sessions', authenticate, async (req, res) => {
  try {
    const sessions = await WhatsAppSession.find({ userId: req.user._id });
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
    const { sessionName } = req.body;
    if (!sessionName) return res.status(400).json({ success: false, message: 'Session name is required' });

    // Clean session name
    const cleanName = sessionName.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    const fullSessionName = `${req.user._id}_${cleanName}`;

    let session = await WhatsAppSession.findOne({ userId: req.user._id, sessionName: fullSessionName });
    const live = wppConnectService.getSessionState(fullSessionName);

    if (!session) {
      session = await WhatsAppSession.create({
        userId: req.user._id,
        sessionName: fullSessionName,
        status: 'qr_pending',
      });
    } else if (!live.active) {
      // No browser is running for this session, so "awaiting a scan" is the honest status for
      // the launch about to happen. When one IS running, its own state is left alone: a second
      // connect click must not downgrade a working session to qr_pending.
      session.status = 'qr_pending';
      session.qrCode = null;
      await session.save();
    }

    // Start WPPConnect session. A failure to even start (missing library, unwritable profile)
    // is reported now; the scan-dependent outcome arrives later over the session record.
    const started = wppConnectService.startSession(fullSessionName, req.user._id, req.io);
    if (!started.ok) {
      return res.status(503).json({ success: false, message: started.error, session });
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
router.post('/sessions/:id/disconnect', authenticate, async (req, res) => {
  try {
    const session = await WhatsAppSession.findOne({ _id: req.params.id, userId: req.user._id });
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });

    await wppConnectService.closeSession(session.sessionName);
    session.status = 'disconnected';
    session.qrCode = null;
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
    const { autoReply, autoReplyMode, useMemory, customPrompt, tone } = req.body;
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
    const live = wppConnectService.getSessionState(session.sessionName);
    if (!live.active) {
      return res.status(409).json({
        success: false,
        message: 'This session has no live browser in the current backend process. Reconnect (scan the QR again) and retry.',
        sessionState: live,
      });
    }

    await wppConnectService.sendMessage(session.sessionName, to, message);

    const outgoing = {
      from: 'me',
      to,
      body: message,
      direction: 'outgoing',
      status: 'sent',
      timestamp: new Date(),
    };
    session.messages.push(outgoing);
    session.totalMessagesSent++;
    await session.save();

    res.json({ success: true, message: 'Message sent successfully', data: outgoing });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Get messages for a session (with customer grouping) ───────────────────
router.get('/sessions/:id/messages', authenticate, async (req, res) => {
  try {
    const { contact } = req.query;
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

module.exports = router;
