const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { chromium } = require('playwright');

const FLOW_URL = process.env.GOOGLE_FLOW_URL || 'https://flow.google.com/';
const PROFILE_DIR = process.env.GOOGLE_FLOW_PROFILE_DIR
  || path.join(os.homedir(), '.contentbot', 'google-flow', 'brave-profile');
const PROFILE_LABEL = 'Image Generator';
const HEADLESS = process.env.GOOGLE_FLOW_HEADLESS !== 'false';
const OUTPUT_DIR = process.env.GOOGLE_FLOW_OUTPUT_DIR
  || path.join(os.homedir(), '.contentbot', 'google-flow', 'outputs');
const BRAVE_CANDIDATES = [
  '/usr/bin/brave-browser',
  '/usr/bin/brave-browser-stable',
  '/opt/brave.com/brave/brave',
  '/opt/brave.com/brave/brave-browser',
];
const MAX_REFERENCE_IMAGE_BYTES = 20 * 1024 * 1024;
const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const FLOW_FAILURE_MESSAGES = [
  {
    pattern: /we noticed some unusual activity/i,
    message: 'Google Flow rejected the generation for unusual browser activity. Flow reported that you were not charged. Try again in regular Brave, disable extensions that modify the page, and check Google Flow Help if it persists.',
  },
  {
    pattern: /not enough credits|insufficient credits/i,
    message: 'Google Flow does not have enough credits for this generation.',
  },
  {
    pattern: /generation failed|failed to generate/i,
    message: 'Google Flow reported that image generation failed.',
  },
];

let browserContextPromise;
let browserProcess;
let browserPort;
let generationQueue = Promise.resolve();

function findBraveExecutable({
  configuredPath = process.env.GOOGLE_FLOW_BRAVE_PATH,
  candidates = BRAVE_CANDIDATES,
  exists = fsSync.existsSync,
  realpath = fsSync.realpathSync,
} = {}) {
  if (configuredPath) {
    if (!exists(configuredPath)) {
      throw new Error(`GOOGLE_FLOW_BRAVE_PATH does not exist: ${configuredPath}`);
    }
    return realpath(configuredPath);
  }
  const executablePath = candidates.find(exists);
  if (!executablePath) {
    throw new Error('Brave Browser was not found. Install Brave or set GOOGLE_FLOW_BRAVE_PATH to its executable.');
  }
  return realpath(executablePath);
}

