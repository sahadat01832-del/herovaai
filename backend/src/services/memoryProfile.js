/**
 * Business memory → assistant behaviour.
 *
 * One place turns what an owner typed in "AI Memory" into (a) the block of text
 * every model call prepends, (b) a completeness reading for the UI, and (c) a
 * deterministic sample reply so the owner can see the effect before a customer
 * does. Chat and WhatsApp both call in here, so the two surfaces can never
 * drift apart.
 */

const TEXT_LIMITS = {
  ownerName: 120,
  ownerRole: 80,
  businessName: 160,
  businessType: 160,
  businessDescription: 4000,
  policies: 4000,
  guardrails: 4000,
  escalationContact: 200,
  greeting: 600,
  signoff: 300,
  language: 80,
};

const OPERATION_LIMITS = {
  openingHours: 600,
  serviceAreas: 600,
  delivery: 600,
  payment: 600,
  address: 400,
  phone: 80,
  email: 160,
  website: 300,
  bookingLink: 300,
};

const OPERATION_LABELS = {
  openingHours: 'Opening hours',
  serviceAreas: 'Service areas',
  delivery: 'Delivery / pickup',
  payment: 'Payment methods',
  address: 'Address',
  phone: 'Contact phone',
  email: 'Contact email',
  website: 'Website',
  bookingLink: 'Booking link',
};

const CATALOG_LIMITS = { name: 120, price: 120, summary: 300, details: 4000 };
const TONES = ['professional', 'friendly', 'casual', 'formal', 'enthusiastic'];
const REPLY_LENGTHS = ['short', 'balanced', 'detailed'];
const KINDS = ['product', 'service'];

const collapse = (value) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();

function sliceText(value, max) {
  const text = collapse(value);
  return text.length > max ? text.slice(0, max) : text;
}

/* ─────────────────────────────── normalising ───────────────────────────── */

/** Framing words the AI must never be asked to answer with ("Hi." etc.). */
const GENERIC_NAMES = new Set(['business', 'company', 'shop', 'store', 'my business', 'our business', 'n/a', 'na', 'none']);

/**
 * Build a partial `$set` patch from an untrusted body. Unknown keys are dropped
 * and missing keys are left alone, so a form that only edits one field can never
 * blank the rest of the profile.
 */
function normalizeProfile(body = {}) {
  const patch = {};

  if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled);

  for (const [field, max] of Object.entries(TEXT_LIMITS)) {
    if (body[field] !== undefined) patch[field] = sliceText(body[field], max);
  }

  if (body.tone !== undefined && TONES.includes(body.tone)) patch.tone = body.tone;
  if (body.replyLength !== undefined && REPLY_LENGTHS.includes(body.replyLength)) {
    patch.replyLength = body.replyLength;
  }

  if (body.operations && typeof body.operations === 'object') {
    const operations = {};
    for (const [field, max] of Object.entries(OPERATION_LIMITS)) {
      if (body.operations[field] !== undefined) operations[field] = sliceText(body.operations[field], max);
    }
    if (Object.keys(operations).length) patch.operations = operations;
  }

  return patch;
}

function normalizeCatalogItem(body = {}, { partial = false } = {}) {
  const item = {};
  if (!partial || body.kind !== undefined) {
    item.kind = KINDS.includes(body.kind) ? body.kind : 'product';
  }
  for (const [field, max] of Object.entries(CATALOG_LIMITS)) {
    if (!partial || body[field] !== undefined) item[field] = sliceText(body[field], max);
  }
  if (!partial || body.available !== undefined) item.available = body.available === false ? false : true;
  return item;
}

/* ─────────────────────────────── the prompt ────────────────────────────── */

/** Section heading + lines helper. */
const section = (title, lines) => (lines.length ? [`${title}:`, ...lines].join('\n') : '');

/**
 * The block prepended to every model call for this owner.
 * Returns '' when memory is switched off or genuinely empty, which keeps the
 * "optional" promise: no memory, no prompt, no behavioural change.
 */
