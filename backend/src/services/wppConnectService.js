/**
 * WPPConnect Service — WhatsApp sessions, and honest reports about their state.
 *
 * A session is only ever reported "connected" when the client itself says so (or WhatsApp
 * sent a post-login status). The earlier version wrote "connected" straight after
 * wppconnect.create() resolved, which is just "the browser launched": the UI showed a live
 * session while the QR was still waiting to be scanned. Availability of a model, a session
 * state and a reply's provenance are all recorded as facts here, never as assumptions.
 *
 * Reply tiers, in order: cloud (a catalog id proven live) -> local LM Studio (an id proven
 * present in LM Studio's own list) -> ContentBot API -> a plain holding message. Whichever
 * tier answered is stored on the outgoing message as `aiModel`, which is the admin-only
 * record of what actually replied. The customer never sees a vendor name.
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const WhatsAppSession = require('../models/WhatsAppSession');
const AIMemory = require('../models/AIMemory');
const User = require('../models/User');
const lmStudioService = require('./lmStudioService');
const cloudAIService = require('./cloudAIService');
const catalogService = require('./catalogService');

// In-memory map of active wppconnect clients: sessionName -> { client, userId, startedAt }
const activeSessions = new Map();
// Sessions whose browser is already launched but whose create() has not settled yet (the QR is
// still waiting to be scanned). These own a real Chromium process, so anything that closes or
// restarts a session has to account for them too.
const pendingSessions = new Map();

const TOKENS_DIR = path.join(process.cwd(), 'tokens');
// Files Chromium leaves behind when it is killed instead of closed; a stale lock makes the
// next launch with the same profile dir hang waiting for a browser that will never appear.
const STALE_LOCK_FILES = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];

// wppconnect reports its own status strings. Only post-login signals mean connected; the
// states that merely prove the browser is up stay "linking" (our qr_pending), and anything
// unknown is reported as disconnected rather than optimistically promoted.
const CONNECTED_STATES = new Set(['isLogged', 'successChat', 'connected', 'CONNECTED']);
const LINKING_STATES = new Set(['notLogged', 'inChat', 'qrReadSuccess', 'chatsAvailable',
  'SYNCING', 'RESUMING', 'disconnectedMobile', 'phoneNotConnected', 'qrReadFail', 'qrReadError']);
const CLOSED_STATES = new Set(['browserClose', 'serverClose', 'autocloseCalled', 'deleteToken',
  'DISCONNECTED']);

function mapStatus(raw) {
  const value = String(raw || '').trim();
  if (CONNECTED_STATES.has(value)) return 'connected';
  if (CLOSED_STATES.has(value)) return 'disconnected';
  if (LINKING_STATES.has(value)) return 'qr_pending';
  return 'disconnected';
}

const possibleBrowserPaths = [
  '/usr/bin/brave-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
];
const executablePath = possibleBrowserPaths.find(p => fs.existsSync(p));
console.log(`🧭 Detected browser for WhatsApp Puppeteer: ${executablePath || 'puppeteer default'}`);

let wppconnect;
try {
  wppconnect = require('@wppconnect-team/wppconnect');
} catch (e) {
  console.warn('⚠️  WPPConnect not loaded. Install @wppconnect-team/wppconnect');
}

/** The Chromium profile wppconnect uses for a session, created on demand. */
function profileDirFor(sessionName) {
  return path.join(TOKENS_DIR, sessionName);
}

/**
 * Drop locks left by a browser that was killed rather than closed. Only ever called before a
 * launch, and never for a session that still has a live client in this process.
 */
function clearStaleLocks(sessionName) {
  const dir = profileDirFor(sessionName);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    console.warn(`Could not prepare profile dir for ${sessionName}: ${err.message}`);
    return;
  }
  for (const name of STALE_LOCK_FILES) {
    const target = path.join(dir, name);
    try {
      if (fs.existsSync(target)) {
        fs.rmSync(target, { force: true });
        console.log(`🧹 Cleared stale ${name} for ${sessionName}`);
      }
    } catch (err) {
      console.warn(`Could not clear ${name} for ${sessionName}: ${err.message}`);
    }
  }
}

