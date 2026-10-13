// Verify personal Flow image fallback routing without making provider requests.
const axios = require('axios');
const flowService = require('../src/services/flowService');
const imageQuotaService = require('../src/services/imageGenerationQuotaService');
const imageGenerationService = require('../src/services/imageGenerationService');

let passed = 0;
let failed = 0;
const check = (name, condition) => {
  if (condition) passed += 1;
  else {
    failed += 1;
    console.error(`  ✗ ${name}`);
  }
};

async function main() {
  const originals = {
    axiosGet: axios.get,
    axiosPost: axios.post,
    houseAccounts: flowService.houseAccounts,
    candidateAccounts: flowService.candidateAccounts,
    generateMedia: flowService.generateMedia,
    reserve: imageQuotaService.reserve,
  };
  flowService.housePool.cooldown.clear();
  flowService.houseAccountsCache = { at: 0, ids: [] };

  try {
    check(
      'only a connected personal Flow account is eligible',
      flowService.accountIdForGeneration({ flowAccountId: 'user_42', flowAccountStatus: 'connected' }, 'image') === 'user_42'
        && flowService.accountIdForGeneration({ flowAccountId: 'user_42', flowAccountStatus: 'needs_attention' }, 'image') === null
        && flowService.accountIdForGeneration({ flowAccountId: 'user_42', flowAccountStatus: 'needs_attention' }, 'video') === 'user_42',
    );
    check(
      'Nano Banana Pro is the default and Nano Banana 2.1 is the next Flow choice',
      flowService.FLOW_MODELS.image[0]?.id === 'nano-banana-pro'
        && flowService.FLOW_MODELS.image[1]?.id === 'nano-banana-2',
    );
    flowService.flowStatusCache = { at: 0, value: null };
    axios.get = async () => ({
      data: { availableModels: { image: [{ id: 'legacy-stale-order' }] } },
    });
    const status = await flowService.getStatus();
    check(
      'Flow status exposes the app model order instead of stale gateway ordering',
      status.availableModels.image[0]?.id === 'nano-banana-pro',
    );
    flowService.flowStatusCache = { at: 0, value: null };

    flowService.houseAccounts = async () => ['ff2'];
    const houseFirst = await flowService.candidateAccounts('user_42', true);
    const personalFirst = await flowService.candidateAccounts('user_42');
    check('images try shared Flow before personal Flow', houseFirst.join(',') === 'ff2,user_42');
    check('existing personal-first video order is unchanged', personalFirst.join(',') === 'user_42,ff2');
    flowService.houseAccounts = originals.houseAccounts;

    const attempts = [];
    axios.get = async () => ({
      data: { accounts: { connectedAccountIds: ['ff2'], readyForGeneration: true } },
    });
    axios.post = async (_url, payload) => {
      attempts.push(payload.accountId);
      if (payload.accountId === 'ff2') {
        const error = new Error('mock shared account unavailable');
        error.response = { status: 503, data: { error: error.message } };
        throw error;
      }
      return { data: { url: '/api/media/mock-image.png', model: payload.model } };
    };
    flowService.houseAccountsCache = { at: 0, ids: [] };
    const routed = await flowService.generateMedia({
      prompt: 'mock only',
      mediaType: 'image',
      model: 'nano-banana-pro',
      accountId: 'user_42',
    });
    check('failed shared account falls back to personal Flow', attempts.join(',') === 'ff2,user_42');
    check('personal Flow fallback returns its image', routed.url === '/api/media/mock-image.png' && routed.servedBy === 'user_42');

    let generationOptions;
    imageQuotaService.reserve = async () => ({
      allowed: true,
      quota: { used: 1, limit: 10 },
      release: async () => ({ used: 0, limit: 10 }),
    });
    flowService.generateMedia = async (options) => {
      generationOptions = options;
      return { ok: true, url: '/api/media/mock-image.png', servedBy: 'user_42', model: options.model };
    };
    const generated = await imageGenerationService.generate({
      prompt: 'mock only',
      user: { _id: '42', flowAccountId: 'user_42', flowAccountStatus: 'connected' },
      ip: '127.0.0.1',
    });
    check('image service forwards the connected Flow account', generationOptions.accountId === 'user_42');
    check('result attributes image generation to Google Flow', generated.providerName === 'Google Flow');

    const fallbackAttempts = [];
    flowService.generateMedia = originals.generateMedia;
    flowService.candidateAccounts = async () => [];
    axios.post = async (_url, payload) => {
      fallbackAttempts.push(payload.model);
      const error = new Error('mock provider unavailable');
      error.response = { status: 503, data: { error: error.message } };
      throw error;
    };
    const fallbackFailure = await flowService.generateMedia({
      prompt: 'mock fallback order',
      mediaType: 'image',
      model: 'nano-banana-pro',
    });
    check(
      'no-account fallback tries Nano Banana 2.1 before Agnes',
      fallbackAttempts.join(',') === 'agy/gemini-3.1-flash-image,agnes/agnes-image-2.0-flash',
    );
    check(
      'unavailable backup providers return a clear failure instead of a false image',
      fallbackFailure.ok === false && !fallbackFailure.url && /Nano Banana 2\.1.*Agnes/i.test(fallbackFailure.error),
    );
    axios.post = async () => {
      const error = new Error('mock authentication required');
      error.response = { status: 401, data: { error: error.message } };
      throw error;
    };
    const authFailure = await flowService.generateMedia({
      prompt: 'mock auth failure',
      mediaType: 'image',
      model: 'nano-banana-pro',
    });
    check(
      'image gateway auth failures are reported clearly after both fallbacks are attempted',
      authFailure.code === 'IMAGE_PROVIDER_AUTH_REQUIRED' && /server-side credentials/i.test(authFailure.error),
    );
  } finally {
    axios.get = originals.axiosGet;
    axios.post = originals.axiosPost;
    flowService.houseAccounts = originals.houseAccounts;
    flowService.candidateAccounts = originals.candidateAccounts;
    flowService.generateMedia = originals.generateMedia;
    imageQuotaService.reserve = originals.reserve;
    flowService.houseAccountsCache = { at: 0, ids: [] };
    flowService.housePool.cooldown.clear();
  }

  console.log(`\n${failed === 0 ? '✅' : '❌'} image-flow-routing: ${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(`image-flow-routing crashed: ${error.stack || error.message}`);
  process.exitCode = 1;
});
