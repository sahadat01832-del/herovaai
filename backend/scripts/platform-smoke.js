#!/usr/bin/env node
/**
 * platform-smoke — proves the multi-user rules and the admin switchboard.
 *
 * Two separate questions are answered here, both against the running API:
 *
 *   1. Can this system hold several owners' WhatsApp accounts (and channels) at
 *      once without them seeing or controlling each other? Two throwaway owners
 *      connect, then try every cross-account read and write. Two real Chromium
 *      sessions are launched at the same time to prove the browsers coexist, and
 *      the platform ceiling is shown refusing the launch that would exceed it.
 *
 *   2. Do the admin Controls actually control anything? Each switch is flipped
 *      and the thing it governs is exercised: sign-up refused, checkout refused,
 *      the signed Meta webhook recording "switched off" instead of answering, the
 *      scheduler leaving a due post unpinned, plan limits refusing the extra
 *      number. Every change is checked in the audit trail.
 *
 * It cleans up after itself: users, sessions, channels and audit rows it created
 * are removed, and every control is put back to its default.
 *
 *   API=http://127.0.0.1:5000 node scripts/platform-smoke.js
 */
require('dotenv').config();
const crypto = require('crypto');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const axios = require('axios');

const User = require('../src/models/User');
const WhatsAppSession = require('../src/models/WhatsAppSession');
const ChannelConnection = require('../src/models/ChannelConnection');
const AdminAction = require('../src/models/AdminAction');
const AIMemory = require('../src/models/AIMemory');
const Conversation = require('../src/models/Conversation');
const appSettings = require('../src/services/appSettings');

// A PORT of "0" (or an empty string) in the ambient environment must not become the
// target — this talks to the running server, so the fallback is the real port.
const API = (process.env.API || `http://127.0.0.1:${Number(process.env.PORT) || 5000}`).replace(/\/+$/, '');
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/contentbot';
const PASSWORD = 'SmokeTest!2345';
const PAGE_A = '900000000000911';
const PAGE_B = '900000000000922';
const APP_SECRET = 'smoke-app-secret-3f9a';

const startedAt = new Date();
let failures = 0;

function check(name, condition, detail = '') {
  if (!condition) failures += 1;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

const call = (method, url, { token, data, headers } = {}) =>
  axios({
    method,
    url: `${API}${url}`,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(headers || {}) },
    data,
    timeout: 30000,
    validateStatus: () => true,
  });

const fs = require('fs');
const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * PIDs whose command line carries this Chromium profile, read from /proc.
 *
 * The dashboard's "stopped" is a promise about a *process*, not about a list:
 * a session can leave the live list while its Brave keeps running and holding
 * ~400 MB. This is how the test tells those two apart.
 */
function pidsForProfile(profileDir) {
  const marker = `--user-data-dir=${profileDir}`;
  const pids = [];
  for (const name of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    try {
      if (fs.readFileSync(`/proc/${name}/cmdline`, 'utf8').includes(marker)) pids.push(Number(name));
    } catch (_e) { /* exited between the reads */ }
  }
  return pids;
}

async function waitFor(label, fn, { timeoutMs = 25000, everyMs = 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn().catch(() => null);
    if (value) return value;
    if (Date.now() > deadline) {
      console.log(`… ${label} did not become true within ${Math.round(timeoutMs / 1000)}s`);
      return null;
    }
    await sleep(everyMs);
  }
}

async function makeUser(role, tag) {
  const email = `${tag}@example.test`;
  await User.deleteMany({ email });
  const user = await User.create({
    name: tag,
    email,
    password: await bcrypt.hash(PASSWORD, 12),
    role,
    subscription: { tier: 'free', status: 'active' },
  });
  const res = await call('POST', '/api/auth/login', { data: { email, password: PASSWORD } });
  if (!res.data?.token) throw new Error(`could not log in ${email}: ${res.status} ${JSON.stringify(res.data)}`);
  return { user, email, token: res.data.token };
}

