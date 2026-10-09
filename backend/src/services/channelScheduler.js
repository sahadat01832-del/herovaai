/**
 * channelScheduler — the part that acts without a browser open.
 *
 * Two jobs, both idempotent so a restart (or a slow tick) can never double-post:
 *
 *   • Daily post   — for every channel with auto-posting on, once per local day,
 *                    at or after the owner's chosen time. Guarded on
 *                    `lastPostAt` falling on a previous day, not on the tick fire.
 *   • YouTube      — new comments are answered through the same AI path as chat,
 *                    walking forward from the last comment it saw.
 *
 * Everything it does lands in the connection's activity list, so "it posted
 * daily" is a claim the owner can check instead of trust.
 */
const ChannelConnection = require('../models/ChannelConnection');
const channelService = require('./channelService');
const adapters = require('./channels/adapters');
const mongoose = require('mongoose');

const TICK_MS = Number(process.env.CHANNEL_TICK_MS || 60000);
let timer = null;
let ticking = false;

const localDay = (date) => {
  const d = date ? new Date(date) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** True when today's post time has passed and nothing has gone out today. */
function postIsDue(connection, now = new Date()) {
  const [hours, minutes] = String(connection.automations?.autoPostTime || '09:00').split(':').map(Number);
  const due = new Date(now);
  due.setHours(hours || 0, minutes || 0, 0, 0);
  if (now < due) return false;
  const last = connection.stats?.lastPostAt ? new Date(connection.stats.lastPostAt) : null;
  return !last || localDay(last) !== localDay(now);
}

async function runDailyPosts(now) {
  const due = await ChannelConnection.find({
    'automations.autoPost': true,
    status: 'connected',
  });
  for (const connection of due) {
    if (!postIsDue(connection, now)) continue;
    // Claim the day before the network call: a crash mid-post must not post
    // twice on the next tick.
    connection.stats.lastPostAt = now;
    await connection.save();
    const result = await channelService.publishToConnection(connection);
    if (!result.ok) {
      // Give the day back so the next tick retries, up to the daily limit.
      connection.stats.lastPostAt = null;
      connection.pushActivity('post', false, `Scheduled post failed: ${result.message}`);
      await connection.save();
    }
  }
}

/** YouTube has no webhooks for comments here; poll the channel's own threads. */
async function runYoutubeComments(now, { minGapMs = 5 * 60 * 1000 } = {}) {
  const connections = await ChannelConnection.find({ channel: 'youtube', 'automations.autoReply': true, status: 'connected' });
  for (const connection of connections) {
    const lastCheck = connection.meta?.lastCommentCheckAt ? new Date(connection.meta.lastCommentCheckAt) : null;
    if (lastCheck && now - lastCheck < minGapMs) continue;

    const feed = await adapters.youtubeNewComments(connection, { since: connection.meta?.lastCommentAt });
    connection.meta = { ...(connection.meta || {}), lastCommentCheckAt: now };
    if (!feed.ok) {
      connection.pushActivity('error', false, `Could not read comments: ${feed.message}`);
      await connection.save();
      continue;
    }

    for (const comment of feed.comments || []) {
      const reply = await channelService.handleInbound(connection, {
        senderId: comment.authorChannelId?.value || comment.authorDisplayName || 'commenter',
        text: comment.textDisplay || comment.textOriginal || '',
        history: [],
        replyTo: { parentId: comment.id },
      });
      if (reply.replied) {
        connection.meta = { ...(connection.meta || {}), lastCommentAt: new Date().toISOString() };
      } else if (reply.reason === 'daily-cap' || reply.reason === 'no-model') {
        break; // nothing will change for the remaining comments either
      }
    }
    await connection.save();
  }
}

async function tick() {
  if (ticking) return;
  if (mongoose.connection.readyState !== 1) return;
  ticking = true;
  const now = new Date();
  try {
    await runDailyPosts(now);
    await runYoutubeComments(now);
  } catch (err) {
    console.warn(`[channels] scheduler tick failed: ${err.message}`);
  } finally {
    ticking = false;
  }
}

/** Start the loop. Safe to call twice — the second call is a no-op. */
function start() {
  if (timer) return { started: false, reason: 'already running' };
  timer = setInterval(() => { void tick(); }, TICK_MS);
  if (timer.unref) timer.unref();
  console.log(`⏱️  Channel scheduler started (every ${Math.round(TICK_MS / 1000)}s)`);
  return { started: true, tickMs: TICK_MS };
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, tick, postIsDue, localDay, _internal: { runDailyPosts, runYoutubeComments } };
