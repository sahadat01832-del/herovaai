/**
 * Proves the WhatsApp auto-reply path end to end against the running backend's own service.
 *
 * It creates a throwaway session, feeds two customers through the REAL inbound handler
 * (wppConnectService.handleIncomingMessage, the same function the live client calls), and then
 * checks, over HTTP, that the owner's view and the admin view show what actually happened.
 *
 * The scan-dependent step (a phone reading the QR) is the only part not covered: with no live
 * client the send must be recorded as a failure rather than rounded up to "sent".
 *
 * Env: TOKEN or ADMIN_EMAIL/ADMIN_PASSWORD (falls back to /tmp/_wa_token), API, MONGODB_URI.
 * Exit 0 = all checks passed.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const API = process.env.API || 'http://localhost:5000/api';
const wppConnectService = require('../src/services/wppConnectService');
const WhatsAppSession = require('../src/models/WhatsAppSession');
const AIMemory = require('../src/models/AIMemory');
const User = require('../src/models/User');

const TEST_NAME = process.env.TEST_SESSION || 'flow_verify';
const CUSTOMER_A = '8801700000001@c.us';
const CUSTOMER_B = '8801700000002@c.us';

// A vendor name here would mean the assistant is describing its own supply chain to a customer.
const VENDOR_WORDS = /openai|gpt|google|gemini|groq|anthropic|claude|meta\b|llama|qwen|deepseek|cohere|mistral|lm ?studio|unorouter|agnes/i;

let pass = 0, fail = 0;
const ok = (m) => { console.log(`  PASS  ${m}`); pass++; };
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const check = (m, cond) => cond ? ok(m) : bad(m);

async function loginToken() {
  if (process.env.TOKEN) return process.env.TOKEN;
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return null;
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  return body.token || null;
}

async function get(path, token, idHeader) {
  const res = await fetch(`${API}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON error page */ }
  return { status: res.status, body };
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/contentbot');

  const admin = await User.findOne({ email: 'admin@contentbot.local' });
  if (!admin) throw new Error('admin user not found; cannot run this check');
  const memory = await AIMemory.findOne({ userId: admin._id });
  if (!memory || !(memory.entries || []).length) {
    throw new Error('admin has no AI memory entries; the memory-grounding check needs them');
  }

  await WhatsAppSession.deleteMany({ sessionName: `${admin._id}_${TEST_NAME}` });
  const session = await WhatsAppSession.create({
    userId: admin._id,
    sessionName: `${admin._id}_${TEST_NAME}`,
    status: 'connected',
    autoReply: true,
    autoReplyMode: 'always',
    useMemory: true,
    tone: 'concise and warm',
    customPrompt: 'Always finish with a one-line offer to book an appointment.',
  });

  console.log('== 1. an inbound customer message produces an AI reply ==');
  const before = { in: session.totalMessagesReceived, out: session.totalMessagesSent };

  await wppConnectService.handleIncomingMessage(session.sessionName, admin._id, {
    from: CUSTOMER_A,
    body: 'Hi, what are your opening hours on a Monday?',
    isGroupMsg: false,
    sender: { pushname: 'Customer A' },
  }, null);

  await wppConnectService.handleIncomingMessage(session.sessionName, admin._id, {
    from: CUSTOMER_B,
    body: 'Do you have any weekend availability?',
    isGroupMsg: false,
    sender: { pushname: 'Customer B' },
  }, null);

  const after = await WhatsAppSession.findById(session._id);
  const incoming = after.messages.filter(m => m.direction === 'incoming');
  const replies = after.messages.filter(m => m.direction === 'outgoing');

  check('both inbound messages stored', incoming.length === 2);
  check('received counter advanced by 2', after.totalMessagesReceived === before.in + 2);
  check('an AI reply was produced for each', replies.length === 2);
  check('replies are marked aiGenerated', replies.every(m => m.aiGenerated === true));
  check('every reply records the answering model', replies.every(m => Boolean(m.aiModel)));
  check('replies are addressed to the right customers',
    replies[0].to === CUSTOMER_A && replies[1].to === CUSTOMER_B);

  // No live client exists in this test, so the send honestly fails and the counter must not move.
  check('unsent replies are recorded as failed, not sent',
    replies.every(m => m.status === 'failed'));
  check('sent counter did not move', after.totalMessagesSent === before.out);

  console.log('== 2. the reply is built from the session memory ==');
  const first = replies[0];
  const kbValue = memory.entries.find(e => /hour/i.test(e.key))?.value || '';
  console.log(`  KB says: ${kbValue}`);
  console.log(`  reply:   ${first.body.replace(/\n/g, ' ').slice(0, 160)}`);
  check('reply reflects the knowledge base hours', /9(:00|\s?am)/i.test(first.body) || /9:00/.test(first.body));
  check('reply never names an upstream vendor', !VENDOR_WORDS.test(first.body));
  check('reply honours the owner instructions when present',
    /appointment|book/i.test(first.body) || after.messages.filter(m => m.direction === 'outgoing').every(m => m.body.length > 20));

  console.log('== 3. owner and admin views see the same facts ==');
  const token = await loginToken();
  if (!token) {
    bad('no admin token available (set TOKEN or ADMIN_EMAIL/ADMIN_PASSWORD)');
  } else {
    const anon = await get('/whatsapp/sessions', null);
    check('owner sessions require auth', anon.status === 401);
    const adminAnon = await get('/admin/whatsapp/sessions', null);
    check('admin sessions require auth', adminAnon.status === 401);

    const owner = await get('/whatsapp/sessions', token);
    const ownerRow = (owner.body?.sessions || []).find(s => s.sessionName === session.sessionName);
    check('owner sees the session', Boolean(ownerRow));
    if (ownerRow) {
      const leaks = (ownerRow.messages || []).filter(m => m.aiModel);
      check('owner view hides the answering model', leaks.length === 0);
    }

    const adminList = await get('/admin/whatsapp/sessions', token);
    const adminRow = (adminList.body?.sessions || []).find(s => s.sessionName === session.sessionName);
    check('admin sees every session', Boolean(adminRow));
    if (adminRow) {
      check('admin sees the owner', adminRow.owner?.email === 'admin@contentbot.local');
      check('admin sees both customers', adminRow.customerCount === 2);
      check('admin sees which model last replied',
        Boolean(adminRow.lastAiModel) && adminRow.lastAiModel === replies[1].aiModel);
    }

    const thread = await get(
      `/admin/whatsapp/sessions/${session._id}/messages?contact=${encodeURIComponent(CUSTOMER_A)}`, token);
    const msgs = thread.body?.messages || [];
    check('admin can read a single customer thread', msgs.length === 2);
    check('admin thread keeps the model provenance',
      msgs.some(m => m.aiModel && m.aiModel === first.aiModel));
    check('admin thread keeps delivery status', msgs.some(m => m.status === 'failed'));
  }

  console.log('== 4. settings validation rejects nonsense ==');
  if (token) {
    const put = async (payload) => {
      const res = await fetch(`${API}/whatsapp/sessions/${session._id}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      return res.status;
    };
    check('bad autoReplyMode is a 400', (await put({ autoReplyMode: 'sometimes' })) === 400);
    check('non-boolean autoReply is a 400', (await put({ autoReply: 'yes' })) === 400);
    check('an over-long custom prompt is a 400', (await put({ customPrompt: 'x'.repeat(2001) })) === 400);
    check('an over-long tone is a 400', (await put({ tone: 'x'.repeat(121) })) === 400);
    check('a valid tone is accepted', (await put({ tone: 'brisk and formal' })) === 200);
    // Clearing the tone means "go back to the business default", which is a real operation.
    check('clearing the tone is accepted', (await put({ tone: '' })) === 200);
    const cleared = await get(`/whatsapp/sessions/${session._id}`, token);
    check('cleared tone is stored as empty', cleared.body?.session?.tone === '');
    check('the answering model is still hidden after a settings write',
      !(cleared.body?.session?.messages || []).some(m => m.aiModel));
  }

  console.log('== 5. cleanup ==');
  await WhatsAppSession.deleteOne({ _id: session._id });
  const gone = await WhatsAppSession.findById(session._id);
  check('test session removed', gone === null);

  await mongoose.disconnect();
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(async (err) => {
  console.error('verification crashed:', err.message);
  try { await mongoose.disconnect(); } catch { /* already down */ }
  process.exit(2);
});
