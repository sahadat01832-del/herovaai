const express = require('express');
const router = express.Router();
const WhatsAppSession = require('../models/WhatsAppSession');
const { authenticate } = require('../middleware/auth');
const wppConnectService = require('../services/wppConnectService');

// ─── Get user's WhatsApp sessions ──────────────────────────────────────────
router.get('/sessions', authenticate, async (req, res) => {
  try {
    const sessions = await WhatsAppSession.find({ userId: req.user._id });
    res.json({ success: true, sessions });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Get single session with QR ───────────────────────────────────────────
router.get('/sessions/:id', authenticate, async (req, res) => {
  try {
    const session = await WhatsAppSession.findOne({ _id: req.params.id, userId: req.user._id });
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
    res.json({ success: true, session });
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
    if (session) {
      session.status = 'qr_pending';
      session.qrCode = null;
      await session.save();
    } else {
      session = await WhatsAppSession.create({
        userId: req.user._id,
        sessionName: fullSessionName,
        status: 'qr_pending',
      });
    }

    // Start WPPConnect session
    wppConnectService.startSession(fullSessionName, req.user._id, req.io);

    res.status(201).json({ success: true, session });
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

    await wppConnectService.closeSession(session.sessionName);
    await WhatsAppSession.findByIdAndDelete(req.params.id);

    res.json({ success: true, message: 'Session deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Update session settings ───────────────────────────────────────────────
router.put('/sessions/:id/settings', authenticate, async (req, res) => {
  try {
    const { autoReply, autoReplyMode, useMemory, customPrompt } = req.body;
    const session = await WhatsAppSession.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { $set: { autoReply, autoReplyMode, useMemory, customPrompt } },
      { new: true }
    );
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
    res.json({ success: true, session });
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

    let messages = session.messages || [];

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

    res.json({
      success: true,
      customers: Array.from(customerSet),
      messages: messages.slice(-200),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
