require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const mongoose = require('mongoose');
const { createServer } = require('http');
const { Server } = require('socket.io');
const passport = require('passport');
const session = require('express-session');

// Import routes
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const chatRoutes = require('./routes/chat');
const whatsappRoutes = require('./routes/whatsapp');
const memoryRoutes = require('./routes/memory');
const userRoutes = require('./routes/user');
const paymentRoutes = require('./routes/payments');
const channelRoutes = require('./routes/channels');
const flowRoutes = require('./routes/flow');
const platformRoutes = require('./routes/platform');

// Import passport config
require('./config/passport');

// NOTE: catalog warm() used to run here at require time. It fires a storm of
// HTTPS+DNS probes, and on a flaky line those clog libuv's 4-thread DNS pool —
// starving the Mongo driver's own `localhost` lookup until server selection
// timed out and the app fell back to throwaway in-memory storage. It now runs
// after the database is up (see startServer below).
const warmCatalog = () => require('./services/catalogService').warm();

const app = express();
// Behind the gateway/tunnel every request arrives from 127.0.0.1, so trust the
// proxy headers to keep real client IPs in the logs and in rate limits.
//
// A hop COUNT, not `true`: `true` trusts every hop, so Express takes the leftmost
// X-Forwarded-For entry — a value the caller writes themselves — and anyone could
// rotate it to reset the login rate-limit bucket (express-rate-limit flags exactly
// this as ERR_ERL_PERMISSIVE_TRUST_PROXY). Two hops is this deployment's real
// chain: cloudflared → gateway → here. The gateway appends its own view of the
// peer, so the forged entries a client sends are pushed left of the trusted pair
// and ignored, while the genuine client address survives.
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 2));

// A WhatsApp library that closes a browser mid-scan can reject a promise nobody
// is holding any more. An unhandled rejection kills the whole process by default,
// which would take every owner's auto-replies down with it — so log it and keep
// serving. Real crashes (uncaught exceptions, boot failures) still stop the app.
process.on('unhandledRejection', (reason) => {
  const message = reason && reason.message ? reason.message : String(reason);
  console.error(`⚠️  Unhandled rejection (kept running): ${message}`);
});
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => callback(null, true),
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// ─── Middleware ─────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(morgan('dev'));
// Keep the exact bytes of every body on req.rawBody. Meta signs the raw payload
// (an HMAC of the bytes they sent), so verifying a webhook signature after the
// JSON parser has reserialised the object would always fail.
const keepRaw = (req, _res, buf) => { if (buf?.length) req.rawBody = buf; };
app.use(express.json({ limit: '10mb', verify: keepRaw }));
app.use(express.urlencoded({ extended: true, verify: keepRaw }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 },
}));
app.use(passport.initialize());
app.use(passport.session());

// Attach io to request
app.use((req, _res, next) => { req.io = io; next(); });

// ─── Routes ─────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/memory', memoryRoutes);
app.use('/api/user', userRoutes);
app.use('/api/payments', paymentRoutes);
// Channel connections + the platform webhooks (Meta, Telegram) that call home.
app.use('/api/channels', channelRoutes);
app.use('/api/flow', flowRoutes);
// Public switches only (notice banner, is checkout open) — safe without a login.
app.use('/api/platform', platformRoutes);
app.use('/api/media', (req, res, next) => {
  req.url = '/media' + req.url;
  flowRoutes(req, res, next);
});

// Health check
app.get('/api/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date() }));

// ─── Socket.IO ──────────────────────────────────────────────────────────────
const setupSocketIO = require('./services/socketService');
setupSocketIO(io);

// ─── Error Handler ──────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
});

// ─── Connect & Start ─────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

async function startServer() {
  // A short selection timeout used to drop the app onto a throwaway in-memory
  // database whenever the host was busy (e.g. right after another service boot),
  // which looked exactly like "my saved chats disappeared". Give the real
  // database a fair chance before falling back.
  let uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/contentbot';
  // Never make the database depend on DNS: a literal `localhost` hostname costs
  // a threadpool getaddrinfo, which stalls behind unrelated slow lookups on a
  // flaky line (exactly how boots fell back to in-memory storage). 127.0.0.1
  // connects without touching the resolver.
  try {
    const parsed = new URL(uri);
    if (parsed.hostname === 'localhost') {
      parsed.hostname = '127.0.0.1';
      uri = parsed.toString();
    }
  } catch (_e) { /* keep the URI as configured */ }
  const connectOptions = {
    serverSelectionTimeoutMS: Number(process.env.MONGODB_SELECTION_TIMEOUT_MS || 15000),
    connectTimeoutMS: Number(process.env.MONGODB_CONNECT_TIMEOUT_MS || 15000),
  };
  let attempts = 0;
  for (;;) {
    try {
      await mongoose.connect(uri, connectOptions);
      console.log(`✅ MongoDB connected: ${uri}`);
      break;
    } catch (err) {
      attempts += 1;
      // One retry: a single slow lookup storm (boot probes, slow disk wake) must
      // not throw away the persistent database. Anything persistent still falls
      // through to memory below.
      if (attempts >= 2) {
        console.warn(`⚠️  External MongoDB connection failed (${err.message}). Starting local In-Memory MongoDB...`);
        break;
      }
      console.warn(`⚠️  MongoDB connect attempt ${attempts} failed (${err.message}) — retrying once...`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  if (mongoose.connection.readyState !== 1) {
    try {
      const { MongoMemoryServer } = require('mongodb-memory-server');
      const mongod = await MongoMemoryServer.create({
        instance: { dbName: 'contentbot' }
      });
      uri = mongod.getUri();
      await mongoose.connect(uri, connectOptions);
      console.log(`✅ In-Memory MongoDB connected: ${uri} (data will not survive a restart)`);
    } catch (memErr) {
      console.error('❌ Failed to start in-memory MongoDB:', memErr.message);
      process.exit(1);
    }
  }

  // Load runtime-rotated API keys before anything answers a request, then re-probe the model
  // catalog because availability depends on which keys exist.
  const keyVault = require('./services/keyVault');
  await keyVault.hydrate();
  // Dashboard-editable configuration (Nagad wallet, channel settings) must be in
  // memory before the first payment or scheduled post reads it.
  await require('./services/appSettings').hydrate();
  const vaultStats = keyVault.stats();
  console.log(`🔐 Key vault ready: ${vaultStats.slots} slot(s) with runtime keys${vaultStats.hydrationError ? ` (warning: ${vaultStats.hydrationError})` : ''}`);
  if (vaultStats.slots > 0) require('./services/catalogService').refresh();

  // Catalog probes warmed only now that the database owns the event loop —
  // never before the connect above (see the note at warmCatalog).
  warmCatalog();

  // No WhatsApp client survives a restart, so reconcile the stored states before serving.
  await require('./services/wppConnectService').reconcileOnBoot(io);
  // Then keep the waiting list moving: a queued session starts by itself as soon
  // as a slot frees, including when a browser died without telling anyone.
  require('./services/wppConnectService').startQueueDrain();

  // Seed admin on first run
  const { seedAdmin } = require('./utils/seed');
  await seedAdmin();

  // Daily channel posts and YouTube comment replies run on a timer, not on a
  // request — start it only once the database is really up.
  require('./services/channelScheduler').start();

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
    console.log(`📡 Socket.IO ready`);
  });
}

startServer();

module.exports = { app, io };
