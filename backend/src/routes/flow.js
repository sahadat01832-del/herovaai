const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const flowService = require('../services/flowService');
const channelService = require('../services/channelService');
const ChannelConnection = require('../models/ChannelConnection');
const AIMemory = require('../models/AIMemory');
const { authenticate, optionalAuth } = require('../middleware/auth');

// Status of Google Flow MCP & connected accounts (including per-user quota info)
router.get('/status', optionalAuth, async (req, res) => {
  try {
    const status = await flowService.getStatus();
    const userAccount = req.user ? {
      accountId: req.user.flowAccountId,
      status: req.user.flowAccountStatus || 'unlinked',
      label: req.user.flowAccountLabel || req.user.name,
      connectedAt: req.user.flowAccountConnectedAt,
    } : null;

    res.json({
      ...status,
      userFlowAccount: userAccount,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get supported Flow models and aspect ratios
router.get('/models', (_req, res) => {
  res.json({ success: true, models: flowService.FLOW_MODELS });
});

// Trigger generation (image or video) with on-demand headless spin-up & per-user quota
router.post('/generate', authenticate, async (req, res) => {
  try {
    const { prompt, mediaType = 'image', duration = 6, ratio, model } = req.body;
    if (!prompt?.trim()) {
      return res.status(400).json({ success: false, message: 'Prompt is required' });
    }

    const userSettings = req.user?.chatSettings || {};
    const defaultModel = mediaType === 'video'
      ? (userSettings.flowVideoModel || 'omni-flash')
      : (userSettings.flowImageModel || 'nano-banana-2');
    const defaultRatio = userSettings.flowAspectRatio || ratio || '16:9';

    // Personal user quota account if connected, else user ID
    const accountId = req.user?.flowAccountId || ('user_' + req.user?._id);

    const result = await flowService.generateMedia({
      prompt,
      mediaType,
      duration,
      ratio: ratio || defaultRatio,
      model: model || defaultModel,
      accountId,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Start account connection handshake for the specific logged-in user
router.post('/connect/begin', authenticate, async (req, res) => {
  try {
    const accountId = 'user_' + req.user._id;
    const label = req.user.name || req.user.email;
    const result = await flowService.beginConnect({ accountId, label });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Complete account connection and bind to user in database
router.post('/connect/complete', authenticate, async (req, res) => {
  try {
    const { connectionId } = req.body || {};
    const accountId = 'user_' + req.user._id;
    const label = req.user.name || req.user.email;
    const result = await flowService.completeConnect({ connectionId, accountId, label });

    req.user.flowAccountId = accountId;
    req.user.flowAccountLabel = label;
    req.user.flowAccountStatus = 'connected';
    req.user.flowAccountConnectedAt = new Date();
    await req.user.save();

    res.json({
      success: true,
      result,
      userFlowAccount: {
        accountId,
        label,
        status: 'connected',
        connectedAt: req.user.flowAccountConnectedAt,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Disconnect personal Flow account
router.post('/connect/disconnect', authenticate, async (req, res) => {
  try {
    req.user.flowAccountId = null;
    req.user.flowAccountLabel = null;
    req.user.flowAccountStatus = 'unlinked';
    req.user.flowAccountConnectedAt = null;
    await req.user.save();
    res.json({ success: true, message: 'Google Flow account disconnected successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Download Chrome Extension zip directly for easy client setup
router.get('/extension/download', (req, res) => {
  const zipPath = path.resolve(__dirname, '../../public/flow-login-bridge.zip');
  if (!fs.existsSync(zipPath)) {
    return res.status(404).json({ success: false, message: 'Extension package not found on server.' });
  }
  res.download(zipPath, 'flow-login-bridge.zip');
});

// Direct Session / Cookies connection (Alternative to extension)
router.post('/connect/cookies', authenticate, async (req, res) => {
  try {
    const { rawCookies } = req.body || {};
    if (!rawCookies) {
      return res.status(400).json({ success: false, message: 'Cookies payload is required' });
    }
    const accountId = 'user_' + req.user._id;
    const label = req.user.name || req.user.email;
    const result = await flowService.connectWithCookies({ rawCookies, accountId, label });

    req.user.flowAccountId = accountId;
    req.user.flowAccountLabel = label;
    req.user.flowAccountStatus = 'connected';
    req.user.flowAccountConnectedAt = new Date();
    await req.user.save();

    res.json({
      success: true,
      message: 'Successfully linked your personal Google Flow account!',
      result,
      userFlowAccount: {
        accountId,
        label,
        status: 'connected',
        connectedAt: req.user.flowAccountConnectedAt,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// AI Auto-Generate Social Media Post (Hook, Caption, 10-15 #tags, CTA, Thumbnail recommendation)
router.post('/generate-post', authenticate, async (req, res) => {
  try {
    const { mediaUrl, prompt, platform = 'facebook', customTopic = '' } = req.body;
    const memory = await AIMemory.findOne({ userId: req.user._id }).catch(() => null);
    const isVideo = mediaUrl ? /\.(mp4|webm|mov)(\?|$)/i.test(mediaUrl) : false;
    const mediaType = isVideo ? 'video' : 'image';

    const postData = await flowService.generateSocialPost({
      mediaUrl,
      prompt: prompt || 'High quality creative visual',
      mediaType,
      platform,
      customTopic,
      user: req.user,
      memory,
    });

    res.json({
      success: true,
      post: postData,
      mediaUrl,
      mediaType: postData?.mediaMeta?.isVertical ? 'video_short' : mediaType,
      mediaMeta: postData?.mediaMeta || null,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Direct One-Click Publish to Connected Channels (with Media Attachment)
router.post('/publish-post', authenticate, async (req, res) => {
  try {
    const { channelId, text, mediaUrl } = req.body;
    if (!channelId) {
      return res.status(400).json({ success: false, message: 'channelId is required' });
    }
    if (!text?.trim()) {
      return res.status(400).json({ success: false, message: 'Post text is required' });
    }

    const connection = await ChannelConnection.findOne({ userId: req.user._id, channel: channelId });
    if (!connection) {
      return res.status(404).json({ success: false, message: `Channel ${channelId} is not connected. Connect it first in Connections.` });
    }

    const result = await channelService.publishToConnection(connection, { text: text.trim(), mediaUrl });
    if (!result.ok) {
      return res.status(400).json({ success: false, message: result.message || 'Publish failed', result });
    }

    res.json({
      success: true,
      message: `Successfully published to ${connection.channel}!`,
      result,
      connection: connection.toJSON(),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Serve generated media files with zero buffering (low RAM via sendFile)
router.get('/media/:filename', (req, res) => {
  const filePath = flowService.findMediaFile(req.params.filename);
  if (!filePath) {
    return res.status(404).json({ success: false, message: 'Media file not found' });
  }
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  };
  if (mimeTypes[ext]) {
    res.setHeader('Content-Type', mimeTypes[ext]);
  }
  res.sendFile(filePath);
});

module.exports = router;
