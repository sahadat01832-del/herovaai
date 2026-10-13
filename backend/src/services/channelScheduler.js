/**
 * channelScheduler — the part that acts without a browser open.
 *
 * Two jobs, both idempotent so a restart (or a slow tick) can never double-post:
 *
 *   • Daily post   — for every channel with auto-posting on, once per local day,
 *                    at or after the owner's chosen time. Guarded on
 *                    `lastPostAt` falling on a previous day, not on the tick fire.
 *   • Comments     — YouTube, Facebook Page posts and TikTok videos have no
 *                    webhook here, so their new comments are read on a timer and
 *                    answered through the same AI path as chat, walking forward
 *                    from the last comment it saw.
 *
 * Everything it does lands in the connection's activity list, so "it posted
 * daily" is a claim the owner can check instead of trust.
 */
const ChannelConnection = require('../models/ChannelConnection');
const ScheduledPost = require('../models/ScheduledPost');
const channelService = require('./channelService');
const adapters = require('./channels/adapters');
const appSettings = require('./appSettings');
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
  // Platform switch first: with scheduled posting off, the due list is never even
  // read, so nothing is claimed and nothing has to be un-claimed.
  if (!appSettings.flag('autoPosts')) return;

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

async function runScheduledPosts(now) {
  if (!appSettings.flag('autoPosts')) return;

  // A claimed post is never automatically retried: after a process crash the
  // platform may already have accepted it, so retrying could publish twice.
  await ScheduledPost.updateMany(
    { status: 'processing', processingAt: { $lt: new Date(now.getTime() - 30 * 60 * 1000) } },
    { $set: { status: 'failed', resultMessage: 'The publisher stopped before confirming delivery. Check the platform before scheduling it again.' } },
  );

  for (let count = 0; count < 10; count += 1) {
    const post = await ScheduledPost.findOneAndUpdate(
      { status: 'scheduled', scheduledAt: { $lte: now } },
      { $set: { status: 'processing', processingAt: now } },
      { sort: { scheduledAt: 1 }, new: true },
    );
    if (!post) break;

    const connection = await ChannelConnection.findOne({
      _id: post.connectionId,
      userId: post.userId,
      channel: post.channel,
      status: 'connected',
    });
    if (!connection) {
      post.status = 'failed';
      post.resultMessage = 'The platform is no longer connected. Reconnect it and schedule this post again.';
      await post.save();
      continue;
    }

    const result = await channelService.publishToConnection(connection, {
      text: post.text,
      mediaUrl: post.mediaUrl || undefined,
    });
    post.status = result.ok ? 'published' : 'failed';
    post.resultMessage = String(result.message || (result.ok ? 'Published' : 'Publishing failed')).slice(0, 500);
    post.publishedAt = result.ok ? new Date() : null;
    await post.save();
  }
}

/**
 * Which channels have public comments worth answering, and how to read them.
 *
 * WhatsApp, Messenger, Instagram DMs and Telegram push their messages to us;
 * these three have no webhook here, so we ask them politely on a timer. Each
 * entry is the function that returns `{ comments: [...] }` — one shape for all of
 * them, so the reply loop below stays platform-agnostic.
 */
const COMMENT_FEEDS = {
  youtube: (connection) => adapters.youtubeNewComments(connection, { since: connection.meta?.lastCommentAt }),
  facebook_page: (connection) => adapters.facebookPageNewComments(connection, { since: connection.meta?.lastCommentAt }),
  tiktok: (connection) => adapters.tiktokNewComments(connection, { since: connection.meta?.lastCommentAt }),
};

/** Poll every channel that has a comment feed and answer what is new. */
async function runCommentReplies(now, { minGapMs = 5 * 60 * 1000 } = {}) {
  const connections = await ChannelConnection.find({
    channel: { $in: Object.keys(COMMENT_FEEDS) },
    'automations.autoReply': true,
    status: 'connected',
  });
  for (const connection of connections) {
    const feedFor = COMMENT_FEEDS[connection.channel];
    if (!feedFor) continue;
    const lastCheck = connection.meta?.lastCommentCheckAt ? new Date(connection.meta.lastCommentCheckAt) : null;
    if (lastCheck && now - lastCheck < minGapMs) continue;

    const feed = await feedFor(connection);
    connection.meta = { ...(connection.meta || {}), lastCommentCheckAt: now };
    if (!feed.ok) {
      connection.pushActivity('error', false, `Could not read comments: ${feed.message}`);
      await connection.save();
      continue;
    }

    for (const comment of feed.comments || []) {
      const reply = await channelService.handleInbound(connection, {
        senderId: comment.authorChannelId?.value || comment.authorDisplayName || 'commenter',
        text: comment.textDisplay || comment.textOriginal || comment.text || '',
        history: [],
        // parentId is the comment being answered; videoId is what TikTok also
        // needs to place the reply. Platforms that do not care simply ignore it.
        replyTo: { parentId: comment.id, videoId: comment.videoId },
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
    await runScheduledPosts(now);
    await runCommentReplies(now);
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

module.exports = { start, stop, tick, postIsDue, localDay, _internal: { runDailyPosts, runScheduledPosts, runCommentReplies } };
