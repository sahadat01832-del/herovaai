const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const User = require('../models/User');
const keyVault = require('../services/keyVault');
const { authenticate } = require('../middleware/auth');

const AGENT_SLOT = 'CONTENTBOT_API_KEY';

/**
 * Shape returned to the owner of the key — never the value itself.
 *
 * Derived from the document field, not from the serializer's `hasContentbotApiKey` virtual:
 * those exist only after toJSON(), so reading them here reported "not configured" for a key that
 * was in fact saved.
 */
function keyStatus(user) {
  const raw = String(user.contentbotApiKey || '').trim();
  return {
    configured: Boolean(raw),
    masked: raw ? keyVault.mask(raw) : '',
    updatedAt: user.updatedAt || null,
    endpoint: (process.env.CONTENTBOT_API_URL || '').trim() || null,
    envFallback: Boolean((process.env.CONTENTBOT_API_KEY || '').trim()),
  };
}

// ─── Get profile ──────────────────────────────────────────────────────────
router.get('/profile', authenticate, async (req, res) => {
  res.json({ success: true, user: req.user });
});

// ─── Update profile ───────────────────────────────────────────────────────
// Only the fields actually present are written, and nested objects merge: a Settings form that
// edits the phone number must not blank out the business profile it never rendered.
router.put('/profile', authenticate, async (req, res) => {
  try {
    const { name, phone, businessInfo, chatSettings } = req.body || {};
    const $set = {};
    if (name !== undefined) $set.name = String(name).trim();
    if (phone !== undefined) $set.phone = String(phone).trim();

    for (const [field, incoming] of [['businessInfo', businessInfo], ['chatSettings', chatSettings]]) {
      if (!incoming || typeof incoming !== 'object') continue;
      const current = req.user[field] ? req.user[field].toObject() : {};
      $set[field] = { ...current, ...incoming };
    }

    if (Object.keys($set).length === 0) {
      return res.status(400).json({ success: false, message: 'Nothing to update' });
    }

    const user = await User.findByIdAndUpdate(req.user._id, { $set }, { new: true, runValidators: true });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Agent platform API key ───────────────────────────────────────────────
// This route pair is what the Settings screen calls. It did not exist before, so "Save Key"
// always failed with a 404 while the client kept showing a success path.
router.get('/api-key', authenticate, async (req, res) => {
  res.json({ success: true, key: keyStatus(req.user) });
});

router.put('/api-key', authenticate, async (req, res) => {
  try {
    const raw = req.body?.contentbotApiKey ?? req.body?.apiKey ?? '';
    const value = String(raw || '').trim();

    if (!value) return res.status(400).json({ success: false, message: 'Paste an API key first' });
    if (value.length < 8) return res.status(400).json({ success: false, message: 'That key is too short to be valid' });
    if (value.length > 512) return res.status(400).json({ success: false, message: 'API keys are at most 512 characters' });
    if (/\s/.test(value)) return res.status(400).json({ success: false, message: 'The key contains whitespace — it may have been copied with a line break' });

    // A saved key that is byte-identical to the existing one is a no-op, not an error: the UI
    // shows "already saved" instead of pretending something changed.
    const current = String(req.user.contentbotApiKey || '').trim();
    const unchanged = current === value;

    if (!unchanged) {
      req.user.contentbotApiKey = value;
      await req.user.save();
    }

    res.json({
      success: true,
      unchanged,
      message: unchanged ? 'That key is already saved' : 'Agent platform key saved',
      key: keyStatus(req.user),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/** Prove a key works before (or after) saving it. `value` is optional — omitted means "test what is saved". */
router.post('/api-key/verify', authenticate, async (req, res) => {
  try {
    const draft = String(req.body?.value || '').trim();
    const saved = String(req.user.contentbotApiKey || '').trim();
    const value = draft || saved;

    if (!value) {
      return res.status(400).json({ success: false, message: 'No key to test — paste one first' });
    }

    const result = await keyVault.testKey({ envName: AGENT_SLOT, value });
    res.json({
      success: true,
      tested: draft ? 'draft' : 'saved',
      result,
      key: keyStatus(req.user),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/** Revoke: clears the user's own key so the platform env key (if any) becomes the fallback. */
router.delete('/api-key', authenticate, async (req, res) => {
  try {
    if (!req.user.contentbotApiKey) {
      return res.json({ success: true, changed: false, message: 'No personal key was stored', key: keyStatus(req.user) });
    }
    req.user.contentbotApiKey = null;
    await req.user.save();
    res.json({ success: true, changed: true, message: 'Agent platform key revoked', key: keyStatus(req.user) });
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
    if (String(newPassword).length < 8) {
      return res.status(400).json({ success: false, message: 'New password must be at least 8 characters' });
    }

    const user = await User.findById(req.user._id).select('+password');
    if (!user.password) {
      return res.status(400).json({ success: false, message: 'This account signs in with Google, so it has no password to change' });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect' });
    }
    if (await bcrypt.compare(newPassword, user.password)) {
      return res.status(400).json({ success: false, message: 'The new password matches the current one' });
    }

    user.password = await bcrypt.hash(newPassword, 12);
    await user.save();

    res.json({ success: true, message: 'Password updated successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Update subscription (choose / switch tier) ──────────────────────────
// Paid tiers can ONLY arrive through a validated gateway callback
// (routes/payments.js): anyone choosing pro/enterprise here gets a 402
// pointing at checkout. Downgrades to free stay self-serve; admins keep
// their override in routes/admin.js.
router.put('/subscription', authenticate, async (req, res) => {
  try {
    const { tier } = req.body;
    if (!['free', 'pro', 'enterprise'].includes(tier)) {
      return res.status(400).json({ success: false, message: 'Invalid subscription tier' });
    }
    if (tier !== 'free') {
      return res.status(402).json({
        success: false,
        code: 'PAYMENT_REQUIRED',
        message: `${tier.toUpperCase()} needs checkout — use the Pay button, it switches on automatically once paid`,
      });
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
