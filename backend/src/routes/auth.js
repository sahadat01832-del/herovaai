const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const passport = require('passport');
const router = express.Router();
const User = require('../models/User');
const AIMemory = require('../models/AIMemory');
const { authenticate } = require('../middleware/auth');

const signToken = (userId) => jwt.sign(
  { id: userId },
  process.env.JWT_SECRET || 'fallback-secret',
  { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
);

// ─── Register ─────────────────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Name, email, and password are required' });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ success: false, message: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const user = await User.create({ name, email: email.toLowerCase(), password: hashedPassword, phone });

    // Create empty AI memory
    await AIMemory.create({ userId: user._id });

    const token = signToken(user._id);
    const userObj = user.toObject();
    delete userObj.password;

    res.status(201).json({ success: true, token, user: userObj });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Login ────────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
    if (!user || !user.password) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    if (!user.isActive) {
      return res.status(403).json({ success: false, message: 'Account is deactivated' });
    }

    // Update last seen
    user.lastSeen = new Date();
    await user.save();

    const token = signToken(user._id);
    const userObj = user.toObject();
    delete userObj.password;

    res.json({ success: true, token, user: userObj });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Google OAuth ─────────────────────────────────────────────────────────
router.get('/google', (req, res, next) => {
  const isConfigured = process.env.GOOGLE_CLIENT_ID &&
    !process.env.GOOGLE_CLIENT_ID.startsWith('your_') &&
    process.env.GOOGLE_CLIENT_SECRET &&
    !process.env.GOOGLE_CLIENT_SECRET.startsWith('your_');

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
  if (!isConfigured) {
    return res.redirect(`${frontendUrl}/login?error=google_not_configured`);
  }

  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

router.get('/google/callback', (req, res, next) => {
  passport.authenticate('google', { session: false, failureRedirect: '/login?error=google' }, (err, user) => {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
    if (err || !user) {
      return res.redirect(`${frontendUrl}/login?error=google_failed`);
    }
    const token = signToken(user._id);
    res.redirect(`${frontendUrl}/auth/callback?token=${token}`);
  })(req, res, next);
});

// ─── Get Me ───────────────────────────────────────────────────────────────
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Logout ───────────────────────────────────────────────────────────────
router.post('/logout', authenticate, (_req, res) => {
  res.json({ success: true, message: 'Logged out successfully' });
});

module.exports = router;
