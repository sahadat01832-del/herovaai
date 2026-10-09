/**
 * adapters — the only place that talks to a platform's API.
 *
 * Every function takes the stored connection and returns { ok, message, … }:
 * nothing throws at the caller, because "Facebook said the token expired" is a
 * normal, displayable outcome, not a 500.
 *
 * Secrets are read from `connection.credentials` here and used immediately —
 * never logged, never echoed back in `message` beyond what the platform itself
 * returns (Meta's error text is safe; tokens are not, so they are never
 * interpolated into messages).
 */
const crypto = require('crypto');
const axios = require('axios');

const GRAPH = 'https://graph.facebook.com/v21.0';
const TELEGRAM = 'https://api.telegram.org';
const YOUTUBE = 'https://www.googleapis.com/youtube/v3';
const TIMEOUT = 20000;

const cred = (connection, key) => String(connection?.credentials?.[key] ?? '').trim();

const http = (method, url, { params, data, headers } = {}) =>
  axios({ method, url, params, data, headers, timeout: TIMEOUT, validateStatus: () => true });

/** Platform error text, shortened — never includes our credentials. */
function failure(res) {
  const body = res?.data || {};
  const message = body.error?.message || body.description || body.message || `HTTP ${res?.status}`;
  return { ok: false, message: String(message).slice(0, 300), status: res?.status || 0, raw: body };
}

/* ─────────────────────────────── Telegram ──────────────────────────────── */

async function telegramTest(connection) {
  const token = cred(connection, 'botToken');
  if (!token) return { ok: false, message: 'Paste the bot token from @BotFather first.' };
  const res = await http('GET', `${TELEGRAM}/bot${token}/getMe`);
  if (res.status !== 200 || !res.data?.ok) return failure(res);
  return { ok: true, message: `Connected as @${res.data.result.username}`, meta: { botUsername: res.data.result.username, botId: res.data.result.id } };
}

async function telegramPublish(connection, text) {
  const token = cred(connection, 'botToken');
  const chatId = cred(connection, 'chatId') || connection?.meta?.chatId;
  if (!token) return { ok: false, message: 'No bot token saved.' };
  if (!chatId) return { ok: false, message: 'Add the channel/group id (or talk to the bot once) to know where to post.' };
  const res = await http('POST', `${TELEGRAM}/bot${token}/sendMessage`, {
    data: { chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: false },
  });
  if (!res.data?.ok) return failure(res);
  return { ok: true, message: `Posted to ${chatId}`, id: String(res.data.result.message_id) };
}

const telegramReply = telegramPublish;

/** Telegram can register its own webhook — no copy-pasting a URL. */
async function telegramRegisterWebhook(connection, publicUrl) {
  const token = cred(connection, 'botToken');
  const secret = cred(connection, 'webhookSecret');
  if (!token) return { ok: false, message: 'No bot token saved.' };
  const payload = { url: publicUrl, allowed_updates: ['message', 'edited_message', 'channel_post'] };
  if (secret) payload.secret_token = secret;
  const res = await http('POST', `${TELEGRAM}/bot${token}/setWebhook`, { data: payload });
  if (!res.data?.ok) return failure(res);
  return { ok: true, message: 'Telegram now delivers messages to this app.' };
}

/** Delete the webhook, so a disconnected bot stops delivering. */
async function telegramRemoveWebhook(connection) {
  const token = cred(connection, 'botToken');
  if (!token) return { ok: false, message: 'No bot token saved.' };
  const res = await http('POST', `${TELEGRAM}/bot${token}/deleteWebhook`, { data: { drop_pending_updates: false } });
  return res.data?.ok ? { ok: true, message: 'Webhook removed' } : failure(res);
}

/* ──────────────────────────── Facebook Graph ───────────────────────────── */

async function facebookPageTest(connection) {
  const token = cred(connection, 'pageToken');
  const pageId = cred(connection, 'pageId');
  if (!token || !pageId) return { ok: false, message: 'Both the Page ID and the Page token are needed.' };
  const res = await http('GET', `${GRAPH}/${pageId}`, { params: { fields: 'name,link', access_token: token } });
  if (res.status !== 200) return failure(res);
  return { ok: true, message: `Connected to “${res.data.name}”`, meta: { pageName: res.data.name, pageLink: res.data.link } };
}

async function facebookPagePublish(connection, text) {
  const token = cred(connection, 'pageToken');
  const pageId = cred(connection, 'pageId');
  if (!token || !pageId) return { ok: false, message: 'Page ID and Page token are required.' };
  const res = await http('POST', `${GRAPH}/${pageId}/feed`, { data: { message: text.slice(0, 5000), access_token: token } });
  if (res.status !== 200 || !res.data?.id) return failure(res);
  return { ok: true, message: 'Published to your Page', id: res.data.id };
}

