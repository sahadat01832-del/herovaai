/**
 * LM Studio Service — on-demand local inference with a RAM-safe lifecycle.
 *
 * Rules this service follows, because the host machine is RAM constrained:
 *  - Nothing is started unless somebody actually asks for a local model.
 *  - Only one daemon boot can ever be in flight; N visitors must not spawn N servers.
 *  - Every child process is bounded and killed by process group, so no `lms` process
 *    can outlive its timeout (that used to leave stray `lms unload --all` running).
 *  - A model is loaded with a short TTL, and the daemon itself is stopped again once
 *    the chat is left (or after an idle window) *if* we were the one who started it.
 *  - We never stop a server the user started by hand in the LM Studio app.
 */

const { spawn, spawnSync } = require('child_process');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const LM_BASE_URL = process.env.LM_STUDIO_BASE_URL || 'http://localhost:1234/v1';
const LM_PORT = Number(process.env.LM_STUDIO_PORT || 1234);
const START_BUDGET_MS = Number(process.env.LM_START_BUDGET_MS || 180000);
const IDLE_STOP_MS = Number(process.env.LM_IDLE_STOP_MS || 10 * 60 * 1000);
const DEFAULT_TTL = Number(process.env.LM_MODEL_TTL_SECONDS || 20);
const LOAD_TIMEOUT_MS = Number(process.env.LM_LOAD_TIMEOUT_MS || 90000);
const UNLOAD_TIMEOUT_MS = 20000;
/**
 * When a visitor leaves the local chat we unload the model immediately and stop
 * the server shortly after. The gap exists so a page reload (which also fires
 * pagehide) does not tear down a server the visitor is about to use again: any
 * real activity disarms the pending stop.
 */
const SERVER_STOP_GRACE_MS = Number(process.env.LM_SERVER_STOP_GRACE_MS || 90000);
/**
 * Hard ceiling on a local chat session, enforced by the server itself. Browser
 * events are best effort — a closed tab, a crashed page or a lost network must
 * not leave a model server resident on a RAM constrained machine.
 */
const SESSION_IDLE_MS = Number(process.env.LM_SESSION_IDLE_MS || 3 * 60 * 1000);
const IDLE_TICK_MS = 20000;
/** Public chat never pulls more than this into RAM. */
const MAX_PUBLIC_PARAMS_B = Number(process.env.LM_MAX_PUBLIC_PARAMS_B || 3);

const possibleLmsPaths = [
  process.env.LMS_CLI,
  '/home/sahadat/.lmstudio/bin/lms',
  '/home/sahadat/.local/bin/lms',
  '/usr/local/bin/lms',
  '/usr/bin/lms',
].filter(Boolean);

/** The desktop app doubles as the headless daemon (started with --run-as-service). */
const possibleAppPaths = [
  process.env.LM_STUDIO_APP,
  '/mnt/storage/home/sahadat/apps/bionic/Bionic-app/bionic',
  '/home/sahadat/.lmstudio/bin/lms',
].filter(Boolean);

function firstExecutable(paths) {
  for (const p of paths) {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

/**
 * Run a command with a hard timeout. The child gets its own process group so a
 * timeout kills the whole tree instead of only the shell wrapper.
 */
function run(cmd, args, { timeoutMs = 15000, detached = false } = {}) {
  return new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer = null;

    let child;
    try {
      child = spawn(cmd, args, {
        detached,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, LANG: process.env.LANG || 'C.UTF-8' },
      });
    } catch (err) {
      return resolve({ ok: false, code: null, stdout, stderr: err.message, timedOut: false, error: err.message });
    }

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    const killTree = () => {
      try {
        if (detached && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        try { child.kill('SIGKILL'); } catch { /* already gone */ }
      }
    };

    child.stdout?.on('data', d => { stdout += d.toString(); });
    child.stderr?.on('data', d => { stderr += d.toString(); });

    child.on('error', err => finish({ ok: false, code: null, stdout, stderr: err.message, timedOut: false, error: err.message }));
    child.on('close', code => finish({
      ok: code === 0,
      code,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      timedOut: false,
    }));

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        killTree();
        finish({ ok: false, code: null, stdout: stdout.trim(), stderr: stderr.trim(), timedOut: true, error: `timed out after ${timeoutMs}ms` });
      }, timeoutMs);
    }
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

