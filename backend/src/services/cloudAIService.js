/**
 * Cloud AI Service — All API Models with Multi-Key Rotation & Automatic Failover
 * Verified live against:
 * - Groq (Ultra-Fast)
 * - Google Gemini (7 keys fallback pool)
 * - Agnes AI ("apenteis" / Agnes — 7 keys fallback pool)
 * - UnoRouter ("orca router" / UnoRouter free models)
 * - OpenRouter (2 keys fallback pool)
 * - LLM7 Gateway
 * - Ollama Cloud
 * - DeepSeek Direct
 * - Cohere Direct
 * - OpenAI Direct
 */

const axios = require('axios');
const catalogService = require('./catalogService');
const keyVault = require('./keyVault');

// Curated catalog of models this deployment wants to offer. Whether each id can actually
// serve is checked against the provider's live list by catalogService, never assumed here.
const ALL_MODELS_CATALOG = [
  // ── Groq (Ultra-Fast — Instant WhatsApp Replies) ──
  {
    id: 'groq/qwen/qwen3.8-27b',
    name: 'Groq Qwen 3.8 27B (Instant)',
    provider: 'groq',
    badge: '⚡ Groq · ~500 t/s',
    description: 'Blazing-fast Qwen 3.8 on Groq LPUs — instant response time',
    multimodal: false,
    group: 'Groq (Ultra-Fast)',
  },
  {
    id: 'groq/openai/gpt-oss-120b',
    name: 'Groq GPT-OSS 120B (Instant)',
    provider: 'groq',
    badge: '⚡ Groq · 120B',
    description: '120B open model running at lightning speed on Groq hardware',
    multimodal: false,
    group: 'Groq (Ultra-Fast)',
  },
  {
    id: 'groq/openai/gpt-oss-20b',
    name: 'Groq GPT-OSS 20B (Instant)',
    provider: 'groq',
    badge: '⚡ Groq · Fast',
    description: 'Ultra-lightweight fast conversational model',
    multimodal: false,
    group: 'Groq (Ultra-Fast)',
  },

  // ── Gemini Direct (7 Keys Fallback + Vision / Multimodal) ──
  // End-to-end verified 2026-10-08: 2.5-flash + 3.8-flash answer; 3.8 may 503
  // under demand spikes (transient — retry/failover covers it).
  {
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash (Latest)',
    provider: 'gemini',
    badge: '✨ Gemini 3.8 · Latest',
    description: 'Newest Gemini Flash — fastest capable model, 7-key rotation',
    multimodal: true,
    group: 'Gemini Direct (7 Keys)',
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash (Vision+)',
    provider: 'gemini',
    badge: '✨ Gemini 2.5 Vision',
    description: 'Google Gemini 2.5 Flash — multimodal, files, images, videos',
    multimodal: true,
    group: 'Gemini Direct (7 Keys)',
  },
  {
    id: 'gemini-flash-latest',
    name: 'Gemini Flash Latest',
    provider: 'gemini',
    badge: '⚡ Gemini Flash',
    description: 'Always points to latest stable Gemini Flash version',
    multimodal: true,
    group: 'Gemini Direct (7 Keys)',
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    provider: 'gemini',
    badge: '💼 Gemini 2.5 Pro',
    description: 'Flagship deep reasoning and large context analysis',
    multimodal: true,
    group: 'Gemini Direct (7 Keys)',
  },
  {
    id: 'gemini-3-flash-preview',
    name: 'Gemini 3 Flash Preview',
    provider: 'gemini',
    badge: '🔬 Gemini 3 Preview',
    description: 'Next-gen Gemini 3 model preview',
    multimodal: true,
    group: 'Gemini Direct (7 Keys)',
  },

  // ── Agnes AI ("apenteis" — 7 Keys Fallback) ──
  {
    id: 'agnes/agnes-3.0-flash',
    name: 'Agnes 3.0 Flash (Apenteis)',
    provider: 'agnes',
    badge: '🌸 Agnes 3.0',
    description: 'Agnes AI flagship conversational model (7 keys fallback pool)',
    multimodal: false,
    group: 'Agnes AI (Apenteis)',
  },
  {
    id: 'agnes/agnes-2.5-flash',
    name: 'Agnes 2.5 Flash',
    provider: 'agnes',
    badge: '🌸 Agnes 2.5',
    description: 'Fast responsive Agnes model',
    multimodal: false,
    group: 'Agnes AI (Apenteis)',
  },

  // ── UnoRouter ("orca router" / UnoRouter) ──
  {
    id: 'unorouter/agnes-3.0-flash:free',
    name: 'UnoRouter Agnes 3.0 Free',
    provider: 'unorouter',
    badge: '🐋 UnoRouter · Free',
    description: 'Agnes 3.0 via UnoRouter gateway',
    multimodal: false,
    group: 'UnoRouter (Orca)',
  },
  {
    id: 'unorouter/allam-2-7b:free',
    name: 'UnoRouter Allam 7B Free',
    provider: 'unorouter',
    badge: '🐋 UnoRouter · 7B',
    description: 'Allam 7B fast assistant model',
    multimodal: false,
    group: 'UnoRouter (Orca)',
  },

  // ── LLM7 Gateway ──
  {
    id: 'llm7/GLM-5.3-Flash',
    name: 'LLM7 GLM-5.3 Flash',
    provider: 'llm7',
    badge: '🚀 LLM7 · Flash',
    description: 'GLM 5.3 Flash high-efficiency engine',
    multimodal: false,
    group: 'LLM7 Gateway',
  },

  // ── Ollama Cloud ──
  {
    id: 'ollama/nemotron-3-nano:30b',
    name: 'Ollama Cloud Nemotron 30B',
    provider: 'ollama_cloud',
    badge: '☁️ Ollama Cloud',
    description: 'Nvidia Nemotron 30B hosted on Ollama Cloud',
    multimodal: false,
    group: 'Ollama Cloud',
  },

  // ── OpenRouter Free Models (2 Keys Fallback) ──
  {
    id: 'nvidia/nemotron-3.5-lightning:free',
    name: 'Nemotron 3.5 Lightning',
    provider: 'openrouter',
    badge: '⚡ Free · Nvidia',
    description: 'High-speed Nvidia model via OpenRouter',
    multimodal: false,
    group: 'OpenRouter Free',
  },
  {
    id: 'nvidia/nemotron-3-super-120b-a12b:free',
    name: 'Nemotron 3 Super 120B',
    provider: 'openrouter',
    badge: '🔥 Free · 120B',
    description: 'Nvidia Super 120B — deep business logic',
    multimodal: false,
    group: 'OpenRouter Free',
  },
  {
    id: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    name: 'Nemotron 3 Ultra 550B',
    provider: 'openrouter',
    badge: '💎 Free · 550B',
    description: 'Largest free cloud model (550B parameters)',
    multimodal: false,
    group: 'OpenRouter Free',
  },
  {
    id: 'google/gemma-4-31b-it:free',
    name: 'Gemma 4 31B Instruct',
    provider: 'openrouter',
    badge: '🌟 Free · Google',
    description: 'Flagship open weights model from Google',
    multimodal: false,
    group: 'OpenRouter Free',
  },
  {
    id: 'google/gemma-4-26b-a4b-it:free',
    name: 'Gemma 4 26B MoE',
    provider: 'openrouter',
    badge: '🌟 Free · MoE',
    description: 'Google Gemma 26B Mixture-of-Experts',
    multimodal: false,
    group: 'OpenRouter Free',
  },
  {
    id: 'liquid/lfm-2.5-2.6b:free',
    name: 'Liquid LFM 2.6B Free',
    provider: 'openrouter',
    badge: '💧 Free · Fast',
    description: 'LiquidAI ultra-fast responsive model',
    multimodal: false,
    group: 'OpenRouter Free',
  },
  {
    id: 'cohere/north-mini-code:free',
    name: 'Cohere North Mini Code',
    provider: 'openrouter',
    badge: '💻 Free · Cohere',
    description: 'Cohere code & problem solving model',
    multimodal: false,
    group: 'OpenRouter Free',
  },
  {
    id: 'thinkingmachines/inkling:free',
    name: 'Inkling Reasoning Free',
    provider: 'openrouter',
    badge: '🤔 Free · Thinking',
    description: 'Thinking Machines reasoning model',
    multimodal: false,
    group: 'OpenRouter Free',
  },

  // ── DeepSeek Direct ──
  // PARKED 2026-10-08: both keys return 402 Insufficient Balance end-to-end.
  // Keys stay registered (keyVault + DEEPSEEK_API_KEY_2 pool) so a top-up
  // reactivates these two ids with no code change.
  // { id: 'deepseek/deepseek-flash', ... },
  // { id: 'deepseek/deepseek-v4-pro', ... },

  // ── Cohere Direct ──
  // End-to-end verified 2026-10-08 (command-a-03-2025 answers on /v1/chat;
  // command-a-plus-05-2026 needs /v2/chat so it is NOT listed).
  {
    id: 'command-a-03-2025',
    name: 'Cohere Command A',
    provider: 'cohere',
    badge: '🌊 Cohere A',
    description: 'Current-gen Cohere enterprise conversation model',
    multimodal: false,
    group: 'Cohere Direct',
  },
  {
    id: 'command-r-plus-08-2024',
    name: 'Cohere Command R+',
    provider: 'cohere',
    badge: '🌊 Cohere R+',
    description: 'Cohere flagship reasoning model (/v1 API)',
    multimodal: false,
    group: 'Cohere Direct',
  },

  // ── OpenAI (via OpenRouter with credits) ──
  {
    id: 'openai/gpt-4o-mini',
    name: 'GPT-4o Mini (OpenAI)',
    provider: 'openrouter',
    badge: '🤖 GPT-4o Mini',
    description: 'Official OpenAI GPT-4o Mini model',
    multimodal: true,
    group: 'OpenAI',
  },
];