function emit(io, userId, event, payload) {
  if (io) io.to(`user-${userId}`).emit(event, payload);
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * PIDs of browsers launched with this exact Chromium profile, read from /proc so the match is
 * an exact substring rather than a shell pattern. Linux-only, and returns [] anywhere else.
 */
function browserPidsFor(profileDir) {
  const marker = `--user-data-dir=${profileDir}`;
  const pids = [];
  let entries;
  try {
    entries = fs.readdirSync('/proc');
  } catch {
    return pids;
  }
  for (const name of entries) {
    if (!/^\d+$/.test(name)) continue;
    const pid = Number(name);
    if (pid === process.pid) continue;
    let cmdline = '';
    try {
      cmdline = fs.readFileSync(`/proc/${name}/cmdline`, 'utf8');
    } catch {
      continue; // process exited between readdir and read
    }
    if (cmdline.includes(marker)) pids.push(pid);
  }
  return pids;
}

/**
 * Terminate any browser still holding a session's profile. Needed when create() never
 * settled, because then there is no client object to call close() on — the browser exists but
 * nothing in this process refers to it, and it would keep the profile (and its locks) busy.
 */
async function killBrowsersFor(profileDir) {
  const label = path.basename(profileDir);
  let pids = browserPidsFor(profileDir);
  if (!pids.length) return 0;

  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch (err) {
      if (err.code !== 'ESRCH') console.warn(`Could not stop browser ${pid}: ${err.message}`);
    }
  }

  for (let attempt = 0; attempt < 8; attempt++) {
    await sleep(250);
    pids = browserPidsFor(profileDir);
    if (!pids.length) {
      console.log(`🧹 Closed ${label}'s browser`);
      return 0;
    }
  }

  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch (err) {
      if (err.code !== 'ESRCH') console.warn(`Could not kill browser ${pid}: ${err.message}`);
    }
  }
  await sleep(250);
  const remaining = browserPidsFor(profileDir).length;
  console.log(`🧹 Killed ${pids.length} unresponsive browser process(es) for ${label}`);
  return remaining;
}

async function setStatus(sessionName, userId, status, extra = {}) {
  return WhatsAppSession.findOneAndUpdate(
    { sessionName, userId },
    { $set: { status, lastActive: new Date(), ...extra } }
  );
}

/**
 * Start (or restart) a session. Resolves as soon as the browser is up; the promise wppconnect
 * returns is intentionally not awaited here, because it only settles after the QR has been
 * scanned — the caller must not be blocked by a human holding a phone.
 */
