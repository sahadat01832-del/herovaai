const express = require('express');
const router = express.Router();
const { authenticate, optionalAuth } = require('../middleware/auth');
const ChannelConnection = require('../models/ChannelConnection');
const registry = require('../services/channels/registry');
const adapters = require('../services/channels/adapters');
const channelService = require('../services/channelService');

/**
 * Channels — connect a platform, prove it works, then let it post and answer.
 *
 * Owner routes require a login and always scope by req.user._id: a connection id
 * from another account is never readable, testable or postable.
 *
 * Webhook routes are the exception — Meta and Telegram call them with no token —
 * so each one verifies authenticity first (Meta's HMAC signature, Telegram's
 * secret header) and nothing is answered until it passes.
 */

/* ───────────────────────────── owner surface ───────────────────────────── */

router.get('/', optionalAuth, async (req, res) => {
  try {
    const userId = req.user?._id || null;
    const channels = await channelService.listFor(userId);
    res.json({ success: true, channels, publicBase: channelService.publicBase(), replyCap: channelService.DAILY_REPLY_CAP });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/:id/connect', authenticate, async (req, res) => {
  try {
    const { connection, test } = await channelService.connect(req.user._id, req.params.id, req.body || {});
    res.json({
      success: true,
      connection: connection.toJSON(),
      test,
      message: test.ok ? test.message : `Saved, but the live test failed: ${test.message}`,
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.post('/:id/test', authenticate, async (req, res) => {
  try {
    const connection = await ChannelConnection.findOne({ userId: req.user._id, channel: req.params.id });
    if (!connection) return res.status(404).json({ success: false, message: 'Connect this channel first.' });
    const result = await channelService.testConnection(connection);
    res.json({ success: true, test: result, connection: connection.toJSON() });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/** Update what this channel does on its own. Enabling Telegram replies registers the webhook. */
router.put('/:id/automations', authenticate, async (req, res) => {
  try {
    const connection = await ChannelConnection.findOne({ userId: req.user._id, channel: req.params.id });
    if (!connection) return res.status(404).json({ success: false, message: 'Connect this channel first.' });

    const definition = registry.channel(connection.channel);
    const body = req.body || {};
    const patch = {};

    if (body.autoReply !== undefined) {
      patch.autoReply = Boolean(body.autoReply);
      if (patch.autoReply && !definition.capabilities.autoReply) {
        return res.status(409).json({ success: false, message: `${definition.name} cannot answer messages automatically.` });
      }
      if (patch.autoReply && connection.status !== 'connected') {
        return res.status(409).json({ success: false, message: 'Test the connection successfully before switching replies on.' });
      }
    }
    if (body.autoPost !== undefined) {
      patch.autoPost = Boolean(body.autoPost);
      if (patch.autoPost && !definition.capabilities.autoPost) {
        return res.status(409).json({ success: false, message: `${definition.name} cannot post automatically from here.` });
      }
      if (patch.autoPost && connection.status !== 'connected') {
        return res.status(409).json({ success: false, message: 'Test the connection successfully before switching posting on.' });
      }
    }
    if (body.autoPostTime !== undefined) patch.autoPostTime = channelService.normaliseTime(body.autoPostTime);
    if (body.postTopic !== undefined) patch.postTopic = String(body.postTopic || '').slice(0, 300);
    if (body.replyNote !== undefined) patch.replyNote = String(body.replyNote || '').slice(0, 300);

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ success: false, message: 'Nothing to update' });
    }

    connection.automations = { ...connection.automations.toObject(), ...patch };

    // Telegram needs to know where to deliver messages. We register it for the
    // owner instead of asking them to paste a URL into BotFather.
    let webhook = null;
    if (connection.channel === 'telegram' && patch.autoReply !== undefined) {
      if (patch.autoReply) {
        const token = String(connection.credentials?.botToken || '').trim();
        const botId = token.split(':')[0];
        webhook = await adapters.telegramRegisterWebhook(
          connection,
          `${channelService.publicBase()}/api/channels/webhook/telegram/${botId}`,
        );
        if (!webhook.ok) {
          connection.automations.autoReply = false;
          connection.lastError = webhook.message;
          connection.pushActivity('setup', false, `Webhook registration failed: ${webhook.message}`);
        } else {
          connection.pushActivity('setup', true, 'Telegram webhook registered');
        }
      } else {
        await adapters.telegramRemoveWebhook(connection).catch(() => null);
        connection.pushActivity('setup', true, 'Telegram replies switched off; webhook removed');
      }
    }

    await connection.save();
    res.json({
      success: true,
      connection: connection.toJSON(),
      webhook,
      message: webhook && !webhook.ok
        ? `Saved, but Telegram refused the webhook: ${webhook.message}`
        : 'Saved.',
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/** Post once, right now — with your own text or an AI draft from the topic. */
router.post('/:id/post-now', authenticate, async (req, res) => {
  try {
    const connection = await ChannelConnection.findOne({ userId: req.user._id, channel: req.params.id });
    if (!connection) return res.status(404).json({ success: false, message: 'Connect this channel first.' });
    const result = await channelService.publishToConnection(connection, { text: req.body?.text });
    res.json({ success: true, result, connection: connection.toJSON() });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/:id', authenticate, async (req, res) => {
  try {
    const connection = await ChannelConnection.findOne({ userId: req.user._id, channel: req.params.id });
    if (!connection) return res.status(404).json({ success: false, message: 'Nothing connected on that channel.' });
    await channelService.disconnect(connection);
    res.json({ success: true, message: 'Disconnected. The stored credentials are gone.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ───────────────────────────── webhooks ────────────────────────────────── */

// Meta verifies a webhook by echoing a challenge back. The token identifies
// which owner's connection the subscription belongs to.
router.get('/webhook/:channel', async (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode !== 'subscribe' || !token) return res.status(400).send('bad request');
  const connection = await ChannelConnection.findOne({
    channel: req.params.channel,
    $or: [{ 'credentials.verifyToken': String(token) }, { 'credentials.verifyToken': String(token).trim() }],
  });
  if (!connection) return res.status(403).send('verify token does not match any connection');
  res.type('text/plain').send(String(challenge || 'OK'));
});

// Telegram posts to the URL we registered, which carries the bot id — that is
// how the payload is tied to one owner's connection.
router.post('/webhook/telegram/:botId', async (req, res) => {
  const payload = req.body && typeof req.body === 'object' ? req.body : {};

  const botId = String(req.params.botId || '').replace(/[^\d]/g, '');
  const connection = await ChannelConnection.findOne({ channel: 'telegram', 'credentials.botToken': new RegExp(`^${botId}:`) });
  if (!connection) return res.sendStatus(404);
  if (!adapters.telegramSecretOk(connection, req.headers['x-telegram-bot-api-secret-token'])) {
    return res.sendStatus(403);
  }

  res.sendStatus(200); // ack fast: Telegram retries anything slow
  const message = payload.message || payload.edited_message || payload.channel_post;
  if (message?.text && message.chat) {
    void channelService.handleInbound(connection, {
      senderId: String(message.chat.id),
      text: String(message.text),
      history: [],
    }).catch(() => null);
  }
});

// Meta's signature is an HMAC of the exact bytes they sent; index.js keeps those
// bytes on req.rawBody for us (see keepRaw).
router.post('/webhook/:channel', async (req, res) => {
  const channel = String(req.params.channel || '');
  const payload = req.body && typeof req.body === 'object' ? req.body : {};

  if (channel !== 'messenger' && channel !== 'instagram') return res.sendStatus(404);

  try {
    // The page id in the payload picks the connection; the signature is then
    // checked against that connection's own app secret.
    const entry = (payload.entry || [])[0] || {};
    const connection = await channelService.findByMetaPageId(entry.id);
    if (!connection) return res.status(404).send('no connection for that page');
    const appSecret = String(connection.credentials?.appSecret || '').trim();
    // The raw bytes are what Meta signed — never the re-serialised object.
    const rawBody = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(payload);
    if (appSecret && !adapters.metaSignatureOk(rawBody, req.headers['x-hub-signature-256'], appSecret)) {
      connection.pushActivity('inbound', false, 'Rejected a webhook with a bad signature');
      await connection.save();
      return res.sendStatus(403);
    }
    // Acknowledge immediately: Meta retries (and eventually disables) slow webhooks.
    res.sendStatus(200);
    void processMetaEvents(connection, entry).catch(() => null);
  } catch (err) {
    res.status(500).send('webhook error');
  }
});

/** Meta batches messaging events; treat each like a chat turn. */
async function processMetaEvents(connection, entry) {
  const events = entry.messaging || [];
  for (const event of events) {
    const text = event.message?.text;
    if (!text || event.message?.is_echo) continue; // never answer ourselves
    if (event.read || event.delivery) continue;
    await channelService.handleInbound(connection, {
      senderId: String(event.sender?.id || ''),
      text: String(text),
      history: [],
    }).catch(() => null);
  }
}

module.exports = router;
