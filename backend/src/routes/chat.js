const express = require('express');
const axios = require('axios');
const router = express.Router();
const Conversation = require('../models/Conversation');
const AIMemory = require('../models/AIMemory');
const { authenticate } = require('../middleware/auth');
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

// Helper: Extract code artifacts from AI output
function extractArtifacts(text, skill) {
  const artifacts = [];
  const htmlBlockRegex = /```(?:html|game|app|svg)\s*([\s\S]*?)```/gi;
  let match;
  let count = 1;
  while ((match = htmlBlockRegex.exec(text)) !== null) {
    const code = match[1].trim();
    if (code.length > 50) {
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
  }
  return artifacts;
}

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
  try {
    const { message, mode, model, attachments = [], skill = 'general' } = req.body;
    if (!message?.trim() && (!attachments || attachments.length === 0)) {
      return res.status(400).json({ success: false, message: 'Message or attachment is required' });
    }

    const convo = await Conversation.findOne({ _id: req.params.id, userId: req.user._id });
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
      systemPrompt = `${activeSkillObj.systemDirective}\n\n${systemPrompt}`;
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
      }, { timeout: 60000 });

      aiResponse = lmResponse.data.choices?.[0]?.message?.content || 'No response from LM Studio model';
      modelUsed = lmResponse.data.model || chosenModel || 'LM Studio Local';
      tokensUsed = lmResponse.data.usage?.total_tokens || 0;

    // ── Mode: ContentBot Agent ─────────────────────────────────────────────
    } else if (chatMode === 'contentbot') {
      const apiKey = req.user.contentbotApiKey || process.env.CONTENTBOT_API_KEY;
      if (!apiKey) {
        return res.status(400).json({
          success: false,
          message: 'No ContentBot Agent Key configured. Please enter your API key in Settings or switch to API Models.',
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
      });

      aiResponse = cbResponse.data.response || cbResponse.data.message || 'No response from ContentBot';
      modelUsed = chosenModel || 'ContentBot Agent';
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
        message: 'LM Studio is offline on port 1234. Please switch to "API Models" tab to chat immediately!',
      });
    }
    res.status(500).json({ success: false, message: err.message });
  }
});

// Composed model list, kept warm for a minute: the probe runs against ten providers and
// the UI refetches on every panel open.
const MODELS_CACHE_TTL_MS = 60 * 1000;
let modelsCache = { at: 0, payload: null };