function startSession(sessionName, userId, io) {
  if (!wppconnect) {
    const message = 'WPPConnect library is not installed on the server';
    setStatus(sessionName, userId, 'error', { lastError: message, lastErrorAt: new Date() });
    return { ok: false, error: message };
  }

  const existing = activeSessions.get(sessionName);
  if (existing) {
    return { ok: true, alreadyRunning: true, connected: getSessionState(sessionName).connected };
  }

  // A launch that is still waiting for a scan already owns the profile dir. Starting a second
  // browser on it would collide over Chromium's SingletonLock and hang both, so this is the
  // same "already running" answer, flagged so the caller can say "waiting for scan" instead of
  // restarting the countdown.
  if (pendingSessions.has(sessionName)) {
    return { ok: true, alreadyRunning: true, pendingScan: true };
  }

  clearStaleLocks(sessionName);
  console.log(`📱 Starting WPPConnect session: ${sessionName}`);

  const clientPromise = wppconnect.create({
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
      await setStatus(sessionName, userId, 'qr_pending', {
        qrCode: qrImage, lastError: null, lastErrorAt: null,
      });
      emit(io, userId, 'whatsapp-qr', { sessionName, qrCode: qrImage });
    },
    statusFind: async (statusSession) => {
      const status = mapStatus(statusSession);
      console.log(`📱 Session status [${sessionName}]: ${statusSession} -> ${status}`);
      if (status === 'connected') {
        await setStatus(sessionName, userId, 'connected', { qrCode: null, lastError: null, lastErrorAt: null });
      } else if (status === 'disconnected') {
        await setStatus(sessionName, userId, 'disconnected', { qrCode: null });
      } else {
        await setStatus(sessionName, userId, 'qr_pending');
      }
      emit(io, userId, 'whatsapp-status', { sessionName, status });
    },
  });

  const pending = { promise: clientPromise, cancelled: false, userId, startedAt: new Date() };
  pendingSessions.set(sessionName, pending);

  // create() settles once the QR has been read; a human scan is what unblocks it, so the
  // failure path and the post-login bookkeeping are handled off the request cycle.
  clientPromise
    .then(async (client) => {
      if (pending.cancelled || pendingSessions.get(sessionName) !== pending) {
        // The session was disconnected or deleted while this browser was waiting for a scan.
        // Registering it now would resurrect a session nobody asked for.
        pendingSessions.delete(sessionName);
        try {
          await client.close();
        } catch (err) {
          console.warn(`Could not close cancelled session ${sessionName}: ${err.message}`);
        }
        return;
      }
      pendingSessions.delete(sessionName);
      activeSessions.set(sessionName, { client, userId, startedAt: new Date() });

      client.onMessage(async (message) => {
        await handleIncomingMessage(sessionName, userId, message, io);
      });

      // Ask the client rather than assume: "create() resolved" is not the same as "logged in".
      let connected = false;
      try {
        connected = typeof client.isConnected === 'function' ? await client.isConnected() : false;
      } catch (err) {
        console.warn(`Could not read connection state for ${sessionName}: ${err.message}`);
      }

      const update = { lastActive: new Date() };
      if (connected) {
        update.status = 'connected';
        update.qrCode = null;
        update.lastError = null;
        update.lastErrorAt = null;
        try {
          const wid = typeof client.getWid === 'function' ? await client.getWid() : null;
          if (wid) update.phoneNumber = String(wid).split('@')[0];
        } catch (err) {
          console.warn(`Could not read the paired number for ${sessionName}: ${err.message}`);
        }
      } else {
        update.status = 'qr_pending';
      }
      await WhatsAppSession.findOneAndUpdate({ sessionName, userId }, { $set: update });
      emit(io, userId, 'whatsapp-status', { sessionName, status: update.status });
      console.log(`✅ WhatsApp session ${sessionName} is ${update.status}`);
    })
    .catch(async (err) => {
      const message = (err && err.message) ? err.message.slice(0, 300) : 'unknown connect failure';
      const wasCancelled = pending.cancelled || pendingSessions.get(sessionName) !== pending;
      pendingSessions.delete(sessionName);
      activeSessions.delete(sessionName);
      if (wasCancelled) {
        console.log(`Session ${sessionName} was cancelled while starting; its error is not reported.`);
        return;
      }
      console.error(`❌ WPPConnect error for ${sessionName}: ${message}`);
      await setStatus(sessionName, userId, 'error', {
        lastError: message, lastErrorAt: new Date(), qrCode: null,
      });
      emit(io, userId, 'whatsapp-status', { sessionName, status: 'error', error: message });
    });

  return { ok: true, alreadyRunning: false, pendingScan: true };
}

async function stopSession(sessionName) {
  const pending = pendingSessions.get(sessionName);
  if (pending) {
    // Mark it cancelled and forget it before touching the browser. The resolve handler checks
    // both, so a scan landing in this window closes the client it was handed instead of
    // adopting it. create() itself only settles once a human scans, so there is nothing to
    // await here — the sweep in closeSession() is what stops the browser.
    pending.cancelled = true;
    pendingSessions.delete(sessionName);
  }

  const entry = activeSessions.get(sessionName);
  if (entry) {
    try {
      await entry.client.close();
    } catch (e) {
      console.error('Error closing session:', e.message);
    }
    activeSessions.delete(sessionName);
  }
}

/**
 * Close a session: stop the browser whether it is a live client or still waiting for a scan,
 * sweep any browser left behind by a launch that never settled, and optionally delete the
 * profile so a deleted session cannot silently resume its old login.
 */
async function closeSession(sessionName, { removeProfile = false } = {}) {
  await stopSession(sessionName);

  const dir = profileDirFor(sessionName);
  const survivors = await killBrowsersFor(dir);
  if (survivors) {
    console.warn(`⚠️  ${survivors} browser process(es) for ${sessionName} survived SIGKILL`);
  }

  if (removeProfile) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      console.log(`🗑️  Removed WhatsApp profile dir for ${sessionName}`);
    } catch (err) {
      console.warn(`Could not remove profile dir for ${sessionName}: ${err.message}`);
    }
  } else {
    // Locks from a killed browser would block the next launch on this profile.
    clearStaleLocks(sessionName);
  }
}

/**
 * After a backend restart no client exists in memory, so a session still marked connected or
 * awaiting a QR would be a claim we cannot back — and one stuck on "error" would be a verdict
 * from a process that no longer exists. All three become disconnected, with the previous
 * reason kept so nothing is silently forgotten.
 */
