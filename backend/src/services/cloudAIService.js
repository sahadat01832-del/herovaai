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

// Full verified catalog of available models across all providers
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
    id: 'meta-llama/llama-3.3-70b-instruct:free',
    name: 'Llama 3.3 70B Instruct',
    provider: 'openrouter',
    badge: '🦙 Free · Meta',
    description: 'Meta flagship open model for customer service',
    multimodal: false,
    group: 'OpenRouter Free',
  },
  {
    id: 'deepseek/deepseek-chat-v3-0324:free',
    name: 'DeepSeek Chat V3 Free',
    provider: 'openrouter',
    badge: '🔮 Free · DeepSeek',
    description: 'DeepSeek V3 reasoning & multi-turn dialog',
    multimodal: false,
    group: 'OpenRouter Free',
  },
  {
    id: 'mistralai/mistral-small-24b-instruct-2501:free',
    name: 'Mistral Small 24B Free',
    provider: 'openrouter',
    badge: '🌊 Free · Mistral',
    description: 'European state-of-the-art multilingual model',
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
  {
    id: 'deepseek/deepseek-chat',
    name: 'DeepSeek Chat (Direct)',
    provider: 'deepseek',
    badge: '🔮 DeepSeek Direct',
    description: 'Direct API to DeepSeek official servers',
    multimodal: false,
    group: 'DeepSeek Direct',
  },
  {
    id: 'deepseek/deepseek-reasoner',
    name: 'DeepSeek Reasoner R1',
    provider: 'deepseek',
    badge: '🧩 DeepSeek R1',
    description: 'DeepSeek flagship chain-of-thought reasoner',
    multimodal: false,
    group: 'DeepSeek Direct',
  },

  // ── Cohere Direct ──
  {
    id: 'command-r-plus',
    name: 'Cohere Command R+',
    provider: 'cohere',
    badge: '🌊 Cohere R+',
    description: 'Cohere flagship enterprise conversation model',
    multimodal: false,
    group: 'Cohere Direct',
  },
  {
    id: 'command-r7b-12-2024',
    name: 'Cohere Command R7B',
    provider: 'cohere',
    badge: '🌊 Cohere 7B',
    description: 'Cohere fast response model',
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

class CloudAIService {
  constructor() {
    this.refreshKeys();
  }

  refreshKeys() {
    // 1. OpenRouter Keys (pool)
    this.openRouterKeys = [
      process.env.OPENROUTER_API_KEY,
      process.env.OPENROUTER_API_KEY_2,
    ].filter(Boolean);

    // 2. Gemini Keys (pool of 7 keys for fallback)
    this.geminiKeys = [
      process.env.GEMINI_API_KEY,
      process.env.GEMINI_API_KEY_2,
      process.env.GEMINI_API_KEY_3,
      process.env.GEMINI_API_KEY_4,
      process.env.GEMINI_API_KEY_5,
      process.env.GEMINI_API_KEY_6,
      process.env.GEMINI_API_KEY_7,
    ].filter(Boolean);

    // 3. Agnes AI ("apenteis" / Agnes — pool of 7 keys)
    this.agnesKeys = [
      process.env.AGENS_API_KEY,
      process.env.AGENS_API_KEY_2,
      process.env.AGENS_API_KEY_3,
      process.env.AGENS_API_KEY_4,
      process.env.AGENS_API_KEY_5,
      process.env.AGENS_API_KEY_6,
      process.env.AGNES_API_KEY,
    ].filter(Boolean);

    // 4. Groq Key
    this.groqKey = process.env.GROQ_API_KEY;

    // 5. UnoRouter Key ("orca router" / UnoRouter)
    this.unorouterKey = process.env.UNOROUTER_API_KEY || process.env.CB_UNOROUTER_API_KEY;

    // 6. LLM7 Key
    this.llm7Key = process.env.LLM7_API_KEY;

    // 7. Ollama Cloud Key
    this.ollamaCloudKey = process.env.OLLAMA_CLOUD_API_KEY || process.env.OLLAMA_API_KEY;

    // 8. OpenCode Zen Key
    this.opencodeZenKey = process.env.OPENCODE_ZEN_API_KEY;

    // 9. Direct provider keys
    this.deepSeekKey = process.env.DEEPSEEK_API_KEY;
    this.cohereKey   = process.env.COHERE_API_KEY || process.env.CB_COHERE_API_KEY;
    this.openAIKey   = process.env.OPENAI_API_KEY;
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
        case 'deepseek':     return Boolean(this.deepSeekKey);
        case 'cohere':       return Boolean(this.cohereKey);
        case 'openai':       return Boolean(this.openAIKey || this.openRouterKeys.length > 0);
        default:             return true;
      }
    });
  }

  async generateCompletion({ model, messages = [], systemPrompt = '', attachments = [], temperature = 0.7 }) {
    this.refreshKeys();
    const targetModel = model || 'groq/qwen/qwen3.8-27b';
    const modelDef = ALL_MODELS_CATALOG.find(m => m.id === targetModel);
    const provider = modelDef?.provider || 'openrouter';

    const errors = [];

    // ── Primary Attempt based on requested provider ──
    try {
      if (provider === 'groq') {
        return await this.callGroq(targetModel, messages, systemPrompt, temperature);
      }
      if (provider === 'gemini') {
        return await this.callGeminiWithKeyRotation(targetModel, messages, systemPrompt, attachments, temperature);
      }
      if (provider === 'agnes') {
        return await this.callAgnesWithKeyRotation(targetModel, messages, systemPrompt, temperature);
      }
      if (provider === 'unorouter') {
        return await this.callUnoRouter(targetModel, messages, systemPrompt, temperature);
      }
      if (provider === 'llm7') {
        return await this.callLLM7(targetModel, messages, systemPrompt, temperature);
      }
      if (provider === 'ollama_cloud') {
        return await this.callOllamaCloud(targetModel, messages, systemPrompt, temperature);
      }
      if (provider === 'deepseek') {
        return await this.callDeepSeek(targetModel, messages, systemPrompt, temperature);
      }
      if (provider === 'cohere') {
        return await this.callCohere(targetModel, messages, systemPrompt, temperature);
      }
      if (provider === 'openai' && this.openAIKey) {
        return await this.callOpenAIDirect(targetModel, messages, systemPrompt, attachments, temperature);
      }
      return await this.callOpenRouterWithKeyRotation(targetModel, messages, systemPrompt, attachments, temperature);
    } catch (err) {
      console.warn(`[CloudAIService] Primary provider "${provider}" failed (${err.message}). Entering Failover Chain...`);
      errors.push(`${provider}: ${err.message}`);
    }

    // ── FAILOVER CHAIN (Guarantees zero-downtime reply) ──
    // 1. Try Groq (Instant, ~300ms)
    if (this.groqKey && provider !== 'groq') {
      try {
        console.log(`[CloudAIService] Fallback 1: Trying Groq Qwen 3.8 27B...`);
        const res = await this.callGroq('groq/qwen/qwen3.8-27b', messages, systemPrompt, temperature);
        res.modelUsed = `${res.modelUsed} (Failover from ${targetModel})`;
        return res;
      } catch (e) { errors.push(`groq-fallback: ${e.message}`); }
    }

    // 2. Try Gemini Direct (Rotates 7 keys)
    if (this.geminiKeys.length > 0 && provider !== 'gemini') {
      try {
        console.log(`[CloudAIService] Fallback 2: Trying Gemini 2.5 Flash...`);
        const res = await this.callGeminiWithKeyRotation('gemini-2.5-flash', messages, systemPrompt, attachments, temperature);
        res.modelUsed = `${res.modelUsed} (Failover from ${targetModel})`;
        return res;
      } catch (e) { errors.push(`gemini-fallback: ${e.message}`); }
    }

    // 3. Try OpenRouter (Rotates keys)
    if (this.openRouterKeys.length > 0 && provider !== 'openrouter') {
      try {
        console.log(`[CloudAIService] Fallback 3: Trying OpenRouter Nemotron 3.5...`);
        const res = await this.callOpenRouterWithKeyRotation('nvidia/nemotron-3.5-lightning:free', messages, systemPrompt, attachments, temperature);
        res.modelUsed = `${res.modelUsed} (Failover from ${targetModel})`;
        return res;
      } catch (e) { errors.push(`openrouter-fallback: ${e.message}`); }
    }

    // 4. Try UnoRouter ("orca router")
    if (this.unorouterKey && provider !== 'unorouter') {
      try {
        console.log(`[CloudAIService] Fallback 4: Trying UnoRouter...`);
        const res = await this.callUnoRouter('unorouter/agnes-3.0-flash:free', messages, systemPrompt, temperature);
        res.modelUsed = `${res.modelUsed} (Failover from ${targetModel})`;
        return res;
      } catch (e) { errors.push(`unorouter-fallback: ${e.message}`); }
    }

    // 5. Try Agnes ("apenteis" / 7 keys)
    if (this.agnesKeys.length > 0 && provider !== 'agnes') {
      try {
        console.log(`[CloudAIService] Fallback 5: Trying Agnes 3.0 Flash...`);
        const res = await this.callAgnesWithKeyRotation('agnes/agnes-3.0-flash', messages, systemPrompt, temperature);
        res.modelUsed = `${res.modelUsed} (Failover from ${targetModel})`;
        return res;
      } catch (e) { errors.push(`agnes-fallback: ${e.message}`); }
    }

    // 6. Try LLM7
    if (this.llm7Key && provider !== 'llm7') {
      try {
        console.log(`[CloudAIService] Fallback 6: Trying LLM7...`);
        const res = await this.callLLM7('llm7/GLM-5.3-Flash', messages, systemPrompt, temperature);
        res.modelUsed = `${res.modelUsed} (Failover from ${targetModel})`;
        return res;
      } catch (e) { errors.push(`llm7-fallback: ${e.message}`); }
    }

    throw new Error(`All AI providers and fallback keys failed: ${errors.join(' | ')}`);
  }

  // ── Groq Implementation ──────────────────────────────────────────────────
  async callGroq(modelId, messages, systemPrompt, temperature = 0.7) {
    if (!this.groqKey) throw new Error('GROQ_API_KEY not configured');
    const cleanModel = modelId.replace('groq/', '');

    const formattedMessages = [];
    if (systemPrompt) formattedMessages.push({ role: 'system', content: systemPrompt });
    messages.forEach(m => formattedMessages.push({ role: m.role, content: m.content }));

    const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
      model: cleanModel,
      messages: formattedMessages,
      temperature,
      max_tokens: 2048,
    }, {
      headers: {
        Authorization: `Bearer ${this.groqKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
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
  async callGeminiWithKeyRotation(modelId, messages, systemPrompt, attachments = [], temperature = 0.7) {
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

          const res = await axios.post('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
            model: cleanModel,
            messages: formattedMessages,
            temperature,
            max_tokens: 3000,
          }, {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            timeout: 45000,
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

          const res = await axios.post(url, {
            contents,
            generationConfig: { temperature, maxOutputTokens: 3000 },
          }, { timeout: 45000 });

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
        console.warn(`[Gemini] Key #${i + 1} failed (${err.response?.status || err.message}). Rotating to next key...`);
        lastError = err;
      }
    }

    throw lastError || new Error('All 7 Gemini API keys failed');
  }

  // ── Agnes AI ("apenteis" / Agnes) with 7-Key Rotation ────────────────────
  async callAgnesWithKeyRotation(modelId, messages, systemPrompt, temperature = 0.7) {
    if (this.agnesKeys.length === 0) throw new Error('No AGENS_API_KEY configured');
    const cleanModel = modelId.replace('agnes/', '');

    const formattedMessages = [];
    if (systemPrompt) formattedMessages.push({ role: 'system', content: systemPrompt });
    messages.forEach(m => formattedMessages.push({ role: m.role, content: m.content }));

    let lastError = null;
    for (let i = 0; i < this.agnesKeys.length; i++) {
      const apiKey = this.agnesKeys[i];
      try {
        const res = await axios.post('https://apihub.agnes-ai.com/v1/chat/completions', {
          model: cleanModel,
          messages: formattedMessages,
          temperature,
          max_tokens: 2048,
        }, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 45000,
        });

        const text = res.data.choices?.[0]?.message?.content || '';
        const usage = res.data.usage || {};
        return {
          text: text.trim(),
          tokensUsed: usage.total_tokens || Math.round((text.length / 4) + 80),
          modelUsed: `agnes/${cleanModel} (key #${i + 1})`,
        };
      } catch (err) {
        console.warn(`[Agnes] Key #${i + 1} failed (${err.response?.status || err.message}). Rotating...`);
        lastError = err;
      }
    }

    throw lastError || new Error('All Agnes API keys failed');
  }

  // ── UnoRouter ("orca router" / UnoRouter) ────────────────────────────────
  async callUnoRouter(modelId, messages, systemPrompt, temperature = 0.7) {
    if (!this.unorouterKey) throw new Error('UNOROUTER_API_KEY not configured');
    const cleanModel = modelId.replace('unorouter/', '');

    const formattedMessages = [];
    if (systemPrompt) formattedMessages.push({ role: 'system', content: systemPrompt });
    messages.forEach(m => formattedMessages.push({ role: m.role, content: m.content }));

    const res = await axios.post('https://api.unorouter.com/v1/chat/completions', {
      model: cleanModel,
      messages: formattedMessages,
      temperature,
      max_tokens: 2048,
    }, {
      headers: {
        Authorization: `Bearer ${this.unorouterKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 45000,
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
  async callLLM7(modelId, messages, systemPrompt, temperature = 0.7) {
    if (!this.llm7Key) throw new Error('LLM7_API_KEY not configured');
    const cleanModel = modelId.replace('llm7/', '');

    const formattedMessages = [];
    if (systemPrompt) formattedMessages.push({ role: 'system', content: systemPrompt });
    messages.forEach(m => formattedMessages.push({ role: m.role, content: m.content }));

    const res = await axios.post('https://api.llm7.io/v1/chat/completions', {
      model: cleanModel,
      messages: formattedMessages,
      temperature,
      max_tokens: 2048,
    }, {
      headers: {
        Authorization: `Bearer ${this.llm7Key}`,
        'Content-Type': 'application/json',
      },
      timeout: 45000,
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
  async callOllamaCloud(modelId, messages, systemPrompt, temperature = 0.7) {
    if (!this.ollamaCloudKey) throw new Error('OLLAMA_CLOUD_API_KEY not configured');
    const cleanModel = modelId.replace('ollama/', '');

    const formattedMessages = [];
    if (systemPrompt) formattedMessages.push({ role: 'system', content: systemPrompt });
    messages.forEach(m => formattedMessages.push({ role: m.role, content: m.content }));

    const res = await axios.post('https://ollama.com/v1/chat/completions', {
      model: cleanModel,
      messages: formattedMessages,
      temperature,
      max_tokens: 2048,
    }, {
      headers: {
        Authorization: `Bearer ${this.ollamaCloudKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 45000,
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
  async callOpenRouterWithKeyRotation(modelId, messages, systemPrompt, attachments = [], temperature = 0.7) {
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
        const res = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
          model: modelId,
          messages: formattedMessages,
          temperature,
          max_tokens: 1500,
        }, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'http://localhost:3001',
            'X-Title': 'ContentBot Studio',
          },
          timeout: 70000,
        });

        const text = res.data.choices?.[0]?.message?.content || '';
        const usage = res.data.usage || {};
        return {
          text: text.trim(),
          tokensUsed: Math.round(usage.total_tokens || (text.length / 4) + 100),
          modelUsed: `${res.data.model || modelId} (key #${i + 1})`,
        };
      } catch (err) {
        console.warn(`[OpenRouter] Key #${i + 1} failed (${err.response?.status || err.message}). Rotating...`);
        lastError = err;
      }
    }

    throw lastError || new Error('All OpenRouter API keys failed');
  }

  // ── DeepSeek Direct ──────────────────────────────────────────────────────
  async callDeepSeek(modelId, messages, systemPrompt, temperature = 0.7) {
    if (!this.deepSeekKey) throw new Error('DEEPSEEK_API_KEY not configured');
    const dsModel = modelId === 'deepseek/deepseek-reasoner' ? 'deepseek-reasoner' : 'deepseek-chat';

    const msgs = [];
    if (systemPrompt) msgs.push({ role: 'system', content: systemPrompt });
    messages.forEach(m => msgs.push({ role: m.role, content: m.content }));

    const res = await axios.post('https://api.deepseek.com/chat/completions', {
      model: dsModel,
      messages: msgs,
      temperature,
      max_tokens: 4096,
    }, {
      headers: {
        Authorization: `Bearer ${this.deepSeekKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 70000,
    });

    const text = res.data.choices?.[0]?.message?.content || '';
    const usage = res.data.usage || {};
    return {
      text: text.trim(),
      tokensUsed: Math.round(usage.total_tokens || (text.length / 4) + 100),
      modelUsed: `deepseek/${dsModel}`,
    };
  }

  // ── Cohere Direct ────────────────────────────────────────────────────────
  async callCohere(modelId, messages, systemPrompt, temperature = 0.7) {
    if (!this.cohereKey) throw new Error('COHERE_API_KEY not configured');
    const cohereModel = modelId.includes('7b') ? 'command-r7b-12-2024' : 'command-r-plus';

    const chatHistory = [];
    for (const msg of messages.slice(0, -1)) {
      chatHistory.push({
        role: msg.role === 'assistant' ? 'CHATBOT' : 'USER',
        message: msg.content,
      });
    }
    const lastMsg = messages[messages.length - 1];

    const res = await axios.post('https://api.cohere.com/v1/chat', {
      model: cohereModel,
      message: lastMsg?.content || '',
      chat_history: chatHistory,
      preamble: systemPrompt || undefined,
      temperature,
      max_tokens: 4096,
    }, {
      headers: {
        Authorization: `Bearer ${this.cohereKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 60000,
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
  async callOpenAIDirect(modelId, messages, systemPrompt, attachments = [], temperature = 0.7) {
    if (!this.openAIKey) throw new Error('OPENAI_API_KEY not configured');
    const cleanModel = modelId.replace('openai/', '');

    const formattedMessages = [];
    if (systemPrompt) formattedMessages.push({ role: 'system', content: systemPrompt });
    messages.forEach(m => formattedMessages.push({ role: m.role, content: m.content }));

    const res = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: cleanModel,
      messages: formattedMessages,
      temperature,
      max_tokens: 4096,
    }, {
      headers: {
        Authorization: `Bearer ${this.openAIKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 60000,
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

module.exports = new CloudAIService();
