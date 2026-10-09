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
 *   /            → Next.js      (WEB_PORT, default 3001)
 *   /api/...     → Express API  (API_PORT, default 5000)
 *   /socket.io/* → Express API  (WebSocket upgrade included)
 *
 * Zero dependencies on purpose — nothing to install on the box that serves it.
 */

const http = require('http');
const net = require('net');

const PORT = Number(process.env.GATEWAY_PORT || 8088);
const HOST = process.env.GATEWAY_HOST || '127.0.0.1';

const WEB = { name: 'web', host: '127.0.0.1', port: Number(process.env.WEB_PORT || 3001) };
const API = { name: 'api', host: '127.0.0.1', port: Number(process.env.API_PORT || 5000) };

/** Paths that belong to the backend. Everything else is the frontend. */
const API_PREFIXES = (process.env.API_PREFIXES || '/api,/socket.io')
  .split(',')
  .map((p) => p.trim())
  .filter(Boolean);

function targetFor(url = '') {
  const path = url.split('?')[0];
  return API_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`)) ? API : WEB;
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
  const target = targetFor(req.url || '/');

  if (req.url === '/_gateway/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({
      ok: true,
      web: `${WEB.host}:${WEB.port}`,
      api: `${API.host}:${API.port}`,
      prefixes: API_PREFIXES,
    }));
  }

  const proxyReq = http.request({
    host: target.host,
    port: target.port,
    method: req.method,
    path: req.url,
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
  const target = targetFor(req.url || '/');
  const upstream = net.connect(target.port, target.host, () => {
    // Rebuild the request line with the ORIGINAL path — the backend is mounted at
    // /socket.io, exactly what the browser asked for.
    const headers = forwardedHeaders(req, target);
    headers.connection = 'Upgrade';
    headers.upgrade = req.headers.upgrade || 'websocket';
    const lines = [`GET ${req.url} HTTP/1.1`];
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
  console.log(`   /  →  ${WEB.host}:${WEB.port}   ${API_PREFIXES.join(', ')}  →  ${API.host}:${API.port}`);
});

server.keepAliveTimeout = 120000;
server.headersTimeout = 130000;