/**
 * A specific model was asked for and could not serve. Strict routing raises this instead of
 * quietly answering with some other model, so the caller can say so plainly.
 */
class ModelUnavailableError extends Error {
  constructor(message, { model, availability = 'out_of_stock' } = {}) {
    super(message);
    this.name = 'ModelUnavailableError';
    this.code = 'MODEL_UNAVAILABLE';
    this.model = model;
    this.availability = availability;
  }
}

class CloudAIService {
  constructor() {
    this.refreshKeys();
  }

  /**
   * Keys come from the vault, not straight from process.env: a key an admin rotated in the
   * dashboard then takes effect on the next call, while the .env value stays as the fallback.
   */
  refreshKeys() {
    // 1. OpenRouter Keys (pool)
    this.openRouterKeys = keyVault.resolveMany(['OPENROUTER_API_KEY', 'OPENROUTER_API_KEY_2']);

    // 2. Gemini Keys (pool of 7 keys for fallback)
    this.geminiKeys = keyVault.resolveMany(
      ['GEMINI_API_KEY', ...Array.from({ length: 6 }, (_, i) => `GEMINI_API_KEY_${i + 2}`)]
    );

    // 3. Agnes AI ("apenteis" / Agnes — pool of 7 keys)
    this.agnesKeys = keyVault.resolveMany(
      ['AGENS_API_KEY', ...Array.from({ length: 5 }, (_, i) => `AGENS_API_KEY_${i + 2}`), 'AGNES_API_KEY']
    );

    // 4. Groq Key
    this.groqKey = keyVault.firstKey(['GROQ_API_KEY']) || undefined;

    // 5. UnoRouter Key ("orca router" / UnoRouter)
    this.unorouterKey = keyVault.firstKey(['UNOROUTER_API_KEY', 'CB_UNOROUTER_API_KEY']) || undefined;

    // 6. LLM7 Key
    this.llm7Key = keyVault.firstKey(['LLM7_API_KEY']) || undefined;

    // 7. Ollama Cloud Key
    this.ollamaCloudKey = keyVault.firstKey(['OLLAMA_CLOUD_API_KEY', 'OLLAMA_API_KEY']) || undefined;

    // 8. OpenCode Zen Key (pool of 2)
    this.opencodeZenKey = keyVault.firstKey(['OPENCODE_ZEN_API_KEY', 'OPENCODE_ZEN_API_KEY_2']) || undefined;
    this.opencodeZenKeys = keyVault.resolveMany(['OPENCODE_ZEN_API_KEY', 'OPENCODE_ZEN_API_KEY_2']);

    // 9. Direct provider keys
    this.deepSeekKeys = keyVault.resolveMany(['DEEPSEEK_API_KEY', 'DEEPSEEK_API_KEY_2']);
    this.deepSeekKey = this.deepSeekKeys[0] || undefined;
    this.cohereKey   = keyVault.firstKey(['COHERE_API_KEY', 'CB_COHERE_API_KEY']) || undefined;
    this.openAIKey   = keyVault.firstKey(['OPENAI_API_KEY']) || undefined;

    // 10. Aggregator keys (registered for probes + generic caller; catalog
    // models only land here once chat answers end-to-end — verified 2026-10-08)
    this.apertisKey    = keyVault.firstKey(['APERTIS_API_KEY']) || undefined;
    this.apinexKey     = keyVault.firstKey(['APINEX_API_KEY']) || undefined;
    this.orcarouterKey = keyVault.firstKey(['ORCAROUTER_API_KEY']) || undefined;
    this.airforceKey   = keyVault.firstKey(['AIRFORCE_API_KEY']) || undefined;
    this.apmixKeys     = keyVault.resolveMany(['APMIX_API_KEY', 'APMIX_API_KEY_2']);
  }

