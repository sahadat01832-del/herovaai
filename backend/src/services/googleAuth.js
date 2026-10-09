/**
 * "Continue with Google" — credentials, strategy and setup instructions.
 *
 * Google only allows a sign-in button once an OAuth client exists for the exact
 * redirect URI. This service owns the whole story:
 *
 *  - credentials come from the key vault (falling back to .env), so a client ID
 *    and secret saved in the dashboard work without a restart;
 *  - the redirect URI and the return-to URL are derived from the request, so the
 *    same server signs people in on localhost, on the LAN and on today's public
 *    tunnel hostname with nothing to reconfigure;
 *  - the flow carries a signed `state`, so a forged callback cannot log anyone in;
 *  - status() reports the two URLs that must be pasted into Google Cloud Console.
 *
 * A request-derived redirect URI is safe: Google refuses any redirect_uri that is
 * not registered for the client, so a spoofed Host header can only produce an
 * error, never a token delivered to the wrong place.
 */

const passport = require('passport');
const jwt = require('jsonwebtoken');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const keyVault = require('./keyVault');

const CLIENT_ID_SLOT = 'GOOGLE_CLIENT_ID';
const CLIENT_SECRET_SLOT = 'GOOGLE_CLIENT_SECRET';
const STATE_TTL = '10m';

/** The port this API listens on when nothing is proxying it (see scripts/gateway.js). */
const apiPort = () => String(process.env.PORT || 5000);

/**
 * True for calls that hit the API directly on its own port instead of through the
 * gateway. Only that exact port counts: the gateway also answers on 127.0.0.1, but
 * on its own port, and its requests must be treated as coming from a real origin.
 */
const isDirectBackendHost = (host) => host === `localhost:${apiPort()}` || host === `127.0.0.1:${apiPort()}`;

/** A value that is a template, not a credential. */
const isPlaceholder = (value) => {
  const text = String(value || '').trim();
  if (!text) return true;
  return (
    text.startsWith('your_') ||
    text.startsWith('<') ||
    /^(changeme|placeholder|xxx+|todo)/i.test(text)
  );
};

const envFrontendUrl = () => (process.env.FRONTEND_URL || 'http://localhost:3001').replace(/\/+$/, '');

const header = (req, name) => {
  const value = req && req.headers ? req.headers[name] : undefined;
  return Array.isArray(value) ? value[0] : value;
};

/** proto://host exactly as the visitor reached us. */
function requestOrigin(req) {
  if (!req || !req.headers) return '';
  const host = header(req, 'x-forwarded-host') || header(req, 'host');
  if (!host) return '';
  const proto = header(req, 'x-forwarded-proto') || req.protocol || 'http';
  return `${proto}://${host}`.replace(/\/+$/, '');
}

/**
 * Where to send the browser back to after Google. Same origin as the request in
 * the normal case (the gateway serves both halves of the app); the configured
 * frontend when the API is being called directly on its own port.
 */
