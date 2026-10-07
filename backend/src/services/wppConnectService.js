/**
 * WPPConnect Service
 * Manages WhatsApp sessions using wppconnect library with system browser fallback.
 */

const fs = require('fs');
const WhatsAppSession = require('../models/WhatsAppSession');
const AIMemory = require('../models/AIMemory');
const User = require('../models/User');
const axios = require('axios');

// In-memory map of active wppconnect clients
const activeSessions = new Map();

// Detect installed browser
const possibleBrowserPaths = [
  '/usr/bin/brave-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
];
const executablePath = possibleBrowserPaths.find(p => fs.existsSync(p));
console.log(`🧭 Detected browser for WhatsApp Puppeteer: ${executablePath || 'default'}`);

let wppconnect;
try {
  wppconnect = require('@wppconnect-team/wppconnect');
} catch (e) {
  console.warn('⚠️  WPPConnect not loaded. Install @wppconnect-team/wppconnect');
}

/**
 * Start a new WhatsApp session.
 * QR code is stored in DB and emitted to the user's socket room.
 */
async function startSession(sessionName, userId, io) {
  if (!wppconnect) {
    console.error('WPPConnect library not available');
    return;
  }

  console.log(`📱 Starting WPPConnect session: ${sessionName}`);

  try {
    const client = await wppconnect.create({
      session: sessionName,
      autoClose: false,
      disableWelcome: true,
      headless: true,
      puppeteerOptions: {
        ...(executablePath ? { executablePath } : {}),
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
        ],
      },
      catchQR: async (base64Qr, asciiQR, attempts) => {
        console.log(`📲 QR Code generated for ${sessionName} (attempt ${attempts})`);
        const qrImage = (base64Qr && base64Qr.startsWith('data:'))
          ? base64Qr
          : `data:image/png;base64,${base64Qr}`;

        // Update DB
        await WhatsAppSession.findOneAndUpdate(
          { sessionName, userId },
          { $set: { qrCode: qrImage, status: 'qr_pending' } }
        );

        // Emit QR to user's socket room
        if (io) {
          io.to(`user-${userId}`).emit('whatsapp-qr', {
            sessionName,
            qrCode: qrImage,
          });
        }
      },
      statusFind: async (statusSession) => {
        console.log(`📱 Session status [${sessionName}]: ${statusSession}`);
        
        let status = 'disconnected';
        if (statusSession === 'isLogged' || statusSession === 'qrReadSuccess' || statusSession === 'chatsAvailable' || statusSession === 'inChat') {
          status = 'connected';
        } else if (statusSession === 'notLogged' || statusSession === 'qrReadFail') {
          status = 'qr_pending';
        }

        await WhatsAppSession.findOneAndUpdate(
          { sessionName, userId },
          { $set: { status, ...(status === 'connected' ? { qrCode: null } : {}), lastActive: new Date() } }
        );

        if (io) {
          io.to(`user-${userId}`).emit('whatsapp-status', { sessionName, status });
        }
      },
    });

    activeSessions.set(sessionName, { client, userId });

    // Setup message listener
    client.onMessage(async (message) => {
      await handleIncomingMessage(sessionName, userId, message, io);
    });

    // Mark as connected
    await WhatsAppSession.findOneAndUpdate(
      { sessionName, userId },
      { $set: { status: 'connected', qrCode: null, lastActive: new Date() } }
    );

    if (io) {
      io.to(`user-${userId}`).emit('whatsapp-status', { sessionName, status: 'connected' });
    }

    console.log(`✅ WhatsApp session successfully connected: ${sessionName}`);
  } catch (err) {
    console.error(`❌ WPPConnect error for ${sessionName}:`, err.message);
    await WhatsAppSession.findOneAndUpdate(
      { sessionName, userId },
      { $set: { status: 'error' } }
    );
  }
}

const lmStudioService = require('./lmStudioService');
const cloudAIService = require('./cloudAIService');

/**
 * Handle incoming WhatsApp message.
 * Stores message, notifies client in real-time, and triggers AI auto-reply.
 */
