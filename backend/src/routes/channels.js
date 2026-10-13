const express = require('express');
const router = express.Router();
const { authenticate, optionalAuth } = require('../middleware/auth');
const ChannelConnection = require('../models/ChannelConnection');
const ScheduledPost = require('../models/ScheduledPost');
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

router.get('/scheduled-posts', authenticate, async (req, res) => {
  try {
    const posts = await ScheduledPost.find({ userId: req.user._id })
      .sort({ scheduledAt: -1 })
      .limit(100)
      .lean();
    res.json({ success: true, posts });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/scheduled-posts', authenticate, async (req, res) => {
  try {
    const channel = String(req.body?.channelId || '').trim();
    const text = String(req.body?.text || '').trim();
    const mediaUrl = String(req.body?.mediaUrl || '').trim();
    const scheduledAt = new Date(req.body?.scheduledAt);
    const definition = registry.channel(channel);
    if (!definition || !definition.capabilities.autoPost || !adapters.publisherFor(channel)) {
      return res.status(409).json({ success: false, message: 'This platform cannot publish scheduled posts.' });
    }
    if (!text || text.length > 5000) {
      return res.status(400).json({ success: false, message: 'Add post text (up to 5,000 characters).' });
    }
    if (!Number.isFinite(scheduledAt.getTime())) {
      return res.status(400).json({ success: false, message: 'Choose a valid date and time.' });
    }
    const delay = scheduledAt.getTime() - Date.now();
    if (delay < 2 * 60 * 1000 || delay > 90 * 24 * 60 * 60 * 1000) {
      return res.status(400).json({ success: false, message: 'Schedule a post at least 2 minutes and no more than 90 days from now.' });
    }
    if (mediaUrl) {
      const base = new URL(channelService.publicBase());
      let target;
      try {
        target = new URL(mediaUrl, base);
      } catch {
        return res.status(400).json({ success: false, message: 'The media link is invalid. Select media created or hosted by HerovaAi.' });
      }
      if (
        target.origin !== base.origin ||
        !/^\/api\/media\/[A-Za-z0-9._-]+$/.test(target.pathname) ||
        target.pathname.includes('..')
      ) {
        return res.status(400).json({ success: false, message: 'Scheduled media must be a HerovaAi media link.' });
      }
    }

    const connection = await ChannelConnection.findOne({
      userId: req.user._id,
      channel,
      status: 'connected',
    });
    if (!connection) {
      return res.status(409).json({ success: false, message: 'Connect and test this platform before scheduling a post.' });
    }
    const hasRealCredentials = Object.entries(connection.credentials || {})
      .some(([key, value]) => key !== 'autoSetup' && String(value ?? '').trim());
    if (!hasRealCredentials && (connection.credentials?.autoSetup || connection.meta?.isAutoSetup)) {
      return res.status(409).json({ success: false, message: 'This platform connection needs to be verified again before scheduling.' });
    }

    const post = await ScheduledPost.create({
      userId: req.user._id,
      connectionId: connection._id,
      channel,
      text,
      mediaUrl,
      scheduledAt,
    });
    res.status(201).json({ success: true, post });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/scheduled-posts/:id', authenticate, async (req, res) => {
  try {
    const post = await ScheduledPost.findOne({
      _id: req.params.id,
      userId: req.user._id,
      status: 'scheduled',
    });
    if (!post) {
      return res.status(404).json({ success: false, message: 'This scheduled post was not found or has already started.' });
    }
    post.status = 'cancelled';
    await post.save();
    res.json({ success: true, post });
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

// Kept as an explicit rejection for older clients. A display name does not
// authenticate a social account, so this endpoint must never create a connection.
router.post('/:id/auto-setup', authenticate, async (req, res) => {
  res.status(409).json({
    success: false,
    code: 'REAL_PLATFORM_AUTH_REQUIRED',
    message: 'A channel cannot be connected by entering its name. Use the verified sign-in or credential steps for this platform.',
  });
});

// Kept as an explicit rejection for older clients; never report unlinked
// platforms as ready to publish.
router.post('/auto-setup-all', authenticate, async (req, res) => {
  res.status(409).json({
    success: false,
    code: 'REAL_PLATFORM_AUTH_REQUIRED',
    message: 'Each social platform must be linked and verified separately. No platforms were connected.',
  });
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