async function messengerTest(connection) {
  const token = cred(connection, 'pageToken');
  if (!token) return { ok: false, message: 'Paste the Page access token first.' };
  const res = await http('GET', `${GRAPH}/me`, { params: { fields: 'name,id', access_token: token } });
  if (res.status !== 200) return failure(res);
  return { ok: true, message: `Messenger connected to “${res.data.name}”`, meta: { pageName: res.data.name, pageId: res.data.id } };
}

async function messengerReply(connection, { to, text }) {
  const token = cred(connection, 'pageToken');
  if (!token) return { ok: false, message: 'No Page token saved.' };
  const res = await http('POST', `${GRAPH}/me/messages`, {
    params: { access_token: token },
    data: { recipient: { id: to }, messaging_type: 'RESPONSE', message: { text: text.slice(0, 1900) } },
  });
  if (res.status !== 200 || !res.data?.message_id) return failure(res);
  return { ok: true, message: 'Reply sent', id: res.data.message_id };
}

/* ─────────────────────────────── Instagram ─────────────────────────────── */

async function instagramTest(connection) {
  const token = cred(connection, 'pageToken');
  const igId = cred(connection, 'igUserId');
  if (!token || !igId) return { ok: false, message: 'Instagram needs both the business account ID and a Page token.' };
  const res = await http('GET', `${GRAPH}/${igId}`, { params: { fields: 'username,followers_count', access_token: token } });
  if (res.status !== 200) return failure(res);
  return { ok: true, message: `Connected as @${res.data.username}`, meta: { username: res.data.username, followers: res.data.followers_count } };
}

/** Two-step publish: create a media container, then publish it. */
async function instagramPublish(connection, text, { imageUrl } = {}) {
  const token = cred(connection, 'pageToken');
  const igId = cred(connection, 'igUserId');
  const image = String(imageUrl || cred(connection, 'imageUrl') || '').trim();
  if (!token || !igId) return { ok: false, message: 'Instagram needs the business account ID and a Page token.' };
  if (!image) return { ok: false, message: 'Instagram only accepts image posts — add a public image URL in the connection settings.' };
  const create = await http('POST', `${GRAPH}/${igId}/media`, { data: { image_url: image, caption: text.slice(0, 2200), access_token: token } });
  if (create.status !== 200 || !create.data?.id) return failure(create);
  const publish = await http('POST', `${GRAPH}/${igId}/media_publish`, { data: { creation_id: create.data.id, access_token: token } });
  if (publish.status !== 200 || !publish.data?.id) return failure(publish);
  return { ok: true, message: 'Published to Instagram', id: publish.data.id };
}

const instagramReply = messengerReply; // DMs ride the same Send API

/* ──────────────────────────────── YouTube ─────────────────────────────── */

/** Renew the access token when a refresh token + client id/secret exist. */
async function youtubeAccessToken(connection) {
  const refresh = cred(connection, 'refreshToken');
  const clientId = cred(connection, 'clientId');
  const clientSecret = cred(connection, 'clientSecret');
  if (!refresh || !clientId || !clientSecret) return cred(connection, 'accessToken');
  const res = await http('POST', 'https://oauth2.googleapis.com/token', {
    data: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refresh, grant_type: 'refresh_token' }).toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  return res.data?.access_token || cred(connection, 'accessToken');
}

async function youtubeTest(connection) {
  const token = await youtubeAccessToken(connection);
  if (!token) return { ok: false, message: 'Paste an OAuth access token (or a refresh token with client id + secret).' };
  const res = await http('GET', `${YOUTUBE}/channels`, { params: { part: 'snippet,statistics', mine: 'true' }, headers: { Authorization: `Bearer ${token}` } });
  if (res.status !== 200) return failure(res);
  const channel = res.data?.items?.[0];
  if (!channel) return { ok: false, message: 'That token has no channel — sign in with the Google account that owns the channel.' };
  return {
    ok: true,
    message: `Connected to “${channel.snippet.title}” (${channel.statistics.subscriberCount} subscribers)`,
    meta: { channelId: channel.id, channelTitle: channel.snippet.title, subscribers: channel.statistics.subscriberCount },
  };
}

