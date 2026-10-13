const flowService = require('./flowService');
const imageQuotaService = require('./imageGenerationQuotaService');

const IMAGE_MODELS = new Set(['nano-banana-2', 'nano-banana-pro', 'nano-banana-2-lite', 'ui-default']);
const DEFAULT_IMAGE_MODEL = 'nano-banana-pro';
const IMAGE_MODEL_NAMES = new Map([
  ['nano-banana-2', 'Nano Banana 2.1'],
  ['nano-banana-pro', 'Nano Banana Pro'],
  ['nano-banana-2-lite', 'Nano Banana 2 Lite'],
  ['ui-default', 'Workspace Default'],
]);

function quotaIdentity({ userId, ip }) {
  return userId ? `user:${String(userId)}` : `guest:${String(ip || 'unknown')}`;
}

function effectiveTier(user, now = new Date()) {
  const tier = user?.subscription?.tier;
  if (!['pro', 'enterprise'].includes(tier)) return 'free';
  const expiresAt = user?.subscription?.expiresAt ? new Date(user.subscription.expiresAt) : null;
  if (user.subscription.status !== 'active' || (expiresAt && expiresAt <= now)) return 'free';
  return tier;
}

class ImageGenerationService {
  async getQuota({ user = null, userId = null, ip = null, now = new Date() }) {
    const id = userId || user?._id;
    const identity = quotaIdentity({ userId: id, ip });
    const tier = effectiveTier(user, now);
    return {
      tier,
      imageQuota: await imageQuotaService.getQuota(
        identity,
        tier,
        tier === 'free' ? null : user?.subscription?.startDate,
        now,
      ),
    };
  }

  async generate({
    prompt,
    ratio = '1:1',
    model = DEFAULT_IMAGE_MODEL,
    user = null,
    userId = null,
    ip = null,
    now = new Date(),
  }) {
    const id = userId || user?._id;
    const identity = quotaIdentity({ userId: id, ip });
    const tier = effectiveTier(user, now);
    const selectedModel = IMAGE_MODELS.has(String(model)) ? String(model) : DEFAULT_IMAGE_MODEL;
    const modelName = IMAGE_MODEL_NAMES.get(selectedModel) || selectedModel;
    const reservation = await imageQuotaService.reserve(
      identity,
      tier,
      tier === 'free' ? null : user?.subscription?.startDate,
      now,
    );
    if (!reservation.allowed) {
      return {
        ok: false,
        code: 'IMAGE_QUOTA_LIMIT',
        error: `Image generation limit reached (${reservation.quota.used}/${reservation.quota.limit}).`,
        imageQuota: reservation.quota,
        model: selectedModel,
        modelName,
      };
    }

    try {
      const result = await flowService.generateMedia({
        prompt,
        mediaType: 'image',
        ratio,
        model: selectedModel,
        accountId: flowService.accountIdForGeneration(user, 'image'),
      });
      const providerName = result?.servedBy === 'omniroute-fallback'
        ? 'OmniRoute'
        : 'Google Flow';
      const actualModel = result?.model || selectedModel;
      const actualModelName = result?.modelName || actualModel;
      if (!result?.url && !result?.pending) {
        const imageQuota = await reservation.release();
        return {
          ...result,
          imageQuota,
          requestedModel: selectedModel,
          model: actualModel,
          modelName: actualModelName,
          providerName,
        };
      }
      return {
        ...result,
        imageQuota: reservation.quota,
        requestedModel: selectedModel,
        model: actualModel,
        modelName: actualModelName,
        providerName,
      };
    } catch (error) {
      await reservation.release();
      throw error;
    }
  }
}

module.exports = new ImageGenerationService();
module.exports.quotaIdentity = quotaIdentity;
module.exports.effectiveTier = effectiveTier;
