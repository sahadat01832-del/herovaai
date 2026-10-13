/**
 * publicUrl — the origin the outside world should use to reach this app.
 *
 * There are two sources of truth and they disagree exactly when it hurts:
 *
 *   • the environment (PUBLIC_URL / BACKEND_URL), which an operator sets for a
 *     real deployment, or which `scripts/public.sh sync` mirrors from the tunnel;
 *   • `logs/public-url.txt`, rewritten by the tunnel unit every time the quick
 *     tunnel comes up with a new hostname.
 *
 * The environment is read once, at boot. A Cloudflare quick tunnel gets a new
 * hostname on every restart, so after a rotation the boot-time copy is a *dead*
 * address — and a dead address in a payment callback, an OAuth redirect URI or a
 * webhook registration fails silently, hours later, somewhere else.
 *
 * So: for quick tunnels the live file wins, and a real domain from the
 * environment always wins.
 */
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
// The tunnel unit owns the first path; the second is kept so a deployment that
// keeps its logs next to the backend still works.
const TUNNEL_FILES = [
  path.join(REPO_ROOT, 'logs', 'public-url.txt'),
  path.join(REPO_ROOT, 'backend', 'logs', 'public-url.txt'),
];

const strip = (value) => String(value || '').trim().replace(/\/+$/, '');
const isQuickTunnel = (url) => /\.trycloudflare\.com$/i.test(String(url || ''));
const isLoopback = (url) => !url || /localhost|127\.0\.0\.1/.test(url);

/** The tunnel unit's current URL, or '' when no record exists yet. */
function tunnelUrl() {
  for (const file of TUNNEL_FILES) {
    try {
      const value = strip(fs.readFileSync(file, 'utf8'));
      if (value) return value;
    } catch (_e) { /* try the next location */ }
  }
  return '';
}

/** The origin to build public links from. Never throws. */
function publicOrigin() {
  const configured = strip(process.env.PUBLIC_URL || process.env.BACKEND_URL);
  if (isLoopback(configured) || isQuickTunnel(configured)) {
    const live = tunnelUrl();
    if (live) return live;
  }
  return configured || `http://localhost:${Number(process.env.PORT) || 5000}`;
}

module.exports = { publicOrigin, tunnelUrl, isQuickTunnel, TUNNEL_FILES };
