const crypto = require('crypto');
const plans = require('../config/plans');
const ImageGenerationQuota = require('../models/ImageGenerationQuota');

const BILLING_CYCLE_MS = 30 * 24 * 60 * 60 * 1000;
const RETENTION_DAYS = 8;

function freePeriod(now) {
  const period = now.toISOString().slice(0, 10);
  const [year, month, day] = period.split('-').map(Number);
  const resetsAt = new Date(Date.UTC(year, month - 1, day + 1));
  const expiresAt = new Date(resetsAt.getTime() + RETENTION_DAYS * 24 * 60 * 60 * 1000);
  return { key: period, period: 'day', resetsAt, expiresAt };
}

function billingPeriod(now, subscriptionStartDate) {
  const parsedAnchor = new Date(subscriptionStartDate || now);
  const anchor = Number.isFinite(parsedAnchor.getTime()) && parsedAnchor.getTime() <= now.getTime()
    ? parsedAnchor
    : now;
  const cycleIndex = Math.floor((now.getTime() - anchor.getTime()) / BILLING_CYCLE_MS);
  const cycleStart = new Date(anchor.getTime() + cycleIndex * BILLING_CYCLE_MS);
  const resetsAt = new Date(cycleStart.getTime() + BILLING_CYCLE_MS);
  const expiresAt = new Date(resetsAt.getTime() + RETENTION_DAYS * 24 * 60 * 60 * 1000);
  return {
    key: `billing:${cycleStart.toISOString()}`,
    period: 'billing cycle',
    resetsAt,
    expiresAt,
  };
}

function currentPeriod(tier, now = new Date(), subscriptionStartDate = null) {
  return tier === 'pro' || tier === 'enterprise'
    ? billingPeriod(now, subscriptionStartDate)
    : freePeriod(now);
}

function quotaKey(identity, period) {
  return crypto.createHash('sha256').update(`${identity}\0${period}`).digest('hex');
}

function snapshot(count, resetsAt, tier) {
  const used = Math.max(0, Number(count) || 0);
  const allowance = plans.imageQuotaFor(tier);
  return {
    limit: allowance.limit,
    used,
    remaining: allowance.unlimited ? null : Math.max(0, allowance.limit - used),
    period: allowance.period,
    unlimited: allowance.unlimited,
    resetsAt,
  };
}

class ImageGenerationQuotaService {
  async getQuota(identity, tier = 'free', subscriptionStartDate = null, now = new Date()) {
    const period = currentPeriod(tier, now, subscriptionStartDate);
    const _id = quotaKey(identity, period.key);
    const record = await ImageGenerationQuota.findById(_id).lean();
    return snapshot(record?.count, period.resetsAt, tier);
  }

  async reserve(identity, tier = 'free', subscriptionStartDate = null, now = new Date()) {
    const period = currentPeriod(tier, now, subscriptionStartDate);
    const allowance = plans.imageQuotaFor(tier);
    const _id = quotaKey(identity, period.key);
    const canIncrement = allowance.unlimited ? {} : { count: { $lt: allowance.limit } };

    let record = await ImageGenerationQuota.findOneAndUpdate(
      { _id, ...canIncrement },
      { $inc: { count: 1 } },
      { new: true }
    );

    if (!record) {
      try {
        record = await ImageGenerationQuota.create({
          _id,
          period: period.key,
          count: 1,
          expiresAt: period.expiresAt,
        });
      } catch (error) {
        if (error?.code !== 11000) throw error;
        record = await ImageGenerationQuota.findOneAndUpdate(
          { _id, ...canIncrement },
          { $inc: { count: 1 } },
          { new: true }
        );
      }
    }

    if (!record) {
      const existing = await ImageGenerationQuota.findById(_id).lean();
      return { allowed: false, quota: snapshot(existing?.count, period.resetsAt, tier) };
    }

    let released = false;
    return {
      allowed: true,
      quota: snapshot(record.count, period.resetsAt, tier),
      release: async () => {
        if (released) return snapshot(record.count - 1, period.resetsAt, tier);
        released = true;
        const updated = await ImageGenerationQuota.findOneAndUpdate(
          { _id, count: { $gt: 0 } },
          { $inc: { count: -1 } },
          { new: true }
        ).lean();
        return snapshot(updated?.count, period.resetsAt, tier);
      },
    };
  }
}

module.exports = new ImageGenerationQuotaService();
module.exports.currentPeriod = currentPeriod;
module.exports.quotaKey = quotaKey;
