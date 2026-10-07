const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const User = require('../models/User');
const { authenticate } = require('../middleware/auth');

// ─── Get profile ──────────────────────────────────────────────────────────
router.get('/profile', authenticate, async (req, res) => {
  res.json({ success: true, user: req.user });
});

// ─── Update profile ───────────────────────────────────────────────────────
router.put('/profile', authenticate, async (req, res) => {
  try {
    const { name, phone, businessInfo, chatSettings } = req.body;
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: { name, phone, businessInfo, chatSettings } },
      { new: true }
    );
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Change password ──────────────────────────────────────────────────────
router.put('/password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Both fields are required' });
    }

    const user = await User.findById(req.user._id).select('+password');
    if (!user.password) {
      return res.status(400).json({ success: false, message: 'Use Google OAuth to sign in' });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect' });
    }

    user.password = await bcrypt.hash(newPassword, 12);
    await user.save();

    res.json({ success: true, message: 'Password updated successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Update subscription (choose / switch tier) ──────────────────────────
router.put('/subscription', authenticate, async (req, res) => {
  try {
    const { tier } = req.body;
    if (!['free', 'pro', 'enterprise'].includes(tier)) {
      return res.status(400).json({ success: false, message: 'Invalid subscription tier' });
    }

    const user = await User.findById(req.user._id);
    if (!user.subscription) user.subscription = {};
    user.subscription.tier = tier;
    user.subscription.status = 'active';
    user.subscription.startDate = new Date();

    // Adjust limit according to tier
    if (!user.tokenQuota) {
      user.tokenQuota = { weeklyLimit: 1000000, tokensUsed7d: 0, lastResetDate: new Date(), history: [] };
    }
    if (tier === 'enterprise') {
      user.tokenQuota.weeklyLimit = 5000000; // 5M for enterprise
    } else if (tier === 'pro') {
      user.tokenQuota.weeklyLimit = 2000000; // 2M for pro
    } else {
      user.tokenQuota.weeklyLimit = 1000000; // 1M standard
    }

    await user.save();
    res.json({ success: true, message: `Successfully switched to ${tier.toUpperCase()} plan!`, user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