async function reconcileOnBoot() {
  try {
    const stale = await WhatsAppSession.find({ status: { $in: ['connected', 'qr_pending', 'error'] } });
    for (const session of stale) {
      const previous = session.status;
      session.status = 'disconnected';
      session.qrCode = null;
      session.lastError = previous === 'error'
        ? `Backend restarted while this session was in error${session.lastError ? ` (${session.lastError})` : ''}. Reconnect to try again.`
        : 'Backend restarted: the WhatsApp browser was closed. Reconnect to resume.';
      session.lastErrorAt = new Date();
      await session.save();
      console.log(`♻️  Marked ${session.sessionName} disconnected (was ${previous})`);
    }
    if (stale.length) console.log(`♻️  Reconciled ${stale.length} WhatsApp session(s) after restart`);
  } catch (err) {
    console.warn(`Session reconcile failed: ${err.message}`);
  }
}

/** What this process actually knows about a session, for callers that need the truth. */
function getSessionState(sessionName) {
  const pending = pendingSessions.get(sessionName);
  if (pending) {
    return { active: true, connected: false, status: 'connecting', pendingScan: true, startedAt: pending.startedAt };
  }
  const entry = activeSessions.get(sessionName);
  if (!entry) return { active: false, connected: false, status: 'disconnected' };
  let connected = false;
  try {
    connected = typeof entry.client.isConnected === 'function' ? Boolean(entry.client.isConnected()) : false;
  } catch {
    connected = false;
  }
  return { active: true, connected, status: connected ? 'connected' : 'connecting', startedAt: entry.startedAt };
}

const SKIP_SENDERS = new Set(['status@broadcast']);

/**
 * Handle an inbound WhatsApp message: store it, tell the owner and admin, then auto-reply
 * when the session asks for it. Reply provenance is stored on the outgoing message.
 */
async function handleIncomingMessage(sessionName, userId, message, io) {
  try {
    const session = await WhatsAppSession.findOne({ sessionName, userId });
    if (!session) return;

    const fromNumber = message.from || '';
    if (!fromNumber || SKIP_SENDERS.has(fromNumber)) return;

    const incomingMsg = {
      from: fromNumber,
      to: 'me',
      body: message.body || '',
      direction: 'incoming',
      status: 'delivered',
      timestamp: new Date(),
    };

    session.messages.push(incomingMsg);
    session.totalMessagesReceived += 1;
    await session.save();

    const payload = {
      sessionName,
      sessionId: session._id,
      userId,
      senderContact: message.sender?.pushname || fromNumber,
      message: incomingMsg,
    };
    emit(io, userId, 'whatsapp-message', payload);
    if (io) io.to('admin-room').emit('whatsapp-message', payload);

    const wantsReply = session.autoReply && session.autoReplyMode !== 'never'
      && !message.isGroupMsg && Boolean(message.body);
    if (!wantsReply) return;

    console.log(`🤖 Triggering AI auto-reply for WhatsApp customer: ${fromNumber}`);

    // Conversation history with this customer, excluding the message just stored.
    const history = (session.messages || [])
      .filter(m => (m.from === fromNumber || m.to === fromNumber) && m !== incomingMsg)
      .slice(-6);

    const reply = await generateAIReply(userId, message.body, session, history);
    if (!reply || !reply.text) {
      console.warn(`[WhatsApp Auto-Reply] No tier produced a reply for ${fromNumber}`);
      return;
    }

    const outgoingMsg = {
      from: 'me',
      to: fromNumber,
      body: reply.text,
      direction: 'outgoing',
      aiGenerated: true,
      aiModel: reply.answeredBy,
      status: 'sent',
      timestamp: new Date(),
    };

    // A failed send is recorded as a failed send — not rounded up to "sent", and not lost.
    try {
      await sendMessage(sessionName, fromNumber, reply.text);
    } catch (err) {
      outgoingMsg.status = 'failed';
      console.warn(`[WhatsApp Auto-Reply] Reply generated by ${reply.answeredBy} could not be sent: ${err.message}`);
    }

    session.messages.push(outgoingMsg);
    if (outgoingMsg.status === 'sent') session.totalMessagesSent += 1;
    await session.save();

    const outPayload = {
      sessionName,
      sessionId: session._id,
      userId,
      senderContact: 'AI Assistant',
      message: outgoingMsg,
    };
    emit(io, userId, 'whatsapp-message', outPayload);
    if (io) io.to('admin-room').emit('whatsapp-message', outPayload);
  } catch (err) {
    console.error('handleIncomingMessage error:', err.message);
  }
}