async function main() {
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  console.log(`platform-smoke against ${API}\n`);

  const admin = await makeUser('admin', 'smoke-admin');
  const a = await makeUser('user', 'smoke-mu-a');
  const b = await makeUser('user', 'smoke-mu-b');

  /* ── 1. Each owner's session lives in their own namespace ─────────────── */
  await WhatsAppSession.deleteMany({ userId: { $in: [a.user._id, b.user._id] } });
  const sessionA = await WhatsAppSession.create({
    userId: a.user._id, sessionName: `${a.user._id}_main`, status: 'disconnected',
    autoReply: true, autoReplyMode: 'always',
  });
  const sessionB = await WhatsAppSession.create({
    userId: b.user._id, sessionName: `${b.user._id}_main`, status: 'disconnected',
  });

  check('two owners can each hold a WhatsApp session',
    String(sessionA._id) !== String(sessionB._id) && sessionA.sessionName !== sessionB.sessionName,
    `${sessionA.sessionName} vs ${sessionB.sessionName}`);
  check('a session name is namespaced under its owner id',
    sessionA.sessionName.startsWith(`${a.user._id}_`) && sessionB.sessionName.startsWith(`${b.user._id}_`));

  const listA = await call('GET', '/api/whatsapp/sessions', { token: a.token });
  const listB = await call('GET', '/api/whatsapp/sessions', { token: b.token });
  check('owner A sees exactly their own session',
    listA.status === 200 && listA.data.sessions?.length === 1 && listA.data.sessions[0]._id === String(sessionA._id));
  check('owner B sees exactly their own session',
    listB.status === 200 && listB.data.sessions?.length === 1 && listB.data.sessions[0]._id === String(sessionB._id));

  const crossRead = await call('GET', `/api/whatsapp/sessions/${sessionA._id}`, { token: b.token });
  const crossSettings = await call('PUT', `/api/whatsapp/sessions/${sessionA._id}/settings`, { token: b.token, data: { autoReply: false } });
  const crossMessages = await call('GET', `/api/whatsapp/sessions/${sessionA._id}/messages`, { token: b.token });
  const crossDisconnect = await call('POST', `/api/whatsapp/sessions/${sessionA._id}/disconnect`, { token: b.token });
  const crossDelete = await call('DELETE', `/api/whatsapp/sessions/${sessionA._id}`, { token: b.token });
  check('reading another owner\'s session is refused (404)', crossRead.status === 404, `got ${crossRead.status}`);
  check('changing another owner\'s settings is refused (404)', crossSettings.status === 404, `got ${crossSettings.status}`);
  check('reading another owner\'s messages is refused (404)', crossMessages.status === 404, `got ${crossMessages.status}`);
  check('disconnecting another owner\'s session is refused (404)', crossDisconnect.status === 404, `got ${crossDisconnect.status}`);
  check('deleting another owner\'s session is refused (404)', crossDelete.status === 404, `got ${crossDelete.status}`);
  check('the session survives every cross-account attempt',
    Boolean(await WhatsAppSession.findById(sessionA._id)));

  /* ── 2. Channels are per owner too ────────────────────────────────────── */
  await ChannelConnection.deleteMany({ userId: { $in: [a.user._id, b.user._id] } });
  const connectA = await call('POST', '/api/channels/messenger/connect', {
    token: a.token,
    data: { credentials: { pageId: PAGE_A, pageToken: 'EAAG-smoke-token', appSecret: APP_SECRET, verifyToken: 'smoke-verify-a' } },
  });
  check('a channel can be saved for one owner', connectA.status === 200 || connectA.status === 201, `got ${connectA.status}`);
  check('a channel with a fake token is NOT reported as connected',
    connectA.data?.test?.ok === false && connectA.data?.connection?.status !== 'connected',
    `status=${connectA.data?.connection?.status} test.ok=${connectA.data?.test?.ok}`);

  const channelsA = await call('GET', '/api/channels', { token: a.token });
  const channelsB = await call('GET', '/api/channels', { token: b.token });
  const row = (payload, id) => (payload.data?.channels || []).find((c) => c.id === id);
  check('owner A sees their own channel connection', Boolean(row(channelsA, 'messenger')?.connection));
  check('owner B does not see owner A\'s channel connection', row(channelsB, 'messenger')?.connection === null);

  const connectB = await call('POST', '/api/channels/messenger/connect', {
    token: b.token,
    data: { credentials: { pageId: PAGE_B, pageToken: 'EAAG-smoke-token-b', appSecret: APP_SECRET, verifyToken: 'smoke-verify-b' } },
  });
  check('a second owner can connect the same platform independently',
    (connectB.status === 200 || connectB.status === 201)
    && await ChannelConnection.countDocuments({ userId: { $in: [a.user._id, b.user._id] } }) === 2);

  const stats = await call('GET', '/api/admin/stats', { token: admin.token });
  check('the admin can see every owner\'s connections at once',
    stats.status === 200 && Number(stats.data?.stats?.channelConnections) >= 2 && Array.isArray(stats.data?.stats?.browserFor),
    `channelConnections=${stats.data?.stats?.channelConnections}`);

  /* ── 3. Only an admin touches the controls ───────────────────────────── */
  const peek = await call('GET', '/api/admin/controls', { token: a.token });
  const poke = await call('PUT', '/api/admin/controls', { token: a.token, data: { aiReplies: false } });
  const auditPeek = await call('GET', '/api/admin/audit', { token: a.token });
  check('a non-admin cannot read the controls (403)', peek.status === 403, `got ${peek.status}`);
  check('a non-admin cannot change the controls (403)', poke.status === 403, `got ${poke.status}`);
  check('a non-admin cannot read the audit trail (403)', auditPeek.status === 403, `got ${auditPeek.status}`);

  const controls = await call('GET', '/api/admin/controls', { token: admin.token });
  check('the admin controls load with their catalogue',
    controls.status === 200 && controls.data?.controls && controls.data?.catalogue?.flags?.length === 6,
    `${controls.data?.catalogue?.flags?.length || 0} switches`);

  const badBool = await call('PUT', '/api/admin/controls', { token: admin.token, data: { aiReplies: 'yes please' } });
  const badNumber = await call('PUT', '/api/admin/controls', { token: admin.token, data: { maxActiveWhatsapp: 999 } });
  const badTier = await call('PUT', '/api/admin/controls', { token: admin.token, data: { limits: { platinum: { whatsapp: 9 } } } });
  const badNotice = await call('PUT', '/api/admin/controls', { token: admin.token, data: { notice: 'x'.repeat(300) } });
  check('a switch must be a boolean (400)', badBool.status === 400, `got ${badBool.status}`);
  check('a number outside its range is refused (400)', badNumber.status === 400, `got ${badNumber.status}`);
  check('an unknown plan is refused (400)', badTier.status === 400, `got ${badTier.status}`);
  check('an over-long notice is refused (400)', badNotice.status === 400, `got ${badNotice.status}`);

  /* ── 4. Plan limits are enforced at creation time ─────────────────────── */
  const setLimits = (limits) => call('PUT', '/api/admin/controls', { token: admin.token, data: { limits } });
  await setLimits({ free: { whatsapp: 1, channels: 1 } });

  const overSessionLimit = await call('POST', '/api/whatsapp/sessions', { token: a.token, data: { sessionName: 'second-number' } });
  check('a free plan cannot add a second WhatsApp number (409)',
    overSessionLimit.status === 409 && /free plan/i.test(overSessionLimit.data?.message || ''),
    `${overSessionLimit.status} ${overSessionLimit.data?.message || ''}`);
  check('the refusal says nothing was broken and how to get more',
    /upgrade|delete|disconnect/i.test(overSessionLimit.data?.message || ''));

  const overChannelLimit = await call('POST', '/api/channels/telegram/connect', {
    token: a.token, data: { credentials: { botToken: '123456789:smoke-token' } },
  });
  check('the free plan cannot add a second channel (409)',
    overChannelLimit.status === 409 && /free plan/i.test(overChannelLimit.data?.message || ''),
    `${overChannelLimit.status} ${overChannelLimit.data?.message || ''}`);

  await setLimits({ free: { whatsapp: 3, channels: 3 } });

  /* ── 5. Sign-ups, checkout, new sessions: the switches stop them ──────── */
  await call('PUT', '/api/admin/controls', { token: admin.token, data: { signupsOpen: false } });
  const closedSignup = await call('POST', '/api/auth/register', {
    data: { name: 'Smoke Blocked', email: 'smoke-blocked@example.test', password: PASSWORD },
  });
  check('registration is refused while sign-ups are closed (403)', closedSignup.status === 403, `got ${closedSignup.status}`);
  await call('PUT', '/api/admin/controls', { token: admin.token, data: { signupsOpen: true } });
  const openSignup = await call('POST', '/api/auth/register', {
    data: { name: 'Smoke Allowed', email: 'smoke-allowed@example.test', password: PASSWORD },
  });
  check('registration works again after the switch is put back (201)', openSignup.status === 201, `got ${openSignup.status}`);
  await User.deleteMany({ email: 'smoke-allowed@example.test' });

  await call('PUT', '/api/admin/controls', { token: admin.token, data: { paymentsOpen: false } });
  const closedCheckout = await call('POST', '/api/payments/nagad/order', { token: a.token, data: { tier: 'pro' } });
  const plansClosed = await call('GET', '/api/payments/plans');
  check('checkout is refused while payments are paused (503)', closedCheckout.status === 503, `got ${closedCheckout.status}`);
  check('the plan page says checkout is closed (no dead button)', plansClosed.data?.checkoutOpen === false);
  await call('PUT', '/api/admin/controls', { token: admin.token, data: { paymentsOpen: true } });
  const plansOpen = await call('GET', '/api/payments/plans');
  check('checkout reports open again', plansOpen.data?.checkoutOpen === true);

  await call('PUT', '/api/admin/controls', { token: admin.token, data: { whatsappEnabled: false } });
  const waClosed = await call('POST', '/api/whatsapp/sessions', { token: b.token, data: { sessionName: 'paused-test' } });
  check('new WhatsApp numbers are refused while the switch is off (503)', waClosed.status === 503, `got ${waClosed.status}`);
  await call('PUT', '/api/admin/controls', { token: admin.token, data: { whatsappEnabled: true } });

  await call('PUT', '/api/admin/controls', { token: admin.token, data: { channelsEnabled: false } });
  const chClosed = await call('POST', '/api/channels/instagram/connect', {
    token: b.token, data: { credentials: { pageId: 'x', pageToken: 'y' } },
  });
  check('new channel connections are refused while the switch is off (503)', chClosed.status === 503, `got ${chClosed.status}`);
  await call('PUT', '/api/admin/controls', { token: admin.token, data: { channelsEnabled: true } });

  /* ── 6. AI replies: the master switch, proven through a signed webhook ── */
  // A real Meta payload, signed with the app secret exactly as Meta signs it.
  const metaBody = JSON.stringify({
    object: 'page',
    entry: [{ id: PAGE_A, messaging: [{ sender: { id: 'smoke-customer-1' }, message: { text: 'do you deliver to Mirpur?' } }] }],
  });
  const sendSigned = () => call('POST', '/api/channels/webhook/messenger', {
    data: metaBody,
    headers: {
      'Content-Type': 'application/json',
      'x-hub-signature-256': `sha256=${crypto.createHmac('sha256', APP_SECRET).update(metaBody).digest('hex')}`,
    },
  });
  const badSignature = await call('POST', '/api/channels/webhook/messenger', {
    data: metaBody,
    headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': 'sha256=deadbeef' },
  });
  check('a webhook with a bad signature is refused (403)', badSignature.status === 403, `got ${badSignature.status}`);

  // Auto-reply on the stored connection (set directly: the dashboard gate wants a
  // green test first, and a fake Meta token can never be green).
  await ChannelConnection.updateOne(
    { userId: a.user._id, channel: 'messenger' },
    { $set: { 'automations.autoReply': true } },
  );
  const activityFor = async () => {
    const doc = await ChannelConnection.findOne({ userId: a.user._id, channel: 'messenger' }).lean();
    return (doc?.activity || [])[(doc?.activity || []).length - 1] || {};
  };

  await call('PUT', '/api/admin/controls', { token: admin.token, data: { aiReplies: false } });
  const ackOff = await sendSigned();
  await sleep(900);
  const offActivity = await activityFor();
  check('the webhook is still accepted while AI replies are off (200)', ackOff.status === 200, `got ${ackOff.status}`);
  check('nothing is auto-answered: the receipt says the switch is off',
    offActivity.kind === 'inbound' && /switched off platform-wide/i.test(offActivity.message || ''),
    offActivity.message || 'no activity');

  await call('PUT', '/api/admin/controls', { token: admin.token, data: { aiReplies: true } });
  const ackOn = await sendSigned();
  await sleep(900);
  const onActivity = await activityFor();
  check('with the switch back on the message takes the normal path again (200)', ackOn.status === 200, `got ${ackOn.status}`);
  check('the receipt no longer blames the platform switch',
    !/switched off platform-wide/i.test(onActivity.message || ''),
    onActivity.message || 'no activity');

  /* ── 7. Scheduled posts: the switch leaves a due post alone ───────────── */
  const channelService = require('../src/services/channelService');
  const channelScheduler = require('../src/services/channelScheduler');
  await appSettings.hydrate(); // this process reads the same rows the server just wrote

  // A Page connection is the honest subject here: Messenger cannot post at all,
  // so only a channel that CAN post shows whether the switch stopped it. Its
  // status is forced to connected (a fake token can never pass the live test),
  // which is exactly the state a real owner's Page is in when 9am arrives.
  await call('POST', '/api/channels/facebook_page/connect', {
    token: a.token,
    data: { credentials: { pageId: PAGE_A, pageToken: 'EAAG-smoke-page-token' } },
  });
  await ChannelConnection.updateOne(
    { userId: a.user._id, channel: 'facebook_page' },
    { $set: { status: 'connected', 'automations.autoPost': true, 'automations.autoPostTime': '00:00', 'stats.lastPostAt': null } },
  );
  const dueConnection = await ChannelConnection.findOne({ userId: a.user._id, channel: 'facebook_page' });
  const lastActivity = async () => {
    const doc = await ChannelConnection.findById(dueConnection._id).lean();
    return (doc?.activity || [])[(doc?.activity || []).length - 1] || {};
  };

  await call('PUT', '/api/admin/controls', { token: admin.token, data: { autoPosts: false } });
  await appSettings.hydrate();
  const refused = await channelService.publishToConnection(dueConnection, {});
  await channelScheduler._internal.runDailyPosts(new Date());
  const afterOff = await ChannelConnection.findById(dueConnection._id).lean();
  const offPost = await lastActivity();
  check('a scheduled post is refused while the switch is off',
    refused.ok === false && /switched off platform-wide/i.test(refused.message || ''), refused.message || '');
  check('the scheduler stops before claiming the day (so it posts once switched back on)',
    !afterOff.stats.lastPostAt && /switched off platform-wide/i.test(offPost.message || ''),
    `${offPost.message || 'no activity'} / lastPostAt=${afterOff.stats.lastPostAt}`);

  await call('PUT', '/api/admin/controls', { token: admin.token, data: { autoPosts: true } });
  await appSettings.hydrate();
  await channelScheduler._internal.runDailyPosts(new Date());
  const onPost = await lastActivity();
  check('with the switch on the scheduler really attempts the post (it fails on the fake token, not the switch)',
    !/switched off platform-wide/i.test(onPost.message || ''), onPost.message || 'no activity');

  /* ── 8. Two owners' browsers: one live, one waiting, then both ────────── */
  const liveNow = () => call('GET', '/api/admin/whatsapp/live', { token: admin.token });
  await call('PUT', '/api/admin/controls', { token: admin.token, data: { maxActiveWhatsapp: 1 } });

  const launchA = await call('POST', '/api/whatsapp/sessions', { token: a.token, data: { sessionName: 'browsertest' } });
  check('an owner with plan headroom can open their browser', launchA.status === 201, `${launchA.status} ${launchA.data?.message || ''}`);

  const seenA = await waitFor('owner A\'s browser to register', async () => {
    const live = await liveNow();
    return live.data?.running >= 1 ? live.data : null;
  });
  check('the admin sees one live browser, owned by A',
    Boolean(seenA) && seenA.sessions.some((s) => s.owner?.email === a.email),
    seenA ? `${seenA.running}/${seenA.ceiling} running` : 'never registered');

  const queuedB = await call('POST', '/api/whatsapp/sessions', { token: b.token, data: { sessionName: 'browsertest' } });
  check('at the ceiling the next owner is QUEUED, not refused',
    queuedB.status === 202 && queuedB.data?.queued === true && queuedB.data?.position === 1,
    `${queuedB.status} position=${queuedB.data?.position} ${queuedB.data?.message || queuedB.data?.message || ''}`);
  check('the queued owner is told where they are in line',
    queuedB.data?.session?.queuePosition === 1 && /number 1 in line/i.test(queuedB.data?.message || ''),
    queuedB.data?.session?.queuePosition === 1 ? 'position stored on the session' : 'position missing');

  const liveWhileQueued = await liveNow();
  check('a queued session is not counted as live work',
    (liveWhileQueued.data?.sessions || []).every((s) => s.owner?.email !== b.email),
    `${liveWhileQueued.data?.running} running`);
  const queueOnBoard = await call('GET', '/api/admin/controls', { token: admin.token });
  check('the admin screen shows the waiting queue',
    queueOnBoard.data?.live?.queued === 1 && queueOnBoard.data?.live?.queue?.[0]?.position === 1,
    JSON.stringify(queueOnBoard.data?.live?.queue || []));

  // Free the slot: the queue has to move on its own, without anyone asking again.
  const aBrowser = seenA?.sessions.find((s) => s.owner?.email === a.email);
  const stopped = await call('POST', `/api/admin/whatsapp/sessions/${aBrowser?.sessionId}/stop`, {
    token: admin.token, data: { reason: 'platform-smoke' },
  });
  check('the admin can stop one owner\'s browser', stopped.status === 200, `${stopped.status} ${stopped.data?.message || ''}`);

  const stoppedRow = await WhatsAppSession.findById(aBrowser?.sessionId).lean();
  check('the stopped session is marked disconnected with a reason its owner can read',
    stoppedRow?.status === 'disconnected' && /administrator/i.test(stoppedRow?.lastError || ''),
    stoppedRow?.lastError || '');

  const profileA = path.join(process.cwd(), 'tokens', aBrowser?.sessionName || '');
  const reapedA = await waitFor('A\'s Brave process to exit', async () =>
    (pidsForProfile(profileA).length === 0 ? true : null), { timeoutMs: 20000, everyMs: 1000 });
  check('the stopped browser really exits (no orphan left holding RAM)',
    Boolean(reapedA), `${pidsForProfile(profileA).length} process(es) still on ${path.basename(profileA)}`);

  const bStarted = await waitFor('the queued session to start by itself', async () => {
    const live = await liveNow();
    return (live.data?.sessions || []).some((s) => s.owner?.email === b.email) ? live.data : null;
  }, { timeoutMs: 40000 });
  check('the queued session starts on its own the moment a slot frees',
    Boolean(bStarted), bStarted ? `live: ${bStarted.sessions.map((s) => s.owner?.email).join(', ')}` : 'the queue never moved');
  const bSessionName = (bStarted?.sessions.find((s) => s.owner?.email === b.email) || {}).sessionName || '';
  const profileB = path.join(process.cwd(), 'tokens', bSessionName);
  check('the owner who was queued now has a real browser running',
    pidsForProfile(profileB).length > 0, `${pidsForProfile(profileB).length} process(es) on ${path.basename(profileB)}`);

  // Raising the limit is the other way a slot appears; a second queued number
  // must start from it — and then two owners are live at the same time.
  const queuedA2 = await call('POST', '/api/whatsapp/sessions', { token: a.token, data: { sessionName: 'browsertest2' } });
  check('a second number at the ceiling also joins the queue',
    queuedA2.status === 202 && queuedA2.data?.position === 1, `${queuedA2.status} position=${queuedA2.data?.position}`);

  await call('PUT', '/api/admin/controls', { token: admin.token, data: { maxActiveWhatsapp: 3 } });
  const seenBoth = await waitFor('both owners live at once', async () => {
    const live = await liveNow();
    const owners = (live.data?.sessions || []).map((s) => s.owner?.email);
    return owners.includes(a.email) && owners.includes(b.email) ? live.data : null;
  }, { timeoutMs: 40000 });
  check('raising the limit starts the waiting number immediately',
    Boolean(seenBoth), seenBoth ? `${seenBoth.running} browsers` : 'queue did not move on the limit change');
  check('two different owners\' WhatsApp accounts run at the same time',
    Boolean(seenBoth), seenBoth ? `${seenBoth.running} browsers: ${seenBoth.sessions.map((s) => s.owner?.email).join(', ')}` : 'never both live');
  check('each live browser carries its own session id and owner',
    Boolean(seenBoth) && seenBoth.sessions.every((s) => s.sessionId && s.owner?.email));

  /* ── 8b. Per-owner usage report ───────────────────────────────────────── */
  const usageDenied = await call('GET', '/api/admin/usage', { token: a.token });
  check('a non-admin cannot read the usage report (403)', usageDenied.status === 403, `got ${usageDenied.status}`);

  const usage = await call('GET', '/api/admin/usage', { token: admin.token });
  const usageRows = usage.data?.rows || [];
  const rowA = usageRows.find((r) => r.email === a.email);
  const rowB = usageRows.find((r) => r.email === b.email);
  check('the usage report lists every account',
    usage.status === 200 && Boolean(rowA) && Boolean(rowB), `${usageRows.length} rows`);
  check('it reports WhatsApp sessions and live browsers per owner',
    rowA?.whatsapp?.sessions >= 2 && rowA?.whatsapp?.live >= 1 && rowB?.whatsapp?.live >= 1,
    `A: ${rowA?.whatsapp?.sessions} sessions / ${rowA?.whatsapp?.live} live · B: ${rowB?.whatsapp?.live} live`);
  check('it reports the channel work per owner',
    rowA?.channels?.total >= 2 && rowB?.channels?.total >= 1,
    `A: ${rowA?.channels?.total} channels · B: ${rowB?.channels?.total}`);
  check('it shows the plan headroom those connections leave',
    rowA?.whatsapp?.left === Math.max(0, rowA.whatsapp.limit - rowA.whatsapp.sessions) && rowA?.whatsapp?.limit === 3,
    `A limit ${rowA?.whatsapp?.limit}, left ${rowA?.whatsapp?.left}`);
  check('its totals agree with the rows',
    usage.data?.totals?.whatsappSessions >= (rowA.whatsapp.sessions + rowB.whatsapp.sessions),
    `totals ${usage.data?.totals?.whatsappSessions} sessions`);

  /* ── 9. The audit trail names who did what ────────────────────────────── */
  const audit = await call('GET', '/api/admin/audit?limit=200', { token: admin.token });
  const rows = audit.data?.actions || [];
  check('the audit trail records the settings changes',
    rows.some((r) => r.action === 'settings.update' && r.actorEmail === admin.email),
    `${rows.filter((r) => r.action === 'settings.update').length} settings rows`);
  check('the audit trail records the stopped browser',
    rows.some((r) => r.action === 'session.stop' && r.target === aBrowser?.sessionName),
    aBrowser?.sessionName || '');

  /* ── 10. Cleaning up also removes what the account owned ──────────────── */
  // Give the account everything it could own, so the deletion has something to
  // prove: a business profile and a past conversation must not survive as orphan
  // rows nobody can ever open.
  await AIMemory.updateOne({ userId: a.user._id }, { $set: { businessName: 'Smoke Shop', ownerName: 'Smoke Owner' } }, { upsert: true });
  // No .catch here on purpose: if the setup row cannot be created, the test must
  // fail loudly rather than silently asserting on something that never existed.
  await Conversation.create({
    userId: a.user._id,
    title: 'Smoke conversation',
    mode: 'local',
    messages: [{ role: 'user', content: 'smoke setup' }],
  });
  const ownedBefore = {
    memories: await AIMemory.countDocuments({ userId: a.user._id }),
    conversations: await Conversation.countDocuments({ userId: a.user._id }),
  };
  check('the test account owns a profile and a conversation before deletion',
    ownedBefore.memories > 0 && ownedBefore.conversations > 0,
    JSON.stringify(ownedBefore));

  const delA = await call('DELETE', `/api/admin/users/${a.user._id}`, { token: admin.token });
  const delB = await call('DELETE', `/api/admin/users/${b.user._id}`, { token: admin.token });
  check('deleting an owner succeeds', delA.status === 200 && delB.status === 200);
  check('their WhatsApp sessions go with the account',
    await WhatsAppSession.countDocuments({ userId: { $in: [a.user._id, b.user._id] } }) === 0);
  check('their channel connections go with the account',
    await ChannelConnection.countDocuments({ userId: { $in: [a.user._id, b.user._id] } }) === 0);
  check('their business profile goes with the account (no orphan rows)',
    await AIMemory.countDocuments({ userId: { $in: [a.user._id, b.user._id] } }) === 0);
  check('their past conversations go with the account',
    await Conversation.countDocuments({ userId: { $in: [a.user._id, b.user._id] } }) === 0);

  // Put every switch back and prove the defaults came home.
  const restored = await call('PUT', '/api/admin/controls', {
    token: admin.token,
    data: {
      aiReplies: true, autoPosts: true, whatsappEnabled: true, channelsEnabled: true,
      signupsOpen: true, paymentsOpen: true, notice: '', maxActiveWhatsapp: 6,
      channelRepliesPerDay: 200, defaultOwnerMuteMinutes: 5,
      limits: { free: { whatsapp: 1, channels: 3 }, pro: { whatsapp: 2, channels: 8 }, enterprise: { whatsapp: 5, channels: 20 } },
    },
  });
  const defaults = appSettings.DEFAULTS[appSettings.PLATFORM];
  check('every control is back at its default',
    JSON.stringify(restored.data?.controls) === JSON.stringify(defaults),
    restored.data?.controls ? 'restored' : 'no response');

  // No leftover browsers or profiles from the test, under either owner's id.
  const TEST_SUFFIXES = ['browsertest', 'browsertest2', 'main'];
  for (const suffix of TEST_SUFFIXES) {
    for (const owner of [a, b]) {
      const dir = path.join(process.cwd(), 'tokens', `${owner.user._id}_${suffix}`);
      for (const pid of pidsForProfile(dir)) {
        try { process.kill(pid, 'SIGTERM'); } catch (_e) { /* already gone */ }
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  await sleep(1500);
  const leftovers = [a, b].flatMap((owner) => TEST_SUFFIXES
    .map((suffix) => path.join(process.cwd(), 'tokens', `${owner.user._id}_${suffix}`)))
    .filter((dir) => pidsForProfile(dir).length > 0 || fs.existsSync(dir));
  check('the test leaves no browser and no profile behind', leftovers.length === 0,
    leftovers.map((d) => path.basename(d)).join(', '));

  // Test noise: audit rows and the throwaway admin. The two owners are gone.
  await AdminAction.deleteMany({ at: { $gte: startedAt } });
  await User.deleteOne({ _id: admin.user._id });

  await mongoose.disconnect();

  console.log(`\n${failures === 0 ? '✅' : '❌'} platform-smoke: ${failures === 0 ? 'all checks passed' : `${failures} check(s) failed`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`platform-smoke crashed: ${err.message}`);
  process.exit(1);
});
