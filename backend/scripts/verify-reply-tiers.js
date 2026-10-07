/**
 * Proves each auto-reply tier answers with the model it claims, and that a pinned model which
 * does not verify is skipped instead of being silently swapped for another one.
 *
 * Each tier runs as a child process because the tiers read their pinned ids from the
 * environment, and the same real handler the live WhatsApp client calls is used for every
 * attempt. The stored `aiModel` on the outgoing message is the thing asserted on, not a log.
 *
 * Usage: node scripts/verify-reply-tiers.js          (all tiers)
 *        TIER=<name> node scripts/verify-reply-tiers.js   (internal child mode)
 */
require('dotenv').config();
const http = require('http');
const path = require('path');
const { execFile } = require('child_process');
const mongoose = require('mongoose');

const CUSTOMER = '8801700000009@c.us';
const CLOUD_ID = process.env.TIER_CLOUD_ID || 'groq/qwen/qwen3.8-27b';
const LOCAL_ID = process.env.TIER_LOCAL_ID || 'qwen2-0.5b-uncensored';
const BOGUS = 'groq/this-model-does-not-exist-anywhere';

const WhatsAppSession = require('../src/models/WhatsAppSession');
const User = require('../src/models/User');
const wppConnectService = require('../src/services/wppConnectService');

/** Child mode: run one inbound message under the given environment and report the answerer. */
async function runOneTier(tier) {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/contentbot');
  const admin = await User.findOne({ email: 'admin@contentbot.local' });
  const name = `${admin._id}_tier_${tier}`;

  await WhatsAppSession.deleteMany({ sessionName: name });
  const session = await WhatsAppSession.create({
    userId: admin._id, sessionName: name, status: 'connected',
    autoReply: true, autoReplyMode: 'always', useMemory: true,
  });

  await wppConnectService.handleIncomingMessage(name, admin._id, {
    from: CUSTOMER, body: 'What are your opening hours?', isGroupMsg: false,
    sender: { pushname: 'Tier Test' },
  }, null);

  const after = await WhatsAppSession.findById(session._id);
  const reply = after.messages.filter(m => m.direction === 'outgoing').pop();
  console.log(JSON.stringify({
    answeredBy: reply ? reply.aiModel : null,
    text: reply ? reply.body.slice(0, 120) : '',
  }));
  await WhatsAppSession.deleteOne({ _id: session._id });
  await mongoose.disconnect();
}

if (process.env.TIER) {
  runOneTier(process.env.TIER).catch((err) => {
    console.error(JSON.stringify({ answeredBy: null, text: `crashed: ${err.message}` }));
    process.exit(1);
  });
  return;
}

// ── Parent mode: one child per tier, with only that tier's pinned id available ──
let pass = 0, fail = 0;
const ok = (m) => { console.log(`  PASS  ${m}`); pass++; };
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const check_then = (m, cond) => cond ? ok(m) : bad(m);

function runTier(tier, env) {
  // Async on purpose: the contentbot tier calls back into this process's stub server, which a
  // synchronous exec would block until the child had already timed out.
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [path.join(__dirname, 'verify-reply-tiers.js')], {
      env: { ...process.env, TIER: tier, ...env },
      encoding: 'utf8',
      timeout: 180000,
    }, (err, stdout) => {
      if (err) return reject(err);
      const line = stdout.trim().split('\n').filter(l => l.startsWith('{')).pop();
      resolve(JSON.parse(line));
    });
  });
}

(async () => {
  console.log('== cloud tier: the pinned id is the id that answers ==');
  let r = await runTier('cloud', { WHATSAPP_AI_MODEL: CLOUD_ID, WHATSAPP_LOCAL_MODEL: LOCAL_ID });
  if (r.answeredBy === CLOUD_ID) ok(`answered by the pinned cloud id`); else bad(`expected ${CLOUD_ID}, got ${r.answeredBy}`);
  console.log(`  reply: ${r.text.replace(/\n/g, ' ')}`);

  console.log('== unverifiable pins are skipped, never swapped ==');
  r = await runTier('bogus-all', {
    WHATSAPP_AI_MODEL: BOGUS, WHATSAPP_LOCAL_MODEL: BOGUS,
    CONTENTBOT_API_URL: '', CONTENTBOT_API_KEY: '',
  });
  if (r.answeredBy === 'fallback-template') ok('no tier could answer, so the holding message is recorded as such');
  else bad(`expected fallback-template, got ${r.answeredBy}`);

  console.log('== local tier: a pinned id is honoured exactly ==');
  r = await runTier('local', { WHATSAPP_AI_MODEL: BOGUS, WHATSAPP_LOCAL_MODEL: LOCAL_ID });
  if (r.answeredBy === `local:${LOCAL_ID}`) ok(`local answered by ${r.answeredBy}`);
  else bad(`expected local:${LOCAL_ID}, got ${r.answeredBy}`);
  console.log(`  reply: ${r.text.replace(/\n/g, ' ')}`);

  console.log('== local tier with no pin: a live chat model answers, named as itself ==');
  r = await runTier('local-unpinned', { WHATSAPP_AI_MODEL: BOGUS, WHATSAPP_LOCAL_MODEL: '' });
  if (/^local:.+/.test(r.answeredBy || '') && !/embed|tts|whisper/i.test(r.answeredBy)) {
    ok(`unpinned local tier answered by ${r.answeredBy}`);
  } else bad(`expected a local chat model, got ${r.answeredBy}`);

  console.log('== a local model LM Studio does not list is refused, not swapped ==');
  r = await runTier('local-bogus', {
    WHATSAPP_AI_MODEL: BOGUS, WHATSAPP_LOCAL_MODEL: 'no-such-local-model',
    CONTENTBOT_API_URL: '', CONTENTBOT_API_KEY: '',
  });
  if (r.answeredBy === 'fallback-template') ok('unlisted local pin did not get served by another model');
  else bad(`expected fallback-template, got ${r.answeredBy}`);

  console.log('== contentbot tier ==');
  // The configured ContentBot endpoint may be down (it is a separate service), so this points
  // the tier at a stub on the same HTTP interface. That is enough to prove the tier sends what
  // it should, authenticates, and records the answer as its own.
  const MARKER = 'stub-answer-from-contentbot';
  let seen = null;
  const stub = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen = { url: req.url, auth: req.headers.authorization || '', body };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ response: MARKER }));
    });
  });
  await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve));
  const port = stub.address().port;

  r = await runTier('contentbot', {
    WHATSAPP_AI_MODEL: BOGUS, WHATSAPP_LOCAL_MODEL: 'no-such-local-model',
    CONTENTBOT_API_URL: `http://127.0.0.1:${port}`,
    CONTENTBOT_API_KEY: 'stub-key',
  });
  if (r.answeredBy === 'contentbot-api') ok('contentbot tier answered and is recorded as such');
  else bad(`expected contentbot-api, got ${r.answeredBy}`);
  check_then('tier 3 posted to <base>/chat', seen?.url === '/chat');
  check_then('tier 3 sent a bearer token', /^Bearer \S+/.test(seen?.auth || ''));
  check_then('tier 3 sent the customer message', /opening hours/i.test(seen?.body || ''));
  check_then('tier 3 sent the business system prompt', /My Business HQ/.test(seen?.body || ''));
  check_then("tier 3 stored the service's own answer", r.text.includes(MARKER));
  await new Promise((resolve) => stub.close(resolve));

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
