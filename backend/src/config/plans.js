/**
 * plans — the three HerovaAi plans, priced in taka.
 *
 * One table for the whole app: the dashboard renders whatever is in here, the
 * checkout charges it, and the token quota that comes with a plan is applied
 * from here too. Prices are overridable from the environment so the owner can
 * re-price without a deploy, but the *server* always reads the number from here
 * — a browser can never name its own price.
 *
 *   free        ৳0      — 1,000,000 cloud tokens per 7 days
 *   pro         ৳100/mo — 2,000,000 cloud tokens per 7 days
 *   enterprise  ৳300/mo — 5,000,000 cloud tokens per 7 days
 */

const CURRENCY = 'BDT';

const PLANS = [
  {
    id: 'free',
    name: 'Free',
    bdt: 0,
    period: 'forever',
    tokens: 1000000,
    blurb: 'Everyday chatting, WhatsApp automation and the standard cloud models.',
    features: [
      'Local on-device models — free and unmetered',
      '1,000,000 cloud tokens per 7 days',
      'WhatsApp assistant with business memory',
      'Channel connections: Messenger, Facebook, Telegram',
      'Memory released automatically when idle',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    bdt: 100,
    period: 'per month',
    tokens: 2000000,
    popular: true,
    blurb: 'Heavier throughput, larger local models and daily auto-posting.',
    features: [
      'Larger local models (3B – 26B)',
      '2,000,000 cloud tokens per 7 days',
      'Daily auto-post to Facebook, Instagram and Telegram',
      'AI auto-reply on Messenger, Instagram, Telegram and WhatsApp',
      'Gemini+ multimodal: images, video, documents',
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    bdt: 300,
    period: 'per month',
    tokens: 5000000,
    blurb: 'For high-volume operations and multi-number, multi-channel setups.',
    features: [
      '5,000,000 cloud tokens per 7 days',
      'Frontier models: GPT-4o, Claude, Gemini Pro',
      'Multiple WhatsApp numbers + YouTube / Google channels',
      'Unlimited memory entries, personas and post topics',
      'Priority replies and admin quota controls',
    ],
  },
];

const BY_ID = PLANS.reduce((acc, plan) => { acc[plan.id] = plan; return acc; }, {});

/** Env override name per tier, so a price change is a restart, not a commit. */
const ENV_PRICE = { pro: 'PAYMENT_PRO_BDT', enterprise: 'PAYMENT_ENTERPRISE_BDT' };

/** Amount in taka for a tier. Always a whole number (Nagad has no paisa flow). */
function priceFor(tier) {
  const plan = BY_ID[tier];
  if (!plan) return 0;
  const override = Number(process.env[ENV_PRICE[tier]]);
  return Number.isFinite(override) && override > 0 ? Math.round(override) : plan.bdt;
}

/** The plan table as the client sees it (no secrets, no internals). */
function publicPlans() {
  return PLANS.map((plan) => ({ ...plan, bdt: priceFor(plan.id) }));
}

/** Token allowance that a plan buys. */
function quotaFor(tier) {
  return BY_ID[tier]?.tokens || BY_ID.free.tokens;
}

const isPaidTier = (tier) => tier === 'pro' || tier === 'enterprise';

module.exports = { CURRENCY, PLANS, publicPlans, priceFor, quotaFor, isPaidTier, plan: (id) => BY_ID[id] || null };
