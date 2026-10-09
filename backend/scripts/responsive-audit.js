/**
 * Responsive audit.
 *
 * Walks every page a real session can reach at three widths and reports any
 * element that pushes the document wider than the viewport — the thing that
 * makes a phone show a sideways scrollbar. Run it with a live server:
 *
 *   node scripts/responsive-audit.js [email] [password]
 */
const puppeteer = require('puppeteer');

const BASE = process.env.AUDIT_BASE || 'http://localhost:3001';
const API = process.env.AUDIT_API || 'http://localhost:5000/api';

const PAGES = [
  ['landing', '/'],
  ['login', '/login'],
  ['register', '/register'],
  ['dashboard', '/dashboard'],
  ['chat', '/dashboard/chat'],
  ['memory', '/dashboard/memory'],
  ['whatsapp', '/dashboard/whatsapp'],
  ['subscription', '/dashboard/subscription'],
  ['settings', '/dashboard/settings'],
  ['admin-users', '/dashboard/admin/users'],
  ['admin-keys', '/dashboard/admin/api-keys'],
  ['admin-chats', '/dashboard/admin/chats'],
];

const DEFAULT_WIDTHS = [
  ['phone', 360, 740],
  ['phone-large', 414, 780],
  ['tablet', 768, 1024],
  ['laptop', 1280, 800],
  ['desktop', 1600, 900],
];

/**
 * `AUDIT_WIDTHS="label:WxH,label:WxH"` replaces the default list, so a single
 * run can sweep the extremes (a 320px phone, a 2560px monitor) without editing
 * this file. Bad entries are reported rather than silently ignored.
 */
function widths() {
  const raw = (process.env.AUDIT_WIDTHS || '').trim();
  if (!raw) return DEFAULT_WIDTHS;
  const parsed = [];
  for (const entry of raw.split(',')) {
    const [label, size] = entry.split(':').map((part) => (part || '').trim());
    const [width, height] = (size || '').split('x').map((part) => Number.parseInt(part, 10));
    if (!label || !Number.isFinite(width) || !Number.isFinite(height)) {
      console.warn(`skipping unreadable AUDIT_WIDTHS entry: "${entry}"`);
      continue;
    }
    parsed.push([label, width, height]);
  }
  return parsed.length ? parsed : DEFAULT_WIDTHS;
}

async function login(email, password) {
  const response = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await response.json();
  if (!data.token) throw new Error(`login failed: ${JSON.stringify(data).slice(0, 200)}`);
  return data.token;
}

/** Runs inside the page: find the widest offenders. */
function collectOverflow() {
  const viewport = window.innerWidth;
  const docWidth = document.documentElement.scrollWidth;
  const offenders = [];
  for (const element of document.querySelectorAll('body *')) {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    const style = getComputedStyle(element);
    if (style.position === 'fixed') continue;
    // An element wider than the viewport is only a bug when nothing clips it. A
    // child of an overflow-x:auto strip is supposed to sit past the edge.
    let clipped = false;
    for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      const parentOverflow = getComputedStyle(parent).overflowX;
      if (parentOverflow !== 'visible') { clipped = true; break; }
    }

    const overflowsRight = !clipped && rect.right > viewport + 1.5;
    const scrollsSideways = element.scrollWidth > element.clientWidth + 2 &&
      ['auto', 'scroll'].includes(style.overflowX);
    if (overflowsRight || scrollsSideways) {
      offenders.push({
        tag: element.tagName.toLowerCase(),
        cls: String(element.className || '').slice(0, 90),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
        overflowX: style.overflowX,
        reason: overflowsRight ? 'past-viewport' : 'inner-scroll',
      });
    }
  }
  return { docWidth, viewport, overflows: docWidth > viewport + 1, offenders: offenders.slice(0, 6) };
}

(async () => {
  const email = process.argv[2] || process.env.AUDIT_EMAIL;
  const password = process.argv[3] || process.env.AUDIT_PASSWORD;
  if (!email || !password) {
    console.error('usage: node scripts/responsive-audit.js <email> <password>');
    process.exit(2);
  }

  const token = await login(email, password);
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.CHROME_PATH || '/usr/bin/brave-browser',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  const problems = [];
  try {
    for (const [label, width, height] of widths()) {
      const page = await browser.newPage();
      await page.setViewport({ width, height, deviceScaleFactor: 1 });
      page.on('pageerror', (error) => problems.push({ type: 'js-error', label, message: String(error).slice(0, 200) }));
      await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
      await page.evaluate((value) => localStorage.setItem('token', value), token);

      for (const [name, path] of PAGES) {
        await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 45000 });
        await new Promise((resolve) => setTimeout(resolve, 700));
        const result = await page.evaluate(collectOverflow);
        const line = `${label.padEnd(12)} ${name.padEnd(13)} doc=${String(result.docWidth).padEnd(5)} vp=${result.viewport}`;
        if (result.overflows) {
          problems.push({ type: 'overflow', label, page: name, docWidth: result.docWidth, viewport: result.viewport, offenders: result.offenders });
          console.log(`✗ ${line}`);
          for (const offender of result.offenders) {
            console.log(`      ${offender.reason} <${offender.tag}> right=${offender.right} w=${offender.width} overflowX=${offender.overflowX} .${offender.cls}`);
          }
        } else {
          console.log(`✓ ${line}`);
        }
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }

  const overflows = problems.filter((p) => p.type === 'overflow');
  const errors = problems.filter((p) => p.type === 'js-error');
  console.log(`\n${overflows.length} page/width combination(s) overflow, ${errors.length} JS error(s).`);
  for (const error of errors) console.log(`  js-error [${error.label}] ${error.message}`);
  process.exit(overflows.length || errors.length ? 1 : 0);
})();