class LMStudioService {
  constructor() {
    this.baseUrl = LM_BASE_URL;
    this.port = LM_PORT;
    this.lmsCli = firstExecutable(possibleLmsPaths);
    this.appBinary = firstExecutable(possibleAppPaths);
    this.pidFile = process.env.LM_DAEMON_PID_FILE || path.join(__dirname, '..', '..', '.lmstudio-daemon.json');

    /** offline | starting | online | loading | ready | error */
    this.state = 'offline';
    this.lastError = null;
    this.activeModel = null;

    this.startPromise = null;
    this.loadPromise = null;
    this.unloadPromise = null;
    this.serverStartInFlight = false;
    this.daemonPid = null;
    this.startedByService = false;
    this.stopTimer = null;
    this.lastActivityAt = Date.now();
  }

  /** Backend-owned safety net: release RAM when a local session goes quiet. */
  _startIdleWatch() {
    if (this.idleTimer) return;
    this.idleTimer = setInterval(() => {
      this._idleTick().catch(() => {});
    }, IDLE_TICK_MS);
    this.idleTimer.unref?.();
  }

  async _idleTick() {
    if (!this.startedByService) return;
    const idleFor = Date.now() - this.lastActivityAt;
    if (idleFor < SESSION_IDLE_MS) return;
    console.log(`⏱️  Local session idle for ${Math.round(idleFor / 1000)}s — releasing RAM.`);
    await this.unloadModel();
    await this.stopServer();
  }

