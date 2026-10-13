/**
 * Socket.IO Service
 * Handles real-time events for chat, WhatsApp, and admin monitoring.
 *
 * Two rules hold everywhere below, because a socket is direct access to a live feed:
 *
 *   1. Joining a room is a permission check, not a string join. Rooms are named after
 *      someone's data (`conv-<id>`, `wa-<id>`), so "join whatever id I send" let any
 *      signed-in owner subscribe to another business's conversation. Every join now
 *      proves ownership first — admins excepted, where the panel is meant to see all.
 *   2. Broadcasts only go to rooms the socket is already a member of, so a client cannot
 *      push fake "typing" (or anything else) into a room it never joined.
 */

const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
const Conversation = require('../models/Conversation');
const WhatsAppSession = require('../models/WhatsAppSession');

// One browser/tab per view is normal; a hundred sockets from one account is not, and
// each one costs memory on a small host. Refusing past the cap keeps a stuck client
// (or a script) from becoming everyone's outage.
const MAX_SOCKETS_PER_USER = Number(process.env.MAX_SOCKETS_PER_USER || 12);
const socketCounts = new Map();

function isValidId(value) {
  return typeof value === 'string' && mongoose.Types.ObjectId.isValid(value);
}

function setupSocketIO(io) {
  // Auth middleware for socket connections
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) return next(new Error('Authentication required'));

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret');
      const user = await User.findById(decoded.id);
      if (!user) return next(new Error('User not found'));
      socket.user = user;
      next();
    } catch (_err) {
      next(new Error('Invalid token'));
    }
  });

  // Keep a stalled client from holding a half-open socket on a small host.
  io.engine.on('connection_error', (err) => {
    console.warn(`🔌 Socket handshake error: ${err.code || ''} ${err.message || ''}`.trim());
  });

  io.on('connection', (socket) => {
    const user = socket.user;
    const key = String(user._id);
    const now = (socketCounts.get(key) || 0) + 1;
    socketCounts.set(key, now);
    if (now > MAX_SOCKETS_PER_USER) {
      console.warn(`🔌 Socket refused: ${user.email} already has ${now - 1} live connection(s)`);
      socket.emit('connection-refused', {
        message: `Too many live connections for this account (max ${MAX_SOCKETS_PER_USER}). Close another tab and reload.`,
      });
      socket.disconnect(true);
      return;
    }

    console.log(`🔌 Socket connected: ${user.name} (${user.role})`);

    // Join personal room
    socket.join(`user-${user._id}`);

    // Admin joins admin room
    if (user.role === 'admin') {
      socket.join('admin-room');
      console.log(`👑 Admin joined admin-room: ${user.name}`);
    }

    /** May this socket talk about this conversation? Owner, public feed, or admin. */
    const mayUseConversation = async (conversationId) => {
      if (!isValidId(conversationId)) return false;
      if (user.role === 'admin') return true;
      const convo = await Conversation.findById(conversationId).select('userId isPublic').lean();
      if (!convo) return false;
      return convo.isPublic === true || String(convo.userId) === String(user._id);
    };

    /** Only the owner's own WhatsApp session may be followed. */
    const mayUseWaSession = async (sessionName) => {
      const id = String(sessionName || '');
      if (!id) return false;
      if (user.role === 'admin') return true;
      const query = isValidId(id) ? { _id: id } : { sessionName: id };
      const session = await WhatsAppSession.findOne({ ...query, userId: user._id }).select('_id').lean();
      return Boolean(session);
    };

    // ─── Chat events ─────────────────────────────────────────────────────
    socket.on('join-conversation', async (conversationId) => {
      try {
        if (!await mayUseConversation(conversationId)) return;
        socket.join(`conv-${conversationId}`);
      } catch (_err) { /* a bad id is simply not joined */ }
    });

    socket.on('leave-conversation', (conversationId) => {
      socket.leave(`conv-${conversationId}`);
    });

    // Typing indicator — only inside a room this socket actually belongs to.
    const typing = (event) => ({ conversationId }) => {
      const room = `conv-${conversationId}`;
      if (!socket.rooms.has(room)) return;
      socket.to(room).emit(event, { userId: user._id });
    };
    socket.on('typing-start', typing('user-typing'));
    socket.on('typing-stop', typing('user-stopped-typing'));

    // ─── WhatsApp events ──────────────────────────────────────────────────
    socket.on('join-whatsapp-session', async (sessionName) => {
      try {
        if (!await mayUseWaSession(sessionName)) return;
        socket.join(`wa-${sessionName}`);
      } catch (_err) { /* a bad id is simply not joined */ }
    });

    // ─── Disconnect ───────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      const left = (socketCounts.get(key) || 1) - 1;
      if (left <= 0) socketCounts.delete(key); else socketCounts.set(key, left);
      console.log(`🔌 Socket disconnected: ${user.name}`);
    });
  });

  console.log('✅ Socket.IO service initialized');
}

module.exports = setupSocketIO;