  getAvailableModels() {
    this.refreshKeys();
    return ALL_MODELS_CATALOG.filter(m => {
      switch (m.provider) {
        case 'groq':         return Boolean(this.groqKey);
        case 'gemini':       return this.geminiKeys.length > 0;
        case 'agnes':        return this.agnesKeys.length > 0;
        case 'unorouter':    return Boolean(this.unorouterKey);
        case 'llm7':         return Boolean(this.llm7Key);
        case 'ollama_cloud': return Boolean(this.ollamaCloudKey);
        case 'openrouter':   return this.openRouterKeys.length > 0;
        case 'deepseek':     return this.deepSeekKeys.length > 0;
        case 'cohere':       return Boolean(this.cohereKey);
        case 'openai':       return Boolean(this.openAIKey || this.openRouterKeys.length > 0);
        case 'apertis':      return Boolean(this.apertisKey);
        case 'apinex':       return Boolean(this.apinexKey);
        case 'orcarouter':   return Boolean(this.orcarouterKey);
        case 'airforce':     return Boolean(this.airforceKey);
        case 'apmix':        return this.apmixKeys.length > 0;
        default:             return true;
      }
    });
  }

  /**
   * POST that survives provider-side request rejections (ceilings differ per
   * model): retry once with the offending knob removed, so a large artifact
   * generation can never 400 just because one parameter didn't fit. Aborts
   * (no response) pass straight through.
   */
  async _postCompat(url, body, config) {
    try {
      return await axios.post(url, body, config);
    } catch (err) {
      const data = err.response?.data;
      const msg = typeof data === 'string' ? data : JSON.stringify(data || {});
      const all = `${msg} ${err.message}`;
      if (err.response?.status !== 400) throw err;
      const hasCap = 'max_tokens' in body || body.generationConfig?.maxOutputTokens != null;
      if (hasCap && /max[_ ]?tokens|maxOutputTokens|maximum.{0,20}tokens|too (large|many)|exceed/i.test(all)) {
        delete body.max_tokens;
        if (body.generationConfig) delete body.generationConfig.maxOutputTokens;
        return await axios.post(url, body, config);
      }
      if (body.reasoning && /reasoning|unknown (field|parameter)|invalid.{0,20}parameter|not supported/i.test(all)) {
        delete body.reasoning; // model doesn't take a reasoning knob — try without it
        return await axios.post(url, body, config);
      }
      throw err;
    }
  }