/** Reply to one comment (youtube.force-ssl). */
async function youtubeReply(connection, { parentId, text }) {
  const token = await youtubeAccessToken(connection);
  if (!token) return { ok: false, message: 'The YouTube token is missing or expired.' };
  const res = await http('POST', `${YOUTUBE}/comments`, {
    params: { part: 'snippet' },
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { snippet: { parentId, textOriginal: text.slice(0, 9000) } },
  });
  if (res.status !== 200 || !res.data?.id) return failure(res);
  return { ok: true, message: 'Comment reply posted', id: res.data.id };
}

/** New comments on the channel's own videos, newest first. */
async function youtubeNewComments(connection, { since } = {}) {
  const token = await youtubeAccessToken(connection);
  if (!token) return { ok: false, message: 'The YouTube token is missing or expired.', comments: [] };
  const res = await http('GET', `${YOUTUBE}/commentThreads`, {
    params: { part: 'snippet', allThreadsRelatedToChannelId: cred(connection, 'channelId') || undefined, maxResults: 10, order: 'time' },
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status !== 200) return { ...failure(res), comments: [] };
  const sinceMs = since ? new Date(since).getTime() : 0;
  const comments = (res.data.items || [])
    .map((item) => item.snippet?.topLevelComment?.snippet)
    .filter(Boolean)
    .filter((snippet) => !sinceMs || new Date(snippet.publishedAt).getTime() > sinceMs);
  return { ok: true, message: `${comments.length} new comment(s)`, comments };
}

/* ───────────────────────────── Generic webhook ─────────────────────────── */

/** https everywhere, except a loopback address while setting the webhook up. */
function webhookUrlProblem(url) {
  if (!url) return 'Add the URL to POST to.';
  if (/^https:\/\//i.test(url)) return '';
  if (/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(url)) return '';
  return 'Use an https:// URL — a plain http endpoint would leak the payload.';
}

async function genericWebhookTest(connection) {
  const url = cred(connection, 'url');
  const problem = webhookUrlProblem(url);
  if (problem) return { ok: false, message: problem };
  const res = await http('POST', url, {
    data: { event: 'test', text: 'HerovaAi test — your webhook works.', at: new Date().toISOString() },
    headers: { 'Content-Type': 'application/json', ...(cred(connection, 'secret') ? { 'X-Herova-Secret': cred(connection, 'secret') } : {}) },
  });
  if (res.status >= 200 && res.status < 300) return { ok: true, message: `Endpoint answered ${res.status}` };
  return failure(res);
}

async function genericWebhookPublish(connection, text, extra = {}) {
  const url = cred(connection, 'url');
  if (!url) return { ok: false, message: 'No webhook URL saved.' };
  const res = await http('POST', url, {
    data: { channel: 'webhook', text, at: new Date().toISOString(), ...extra },
    headers: { 'Content-Type': 'application/json', ...(cred(connection, 'secret') ? { 'X-Herova-Secret': cred(connection, 'secret') } : {}) },
  });
  if (res.status >= 200 && res.status < 300) return { ok: true, message: `Delivered (${res.status})` };
  return failure(res);
}

/* ───────────────────────── webhook authenticity ────────────────────────── */

/** Meta signs every webhook POST with the app secret (sha256 of the raw body). */
function metaSignatureOk(rawBody, header, appSecret) {
  if (!appSecret || !header) return false;
  const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(String(header));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Telegram echoes the secret we registered, in a header. */
function telegramSecretOk(connection, headerValue) {
  const secret = cred(connection, 'webhookSecret');
  if (!secret) return true; // nothing registered means nothing to check
  const a = Buffer.from(secret);
  const b = Buffer.from(String(headerValue || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ────────────────────────────── the surface ────────────────────────────── */

const TESTERS = {
  telegram: telegramTest,
  facebook_page: facebookPageTest,
  messenger: messengerTest,
  instagram: instagramTest,
  youtube: youtubeTest,
  webhook: genericWebhookTest,
};

const PUBLISHERS = {
  telegram: telegramPublish,
  facebook_page: facebookPagePublish,
  instagram: instagramPublish,
  webhook: (connection, text) => genericWebhookPublish(connection, text),
};

const REPLIERS = {
  telegram: telegramReply,
  messenger: messengerReply,
  instagram: instagramReply,
  youtube: youtubeReply,
};

const testerFor = (channel) => TESTERS[channel] || null;
const publisherFor = (channel) => PUBLISHERS[channel] || null;
const replierFor = (channel) => REPLIERS[channel] || null;

module.exports = {
  webhookUrlProblem,
  testerFor,
  publisherFor,
  replierFor,
  telegramRegisterWebhook,
  telegramRemoveWebhook,
  youtubeAccessToken,
  youtubeNewComments,
  metaSignatureOk,
  telegramSecretOk,
};
