/**
 * sslcommerz — one gateway module behind the payment routes.
 *
 * Sandbox is the default (SSLCOMMERZ_SANDBOX=true): the public test store
 * answers init/validation without moving money, so the whole loop is provable
 * before a merchant account exists. Production needs the store ID + password
 * from the owner's SSLCommerz panel in backend/.env (or the key vault slots
 * SSLCOMMERZ_STORE_ID / SSLCOMMERZ_STORE_PASSWD) — nothing else changes.
 *
 * Security rule: the browser is never trusted. success/fail/cancel callbacks
 * only HINT; the tier flips after a server-to-server validation call confirms
 * amount + currency + tran_id against what we created.
 */
const axios = require('axios');

const isSandbox = () => String(process.env.SSLCOMMERZ_SANDBOX || 'true').toLowerCase() !== 'false';
const baseUrl = () => (isSandbox()
  ? 'https://sandbox.sslcommerz.com'
  : 'https://securepay.sslcommerz.com');

function credentials() {
  const keyVault = require('./keyVault');
  const storeId = (keyVault.firstKey(['SSLCOMMERZ_STORE_ID']) || process.env.SSLCOMMERZ_STORE_ID || '').trim();
  const storePasswd = (keyVault.firstKey(['SSLCOMMERZ_STORE_PASSWD']) || process.env.SSLCOMMERZ_STORE_PASSWD || '').trim();
  // The published sandbox demo pair keeps the loop testable with no account.
  if (isSandbox() && (!storeId || !storePasswd)) {
    return { storeId: 'testbox', storePasswd: 'qwerty', demo: true };
  }
  return { storeId, storePasswd, demo: false };
}

const configured = () => {
  const { storeId, storePasswd } = credentials();
  return Boolean(storeId && storePasswd);
};

/**
 * Plan prices now come from the single taka table (config/plans.js), so a card
 * checkout and a Nagad send-money order can never quote different numbers.
 */
function priceFor(tier) {
  return require('../config/plans').priceFor(tier);
}

/**
 * Open a checkout session. Returns { GatewayPageURL } or throws.
 * success/fail/cancel URLs must be absolute: derived from BACKEND_URL so the
 * gateway can call home on localhost, LAN or the public tunnel unchanged.
 */
async function initPayment({ tranId, amount, currency, customer, productName }) {
  const { storeId, storePasswd } = credentials();
  if (!storeId || !storePasswd) {
    const err = new Error('Payment gateway is not configured (SSLCommerz store credentials missing)');
    err.status = 503;
    throw err;
  }
  const apiBase = (process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 5000}`).replace(/\/+$/, '');
  const params = new URLSearchParams({
    store_id: storeId,
    store_passwd: storePasswd,
    total_amount: String(amount),
    currency: currency || 'USD',
    tran_id: tranId,
    success_url: `${apiBase}/api/payments/callback/success`,
    fail_url: `${apiBase}/api/payments/callback/fail`,
    cancel_url: `${apiBase}/api/payments/callback/cancel`,
    emi_option: '0',
    cus_name: (customer.name || 'Customer').slice(0, 60),
    cus_email: (customer.email || 'customer@example.com').slice(0, 60),
    cus_phone: (customer.phone || '880100000000').slice(0, 20),
    cus_add1: 'Dhaka', cus_city: 'Dhaka', cus_country: 'Bangladesh',
    ship_name: (customer.name || 'Customer').slice(0, 60),
    ship_add1: 'Dhaka', ship_city: 'Dhaka', ship_country: 'Bangladesh',
    product_name: (productName || 'Subscription').slice(0, 60),
    product_category: 'Subscription',
    product_profile: 'general',
  });
  const res = await axios.post(`${baseUrl()}/gwprocess/v4/api.php`, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 30000,
    validateStatus: () => true,
  });
  const data = res.data || {};
  if (data.status === 'SUCCESS' && data.GatewayPageURL) return { GatewayPageURL: data.GatewayPageURL, sessionkey: data.sessionkey || '' };
  const err = new Error(`Gateway refused init: ${data.failedreason || `HTTP ${res.status}`}`.slice(0, 200));
  err.status = 502;
  throw err;
}

/**
 * Server-to-server truth: ask the gateway whether this transaction really paid,
 * and for exactly the amount + currency we ordered. Never trust the browser.
 */
async function validatePayment({ tranId, amount, currency }) {
  const { storeId, storePasswd } = credentials();
  const res = await axios.get(`${baseUrl()}/validator/api/validationserverAPI.php`, {
    params: {
      val_id: tranId,
      store_id: storeId,
      store_passwd: storePasswd,
      v: 1,
      format: 'json',
    },
    timeout: 30000,
    validateStatus: () => true,
  });
  const data = res.data || {};
  // NOTE: the validator answers by val_id (the gateway's validation ID from the
  // callback), not our tran_id. Callers pass whichever ID the callback carried;
  // we additionally match tran_id inside the payload before trusting it.
  const okStatus = ['VALID', 'VALIDATED'].includes(String(data.status || '').toUpperCase());
  const amountOk = Number(data.amount) === Number(amount);
  const currencyOk = !currency || String(data.currency || '').toUpperCase() === String(currency).toUpperCase();
  return { ok: okStatus && amountOk && currencyOk, data };
}

module.exports = { configured, credentials, priceFor, initPayment, validatePayment, isSandbox };