  async generateCompletion({ model, messages = [], systemPrompt = '', attachments = [], temperature = 0.7,
                            allowFailover = false, maxTokens = null, signal = null }) {
    this.refreshKeys();
    const targetModel = model || 'groq/qwen/qwen3.8-27b';
    const modelDef = ALL_MODELS_CATALOG.find(m => m.id === targetModel);
    const provider = modelDef?.provider || 'openrouter';
    // Extra knobs every provider call understands: a bigger token budget for
    // full-page artifacts (games/apps) and an abort signal for the Stop button.
    const opts = { maxTokens, signal };

    const errors = [];

    // ── Availability gate ────────────────────────────────────────────────────
    // A picked model is a promise: either it answers, or the caller hears why. Only an
    // explicit allowFailover turns the request back into best-effort routing.
    const servable = await catalogService.checkServable(provider, targetModel);
    if (!servable.ok && servable.availability !== catalogService.UNVERIFIED && !allowFailover) {
      throw new ModelUnavailableError(
        `${targetModel} is unavailable (${servable.availability}): ${servable.reason}`,
        { model: targetModel, availability: servable.availability });
    }
    if (!servable.ok) {
      console.warn(`[CloudAIService] ${targetModel} is ${servable.availability} — `
        + `${servable.reason}; attempting anyway${allowFailover ? ' with failover' : ''}.`);
    }

    // ── Primary Attempt based on requested provider ──
    try {
      if (provider === 'groq') {
        return await this.callGroq(targetModel, messages, systemPrompt, temperature, opts);
      }
      if (provider === 'gemini') {
        return await this.callGeminiWithKeyRotation(targetModel, messages, systemPrompt, attachments, temperature, opts);
      }
      if (provider === 'agnes') {
        return await this.callAgnesWithKeyRotation(targetModel, messages, systemPrompt, temperature, opts);
      }
      if (provider === 'unorouter') {
        return await this.callUnoRouter(targetModel, messages, systemPrompt, temperature, opts);
      }
      if (provider === 'llm7') {
        return await this.callLLM7(targetModel, messages, systemPrompt, temperature, opts);
      }
      if (provider === 'ollama_cloud') {
        return await this.callOllamaCloud(targetModel, messages, systemPrompt, temperature, opts);
      }
      if (provider === 'deepseek') {
        return await this.callDeepSeek(targetModel, messages, systemPrompt, temperature, opts);
      }
      // Aggregators via the generic caller (no catalog models today — branches
      // activate the moment a verified id is added to ALL_MODELS_CATALOG).
      const GENERIC_BASES = {
        apertis: 'https://api.apertis.ai/v1',
        apinex: 'https://api.apinex.bond/v1',
        orcarouter: 'https://api.orcarouter.ai/v1',
        airforce: 'https://api.airforce/v1',
        apmix: 'https://api.apmix.ai/v1',
      };
      if (GENERIC_BASES[provider]) {
        const pool = provider === 'apmix' ? this.apmixKeys
          : [this[`${provider}Key`]].filter(Boolean);
        const bareId = targetModel.includes('/') ? targetModel.slice(targetModel.indexOf('/') + 1) : targetModel;
        return await this.callGenericCompat(provider, GENERIC_BASES[provider], pool, bareId, messages, systemPrompt, temperature, opts);
      }
      if (provider === 'cohere') {
        return await this.callCohere(targetModel, messages, systemPrompt, temperature, opts);
      }
      if (provider === 'openai' && this.openAIKey) {
        return await this.callOpenAIDirect(targetModel, messages, systemPrompt, attachments, temperature, opts);
      }
      return await this.callOpenRouterWithKeyRotation(targetModel, messages, systemPrompt, attachments, temperature, opts);
    } catch (err) {
      if (signal?.aborted || err?.code === 'ERR_CANCELED') throw err; // Stop button — never failover after cancel
      errors.push(`${provider}: ${err.message}`);
      if (!allowFailover) {
        throw new ModelUnavailableError(
          `${targetModel} could not answer: ${err.message}`,
          { model: targetModel, availability: servable.availability });
      }
      console.warn(`[CloudAIService] Primary provider "${provider}" failed (${err.message}). Entering Failover Chain...`);
    }

    // ── FAILOVER CHAIN (Guarantees zero-downtime reply) ──
    // Stop button wins over any fallback: a cancelled request never retries.
    if (signal?.aborted) throw Object.assign(new Error('Generation stopped'), { code: 'ERR_CANCELED' });
    // 1. Try Groq (Instant, ~300ms)
    if (this.groqKey && provider !== 'groq') {
      try {
        console.log(`[CloudAIService] Fallback 1: Trying Groq Qwen 3.8 27B...`);
        const res = await this.callGroq('groq/qwen/qwen3.8-27b', messages, systemPrompt, temperature, opts);
        res.failedOverFrom = targetModel;
        return res;
      } catch (e) { if (signal?.aborted) throw e; errors.push(`groq-fallback: ${e.message}`); }
    }

    // 2. Try Gemini Direct (Rotates 7 keys)
    if (this.geminiKeys.length > 0 && provider !== 'gemini') {
      try {
        console.log(`[CloudAIService] Fallback 2: Trying Gemini 2.5 Flash...`);
        const res = await this.callGeminiWithKeyRotation('gemini-2.5-flash', messages, systemPrompt, attachments, temperature, opts);
        res.failedOverFrom = targetModel;
        return res;
      } catch (e) { if (signal?.aborted) throw e; errors.push(`gemini-fallback: ${e.message}`); }
    }

    // 3. Try OpenRouter (Rotates keys)
    if (this.openRouterKeys.length > 0 && provider !== 'openrouter') {
      try {
        console.log(`[CloudAIService] Fallback 3: Trying OpenRouter Nemotron 3.5...`);
        const res = await this.callOpenRouterWithKeyRotation('nvidia/nemotron-3.5-lightning:free', messages, systemPrompt, attachments, temperature, opts);
        res.failedOverFrom = targetModel;
        return res;
      } catch (e) { if (signal?.aborted) throw e; errors.push(`openrouter-fallback: ${e.message}`); }
    }

    // 4. Try UnoRouter ("orca router")
    if (this.unorouterKey && provider !== 'unorouter') {
      try {
        console.log(`[CloudAIService] Fallback 4: Trying UnoRouter...`);
        const res = await this.callUnoRouter('unorouter/agnes-3.0-flash:free', messages, systemPrompt, temperature, opts);
        res.failedOverFrom = targetModel;
        return res;
      } catch (e) { if (signal?.aborted) throw e; errors.push(`unorouter-fallback: ${e.message}`); }
    }

    // 5. Try Agnes ("apenteis" / 7 keys)
    if (this.agnesKeys.length > 0 && provider !== 'agnes') {
      try {
        console.log(`[CloudAIService] Fallback 5: Trying Agnes 3.0 Flash...`);
        const res = await this.callAgnesWithKeyRotation('agnes/agnes-3.0-flash', messages, systemPrompt, temperature, opts);
        res.failedOverFrom = targetModel;
        return res;
      } catch (e) { if (signal?.aborted) throw e; errors.push(`agnes-fallback: ${e.message}`); }
    }

    // 6. Try LLM7
    if (this.llm7Key && provider !== 'llm7') {
      try {
        console.log(`[CloudAIService] Fallback 6: Trying LLM7...`);
        const res = await this.callLLM7('llm7/GLM-5.3-Flash', messages, systemPrompt, temperature, opts);
        res.failedOverFrom = targetModel;
        return res;
      } catch (e) { if (signal?.aborted) throw e; errors.push(`llm7-fallback: ${e.message}`); }
    }

    throw new Error(`All AI providers and fallback keys failed: ${errors.join(' | ')}`);
  }

