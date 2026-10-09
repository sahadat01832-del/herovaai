/**
 * channelService — one place where a channel is connected, tested, posted to and
 * answered on.
 *
 * The rules it keeps for every platform:
 *   • Credentials are validated against the registry's whitelist before saving,
 *     so a typo'd field name cannot silently store a secret nobody reads.
 *   • Connecting always tests live — "saved" and "working" are different things.
 *   • Automatic replies need a model; with none available the message is logged
 *     as unanswered rather than answered badly.
 *   • Every action leaves a receipt in connection.activity, including failures.
 */
const ChannelConnection = require('../models/ChannelConnection');
const registry = require('./channels/registry');
const adapters = require('./channels/adapters');
const aiReply = require('./channels/aiReply');
const fs = require('fs');
const path = require('path');

const DAILY_REPLY_CAP = Number(process.env.CHANNEL_REPLIES_PER_DAY || 200);

/** The public origin platforms should call back: tunnel URL, or BACKEND_URL. */
function publicBase() {
  const configured = (process.env.PUBLIC_URL || process.env.BACKEND_URL || '').trim().replace(/\/+$/, '');
  if (configured && !/localhost|127\.0\.0\.1/.test(configured)) return configured;
  try {
    const file = path.join(__dirname, '..', '..', 'logs', 'public-url.txt');
    const fromFile = fs.readFileSync(file, 'utf8').trim().replace(/\/+$/, '');
    if (fromFile) return fromFile;
  } catch (_e) { /* fall through */ }
  return configured || `http://localhost:${process.env.PORT || 5000}`;
}

/* ─────────────────────────────── reading ───────────────────────────────── */

/** The catalogue joined with this owner's connections — what the page renders. */
async function listFor(userId) {
  const rows = await ChannelConnection.find({ userId }).sort({ createdAt: 1 });
  const byChannel = new Map(rows.map((row) => [row.channel, row]));
  return registry.catalogue().map((entry) => {
    const connection = byChannel.get(entry.id) || null;
    return {
      ...entry,
      connection: connection ? connection.toJSON() : null,
      webhookUrl: entry.webhook ? `${publicBase()}${entry.webhook.path}` : '',
    };
  });
}

/* ────────────────────────────── connecting ─────────────────────────────── */

class ChannelError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * Save credentials and prove them. `replace` clears a field the owner emptied,
 * so removing a token actually removes it instead of keeping "configured".
 */
async function connect(userId, channelId, { credentials = {}, automations = {}, label = '' } = {}) {
  const definition = registry.channel(channelId);
  if (!definition) throw new ChannelError('Unknown channel', 404);
  if (!definition.apiAvailable) {
    throw new ChannelError(definition.availableReason || 'This platform cannot be automated from a server.', 409);
  }

  const allowed = new Set(registry.credentialKeys(channelId));
  const stored = {};
  for (const [key, value] of Object.entries(credentials)) {
    if (!allowed.has(key)) continue; // silently dropping unknown keys is the point
    stored[key] = String(value ?? '').trim().slice(0, 4000);
  }

  let connection = await ChannelConnection.findOne({ userId, channel: channelId });
  if (!connection) {
    connection = new ChannelConnection({ userId, channel: channelId });
  }

  const merged = { ...(connection.credentials || {}) };
  for (const key of allowed) {
    if (key in stored) {
      if (stored[key]) merged[key] = stored[key];
      else delete merged[key];
    }
  }
  connection.credentials = merged;
  if (label) connection.label = String(label).slice(0, 80);

  const autoPatch = {};
  if (automations.autoReply !== undefined) autoPatch.autoReply = Boolean(automations.autoReply);
  if (automations.autoPost !== undefined) autoPatch.autoPost = Boolean(automations.autoPost);
  if (automations.autoPostTime !== undefined) autoPatch.autoPostTime = normaliseTime(automations.autoPostTime);
  if (automations.postTopic !== undefined) autoPatch.postTopic = String(automations.postTopic).slice(0, 300);
  if (automations.replyNote !== undefined) autoPatch.replyNote = String(automations.replyNote).slice(0, 300);
  connection.automations = { ...connection.automations.toObject(), ...autoPatch };

  connection.status = 'not_configured';
  connection.lastError = '';
  await connection.save();

  const result = await testConnection(connection);
  return { connection, test: result };
}

function normaliseTime(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) return '09:00';
  const hours = Math.min(23, Math.max(0, Number(match[1])));
  const minutes = Math.min(59, Math.max(0, Number(match[2])));
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/* ──────────────────────────────── testing ──────────────────────────────── */

async function testConnection(connection) {
  const tester = adapters.testerFor(connection.channel);
  if (!tester) {
    connection.lastTest = { at: new Date(), ok: null, message: 'This channel has no live test yet.' };
    await connection.save();
    return { ok: false, message: connection.lastTest.message };
  }

  let result;
  try {
    result = await tester(connection);
  } catch (err) {
    result = { ok: false, message: `Could not reach ${connection.channel}: ${String(err.message || '').slice(0, 200)}` };
  }

  connection.lastTest = { at: new Date(), ok: Boolean(result.ok), message: String(result.message || '').slice(0, 300) };
  if (result.ok) {
    connection.status = 'connected';
    connection.lastError = '';
    if (result.meta) connection.meta = { ...(connection.meta || {}), ...result.meta };
    connection.pushActivity('test', true, result.message);
  } else {
    connection.status = 'error';
    connection.lastError = String(result.message || '').slice(0, 300);
    connection.pushActivity('test', false, result.message);
  }
  await connection.save();
  return { ok: Boolean(result.ok), message: connection.lastTest.message, meta: result.meta || null };
}