function buildBraveArgs({ profileDir, headless, port, url = 'about:blank' }) {
  const args = [
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
  ];
  if (port) {
    args.push('--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`);
  }
  if (headless) {
    args.push(
      '--headless=new',
      '--no-sandbox',
      '--disable-dev-shm-usage',
    );
  }
  args.push(url);
  return args;
}

/**
 * True only when the profile's SingletonLock names a LIVE Brave that is really
 * attached to this profile.
 *
 * Every generation ends with `closeBrowserContext()` killing the browser, and
 * Chromium does not always manage to unlink its `Singleton*` files on the way
 * out — so the profile is normally left with a lock pointing at a dead PID.
 * Chromium usually repairs that itself, but the leftover `/tmp` socket can also
 * make the next launch stall trying to notify a process that no longer exists
 * (the hang seen on 2026-10-13, until the locks were cleared by hand). Reading
 * `/proc/<pid>/cmdline` instead of merely signalling the PID also rules out PID
 * reuse: a recycled number belonging to some unrelated program must not be
 * mistaken for the browser that owns this profile.
 */
function profileIsLockedByLiveBrowser(profileDir) {
  let target;
  try {
    target = fsSync.readlinkSync(path.join(profileDir, 'SingletonLock'));
  } catch {
    return false; // no lock at all → nobody owns the profile
  }
  if (!String(target).startsWith(`${os.hostname()}-`)) return false; // lock from another host
  const pid = Number(String(target).match(/-(\d+)$/)?.[1]);
  if (!Number.isInteger(pid)) return false;
  let commandLine;
  try {
    commandLine = fsSync.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
  } catch {
    return false; // the PID is gone → stale lock
  }
  return commandLine.includes(`--user-data-dir=${profileDir}`);
}

async function prepareBraveProfile(profileDir = PROFILE_DIR) {
  await fs.mkdir(profileDir, { recursive: true, mode: 0o700 });
  // Drop locks left behind by a previous generation whose browser was killed
  // before it could unlink them. A lock held by a genuinely running browser is
  // preserved — removing that would let two browsers fight over one profile.
  if (!profileIsLockedByLiveBrowser(profileDir)) {
    for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
      await fs.unlink(path.join(profileDir, name)).catch(() => {});
    }
  }
  const localStatePath = path.join(profileDir, 'Local State');
  let localState = {};
  try {
    localState = JSON.parse(await fs.readFile(localStatePath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw new Error(`Could not read the dedicated Brave profile metadata: ${error.message}`);
    }
  }
  if (!localState.profile || typeof localState.profile !== 'object') localState.profile = {};
  if (!localState.profile.info_cache || typeof localState.profile.info_cache !== 'object') {
    localState.profile.info_cache = {};
  }
  const current = localState.profile.info_cache.Default || {};
  localState.profile.info_cache.Default = {
    ...current,
    name: PROFILE_LABEL,
    is_using_default_name: false,
  };
  localState.profile.last_active_profiles = ['Default'];
  localState.profile.profiles_order = ['Default'];
  await fs.writeFile(localStatePath, JSON.stringify(localState, null, 2), { mode: 0o600 });
  await fs.chmod(profileDir, 0o700);
  await fs.chmod(localStatePath, 0o600);
}

async function getAvailablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForCdp(child, port) {
  const endpoint = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return endpoint;
    } catch {}
    if (child.spawnError) throw child.spawnError;
    if (child.exitCode !== null) {
      throw new Error(`Brave exited during startup (code ${child.exitCode}, signal ${child.signalCode || 'none'}).`);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Headless Brave did not expose its local DevTools endpoint within 20 seconds.');
}

function findManagedBravePid(profileDir, port, headless = true) {
  if (!port || process.platform !== 'linux') return undefined;
  let lockName;
  try {
    lockName = path.basename(fsSync.readlinkSync(path.join(profileDir, 'SingletonLock')));
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
  const pid = Number(lockName.match(/-(\d+)$/)?.[1]);
  if (!Number.isInteger(pid)) return undefined;
  let commandLine;
  try {
    commandLine = fsSync.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
  if (!commandLine.includes(`--user-data-dir=${profileDir}`)
    || (headless && !commandLine.includes('--headless=new'))
    || (!headless && commandLine.includes('--headless=new'))
    || !commandLine.includes(`--remote-debugging-port=${port}`)) return undefined;
  return pid;
}

async function terminateBrowserProcess(child, port, headless = true) {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }

  const browserPid = findManagedBravePid(PROFILE_DIR, port, headless);
  if (browserPid && browserPid !== process.pid) {
    try {
      process.kill(browserPid, 'SIGTERM');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
    for (let attempt = 0; attempt < 10
      && findManagedBravePid(PROFILE_DIR, port, headless) === browserPid; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (findManagedBravePid(PROFILE_DIR, port, headless) === browserPid) {
      try {
        process.kill(browserPid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
  }
}

function validateGenerateInput(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('Input must be an object.');
  }
  if (typeof input.prompt !== 'string' || !input.prompt.trim()) {
    throw new Error('prompt is required and must not be empty.');
  }
  if (input.prompt.length > 4000) {
    throw new Error('prompt must be at most 4000 characters.');
  }
  if (input.model !== undefined && (typeof input.model !== 'string' || !input.model.trim() || input.model.length > 100)) {
    throw new Error('model must be a non-empty string of at most 100 characters.');
  }
  if (input.aspectRatio !== undefined && (
    typeof input.aspectRatio !== 'string' || !/^\d{1,2}:\d{1,2}$/.test(input.aspectRatio)
  )) {
    throw new Error('aspectRatio must use a ratio such as 1:1, 16:9, or 9:16.');
  }
  if (input.referenceImagePath !== undefined && (
    typeof input.referenceImagePath !== 'string' || !input.referenceImagePath.trim()
  )) {
    throw new Error('referenceImagePath must be a non-empty local file path.');
  }

  return {
    prompt: input.prompt.trim(),
    model: input.model?.trim(),
    aspectRatio: input.aspectRatio,
    referenceImagePath: input.referenceImagePath?.trim(),
  };
}

function getGenerationFailureMessage(pageText) {
  return FLOW_FAILURE_MESSAGES.find(({ pattern }) => pattern.test(pageText))?.message;
}

function choosePreferredImageModel(models, currentModel) {
  const preferredModel = models.find((model) => (
    /nano banana (?:pro )?2(?:\.1)?(?!\s*[a-z0-9.])/i.test(model)
  ));
  if (preferredModel) return preferredModel;
  if (currentModel && models.includes(currentModel)) return currentModel;
  return models[0];
}

function validateGeneratedImage(bytes, mimeType) {
  const signatures = {
    'image/png': bytes.length >= 24
      && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    'image/jpeg': bytes.length >= 3
      && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
    'image/webp': bytes.length >= 12
      && bytes.toString('ascii', 0, 4) === 'RIFF'
      && bytes.toString('ascii', 8, 12) === 'WEBP',
  };
  if (!signatures[mimeType]) {
    throw new Error(`Google Flow returned an invalid or unsupported image payload (${mimeType || 'unknown content type'}).`);
  }
}

async function validateReferenceImage(referenceImagePath) {
  if (!referenceImagePath) return undefined;
  const resolvedPath = path.resolve(referenceImagePath);
  let stat;
  try {
    stat = await fs.stat(resolvedPath);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      throw new Error(`Reference image was not found: ${resolvedPath}`);
    }
    throw new Error(`Could not read reference image ${resolvedPath}: ${error.message}`);
  }
  if (!stat.isFile()) throw new Error('referenceImagePath must point to a regular image file.');
  if (stat.size > MAX_REFERENCE_IMAGE_BYTES) {
    throw new Error('Reference image must be 20 MB or smaller.');
  }
  const extension = path.extname(resolvedPath).toLowerCase();
  const mimeType = extension === '.png' ? 'image/png'
    : ['.jpg', '.jpeg'].includes(extension) ? 'image/jpeg'
      : extension === '.webp' ? 'image/webp' : undefined;
  if (!IMAGE_MIME_TYPES.has(mimeType)) {
    throw new Error('Reference image must be a PNG, JPEG, or WebP file.');
  }
  return { path: resolvedPath, mimeType };
}

async function getBrowserContext() {
  if (!browserContextPromise) {
    browserContextPromise = (async () => {
      await prepareBraveProfile();
      const executablePath = findBraveExecutable();
      browserPort = await getAvailablePort();
      const child = spawn(executablePath, buildBraveArgs({
        profileDir: PROFILE_DIR,
        headless: HEADLESS,
        port: browserPort,
      }), { stdio: 'ignore' });
      browserProcess = child;
      child.on('error', (error) => { child.spawnError = error; });
      const endpoint = await waitForCdp(child, browserPort);
      const browser = await chromium.connectOverCDP(endpoint, { timeout: 10000 });
      browser.on('disconnected', () => {
        if (browserProcess?.exitCode !== null) {
          browserProcess = undefined;
          browserPort = undefined;
          browserContextPromise = undefined;
        }
      });
      return browser;
    })().catch(async (error) => {
      const failedProcess = browserProcess;
      const failedPort = browserPort;
      browserProcess = undefined;
      browserPort = undefined;
      browserContextPromise = undefined;
      await terminateBrowserProcess(failedProcess, failedPort, HEADLESS);
      const mode = HEADLESS ? 'headless' : 'headed';
      throw new Error(`Could not start the dedicated ${mode} Brave profile. Close the Image Generator login window, then retry. Details: ${error.message}`);
    });
  }
  const browser = await browserContextPromise;
  const context = browser.contexts()[0];
  if (!context) throw new Error('Headless Brave has no default browser context.');
  return context;
}

async function closeBrowserContext() {
  if (!browserContextPromise) return;
  const browser = await browserContextPromise;
  const processToStop = browserProcess;
  const portToStop = browserPort;
  browserContextPromise = undefined;
  browserProcess = undefined;
  browserPort = undefined;
  let closeError;
  try {
    await browser.close();
  } catch (error) {
    closeError = error;
  }
  await terminateBrowserProcess(processToStop, portToStop, HEADLESS);
  if (closeError) throw closeError;
}

async function getFlowPage() {
  const context = await getBrowserContext();
  // RAM cleanup: the Brave context is cached and reused across generations, and
  // Flow opens popup/new tabs while working. Close every tab except the primary
  // one BEFORE reusing the browser, so old tabs never accumulate across runs.
  const existingPages = context.pages();
  const page = existingPages[0] || await context.newPage();
  for (const extra of existingPages.slice(1)) {
    try { await extra.close(); } catch { /* already gone */ }
  }
  page.setDefaultTimeout(10000);
  if (!page.url().startsWith(FLOW_URL)) {
    await page.goto(FLOW_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  }
  if (isGoogleSignInUrl(page.url())) {
    throw new Error('Google Flow is not signed in. Run `npm run flow:login` in backend, sign in, and close the browser window.');
  }

  const createButton = await firstVisible(page.getByRole('button', { name: /create with google flow/i }));
  if (createButton) {
    await createButton.click();
  }
  if (isGoogleSignInUrl(page.url())) {
    throw new Error('Google Flow is not signed in. Run `npm run flow:login` in backend, sign in, and close the browser window.');
  }

  let pageText = await page.locator('body').innerText({ timeout: 10000 });
  if (/not available in your (country|region)|not available to you|join the waitlist|access denied/i.test(pageText)) {
    throw new Error('Google Flow reports that this account or region cannot use Flow. Check Flow availability for your Google account and region.');
  }

  if (/\/project\//.test(new URL(page.url()).pathname)) {
    const homeButton = await waitForVisible(
      page.getByRole('button', { name: /^home$/i }),
      'Google Flow project navigation was not available.',
    );
    await homeButton.click();
    await page.waitForURL((url) => !/\/project\//.test(url.pathname), { timeout: 30000 });
  }

  const newProjectButton = await waitForVisible(
    page.getByRole('button', { name: /new project/i }),
    'Google Flow project list did not load or expose a New project button.',
    30000,
  );
  await Promise.all([
    page.waitForURL(/\/project\//, { timeout: 60000 }),
    newProjectButton.click(),
  ]);
  await page.waitForFunction(
    () => Boolean(document.querySelector('[contenteditable="true"].ProseMirror')),
    null,
    { timeout: 30000 },
  );
  if (!await findPromptField(page)) {
    throw new Error('Google Flow opened a new project, but its prompt editor was not found.');
  }
  return page;
}

function isGoogleSignInUrl(url) {
  return /accounts\.google\.com|\/signin/i.test(url);
}

async function firstVisible(locator) {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible()) return candidate;
  }
  return undefined;
}

async function waitForVisible(locator, message, timeout = 10000) {
  try {
    await locator.waitFor({ state: 'visible', timeout });
  } catch (error) {
    if (error.name === 'TimeoutError') throw new Error(message);
    throw error;
  }
  return firstVisible(locator);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function configureGenerationOptions(page, request) {
  const settingsLocator = page.getByRole('button', { name: /settings trigger/i });
  const settingsTrigger = await waitForVisible(settingsLocator, 'Google Flow generation settings did not load within 30 seconds.', 30000);
  if (!settingsTrigger) {
    throw new Error('Google Flow generation settings were not found. The Flow interface may have changed.');
  }
  await settingsTrigger.click();

  const singleOutputLocator = page.getByRole('radio', { name: /x1/i });
  const singleOutputChoice = await waitForVisible(singleOutputLocator, 'Google Flow output-count settings were not found.');
  if (singleOutputChoice) await singleOutputChoice.click();

  if (request.model) {
    const modelSelector = await waitForVisible(
      page.getByRole('button', { name: /select model family/i }),
      'Google Flow model selector was not found in generation settings.',
    );
    if (!modelSelector) {
      throw new Error('Google Flow model selector was not found in generation settings.');
    }
    await modelSelector.click();
    const modelChoice = await waitForVisible(
      page.getByRole('menuitem', { name: new RegExp(`^.*${escapeRegExp(request.model)}$`, 'i') }),
      `Google Flow did not offer model "${request.model}". Use an exact model name shown in the signed-in account.`,
    );
    if (!modelChoice) {
      throw new Error(`Google Flow did not offer model "${request.model}". Use an exact model name shown in the signed-in account.`);
    }
    await modelChoice.click();
  }

  if (request.aspectRatio) {
    const ratioChoice = await waitForVisible(
      page.getByRole('radio', { name: new RegExp(escapeRegExp(request.aspectRatio), 'i') }),
      `Google Flow did not offer aspect ratio "${request.aspectRatio}". Use an option supported by the signed-in account.`,
    );
    if (!ratioChoice) {
      throw new Error(`Google Flow did not offer aspect ratio "${request.aspectRatio}". Use an option supported by the signed-in account.`);
    }
    await ratioChoice.click();
  }
}

async function getGenerationOptions() {
  const page = await getFlowPage();
  const settingsTrigger = await waitForVisible(
    page.getByRole('button', { name: /settings trigger/i }),
    'Google Flow generation settings did not load within 30 seconds.',
    30000,
  );
  if (!settingsTrigger) {
    throw new Error('Google Flow generation settings were not found. The Flow interface may have changed.');
  }
  await settingsTrigger.click();

  const ratioOption = page.getByRole('radio', { name: /\d{1,2}:\d{1,2}/ }).first();
  await waitForVisible(
    ratioOption,
    'Google Flow did not expose image aspect-ratio choices in its settings.',
  );
  const aspectRatios = await page.getByRole('radio').evaluateAll((elements) => {
    const labels = elements.map((element) => [
      element.getAttribute('aria-label'),
      element.innerText,
      element.getAttribute('title'),
    ].filter(Boolean).join(' '));
    return [...new Set(labels.flatMap((label) => label.match(/\b\d{1,2}:\d{1,2}\b/g) || []))];
  });

  const modelSelector = await waitForVisible(
    page.getByRole('button', { name: /select model family/i }),
    'Google Flow model selector was not found in generation settings.',
  );
  if (!modelSelector) {
    throw new Error('Google Flow model selector was not found in generation settings.');
  }
  const defaultModelLabel = (await modelSelector.innerText()).trim();
  await modelSelector.click();
  await waitForVisible(
    page.getByRole('menuitem').first(),
    'Google Flow did not expose model choices in its settings.',
  );
  const modelChoices = await page.getByRole('menuitem').evaluateAll((elements) => (
    elements.map((element) => (element.getAttribute('aria-label') || element.innerText || '').trim())
      .filter(Boolean)
  ));
  await page.keyboard.press('Escape');
  const defaultAspectRatio = await page.getByRole('radio').evaluateAll((elements) => {
    const selected = elements.find((element) => (
      element.getAttribute('aria-checked') === 'true'
      || element.getAttribute('data-state') === 'checked'
      || element.getAttribute('checked') !== null
    ));
    if (!selected) return null;
    const label = [
      selected.getAttribute('aria-label'),
      selected.innerText,
      selected.getAttribute('title'),
    ].filter(Boolean).join(' ');
    return label.match(/\b\d{1,2}:\d{1,2}\b/)?.[0] || null;
  });
  await settingsTrigger.click();

  const models = [...new Set(modelChoices)];
  if (!models.length || !aspectRatios.length) {
    throw new Error('Google Flow did not expose its image models and aspect ratios. Check the signed-in account and current Flow interface.');
  }
  const flowDefaultModel = models.find((model) => defaultModelLabel.endsWith(model));
  const defaultModel = choosePreferredImageModel(models, flowDefaultModel);
  return { models, aspectRatios, defaultModel, defaultAspectRatio };
}

async function attachReferenceImage(page, image) {
  const attachButton = await firstVisible(page.getByRole('button', {
    name: /add ingredients to the prompt box|attach|upload|add image/i,
  }));
  if (!attachButton) {
    throw new Error('Google Flow did not expose an image upload control; reference-image editing is unavailable in the current UI.');
  }
  await attachButton.click();
  const uploadButton = await firstVisible(page.getByRole('button', { name: /upload media/i }));
  if (!uploadButton) {
    throw new Error('Google Flow opened its ingredients panel but did not expose Upload media.');
  }
  const chooserPromise = page.waitForEvent('filechooser', { timeout: 10000 });
  const [chooser] = await Promise.all([chooserPromise, uploadButton.click()]);
  await chooser.setFiles(image.path);
  const assetDialog = await waitForVisible(
    page.getByRole('dialog', { name: /add assets to the project/i }),
    'Google Flow did not keep its asset picker open after uploading the reference image.',
  );
  if (!assetDialog) {
    throw new Error('Google Flow did not keep its asset picker open after uploading the reference image.');
  }
  const filename = path.basename(image.path);
  await waitForVisible(
    assetDialog.getByRole('option', { name: new RegExp(escapeRegExp(filename), 'i') }),
    `Google Flow did not list the uploaded reference image "${filename}".`,
    120000,
  );
  await page.waitForFunction((uploadedFilename) => (
    Array.from(document.querySelectorAll('[role="dialog"] [role="option"]')).some((option) => (
      option.innerText.includes(uploadedFilename) && !/uploading/i.test(option.innerText)
    ))
  ), filename, { timeout: 120000 });
  const uploadedAsset = assetDialog.getByRole('option', {
    name: new RegExp(escapeRegExp(filename), 'i'),
  });
  await uploadedAsset.click();
  await assetDialog.waitFor({ state: 'hidden', timeout: 10000 });
  const selectedIngredient = await waitForVisible(
    page.getByRole('button', { name: /^ingredient$/i }),
    `Google Flow did not attach "${filename}" to the prompt.`,
    10000,
  );
  await page.waitForFunction(
    () => Array.from(document.querySelectorAll('button[aria-label="Ingredient"]'))
      .some((button) => button.getAttribute('aria-busy') !== 'true'),
    null,
    { timeout: 10000 },
  );
  if (!selectedIngredient) {
    throw new Error(`Google Flow did not attach "${filename}" to the prompt.`);
  }
}

async function findPromptField(page) {
  const candidates = page.locator('textarea, [contenteditable="true"], input[type="text"]');
  const count = await candidates.count();
  let fallback;
  for (let index = 0; index < count; index += 1) {
    const candidate = candidates.nth(index);
    if (!await candidate.isVisible()) continue;
    const marker = [
      await candidate.getAttribute('placeholder'),
      await candidate.getAttribute('aria-label'),
    ].join(' ');
    if (/prompt|describe|image|write/i.test(marker)) return candidate;
    if (!fallback && await candidate.evaluate((element) => (
      element.tagName === 'TEXTAREA'
      || (element.getAttribute('contenteditable') === 'true' && element.classList.contains('ProseMirror'))
    ))) {
      fallback = candidate;
    }
  }
  return fallback;
}

async function generateImage(input) {
  const request = validateGenerateInput(input);
  const referenceImage = await validateReferenceImage(request.referenceImagePath);
  const run = generationQueue.then(() => runGeneration(request, referenceImage));
  generationQueue = run.catch(() => {});
  return run;
}

async function runGeneration(request, referenceImage) {
  const page = await getFlowPage();

  await configureGenerationOptions(page, request);
  if (referenceImage) await attachReferenceImage(page, referenceImage);

  const promptField = await findPromptField(page);
  if (!promptField) {
    throw new Error('Google Flow prompt field was not found. The Flow interface may have changed.');
  }
  const existingSources = await page.locator('img').evaluateAll((images) => images.map((image) => image.currentSrc || image.src));
  await promptField.fill(request.prompt);
  const generateButton = await waitForVisible(
    page.getByRole('button', { name: /start generation/i }),
    'Google Flow Start generation button was not found.',
  );
  if (!generateButton) {
    throw new Error('Google Flow generate button was not found. The Flow interface may have changed.');
  }
  if (!await generateButton.isEnabled()) {
    throw new Error('Google Flow generate button is disabled. Check that the prompt and any reference image were accepted.');
  }
  await generateButton.click();

  try {
    await page.waitForFunction(
      (previousSources) => Array.from(document.querySelectorAll('img.image[data-media-id]')).some((image) => {
        const rect = image.getBoundingClientRect();
        const source = image.currentSrc || image.src;
        return image.complete
          && image.naturalWidth >= 256
          && image.naturalHeight >= 256
          && rect.width > 0
          && rect.height > 0
          && !previousSources.includes(source);
      }) || Boolean(document.body?.innerText.match(/we noticed some unusual activity|not enough credits|insufficient credits|generation failed|failed to generate/i)),
      existingSources,
      { timeout: 240000 },
    );
  } catch (error) {
    if (error.name !== 'TimeoutError') {
      throw new Error(`Google Flow generation ended before an image appeared: ${error.message}`);
    }
    throw new Error('Google Flow did not show a completed image within 4 minutes. The request may still be processing or Flow may have rejected it.');
  }

  pageText = await page.locator('body').innerText();
  const failureMessage = getGenerationFailureMessage(pageText);
  if (failureMessage) throw new Error(failureMessage);

  const imageIndex = await page.locator('img').evaluateAll((images, previousSources) => {
    const candidates = images.map((image, index) => ({
      index,
      source: image.currentSrc || image.src,
      loaded: image.complete && image.naturalWidth >= 256 && image.naturalHeight >= 256,
      mediaId: image.getAttribute('data-media-id'),
      visible: image.getBoundingClientRect().width > 0 && image.getBoundingClientRect().height > 0,
    })).filter((image) => image.mediaId && image.loaded && image.visible && !previousSources.includes(image.source));
    return candidates.length ? candidates[candidates.length - 1].index : -1;
  }, existingSources);
  if (imageIndex < 0) {
    throw new Error('Google Flow indicated generation completed, but the generated image could not be located.');
  }

  const image = page.locator('img').nth(imageIndex);
  const imageSource = await image.evaluate((element) => ({
    url: element.currentSrc || element.src,
    width: element.naturalWidth,
    height: element.naturalHeight,
  }));
  if (imageSource.width < 256 || imageSource.height < 256) {
    throw new Error('Google Flow showed a result placeholder rather than a full-size generated image.');
  }
  const imageResponse = await page.request.get(imageSource.url, { timeout: 30000 });
  if (!imageResponse.ok()) {
    throw new Error(`Google Flow image download failed with HTTP ${imageResponse.status()}.`);
  }
  const imageBytes = await imageResponse.body();
  const mimeType = imageResponse.headers()['content-type']?.split(';')[0].trim().toLowerCase();
  validateGeneratedImage(imageBytes, mimeType);
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/jpeg' ? 'jpg' : 'webp';
  const outputPath = path.join(
    OUTPUT_DIR,
    `google-flow-${Date.now()}-${randomBytes(4).toString('hex')}.${extension}`,
  );
  await fs.writeFile(outputPath, imageBytes);
  return {
    path: outputPath,
    image: imageBytes.toString('base64'),
    mimeType,
  };
}

module.exports = {
  generateImage,
  getGenerationOptions,
  closeBrowserContext,
  validateGenerateInput,
  validateReferenceImage,
  isGoogleSignInUrl,
  findBraveExecutable,
  buildBraveArgs,
  prepareBraveProfile,
  configureGenerationOptions,
  getGenerationFailureMessage,
  choosePreferredImageModel,
  validateGeneratedImage,
  FLOW_URL,
  PROFILE_DIR,
  PROFILE_LABEL,
  OUTPUT_DIR,
};
