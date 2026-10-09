const express = require('express');
const axios = require('axios');
const router = express.Router();
const Conversation = require('../models/Conversation');
const AIMemory = require('../models/AIMemory');
const memoryProfile = require('../services/memoryProfile');
const { authenticate } = require('../middleware/auth');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const lmStudioService = require('../services/lmStudioService');
const cloudAIService = require('../services/cloudAIService');
const catalogService = require('../services/catalogService');
const tokenQuotaService = require('../services/tokenQuotaService');

function classifyModel(modelId, source = 'local') {
  const lower = (modelId || '').toLowerCase();
  
  if (source === 'api') {
    // All API models are accessible to all users under the 1M tokens/7 days limit
    return {
      id: modelId,
      name: modelId,
      source: 'api',
      tier: 'free',
      isPaid: false,
      badge: 'API (1M Quota)',
    };
  }

  // Local LM Studio: 0.5B to 1.5B are free local models
  const isFree = /\b(0\.[0-9]+b|[0-1]b|1\.[0-5]b|[1-9][0-9]{0,2}m|standard)\b/i.test(lower) ||
                 lower.includes('0.5b') || lower.includes('1b') || lower.includes('1.5b') || lower.includes('standard');
                 
  return {
    id: modelId,
    name: modelId,
    source,
    tier: isFree ? 'free' : 'paid',
    isPaid: !isFree,
    badge: isFree ? 'FREE (0.5B-1B)' : 'PRO / PAID (3B+)',
  };
}

// ─── Skills Definitions ───────────────────────────────────────────────────
const SKILLS = [
  {
    id: 'general',
    name: 'General Assistant',
    icon: 'Bot',
    description: 'Smart multi-purpose conversational AI assistant',
  },
  {
    id: 'webapp',
    name: 'Web App & Site Creator',
    icon: 'Globe',
    description: 'Creates complete, single-file HTML/Tailwind web apps with live preview',
    systemDirective: 'You are an expert full-stack web developer. When asked to create a website, web tool, or web application, generate a complete, self-contained single-page HTML application including modern CSS (use CDN Tailwind CSS: <script src="https://cdn.tailwindcss.com"></script>) and fully functional JavaScript. Enclose the ENTIRE runnable code inside a single ```html ... ``` block so it can be previewed live.',
  },
  {
    id: 'game',
    name: 'HTML5 Game Creator',
    icon: 'Gamepad2',
    description: 'Builds complete playable 2D HTML5 canvas or arcade/puzzle games',
    systemDirective: 'You are an elite HTML5 game designer. When asked to build a game, create a complete, bug-free, playable game using HTML5 Canvas and vanilla JavaScript. Include smooth keyboard/mouse controls, score tracking, start/game-over screens, restart buttons, sound effects (via Web Audio API synthesizers), and polished retro or modern visual styles. Enclose the ENTIRE game inside a single ```html ... ``` block.',
  },
  {
    id: 'program',
    name: 'Program & Tool Builder',
    icon: 'Code2',
    description: 'Builds complete standalone tools, converters, or scripts',
    systemDirective: 'You are a senior software architect. Provide complete, modular, runnable code or interactive browser utilities with clean styling, error handling, and intuitive UI inside a single ```html ... ``` block.',
  },
  {
    id: 'visualizer',
    name: 'Data & Chart Visualizer',
    icon: 'BarChart3',
    description: 'Generates interactive dashboards and charts (Chart.js / SVG)',
    systemDirective: 'You are an expert in data visualization. Generate complete, responsive interactive dashboards using Chart.js CDN (<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>) or interactive SVGs. Include sample data and interactive filters. Enclose the ENTIRE code in a single ```html ... ``` block.',
  },
];

