const assert = require('node:assert/strict');
const test = require('node:test');
const axios = require('axios');
const flowService = require('../src/services/flowService');

function resetFlowStatusState(t) {
  const previous = {
    get: axios.get,
    cache: flowService.flowStatusCache,
    revision: flowService.flowStatusRevision,
    request: flowService.flowStatusRequest,
    houseCache: flowService.houseAccountsCache,
  };
  flowService.flowStatusCache = { at: 0, value: null };
  flowService.flowStatusRevision = 0;
  flowService.flowStatusRequest = null;
  flowService.houseAccountsCache = { at: 0, ids: [] };
  t.after(() => {
    axios.get = previous.get;
    flowService.flowStatusCache = previous.cache;
    flowService.flowStatusRevision = previous.revision;
    flowService.flowStatusRequest = previous.request;
    flowService.houseAccountsCache = previous.houseCache;
  });
}

test('deduplicates concurrent cold reads and caches successful status briefly', async (t) => {
  resetFlowStatusState(t);
  let calls = 0;
  let resolveRequest;
  axios.get = async (_url, options) => {
    calls += 1;
    assert.equal(options.timeout, 20000);
    return new Promise((resolve) => { resolveRequest = resolve; });
  };

  const first = flowService.getStatus();
  const second = flowService.getStatus();
  assert.equal(calls, 1);
  resolveRequest({
    data: {
      ok: true,
      ready: true,
      accounts: { connectedAccountIds: ['ff2'], readyForGeneration: true },
    },
  });

  const [firstStatus, secondStatus] = await Promise.all([first, second]);
  assert.deepEqual(firstStatus, secondStatus);
  assert.equal(firstStatus.success, true);
  assert.equal((await flowService.getStatus()).accounts.connectedAccountIds[0], 'ff2');
  assert.equal(calls, 1);
});

test('an invalidation during an in-flight read prevents stale status from reaching callers or cache', async (t) => {
  resetFlowStatusState(t);
  const resolveRequests = [];
  axios.get = async () => new Promise((resolve) => resolveRequests.push(resolve));

  const beforeInvalidation = flowService.getStatus();
  flowService.invalidateStatusCache();
  const afterInvalidation = flowService.getStatus();
  assert.equal(resolveRequests.length, 2);

  resolveRequests[0]({
    data: { ready: true, accounts: { connectedAccountIds: ['ff2'] }, marker: 'stale' },
  });
  await new Promise((resolve) => setImmediate(resolve));
  resolveRequests[1]({
    data: { ready: false, accounts: { connectedAccountIds: [] }, marker: 'fresh' },
  });

  const [firstStatus, secondStatus] = await Promise.all([beforeInvalidation, afterInvalidation]);
  assert.equal(firstStatus.marker, 'fresh');
  assert.equal(secondStatus.marker, 'fresh');
  assert.deepEqual(firstStatus.accounts.connectedAccountIds, []);
  assert.equal((await flowService.getStatus()).marker, 'fresh');
  assert.equal(resolveRequests.length, 2);
});

test('gateway timeout fails closed and briefly caches an explicit retryable error', async (t) => {
  resetFlowStatusState(t);
  let calls = 0;
  axios.get = async (_url, options) => {
    calls += 1;
    assert.equal(options.timeout, 20000);
    throw Object.assign(new Error('timeout of 20000ms exceeded'), { code: 'ECONNABORTED' });
  };

  const status = await flowService.getStatus();
  assert.equal(status.success, false);
  assert.equal(status.code, 'FLOW_STATUS_TIMEOUT');
  assert.equal(status.ready, false);
  assert.match(status.message, /no connected account has been assumed/);
  assert.equal(Object.hasOwn(status, 'accounts'), false);
  assert.deepEqual(await flowService.getStatus(), status);
  assert.equal(calls, 1);

  flowService.invalidateStatusCache();
  await flowService.getStatus();
  assert.equal(calls, 2);
});

test('response budget returns pending without account claims while the shared status read continues', async (t) => {
  resetFlowStatusState(t);
  let resolveRequest;
  const request = {
    revision: flowService.flowStatusRevision,
    startedAt: Date.now() - 10,
    promise: new Promise((resolve) => { resolveRequest = resolve; }),
  };

  flowService.houseAccountsCache = { at: Date.now(), ids: ['ff2'] };
  flowService.flowStatusRequest = request;
  const pending = await flowService.getStatus();
  assert.equal(pending.success, false);
  assert.equal(pending.code, 'FLOW_STATUS_PENDING');
  assert.equal(pending.pending, true);
  assert.equal(pending.ready, false);
  assert.equal(Object.hasOwn(pending, 'accounts'), false);
  assert.match(pending.message, /No account is reported connected/);
  assert.deepEqual(await flowService.houseAccounts({ status: pending }), []);

  resolveRequest({
    success: true,
    ready: true,
    accounts: { connectedAccountIds: ['ff2'] },
  });
  const confirmed = await flowService.waitForStatus({ ...request, promise: Promise.resolve({
    success: true,
    ready: true,
    accounts: { connectedAccountIds: ['ff2'] },
  }) }, 100);
  assert.equal(confirmed.success, true);
  assert.deepEqual(confirmed.accounts.connectedAccountIds, ['ff2']);
});

test('status-provided house-account results replace cache and failures clear stale ids', async (t) => {
  resetFlowStatusState(t);
  axios.get = async () => { throw new Error('unexpected gateway call'); };
  flowService.houseAccountsCache = { at: Date.now(), ids: ['ff2'] };

  const disconnected = await flowService.houseAccounts({
    status: { success: true, accounts: { connectedAccountIds: [] } },
  });
  assert.deepEqual(disconnected, []);
  assert.deepEqual(flowService.houseAccountsCache.ids, []);

  flowService.houseAccountsCache = { at: Date.now(), ids: ['ff3'] };
  const unavailable = await flowService.houseAccounts({ status: { success: false } });
  assert.deepEqual(unavailable, []);
  assert.deepEqual(flowService.houseAccountsCache.ids, []);
});
