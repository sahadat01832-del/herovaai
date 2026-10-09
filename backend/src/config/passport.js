const passport = require('passport');
const { Strategy: JwtStrategy, ExtractJwt } = require('passport-jwt');
const User = require('../models/User');

// ─── JWT Strategy ─────────────────────────────────────────────────────────
passport.use(new JwtStrategy({
  jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
  secretOrKey: process.env.JWT_SECRET || 'fallback-secret',
}, async (payload, done) => {
  try {
    const user = await User.findById(payload.id);
    if (!user || !user.isActive) return done(null, false);
    return done(null, user);
  } catch (err) {
    return done(err, false);
  }
}));

// ─── Google OAuth Strategy ────────────────────────────────────────────────
// Registered on demand by services/googleAuth, which reads the client ID and
// secret from the key vault so credentials can be rotated from the dashboard
// without restarting the server. Registering here from .env would freeze them.
passport.serializeUser((user, done) => done(null, user._id));
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});
