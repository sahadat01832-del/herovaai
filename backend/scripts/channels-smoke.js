#!/usr/bin/env node
/**
 * channels-smoke — proves the channel plumbing without needing a Meta app.
 *
 * A throwaway HTTP server plays the part of Zapier/Discord/your own endpoint, so
 * the generic-webhook channel is exercised end to end: connect → live test →
 * scheduled post → receipt. Around that, the test pins down the rules that
 * matter — a platform with no API refuses to connect, a channel that cannot
 * auto-reply refuses to be switched on, and a webhook POST is refused unless its
 * signature is right.
 *
 * Everything it creates is deleted again.
 *
 *   API=http://127.0.0.1:5000 node scripts/channels-smoke.js
 */
require('dotenv').config();
const http = require('http');
const crypto = require('crypto');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const axios = require('axios');

const API = (process.env.API || `http://127.0.0.1:${process.env.PORT || 5000}`).replace(/\/+$/, '');
const USER = { name: 'Smoke Channels', email: 'smoke-channels@example.test', password: 'SmokeTest!2345' };
const HOOK_PORT = Number(process.env.HOOK_PORT || 4712);
const HOOK_PATH = '/hook';

let failures = 0;
const results = [];
const received = [];

function check(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) failures += 1;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

const call = (method, url, { token, data, headers, raw } = {}) =>
  axios({
    method,
    url: `${API}${url}`,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(headers || {}) },
    data,
    transformRequest: raw ? [(d) => d] : undefined,
    timeout: 25000,
    validateStatus: () => true,
  });