// ─── List available models (Local + API Models + ContentBot) ───────────────
router.get('/models', async (req, res) => {
  // Composed from a probe of every provider, so the compose cost is paid once per minute
  // instead of on every keystroke-driven refetch.
  const wantsFresh = Boolean(req.query.refresh);
  if (!wantsFresh && modelsCache.payload && Date.now() - modelsCache.at < MODELS_CACHE_TTL_MS) {
    return res.json({ ...modelsCache.payload, cached: true });
  }

  const lmUrl = process.env.LM_STUDIO_BASE_URL || 'http://localhost:1234/v1';
  let lmModels = [];
  let lmLoadedIds = [];
  let isLmOnline = false;

  try {
    let response;
    try {
      response = await axios.get(`${lmUrl}/models`, { timeout: 1500 });
    } catch {
      await lmStudioService.ensureServerRunning();
      response = await axios.get(`${lmUrl}/models`, { timeout: 2500 });
    }
    isLmOnline = true;
    const raw = response.data?.data || [];
    lmModels = raw.map(m => classifyModel(m.id || m.name, 'local'));
  } catch (err) {
    isLmOnline = false;
  }

  // No invented stand-ins: if LM Studio serves nothing, the list says so and stays empty.
  // An offline local server is a fact about this machine, not a model menu.
  try {
    lmLoadedIds = (await lmStudioService.getLoadedModels()) || [];
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
    { id: 'contentbot-standard', name: 'ContentBot Standard Agent', source: 'contentbot', tier: 'free', isPaid: false, badge: 'ContentBot Free' },
    { id: 'contentbot-pro', name: 'ContentBot Pro Multi-Agent', source: 'contentbot', tier: 'paid', isPaid: true, badge: 'ContentBot Pro' },
  ];

  const payload = {
    success: true,
    lmStudioOnline: isLmOnline,
    lmStudioLoaded: lmLoadedIds,
    lmStudioNote: isLmOnline
      ? (lmLoadedIds.length ? `${lmLoadedIds.length} model(s) loaded` : 'server up, nothing loaded')
      : 'LM Studio is not reachable on port 1234',
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
  res.json(payload);
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

// ─── Free RAM / Unload Endpoint ──────────────────────────────────────────
router.post('/lm-studio/unload', async (req, res) => {
  const { model } = req.body || {};
  const ok = await lmStudioService.unloadModel(model);
  res.json({ success: ok, message: 'Model unloaded from RAM to free memory' });
});

// ─── LM Studio Lifecycle Status ──────────────────────────────────────────
router.get('/lm-studio/status', async (req, res) => {
  const isOnline = await lmStudioService.isServerRunning();
  const loaded = await lmStudioService.getLoadedModels();
  res.json({ success: true, isOnline, loadedModels: loaded });
});

// ─── Public Chat Message Endpoint (No Login Required) ──────────────────────
router.post('/public/message', async (req, res) => {
  try {
    const { message, conversationId, model = 'qwen2-0.5b-uncensored' } = req.body;
    if (!message?.trim()) {
      return res.status(400).json({ success: false, message: 'Message cannot be empty' });
    }

    const modelInfo = classifyModel(model, 'local');
    if (modelInfo.isPaid) {
      return res.status(403).json({
        success: false,
        message: `🔒 "${model}" is a PRO/Paid model (3B+). Public chat is limited to 0.5B - 1B models. Please select a Free model or log in!`,
      });
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

    await lmStudioService.ensureModelLoaded(model || 'qwen2-0.5b-uncensored', 20);

    const lmUrl = process.env.LM_STUDIO_BASE_URL || 'http://localhost:1234/v1';
    const systemPrompt = 'You are ContentBot AI, a helpful, fast and professional assistant running locally.';
    const messages = [
      { role: 'system', content: systemPrompt },
      ...convo.messages.slice(-15).map(m => ({ role: m.role, content: m.content })),
    ];

    let aiResponse = '';
    let modelUsed = model;

    try {
      const lmResponse = await axios.post(`${lmUrl}/chat/completions`, {
        messages,
        model: model !== 'local' ? model : undefined,
        temperature: 0.7,
      }, { timeout: 60000 });

      aiResponse = lmResponse.data.choices?.[0]?.message?.content || 'No response from local LM Studio model.';
      modelUsed = lmResponse.data.model || model;
    } catch (lmErr) {
      if (lmErr.code === 'ECONNREFUSED') {
        return res.status(503).json({
          success: false,
          message: 'LM Studio is not running on port 1234. Please launch LM Studio on your PC, start the Local Server, and load a model.',
        });
      }
      throw lmErr;
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
      aiMessage: { role: 'assistant', content: aiResponse, model: modelUsed },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Helper: Build system prompt from memory ───────────────────────────────
function buildSystemPrompt(memory, basePrompt) {
  let prompt = '';
  
  if (memory.ownerName || memory.businessName) {
    prompt += `You are an AI assistant representing ${memory.ownerName || 'the owner'}`;
    if (memory.businessName) prompt += ` at ${memory.businessName}`;
    prompt += '.\n';
  }
  if (memory.businessType) prompt += `Business type: ${memory.businessType}.\n`;
  if (memory.businessDescription) prompt += `Business details: ${memory.businessDescription}.\n`;
  if (memory.tone) prompt += `Tone: ${memory.tone}.\n`;
  if (memory.language) prompt += `Primary language: ${memory.language}.\n`;

  if (memory.entries?.length > 0) {
    prompt += '\nBusiness Knowledge Base:\n';
    memory.entries.forEach(e => {
      prompt += `- ${e.key}: ${e.value}\n`;
    });
  }

  if (basePrompt) prompt += `\nAdditional guidelines: ${basePrompt}`;
  
  return prompt.trim() || 'You are a helpful AI assistant.';
}

module.exports = router;