  /** Cancel a scheduled shutdown because somebody is actually using the server. */
  disarmServerStop() {
    if (this.stopTimer) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
      return true;
    }
    return false;
  }

  armServerStop(delayMs = SERVER_STOP_GRACE_MS) {
    this.disarmServerStop();
    if (!this.startedByService || delayMs <= 0) return false;
    this.stopTimer = setTimeout(() => {
      this.stopTimer = null;
      this.stopServer().catch(() => {});
    }, delayMs);
    // Never hold the Node event loop open just for this timer.
    this.stopTimer.unref?.();
    console.log(`⏳ LM Studio will stop in ${Math.round(delayMs / 1000)}s unless it is used again.`);
    return true;
  }

  // ── Probing ──────────────────────────────────────────────────────────────

  async isServerRunning(timeout = 1500) {
    try {
      await axios.get(`${this.baseUrl}/models`, { timeout });
      return true;
    } catch {
      return false;
    }
  }

  /** Ids LM Studio reports it can serve. */
  async getModelIds({ startIfNeeded = false } = {}) {
    if (startIfNeeded && !(await this.isServerRunning())) {
      await this.startServer();
    }
    try {
      const response = await axios.get(`${this.baseUrl}/models`, { timeout: 5000 });
      return (response.data?.data || []).map(m => m.id).filter(Boolean);
    } catch (err) {
      console.warn(`⚠️  Could not list LM Studio models: ${err.message}`);
      return [];
    }
  }

  /** Models currently resident in RAM. */
  async getLoadedModels() {
    if (!this.lmsCli) return [];
    const res = await run(this.lmsCli, ['ps'], { timeoutMs: 8000 });
    if (!res.ok) return [];
    if (/no models are currently loaded/i.test(res.stdout)) return [];
    const loaded = [];
    for (const line of res.stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || /^identifier\b/i.test(trimmed) || /^to /i.test(trimmed) || trimmed.startsWith('=')) continue;
      loaded.push(trimmed.split(/\s+/)[0]);
    }
    return loaded;
  }

  /** Chat models on disk, smallest first, with a RAM hint for the UI. */
  async listChatModels() {
    const ids = await this.getModelIds();
    const chatCapable = ids.filter(id => !/embed|tts|whisper|rerank|clip|vision-encoder/i.test(id));
    const params = id => {
      const match = id.match(/(\d+(?:\.\d+)?)\s?b(?![a-z])/i);
      return match ? parseFloat(match[1]) : Infinity;
    };
    return chatCapable
      .map(id => {
        const b = params(id);
        return {
          id,
          paramsB: Number.isFinite(b) ? b : null,
          fitsPublic: b <= MAX_PUBLIC_PARAMS_B,
          ramHint: Number.isFinite(b) ? `≈${Math.max(1, Math.round(b * 0.7))} GB RAM` : 'unknown RAM',
        };
      })
      .sort((a, b) => (a.paramsB ?? Infinity) - (b.paramsB ?? Infinity));
  }

  /** The smallest chat model this machine can serve — keeps RAM pressure minimal. */
  async pickDefaultChatModel({ publicOnly = false } = {}) {
    const models = await this.listChatModels();
    const usable = publicOnly ? models.filter(m => m.fitsPublic) : models;
    return usable[0]?.id || null;
  }

  // ── Server lifecycle ─────────────────────────────────────────────────────

  /**
   * Bring the local server up. Concurrent callers share one boot attempt, so a
   * burst of visitors cannot start several daemons at once.
   */
  async startServer({ budgetMs = START_BUDGET_MS } = {}) {
    if (await this.isServerRunning()) {
      this.state = this.activeModel ? 'ready' : 'online';
      this.touch();
      return { ok: true, state: this.state, alreadyRunning: true };
    }
    if (this.startPromise) return this.startPromise;
    this.startPromise = this._boot(budgetMs).finally(() => { this.startPromise = null; });
    return this.startPromise;
  }

  /** The desktop binary is also the daemon; Electron's single-instance lock makes this idempotent. */
  _launchDaemon() {
    if (!this.appBinary || this.appBinary === this.lmsCli) return;
    try {
      const child = spawn(this.appBinary, ['--run-as-service'], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env },
      });
      child.unref();
      this.daemonPid = child.pid;
      this._rememberDaemonPid(child.pid);
      console.log(`   → launched LM Studio daemon (pid ${child.pid}).`);
    } catch (err) {
      this.lastError = `Could not launch LM Studio: ${err.message}`;
    }
  }

  /**
   * The backend restarts (deploys, crashes) must not lose track of a daemon we
   * started, otherwise it lingers in RAM with nobody able to own the shutdown.
   */
  _rememberDaemonPid(pid) {
    try {
      fs.writeFileSync(this.pidFile, JSON.stringify({ pid, at: Date.now(), binary: this.appBinary }));
    } catch { /* bookkeeping only */ }
  }

  _forgetDaemonPid() {
    try { fs.rmSync(this.pidFile, { force: true }); } catch { /* ignore */ }
  }

  /** Kill the daemon we launched, in this process or a previous one. */
  _killDaemon() {
    let pid = this.daemonPid;
    if (!pid) {
      try {
        const saved = JSON.parse(fs.readFileSync(this.pidFile, 'utf8'));
        pid = saved?.pid;
        // Only trust the file if that pid still belongs to the LM Studio binary.
        if (pid) {
          const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
          if (!/lmstudio|Bionic-app/i.test(cmdline)) pid = null;
        }
      } catch {
        pid = null;
      }
    }

    if (pid) {
      const signal = (sig) => {
        try { process.kill(-pid, sig); } catch { try { process.kill(pid, sig); } catch { /* already gone */ } }
      };
      signal('SIGTERM');
      return { pid, signal };
    }

    this.daemonPid = null;
    this._forgetDaemonPid();
    return null;
  }

  /**
   * Live daemon processes, matched on the exact launch arguments. The pid we
   * spawned can be replaced by one the `lms` CLI starts itself, so the recorded
   * pid alone is not a reliable handle on the daemon.
   */
  _findDaemonPids() {
    if (!this.appBinary) return [];
    try {
      const res = spawnSync('pgrep', ['-f', `${this.appBinary} --run-as-service`], { encoding: 'utf8', timeout: 5000 });
      return String(res.stdout || '')
        .split('\n')
        .map(line => parseInt(line.trim(), 10))
        .filter(pid => Number.isInteger(pid) && pid > 0);
    } catch {
      return [];
    }
  }

  /** Give the daemon a moment to exit cleanly, then force it. */
  async _killDaemonAndWait() {
    const pending = this._killDaemon();
    if (pending) {
      await sleep(1500);
      pending.signal('SIGKILL');
    }

    // Sweep anything still alive that matches the daemon command line. Only ever
    // reached from a session this service started, so a user's own LM Studio is
    // untouched.
    for (const signal of ['SIGTERM', 'SIGKILL']) {
      const leftovers = this._findDaemonPids();
      if (leftovers.length === 0) break;
      for (const pid of leftovers) {
        try { process.kill(pid, signal); } catch { /* already gone */ }
      }
      await sleep(1500);
    }

    this.daemonPid = null;
    this._forgetDaemonPid();
    return Boolean(pending) || this._findDaemonPids().length === 0;
  }

  /**
   * `lms server start` only succeeds once the daemon has finished booting. On a
   * cold install the daemon first unpacks its inference runtimes, so the call is
   * retried while the port is polled in parallel instead of being given one shot.
   */
  _requestServerStart(remainingMs) {
    if (!this.lmsCli || this.serverStartInFlight) return;
    this.serverStartInFlight = true;
    run(this.lmsCli, ['server', 'start', '--port', String(this.port), '--cors'], {
      timeoutMs: Math.max(15000, Math.min(60000, remainingMs)),
    })
      .then(res => {
        if (!res.ok) {
          console.log(`   … server start attempt: ${(res.stderr || res.error || '').split('\n')[0]}`);
        }
      })
      .catch(() => {})
      .finally(() => { this.serverStartInFlight = false; });
  }

  async _boot(budgetMs) {
    const startedAt = Date.now();
    const deadline = startedAt + budgetMs;
    this.state = 'starting';
    this.lastError = null;
    console.log('🔄 LM Studio is offline — waking the local server on demand...');

    if (!this.appBinary && !this.lmsCli) {
      this.state = 'error';
      this.lastError = 'No LM Studio CLI or application found on this machine.';
      return { ok: false, state: this.state, error: this.lastError };
    }

    this.startedByService = true;
    this.lastActivityAt = Date.now();
    this._startIdleWatch();
    this._launchDaemon();

    while (Date.now() < deadline) {
      if (await this.isServerRunning(1500)) {
        this.state = 'online';
        this.touch();
        console.log(`✅ LM Studio server is up on port ${this.port} (${Math.round((Date.now() - startedAt) / 1000)}s).`);
        return { ok: true, state: this.state, bootMs: Date.now() - startedAt };
      }
      this._requestServerStart(deadline - Date.now());
      await sleep(2500);
    }

    this.state = 'error';
    this.lastError = `LM Studio did not answer on port ${this.port} within ${Math.round(budgetMs / 1000)}s.`;
    console.warn(`⚠️  ${this.lastError}`);
    return { ok: false, state: this.state, error: this.lastError, bootMs: Date.now() - startedAt };
  }

  /** Load a model into RAM, smallest-first when none was pinned. */
  async ensureModelLoaded(modelKey, ttlSeconds = DEFAULT_TTL) {
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = this._ensureModelLoaded(modelKey, ttlSeconds).finally(() => { this.loadPromise = null; });
    return this.loadPromise;
  }

  async _ensureModelLoaded(modelKey, ttlSeconds) {
    const server = await this.startServer();
    if (!server.ok) return { ok: false, state: server.state, error: server.error || 'local server unavailable' };

    let target = modelKey;
    if (!target || target === 'local') {
      target = await this.pickDefaultChatModel();
      if (!target) {
        this.state = 'online';
        return { ok: false, state: this.state, error: 'LM Studio is running but has no chat model installed.' };
      }
    }

    const loaded = await this.getLoadedModels();
    const already = loaded.some(m =>
      m.toLowerCase().includes(target.toLowerCase()) || target.toLowerCase().includes(m.toLowerCase()));
    if (already) {
      this.activeModel = target;
      this.state = 'ready';
      this.touch();
      return { ok: true, state: 'ready', model: target, alreadyLoaded: true };
    }

    this.state = 'loading';
    const load = await run(this.lmsCli || 'lms', ['load', target, '--ttl', String(ttlSeconds), '-y'], {
      timeoutMs: LOAD_TIMEOUT_MS,
    });

    if (!load.ok) {
      // Loading can legitimately fail while just-in-time loading still serves the
      // request, so this is reported rather than treated as fatal.
      console.warn(`⚠️  lms load ${target} failed: ${load.error || load.stderr || load.stdout}`);
      this.state = 'online';
      this.touch();
      return { ok: true, state: 'online', model: target, loaded: false, warning: (load.stderr || load.error || '').slice(0, 300) };
    }

    this.activeModel = target;
    this.state = 'ready';
    this.touch();
    console.log(`✅ Loaded "${target}" with ${ttlSeconds}s TTL.`);
    return { ok: true, state: 'ready', model: target, loaded: true };
  }

  /** Free RAM now. Coalesced so rapid navigations cannot stack unload processes. */
  async unloadModel(modelKey) {
    if (this.unloadPromise) return this.unloadPromise;
    this.unloadPromise = this._unload(modelKey).finally(() => { this.unloadPromise = null; });
    return this.unloadPromise;
  }

  async _unload(modelKey) {
    if (!this.lmsCli) return false;

    // Every `lms` command wakes the daemon if it is asleep. Checking first means
    // "unload on leave" cannot boot LM Studio on a machine that is idle.
    if (!(await this.isServerRunning(1200))) {
      this.activeModel = null;
      return true;
    }

    const args = modelKey && modelKey !== 'local' ? ['unload', modelKey] : ['unload', '--all'];
    const res = await run(this.lmsCli, args, { timeoutMs: UNLOAD_TIMEOUT_MS });
    this.activeModel = null;
    this.state = this.startedByService ? 'online' : 'offline';
    if (!res.ok && !res.timedOut) {
      console.warn(`⚠️  unload notice: ${res.stderr || res.error}`);
    }
    return res.ok;
  }

  /**
   * Stop the daemon itself — only ever the one we started. A server the user
   * launched in the LM Studio app stays untouched.
   */
  async stopServer({ force = false } = {}) {
    if (!this.startedByService && !force) {
      return { ok: false, reason: 'LM Studio was already running before HerovaAi started it; leaving it alone.' };
    }
    await this.unloadModel();
    // Ask the daemon to stop only while it is actually serving; the CLI would
    // otherwise wake it first and then stop it, which is wasted work on a
    // RAM-constrained host.
    if (this.lmsCli && (await this.isServerRunning(1200))) {
      await run(this.lmsCli, ['server', 'stop'], { timeoutMs: 20000 });
    }
    await this._killDaemonAndWait();
    this.startedByService = false;
    this.state = 'offline';
    this.activeModel = null;
    console.log('🧹 LM Studio stopped and RAM released.');
    return { ok: true, stopped: true };
  }

  /**
   * Called by the UI when the visitor leaves the chat.
   * `graceSeconds > 0` frees the model RAM now and stops the server a little
   * later, so an accidental reload does not kill a server mid-session.
   */
  async releaseLocalAi({ graceSeconds = SERVER_STOP_GRACE_MS / 1000 } = {}) {
    await this.unloadModel();

    if (graceSeconds > 0) {
      const armed = this.armServerStop(graceSeconds * 1000);
      return {
        ok: true,
        unloaded: true,
        serverStopped: false,
        serverStopsInSeconds: armed ? Math.round(graceSeconds) : null,
      };
    }

    const stopped = await this.stopServer();
    return { ok: true, unloaded: true, serverStopped: Boolean(stopped.ok) };
  }

  /** Idle watchdog: hand the RAM back when nobody is chatting. */
  async pruneIfIdle() {
    if (!this.startedByService) return false;
    if (Date.now() - this.lastActivityAt < IDLE_STOP_MS) return false;
    console.log('⏱️  LM Studio idle — releasing RAM.');
    await this.releaseLocalAi();
    return true;
  }

  touch() {
    this.lastActivityAt = Date.now();
    this.disarmServerStop();
    if (this.startedByService) this._startIdleWatch();
  }

  async getStatus({ prune = true } = {}) {
    if (prune) {
      try { await this.pruneIfIdle(); } catch { /* non-fatal */ }
    }
    // A probe is not activity: only real chat traffic should postpone the
    // idle shutdown, otherwise the UI's own polling keeps RAM occupied forever.
    const isOnline = await this.isServerRunning(1200);

    // Ownership is decided when we boot the daemon, never by a probe: a single
    // missed probe during startup used to erase the fact that we started it,
    // which silently disabled "stop LM Studio when I leave".
    if (isOnline && (this.state === 'offline' || this.state === 'error')) {
      this.state = 'online';
    }
    if (!isOnline && this.state !== 'starting') {
      // "offline" from a probe may be transient (the port is still opening), so
      // keep the daemon/ownership bookkeeping and only report the observation.
      this.state = this.startedByService ? 'starting' : 'offline';
    }

    const loadedModels = isOnline ? await this.getLoadedModels() : [];
    if (isOnline) {
      // The state is derived from what is really in RAM, not from intent.
      const activeLoaded = this.activeModel
        && loadedModels.some(m => m.toLowerCase().includes(String(this.activeModel).toLowerCase()));
      this.state = activeLoaded ? 'ready' : 'online';
    }

    return {
      isOnline,
      state: this.state,
      starting: this.state === 'starting' || Boolean(this.startPromise),
      activeModel: this.activeModel,
      loadedModels,
      startedByService: this.startedByService,
      serverStopsInMs: this.stopTimer ? SERVER_STOP_GRACE_MS : null,
      lastError: this.lastError,
      idleStopInMs: this.startedByService
        ? Math.max(0, IDLE_STOP_MS - (Date.now() - this.lastActivityAt))
        : null,
      port: this.port,
      cli: this.lmsCli,
      daemonLauncher: this.appBinary && this.appBinary !== this.lmsCli ? this.appBinary : null,
    };
  }
}

module.exports = new LMStudioService();
module.exports.MAX_PUBLIC_PARAMS_B = MAX_PUBLIC_PARAMS_B;
