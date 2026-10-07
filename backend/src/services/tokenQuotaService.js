/**
 * Token Quota Service
 * Enforces the 1,000,000 tokens per 7-day limit for all users.
 * Auto-resets usage after 7 days.
 */

const User = require('../models/User');

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_WEEKLY_LIMIT = 1000000; // 1 Million tokens

class TokenQuotaService {
  /**
   * Check and auto-reset user's 7-day token quota
   * @param {Object} user - mongoose User document or user object
   * @returns {Promise<{allowed: boolean, tokensUsed: number, limit: number, remaining: number, daysLeft: number, message?: string}>}
   */
  async checkQuota(userId, estimatedTokens = 100) {
    const user = await User.findById(userId);
    if (!user) return { allowed: false, message: 'User not found' };

    // Initialize quota fields if missing
    if (!user.tokenQuota) {
      user.tokenQuota = {
        weeklyLimit: DEFAULT_WEEKLY_LIMIT,
        tokensUsed7d: 0,
        lastResetDate: new Date(),
        history: [],
      };
    }

    const now = Date.now();
    const lastReset = user.tokenQuota.lastResetDate ? new Date(user.tokenQuota.lastResetDate).getTime() : now;
    const timeDiff = now - lastReset;

    // Auto-reset if 7 days have passed
    if (timeDiff >= SEVEN_DAYS_MS) {
      user.tokenQuota.tokensUsed7d = 0;
      user.tokenQuota.lastResetDate = new Date();
      await user.save();
    }

    const weeklyLimit = user.tokenQuota.weeklyLimit || DEFAULT_WEEKLY_LIMIT;
    const tokensUsed = user.tokenQuota.tokensUsed7d || 0;
    const remaining = Math.max(0, weeklyLimit - tokensUsed);
    const msUntilReset = Math.max(0, SEVEN_DAYS_MS - (now - new Date(user.tokenQuota.lastResetDate).getTime()));
    const daysLeft = Math.ceil(msUntilReset / (24 * 60 * 60 * 1000));

    // Admin has unlimited quota
    if (user.role === 'admin') {
      return {
        allowed: true,
        tokensUsed,
        limit: weeklyLimit,
        remaining,
        daysLeft,
        isAdmin: true,
      };
    }

    if (tokensUsed + estimatedTokens > weeklyLimit) {
      return {
        allowed: false,
        tokensUsed,
        limit: weeklyLimit,
        remaining: 0,
        daysLeft,
        message: `Weekly token limit reached (${tokensUsed.toLocaleString()} / ${weeklyLimit.toLocaleString()} tokens used in the last 7 days). Your quota will reset in ${daysLeft} day(s).`,
      };
    }

    return {
      allowed: true,
      tokensUsed,
      limit: weeklyLimit,
      remaining,
      daysLeft,
    };
  }

  /**
   * Record tokens used by user
   */
  async recordUsage(userId, tokens, model = 'api-model') {
    if (!tokens || tokens <= 0) return;
    try {
      const user = await User.findById(userId);
      if (!user) return;

      if (!user.tokenQuota) {
        user.tokenQuota = {
          weeklyLimit: DEFAULT_WEEKLY_LIMIT,
          tokensUsed7d: 0,
          lastResetDate: new Date(),
          history: [],
        };
      }

      user.tokenQuota.tokensUsed7d = (user.tokenQuota.tokensUsed7d || 0) + tokens;
      user.tokenQuota.history.push({
        date: new Date(),
        tokens,
        model,
      });

      // Keep only last 50 history entries
      if (user.tokenQuota.history.length > 50) {
        user.tokenQuota.history = user.tokenQuota.history.slice(-50);
      }

      await user.save();
    } catch (err) {
      console.error('Failed to record token usage:', err.message);
    }
  }

  /**
   * Admin: Reset a user's token quota
   */
  async resetQuota(userId) {
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');

    if (!user.tokenQuota) {
      user.tokenQuota = { weeklyLimit: DEFAULT_WEEKLY_LIMIT, tokensUsed7d: 0, lastResetDate: new Date() };
    }
    user.tokenQuota.tokensUsed7d = 0;
    user.tokenQuota.lastResetDate = new Date();
    await user.save();
    return user.tokenQuota;
  }

  /**
   * Admin: Update user's weekly limit or subscription
   */
  async updateSubscription(userId, { tier, weeklyLimit, status }) {
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');

    if (tier) user.subscription.tier = tier;
    if (status) user.subscription.status = status;
    if (weeklyLimit !== undefined) {
      if (!user.tokenQuota) user.tokenQuota = { tokensUsed7d: 0, lastResetDate: new Date() };
      user.tokenQuota.weeklyLimit = weeklyLimit;
    }
    await user.save();
    return user;
  }
}

module.exports = new TokenQuotaService();