// Helper: Extract code artifacts from AI output.
// Hardened after the 2026-10-08 "Flappy Bird skeleton" incident: a model that
// burns its output budget on planning hands back (1) a tiny placeholder sketch
// — which used to get a Run button that ran nothing — or (2) an unclosed fence
// when it runs out mid-block, which used to make the whole artifact vanish.
function isPlaceholderSkeleton(code) {
  // Classic "sketch instead of code" markers.
  if (/\/\/\s*(all\s*js|js\s+here|code\s+here|your\s+(code|game)\s+here|game\s+(code|logic)\s+(goes|here))/i.test(code)) return true;
  if (/\/\*\s*(center|styles?|css|game\s+logic|all\s*js)[^*]{0,80}\*\//i.test(code)) return true;
  // Every INLINE <script> body is comments/whitespace only → nothing can run.
  const inlineScripts = [...code.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  if (inlineScripts.length > 0) {
    const stripped = inlineScripts.join('')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
      .trim();
    if (stripped.length < 20) return true;
  }
  return false;
}

function extractArtifacts(text, skill) {
  const blocks = [];
  const htmlBlockRegex = /```(?:html|game|app|svg)\s*([\s\S]*?)```/gi;
  let match;
  while ((match = htmlBlockRegex.exec(text)) !== null) {
    const code = match[1].trim();
    if (code.length > 50) blocks.push(code);
  }

  // Salvage an unclosed trailing block (model forgot the closing ``` or the
  // output cap hit right before it) — but only when nothing closed after it.
  const opens = [...text.matchAll(/```(?:html|game|app|svg)/gi)];
  const lastOpen = opens[opens.length - 1];
  if (lastOpen) {
    const after = text.slice(lastOpen.index + lastOpen[0].length);
    if (!after.includes('```') && after.trim().length > 50) blocks.push(after.trim());
  }

  const artifacts = [];
  let count = 1;
  for (const code of blocks) {
    if (isPlaceholderSkeleton(code)) continue; // never offer a Run button that runs nothing
    let type = 'html';
    let title = `Interactive App ${count}`;
    if (skill === 'game' || code.includes('<canvas') || code.includes('game') || code.includes('score')) {
      type = 'game';
      title = `Playable HTML5 Game ${count}`;
    } else if (skill === 'webapp' || code.includes('Tailwind') || code.includes('container')) {
      type = 'webapp';
      title = `Web Application ${count}`;
    } else if (skill === 'visualizer' || code.includes('Chart(') || code.includes('<svg')) {
      type = 'visualizer';
      title = `Interactive Visualization ${count}`;
    }
    artifacts.push({ title, type, code, language: 'html' });
    count++;
  }
  return artifacts;
}

// Shared tail appended to every code-producing skill directive. The 2026-10-08
// Flappy Bird test came back as a 655-char placeholder because the free default
// model wrote a "thinking process" first and ran out of tokens — these rules
// (plus maxTokens 8192 in the route) are the fix.
const ARTIFACT_OUTPUT_RULES = [
  'OUTPUT RULES (strict):',
  '1. Your ENTIRE reply must be exactly ONE fenced code block: it starts with ```html and ends with ```.',
  '2. Begin the reply with ```html immediately — NO thinking process, plan, outline, checklist or explanation before it.',
  '3. Write the COMPLETE, ready-to-run file with every line of real code. NEVER use placeholder comments such as "// All JS here", "// game logic here" or "/* styles */" — if you cannot finish the code, do not emit a skeleton: keep writing real code instead.',
  '4. Nothing after the closing ``` either.',
].join('\n');

// ─── In-flight generations (Stop button) ────────────────────────────────────
// key `${userId}:${conversationId}` → AbortController wired into the upstream
// AI call, so POST /conversations/:id/stop can actually cancel a stuck request.
const pendingGenerations = new Map();
const genKey = (userId, convId) => `${userId}:${convId}`;
const ARTIFACT_SKILLS = new Set(['webapp', 'game', 'program', 'visualizer']);

// ─── Get all conversations for current user ────────────────────────────────
router.get('/conversations', authenticate, async (req, res) => {
  try {
    const conversations = await Conversation.find({ userId: req.user._id, isArchived: false })
      .select('-messages')
      .sort({ updatedAt: -1 })
      .limit(50);
    res.json({ success: true, conversations });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Get a single conversation ─────────────────────────────────────────────
router.get('/conversations/:id', authenticate, async (req, res) => {
  try {
    const convo = await Conversation.findOne({ _id: req.params.id, userId: req.user._id });
    if (!convo) return res.status(404).json({ success: false, message: 'Conversation not found' });
    res.json({ success: true, conversation: convo });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Create a new conversation ─────────────────────────────────────────────
router.post('/conversations', authenticate, async (req, res) => {
  try {
    const { mode = 'api', model = 'nvidia/nemotron-3.5-lightning:free', skill = 'general' } = req.body;
    const convo = await Conversation.create({ userId: req.user._id, mode, model, skill });
    res.status(201).json({ success: true, conversation: convo });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Delete a conversation ─────────────────────────────────────────────────
router.delete('/conversations/:id', authenticate, async (req, res) => {
  try {
    await Conversation.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    res.json({ success: true, message: 'Conversation deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Send message & get AI response ────────────────────────────────────────
router.post('/conversations/:id/message', authenticate, async (req, res) => {
  // Registered before ANY await so a Stop press always finds the controller.
  const genCtl = new AbortController();
  const pendingKey = genKey(String(req.user._id), String(req.params.id));
  pendingGenerations.set(pendingKey, genCtl);
  let convo = null;
  try {
    const { message, mode, model, attachments = [], skill = 'general' } = req.body;
    if (!message?.trim() && (!attachments || attachments.length === 0)) {
      return res.status(400).json({ success: false, message: 'Message or attachment is required' });
    }

    convo = await Conversation.findOne({ _id: req.params.id, userId: req.user._id });
    if (!convo) return res.status(404).json({ success: false, message: 'Conversation not found' });

    const chatMode = mode || convo.mode || 'api';
    const chosenModel = model || convo.model || 'nvidia/nemotron-3.5-lightning:free';
    const chosenSkill = skill || convo.skill || 'general';

    // ── Check Token Quota for API Models (1M Tokens / 7 Days limit) ─────────
    if (chatMode === 'api') {
      const quotaStatus = await tokenQuotaService.checkQuota(req.user._id, 200);
      if (!quotaStatus.allowed) {
        return res.status(429).json({
          success: false,
          quotaExceeded: true,
          message: quotaStatus.message,
          daysLeft: quotaStatus.daysLeft,
          tokensUsed: quotaStatus.tokensUsed,
          limit: quotaStatus.limit,
        });
      }
    }

    // Check Local Paid vs Free Model permission (LM Studio only)
    if (chatMode === 'local' && chosenModel) {
      const modelInfo = classifyModel(chosenModel, 'local');
      if (modelInfo.isPaid && req.user.role !== 'admin' && !req.user.contentbotApiKey) {
        return res.status(403).json({
          success: false,
          message: `🔒 "${chosenModel}" is a local PRO model (3B+). Free local tier is limited to 0.5B - 1B models. Alternatively, switch to "API Models" tab to use cloud models under your 1M token quota!`,
        });
      }
    }

    // Build system prompt with Memory + Skill Directives
    const memory = await AIMemory.findOne({ userId: req.user._id });
    let systemPrompt = req.user.chatSettings?.systemPrompt || '';
    if (memory) {
      systemPrompt = buildSystemPrompt(memory, systemPrompt);
    }

    const activeSkillObj = SKILLS.find(s => s.id === chosenSkill);
    if (activeSkillObj?.systemDirective) {
      systemPrompt = `${activeSkillObj.systemDirective}\n\n${ARTIFACT_OUTPUT_RULES}\n\n${systemPrompt}`;
    }

    // Add user message to conversation
    const userMsgObj = {
      role: 'user',
      content: message || '',
      attachments: attachments || [],
      timestamp: new Date(),
    };
    convo.messages.push(userMsgObj);

    if (convo.title === 'New Chat' && convo.messages.length === 1) {
      convo.title = (message || 'Attached Media').slice(0, 45) + (message && message.length > 45 ? '...' : '');
    }

    let aiResponse = '';
    let modelUsed = chosenModel;
    let failedOverFrom = null;
    let tokensUsed = 0;

    // ── Mode: Cloud API Models (OpenRouter / Gemini+ / OpenAI) ───────────────
    if (chatMode === 'api') {
      const contextMessages = convo.messages.slice(-15).map(m => ({
        role: m.role,
        content: m.content,
      }));

      // Strict by default: the chosen model answers, or the caller is told why not.
      // Failover happens only when this request explicitly asks for it.
      const apiResult = await cloudAIService.generateCompletion({
        model: chosenModel,
        messages: contextMessages,
        systemPrompt,
        attachments,
        temperature: req.user.chatSettings?.temperature || 0.7,
        allowFailover: req.body.allowFailover === true,
        // Games/apps need a real budget: the old 1500-token OpenRouter default
        // is what turned "Build a Flappy Bird clone" into a placeholder sketch.
        maxTokens: ARTIFACT_SKILLS.has(chosenSkill) ? 8192 : null,
        signal: genCtl.signal,
      });

      aiResponse = apiResult.text;
      modelUsed = apiResult.modelUsed || chosenModel;
      failedOverFrom = apiResult.failedOverFrom || null;
      tokensUsed = apiResult.tokensUsed || 0;

      // Record tokens to user's 7-day quota
      await tokenQuotaService.recordUsage(req.user._id, tokensUsed, modelUsed);

    // ── Mode: Local LM Studio (Auto-triggered with RAM TTL) ─────────────────
    } else if (chatMode === 'local') {
      const lmUrl = process.env.LM_STUDIO_BASE_URL || 'http://localhost:1234/v1';

      if (chosenModel && chosenModel !== 'local') {
        await lmStudioService.ensureModelLoaded(chosenModel, 25);
      } else {
        await lmStudioService.ensureServerRunning();
      }

      const messages = [];
      if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
      const contextMessages = convo.messages.slice(-20);
      messages.push(...contextMessages.map(m => ({ role: m.role, content: m.content })));

      const lmResponse = await axios.post(`${lmUrl}/chat/completions`, {
        messages,
        model: chosenModel && chosenModel !== 'local' ? chosenModel : undefined,
        temperature: req.user.chatSettings?.temperature || 0.7,
        stream: false,
      }, { timeout: 60000, signal: genCtl.signal });

      aiResponse = lmResponse.data.choices?.[0]?.message?.content || 'No response from the on-device model.';
      modelUsed = lmResponse.data.model || chosenModel || 'on-device';
      tokensUsed = lmResponse.data.usage?.total_tokens || 0;

    // ── Mode: ContentBot Agent ─────────────────────────────────────────────
    } else if (chatMode === 'contentbot') {
      const apiKey = req.user.contentbotApiKey || process.env.CONTENTBOT_API_KEY;
      if (!apiKey) {
        return res.status(400).json({
          success: false,
          message: 'No agent platform API key configured. Please enter your API key in Settings or switch to API Models.',
        });
      }

      const cbResponse = await axios.post(`${process.env.CONTENTBOT_API_URL || 'http://localhost:8000'}/chat`, {
        message,
        model: chosenModel,
        history: convo.messages.slice(-10).map(m => ({ role: m.role, content: m.content })),
        system_prompt: systemPrompt,
      }, {
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: 60000,
        signal: genCtl.signal,
      });

      aiResponse = cbResponse.data.response || cbResponse.data.message || 'No response from the agent platform';
      modelUsed = chosenModel || 'Agent platform';
    }

    if (typeof aiResponse !== 'string' || !aiResponse.trim()) {
      return res.status(502).json({
        success: false,
        code: 'EMPTY_AI_RESPONSE',
        message: 'The selected AI model returned an empty response. Retry or choose another available model.',
      });
    }

    // Extract artifacts (HTML, games, apps, visualizers)
    const artifacts = extractArtifacts(aiResponse, chosenSkill);

    // Save assistant message with artifacts
    const assistantMsgObj = {
      role: 'assistant',
      content: aiResponse,
      model: modelUsed,
      failedOverFrom,
      tokens: tokensUsed,
      artifacts,
      timestamp: new Date(),
    };
    convo.messages.push(assistantMsgObj);
    convo.mode = chatMode;
    convo.model = modelUsed;
    convo.skill = chosenSkill;
    convo.totalTokens = (convo.totalTokens || 0) + tokensUsed;
    await convo.save();

    // Emit to admin via Socket.IO
    if (req.io) {
      req.io.to('admin-room').emit('new-message', {
        userId: req.user._id,
        userName: req.user.name,
        conversationId: convo._id,
        message,
        response: aiResponse,
        mode: chatMode,
        model: modelUsed,
        failedOverFrom,
        skill: chosenSkill,
        hasArtifacts: artifacts.length > 0,
        timestamp: new Date(),
      });
    }

    res.json({
      success: true,
      userMessage: userMsgObj,
      aiMessage: assistantMsgObj,
      conversationId: convo._id,
      artifacts,
      tokensUsed,
      modelUsed,
      failedOverFrom,
    });
  } catch (err) {
    const cancelled = err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError'
      || err?.name === 'AbortError' || genCtl.signal.aborted;
    if (cancelled) {
      // Stop button: keep the user's message, never a ghost AI reply later.
      try { if (convo) await convo.save(); } catch { /* already unwound */ }
      return res.status(499).json({ success: false, stopped: true, message: 'Generation stopped' });
    }
    console.error('Chat error:', err.message);
    if (err.code === 'MODEL_UNAVAILABLE') {
      return res.status(409).json({
        success: false,
        modelUnavailable: true,
        model: err.model,
        availability: err.availability,
        message: err.message,
        hint: 'Pick a model the catalog lists as available, or resend with allowFailover: true.',
      });
    }
    if (err.code === 'ECONNREFUSED') {
      return res.status(503).json({
        success: false,
        message: 'The on-device model is offline right now — a free cloud model works immediately.',
      });
    }
    res.status(500).json({ success: false, message: err.message });
  } finally {
    pendingGenerations.delete(pendingKey);
  }
});

// ─── Stop an in-flight generation (Stop button) ─────────────────────────────
// Aborts the upstream AI request so a stuck/thinking reply frees the UI and no
// half-finished message gets saved behind the user's back.
router.post('/conversations/:id/stop', authenticate, (req, res) => {
  const pendingKey = genKey(String(req.user._id), String(req.params.id));
  const ctl = pendingGenerations.get(pendingKey);
  if (ctl) { ctl.abort(); pendingGenerations.delete(pendingKey); }
  res.json({ success: true, stopped: Boolean(ctl) });
});

// Composed model list, kept warm for a minute: the probe runs against ten providers and
// the UI refetches on every panel open.
const MODELS_CACHE_TTL_MS = 60 * 1000;
let modelsCache = { at: 0, payload: null };

// ─── List available models (Local + API Models + ContentBot) ───────────────
router.get('/models', async (req, res) => {
  // Anonymous callers get a stripped view (see anonymousModelsView) — the full
  // catalog, loaded-model ids and provider snapshot stay behind the dashboard JWT.
  const maySeeDetail = await callerMaySeeDetail(req);

  // Composed from a probe of every provider, so the compose cost is paid once per minute
  // instead of on every keystroke-driven refetch.
  const wantsFresh = Boolean(req.query.refresh);
  if (!wantsFresh && modelsCache.payload && Date.now() - modelsCache.at < MODELS_CACHE_TTL_MS) {
    const cached = modelsCache.payload;
    return res.json(maySeeDetail ? { ...cached, cached: true } : { ...anonymousModelsView(cached), cached: true });
  }

  const lmUrl = process.env.LM_STUDIO_BASE_URL || 'http://localhost:1234/v1';
  let lmModels = [];
  let lmLoadedIds = [];
  let isLmOnline = false;

  try {
    // Listing models must never boot a daemon: starting LM Studio is the visitor's
    // explicit action (POST /lm-studio/warm), not a side effect of opening a menu.
    const response = await axios.get(`${lmUrl}/models`, { timeout: 2000 });
    isLmOnline = true;
    const raw = response.data?.data || [];
    lmModels = raw.map(m => classifyModel(m.id || m.name, 'local'));
  } catch (err) {
    isLmOnline = false;
  }

  // No invented stand-ins: if LM Studio serves nothing, the list says so and stays empty.
  // An offline local server is a fact about this machine, not a model menu.
  // Only ask the CLI what is loaded when the server is actually up: `lms ps`
  // wakes a sleeping daemon, and listing a menu must not cost the host RAM.
  try {
    lmLoadedIds = isLmOnline ? (await lmStudioService.getLoadedModels()) || [] : [];
  } catch {
    lmLoadedIds = [];
  }

  // Cloud API Models: key present AND the provider's live list contains the id.
  // Pricing comes from the provider where it publishes one; otherwise it is left unclaimed.
  await catalogService.ensureFresh();
  const apiModels = catalogService.annotate(cloudAIService.getAvailableModels())
    .filter(m => m.availability !== catalogService.OUT_OF_STOCK)
    .map(m => ({
      id: m.id,
      name: m.name,
      source: 'api',
      tier: m.tier,
      isPaid: m.isPaid,
      availability: m.availability,
      servable: m.servable,
      pricing: m.pricing,
      badge: m.badge,
      description: m.description,
      multimodal: m.multimodal,
      group: m.group,
    }));

  const contentbotModels = [
    { id: 'contentbot-standard', name: 'HerovaAi Standard Agent', source: 'contentbot', tier: 'free', isPaid: false, badge: 'HerovaAi Free' },
    { id: 'contentbot-pro', name: 'HerovaAi Pro Multi-Agent', source: 'contentbot', tier: 'paid', isPaid: true, badge: 'HerovaAi Pro' },
  ];

  // ── What a signed-out visitor may actually use ───────────────────────────
  // Mirrors the gate in POST /public/message exactly: free cloud models that the
  // provider really serves, plus local models that fit the public RAM budget.
  // Anything else is not offered, so the menu cannot promise what the API refuses.
  const publicCloudModels = apiModels.filter(m => m.servable && m.isPaid === false);
  const publicLocalModels = lmModels
    .filter(m => !m.isPaid)
    .map(m => ({ ...m, availability: 'available', servable: true, ramHint: 'runs on this PC' }));

  const payload = {
    success: true,
    lmStudioOnline: isLmOnline,
    lmStudioLoaded: lmLoadedIds,
    publicModels: [...publicLocalModels, ...publicCloudModels],
    publicLocalModels,
    publicCloudModels,
    lmStudioNote: isLmOnline
      ? (lmLoadedIds.length ? `${lmLoadedIds.length} model(s) loaded` : 'server up, nothing loaded')
      : 'Model catalog could not be listed',
    models: [...apiModels, ...lmModels, ...contentbotModels],
    apiModels,
    localModels: lmModels,
    outOfStock: catalogService.annotate(cloudAIService.getAvailableModels())
      .filter(m => m.availability === catalogService.OUT_OF_STOCK)
      .map(m => ({ id: m.id, name: m.name, provider: m.provider, availability: m.availability })),
    catalog: catalogService.snapshot(),
    cached: false,
  };
  modelsCache = { at: Date.now(), payload };
  return res.json(maySeeDetail ? payload : anonymousModelsView(payload));
});

// ─── Get User 7-Day Token Quota Status ────────────────────────────────────
router.get('/quota', authenticate, async (req, res) => {
  try {
    const quota = await tokenQuotaService.checkQuota(req.user._id, 0);
    const user = req.user;
    res.json({
      success: true,
      quota: {
        weeklyLimit: quota.limit,
        tokensUsed7d: quota.tokensUsed,
        remaining: quota.remaining,
        daysLeft: quota.daysLeft,
        tier: user.subscription?.tier || 'free',
        status: user.subscription?.status || 'active',
        isAdmin: user.role === 'admin',
        history: user.tokenQuota?.history || [],
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Get Skills List ───────────────────────────────────────────────────────
router.get('/skills', (req, res) => {
  res.json({ success: true, skills: SKILLS });
});

// ─── Warm Up Local AI (non-blocking) ─────────────────────────────────────
// The visitor picked a local model: wake LM Studio and load the smallest chat
// model, in the background. Progress is read back from /lm-studio/status so no
// browser request ever sits open while a daemon boots.
router.post('/lm-studio/warm', async (req, res) => {
  const { model, ttlSeconds } = req.body || {};
  // Only a signed-in dashboard user may pin a specific model or TTL. Anonymous
  // callers always warm the smallest model with the service default TTL, so a
  // crafted request can never pull a 27B model into this machine's RAM.
  const mayPin = await callerMaySeeDetail(req);
  const requestedModel = mayPin ? model : undefined;
  const requestedTtl = mayPin ? ttlSeconds : undefined;
  const status = await lmStudioService.getStatus({ prune: false });

  if (status.isOnline) {
    // Already up: load the model (bounded), but never block the response on it.
    lmStudioService.ensureModelLoaded(requestedModel, requestedTtl).catch(() => {});
    return res.json({ success: true, state: 'online', warmed: false, isOnline: true, message: 'Private model ready' });
  }

  lmStudioService
    .ensureModelLoaded(requestedModel, requestedTtl)
    .then(result => {
      if (!result.ok) console.warn(`⚠️  warm-up finished without a ready model: ${result.error}`);
    })
    .catch(err => console.warn(`⚠️  warm-up failed: ${err.message}`));

  res.json({
    success: true,
    state: 'starting',
    warmed: false,
    isOnline: false,
    message: 'Waking the private on-device model — the first start can take a minute',
  });
});

// ─── Free RAM / Unload Endpoint ──────────────────────────────────────────
// Called when the visitor leaves the local chat. Unloads the model, and stops
// the server too when we were the ones who started it — unless the caller asks
// to keep the daemon alive.
router.post('/lm-studio/unload', async (req, res) => {
  const { model, stopServer = true, graceSeconds } = req.body || {};

  if (!stopServer) {
    const unloaded = await lmStudioService.unloadModel(model);
    return res.json({
      success: true,
      unloaded,
      serverStopped: false,
      message: 'Local model unloaded from RAM',
    });
  }

  // A page unload is also what a reload looks like, so the caller may pass a
  // grace window: model RAM is freed at once, the server stops if nobody
  // touches it again within that window.
  const grace = graceSeconds === undefined ? 90 : Number(graceSeconds);
  const released = await lmStudioService.releaseLocalAi({ graceSeconds: grace });
  res.json({
    success: true,
    unloaded: released.unloaded,
    serverStopped: released.serverStopped,
    serverStopsInSeconds: released.serverStopsInSeconds ?? null,
    message: released.serverStopped
      ? 'Private model unloaded — RAM released'
      : released.serverStopsInSeconds
        ? `Private model unloaded. It stops again in ${released.serverStopsInSeconds}s unless it is used.`
        : 'Private model unloaded from RAM',
  });
});

// ─── LM Studio Lifecycle Status ──────────────────────────────────────────
// Signed-in dashboard users get the operational detail. Anyone else (public
// visitors, network scanners hitting :5000 directly) gets only a boolean —
// never the daemon's model list, ports or error messages.
router.get('/lm-studio/status', async (req, res) => {
  const bearer = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  let maySeeDetail = false;
  try {
    const decoded = jwt.verify(
      bearer.startsWith('Bearer ') ? bearer.slice(7) : '',
      process.env.JWT_SECRET || 'fallback-secret'
    );
    const user = await User.findById(decoded.id || decoded._id);
    maySeeDetail = !!user?.isActive;
  } catch { /* anonymous or invalid token → minimal payload */ }

  const status = await lmStudioService.getStatus();
  const chatModels = status.isOnline ? await lmStudioService.listChatModels() : [];

  if (!maySeeDetail) {
    // Anonymous: only a boolean plus how many public-size models could serve.
    const publicSized = chatModels.filter(m => (m.paramsB || Infinity) <= (lmStudioService.MAX_PUBLIC_PARAMS_B || 3));
    return res.json({
      success: true,
      isOnline: status.isOnline,
      starting: status.starting,
      availablePublicModels: publicSized.length,
      availablePublicParamsB: publicSized.length ? Math.max(...publicSized.map(m => m.paramsB)) : 0,
    });
  }

  res.json({
    success: true,
    isOnline: status.isOnline,
    state: status.state,
    starting: status.starting,
    loadedModels: status.loadedModels,
    activeModel: status.activeModel,
    startedByService: status.startedByService,
    lastError: status.lastError,
    idleStopInMs: status.idleStopInMs,
    chatModels,
  });
});

// ─── Public model routing ──────────────────────────────────────────────────
// Cloud ids carry their provider as a prefix (groq/…, nvidia/…), the Gemini and
// Cohere families do not. Everything else is treated as a local LM Studio id.
const CLOUD_ID_PATTERN = /^(groq|agnes|unorouter|llm7|ollama|nvidia|google|liquid|cohere|thinkingmachines|deepseek|openai)\//;
const CLOUD_BARE_ID_PATTERN = /^(gemini|command-r)/i;

/** True when the caller carries a valid JWT for an active user (dashboard owner). */
async function callerMaySeeDetail(req) {
  const bearer = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  try {
    const decoded = jwt.verify(
      bearer.startsWith('Bearer ') ? bearer.slice(7) : '',
      process.env.JWT_SECRET || 'fallback-secret'
    );
    const user = await User.findById(decoded.id || decoded._id);
    return !!user?.isActive;
  } catch {
    return false; // anonymous or invalid token
  }
}

/** The only model-catalog fields an anonymous caller may see: no local ids,
 *  no loaded list, no provider catalog snapshot. The public chat injects its
 *  own generic "private on-device" option client-side. */
function anonymousModelsView(full) {
  return {
    success: true,
    onDeviceAvailable: Boolean(full.lmStudioOnline),
    publicModels: full.publicCloudModels || [],
    publicLocalModels: [],
    publicCloudModels: full.publicCloudModels || [],
  };
}

/**
 * Decide what a signed-out visitor is allowed to run, and say why when they are not.
 * One function so the model menu and this endpoint can never disagree.
 */
function pickDefaultPublicCloudModel() {
  const free = catalogService
    .annotate(cloudAIService.getAvailableModels())
    .filter(m => m.isPaid === false && m.servable && m.availability !== catalogService.OUT_OF_STOCK);
  return free[0]?.id || null;
}

function resolvePublicRoute(model) {
  if (!model) {
    // No model named: use a free cloud model so an anonymous request can never
    // pull a model into the host's RAM as a side effect. Local-only machines
    // still work, but then the local path is not "explicit" and will not boot.
    const fallbackCloud = pickDefaultPublicCloudModel();
    if (fallbackCloud) return { ok: true, kind: 'cloud', model: fallbackCloud };
    return { ok: true, kind: 'local', model: null, explicit: false };
  }

  if (model === 'local') {
    return { ok: true, kind: 'local', model: null, explicit: true };
  }

  if (CLOUD_ID_PATTERN.test(model) || CLOUD_BARE_ID_PATTERN.test(model)) {
    const annotation = catalogService
      .annotate(cloudAIService.getAvailableModels())
      .find(m => m.id === model);

    if (!annotation) {
      return {
        ok: false,
        code: 'MODEL_NOT_OFFERED',
        message: `"${model}" is not available to public visitors. Sign in to unlock every provider.`,
      };
    }
    if (annotation.isPaid) {
      return {
        ok: false,
        code: 'MODEL_PAID',
        message: `"${annotation.name || model}" is a paid model. Choose a free model or sign in.`,
      };
    }
    if (!annotation.servable || annotation.availability === catalogService.OUT_OF_STOCK) {
      return {
        ok: false,
        code: 'MODEL_UNAVAILABLE',
        message: `"${annotation.name || model}" is ${annotation.availability || 'unavailable'} right now.`,
      };
    }
    return { ok: true, kind: 'cloud', model };
  }

  const info = classifyModel(model, 'local');
  if (info.isPaid) {
    return {
      ok: false,
      code: 'MODEL_TOO_LARGE',
      message: `"${model}" needs more RAM than the free public tier allows. Pick a small local model or a free cloud model.`,
    };
  }
  return { ok: true, kind: 'local', model, explicit: true };
}

// Gentle guest guard: public cloud replies spend the owner's free provider keys.
const GUEST_CLOUD_LIMIT_PER_HOUR = Number(process.env.PUBLIC_CLOUD_LIMIT_PER_HOUR || 20);
const guestCloudUsage = new Map();

function checkGuestCloudQuota(ip) {
  const now = Date.now();
  if (guestCloudUsage.size > 5000) {
    for (const [key, value] of guestCloudUsage) {
      if (now > value.resetAt) guestCloudUsage.delete(key);
    }
  }
  const entry = guestCloudUsage.get(ip) || { count: 0, resetAt: now + 3600000 };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + 3600000;
  }
  if (entry.count >= GUEST_CLOUD_LIMIT_PER_HOUR) {
    return { ok: false, retryInMinutes: Math.ceil((entry.resetAt - now) / 60000) };
  }
  entry.count += 1;
  guestCloudUsage.set(ip, entry);
  return { ok: true, remaining: GUEST_CLOUD_LIMIT_PER_HOUR - entry.count };
}

// ─── Public Chat Message Endpoint (No Login Required) ──────────────────────
router.post('/public/message', async (req, res) => {
  try {
    const { message, conversationId, model } = req.body;
    if (!message?.trim()) {
      return res.status(400).json({ success: false, message: 'Message cannot be empty' });
    }

    const route = resolvePublicRoute(model);
    if (!route.ok) {
      return res.status(403).json({ success: false, code: route.code, message: route.message });
    }

    let convo;
    if (conversationId) {
      convo = await Conversation.findOne({ _id: conversationId, isPublic: true });
    }
    if (!convo) {
      convo = new Conversation({
        title: message.slice(0, 45) + (message.length > 45 ? '...' : ''),
        isPublic: true,
        mode: 'local',
        model,
        messages: [],
      });
    }

    convo.messages.push({ role: 'user', content: message, timestamp: new Date() });

    const systemPrompt = 'You are HerovaAi, a helpful, fast and professional assistant.';
    const messages = [
      { role: 'system', content: systemPrompt },
      ...convo.messages.slice(-15).map(m => ({ role: m.role, content: m.content })),
    ];

    let aiResponse = '';
    let modelUsed = route.model;

    if (route.kind === 'cloud') {
      // ── Free cloud model, no local RAM involved ──────────────────────────
      const quota = checkGuestCloudQuota(req.ip || 'unknown');
      if (!quota.ok) {
        return res.status(429).json({
          success: false,
          code: 'GUEST_QUOTA',
          message: `Free cloud chat is limited for guests. Try again in ${quota.retryInMinutes} min, or sign in for a higher quota.`,
        });
      }

      try {
        const apiResult = await cloudAIService.generateCompletion({
          model: route.model,
          messages: convo.messages.slice(-15).map(m => ({ role: m.role, content: m.content })),
          systemPrompt,
          temperature: 0.7,
        });
        aiResponse = apiResult.text || '';
        modelUsed = apiResult.modelUsed || route.model;
      } catch (cloudErr) {
        return res.status(503).json({
          success: false,
          code: 'CLOUD_FAILED',
          message: cloudErr.message || 'The cloud provider did not answer. Try another model.',
        });
      }
    } else {
      // ── Local LM Studio: wake it on demand, never hang the browser ───────
      const status = await lmStudioService.getStatus({ prune: false });
      if (!status.isOnline) {
        if (!route.explicit) {
          // Not asked for explicitly: report instead of booting a model server.
          return res.status(503).json({
            success: false,
            code: 'NO_MODEL',
            message: 'No free cloud model is configured right now. Pick a local model to run it on this PC.',
          });
        }
        lmStudioService.ensureModelLoaded(route.model, 20).catch(() => {});
        return res.status(503).json({
          success: false,
          code: 'LM_STARTING',
          message: 'Waking the private on-device model (first start can take a minute). This message will go through once it is ready.',
        });
      }

      const ready = await lmStudioService.ensureModelLoaded(route.model, 20);
      if (!ready.ok) {
        return res.status(503).json({
          success: false,
          code: 'LM_UNAVAILABLE',
          message: ready.error || 'No local model is available right now.',
        });
      }
      if (route.model) modelUsed = ready.model || route.model;
      else modelUsed = ready.model || 'local';

      const lmUrl = process.env.LM_STUDIO_BASE_URL || 'http://localhost:1234/v1';
      try {
        const lmResponse = await axios.post(`${lmUrl}/chat/completions`, {
          messages,
          model: modelUsed && modelUsed !== 'local' ? modelUsed : undefined,
          temperature: 0.7,
        }, { timeout: 120000 });

        aiResponse = lmResponse.data.choices?.[0]?.message?.content || 'No response from the local model.';
        // Public replies never advertise the concrete model id living on this machine.
        modelUsed = 'on-device';
      } catch (lmErr) {
        const offline = lmErr.code === 'ECONNREFUSED' || lmErr.code === 'ECONNABORTED';
        const fallback = String(lmErr.message || '').replace(/[Ll][Mm] ?[Ss]tudio|bionic/g, 'the model engine').slice(0, 140);
        return res.status(offline ? 503 : 500).json({
          success: false,
          code: offline ? 'LM_OFFLINE' : 'LM_FAILED',
          message: offline
            ? 'The private on-device model went away. Retry from the chat and it will restart.'
            : (fallback || 'The on-device model could not answer — try again or pick a cloud model.'),
        });
      }
    }

    if (typeof aiResponse !== 'string' || !aiResponse.trim()) {
      return res.status(502).json({
        success: false,
        code: 'EMPTY_AI_RESPONSE',
        message: 'The selected AI model returned an empty response. Retry or choose another available model.',
      });
    }

    convo.messages.push({
      role: 'assistant',
      content: aiResponse,
      model: modelUsed,
      timestamp: new Date(),
    });
    convo.updatedAt = new Date();
    await convo.save();

    if (req.io) {
      req.io.to('admin-room').emit('new-message', {
        type: 'public_chat',
        conversationId: convo._id,
        user: { name: 'Public Guest' },
        message,
        aiResponse,
      });
    }

    res.json({
      success: true,
      conversationId: convo._id,
      userMessage: { role: 'user', content: message },
      aiMessage: {
        role: 'assistant',
        content: aiResponse,
        // Never disclose which key in the owner's pool answered.
        model: String(modelUsed || '').replace(/\s*\(key #\d+\)\s*$/, ''),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Helper: Build system prompt from memory ───────────────────────────────
// The business-profile block lives in services/memoryProfile so the web chat and
// the WhatsApp auto-reply describe the same shop in the same words.
function buildSystemPrompt(memory, basePrompt) {
  const profile = memoryProfile.promptBlock(memory);
  let prompt = profile;

  if (basePrompt) {
    prompt += `${prompt ? '\n\n' : ''}Additional guidelines: ${basePrompt}`;
  }

  return prompt.trim() || 'You are a helpful AI assistant.';
}

module.exports = router;
// Exposed for the extraction unit test (scripts-style check, no server needed).
module.exports.extractArtifacts = extractArtifacts;
