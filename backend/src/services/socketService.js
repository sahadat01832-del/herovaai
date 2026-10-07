/**
 * Socket.IO Service
 * Handles real-time events for chat, WhatsApp, and admin monitoring.
 */

const jwt = require('jsonwebtoken');
const User = require('../models/User');

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
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.user;
    console.log(`🔌 Socket connected: ${user.name} (${user.role})`);

    // Join personal room
    socket.join(`user-${user._id}`);

    // Admin joins admin room
    if (user.role === 'admin') {
      socket.join('admin-room');
      console.log(`👑 Admin joined admin-room: ${user.name}`);
    }

    // ─── Chat events ─────────────────────────────────────────────────────
    socket.on('join-conversation', (conversationId) => {
      socket.join(`conv-${conversationId}`);
    });

    socket.on('leave-conversation', (conversationId) => {
      socket.leave(`conv-${conversationId}`);
    });

    // Typing indicator
    socket.on('typing-start', ({ conversationId }) => {
      socket.to(`conv-${conversationId}`).emit('user-typing', { userId: user._id });
    });

    socket.on('typing-stop', ({ conversationId }) => {
      socket.to(`conv-${conversationId}`).emit('user-stopped-typing', { userId: user._id });
    });

    // ─── WhatsApp events ──────────────────────────────────────────────────
    socket.on('join-whatsapp-session', (sessionName) => {
      socket.join(`wa-${sessionName}`);
    });

    // ─── Disconnect ───────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      console.log(`🔌 Socket disconnected: ${user.name}`);
    });
  });

  console.log('✅ Socket.IO service initialized');
}

module.exports = setupSocketIO;
