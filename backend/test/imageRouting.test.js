const assert = require('node:assert/strict');
const test = require('node:test');
const axios = require('axios');
const fs = require('node:fs');
const flowService = require('../src/services/flowService');

function resetMocks(t) {
  const prev = {
    get: axios.get,
    post: axios.post,
    writeFileSync: fs.writeFileSync,
    houseAccounts: flowService.houseAccounts,
    candidateAccounts: flowService.candidateAccounts,
    generateImageViaOmniRoute: flowService.generateImageViaOmniRoute,
  };
  t.after(() => {
    axios.get = prev.get;
    axios.post = prev.post;
    fs.writeFileSync = prev.writeFileSync;
    flowService.houseAccounts = prev.houseAccounts;
    flowService.candidateAccounts = prev.candidateAccounts;
    flowService.generateImageViaOmniRoute = prev.generateImageViaOmniRoute;
    flowService.houseAccountsCache = { at: 0, ids: [] };
  });
  flowService.houseAccountsCache = { at: 0, ids: [] };
  axios.get = async () => {
    throw new Error('Unexpected image download request in mocked routing test');
  };
  fs.writeFileSync = () => {};
  return prev;
}

test('OmniRoute image models tried in configured order and Agnes used after first failure', async (t) => {
  resetMocks(t);
  const attempts = [];
  const savedFiles = [];
  fs.writeFileSync = (filePath, image) => savedFiles.push({ filePath, size: image.length });

  // Make Nano Banana 2.1 fail, then let the mocked Agnes response succeed.
  axios.post = async (url, payload, options) => {
    assert.equal(url, 'http://127.0.0.1:20128/v1/images/generations');
    assert.equal(options.timeout, 60000);
    const model = payload.model;
    attempts.push(model);
    if (model === 'agy/gemini-3.1-flash-image') {
      const err = new Error('mock provider error');
      err.response = { status: 503, data: { error: 'unavailable' } };
      throw err;
    }
    assert.equal(model, 'agnes/agnes-image-2.0-flash');

    const big = Buffer.alloc(6000, 0xff).toString('base64');
    return { data: { data: [{ b64_json: big }] } };
  };

  const result = await flowService.generateImageViaOmniRoute({ prompt: 'test', ratio: '1:1' });
  assert.equal(result.ok, true, 'expected a successful fallback result');
  assert.deepEqual(attempts, [
    'agy/gemini-3.1-flash-image',
    'agnes/agnes-image-2.0-flash',
  ]);
  assert.equal(savedFiles.length, 1);
  assert.equal(savedFiles[0].size, 6000);
  assert.equal(result.model, 'agnes/agnes-image-2.0-flash');
  assert.equal(result.servedBy, 'omniroute-fallback');
});

test('Agnes is not attempted when Nano Banana succeeds', async (t) => {
  resetMocks(t);
  const attempts = [];
  const savedFiles = [];
  fs.writeFileSync = (filePath, image) => savedFiles.push({ filePath, size: image.length });
  axios.post = async (_url, payload) => {
    attempts.push(payload.model);
    assert.equal(payload.model, 'agy/gemini-3.1-flash-image');
    return { data: { data: [{ b64_json: Buffer.alloc(6000, 0xff).toString('base64') }] } };
  };

  const result = await flowService.generateImageViaOmniRoute({ prompt: 'test', ratio: '1:1' });
  assert.equal(result.ok, true);
  assert.deepEqual(attempts, ['agy/gemini-3.1-flash-image']);
  assert.equal(savedFiles.length, 1);
  assert.equal(savedFiles[0].size, 6000);
});

test('generateMedia falls back to generateImageViaOmniRoute when no Flow accounts', async (t) => {
  resetMocks(t);

  // Ensure candidateAccounts returns empty (no connected Flow accounts)
  flowService.candidateAccounts = async () => [];

  let called = false;
  flowService.generateImageViaOmniRoute = async () => {
    called = true;
    return {
      ok: true,
      url: '/api/media/mock.png',
      filename: 'mock.png',
      mediaType: 'image',
      servedBy: 'omniroute-fallback',
      model: 'agy/gemini-3.1-flash-image',
    };
  };

  const res = await flowService.generateMedia({ prompt: 'fallback test', mediaType: 'image' });
  assert.equal(called, true, 'expected generateImageViaOmniRoute to be called');
  assert.equal(res.ok, true);
  assert.equal(res.servedBy, 'omniroute-fallback');
});