  // ── Generic OpenAI-compatible caller ───────────────────────────────────
  // Serves every aggregator with {baseUrl, key(s)} and no special quirks
  // (apertis / apinex / orcarouter / airforce / apmix / zen). Keys rotate;
  // a catalog id for one of these providers lands in the menu only after an
  // end-to-end chat probe answers OK (see docs/MODELS.md).
  async callGenericCompat(provider, baseUrl, keys, modelId, messages, systemPrompt, temperature = 0.7, opts = {}) {
    const pool = Array.isArray(keys) ? keys : [keys];
    if (!pool.length || !pool[0]) throw new Error(`No ${provider} API key configured`);
    const formattedMessages = [];
    if (systemPrompt) formattedMessages.push({ role: 'system', content: systemPrompt });
    messages.forEach(m => formattedMessages.push({ role: m.role, content: m.content }));
    let lastError = null;
    for (let i = 0; i < pool.length; i++) {
      try {
        const res = await this._postCompat(`${baseUrl}/chat/completions`, {
          model: modelId,
          messages: formattedMessages,
          temperature,
          max_tokens: opts.maxTokens || 2048,
        }, {
          headers: {
            Authorization: `Bearer ${pool[i]}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'http://localhost:3001',
            'X-Title': 'ContentBot Studio',
          },
          timeout: opts.maxTokens ? 180000 : 45000,
          signal: opts.signal,
        });
        const text = res.data.choices?.[0]?.message?.content || '';
        const usage = res.data.usage || {};
        return {
          text: text.trim(),
          tokensUsed: usage.total_tokens || Math.round((text.length / 4) + 80),
          modelUsed: `${provider}/${modelId} (key #${i + 1})`,
        };
      } catch (err) {
        if (opts.signal?.aborted || err?.code === 'ERR_CANCELED') throw err;
        console.warn(`[${provider}] Key #${i + 1} failed (${err.response?.status || err.message}). Rotating...`);
        lastError = err;
      }
    }
    throw lastError || new Error(`All ${provider} API keys failed`);
  }

  // ── Groq Implementation ──────────────────────────────────────────────────
  async callGroq(modelId, messages, systemPrompt, temperature = 0.7, opts = {}) {
    if (!this.groqKey) throw new Error('GROQ_API_KEY not configured');
    const cleanModel = modelId.replace('groq/', '');

    const formattedMessages = [];
    if (systemPrompt) formattedMessages.push({ role: 'system', content: systemPrompt });
    messages.forEach(m => formattedMessages.push({ role: m.role, content: m.content }));

    const response = await this._postCompat('https://api.groq.com/openai/v1/chat/completions', {
      model: cleanModel,
      messages: formattedMessages,
      temperature,
      max_tokens: opts.maxTokens || 2048,
    }, {
      headers: {
        Authorization: `Bearer ${this.groqKey}`,
        'Content-Type': 'application/json',
      },
      timeout: opts.maxTokens ? 180000 : 30000,
      signal: opts.signal,
    });

    const text = response.data.choices?.[0]?.message?.content || '';
    const usage = response.data.usage || {};
    return {
      text: text.trim(),
      tokensUsed: usage.total_tokens || Math.round((text.length / 4) + 80),
      modelUsed: `groq/${cleanModel}`,
    };
  }

  // ── Gemini Direct with 7-Key Rotation Fallback ───────────────────────────
  async callGeminiWithKeyRotation(modelId, messages, systemPrompt, attachments = [], temperature = 0.7, opts = {}) {
    if (this.geminiKeys.length === 0) throw new Error('No GEMINI_API_KEY configured');
    const cleanModel = modelId.replace('models/', '');
    let lastError = null;

    for (let i = 0; i < this.geminiKeys.length; i++) {
      const apiKey = this.geminiKeys[i];
      try {
        const isOAuthKey = apiKey.startsWith('AQ.');
        
        if (isOAuthKey) {
          const formattedMessages = [];
          if (systemPrompt) formattedMessages.push({ role: 'system', content: systemPrompt });
          messages.forEach(m => formattedMessages.push({ role: m.role, content: m.content }));

          const res = await this._postCompat('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
            model: cleanModel,
            messages: formattedMessages,
            temperature,
            max_tokens: opts.maxTokens || 3000,
          }, {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            timeout: opts.maxTokens ? 180000 : 45000,
            signal: opts.signal,
          });

          const text = res.data.choices?.[0]?.message?.content || '';
          const usage = res.data.usage || {};
          return {
            text: text.trim(),
            tokensUsed: usage.total_tokens || Math.round((text.length / 4) + 100),
            modelUsed: `gemini/${cleanModel} (key #${i + 1})`,
          };
        } else {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${apiKey}`;
          const contents = [];
          if (systemPrompt) {
            contents.push({ role: 'user', parts: [{ text: `[System Instruction: ${systemPrompt}]` }] });
          }

          for (let mIdx = 0; mIdx < messages.length; mIdx++) {
            const m = messages[mIdx];
            const role = m.role === 'assistant' ? 'model' : 'user';
            const parts = [{ text: m.content || '' }];

            if (mIdx === messages.length - 1 && m.role === 'user' && attachments?.length > 0) {
              for (const att of attachments) {
                if (att.data && att.mimeType?.startsWith('image/')) {
                  const raw = att.data.includes(',') ? att.data.split(',')[1] : att.data;
                  parts.push({ inlineData: { mimeType: att.mimeType, data: raw } });
                }
              }
            }
            contents.push({ role, parts });
          }

          const res = await this._postCompat(url, {
            contents,
            generationConfig: { temperature, maxOutputTokens: opts.maxTokens || 3000 },
          }, { timeout: opts.maxTokens ? 180000 : 45000, signal: opts.signal });

          const candidate = res.data.candidates?.[0];
          const text = candidate?.content?.parts?.map(p => p.text).join('\n') || '';
          const tokens = res.data.usageMetadata?.totalTokenCount || Math.round((text.length / 4) + 100);

          return {
            text: text.trim(),
            tokensUsed: tokens,
            modelUsed: `gemini/${cleanModel} (key #${i + 1})`,
          };
        }
      } catch (err) {
        if (opts.signal?.aborted || err?.code === 'ERR_CANCELED') throw err; // Stop pressed — no key rotation
        console.warn(`[Gemini] Key #${i + 1} failed (${err.response?.status || err.message}). Rotating to next key...`);
        lastError = err;
      }
    }

    throw lastError || new Error('All 7 Gemini API keys failed');
  }

  // ── Agnes AI ("apenteis" / Agnes) with 7-Key Rotation ────────────────────
  async callAgnesWithKeyRotation(modelId, messages, systemPrompt, temperature = 0.7, opts = {}) {
    if (this.agnesKeys.length === 0) throw new Error('No AGENS_API_KEY configured');
    const cleanModel = modelId.replace('agnes/', '');

    const formattedMessages = [];
    if (systemPrompt) formattedMessages.push({ role: 'system', content: systemPrompt });
    messages.forEach(m => formattedMessages.push({ role: m.role, content: m.content }));

    let lastError = null;
    for (let i = 0; i < this.agnesKeys.length; i++) {
      const apiKey = this.agnesKeys[i];
      try {
        const res = await this._postCompat('https://apihub.agnes-ai.com/v1/chat/completions', {
          model: cleanModel,
          messages: formattedMessages,
          temperature,
          max_tokens: opts.maxTokens || 2048,
        }, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: opts.maxTokens ? 180000 : 45000,
          signal: opts.signal,
        });

        const text = res.data.choices?.[0]?.message?.content || '';
        const usage = res.data.usage || {};
        return {
          text: text.trim(),
          tokensUsed: usage.total_tokens || Math.round((text.length / 4) + 80),
          modelUsed: `agnes/${cleanModel} (key #${i + 1})`,
        };
      } catch (err) {
        if (opts.signal?.aborted || err?.code === 'ERR_CANCELED') throw err; // Stop pressed — no key rotation
        console.warn(`[Agnes] Key #${i + 1} failed (${err.response?.status || err.message}). Rotating...`);
        lastError = err;
      }
    }

    throw lastError || new Error('All Agnes API keys failed');
  }

  // ── UnoRouter ("orca router" / UnoRouter) ────────────────────────────────
  async callUnoRouter(modelId, messages, systemPrompt, temperature = 0.7, opts = {}) {
    if (!this.unorouterKey) throw new Error('UNOROUTER_API_KEY not configured');
    const cleanModel = modelId.replace('unorouter/', '');

    const formattedMessages = [];
    if (systemPrompt) formattedMessages.push({ role: 'system', content: systemPrompt });
    messages.forEach(m => formattedMessages.push({ role: m.role, content: m.content }));

    const res = await this._postCompat('https://api.unorouter.com/v1/chat/completions', {
      model: cleanModel,
      messages: formattedMessages,
      temperature,
      max_tokens: opts.maxTokens || 2048,
    }, {
      headers: {
        Authorization: `Bearer ${this.unorouterKey}`,
        'Content-Type': 'application/json',
      },
      timeout: opts.maxTokens ? 180000 : 45000,
      signal: opts.signal,
    });

    const text = res.data.choices?.[0]?.message?.content || '';
    const usage = res.data.usage || {};
    return {
      text: text.trim(),
      tokensUsed: usage.total_tokens || Math.round((text.length / 4) + 80),
      modelUsed: `unorouter/${cleanModel}`,
    };
  }

  // ── LLM7 Gateway ─────────────────────────────────────────────────────────
  async callLLM7(modelId, messages, systemPrompt, temperature = 0.7, opts = {}) {
    if (!this.llm7Key) throw new Error('LLM7_API_KEY not configured');
    const cleanModel = modelId.replace('llm7/', '');

    const formattedMessages = [];
    if (systemPrompt) formattedMessages.push({ role: 'system', content: systemPrompt });
    messages.forEach(m => formattedMessages.push({ role: m.role, content: m.content }));

    const res = await this._postCompat('https://api.llm7.io/v1/chat/completions', {
      model: cleanModel,
      messages: formattedMessages,
      temperature,
      max_tokens: opts.maxTokens || 2048,
    }, {
      headers: {
        Authorization: `Bearer ${this.llm7Key}`,
        'Content-Type': 'application/json',
      },
      timeout: opts.maxTokens ? 180000 : 45000,
      signal: opts.signal,
    });

    const text = res.data.choices?.[0]?.message?.content || '';
    const usage = res.data.usage || {};
    return {
      text: text.trim(),
      tokensUsed: usage.total_tokens || Math.round((text.length / 4) + 80),
      modelUsed: `llm7/${cleanModel}`,
    };
  }

  // ── Ollama Cloud ─────────────────────────────────────────────────────────
  async callOllamaCloud(modelId, messages, systemPrompt, temperature = 0.7, opts = {}) {
    if (!this.ollamaCloudKey) throw new Error('OLLAMA_CLOUD_API_KEY not configured');
    const cleanModel = modelId.replace('ollama/', '');

    const formattedMessages = [];
    if (systemPrompt) formattedMessages.push({ role: 'system', content: systemPrompt });
    messages.forEach(m => formattedMessages.push({ role: m.role, content: m.content }));

    const res = await this._postCompat('https://ollama.com/v1/chat/completions', {
      model: cleanModel,
      messages: formattedMessages,
      temperature,
      max_tokens: opts.maxTokens || 2048,
    }, {
      headers: {
        Authorization: `Bearer ${this.ollamaCloudKey}`,
        'Content-Type': 'application/json',
      },
      timeout: opts.maxTokens ? 180000 : 45000,
      signal: opts.signal,
    });

    const text = res.data.choices?.[0]?.message?.content || '';
    const usage = res.data.usage || {};
    return {
      text: text.trim(),
      tokensUsed: usage.total_tokens || Math.round((text.length / 4) + 80),
      modelUsed: `ollama/${cleanModel}`,
    };
  }

  // ── OpenRouter with Multi-Key Rotation ───────────────────────────────────
  async callOpenRouterWithKeyRotation(modelId, messages, systemPrompt, attachments = [], temperature = 0.7, opts = {}) {
    if (this.openRouterKeys.length === 0) throw new Error('No OPENROUTER_API_KEY configured');

    const formattedMessages = [];
    if (systemPrompt) formattedMessages.push({ role: 'system', content: systemPrompt });

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const isLastUser = (i === messages.length - 1) && msg.role === 'user';

      if (isLastUser && attachments?.length > 0) {
        const parts = [{ type: 'text', text: msg.content || '' }];
        for (const att of attachments) {
          if (att.data && att.mimeType?.startsWith('image/')) {
            const dataUrl = att.data.startsWith('data:') ? att.data : `data:${att.mimeType};base64,${att.data}`;
            parts.push({ type: 'image_url', image_url: { url: dataUrl } });
          } else if (att.data) {
            parts.push({ type: 'text', text: `\n[File: ${att.name} (${att.mimeType})]\n` });
          }
        }
        formattedMessages.push({ role: 'user', content: parts });
      } else {
        formattedMessages.push({ role: msg.role, content: msg.content });
      }
    }

    let lastError = null;
    for (let i = 0; i < this.openRouterKeys.length; i++) {
      const apiKey = this.openRouterKeys[i];
      try {
        const res = await this._postCompat('https://openrouter.ai/api/v1/chat/completions', {
          model: modelId,
          messages: formattedMessages,
          temperature,
          max_tokens: opts.maxTokens || 1500,
          // Artifact-sized requests turn OFF this model's hidden reasoning: in the
          // 2026-10-08 test it burned 84% of an 8192-token budget on thinking
          // (1679/2000 in a probe) and cut the game off mid-function after 291s.
          // With reasoning disabled the same generation finishes in seconds.
          ...(opts.maxTokens ? { reasoning: { enabled: false } } : {}),
        }, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'http://localhost:3001',
            'X-Title': 'ContentBot Studio',
          },
          timeout: opts.maxTokens ? 180000 : 70000,
          signal: opts.signal,
        });

        const text = res.data.choices?.[0]?.message?.content || '';
        const usage = res.data.usage || {};
        return {
          text: text.trim(),
          tokensUsed: Math.round(usage.total_tokens || (text.length / 4) + 100),
          modelUsed: `${res.data.model || modelId} (key #${i + 1})`,
        };
      } catch (err) {
        if (opts.signal?.aborted || err?.code === 'ERR_CANCELED') throw err; // Stop pressed — no key rotation
        console.warn(`[OpenRouter] Key #${i + 1} failed (${err.response?.status || err.message}). Rotating...`);
        lastError = err;
      }
    }

    throw lastError || new Error('All OpenRouter API keys failed');
  }

  // ── DeepSeek Direct (2-key rotation) ───────────────────────────────────
  async callDeepSeek(modelId, messages, systemPrompt, temperature = 0.7, opts = {}) {
    if (this.deepSeekKeys.length === 0) throw new Error('DEEPSEEK_API_KEY not configured');
    // DeepSeek renamed its models (deepseek-chat and deepseek-reasoner are gone from its live
    // list), so the request carries the catalog id verbatim instead of a stale hardcoded id.
    const dsModel = modelId.replace(/^deepseek\//, '');

    const msgs = [];
    if (systemPrompt) msgs.push({ role: 'system', content: systemPrompt });
    messages.forEach(m => msgs.push({ role: m.role, content: m.content }));

    let lastError = null;
    for (let i = 0; i < this.deepSeekKeys.length; i++) {
      try {
        const res = await this._postCompat('https://api.deepseek.com/chat/completions', {
          model: dsModel,
          messages: msgs,
          temperature,
          max_tokens: opts.maxTokens || 4096,
        }, {
          headers: {
            Authorization: `Bearer ${this.deepSeekKeys[i]}`,
            'Content-Type': 'application/json',
          },
          timeout: opts.maxTokens ? 180000 : 70000,
          signal: opts.signal,
        });

        const text = res.data.choices?.[0]?.message?.content || '';
        const usage = res.data.usage || {};
        return {
          text: text.trim(),
          tokensUsed: Math.round(usage.total_tokens || (text.length / 4) + 100),
          modelUsed: `deepseek/${dsModel} (key #${i + 1})`,
        };
      } catch (err) {
        if (opts.signal?.aborted || err?.code === 'ERR_CANCELED') throw err;
        console.warn(`[DeepSeek] Key #${i + 1} failed (${err.response?.status || err.message}). Rotating...`);
        lastError = err;
      }
    }
    throw lastError || new Error('All DeepSeek API keys failed');
  }

  // ── Cohere Direct ────────────────────────────────────────────────────────
  async callCohere(modelId, messages, systemPrompt, temperature = 0.7, opts = {}) {
    if (!this.cohereKey) throw new Error('COHERE_API_KEY not configured');
    // As with DeepSeek: pass through what was requested rather than a hardcoded fallback id.
    const cohereModel = modelId.replace(/^cohere\//, '');

    const chatHistory = [];
    for (const msg of messages.slice(0, -1)) {
      chatHistory.push({
        role: msg.role === 'assistant' ? 'CHATBOT' : 'USER',
        message: msg.content,
      });
    }
    const lastMsg = messages[messages.length - 1];

    const res = await this._postCompat('https://api.cohere.com/v1/chat', {
      model: cohereModel,
      message: lastMsg?.content || '',
      chat_history: chatHistory,
      preamble: systemPrompt || undefined,
      temperature,
      max_tokens: opts.maxTokens || 4096,
    }, {
      headers: {
        Authorization: `Bearer ${this.cohereKey}`,
        'Content-Type': 'application/json',
      },
      timeout: opts.maxTokens ? 180000 : 60000,
      signal: opts.signal,
    });

    const text = res.data.text || '';
    const usage = res.data.meta?.billed_units || {};
    return {
      text: text.trim(),
      tokensUsed: Math.round((usage.input_tokens || 0) + (usage.output_tokens || 0) || (text.length / 4) + 100),
      modelUsed: `cohere/${cohereModel}`,
    };
  }

  // ── OpenAI Direct ────────────────────────────────────────────────────────
  async callOpenAIDirect(modelId, messages, systemPrompt, attachments = [], temperature = 0.7, opts = {}) {
    if (!this.openAIKey) throw new Error('OPENAI_API_KEY not configured');
    const cleanModel = modelId.replace('openai/', '');

    const formattedMessages = [];
    if (systemPrompt) formattedMessages.push({ role: 'system', content: systemPrompt });
    messages.forEach(m => formattedMessages.push({ role: m.role, content: m.content }));

    const res = await this._postCompat('https://api.openai.com/v1/chat/completions', {
      model: cleanModel,
      messages: formattedMessages,
      temperature,
      max_tokens: opts.maxTokens || 4096,
    }, {
      headers: {
        Authorization: `Bearer ${this.openAIKey}`,
        'Content-Type': 'application/json',
      },
      timeout: opts.maxTokens ? 180000 : 60000,
      signal: opts.signal,
    });

    const text = res.data.choices?.[0]?.message?.content || '';
    const usage = res.data.usage || {};
    return {
      text: text.trim(),
      tokensUsed: usage.total_tokens || Math.round((text.length / 4) + 100),
      modelUsed: `openai/${cleanModel}`,
    };
  }
}

const service = new CloudAIService();
// Attached (rather than re-exported) so every existing `require('../services/cloudAIService')`
// call site keeps working while still being able to catch this specific failure.
service.ModelUnavailableError = ModelUnavailableError;
service.ALL_MODELS_CATALOG = ALL_MODELS_CATALOG;
module.exports = service;
