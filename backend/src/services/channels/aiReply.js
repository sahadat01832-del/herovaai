/**
 * aiReply — turns a customer message into a reply in the owner's voice, for any
 * channel. WhatsApp has its own long-standing implementation; this is the shared
 * one for Messenger, Instagram, Telegram and YouTube comments.
 *
 * The ladder is the same shape as WhatsApp's, and the same rule applies: never
 * answer as a different model than the one asked for, and if no model is
 * available say so (`ok: false`) instead of inventing an answer. A channel with
 * no model available logs "no model" and stays quiet — a wrong price quoted
 * automatically is worse than a slow reply.
 */
const axios = require('axios');
const AIMemory = require('../../models/AIMemory');
const User = require('../../models/User');
const memoryProfile = require('../memoryProfile');
const lmStudioService = require('../lmStudioService');
const cloudAIService = require('../cloudAIService');
const catalogService = require('../catalogService');

const PINNED_CLOUD = () => (process.env.CHANNEL_AI_MODEL || '').trim();

function systemPromptFor({ memory, user, extra }) {
  const businessName = memory?.businessName || user?.businessInfo?.name || 'this business';
  const ownerName = memory?.ownerName || user?.name || 'the owner';

  const lines = [
    `You are the customer-care assistant for "${businessName}", writing as the business itself.`,
    'Answer only from the facts below. Never invent prices, stock, delivery times or promises.',
    'If something is not covered, say you will confirm with the team and ask for a name and number.',
    'Keep it short and human — one or two sentences unless more detail is genuinely asked for.',
    'Match the language the customer used. Never mention AI vendors or model names.',
  ];
  const profile = memoryProfile.promptBlock(memory);
  if (profile) lines.push('', profile);
  if (extra) lines.push('', `Channel instructions: ${extra}`);
  lines.push(`If a question needs a human, tell them ${ownerName} will follow up.`);
  return lines.join('\n');
}

/**
 * Generate a reply. Returns { ok, text, model } — `ok: false` means no model
 * could answer, and the caller must not send anything.
 */
async function generateReply({ userId, incomingText, history = [], channelLabel = '', note = '' }) {
  const [memory, user] = await Promise.all([
    AIMemory.findOne({ userId }).catch(() => null),
    User.findById(userId).catch(() => null),
  ]);
  const systemPrompt = systemPromptFor({
    memory,
    user,
    extra: [channelLabel ? `Channel: ${channelLabel}.` : '', note].filter(Boolean).join(' '),
  });

  const messages = [
    ...history.slice(-6).map((h) => ({ role: h.direction === 'incoming' ? 'user' : 'assistant', content: String(h.body || '').slice(0, 1500) })),
    { role: 'user', content: String(incomingText || '').slice(0, 2000) },
  ];

  // ── Cloud, but only a model the provider actually serves right now ──
  const pinned = PINNED_CLOUD();
  try {
    const modelDef = pinned ? cloudAIService.ALL_MODELS_CATALOG.find((m) => m.id === pinned) : null;
    const provider = modelDef?.provider || 'groq';
    const servable = await catalogService.checkServable(provider, pinned || modelDef?.id);
    if (pinned && servable.ok) {
      const res = await cloudAIService.generateCompletion({ model: pinned, messages, systemPrompt, temperature: 0.6 });
      if (res?.text?.trim()) return { ok: true, text: res.text.trim(), model: res.modelUsed || pinned };
    }
  } catch (err) {
    console.warn(`[channel ai] cloud tier failed: ${err.message}`);
  }

  // ── Local LM Studio ──
  try {
    const model = await lmStudioService.pickDefaultChatModel();
    if (model) {
      const url = process.env.LM_STUDIO_BASE_URL || 'http://localhost:1234/v1';
      const loaded = await lmStudioService.ensureModelLoaded(model, 25);
      if (loaded) {
        const res = await axios.post(`${url}/chat/completions`, {
          model,
          messages: [{ role: 'system', content: systemPrompt }, ...messages],
          temperature: 0.6,
          max_tokens: 400,
          stream: false,
        }, { timeout: 60000 });
        const text = res.data?.choices?.[0]?.message?.content;
        if (text?.trim()) return { ok: true, text: text.trim(), model: `local:${model}` };
      }
    }
  } catch (err) {
    console.warn(`[channel ai] local tier failed: ${err.message}`);
  }

  return { ok: false, text: '', model: '', reason: 'No AI model is available right now (no cloud key configured and LM Studio is not serving a model).' };
}

/**
 * Draft the daily post. Same honesty: if no model is available we fall back to a
 * plain, factual template built from the owner's own memory — never something
 * the AI "would have said".
 */
async function composePost({ userId, topic, channelLabel = '' }) {
  const [memory, user] = await Promise.all([
    AIMemory.findOne({ userId }).catch(() => null),
    User.findById(userId).catch(() => null),
  ]);
  const businessName = memory?.businessName || user?.businessInfo?.name || 'Our shop';

  const generated = await generateReply({
    userId,
    incomingText: `Write today's social post for our customers.${topic ? ` Focus: ${topic}.` : ''} One short paragraph, no hashtags spam, no invented offers.`,
    channelLabel,
    note: 'This is a post, not a reply: no greeting to a customer, no question back.',
  });
  if (generated.ok) return { ok: true, text: generated.text, model: generated.model, source: 'ai' };

  const phone = memory?.operations?.phone || user?.phone || '';
  const hours = memory?.operations?.openingHours || '';
  const template = [
    `${businessName} — a quick note for our customers.`,
    topic ? topic : 'We are open and ready to help today.',
    hours ? `Open: ${hours}` : '',
    phone ? `Call or message us: ${phone}` : '',
  ].filter(Boolean).join('\n');
  return { ok: true, text: template, model: 'template', source: 'template' };
}

module.exports = { generateReply, composePost, systemPromptFor };