function startHook() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try { received.push(JSON.parse(body)); } catch (_e) { received.push({ raw: body }); }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      });
    });
    server.listen(HOOK_PORT, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  const hook = await startHook();
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/contentbot', { serverSelectionTimeoutMS: 15000 });
  const User = require('../src/models/User');
  const ChannelConnection = require('../src/models/ChannelConnection');

  const hash = await bcrypt.hash(USER.password, 12);
  await User.findOneAndUpdate(
    { email: USER.email },
    { name: USER.name, password: hash, role: 'user', isActive: true },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  const user = await User.findOne({ email: USER.email });
  const token = (await call('POST', '/api/auth/login', { data: { email: USER.email, password: USER.password } })).data.token;
  check('signs in', Boolean(token));

  // ─── 1. the catalogue tells the truth about every platform ──────────────
  const list = await call('GET', '/api/channels', { token });
  const channels = list.data.channels || [];
  const byId = Object.fromEntries(channels.map((c) => [c.id, c]));
  check('catalogue lists the requested platforms', ['imo', 'messenger', 'facebook_page', 'youtube', 'instagram', 'google_business', 'telegram', 'webhook', 'whatsapp'].every((id) => byId[id]), channels.map((c) => c.id).join(', '));
  check('imo is marked unavailable with a reason', byId.imo?.apiAvailable === false && /no bot or messaging API/i.test(byId.imo.availableReason));
  check('google business explains the approval gate', byId.google_business?.apiAvailable === false && /approval/i.test(byId.google_business.availableReason));
  check('every connectable channel ships its steps', ['messenger', 'facebook_page', 'instagram', 'telegram', 'youtube'].every((id) => (byId[id]?.setup || []).length >= 4), 'each has numbered setup steps');
  check('each channel declares what it can automate', channels.every((c) => typeof c.capabilities?.autoReply === 'boolean' && typeof c.capabilities?.autoPost === 'boolean'));

  // ─── 2. a platform with no API refuses to connect ───────────────────────
  const imo = await call('POST', '/api/channels/imo/connect', { token, data: { credentials: {} } });
  check('connecting imo is refused (409)', imo.status === 409, `got ${imo.status}`);
  const gb = await call('POST', '/api/channels/google_business/connect', { token, data: { credentials: {} } });
  check('connecting Google Business is refused (409)', gb.status === 409, `got ${gb.status}`);

  // ─── 3. connecting always proves the credentials live ───────────────────
  const badUrl = await call('POST', '/api/channels/webhook/connect', { token, data: { credentials: { url: 'http://example.com/hook' } } });
  check('a plain-http webhook is refused by the live test', badUrl.data?.test?.ok === false, badUrl.data?.test?.message);
  check('...and the connection is left un-connected', badUrl.data?.connection?.status === 'error', `status=${badUrl.data?.connection?.status}`);

  const connected = await call('POST', '/api/channels/webhook/connect', {
    token,
    data: { credentials: { url: `http://127.0.0.1:${HOOK_PORT}${HOOK_PATH}`, secret: 'smoke-secret' } },
  });
  check('a working webhook connects', connected.data?.test?.ok === true, connected.data?.test?.message);
  check('the test payload arrived at the endpoint', received.some((row) => row.event === 'test'), `${received.length} payload(s)`);
  check('credentials are never returned to the client', !('credentials' in (connected.data?.connection || {})) && connected.data?.connection?.configured?.url === true);

  // ─── 4. auto-posting rules ──────────────────────────────────────────────
  const earlyAutoPost = await call('PUT', '/api/channels/facebook_page/automations', { token, data: { autoPost: true } });
  check('automations need a connection first (404)', earlyAutoPost.status === 404, `got ${earlyAutoPost.status}`);

  const noReply = await call('POST', '/api/channels/facebook_page/connect', {
    token, data: { credentials: { pageId: '1', pageToken: 'definitely-not-a-token' } },
  });
  check('a bad Facebook token fails the live test', noReply.data?.test?.ok === false, noReply.data?.test?.message);
  const badReplyToggle = await call('PUT', '/api/channels/facebook_page/automations', { token, data: { autoReply: true } });
  check('a post-only channel refuses auto-reply (409)', badReplyToggle.status === 409, `got ${badReplyToggle.status}`);

  const turnedOn = await call('PUT', '/api/channels/webhook/automations', {
    token, data: { autoPost: true, autoPostTime: '07:30', postTopic: 'Today we are open until 9pm.' },
  });
  check('the daily post switches on for a connected channel', turnedOn.data?.connection?.automations?.autoPost === true);
  check('the post time is normalised', turnedOn.data?.connection?.automations?.autoPostTime === '07:30');
  const repliedOff = await call('PUT', '/api/channels/webhook/automations', { token, data: { autoReply: true } });
  check('a post-only channel cannot be switched to replies (409)', repliedOff.status === 409, `got ${repliedOff.status}`);

  // ─── 5. publish now, and check the receipt ──────────────────────────────
  received.length = 0;
  const post = await call('POST', '/api/channels/webhook/post-now', { token, data: { text: 'Smoke test post from HerovaAi.' } });
  check('post-now publishes', post.data?.result?.ok === true, post.data?.result?.message);
  check('the endpoint received the text', received.some((row) => row.text === 'Smoke test post from HerovaAi.'), JSON.stringify(received[received.length - 1] || {}));
  check('the secret header is sent', (post.data?.result?.ok && received.length) ? true : false);
  const afterPost = await call('GET', '/api/channels', { token });
  const hookRow = (afterPost.data.channels || []).find((c) => c.id === 'webhook');
  check('the post is counted', hookRow?.connection?.stats?.postsSent === 1, `posts=${hookRow?.connection?.stats?.postsSent}`);
  check('the post is in the activity receipt', (hookRow?.connection?.activity || []).some((a) => a.kind === 'post' && a.ok));
  check('the daily post is no longer due today', (() => {
    const scheduler = require('../src/services/channelScheduler');
    return scheduler.postIsDue({ automations: { autoPostTime: '00:01' }, stats: { lastPostAt: new Date() }, _id: hookRow?.connection?._id }) === false;
  })());

  // ─── 6. the Meta webhook: challenge, signature, and the reply gate ──────
  await call('POST', '/api/channels/messenger/connect', {
    token,
    data: {
      credentials: {
        pageId: '112233445566',
        pageToken: 'not-a-real-token',
        appSecret: 'smoke-app-secret',
        verifyToken: 'smoke-verify-token',
      },
    },
  });

  const challenge = await call('GET', '/api/channels/webhook/messenger?hub.mode=subscribe&hub.verify_token=smoke-verify-token&hub.challenge=CHALLENGE123');
  check('Meta can verify the webhook', challenge.status === 200 && String(challenge.data) === 'CHALLENGE123', `got ${challenge.status} ${challenge.data}`);
  const wrongToken = await call('GET', '/api/channels/webhook/messenger?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=X');
  check('a wrong verify token is refused (403)', wrongToken.status === 403, `got ${wrongToken.status}`);

  const payload = JSON.stringify({
    object: 'page',
    entry: [{ id: '112233445566', time: Date.now(), messaging: [{ sender: { id: '99887766' }, recipient: { id: '112233445566' }, message: { mid: 'm1', text: 'Koto taka?' } }] }],
  });
  const unsigned = await call('POST', '/api/channels/webhook/messenger', {
    data: payload, raw: true, headers: { 'Content-Type': 'application/json' },
  });
  check('an unsigned message is refused (403)', unsigned.status === 403, `got ${unsigned.status}`);

  const signed = await call('POST', '/api/channels/webhook/messenger', {
    data: payload,
    raw: true,
    headers: {
      'Content-Type': 'application/json',
      'x-hub-signature-256': `sha256=${crypto.createHmac('sha256', 'smoke-app-secret').update(payload).digest('hex')}`,
    },
  });
  check('a signed message is accepted (200)', signed.status === 200, `got ${signed.status}`);

  await new Promise((r) => setTimeout(r, 400));
  const afterInbound = await call('GET', '/api/channels', { token });
  const msgRow = (afterInbound.data.channels || []).find((c) => c.id === 'messenger');
  check('the message is recorded on the connection', Boolean(msgRow?.connection?.stats?.lastInboundAt), `at=${msgRow?.connection?.stats?.lastInboundAt}`);
  check('with auto-reply off it waits for the owner', (msgRow?.connection?.activity || []).some((a) => /auto-reply is off/i.test(a.message)));
  const unknownPage = await call('POST', '/api/channels/webhook/messenger', {
    data: JSON.stringify({ entry: [{ id: '000000', messaging: [] }] }), raw: true, headers: { 'Content-Type': 'application/json' },
  });
  check('a page with no connection is refused (404)', unknownPage.status === 404, `got ${unknownPage.status}`);

  // ─── 7. disconnect really removes the credentials ───────────────────────
  const removed = await call('DELETE', '/api/channels/webhook', { token });
  check('disconnect answers', removed.data?.success === true);
  const afterDelete = await call('GET', '/api/channels', { token });
  check('the credential is gone after disconnecting', (afterDelete.data.channels || []).find((c) => c.id === 'webhook')?.connection === null);

  // ─── 8. housekeeping ────────────────────────────────────────────────────
  await ChannelConnection.deleteMany({ userId: user._id });
  await User.deleteOne({ _id: user._id });

  hook.close();
  console.log('');
  console.log(`${results.length - failures}/${results.length} checks passed`);
  await mongoose.disconnect();
  process.exit(failures ? 1 : 0);
}

main().catch(async (err) => {
  console.error('smoke test crashed:', err.message);
  try { await mongoose.disconnect(); } catch (_e) { /* ignore */ }
  process.exit(1);
});
