/**
 * Cloud AI Service — the free-model menu, served by one gateway.
 *
 * This deployment holds a single AI credential: the operator's OMNIROUTE_API_KEY. OmniRoute
 * is a local gateway that fronts Groq, Gemini, Cohere and the rest, so the app gets their
 * free tiers through one key and one base URL. There is deliberately no second provider
 * here: no OpenRouter, no direct Groq/Gemini/OpenAI/DeepSeek/Cohere key, and no failover that
 * could reach one. A model is either a free tier on this gateway and answers, or the caller
 * is told why not.
 */

const axios = require('axios');
const catalogService = require('./catalogService');
const keyVault = require('./keyVault');

// ── The model menu ───────────────────────────────────────────────────────────
//
// Every model here is served by the operator's own OmniRoute gateway
// (OMNIROUTE_BASE_URL) and every one is a FREE tier of some upstream provider.
// The gateway holds the upstream credentials, so this deployment needs exactly
// one key, and nothing a visitor can pick can bill anyone: a paid model is not
// in this list and therefore cannot be selected.
//
// Only models that were observed to actually answer are listed. OmniRoute's own
// free catalogue is far larger, but most of those entries 404, sit behind a
// per-user rate limit, or have already run out of credits — listing them would
// put dead options in front of customers. (33 free candidates were probed
// end-to-end; 18 replied, and near-duplicates were then folded away.)
//
// `free: true` is not a guess: catalogService passes it through as the model's
// tier, so the menu and the badges agree with what these models actually cost.
const OMNIROUTE_PREFIX = 'omniroute/';

/** The model a caller gets when they did not choose one. Free, uncapped, vision-capable. */
const DEFAULT_MODEL = 'omniroute/gemini/gemini-2.5-flash';

