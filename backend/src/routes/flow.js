const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const flowService = require('../services/flowService');
const imageGenerationService = require('../services/imageGenerationService');
const channelService = require('../services/channelService');
const ChannelConnection = require('../models/ChannelConnection');
const AIMemory = require('../models/AIMemory');
const CommercialPost = require('../models/CommercialPost');
const ScheduledPost = require('../models/ScheduledPost');
const { authenticate, optionalAuth, adminOnly } = require('../middleware/auth');

const HOUSE_FLOW_ACCOUNTS = new Map([
  ['ff2', 'FF2 (primary)'],
  ['ff3', 'FF3 (backup 1)'],
  ['ff1', 'FF1 (backup 2)'],
]);

const REFERENCE_IMAGE_TYPES = {
  'image/jpeg': { extension: '.jpg', signature: (buffer) => buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff },
  'image/png': { extension: '.png', signature: (buffer) => buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
  'image/webp': { extension: '.webp', signature: (buffer) => buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP' },
};

function decodeReferenceImage(referenceImage) {
  const type = REFERENCE_IMAGE_TYPES[referenceImage?.mimeType];
  const data = referenceImage?.data;
  if (!type || typeof data !== 'string' || !data || data.length > 900_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
    throw new Error('Choose a JPEG, PNG, or WebP image smaller than 650 KB.');
  }
  const image = Buffer.from(data, 'base64');
  if (!image.length || image.length > 650 * 1024 || !type.signature(image)) {
    throw new Error('The reference image is invalid or too large. Choose another image.');
  }
  return { image, type };
}

function commercialPostSimilarity(left, right) {
  const words = (text) => new Set(
    String(text || '').toLowerCase().replace(/#[\p{L}\p{N}_]+/gu, ' ')
      .match(/[\p{L}\p{N}]{4,}/gu) || []
  );
  const a = words(left);
  const b = words(right);
  if (a.size < 6 || b.size < 6) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / (a.size + b.size - shared);
}

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

    // How many accounts serve everyone. This is what makes "images are free and
    // need no connection" true or false, so the UI can say it plainly instead of
    // asking a visitor to connect an account they do not have.
    const houseAccounts = await flowService.houseAccounts({ status }).catch(() => []);

    res.json({
      ...status,
      userFlowAccount: userAccount,
      houseAccounts: { count: houseAccounts.length, ids: houseAccounts.slice(0, 10) },
      freeForEveryone: houseAccounts.length > 0,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get supported Flow models and aspect ratios
router.get('/models', (_req, res) => {
  res.json({ success: true, models: flowService.FLOW_MODELS });
});

router.get('/image-quota', optionalAuth, async (req, res) => {
  try {
    const quota = await imageGenerationService.getQuota({ user: req.user, ip: req.ip });
    res.json({ success: true, ...quota });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/house/connect/begin', authenticate, adminOnly, async (req, res) => {
  try {
    const accountId = String(req.body?.accountId || '');
    const label = HOUSE_FLOW_ACCOUNTS.get(accountId);
    if (!label) {
      return res.status(400).json({ success: false, message: 'Choose FF2, FF3, or FF1.' });
    }
    const result = await flowService.beginConnect({ accountId, label });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/house/connect/complete', authenticate, adminOnly, async (req, res) => {
  try {
    const accountId = String(req.body?.accountId || '');
    const connectionId = String(req.body?.connectionId || '');
    const label = HOUSE_FLOW_ACCOUNTS.get(accountId);
    if (!label) {
      return res.status(400).json({ success: false, message: 'Choose FF2, FF3, or FF1.' });
    }
    if (!connectionId) {
      return res.status(400).json({ success: false, message: 'Start the account handshake first.' });
    }

    const result = await flowService.completeConnect({ connectionId, accountId, label });
    flowService.houseAccountsCache = { at: 0, ids: [] };
    const connectedIds = await flowService.houseAccounts({ fresh: true });
    res.json({
      success: true,
      result,
      houseAccounts: { count: connectedIds.length, ids: connectedIds },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Trigger generation (image or video) with on-demand headless spin-up & per-user quota
router.post('/generate', optionalAuth, async (req, res) => {
  try {
    const { prompt, mediaType = 'image', duration = 6, ratio, model } = req.body;
    if (!prompt?.trim()) {
      return res.status(400).json({ success: false, message: 'Prompt is required' });
    }

    const userSettings = req.user?.chatSettings || {};
    const savedImageModel = userSettings.flowImageModel;
    const defaultImageModel = savedImageModel || 'nano-banana-pro';
    const defaultModel = mediaType === 'video'
      ? (userSettings.flowVideoModel || 'omni-flash')
      : defaultImageModel;
    const defaultRatio = userSettings.flowAspectRatio || ratio || '16:9';

    // Images try the shared pool first and then a connected personal account.
    // Videos continue using the owner's connected account.
    const accountId = req.user ? flowService.accountIdForGeneration(req.user, mediaType) : null;

    const result = String(mediaType).toLowerCase() === 'image'
      ? await imageGenerationService.generate({
        prompt,
        ratio: ratio || defaultRatio,
        model: model || defaultModel,
        user: req.user,
        ip: req.ip,
      })
      : await flowService.generateMedia({
        prompt,
        mediaType,
        duration,
        ratio: ratio || defaultRatio,
        model: model || defaultModel,
        accountId,
      });
    if (result.code === 'IMAGE_QUOTA_LIMIT') {
      return res.status(429).json({ success: false, ...result });
    }
    res.json({
      success: result.ok !== false,
      ...result,
    });
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
    flowService.invalidateStatusCache();
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

router.post('/commercial-post/reference', authenticate, async (req, res) => {
  try {
    const { image, type } = decodeReferenceImage(req.body);
    const filename = `commercial-${crypto.randomUUID()}${type.extension}`;
    const mediaDirectory = path.resolve(__dirname, '../../public/media');
    await fs.promises.mkdir(mediaDirectory, { recursive: true });
    await fs.promises.writeFile(path.join(mediaDirectory, filename), image, { flag: 'wx', mode: 0o600 });
    res.json({ success: true, mediaUrl: `/api/flow/media/${filename}` });
  } catch (err) {
    const status = /reference image|choose a jpeg/i.test(err.message) ? 400 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
});

router.post('/generate-commercial-post', authenticate, async (req, res) => {
  try {
    const prompt = String(req.body?.prompt || '').trim().slice(0, 2000);
    const customTopic = String(req.body?.customTopic || '').trim().slice(0, 1000);
    const mediaUrl = String(req.body?.mediaUrl || '').trim().slice(0, 500);
    let referenceImage = null;
    if (req.body?.referenceImage) {
      const { image, type } = decodeReferenceImage(req.body.referenceImage);
      referenceImage = { mimeType: req.body.referenceImage.mimeType, data: image.toString('base64') };
    }
    const memory = await AIMemory.findOne({ userId: req.user._id }).catch(() => null);
    const businessInfo = req.user.businessInfo || {};
    const hasBusinessProfile = Boolean(
      memory?.enabled !== false && (
        memory?.businessName || memory?.businessType || memory?.businessDescription || memory?.catalog?.length
      )
    ) || Boolean(businessInfo.name || businessInfo.industry || businessInfo.description);

    if (!prompt && !customTopic && !mediaUrl && !referenceImage && !hasBusinessProfile) {
      return res.status(400).json({
        success: false,
        message: 'Add a short description, upload a reference image, or complete your business profile first.',
      });
    }

    const [generatedPosts, scheduledPosts] = await Promise.all([
      CommercialPost.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(10).select('text').lean(),
      ScheduledPost.find({
        userId: req.user._id,
        channel: 'facebook_page',
        status: { $in: ['scheduled', 'published'] },
      }).sort({ updatedAt: -1 }).limit(10).select('text').lean(),
    ]);
    const recentPosts = [...generatedPosts, ...scheduledPosts]
      .map((post) => String(post.text || '').slice(0, 1200))
      .filter(Boolean)
      .filter((text, index, all) => all.indexOf(text) === index)
      .slice(0, 12);

    let post = null;
    let avoidPosts = recentPosts;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      post = await flowService.generateSocialPost({
        mediaUrl,
        prompt: prompt || 'Create an original Facebook commercial post using the available business details.',
        mediaType: 'image',
        platform: 'facebook_page',
        customTopic,
        user: req.user,
        memory,
        commercialMode: true,
        referenceImage,
        recentPosts: avoidPosts,
        variationId: crypto.randomUUID(),
      });
      const tooSimilar = avoidPosts.some((previous) => commercialPostSimilarity(post.fullPost, previous) >= 0.86);
      if (!tooSimilar) break;
      avoidPosts = [post.fullPost, ...avoidPosts].slice(0, 12);
      post = null;
    }
    if (!post) {
      return res.status(409).json({
        success: false,
        message: 'The last drafts were too similar to recent posts. Change the brief or try again for a fresh angle.',
      });
    }
    if (!post?.fullPost?.trim()) {
      return res.status(502).json({ success: false, message: 'The post generator returned an empty result. Please try again.' });
    }

    const savedPost = await CommercialPost.create({ userId: req.user._id, text: post.fullPost.slice(0, 5000) });
    const retainedPosts = await CommercialPost.find({ userId: req.user._id })
      .sort({ createdAt: -1 }).limit(30).select('_id').lean();
    await CommercialPost.deleteMany({
      userId: req.user._id,
      _id: { $nin: retainedPosts.map((item) => item._id) },
    });

    res.json({
      success: true,
      post: { ...post, fullPost: savedPost.text },
      mediaUrl,
      businessProfileUsed: hasBusinessProfile,
    });
  } catch (err) {
    const status = /reference image/i.test(err.message) ? 400 : 502;
    res.status(status).json({ success: false, message: err.message });
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
