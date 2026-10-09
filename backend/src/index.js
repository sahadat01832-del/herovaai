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

// Import passport config
require('./config/passport');

// Warm the provider probes in the background: /models composes from them, so the first
// request should not be the one that discovers whether every provider is reachable.
require('./services/catalogService').warm();

const app = express();
// Behind the gateway/tunnel every request arrives from 127.0.0.1, so trust the
// proxy headers to keep real client IPs in the logs and in rate limits.
app.set('trust proxy', true);
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
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
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
  const connectOptions = {
    serverSelectionTimeoutMS: Number(process.env.MONGODB_SELECTION_TIMEOUT_MS || 15000),
    connectTimeoutMS: Number(process.env.MONGODB_CONNECT_TIMEOUT_MS || 15000),
  };
  try {
    await mongoose.connect(uri, connectOptions);
    console.log(`✅ MongoDB connected: ${uri}`);
  } catch (err) {
    console.warn(`⚠️  External MongoDB connection failed (${err.message}). Starting local In-Memory MongoDB...`);
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
  const vaultStats = keyVault.stats();
  console.log(`🔐 Key vault ready: ${vaultStats.slots} slot(s) with runtime keys${vaultStats.hydrationError ? ` (warning: ${vaultStats.hydrationError})` : ''}`);
  if (vaultStats.slots > 0) require('./services/catalogService').refresh();

  // No WhatsApp client survives a restart, so reconcile the stored states before serving.
  await require('./services/wppConnectService').reconcileOnBoot(io);

  // Seed admin on first run
  const { seedAdmin } = require('./utils/seed');
  await seedAdmin();

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
    console.log(`📡 Socket.IO ready`);
  });
}

startServer();

module.exports = { app, io };