/**
 * Generate the WhatsApp reply. Each tier is recorded by the model that answered it; a tier
 * whose pinned model does not verify is skipped rather than quietly served by another model.
 */
async function generateAIReply(userId, incomingMessage, session, recentHistory = []) {
  try {
    const user = await User.findById(userId);
    const memory = session.useMemory === false ? null : await AIMemory.findOne({ userId });

    const bizName = memory?.businessName || user?.businessInfo?.name || 'our business';
    const ownerName = memory?.ownerName || user?.name || 'the business owner';
    const tone = session.tone || memory?.tone || 'warm, professional, and helpful';

    let systemPrompt = `You are the dedicated Executive WhatsApp Assistant and Front-Desk Representative for "${bizName}", representing the owner, ${ownerName}.\n`;
    systemPrompt += `CONTEXT: The owner is an active business executive who has no time to personally chat on WhatsApp throughout the day. You are entrusted with handling customer inquiries, welcoming new clients, taking orders, and booking appointments.\n\n`;
    systemPrompt += `CORE RESPONSIBILITIES:\n`;
    systemPrompt += `1. Warmly greet customers and represent ${bizName} with utmost professionalism.\n`;
    systemPrompt += `2. Answer questions about services, products, pricing, working hours, and location using the Verified Business Knowledge Base below.\n`;
    systemPrompt += `3. If a customer wants to book an appointment, place an order, or request a quote: politely gather their details (Name, Service/Product interested in, Preferred Date/Time, and Contact Number) and confirm you have recorded their request.\n`;
    systemPrompt += `4. If asked about something NOT in the Knowledge Base or requesting personal custom negotiation: never make up false facts. Reassure the client: "I have recorded your request and notified ${ownerName}! Our team will get back to you shortly."\n`;
    systemPrompt += `5. WhatsApp Formatting: Keep responses concise, natural, and formatted with bullet points and friendly emojis. Avoid long walls of text.\n`;
    systemPrompt += `6. Language: Match the customer's language automatically (e.g., reply in Bengali if they write in Bengali, Arabic if Arabic, English if English).\n`;
    systemPrompt += `7. Identity Rule: NEVER say you are an AI created by OpenAI or Google. You are the executive WhatsApp assistant of ${bizName}.\n`;
    systemPrompt += `8. Tone: ${tone}.\n\n`;

    if (memory?.businessType || user?.businessInfo?.industry) {
      systemPrompt += `Business Industry: ${memory?.businessType || user?.businessInfo?.industry}\n`;
    }
    if (memory?.businessDescription || user?.businessInfo?.description) {
      systemPrompt += `Business Overview: ${memory?.businessDescription || user?.businessInfo?.description}\n`;
    }
    if (memory?.entries?.length > 0) {
      systemPrompt += `\nVERIFIED BUSINESS KNOWLEDGE BASE:\n`;
      memory.entries.forEach(e => { systemPrompt += `• ${e.key}: ${e.value}\n`; });
    }
    if (session.customPrompt) {
      systemPrompt += `\nSPECIAL OWNER INSTRUCTIONS: ${session.customPrompt}\n`;
    }

    const chatMessages = recentHistory.map(h => ({
      role: h.direction === 'incoming' ? 'user' : 'assistant',
      content: h.body,
    }));
    chatMessages.push({ role: 'user', content: incomingMessage });

    // ── Tier 1: cloud, on a catalog id that verifies in its provider's live list ──
    const pinnedCloud = process.env.WHATSAPP_AI_MODEL || 'groq/qwen/qwen3.8-27b';
    try {
      const modelDef = cloudAIService.ALL_MODELS_CATALOG.find(m => m.id === pinnedCloud);
      const provider = modelDef?.provider || 'groq';
      const servable = await catalogService.checkServable(provider, pinnedCloud);
      if (servable.ok) {
        const cloudRes = await cloudAIService.generateCompletion({
          model: pinnedCloud,
          messages: chatMessages,
          systemPrompt,
          temperature: 0.65,
        });
        if (cloudRes?.text?.trim()) {
          console.log(`✅ WhatsApp reply via ${cloudRes.modelUsed}`);
          return { text: cloudRes.text.trim(), answeredBy: cloudRes.modelUsed || pinnedCloud };
        }
      } else {
        console.warn(`[WhatsApp Auto-Reply] Skipping cloud tier: ${pinnedCloud} is ${servable.availability} (${servable.reason})`);
      }
    } catch (cloudErr) {
      console.warn(`[WhatsApp Auto-Reply] Cloud tier failed: ${cloudErr.message}. Trying local...`);
    }

    // ── Tier 2: local LM Studio, on an id LM Studio itself lists ──
    try {
      const pinnedLocal = (process.env.WHATSAPP_LOCAL_MODEL || '').trim();
      let localModel = null;
      if (pinnedLocal) {
        // A pin is honoured or skipped, never swapped: quietly answering from a different
        // local model would be the same dishonesty the cloud tier no longer does.
        const live = await lmStudioService.getModelIds();
        localModel = live.find(id => id.toLowerCase() === pinnedLocal.toLowerCase()) || null;
        if (!localModel) {
          console.warn(live.length
            ? `[WhatsApp Auto-Reply] Skipping local tier: LM Studio does not list "${pinnedLocal}"`
            : `[WhatsApp Auto-Reply] Skipping local tier: LM Studio could not be reached`);
        }
      } else {
        localModel = await lmStudioService.pickDefaultChatModel();
      }
      if (localModel) {
        const loaded = await lmStudioService.ensureModelLoaded(localModel, 25);
        if (loaded) {
          const lmUrl = process.env.LM_STUDIO_BASE_URL || 'http://localhost:1234/v1';
          const lmResponse = await axios.post(`${lmUrl}/chat/completions`, {
            model: localModel,
            messages: [{ role: 'system', content: systemPrompt }, ...chatMessages],
            temperature: 0.7,
            max_tokens: 350,
            stream: false,
          }, { timeout: 60000 });
          const reply = lmResponse.data?.choices?.[0]?.message?.content;
          if (reply?.trim()) {
            console.log(`✅ WhatsApp reply via local LM Studio (${localModel})`);
            return { text: reply.trim(), answeredBy: `local:${localModel}` };
          }
        }
      } else if (!pinnedLocal) {
        console.warn('[WhatsApp Auto-Reply] Skipping local tier: LM Studio lists no usable chat model');
      }
    } catch (lmErr) {
      console.warn(`[WhatsApp Auto-Reply] Local tier failed: ${lmErr.message}`);
    }

    // ── Tier 3: ContentBot API ──
    const contentbotKey = user?.contentbotApiKey || process.env.CONTENTBOT_API_KEY;
    if (contentbotKey && process.env.CONTENTBOT_API_URL) {
      try {
        const cbRes = await axios.post(`${process.env.CONTENTBOT_API_URL}/chat`, {
          message: incomingMessage,
          system_prompt: systemPrompt,
        }, {
          headers: { 'Authorization': `Bearer ${contentbotKey}`, 'Content-Type': 'application/json' },
          timeout: 20000,
        });
        const reply = cbRes.data?.response || cbRes.data?.message;
        if (reply?.trim()) {
          console.log('✅ WhatsApp reply via ContentBot API');
          return { text: reply.trim(), answeredBy: 'contentbot-api' };
        }
      } catch (cbErr) {
        console.warn(`[WhatsApp Auto-Reply] ContentBot tier failed: ${cbErr.message}`);
      }
    }

    // ── Tier 4: a holding message that promises nothing it cannot keep ──
    return {
      text: `Hello! Thank you for reaching out to ${bizName}.\n\nI have received your message and logged it for ${ownerName}. Could you please let me know your name and how we can best assist you today? Our team will follow up promptly! ✨`,
      answeredBy: 'fallback-template',
    };
  } catch (err) {
    console.error('WhatsApp AI reply fatal error:', err.message);
    return null;
  }
}

/** Send a message via an active session. Throws when there is no live client to send with. */
async function sendMessage(sessionName, to, message) {
  const entry = activeSessions.get(sessionName);
  if (!entry) throw new Error('WhatsApp session is not active in this process (scan the QR or reconnect)');
  const phone = String(to).includes('@') ? to : `${to}@c.us`;
  await entry.client.sendText(phone, message);
}

function getActiveSessions() {
  return Array.from(activeSessions.keys());
}

module.exports = {
  startSession, closeSession, sendMessage, getActiveSessions,
  getSessionState, reconcileOnBoot, handleIncomingMessage, mapStatus,
  browserPidsFor,
};