/* ─────────────────────────────── posting ───────────────────────────────── */

/** Compose a post and publish it now. Used by the scheduler and "Post now". */
async function publishToConnection(connection, { text } = {}) {
  const publisher = adapters.publisherFor(connection.channel);
  if (!publisher) {
    connection.pushActivity('post', false, 'This channel cannot post.');
    await connection.save();
    return { ok: false, message: 'This channel cannot post.' };
  }
  if (!connection.automations?.autoPost && !text) {
    return { ok: false, message: 'Auto-posting is off for this channel.' };
  }

  let body = String(text || '').trim();
  let composer = null;
  if (!body) {
    composer = await aiReply.composePost({
      userId: connection.userId,
      topic: connection.automations?.postTopic,
      channelLabel: registry.channel(connection.channel)?.name || connection.channel,
    });
    body = composer.text;
  }

  let result;
  try {
    result = await publisher(connection, body, { imageUrl: connection.credentials?.imageUrl });
  } catch (err) {
    result = { ok: false, message: String(err.message || 'publish failed').slice(0, 300) };
  }

  if (result.ok) {
    connection.stats.postsSent = (connection.stats.postsSent || 0) + 1;
    connection.stats.lastPostAt = new Date();
    connection.pushActivity('post', true, `${result.message}${composer?.source === 'template' ? ' (plain template — no AI model available)' : ''}`);
    await connection.save();
    return { ok: true, message: result.message, text: body, model: composer?.model || 'editor' };
  }

  connection.lastError = String(result.message || '').slice(0, 300);
  connection.pushActivity('post', false, result.message);
  await connection.save();
  return { ok: false, message: result.message, text: body };
}

/* ─────────────────────────── inbound / auto-reply ──────────────────────── */

/** Reply budget per connection per day, so a loop cannot empty a quota. */
function repliesAllowedToday(connection) {
  const today = new Date().toISOString().slice(0, 10);
  if (connection.stats.repliesDay !== today) {
    connection.stats.repliesDay = today;
    connection.stats.repliesToday = 0;
  }
  return (connection.stats.repliesToday || 0) < DAILY_REPLY_CAP;
}

/**
 * Handle one incoming customer message: decide whether to answer, answer with
 * the shared AI helper, send it, and leave a receipt either way.
 */
async function handleInbound(connection, { senderId, text, history = [], replyTo = {} }) {
  connection.stats.lastInboundAt = new Date();

  if (!connection.automations?.autoReply) {
    connection.pushActivity('inbound', true, 'Message received; auto-reply is off, so it waits for you.');
    await connection.save();
    return { replied: false, reason: 'auto-reply-off' };
  }
  if (!repliesAllowedToday(connection)) {
    connection.pushActivity('inbound', false, `Daily reply limit (${DAILY_REPLY_CAP}) reached — messages are being left for you.`);
    await connection.save();
    return { replied: false, reason: 'daily-cap' };
  }

  const replier = adapters.replierFor(connection.channel);
  if (!replier) {
    connection.pushActivity('inbound', false, 'Incoming messages cannot be answered on this channel yet.');
    await connection.save();
    return { replied: false, reason: 'no-replier' };
  }

  const generated = await aiReply.generateReply({
    userId: connection.userId,
    incomingText: text,
    history,
    channelLabel: registry.channel(connection.channel)?.name || connection.channel,
    note: connection.automations?.replyNote,
  });
  if (!generated.ok) {
    connection.pushActivity('inbound', false, generated.reason || 'No AI model available — nothing was sent.');
    await connection.save();
    return { replied: false, reason: 'no-model' };
  }

  let sent;
  try {
    sent = await replier(connection, { to: senderId, text: generated.text, parentId: replyTo.parentId });
  } catch (err) {
    sent = { ok: false, message: String(err.message || 'send failed').slice(0, 300) };
  }

  if (sent.ok) {
    connection.stats.repliesSent = (connection.stats.repliesSent || 0) + 1;
    connection.stats.repliesToday = (connection.stats.repliesToday || 0) + 1;
    connection.stats.lastReplyAt = new Date();
    connection.pushActivity('reply', true, `Answered ${senderId} with ${generated.model}`);
    await connection.save();
    return { replied: true, text: generated.text, model: generated.model };
  }

  connection.lastError = String(sent.message || '').slice(0, 300);
  connection.pushActivity('reply', false, sent.message);
  await connection.save();
  return { replied: false, reason: 'send-failed', message: sent.message };
}

/* ─────────────────────────── finding + removing ────────────────────────── */

/** Find the owner of a Meta page — webhooks arrive without a login. */
const findByMetaPageId = (pageId) =>
  ChannelConnection.findOne({ channel: { $in: ['messenger', 'instagram', 'facebook_page'] }, 'credentials.pageId': String(pageId || '') });

async function disconnect(connection) {
  try {
    if (connection.channel === 'telegram') {
      await adapters.telegramRemoveWebhook(connection);
    }
  } catch (_e) { /* the local delete below is what matters */ }
  await ChannelConnection.deleteOne({ _id: connection._id });
}

module.exports = {
  publicBase,
  listFor,
  connect,
  testConnection,
  publishToConnection,
  handleInbound,
  findByMetaPageId,
  disconnect,
  normaliseTime,
  ChannelError,
  DAILY_REPLY_CAP,
};
