/**
 * nagad — the taka gateway, and an honest answer to "can Nagad verify itself?".
 *
 * Short version: Nagad only verifies a payment automatically if the money
 * arrives through a Nagad *merchant* account (their Payment Gateway). A personal
 * Nagad number — the "Send Money" everyone uses — has no API at all: Nagad tells
 * the receiver by SMS and nothing else, so no server can prove a payment.
 *
 * This module therefore runs two modes and says which one is live:
 *
 *   1. manual (always available)
 *      The buyer sends money to the wallet in NAGAD_MERCHANT_NUMBER, then types
 *      the TrxID from the Nagad SMS plus the number they sent from. The order
 *      parks in `awaiting_review` and the owner/admin approves it from the
 *      dashboard. Everything here is testable without any Nagad account.
 *
 *   2. auto (when merchant credentials exist)
 *      With a Nagad merchant (MFS) account and the RSA key pair Nagad issues,
 *      checkout is created through Nagad's Payment Gateway and confirmed
 *      server-to-server by `verifyPayment()` — no human in the loop. Turn it on
 *      by adding NAGAD_MERCHANT_ID, NAGAD_MERCHANT_PRIVATE_KEY and
 *      NAGAD_PGW_PUBLIC_KEY (backend/.env or the admin key vault) and setting
 *      NAGAD_AUTO_VERIFY=true.
 *
 * Nothing here trusts the browser: the amount always comes from config/plans.js,
 * and the tier only changes after this module or a reviewer says the money is
 * really in.
 */
const crypto = require('crypto');
const axios = require('axios');

const CURRENCY_CODE_BDT = '050';
const TRX_RE = /^[A-Za-z0-9]{6,24}$/;
const MSISDN_RE = /^01[3-9]\d{8}$/; // Bangladeshi mobile, 11 digits

/* ─────────────────────────────── config ────────────────────────────────── */

function slot(name) {
  try {
    const keyVault = require('./keyVault');
    return String(keyVault.firstKey([name]) || '').trim();
  } catch (_e) {
    return '';
  }
}

const read = (name) => slot(name) || String(process.env[name] || '').trim();

/** Dashboard-editable values (wallet number, holder, auto switch). */
function stored() {
  try {
    return require('./appSettings').get(require('./appSettings').NAGAD) || {};
  } catch (_e) {
    return {};
  }
}

function config() {
  const s = stored();
  const envWallet = read('NAGAD_MERCHANT_NUMBER');
  const envAuto = read('NAGAD_AUTO_VERIFY');
  return {
    merchantId: read('NAGAD_MERCHANT_ID'),
    merchantPrivateKey: read('NAGAD_MERCHANT_PRIVATE_KEY').replace(/\\n/g, '\n'),
    pgwPublicKey: read('NAGAD_PGW_PUBLIC_KEY').replace(/\\n/g, '\n'),
    // The wallet buyers send money to: env wins (deploys), dashboard fills the gap.
    wallet: envWallet || String(s.wallet || '').trim(),
    holder: read('NAGAD_MERCHANT_NAME') || String(s.holder || '').trim() || 'HerovaAi',
    // Automatic confirmation needs the switcher on AND merchant keys present.
    autoFlag: (envAuto ? envAuto.toLowerCase() !== 'false' : s.autoVerify !== false),
    sandbox: String(read('NAGAD_SANDBOX') || 'false').toLowerCase() === 'true',
    baseUrl: read('NAGAD_BASE_URL'),
    note: String(s.note || '').trim(),
  };
}

/** Merchant credentials present AND the owner wants automatic confirmation. */
function autoReady() {
  const c = config();
  return Boolean(c.autoFlag && c.merchantId && c.merchantPrivateKey && c.pgwPublicKey);
}

function baseUrl() {
  const c = config();
  if (c.baseUrl) return c.baseUrl.replace(/\/+$/, '');
  return c.sandbox
    ? 'http://sandbox.mynagad.com:10080/remote-payment-gateway-1.0'
    : 'https://api.mynagad.com';
}

/**
 * What the checkout screen shows. `auto` tells the UI whether a payment can be
 * confirmed without a human, and `reason` explains it in one line so nobody has
 * to read this file to understand what happened to their money.
 */