async function handleIncomingMessage(sessionName, userId, message, io) {
  try {
    const session = await WhatsAppSession.findOne({ sessionName, userId });
    if (!session) return;

    const senderContact = message.sender?.pushname || message.from;
    const fromNumber = message.from;

    const incomingMsg = {
      from: fromNumber,
      to: 'me',
      body: message.body || '',
      direction: 'incoming',
      status: 'delivered',
      timestamp: new Date(),
    };

    session.messages.push(incomingMsg);
    session.totalMessagesReceived++;
    await session.save();

    // Emit to user and admin rooms
    if (io) {
      const payload = {
        sessionName,
        sessionId: session._id,
        userId,
        senderContact,
        message: incomingMsg,
      };
      io.to(`user-${userId}`).emit('whatsapp-message', payload);
      io.to('admin-room').emit('whatsapp-message', payload);
    }

    // Auto-reply logic (skip group messages and empty messages)
    if (session.autoReply && session.autoReplyMode !== 'never' && !message.isGroupMsg && message.body) {
      console.log(`🤖 Triggering AI auto-reply for WhatsApp customer: ${fromNumber}`);

      // Gather recent conversation history with this customer (up to last 6 messages)
      const customerHistory = (session.messages || [])
        .filter(m => m.from === fromNumber || m.to === fromNumber)
        .slice(-7, -1); // Exclude the message just added

      const aiReply = await generateAIReply(userId, message.body, session, customerHistory);

      if (aiReply) {
        await sendMessage(sessionName, message.from, aiReply);

        const outgoingMsg = {
          from: 'me',
          to: message.from,
          body: aiReply,
          direction: 'outgoing',
          aiGenerated: true,
          status: 'sent',
          timestamp: new Date(),
        };

        session.messages.push(outgoingMsg);
        session.totalMessagesSent++;
        await session.save();

        if (io) {
          const outPayload = {
            sessionName,
            sessionId: session._id,
            userId,
            senderContact: 'AI Assistant',
            message: outgoingMsg,
          };
          io.to(`user-${userId}`).emit('whatsapp-message', outPayload);
          io.to('admin-room').emit('whatsapp-message', outPayload);
        }
      }
    }
  } catch (err) {
    console.error('handleIncomingMessage error:', err.message);
  }
}

/**
 * Generate AI reply designed specifically for busy business owners who have no time
 * to personally manage WhatsApp chats. Acts as an Executive Front-Desk Representative.
 */
