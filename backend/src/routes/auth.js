const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const passport = require('passport');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const User = require('../models/User');
const AIMemory = require('../models/AIMemory');
const googleAuth = require('../services/googleAuth');
const appSettings = require('../services/appSettings');
const { authenticate } = require('../middleware/auth');

const signToken = (userId) => jwt.sign(
  { id: userId },
  process.env.JWT_SECRET || 'fallback-secret',
  { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
);

// Password endpoints face the open internet: slow down guessing without
// bothering real users (10 tries per 15 min per IP; Google OAuth and /me are
// unaffected — Google throttles its own picker, tokens can't be guessed).
const passwordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts — wait 15 minutes and try again' },
});

// ─── Register ─────────────────────────────────────────────────────────────
router.post('/register', passwordLimiter, async (req, res) => {
  try {
    // The owner can close registrations from the admin panel. Login and Google
    // sign-in stay open for accounts that already exist.
    if (!appSettings.flag('signupsOpen')) {
      return res.status(403).json({
        success: false,
        message: appSettings.platform().notice || 'New sign-ups are paused right now. Please try again later.',
      });
    }

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
    // toJSON() (not toObject()) so the schema's redaction runs: no password hash and no raw
    // agent-platform key in the login payload.
    res.status(201).json({ success: true, token, user: user.toJSON() });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Login ────────────────────────────────────────────────────────────────
router.post('/login', passwordLimiter, async (req, res) => {
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
    res.json({ success: true, token, user: user.toJSON() });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Google OAuth ─────────────────────────────────────────────────────────
// Credentials live in the key vault (falling back to .env), so an owner can paste
// a client ID and secret into the dashboard and the button starts working on the
// next click — no restart, no shell access.

/** Public: lets the sign-in screen explain what is missing instead of guessing. */
router.get('/google/status', async (req, res) => {
  const body = { success: true, ...googleAuth.status(req) };
  // Probing Google costs a request, so it only happens when asked for explicitly
  // (the admin diagnostics view), never on the sign-in page's background call.
  if (String(req.query.probe || '') === '1') {
    const check = await googleAuth.redirectUriAccepted(req);
    body.redirectCheck = { ok: check.ok, reason: check.reason || '', message: check.message || '' };
  }
  res.json(body);
});

/** The strategy, the redirect URI and the return URL are all read from the request. */
router.get('/google', async (req, res, next) => {
  const refererOrigin = req.headers.referer ? (() => {
    try { return new URL(req.headers.referer).origin; } catch (_e) { return null; }
  })() : null;
  const returnTo = req.query.return_to || refererOrigin || googleAuth.frontendUrl(req);
  const strategy = googleAuth.strategyFor(req);
  if (!strategy) {
    return res.redirect(`${returnTo}/login?error=google_not_configured`);
  }

  // Sending someone to Google with an unregistered redirect URI strands them on
  // Google's error page with no way back. Ask first; whenever Google would refuse
  // the click, say so on our own sign-in page with the fix in the message.
  const accepted = await googleAuth.redirectUriAccepted(req);
  if (!accepted.ok && accepted.reason !== 'not-configured') {
    return res.redirect(`${returnTo}/login?error=${encodeURIComponent(accepted.message)}`);
  }

  passport.authenticate(strategy, {
    scope: ['profile', 'email'],
    session: false,
    // Signed and expiring: a forged callback fails the check below instead of
    // handing a session to whoever crafted the URL.
    state: googleAuth.issueState({ returnTo }),
  })(req, res, next);
});

router.get('/google/callback', (req, res, next) => {
  const state = googleAuth.readState(req.query.state);
  const targetFrontend = (state?.returnTo && /^https?:\/\//.test(state.returnTo))
    ? state.returnTo.replace(/\/+$/, '')
    : googleAuth.frontendUrl(req);

  if (!state?.n) {
    return res.redirect(`${targetFrontend}/login?error=oauth_state`);
  }

  // Two jobs share this callback because they share one registered redirect URI —
  // that URI is the thing an owner has to paste into Google, so there is exactly
  // one of them. The signed state says which job this is.
  const purpose = state.purpose || 'signin';

  // Each job has its own strategy (connecting a channel must not resolve a user), so
  // the callback has to finish with the same one that started it.
  const strategy = purpose === 'youtube' ? googleAuth.youtubeStrategyFor(req) : googleAuth.strategyFor(req);
  if (!strategy) {
    return purpose === 'youtube'
      ? res.redirect(`${targetFrontend}/dashboard/connections?youtube=unconfigured`)
      : res.redirect(`${targetFrontend}/login?error=google_not_configured`);
  }

  const handler = purpose === 'youtube'
    ? async (err, user, info) => {
      if (err || !info) {
        return res.redirect(`${targetFrontend}/dashboard/connections?youtube=failed`);
      }
      try {
        const result = await attachYoutubeAccount(state.uid, info, req);
        return res.redirect(`${targetFrontend}/dashboard/connections?youtube=${result.ok ? 'connected' : 'failed'}`);
      } catch (attachErr) {
        console.warn(`[youtube connect] ${attachErr.message}`);
        return res.redirect(`${targetFrontend}/dashboard/connections?youtube=failed`);
      }
    }
    : (err, user) => {
      if (err || !user) {
        const reason = err && err.message ? encodeURIComponent(err.message.slice(0, 120)) : 'google_failed';
        return res.redirect(`${targetFrontend}/login?error=${reason}`);
      }
      const token = signToken(user._id);
      return res.redirect(`${targetFrontend}/auth/callback?token=${token}`);
    };

  passport.authenticate(strategy, { session: false }, handler)(req, res, next);
});

/* ─────────────────── one-click YouTube (no console, no tokens) ──────────── */

/**
 * Store the tokens Google just handed us on the owner's YouTube connection.
 *
 * The credentials land in the same place a hand-pasted token would, so the
 * publishing and comment-reply code does not care which path filled them in.
 * Refresh token + client id/secret are saved too, which is what lets the
 * connection renew itself instead of expiring in an hour.
 */
async function attachYoutubeAccount(userId, info, req) {
  const connectionService = require('../services/channelService');
  const ChannelConnection = require('../models/ChannelConnection');
  const user = await User.findById(userId);
  if (!user) return { ok: false, message: 'That account no longer exists.' };

  const credentials = {
    accessToken: info.accessToken || '',
    refreshToken: info.refreshToken || '',
    clientId: googleAuth.credentials().clientId || '',
    clientSecret: googleAuth.credentials().clientSecret || '',
  };
  if (!credentials.accessToken && !credentials.refreshToken) {
    return { ok: false, message: 'Google did not return a usable token.' };
  }

  const connection = await ChannelConnection.findOne({ userId: user._id, channel: 'youtube' })
    || new ChannelConnection({ userId: user._id, channel: 'youtube' });
  connection.credentials = { ...(connection.credentials || {}), ...credentials };
  connection.label = connection.label || user.name || 'YouTube';
  // Google access tokens last an hour. Recording when this one dies is what lets the
  // adapter use it directly instead of renewing before every single call — and it
  // renews in time on its own once the stamp passes.
  connection.meta = { ...(connection.meta || {}), youtubeTokenExpiresAt: Date.now() + 55 * 60 * 1000 };
  await connection.save();

  const test = await connectionService.testConnection(connection);
  return { ok: Boolean(test.ok), message: test.message };
}

/**
 * Start a one-click YouTube connection: the app's own Google client does the
 * consent screen, scoped to YouTube, with offline access so the connection keeps
 * working after the hour-long access token expires.
 */
router.get('/google/youtube', async (req, res, next) => {
  const frontendUrl = googleAuth.frontendUrl(req);
  const strategy = googleAuth.youtubeStrategyFor(req);
  if (!strategy) {
    return res.redirect(`${frontendUrl}/dashboard/connections?youtube=unconfigured`);
  }
  const state = String(req.query.state || '');
  const claims = googleAuth.readState(state);
  if (!claims?.uid || claims.purpose !== 'youtube') {
    // No valid, owner-bound state means this was not started from the dashboard.
    return res.redirect(`${frontendUrl}/dashboard/connections?youtube=expired`);
  }

  // Same reasoning as sign-in: never hand the browser to Google when Google will
  // refuse this address — say so where the owner can read it.
  const accepted = await googleAuth.redirectUriAccepted(req);
  if (!accepted.ok && accepted.reason !== 'not-configured') {
    return res.redirect(`${frontendUrl}/dashboard/connections?youtube=address`);
  }

  passport.authenticate(strategy, {
    scope: googleAuth.YOUTUBE_SCOPES,
    accessType: 'offline',   // ask for a refresh token
    prompt: 'consent',       // ...and actually receive one, every time
    session: false,
    state,
  })(req, res, next);
});

/**
 * The dashboard asks for this first: a short-lived, signed state that names the
 * owner asking, so the callback cannot be aimed at somebody else's account.
 */
router.post('/google/youtube/start', authenticate, (req, res) => {
  const state = googleAuth.issueState({ purpose: 'youtube', uid: String(req.user._id) });
  res.json({ success: true, state, url: `/api/auth/google/youtube?state=${encodeURIComponent(state)}` });
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