function mode() {
  const c = config();
  if (autoReady()) {
    return {
      auto: true,
      manual: true,
      wallet: c.wallet,
      holder: c.holder,
      reason: 'Nagad merchant verification is on: the server confirms your payment itself.',
    };
  }
  const missing = [];
  if (!c.merchantId) missing.push('merchant id');
  if (!c.merchantPrivateKey) missing.push('merchant private key');
  if (!c.pgwPublicKey) missing.push('Nagad public key');
  return {
    auto: false,
    manual: Boolean(c.wallet),
    wallet: c.wallet,
    holder: c.holder,
    reason: c.wallet
      ? `Send money to the Nagad number above, then paste the TrxID — a person confirms it within a few minutes${missing.length ? ` (automatic checking needs the Nagad merchant ${missing.join(', ')})` : ''}.`
      : 'The owner has not published a Nagad number yet, so Nagad cannot be offered right now.',
  };
}

/* ──────────────────────────── validation ───────────────────────────────── */

/** Trim what buyers paste from an SMS: spaces, dashes, the word "TrxID". */
function normalizeTrxId(value) {
  return String(value || '')
    .replace(/\s|\u00a0|-/g, '')
    .replace(/^(trxid|trx|txn|transaction)no?[:#]?/i, '')
    .trim()
    .toUpperCase();
}

/** Accept the local formats people type: 01712345678, +8801712345678, 8801712345678. */
function normalizeMsisdn(value) {
  const digits = String(value || '').replace(/[^\d]/g, '');
  if (digits.length === 14 && digits.startsWith('8801')) return `0${digits.slice(3)}`;
  if (digits.length === 13 && digits.startsWith('8801')) return `0${digits.slice(3)}`;
  if (digits.length === 12 && digits.startsWith('8801')) return `0${digits.slice(3)}`;
  return digits;
}

/**
 * Check the two things a buyer types. Returns {ok, message, trxId, senderNumber}
 * — the route stores exactly these normalised values, so a duplicate TrxID can
 * never be re-typed in a different shape and slip through.
 */
function validateEvidence({ trxId, senderNumber }) {
  const cleanTrx = normalizeTrxId(trxId);
  const cleanMsisdn = normalizeMsisdn(senderNumber);

  if (!cleanTrx) {
    return { ok: false, message: 'Paste the TrxID from the Nagad SMS (for example 7A9F2C1B4D).' };
  }
  if (!TRX_RE.test(cleanTrx)) {
    return { ok: false, message: 'That TrxID looks wrong — Nagad TrxIDs are 6–24 letters and digits with no spaces.' };
  }
  if (!cleanMsisdn) {
    return { ok: false, message: 'Enter the Nagad number you sent the money from.' };
  }
  if (!MSISDN_RE.test(cleanMsisdn)) {
    return { ok: false, message: 'Enter the 11-digit Nagad number you paid from, for example 01712345678.' };
  }
  return { ok: true, message: '', trxId: cleanTrx, senderNumber: cleanMsisdn };
}

/* ───────────────────────── payment gateway (auto) ──────────────────────── */

const dp = (value) => (value ? String(value).replace(/\\n/g, '\n') : '');

/** RSA sign (SHA-256) of the sensitive payload, base64 — Nagad's `signature`. */
function sign(payload, privateKeyPem) {
  return crypto.createSign('RSA-SHA256').update(payload).sign(dp(privateKeyPem), 'base64');
}

/** RSA encrypt the sensitive JSON with the recipient's public key, base64. */
function encrypt(plain, publicKeyPem) {
  return crypto.publicEncrypt(
    { key: dp(publicKeyPem), padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(plain, 'utf8'),
  ).toString('base64');
}

/** Decrypt what Nagad encrypted with our public key. */
function decrypt(cipher, privateKeyPem) {
  return crypto.privateDecrypt(
    { key: dp(privateKeyPem), padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(String(cipher || ''), 'base64'),
  ).toString('utf8');
}

function stamp(date = new Date()) {
  const two = (n) => String(n).padStart(2, '0');
  return [
    date.getFullYear(), two(date.getMonth() + 1), two(date.getDate()),
    two(date.getHours()), two(date.getMinutes()), two(date.getSeconds()),
  ].join('');
}

function unwrapSensitive(data, privateKeyPem) {
  if (!data) return {};
  if (typeof data === 'object' && !data.sensitiveData) return data;
  try {
    return JSON.parse(decrypt(data.sensitiveData, privateKeyPem));
  } catch (_e) {
    return {};
  }
}

/**
 * Create a Nagad Payment Gateway checkout and return where to send the buyer.
 * `orderId` is our own tranId; `callbackUrl` is the absolute URL Nagad posts the
 * result back to (our /api/payments/nagad/callback route).
 */
async function createCheckout({ orderId, amount, callbackUrl }) {
  if (!autoReady()) {
    const err = new Error('Nagad automatic checkout is not configured (merchant id / keys missing)');
    err.status = 503;
    throw err;
  }
  const c = config();
  const headers = {
    'Content-Type': 'application/json',
    'X-KM-Api-Version': 'v-0.2.0',
    'X-KM-Client-Type': 'PC_WEB',
    'X-KM-IP-V4': '127.0.0.1',
  };

  // Step 1 — initialise: we send our order details encrypted to Nagad.
  const initSensitive = {
    merchantId: c.merchantId,
    datetime: stamp(),
    orderId,
    currencyCode: CURRENCY_CODE_BDT,
    amount: String(Math.round(amount)),
    challenge: crypto.randomBytes(20).toString('hex'),
  };
  const initPayload = encrypt(JSON.stringify(initSensitive), c.pgwPublicKey);
  const initRes = await axios.post(
    `${baseUrl()}/api/dfs/check-out/initialize/${encodeURIComponent(c.merchantId)}/${encodeURIComponent(orderId)}`,
    { dateTime: stamp(), sensitiveData: initPayload, signature: sign(initPayload, c.merchantPrivateKey) },
    { headers, timeout: 30000, validateStatus: () => true },
  );
  const initData = initRes.data || {};
  if (initRes.status >= 300 || !initData.sensitiveData) {
    const err = new Error(`Nagad refused the order${initData.message ? `: ${initData.message}` : ''}`);
    err.status = 502;
    err.payload = initData;
    throw err;
  }
  const initPlain = unwrapSensitive(initData, c.merchantPrivateKey);
  const paymentReferenceId = initPlain.paymentReferenceId;
  if (!paymentReferenceId) {
    const err = new Error('Nagad did not return a payment reference');
    err.status = 502;
    err.payload = initData;
    throw err;
  }

  // Step 2 — complete: confirms the amount and hands back the gateway page.
  const completeSensitive = {
    merchantId: c.merchantId,
    orderId,
    currencyCode: CURRENCY_CODE_BDT,
    amount: String(Math.round(amount)),
  };
  const completePayload = encrypt(JSON.stringify(completeSensitive), c.pgwPublicKey);
  const completeRes = await axios.post(
    `${baseUrl()}/api/dfs/check-out/complete/${encodeURIComponent(paymentReferenceId)}`,
    {
      sensitiveData: completePayload,
      signature: sign(completePayload, c.merchantPrivateKey),
      merchantCallbackUrl: callbackUrl,
    },
    { headers, timeout: 30000, validateStatus: () => true },
  );
  const completeData = completeRes.data || {};
  if (completeRes.status >= 300 || !completeData.callBackUrl) {
    const err = new Error(`Nagad would not open a checkout page${completeData.message ? `: ${completeData.message}` : ''}`);
    err.status = 502;
    err.payload = completeData;
    throw err;
  }
  return { redirectUrl: completeData.callBackUrl, paymentRefId: paymentReferenceId };
}

/**
 * Server-to-server truth for one Nagad payment. Returns
 * { ok, status, amount, issuerRef, raw } — `ok` means Nagad itself says the
 * money is in, which is the only thing we ever treat as paid.
 */
async function verifyPayment({ paymentRefId, orderId }) {
  if (!autoReady()) return { ok: false, status: 'unconfigured', raw: null };
  const c = config();
  const sensitive = {
    merchantId: c.merchantId,
    orderId,
    ...(paymentRefId ? { paymentRefId } : {}),
  };
  const payload = encrypt(JSON.stringify(sensitive), c.pgwPublicKey);
  const res = await axios.post(
    `${baseUrl()}/api/dfs/verify/payment/${encodeURIComponent(paymentRefId || orderId)}`,
    { sensitiveData: payload, signature: sign(payload, c.merchantPrivateKey) },
    {
      headers: { 'Content-Type': 'application/json', 'X-KM-Api-Version': 'v-0.2.0', 'X-KM-Client-Type': 'PC_WEB' },
      timeout: 30000,
      validateStatus: () => true,
    },
  );
  const data = unwrapSensitive(res.data || {}, c.merchantPrivateKey);
  const status = String(data.status || '').toLowerCase();
  return {
    ok: status === 'success' || status === 'successfull' || status === 'successful',
    status: data.status || `http ${res.status}`,
    amount: data.amount != null ? Number(data.amount) : null,
    issuerRef: data.issuerPaymentRefNo || data.issuerPaymentRefId || '',
    raw: data,
  };
}

module.exports = {
  mode,
  autoReady,
  config,
  validateEvidence,
  normalizeTrxId,
  normalizeMsisdn,
  createCheckout,
  verifyPayment,
  TRX_RE,
  MSISDN_RE,
};