function promptBlock(memory) {
  if (!memory || memory.enabled === false) return '';

  const businessName = collapse(memory.businessName);
  const ownerName = collapse(memory.ownerName);
  if (!businessName && !ownerName && !(memory.catalog || []).length && !collapse(memory.businessDescription)) {
    return '';
  }

  const lines = [];

  const who = [];
  if (businessName) who.push(`a customer-facing assistant for "${businessName}"`);
  if (ownerName) who.push(`${collapse(memory.ownerRole) || 'the business owner'} is ${ownerName}`);
  if (who.length) lines.push(`You are ${who.join('. ')}.`);

  lines.push(
    'Speak as the business, not as a generic AI. Greet customers the way a helpful member of ' +
    'staff would, and answer only from the facts listed below.'
  );

  if (collapse(memory.businessType)) lines.push(`Business type: ${collapse(memory.businessType)}.`);
  if (collapse(memory.businessDescription)) lines.push(`About the business: ${collapse(memory.businessDescription)}`);

  const catalog = (memory.catalog || []).filter((item) => collapse(item && item.name));
  if (catalog.length) {
    const rows = catalog.map((item) => {
      const bits = [collapse(item.name)];
      if (item.kind === 'service') bits.push('(service)');
      if (collapse(item.price)) bits.push(`— ${collapse(item.price)}`);
      if (item.available === false) bits.push('— currently unavailable');
      const head = `• ${bits.join(' ')}`;
      const tail = [collapse(item.summary), collapse(item.details)].filter(Boolean).join(' ');
      return tail ? `${head}: ${tail}` : head;
    });
    lines.push(section('What the business sells', rows));
  }

  const operations = memory.operations || {};
  const operationLines = Object.entries(OPERATION_LIMITS)
    .map(([field]) => [field, collapse(operations[field])])
    .filter(([, value]) => value)
    .map(([field, value]) => `• ${OPERATION_LABELS[field]}: ${value}`);
  lines.push(section('How the business operates', operationLines));

  const policyLines = [];
  if (collapse(memory.policies)) policyLines.push(`• ${collapse(memory.policies)}`);
  lines.push(section('Policies (returns, warranty, booking rules)', policyLines));

  const entryLines = (memory.entries || [])
    .filter((entry) => collapse(entry && entry.key) && collapse(entry && entry.value))
    .map((entry) => `• ${collapse(entry.key)}: ${collapse(entry.value)}`);
  lines.push(section('Verified facts from the owner', entryLines));

  const rules = [
    '• Never invent prices, stock levels, delivery times, addresses or promises. If a fact is not listed above, say you will confirm with the team rather than guessing.',
    '• If the customer asks for something outside this list — a custom quote, a complaint, a refund, an order change — take their name, phone number and request, confirm you have noted it, and hand it to a human.',
  ];
  if (memory.guardrails) {
    // Split first, collapse each line second — collapsing first would weld the
    // owner's separate rules into one bullet.
    String(memory.guardrails).split(/\r?\n+/).forEach((rule) => {
      const trimmed = collapse(rule);
      if (trimmed) rules.push(`• ${trimmed}`);
    });
  }
  if (collapse(memory.escalationContact)) {
    rules.push(`• Escalate to a human via ${collapse(memory.escalationContact)} when the request needs a decision you cannot make.`);
  }
  rules.push('• Never claim to be a specific AI model or name an AI vendor.');
  lines.push(section('Rules you must never break', rules));

  const voice = [];
  if (collapse(memory.tone)) voice.push(`• Tone: ${collapse(memory.tone)}.`);
  const lengthCopy = { short: 'one or two sentences', balanced: 'under about 80 words', detailed: 'thorough, but still skimmable' };
  voice.push(`• Reply length: ${lengthCopy[memory.replyLength] || lengthCopy.balanced}.`);
  if (collapse(memory.language)) {
    voice.push(`• Default language: ${collapse(memory.language)} — switch to match the customer if they write in another language.`);
  }
  if (collapse(memory.greeting)) voice.push(`• Open with: "${collapse(memory.greeting)}"`);
  if (collapse(memory.signoff)) voice.push(`• Close with: "${collapse(memory.signoff)}"`);
  lines.push(section('How to sound', voice));

  return lines.filter(Boolean).join('\n');
}

/* ──────────────────────────── completeness ────────────────────────────── */

const SECTIONS = [
  {
    id: 'identity',
    label: 'About you',
    hint: 'So the assistant signs off with your name instead of “the team”.',
    checks: [
      ['ownerName', 'Your name'],
      ['businessName', 'Business name'],
      ['businessType', 'What kind of business'],
      ['businessDescription', 'Short description of the business'],
    ],
  },
  {
    id: 'catalog',
    label: 'What you sell',
    hint: 'Prices, packages and the products you want customers to ask about.',
    checks: [],
  },
  {
    id: 'operations',
    label: 'How you run',
    hint: 'The five questions customers ask all day: hours, area, delivery, payment, contact.',
    checks: [
      ['openingHours', 'Opening hours'],
      ['serviceAreas', 'Service areas'],
      ['delivery', 'Delivery or pickup'],
      ['payment', 'Payment methods'],
      ['phone', 'Contact phone'],
    ],
  },
  {
    id: 'rules',
    label: 'Ground rules',
    hint: 'What the assistant must never promise, and who to hand a tricky chat to.',
    checks: [
      ['policies', 'Returns, warranty or booking rules'],
      ['guardrails', 'Things never to promise'],
      ['escalationContact', 'Where to escalate'],
    ],
  },
  {
    id: 'voice',
    label: 'Voice',
    hint: 'Tone, greeting and the language your customers write in.',
    // Tone and language always hold a value (they have defaults), so counting
    // them would report progress the owner never actually made.
    checks: [
      ['greeting', 'Opening line'],
      ['signoff', 'Closing line'],
    ],
  },
];