const ALL_MODELS_CATALOG = [
  // ── Gemini free tier · uncapped · sees images ──
  {
    id: 'omniroute/gemini/gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'omniroute',
    badge: '⭐ Recommended',
    description: 'Fast, free and multimodal — reads screenshots, photos and documents',
    multimodal: true,
    free: true,
    group: 'Free models',
  },
  {
    id: 'omniroute/gemini/gemini-3-flash-preview',
    name: 'Gemini 3 Flash',
    provider: 'omniroute',
    badge: '✨ Newer',
    description: 'The newest Gemini Flash — stronger reasoning, still free',
    multimodal: true,
    free: true,
    group: 'Free models',
  },
  {
    id: 'omniroute/gemini/gemini-3.1-flash-lite',
    name: 'Gemini 3.1 Flash Lite',
    provider: 'omniroute',
    badge: '🪶 Light',
    description: 'Cheapest free option for short replies and quick questions',
    multimodal: false,
    free: true,
    group: 'Free models',
  },

  // ── Groq free tier · the fastest replies ──
  {
    id: 'omniroute/groq/qwen/qwen3.8-27b',
    name: 'Qwen 3.8 27B',
    provider: 'omniroute',
    badge: '⚡ Instant',
    description: 'Answers in a fraction of a second — built for live customer chat',
    multimodal: false,
    free: true,
    group: 'Free models',
  },
  {
    id: 'omniroute/groq/openai/gpt-oss-120b',
    name: 'GPT-OSS 120B',
    provider: 'omniroute',
    badge: '⚡ 120B',
    description: 'A 120B open model at instant speed — good deep business answers',
    multimodal: false,
    free: true,
    group: 'Free models',
  },
  {
    id: 'omniroute/groq/openai/gpt-oss-20b',
    name: 'GPT-OSS 20B',
    provider: 'omniroute',
    badge: '🪶 Light',
    description: 'Small and quick — ideal for reminders and short auto-replies',
    multimodal: false,
    free: true,
    group: 'Free models',
  },

  // ── Agnes free tier · uncapped ──
  {
    id: 'omniroute/agnes/agnes-3.0-flash',
    name: 'Agnes 3.0 Flash',
    provider: 'omniroute',
    badge: '🆓 Uncapped',
    description: 'Free with no daily ceiling — a safe choice for heavy use',
    multimodal: false,
    free: true,
    group: 'Free models',
  },
  {
    id: 'omniroute/agnes/agnes-2.5-flash',
    name: 'Agnes 2.5 Flash',
    provider: 'omniroute',
    badge: '🆓 Uncapped',
    description: 'Previous Agnes Flash — free with no daily ceiling',
    multimodal: false,
    free: true,
    group: 'Free models',
  },

  // ── Cohere free tier · monthly allowance ──
  {
    id: 'omniroute/cohere/command-a-03-2025',
    name: 'Command A',
    provider: 'omniroute',
    badge: '🗣️ Writing',
    description: 'Strong, natural business writing and polite customer replies',
    multimodal: false,
    free: true,
    group: 'Free models',
  },
  {
    id: 'omniroute/cohere/command-a-reasoning-08-2025',
    name: 'Command A Reasoning',
    provider: 'omniroute',
    badge: '🧠 Thinking',
    description: 'Thinks a problem through — pricing, planning, tricky requests',
    multimodal: false,
    free: true,
    group: 'Free models',
  },
  {
    id: 'omniroute/cohere/command-a-vision-07-2025',
    name: 'Command A Vision',
    provider: 'omniroute',
    badge: '📷 Vision',
    description: 'Reads a photo or screenshot and describes what matters',
    multimodal: true,
    free: true,
    group: 'Free models',
  },
  {
    id: 'omniroute/cohere/command-r-plus-08-2024',
    name: 'Command R+',
    provider: 'omniroute',
    badge: '🗣️ Writing',
    description: 'Long-form replies and document-style answers',
    multimodal: false,
    free: true,
    group: 'Free models',
  },

  // ── Laguna free tier · daily allowance ──
  {
    id: 'omniroute/nara/laguna-s-2.1',
    name: 'Laguna S 2.1',
    provider: 'omniroute',
    badge: '🍃 Alternative',
    description: 'A free second opinion when another model is busy',
    multimodal: false,
    free: true,
    group: 'Free models',
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
    // One slot, one key: the local gateway that fronts every upstream provider.
    // There is nothing else to read, so no code path below can spend a
    // credential the operator did not put in this deployment.
    this.omnirouteKey = keyVault.firstKey(['OMNIROUTE_API_KEY']) || undefined;
    this.omnirouteBase = (process.env.OMNIROUTE_BASE_URL || 'http://127.0.0.1:20128/v1').replace(/\/+$/, '');
  }

  getAvailableModels() {
    this.refreshKeys();
    // Every catalog entry is a free model behind the one gateway, so the menu is
    // simply the catalog — shown once the single key exists, hidden when it does
    // not (a menu of models that cannot answer is worse than an empty one).
    return Boolean(this.omnirouteKey) ? ALL_MODELS_CATALOG : [];
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

  /**
   * Streaming twin of generateCompletion: same free-catalog and availability gates,
   * same return shape, but the reply arrives token-by-token through `onToken`.
   *
   * Recoverable failures before the first token fall back to the buffered path.
   * Timeouts, cancellation, and failures after visible output are surfaced instead of
   * silently repeating work that may already have completed upstream.
   */
  async streamCompletion({ model, messages = [], systemPrompt = '', attachments = [], temperature = 0.7,
                          allowFailover = false, maxTokens = null, signal = null, onToken = null }) {
    this.refreshKeys();
    const targetModel = model || DEFAULT_MODEL;
    const modelDef = ALL_MODELS_CATALOG.find(m => m.id === targetModel);
    const opts = { maxTokens, signal };

    // Same gate as the buffered path: only a listed free model may be forwarded.
    if (!modelDef) {
      throw new ModelUnavailableError(
        `${targetModel} is not one of the free models this deployment serves`,
        { model: targetModel, availability: catalogService.OUT_OF_STOCK });
    }

    const provider = modelDef?.provider || 'omniroute';
    const servable = await catalogService.checkServable(provider, targetModel);
    if (!servable.ok && servable.availability !== catalogService.UNVERIFIED && !allowFailover) {
      throw new ModelUnavailableError(
        `${targetModel} is unavailable (${servable.availability}): ${servable.reason}`,
        { model: targetModel, availability: servable.availability });
    }

    let emitted = 0;
    const countingToken = (delta) => { emitted += 1; if (onToken) onToken(delta); };

    try {
      return await this.callOmniRouteStream(targetModel, messages, systemPrompt, attachments,
        temperature, opts, countingToken);
    } catch (err) {
      if (signal?.aborted || err?.code === 'ERR_CANCELED') throw err;   // Stop — never failover
      if (err?.code === 'ETIMEDOUT' || err?.name === 'TimeoutError') {
        err.code = 'ETIMEDOUT';
        throw err;
      }
      if (emitted > 0) {
        // Tokens are already on screen; restarting would duplicate the opening words.
        throw err;
      }
      console.warn(`[CloudAIService] stream failed before first token (${err.message}) — `
        + `falling back to buffered path${allowFailover ? ' with failover' : ''}.`);
      return await this.generateCompletion({ model: targetModel, messages, systemPrompt,
        attachments, temperature, allowFailover, maxTokens, signal });
    }
  }

  async generateCompletion({ model, messages = [], systemPrompt = '', attachments = [], temperature = 0.7,
                            allowFailover = false, maxTokens = null, signal = null }) {
    this.refreshKeys();
    const targetModel = model || DEFAULT_MODEL;
    const modelDef = ALL_MODELS_CATALOG.find(m => m.id === targetModel);
    // One provider, always: the free-model gateway.
    const provider = modelDef?.provider || 'omniroute';
    // Extra knobs every provider call understands: a bigger token budget for
    // full-page artifacts (games/apps) and an abort signal for the Stop button.
    const opts = { maxTokens, signal };

    // ── Free-catalog gate ───────────────────────────────────────────────
    // Only a listed free model may be requested. The gateway knows thousands of
    // models — paid ones included — and it holds the upstream credentials, so an
    // id from outside this catalog is refused here rather than forwarded: a
    // crafted request must never be able to spend the operator's account on a
    // model the menu does not offer. Callers learn exactly what happened.
    if (!modelDef) {
      throw new ModelUnavailableError(
        `${targetModel} is not one of the free models this deployment serves`,
        { model: targetModel, availability: catalogService.OUT_OF_STOCK });
    }

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

    // ── Primary attempt: the gateway, and only the gateway ──
    try {
      return await this.callOmniRoute(targetModel, messages, systemPrompt, attachments, temperature, opts);
    } catch (err) {
      if (signal?.aborted || err?.code === 'ERR_CANCELED') throw err; // Stop button — never failover after cancel
      errors.push(`${provider}: ${err.message}`);
      if (!allowFailover) {
        throw new ModelUnavailableError(
          `${targetModel} could not answer: ${err.message}`,
          { model: targetModel, availability: servable.availability });
      }
      console.warn(`[CloudAIService] ${provider} declined "${targetModel}" (${err.message}). Trying another free model...`);
    }

    // ── Failover: another FREE model on the same gateway ────────────────────
    //
    // This used to walk a chain of other providers' keys. That is no longer
    // possible here: the deployment runs on the OmniRoute key alone, so a
    // fallback reaching for Groq or OpenRouter would either do nothing or
    // quietly spend a credential the operator asked us not to use. OmniRoute
    // already load-balances and fails over internally across its own provider
    // pool, so the only retry worth making is a different free model behind the
    // same gateway — and never a paid one, because none are in the catalog.
    if (signal?.aborted) throw Object.assign(new Error('Generation stopped'), { code: 'ERR_CANCELED' });

    // Ordered by "most likely to answer well right now", not by size.
    const failoverOrder = [
      'omniroute/gemini/gemini-2.5-flash',
      'omniroute/groq/qwen/qwen3.8-27b',
      'omniroute/agnes/agnes-3.0-flash',
      'omniroute/cohere/command-a-03-2025',
    ];
    const needsVision = (attachments || []).some(a => String(a.mimeType || '').startsWith('image/'));

    for (const candidateId of failoverOrder.filter(id => id !== targetModel)) {
      if (signal?.aborted) throw Object.assign(new Error('Generation stopped'), { code: 'ERR_CANCELED' });
      const candidate = ALL_MODELS_CATALOG.find(m => m.id === candidateId);
      // A model that cannot see images would silently drop the customer's photo,
      // so it is not a fallback for a request that carried one.
      if (!candidate || (needsVision && !candidate.multimodal)) continue;
      try {
        console.log(`[CloudAIService] Failover: trying free model ${candidateId}...`);
        const res = await this.callOmniRoute(candidateId, messages, systemPrompt, attachments, temperature, opts);
        res.failedOverFrom = targetModel;
        return res;
      } catch (e) {
        if (signal?.aborted) throw e;
        errors.push(`${candidateId}: ${e.message}`);
      }
    }

    throw new Error(`Every free model on this gateway declined: ${errors.join(' | ')}`);
  }

  /**
   * Shape caller history into the OpenAI wire format: system prompt first, then the
   * trailing turns, with the last user message carrying any attached images as
   * image_url parts (which is how the vision tiers read a screenshot).
   *
   * Extracted so the buffered and streaming transports cannot drift apart — they must
   * build byte-identical requests or a streamed reply would see different context.
   */
  _formatMessages(systemPrompt, messages, attachments = []) {
    const formattedMessages = [];
    if (systemPrompt) formattedMessages.push({ role: 'system', content: systemPrompt });
    const lastUserIndex = messages.map(m => m.role).lastIndexOf('user');
    messages.forEach((msg, index) => {
      const images = attachments?.filter(a => a.data && String(a.mimeType || '').startsWith('image/')) || [];
      if (index === lastUserIndex && images.length > 0) {
        const parts = [{ type: 'text', text: msg.content || '' }];
        for (const att of images) {
          const dataUrl = att.data.startsWith('data:') ? att.data : `data:${att.mimeType};base64,${att.data}`;
          parts.push({ type: 'image_url', image_url: { url: dataUrl } });
        }
        formattedMessages.push({ role: 'user', content: parts });
      } else {
        formattedMessages.push({ role: msg.role, content: msg.content });
      }
    });
    return formattedMessages;
  }

  /** Base gateway URL + de-prefixed model id. One definition, both transports. */
  _omnirouteTarget(catalogId) {
    if (!this.omnirouteKey) throw new Error('OMNIROUTE_API_KEY not configured');
    const base = this.omnirouteBase
      || (process.env.OMNIROUTE_BASE_URL || 'http://127.0.0.1:20128/v1').replace(/\/+$/, '');
    const bareId = catalogId.startsWith(OMNIROUTE_PREFIX)
      ? catalogId.slice(OMNIROUTE_PREFIX.length)
      : catalogId;
    return { base, bareId };
  }

  /**
   * OmniRoute — one local gateway in front of every upstream provider. Buffered
   * transport: the reply comes back whole in one JSON body.
   *
   * Catalog ids carry an `omniroute/` prefix so they can never be mistaken for an
   * upstream's own spelling; the gateway wants the id with the prefix removed
   * (e.g. `omniroute/groq/qwen/qwen3.8-27b` is requested as `groq/qwen/qwen3.8-27b`).
   *
   * Attachments are sent as OpenAI-style image parts, which is how the free
   * Gemini and Command-vision tiers read a screenshot or a photo of a product.
   */
  async callOmniRoute(catalogId, messages, systemPrompt, attachments = [], temperature = 0.7, opts = {}) {
    const { base, bareId } = this._omnirouteTarget(catalogId);
    const formattedMessages = this._formatMessages(systemPrompt, messages, attachments);

    const res = await this._postCompat(`${base}/chat/completions`, {
      model: bareId,
      messages: formattedMessages,
      temperature,
      max_tokens: opts.maxTokens || 2048,
    }, {
      headers: {
        Authorization: `Bearer ${this.omnirouteKey}`,
        'Content-Type': 'application/json',
        'X-Title': 'HerovaAi',
      },
      timeout: opts.maxTokens ? 180000 : 60000,
      signal: opts.signal,
    });

    const text = res.data.choices?.[0]?.message?.content || '';
    const usage = res.data.usage || {};
    return {
      text: text.trim(),
      tokensUsed: usage.total_tokens || Math.round((text.length / 4) + 80),
      // Report the id the caller asked for, not the gateway's upstream spelling.
      // History, quota records and the picker all key off the catalog id, so
      // returning `gemini-2.5-flash` here would show a customer a model name the
      // menu never offered — and would make a correctly-honoured pin look swapped.
      modelUsed: catalogId,
      upstreamModel: res.data.model || bareId,
    };
  }

  /**
   * Streaming transport: same gateway, same body, but `stream: true` so the reply
   * arrives as SSE chunks. Each content delta is handed to `onToken` the moment it
   * lands, which is what lets the UI paint the answer while the model is still
   * thinking instead of holding the whole reply behind one spinner.
   *
   * Returns the same shape as callOmniRoute once the stream closes, so the caller
   * can finish exactly as it would have buffered. `onDone` receives {usage} when the
   * gateway reports it on the terminal chunk (it does), which keeps quota accounting
   * identical to the buffered path.
   */
  async callOmniRouteStream(catalogId, messages, systemPrompt, attachments = [], temperature = 0.7, opts = {}, onToken) {
    const { base, bareId } = this._omnirouteTarget(catalogId);
    const formattedMessages = this._formatMessages(systemPrompt, messages, attachments);
    const timeoutSignal = AbortSignal.timeout(opts.maxTokens ? 180000 : 60000);
    const requestSignal = opts.signal
      ? AbortSignal.any([opts.signal, timeoutSignal])
      : timeoutSignal;

    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.omnirouteKey}`,
        'Content-Type': 'application/json',
        'X-Title': 'HerovaAi',
      },
      body: JSON.stringify({
        model: bareId,
        messages: formattedMessages,
        temperature,
        max_tokens: opts.maxTokens || 2048,
        stream: true,
      }),
      signal: requestSignal,
    });

    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => '');
      const err = new Error(`gateway ${res.status}: ${detail.slice(0, 300) || res.statusText}`);
      err.response = { status: res.status, data: detail };
      throw err;
    }

    // Node's fetch gives a web ReadableStream — decode incrementally so a chunk split
    // across a UTF-8 boundary cannot inject a mangled character into the answer.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    let usage = null;
    let upstreamModel = null;
    let sawDone = false;

    const handleLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) return;      // ignore comments / keepalives
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') { sawDone = true; return; }
      let chunk;
      try { chunk = JSON.parse(payload); } catch { return; }
      if (chunk.usage) usage = chunk.usage;
      if (chunk.model) upstreamModel = chunk.model;
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        text += delta;
        if (onToken) { try { onToken(delta); } catch { /* a UI hiccup must not kill the stream */ } }
      }
    };

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl;
        // SSE frames are newline-delimited; hold the tail back until its newline arrives.
        while ((nl = buffer.indexOf('\n')) !== -1) {
          handleLine(buffer.slice(0, nl));
          buffer = buffer.slice(nl + 1);
        }
      }
      if (buffer) handleLine(buffer);                 // flush a final line without a trailing newline
    } catch (err) {
      if (opts.signal?.aborted) {
        const e = new Error('Generation stopped');
        e.code = 'ERR_CANCELED';
        throw e;
      }
      throw err;
    }

    if (!sawDone) {
      const e = new Error(text
        ? 'stream ended before the completion marker'
        : 'stream ended before any content arrived');
      e.code = 'STREAM_INCOMPLETE';
      e.response = { status: 502, data: 'empty stream' };
      throw e;
    }

    const trimmed = text.trim();
    return {
      text: trimmed,
      tokensUsed: usage?.total_tokens || Math.round((trimmed.length / 4) + 80),
      modelUsed: catalogId,
      upstreamModel: upstreamModel || bareId,
      usage,
    };
  }

}

const service = new CloudAIService();
// Attached (rather than re-exported) so every existing `require('../services/cloudAIService')`
// call site keeps working while still being able to catch this specific failure.
service.ModelUnavailableError = ModelUnavailableError;
service.ALL_MODELS_CATALOG = ALL_MODELS_CATALOG;
// The fallback for a caller that names no model — one constant, so the chat route
// and the website cannot drift away from what the service actually serves.
service.DEFAULT_MODEL = DEFAULT_MODEL;
module.exports = service;
