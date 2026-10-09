const express = require('express');
const router = express.Router();
const appSettings = require('../services/appSettings');

/**
 * Public platform status — what every visitor may know, and nothing else.
 *
 * The dashboard and the marketing site read this to show the owner's notice
 * banner and to disable buttons that would only produce an error (checkout while
 * payments are paused, sign-up while registration is closed). It exposes flags
 * only: no counts, no keys, no per-user facts.
 */
router.get('/status', (_req, res) => {
  const platform = appSettings.platform();
  res.json({
    success: true,
    status: {
      notice: platform.notice || '',
      signupsOpen: Boolean(platform.signupsOpen),
      paymentsOpen: Boolean(platform.paymentsOpen),
      aiReplies: Boolean(platform.aiReplies),
      autoPosts: Boolean(platform.autoPosts),
      whatsappEnabled: Boolean(platform.whatsappEnabled),
      channelsEnabled: Boolean(platform.channelsEnabled),
      updatedAt: new Date().toISOString(),
    },
  });
});

module.exports = router;