/**
 * A 0–100 reading of how much the assistant actually knows.
 * Memory is optional, so nothing here blocks anything — it just tells the owner
 * what would make the next customer conversation better.
 */
function completeness(memory) {
  const source = memory || {};
  const operations = source.operations || {};
  const catalog = (source.catalog || []).filter((item) => collapse(item && item.name));

  const readValue = (field) => {
    if (OPERATION_LIMITS[field]) return collapse(operations[field]);
    if (field === 'tone' || field === 'language') return collapse(source[field]);
    return collapse(source[field]);
  };

  const sections = SECTIONS.map((sectionDef) => {
    const items = sectionDef.checks.map(([field, label]) => ({ field, label, done: Boolean(readValue(field)) }));
    if (sectionDef.id === 'catalog') {
      items.push({
        field: 'catalog',
        label: catalog.length ? `${catalog.length} item${catalog.length > 1 ? 's' : ''} listed` : 'Add at least one product or service',
        done: catalog.length > 0,
      });
    }
    const done = items.filter((item) => item.done).length;
    return {
      id: sectionDef.id,
      label: sectionDef.label,
      hint: sectionDef.hint,
      done,
      total: items.length,
      items,
      missing: items.filter((item) => !item.done).map((item) => item.label),
    };
  });

  const total = sections.reduce((sum, s) => sum + s.total, 0);
  const filled = sections.reduce((sum, s) => sum + s.done, 0);

  return {
    optional: true,
    enabled: source.enabled !== false,
    filled,
    total,
    score: total ? Math.round((filled / total) * 100) : 0,
    sections,
  };
}

/* ─────────────────────────── sample reply ─────────────────────────────── */

const firstOf = (list, fallback) => (list.length ? list[0] : fallback);

/** Sentence-join so the sample reads like a real message, not glued fragments. */
const sentence = (text) => {
  const value = collapse(text);
  if (!value) return '';
  return /[.!?…]$/.test(value) ? value : `${value}.`;
};

/**
 * A deterministic example of the assistant's voice, assembled from what is
 * actually saved. No model call, so it updates the instant a field is typed —
 * and it stays honest about missing facts instead of inventing them.
 */
function sampleReply(memory) {
  const source = memory || {};
  const operations = source.operations || {};
  const catalog = (source.catalog || []).filter((item) => collapse(item && item.name));
  if (source.enabled === false) {
    return {
      text: 'Business memory is paused. The assistant answers as a generic helper until you switch it back on.',
      grounded: [],
      missing: [],
    };
  }

  const businessName = collapse(source.businessName) || 'your business';
  const greeting = collapse(source.greeting) || `Hi! Thanks for messaging ${businessName}.`;
  const top = firstOf(catalog, null);

  const body = [];
  if (top) {
    const price = collapse(top.price);
    body.push(`Yes — ${collapse(top.name)}${price ? ` is ${price}` : ''}.`);
    if (collapse(top.summary)) body.push(sentence(top.summary));
  } else {
    body.push(`Tell me which of our ${collapse(source.businessType) || 'products or services'} you are interested in and I will help right away.`);
  }

  if (collapse(operations.openingHours)) body.push(`We are open ${sentence(operations.openingHours)}`);
  if (collapse(operations.delivery)) body.push(sentence(operations.delivery));
  if (collapse(operations.payment)) body.push(`You can pay by ${sentence(operations.payment)}`);

  const signoff = collapse(source.signoff) || 'Anything else I can check for you?';
  const text = [greeting, ...body, signoff].join(' ');

  const grounded = [];
  if (collapse(source.businessName)) grounded.push('business name');
  if (top) grounded.push('products & services');
  if (collapse(operations.openingHours)) grounded.push('opening hours');
  if (collapse(operations.delivery)) grounded.push('delivery');
  if (collapse(operations.payment)) grounded.push('payment');
  if (collapse(source.tone)) grounded.push(`${collapse(source.tone)} tone`);

  const missing = [];
  if (!top) missing.push('products or services');
  if (!collapse(operations.openingHours)) missing.push('opening hours');
  if (!collapse(operations.delivery)) missing.push('delivery details');
  if (!collapse(operations.payment)) missing.push('payment methods');
  if (!collapse(source.guardrails)) missing.push('ground rules');

  return { text, grounded, missing };
}

module.exports = {
  TONES,
  REPLY_LENGTHS,
  KINDS,
  OPERATION_LIMITS,
  OPERATION_LABELS,
  CATALOG_LIMITS,
  GENERIC_NAMES,
  normalizeProfile,
  normalizeCatalogItem,
  promptBlock,
  completeness,
  sampleReply,
};
