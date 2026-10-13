#!/usr/bin/env node
/**
 * HerovaAi gateway — one public origin for the whole app.
 *
 * Why this exists: the browser can only reach what the tunnel publishes. Pointing
 * the tunnel at the frontend alone leaves every `hostname:5000/api` call dead, and
 * publishing a second hostname for the API means CORS, two URLs to register with
 * Google, and NEXT_PUBLIC_* values that are frozen at build time.
 *
 * So: one port, one origin.
 *
 *   /            → Next.js      (WEB_PORT, default 3003)
 *   /api/...     → Express API  (API_PORT, default 5000)
 *   /socket.io/* → Express API  (WebSocket upgrade included)
 *   /studio/*    → WhatsApp Automation Studio (STUDIO_PORT, default 3002;
 *                  the /studio prefix is stripped before proxying)
 *
 * Zero dependencies on purpose — nothing to install on the box that serves it.
 */

const http = require('http');
const net = require('net');

const PORT = Number(process.env.GATEWAY_PORT || 8088);
const HOST = process.env.GATEWAY_HOST || '127.0.0.1';

const WEB = { name: 'web', host: '127.0.0.1', port: Number(process.env.WEB_PORT || 3003) };
const API = { name: 'api', host: '127.0.0.1', port: Number(process.env.API_PORT || 5000) };
const STUDIO = { name: 'studio', host: '127.0.0.1', port: Number(process.env.STUDIO_PORT || 3002) };

/** Paths that belong to the backend. Everything else is the frontend. */
const API_PREFIXES = (process.env.API_PREFIXES || '/api,/socket.io')
  .split(',')
  .map((p) => p.trim())
  .filter(Boolean);

/**
 * Decide where a request goes. Returns the target AND the path to send upstream
 * (they differ for /studio, whose prefix is stripped before proxying).
 *
 *   /api, /socket.io   → Express API   (path unchanged)
 *   /studio, /studio/* → Studio        (prefix stripped: /studio/x → /x)
 *   everything else    → Next.js       (path unchanged)
 *
 * `/studio` without a trailing slash 302s to `/studio/` so the Studio's
 * root-relative assets (css/, js/, uploads/) resolve under the prefix.
 */
function route(url = '') {
  const path = url.split('?')[0];
  if (API_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) {
    return { target: API, url };
  }
  if (path === '/studio' || path.startsWith('/studio/')) {
    const rest = path === '/studio' ? '/' : path.slice('/studio'.length);
    const query = url.slice(path.length); // keep ?query intact
    if (path === '/studio') {
      return { target: STUDIO, url: `/`, redirect: '/studio/' + query };
    }
    return { target: STUDIO, url: rest + query };
  }
  return { target: WEB, url };
}

/** Headers the app behind the proxy should see. */
function forwardedHeaders(req, target) {
  const headers = { ...req.headers };
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const existing = (req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  headers['x-forwarded-for'] = [...existing, req.socket.remoteAddress || ''].filter(Boolean).join(', ');
  headers['x-forwarded-proto'] = proto;
  headers['x-forwarded-host'] = req.headers.host || '';
  headers['x-forwarded-uri'] = req.url || '/';
  headers['x-real-ip'] = req.socket.remoteAddress || '';
  // Keep the original Host so both apps build absolute URLs for the address the
  // visitor actually typed, not for 127.0.0.1.
  headers.host = req.headers.host || `${target.host}:${target.port}`;
  return headers;
}

function handle(req, res) {
  const { target, url, redirect } = route(req.url || '/');

  if (redirect) {
    res.writeHead(302, { location: redirect });
    return res.end();
  }

  if (req.url === '/_gateway/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({
      ok: true,
      web: `${WEB.host}:${WEB.port}`,
      api: `${API.host}:${API.port}`,
      studio: `${STUDIO.host}:${STUDIO.port}`,
      prefixes: API_PREFIXES,
    }));
  }

  const proxyReq = http.request({
    host: target.host,
    port: target.port,
    method: req.method,
    path: url,
    headers: forwardedHeaders(req, target),
  });

  // Streaming replies (chat tokens, SSE) must not be cut off or buffered.
  proxyReq.setTimeout(0);
  res.setTimeout(0);
  req.setTimeout(0);

  proxyReq.on('response', (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    if (res.headersSent) return res.destroy();
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      success: false,
      message: `${target.name} unavailable (${target.host}:${target.port}) — is it running?`,
      detail: err.code || err.message,
    }));
  });

  req.pipe(proxyReq);
  res.on('close', () => proxyReq.destroy());
}

/* ── WebSockets (socket.io) ───────────────────────────────────────────────
 * Next.js rewrites cannot carry an upgrade, so the gateway handles it directly:
 * open a raw socket to the backend and hand the already-read request head over. */
const server = http.createServer(handle);

server.on('upgrade', (req, socket, head) => {
  const { target, url } = route(req.url || '/');
  const upstream = net.connect(target.port, target.host, () => {
    // Rebuild the request line with the ROUTED path — /socket.io keeps its full
    // path (the backend is mounted there); /studio/* has its prefix stripped.
    const headers = forwardedHeaders(req, target);
    headers.connection = 'Upgrade';
    headers.upgrade = req.headers.upgrade || 'websocket';
    const lines = [`GET ${url} HTTP/1.1`];
    for (const [key, value] of Object.entries(headers)) {
      if (value === undefined) continue;
      lines.push(`${key}: ${Array.isArray(value) ? value.join(', ') : value}`);
    }
    upstream.write(lines.join('\r\n') + '\r\n\r\n');
    if (head && head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });

  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
});

server.listen(PORT, HOST, () => {
  console.log(`🚪 Gateway on http://${HOST}:${PORT}`);
  console.log(`   /  →  ${WEB.host}:${WEB.port}   ${API_PREFIXES.join(', ')}  →  ${API.host}:${API.port}   /studio  →  ${STUDIO.host}:${STUDIO.port}`);
});

/* Also serve the same gateway on extra ports (e.g. GATEWAY_EXTRA_PORTS=3001) so
 * one origin can be reached directly without the tunnel. Same handler, same
 * routing — just another listener. */
const EXTRA = (process.env.GATEWAY_EXTRA_PORTS || '')
  .split(',')
  .map((p) => Number(p.trim()))
  .filter((p) => Number.isInteger(p) && p > 0 && p < 65536 && p !== PORT);
for (const p of EXTRA) {
  const s = http.createServer(handle);
  s.on('upgrade', (req, socket, head) => server.emit('upgrade', req, socket, head));
  s.listen(p, HOST, () => console.log(`🚪 Gateway also on http://${HOST}:${p} (same routing)`));
  s.keepAliveTimeout = 120000;
  s.headersTimeout = 130000;
}

server.keepAliveTimeout = 120000;
server.headersTimeout = 130000;
