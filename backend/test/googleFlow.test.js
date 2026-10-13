const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  validateGenerateInput,
  validateReferenceImage,
  isGoogleSignInUrl,
  findBraveExecutable,
  buildBraveArgs,
  prepareBraveProfile,
  getGenerationFailureMessage,
  choosePreferredImageModel,
  validateGeneratedImage,
  FLOW_URL,
  PROFILE_DIR,
  PROFILE_LABEL,
} = require('../src/services/googleFlowService');

test('uses current Flow app origin and identifies Google sign-in redirects', () => {
  assert.equal(FLOW_URL, 'https://flow.google.com/');
  assert.equal(PROFILE_DIR, path.join(os.homedir(), '.contentbot', 'google-flow', 'brave-profile'));
  assert.equal(isGoogleSignInUrl('https://accounts.google.com/v3/signin/identifier'), true);
  assert.equal(isGoogleSignInUrl('https://flow.google.com/about'), false);
  assert.equal(isGoogleSignInUrl('https://flow.google.com/tools/flow'), false);
});

test('reports Flow unusual-activity rejection and never treats it as success', () => {
  assert.match(
    getGenerationFailureMessage('Failed\nWe noticed some unusual activity.\nYou have not been charged for this generation.'),
    /unusual browser activity/,
  );
  assert.match(
    getGenerationFailureMessage('Not enough credits'),
    /not have enough credits/,
  );
  assert.equal(getGenerationFailureMessage('Generation finished'), undefined);
});

test('prefers Nano Banana 2.1 or Pro 2 over non-versioned and lite options', () => {
  assert.equal(choosePreferredImageModel([
    '🍌 Nano Banana Pro',
    '🍌 Nano Banana 2 Lite',
    '🍌 Nano Banana 2.1',
  ], '🍌 Nano Banana Pro'), '🍌 Nano Banana 2.1');
  assert.equal(choosePreferredImageModel([
    'Nano Banana 2 Lite',
    'Nano Banana Pro 2',
  ]), 'Nano Banana Pro 2');
  assert.equal(choosePreferredImageModel(['Other Model'], 'Other Model'), 'Other Model');
  assert.equal(choosePreferredImageModel([]), undefined);
});

test('accepts real PNG, JPEG, and WebP payloads and rejects screenshots or placeholders', () => {
  validateGeneratedImage(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, ...new Array(16).fill(0)]), 'image/png');
  validateGeneratedImage(Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg');
  validateGeneratedImage(Buffer.from('RIFF0000WEBP'), 'image/webp');
  assert.throws(() => validateGeneratedImage(Buffer.from('not an image'), 'image/png'), /invalid or unsupported image payload/);
  assert.throws(() => validateGeneratedImage(Buffer.from('RIFF0000WEBP'), 'image/gif'), /invalid or unsupported image payload/);
});

test('finds Brave or reports a clear installation/configuration error', () => {
  assert.equal(findBraveExecutable({
    configuredPath: '/custom/brave',
    exists: (filePath) => filePath === '/custom/brave',
    realpath: (filePath) => filePath,
  }), '/custom/brave');
  assert.equal(findBraveExecutable({
    configuredPath: '',
    candidates: ['/missing', '/installed/brave'],
    exists: (filePath) => filePath === '/installed/brave',
    realpath: (filePath) => filePath,
  }), '/installed/brave');
  assert.throws(() => findBraveExecutable({
    configuredPath: '/missing/brave',
    exists: () => false,
    realpath: (filePath) => filePath,
  }), /GOOGLE_FLOW_BRAVE_PATH does not exist/);
  assert.throws(() => findBraveExecutable({
    configuredPath: '',
    candidates: ['/missing'],
    exists: () => false,
    realpath: (filePath) => filePath,
  }), /Brave Browser was not found/);
});

test('uses normal Brave for login and supports visible/headless automation on loopback only', () => {
  const loginArgs = buildBraveArgs({
    profileDir: '/tmp/image-generator-profile',
    headless: false,
    url: FLOW_URL,
  });
  assert.deepEqual(loginArgs, [
    '--user-data-dir=/tmp/image-generator-profile',
    '--no-first-run',
    '--no-default-browser-check',
    FLOW_URL,
  ]);
  assert.equal(loginArgs.some((arg) => /enable-automation|remote-debugging|headless/.test(arg)), false);

  const headedArgs = buildBraveArgs({
    profileDir: '/tmp/image-generator-profile',
    headless: false,
    port: 23456,
  });
  assert.deepEqual(headedArgs, [
    '--user-data-dir=/tmp/image-generator-profile',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=23456',
    'about:blank',
  ]);
  assert.equal(headedArgs.some((arg) => /enable-automation|headless/.test(arg)), false);

  const headlessArgs = buildBraveArgs({
    profileDir: '/tmp/image-generator-profile',
    headless: true,
    port: 12345,
  });
  assert.equal(headlessArgs.includes('--headless=new'), true);
  assert.equal(headlessArgs.includes('--remote-debugging-address=127.0.0.1'), true);
  assert.equal(headlessArgs.includes('--remote-debugging-port=12345'), true);
  assert.equal(headlessArgs.some((arg) => /enable-automation|remote-debugging-pipe/.test(arg)), false);
});

test('labels only the isolated Brave profile Image Generator and locks its metadata permissions', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'flow-brave-profile-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await prepareBraveProfile(directory);
  const state = JSON.parse(await fs.readFile(path.join(directory, 'Local State'), 'utf8'));
  assert.equal(state.profile.info_cache.Default.name, PROFILE_LABEL);
  assert.equal(state.profile.info_cache.Default.is_using_default_name, false);
  assert.equal((await fs.stat(directory)).mode & 0o777, 0o700);
  assert.equal((await fs.stat(path.join(directory, 'Local State'))).mode & 0o777, 0o600);
});

test('normalizes a valid image generation request', () => {
  assert.deepEqual(validateGenerateInput({
    prompt: '  A bright, red kite  ',
    model: ' Imagen 4 ',
    aspectRatio: '16:9',
    referenceImagePath: '  ./reference.webp  ',
  }), {
    prompt: 'A bright, red kite',
    model: 'Imagen 4',
    aspectRatio: '16:9',
    referenceImagePath: './reference.webp',
  });
});

test('rejects invalid prompt, model, ratio, and reference path inputs', () => {
  for (const input of [
    { prompt: '   ' },
    { prompt: 'x'.repeat(4001) },
    { prompt: 'valid', model: ' ' },
    { prompt: 'valid', aspectRatio: 'sixteen-nine' },
    { prompt: 'valid', referenceImagePath: ' ' },
  ]) {
    assert.throws(() => validateGenerateInput(input));
  }
});

test('allows supported reference image formats and rejects other files', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'google-flow-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const imagePath = path.join(directory, 'sample.webp');
  const textPath = path.join(directory, 'sample.txt');
  await fs.writeFile(imagePath, 'image');
  await fs.writeFile(textPath, 'not an image');

  assert.deepEqual(await validateReferenceImage(imagePath), {
    path: imagePath,
    mimeType: 'image/webp',
  });
  await assert.rejects(validateReferenceImage(path.join(directory, 'missing.png')), /not found/);
  await assert.rejects(validateReferenceImage(textPath), /PNG, JPEG, or WebP/);
  await assert.rejects(validateReferenceImage(directory), /regular image file/);
  await fs.truncate(imagePath, 20 * 1024 * 1024 + 1);
  await assert.rejects(validateReferenceImage(imagePath), /20 MB or smaller/);
});