async function generateAIReply(userId, incomingMessage, session, recentHistory = []) {
  try {
    const user = await User.findById(userId);
    const memory = await AIMemory.findOne({ userId });

    const bizName = memory?.businessName || user?.businessInfo?.name || 'our business';
    const ownerName = memory?.ownerName || user?.name || 'the business owner';
    const tone = memory?.tone || 'warm, professional, and helpful';
    const lang = memory?.language || 'auto-detect';

    // ── Build High-Conversion Executive Assistant Persona ──
    let systemPrompt = `You are the dedicated Executive WhatsApp Assistant and Front-Desk Representative for "${bizName}", representing the owner, ${ownerName}.\n`;
    systemPrompt += `CONTEXT: The owner is an active business executive who has no time to personally chat on WhatsApp throughout the day. You are entrusted with handling customer inquiries, welcoming new clients, taking orders, and booking appointments.\n\n`;

    systemPrompt += `CORE RESPONSIBILITIES:\n`;
    systemPrompt += `1. Warmly greet customers and represent ${bizName} with utmost professionalism.\n`;
    systemPrompt += `2. Answer questions about services, products, pricing, working hours, and location using the Verified Business Knowledge Base below.\n`;
    systemPrompt += `3. If a customer wants to book an appointment, place an order, or request a quote: politely gather their details (Name, Service/Product interested in, Preferred Date/Time, and Contact Number) and confirm you have recorded their request.\n`;
    systemPrompt += `4. If asked about something NOT in the Knowledge Base or requesting personal custom negotiation: never make up false facts. Reassure the client: "I have recorded your request and notified ${ownerName}! Our team will get back to you shortly."\n`;
    systemPrompt += `5. WhatsApp Formatting: Keep responses concise, natural, and formatted with bullet points and friendly emojis. Avoid long walls of text.\n`;
    systemPrompt += `6. Language: Match the customer's language automatically (e.g., reply in Bengali if they write in Bengali, Arabic if Arabic, English if English).\n`;
    systemPrompt += `7. Identity Rule: NEVER say you are an AI created by OpenAI or Google. You are the executive WhatsApp assistant of ${bizName}.\n\n`;

    if (memory?.businessType || user?.businessInfo?.industry) {
      systemPrompt += `Business Industry: ${memory?.businessType || user?.businessInfo?.industry}\n`;
    }
    if (memory?.businessDescription || user?.businessInfo?.description) {
      systemPrompt += `Business Overview: ${memory?.businessDescription || user?.businessInfo?.description}\n`;
    }

    if (memory?.entries?.length > 0) {
      systemPrompt += `\nVERIFIED BUSINESS KNOWLEDGE BASE:\n`;
      memory.entries.forEach(e => {
        systemPrompt += `• ${e.key}: ${e.value}\n`;
      });
    }

    if (session.customPrompt) {
      systemPrompt += `\nSPECIAL OWNER INSTRUCTIONS: ${session.customPrompt}\n`;
    }

    // Build multi-turn chat messages
    const chatMessages = [];
    if (recentHistory && recentHistory.length > 0) {
      recentHistory.forEach(h => {
        chatMessages.push({
          role: h.direction === 'incoming' ? 'user' : 'assistant',
          content: h.body,
        });
      });
    }
    chatMessages.push({ role: 'user', content: incomingMessage });

    // ── Tier 1: Cloud AI with Multi-Key Rotation & Auto-Failover (Instant ~300ms) ──
    try {
      // A verified Groq id (the previous one is not in Groq's live list), overridable per
      // deployment. allowFailover is explicit here: a customer message must get an answer,
      // and whichever model answered is recorded in the log line below.
      const cloudRes = await cloudAIService.generateCompletion({
        model: process.env.WHATSAPP_AI_MODEL || 'groq/qwen/qwen3.8-27b',
        messages: chatMessages,
        systemPrompt,
        temperature: 0.65,
        allowFailover: true,
      });

      if (cloudRes?.text && cloudRes.text.trim()) {
        console.log(`✅ WhatsApp AI reply generated via ${cloudRes.modelUsed}`);
        return cloudRes.text.trim();
      }
    } catch (cloudErr) {
      console.warn(`[WhatsApp Auto-Reply] Primary Cloud AI error: ${cloudErr.message}. Trying Local/ContentBot...`);
    }

    // ── Tier 2: Try Local LM Studio with Auto-Trigger ──
    try {
      const defaultLocalModel = 'qwen2-0.5b-uncensored';
      const loaded = await lmStudioService.ensureModelLoaded(defaultLocalModel, 25);
      if (loaded) {
        const lmUrl = process.env.LM_STUDIO_BASE_URL || 'http://localhost:1234/v1';
        const lmResponse = await axios.post(`${lmUrl}/chat/completions`, {
          messages: [{ role: 'system', content: systemPrompt }, ...chatMessages],
          temperature: 0.7,
          max_tokens: 350,
          stream: false,
        }, { timeout: 15000 });

        const reply = lmResponse.data.choices?.[0]?.message?.content;
        if (reply && reply.trim()) {
          console.log(`✅ WhatsApp AI reply generated via Local LM Studio`);
          return reply.trim();
        }
      }
    } catch (lmErr) {
      console.warn(`LM Studio WA auto-reply fallback failed: ${lmErr.message}`);
    }

    // ── Tier 3: ContentBot API Fallback ──
    const contentbotKey = user?.contentbotApiKey || process.env.CONTENTBOT_API_KEY;
    if (contentbotKey && process.env.CONTENTBOT_API_URL) {
      try {
        const cbRes = await axios.post(`${process.env.CONTENTBOT_API_URL}/chat`, {
          message: incomingMessage,
          system_prompt: systemPrompt,
        }, {
          headers: { 'Authorization': `Bearer ${contentbotKey}`, 'Content-Type': 'application/json' },
          timeout: 10000,
        });
        const reply = cbRes.data.response || cbRes.data.message;
        if (reply && reply.trim()) return reply.trim();
      } catch (cbErr) {
        // ContentBot error
      }
    }

    // ── Tier 4: Warm Business Executive Fallback ──
    return `Hello! Thank you for reaching out to ${bizName}.\n\nI have received your message and logged it for ${ownerName}. Could you please let me know your name and how we can best assist you today? Our team will follow up promptly! ✨`;
  } catch (err) {
    console.error('WhatsApp AI reply fatal error:', err.message);
    return null;
  }
}

/**
 * Send a message via an active session
 */
async function sendMessage(sessionName, to, message) {
  const sessionData = activeSessions.get(sessionName);
  if (!sessionData) throw new Error('WhatsApp session is not active or still connecting');
  
  const phone = to.includes('@') ? to : `${to}@c.us`;
  await sessionData.client.sendText(phone, message);
}

/**
 * Close a session
 */
async function closeSession(sessionName) {
  const sessionData = activeSessions.get(sessionName);
  if (sessionData) {
    try {
      await sessionData.client.close();
    } catch (e) {
      console.error('Error closing session:', e.message);
    }
    activeSessions.delete(sessionName);
  }
}

/**
 * Get active session names
 */
function getActiveSessions() {
  return Array.from(activeSessions.keys());
}

module.exports = { startSession, closeSession, sendMessage, getActiveSessions };