function frontendUrl(req) {
  const origin = requestOrigin(req);
  if (!origin) return envFrontendUrl();
  // Called straight on the API's own port: the frontend lives elsewhere (its own
  // port in development, the configured URL otherwise).
  if (isDirectBackendHost(origin.replace(/^https?:\/\//, ''))) return envFrontendUrl();
  return origin;
}

/**
 * The redirect URI that belongs to the request in hand. Falls back to
 * GOOGLE_CALLBACK_URL (or the configured frontend) when there is no request,
 * which is what the status endpoint used to report.
 */
function callbackUrlFor(req) {
  const configured = (process.env.GOOGLE_CALLBACK_URL || '').trim();
  const origin = requestOrigin(req);
  if (!origin) {
    return configured || `${envFrontendUrl()}/api/auth/google/callback`;
  }
  const host = origin.replace(/^https?:\/\//, '');
  // Direct API calls on its own port keep the URL that was configured for them.
  if (isDirectBackendHost(host) && configured) return configured;
  return `${origin}/api/auth/google/callback`;
}

/** Where the credentials came from, so the UI can say "from .env" vs "saved here". */
function credentials() {
  const clientId = (keyVault.firstKey([CLIENT_ID_SLOT]) || '').trim();
  const clientSecret = (keyVault.firstKey([CLIENT_SECRET_SLOT]) || '').trim();
  return {
    clientId,
    clientSecret,
    source: keyVault.sourceOf(CLIENT_ID_SLOT) || 'missing',
    secretSource: keyVault.sourceOf(CLIENT_SECRET_SLOT) || 'missing',
    configured: !isPlaceholder(clientId) && !isPlaceholder(clientSecret),
  };
}

/**
 * The single-page checklist the owner (or whoever sets the shop up) follows.
 * Order matters: it is exactly the order of the Google Cloud Console screens.
 */
function setupSteps(req) {
  const redirect = callbackUrlFor(req);
  const origin = frontendUrl(req);
  const localRedirect = `${envFrontendUrl()}/api/auth/google/callback`;
  const steps = [
    {
      title: 'Create an OAuth client',
      detail: 'Google Cloud Console → APIs & Services → Credentials → Create credentials → OAuth client ID → Web application.',
      link: 'https://console.cloud.google.com/apis/credentials',
    },
    {
      title: 'Add the authorised origin',
      detail: `Under "Authorised JavaScript origins" add ${origin}`,
      value: origin,
    },
    {
      title: 'Add the authorised redirect URI',
      detail: `Under "Authorised redirect URIs" add ${redirect} — it must match character for character.`,
      value: redirect,
    },
  ];
  if (localRedirect !== redirect) {
    steps.push({
      title: 'Add the localhost URI too (optional)',
      detail: `If you also sign in while testing on this machine, add ${localRedirect} as a second redirect URI.`,
      value: localRedirect,
    });
  }
  steps.push(
    {
      title: 'Paste the client ID and secret',
      detail: 'Copy them from the dialog Google shows, then save both here. The secret is stored write-only and never shown again.',
    },
    {
      title: 'Test it',
      detail: 'Press Test once for each value. Google answering "invalid_grant" means the pair is correct — the button on the sign-in page switches on immediately.',
    }
  );
  return steps;
}

function status(req) {
  const { configured, clientId, source } = credentials();
  return {
    configured,
    // A placeholder from .env is not a credential worth previewing.
    clientIdMasked: configured ? keyVault.mask(clientId) : '',
    source,
    redirectUri: callbackUrlFor(req),
    javascriptOrigin: frontendUrl(req),
    signInPath: '/api/auth/google',
    slots: [CLIENT_ID_SLOT, CLIENT_SECRET_SLOT],
    steps: setupSteps(req),
  };
}

/* ────────────────────────── strategy registration ─────────────────────── */

/**
 * One strategy per (credentials, redirect URI) pair, stored under a stable name.
 * Keyed this way, rotating a secret in the dashboard — or reaching the app on a
 * new hostname — registers a fresh strategy instead of reusing a stale one, and
 * two hostnames in use at once no longer overwrite each other.
 */
const registered = new Map();

function strategyNameFor({ clientId, clientSecret, callbackURL }) {
  const fingerprint = `${clientId}|${clientSecret.length}|${callbackURL}`;
  // Encoded, not hashed: the name only has to be unique and URL-safe, and keeping
  // the fingerprint readable in the name makes a stale strategy easy to spot.
  const name = `google:${Buffer.from(fingerprint).toString('base64url').slice(0, 28)}`;
  return { fingerprint, name };
}

/** Google hands back the profile; turn it into the same user document the rest of the app uses. */
async function resolveUser(accessToken, refreshToken, profile, done) {
  try {
    // Required lazily so this module can be required before the database is up.
    const User = require('../models/User');
    const AIMemory = require('../models/AIMemory');

    const email = (profile.emails || [])
      .map((entry) => (entry.value || '').toLowerCase().trim())
      .find(Boolean);
    const avatar = (profile.photos || []).map((entry) => entry.value).find(Boolean) || '';

    let user = await User.findOne({ googleId: profile.id });

    if (!user && email) user = await User.findOne({ email });

    if (user) {
      let touched = false;
      if (!user.googleId) { user.googleId = profile.id; touched = true; }
      if (!user.avatar && avatar) { user.avatar = avatar; touched = true; }
      if (!user.name && profile.displayName) { user.name = profile.displayName; touched = true; }
      if (touched) await user.save();
    } else {
      if (!email) return done(null, false);
      user = await User.create({
        name: profile.displayName || email.split('@')[0],
        email,
        googleId: profile.id,
        avatar,
        emailVerified: true,
      });
      await AIMemory.create({ userId: user._id });
    }

    if (!user.isActive) return done(null, false);
    user.lastSeen = new Date();
    await user.save();
    return done(null, user);
  } catch (err) {
    return done(err, null);
  }
}

/**
 * Make sure a strategy exists for this request's redirect URI.
 * Returns the strategy name to authenticate with, or null when no usable
 * credentials are stored. Cheap to call on every request.
 */
function strategyFor(req) {
  const { clientId, clientSecret, configured } = credentials();
  if (!configured) return null;

  const callbackURL = callbackUrlFor(req);
  const { name, fingerprint } = strategyNameFor({ clientId, clientSecret, callbackURL });
  if (registered.get(name) === fingerprint) return name;

  passport.use(name, new GoogleStrategy(
    { clientID: clientId, clientSecret, callbackURL, scope: ['profile', 'email'] },
    resolveUser
  ));
  registered.set(name, fingerprint);
  return name;
}

/** Backwards-compatible readiness check; with no request it uses the configured URL. */
const isReady = (req) => Boolean(strategyFor(req));

/** Kept for callers that used to poke the old cache (the vault invalidates on save). */
function invalidate() {
  registered.clear();
}

/* ───────────────────────────── CSRF state ─────────────────────────────── */

/** A signed, expiring state value Google echoes back untouched. */
function issueState() {
  return jwt.sign(
    { n: require('crypto').randomBytes(16).toString('hex') },
    process.env.JWT_SECRET || 'fallback-secret',
    { expiresIn: STATE_TTL }
  );
}

/** True when the state came from this server and has not expired. */
function checkState(state) {
  const value = String(state || '');
  if (!value) return false;
  try {
    const payload = jwt.verify(value, process.env.JWT_SECRET || 'fallback-secret');
    return Boolean(payload && payload.n);
  } catch (_err) {
    return false;
  }
}

module.exports = {
  CLIENT_ID_SLOT,
  CLIENT_SECRET_SLOT,
  credentials,
  status,
  setupSteps,
  strategyFor,
  ensureStrategy: strategyFor,
  isReady,
  invalidate,
  callbackUrl: callbackUrlFor,
  frontendUrl,
  requestOrigin,
  issueState,
  checkState,
  isPlaceholder,
};
