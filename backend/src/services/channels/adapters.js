/**
 * adapters — the only place that talks to a platform's API.
 *
 * Every function takes the stored connection and returns { ok, message, … }:
 * nothing throws at the caller, because "Facebook said the token expired" is a
 * normal, displayable outcome, not a 500.
 *
 * Secrets are read from `connection.credentials` here and used immediately —
 * never logged, never echoed back in `message` beyond what the platform itself
 * returns (Meta's error text is safe; tokens are not, so they are never
 * interpolated into messages).
 */
const crypto = require('crypto');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const GRAPH = 'https://graph.facebook.com/v21.0';
const TELEGRAM = 'https://api.telegram.org';
const YOUTUBE = 'https://www.googleapis.com/youtube/v3';
const TIKTOK = 'https://open.tiktokapis.com/v2';
const TIMEOUT = 20000;

const cred = (connection, key) => String(connection?.credentials?.[key] ?? '').trim();

/**
 * Remember what we published and its platform id.
 *
 * Comment polling has to know *where* to look: YouTube finds a channel's own
 * threads by itself, but Facebook and TikTok only hand back comments per post or
 * per video. The publisher writes the id here and the connection is saved right
 * after, so the next poll reads the real comments instead of guessing.
 */
function rememberMedia(connection, { id, kind, url = '' }) {
  if (!id || !connection) return;
  const list = Array.isArray(connection.meta?.recentMedia) ? connection.meta.recentMedia : [];
  const next = list.filter((item) => item.id !== String(id));
  next.push({ id: String(id), kind, url, at: new Date().toISOString() });
  connection.meta = { ...(connection.meta || {}), recentMedia: next.slice(-10) };
}

const http = (method, url, { params, data, headers } = {}) =>
  axios({ method, url, params, data, headers, timeout: TIMEOUT, validateStatus: () => true });

/** Platform error text, shortened — never includes our credentials. */
function failure(res) {
  const body = res?.data || {};
  const message = body.error?.message || body.description || body.message || `HTTP ${res?.status}`;
  return { ok: false, message: String(message).slice(0, 300), status: res?.status || 0, raw: body };
}

/* ─────────────────────────────── Telegram ──────────────────────────────── */

async function telegramTest(connection) {
  const token = cred(connection, 'botToken');
  if (!token) return { ok: false, message: 'Paste the bot token from @BotFather first.' };
  const res = await http('GET', `${TELEGRAM}/bot${token}/getMe`);
  if (res.status !== 200 || !res.data?.ok) return failure(res);
  return { ok: true, message: `Connected as @${res.data.result.username}`, meta: { botUsername: res.data.result.username, botId: res.data.result.id } };
}

async function telegramPublish(connection, text, { mediaUrl, imageUrl } = {}) {
  const token = cred(connection, 'botToken');
  const chatId = cred(connection, 'chatId') || connection?.meta?.chatId;
  if (!token) return { ok: false, message: 'No bot token saved.' };
  if (!chatId) return { ok: false, message: 'Add the channel/group id (or talk to the bot once) to know where to post.' };
  const media = mediaUrl || imageUrl;
  if (media) {
    const isVideo = /\.(mp4|webm|mov)(\?|$)/i.test(media);
    const endpoint = isVideo ? 'sendVideo' : 'sendPhoto';
    const field = isVideo ? 'video' : 'photo';
    try {
      const res = await http('POST', `${TELEGRAM}/bot${token}/${endpoint}`, {
        data: { chat_id: chatId, [field]: media, caption: text.slice(0, 1024) },
      });
      if (res.data?.ok) return { ok: true, message: `Posted ${isVideo ? 'video' : 'photo'} to ${chatId}`, id: String(res.data.result.message_id) };
    } catch {}
  }
  const res = await http('POST', `${TELEGRAM}/bot${token}/sendMessage`, {
    data: { chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: false },
  });
  if (!res.data?.ok) return failure(res);
  return { ok: true, message: `Posted to ${chatId}`, id: String(res.data.result.message_id) };
}

const telegramReply = telegramPublish;

/** Telegram can register its own webhook — no copy-pasting a URL. */
async function telegramRegisterWebhook(connection, publicUrl) {
  const token = cred(connection, 'botToken');
  const secret = cred(connection, 'webhookSecret');
  if (!token) return { ok: false, message: 'No bot token saved.' };
  const payload = { url: publicUrl, allowed_updates: ['message', 'edited_message', 'channel_post'] };
  if (secret) payload.secret_token = secret;
  const res = await http('POST', `${TELEGRAM}/bot${token}/setWebhook`, { data: payload });
  if (!res.data?.ok) return failure(res);
  return { ok: true, message: 'Telegram now delivers messages to this app.' };
}

/** Delete the webhook, so a disconnected bot stops delivering. */
async function telegramRemoveWebhook(connection) {
  const token = cred(connection, 'botToken');
  if (!token) return { ok: false, message: 'No bot token saved.' };
  const res = await http('POST', `${TELEGRAM}/bot${token}/deleteWebhook`, { data: { drop_pending_updates: false } });
  return res.data?.ok ? { ok: true, message: 'Webhook removed' } : failure(res);
}

/* ──────────────────────────── Facebook Graph ───────────────────────────── */

async function facebookPageTest(connection) {
  const token = cred(connection, 'pageToken');
  const pageId = cred(connection, 'pageId');
  if (!token || !pageId) return { ok: false, message: 'Both the Page ID and the Page token are needed.' };
  const res = await http('GET', `${GRAPH}/${pageId}`, { params: { fields: 'name,link', access_token: token } });
  if (res.status !== 200) return failure(res);
  return { ok: true, message: `Connected to “${res.data.name}”`, meta: { pageName: res.data.name, pageLink: res.data.link } };
}

async function facebookPagePublish(connection, text, { mediaUrl, imageUrl } = {}) {
  const token = cred(connection, 'pageToken');
  const pageId = cred(connection, 'pageId');
  if (!token || !pageId) return { ok: false, message: 'Page ID and Page token are required.' };
  const media = mediaUrl || imageUrl;
  if (media && /\.(mp4|webm|mov|mkv|m4v)(\?|$)/i.test(media)) {
    // Video / Reel: Meta fetches the file itself from the public URL (file_url), so
    // a large video never streams through this process. A failed video is reported
    // as a failure — never silently downgraded to a text-only post.
    const res = await http('POST', `${GRAPH}/${pageId}/videos`, {
      data: { file_url: media, description: text.slice(0, 5000), access_token: token },
    });
    if (res.status === 200 && res.data?.id) {
      rememberMedia(connection, { id: res.data.id, kind: 'video', url: media });
      return { ok: true, message: 'Uploaded video to your Page', id: res.data.id };
    }
    return failure(res);
  }
  if (media) {
    try {
      const res = await http('POST', `${GRAPH}/${pageId}/photos`, { data: { url: media, caption: text.slice(0, 5000), access_token: token } });
      if (res.status === 200 && res.data?.id) {
        rememberMedia(connection, { id: res.data.id, kind: 'photo', url: media });
        return { ok: true, message: 'Published photo to your Page', id: res.data.id };
      }
    } catch {}
  }
  const res = await http('POST', `${GRAPH}/${pageId}/feed`, { data: { message: text.slice(0, 5000), access_token: token } });
  if (res.status !== 200 || !res.data?.id) return failure(res);
  rememberMedia(connection, { id: res.data.id, kind: 'text' });
  return { ok: true, message: 'Published to your Page', id: res.data.id };
}

/**
 * Comments viewers left on the Page's own recent posts.
 *
 * Reads a handful of the newest posts we published this session; when nothing is
 * remembered yet it falls back to the Page feed, so a connection that pre-dates
 * the tracking still starts answering. Comments written by the Page itself are
 * dropped — answering your own comment is how a bot talks to itself forever.
 */
async function facebookPageNewComments(connection, { since } = {}) {
  const token = cred(connection, 'pageToken');
  const pageId = cred(connection, 'pageId');
  if (!token || !pageId) return { ok: false, message: 'Page ID and Page token are required.', comments: [] };

  const sinceMs = since ? new Date(since).getTime() : 0;
  const remembered = (connection.meta?.recentMedia || []).filter((item) => item.id).slice(-5);
  const targets = remembered.length ? remembered.map((item) => item.id) : [null];

  const comments = [];
  for (const target of targets) {
    const res = target
      ? await http('GET', `${GRAPH}/${target}/comments`, {
        params: { fields: 'id,message,from,created_time,parent', limit: 25, access_token: token },
      })
      : await http('GET', `${GRAPH}/${pageId}/feed`, {
        params: { fields: 'id,comments.limit(25){id,message,from,created_time,parent}', limit: 5, access_token: token },
      });
    if (res.status !== 200) return { ...failure(res), comments };

    const rows = target
      ? (res.data?.data || [])
      : (res.data?.data || []).flatMap((post) => post.comments?.data || []);

    for (const row of rows) {
      if (row.from?.id && String(row.from.id) === String(pageId)) continue; // our own reply
      if (sinceMs && new Date(row.created_time || 0).getTime() <= sinceMs) continue;
      comments.push({
        id: row.id,
        text: row.message || '',
        authorDisplayName: row.from?.name || 'a follower',
        authorChannelId: { value: row.from?.id || 'viewer' },
        publishedAt: row.created_time,
        postId: target || '',
      });
    }
  }
  return { ok: true, message: `${comments.length} new comment(s)`, comments };
}

/** Reply under one comment (pages_manage_engagement). */
async function facebookCommentReply(connection, { parentId, text }) {
  const token = cred(connection, 'pageToken');
  if (!token) return { ok: false, message: 'The Page access token is missing or expired.' };
  if (!parentId) return { ok: false, message: 'No comment id to answer.' };
  const res = await http('POST', `${GRAPH}/${parentId}/comments`, {
    data: { message: text.slice(0, 8000), access_token: token },
  });
  if (res.status !== 200 || !res.data?.id) return failure(res);
  return { ok: true, message: 'Replied to the comment', id: res.data.id };
}

async function messengerTest(connection) {
  const token = cred(connection, 'pageToken');
  if (!token) return { ok: false, message: 'Paste the Page access token first.' };
  const res = await http('GET', `${GRAPH}/me`, { params: { fields: 'name,id', access_token: token } });
  if (res.status !== 200) return failure(res);
  return { ok: true, message: `Messenger connected to “${res.data.name}”`, meta: { pageName: res.data.name, pageId: res.data.id } };
}

async function messengerReply(connection, { to, text }) {
  const token = cred(connection, 'pageToken');
  if (!token) return { ok: false, message: 'No Page token saved.' };
  const res = await http('POST', `${GRAPH}/me/messages`, {
    params: { access_token: token },
    data: { recipient: { id: to }, messaging_type: 'RESPONSE', message: { text: text.slice(0, 1900) } },
  });
  if (res.status !== 200 || !res.data?.message_id) return failure(res);
  return { ok: true, message: 'Reply sent', id: res.data.message_id };
}

/* ─────────────────────────────── Instagram ─────────────────────────────── */

async function instagramTest(connection) {
  const token = cred(connection, 'pageToken');
  const igId = cred(connection, 'igUserId');
  if (!token || !igId) return { ok: false, message: 'Instagram needs both the business account ID and a Page token.' };
  const res = await http('GET', `${GRAPH}/${igId}`, { params: { fields: 'username,followers_count', access_token: token } });
  if (res.status !== 200) return failure(res);
  return { ok: true, message: `Connected as @${res.data.username}`, meta: { username: res.data.username, followers: res.data.followers_count } };
}

/** Two-step publish: create a media container, then publish it. */
async function instagramPublish(connection, text, { imageUrl, mediaUrl } = {}) {
  const token = cred(connection, 'pageToken');
  const igId = cred(connection, 'igUserId');
  const image = String(imageUrl || mediaUrl || cred(connection, 'imageUrl') || '').trim();
  if (!token || !igId) return { ok: false, message: 'Instagram needs the business account ID and a Page token.' };
  if (!image) return { ok: false, message: 'Instagram only accepts image posts — add a public image URL in the connection settings.' };
  const create = await http('POST', `${GRAPH}/${igId}/media`, { data: { image_url: image, caption: text.slice(0, 2200), access_token: token } });
  if (create.status !== 200 || !create.data?.id) return failure(create);
  const publish = await http('POST', `${GRAPH}/${igId}/media_publish`, { data: { creation_id: create.data.id, access_token: token } });
  if (publish.status !== 200 || !publish.data?.id) return failure(publish);
  return { ok: true, message: 'Published to Instagram', id: publish.data.id };
}

const instagramReply = messengerReply; // DMs ride the same Send API

/* ──────────────────────────────── YouTube ─────────────────────────────── */

/**
 * The access token to call YouTube with right now.
 *
 * Three cases, cheapest first:
 *
 *   • a token we know is still valid (the one-click connect records when it dies) is
 *     used as-is — otherwise every upload and comment reply pays for an extra round
 *     trip to Google for nothing;
 *   • a refresh token with the client id/secret renews it, and the new expiry is
 *     remembered on the connection so the next call takes the cheap path;
 *   • anything else (a hand-pasted access token, or a refresh Google just refused)
 *     falls back to whatever token is stored.
 */
async function youtubeAccessToken(connection) {
  const stored = cred(connection, 'accessToken');
  const expiresAt = Number(connection?.meta?.youtubeTokenExpiresAt || 0);
  // Two minutes of slack: a token that expires mid-upload is worse than one extra call.
  if (stored && expiresAt && Date.now() + 120000 < expiresAt) return stored;

  const refresh = cred(connection, 'refreshToken');
  const clientId = cred(connection, 'clientId');
  const clientSecret = cred(connection, 'clientSecret');
  if (!refresh || !clientId || !clientSecret) return stored;

  const res = await http('POST', 'https://oauth2.googleapis.com/token', {
    data: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refresh, grant_type: 'refresh_token' }).toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  const token = res.data?.access_token;
  if (!token) return stored;

  connection.meta = {
    ...(connection.meta || {}),
    youtubeTokenExpiresAt: Date.now() + (Number(res.data?.expires_in || 3500) * 1000),
  };
  return token;
}

async function youtubeTest(connection) {
  const token = await youtubeAccessToken(connection);
  if (!token) return { ok: false, message: 'Paste an OAuth access token (or a refresh token with client id + secret).' };
  const res = await http('GET', `${YOUTUBE}/channels`, { params: { part: 'snippet,statistics', mine: 'true' }, headers: { Authorization: `Bearer ${token}` } });
  if (res.status !== 200) return failure(res);
  const channel = res.data?.items?.[0];
  if (!channel) return { ok: false, message: 'That token has no channel — sign in with the Google account that owns the channel.' };
  return {
    ok: true,
    message: `Connected to “${channel.snippet.title}” (${channel.statistics.subscriberCount} subscribers)`,
    meta: { channelId: channel.id, channelTitle: channel.snippet.title, subscribers: channel.statistics.subscriberCount },
  };
}

/** Reply to one comment (youtube.force-ssl). */
async function youtubeReply(connection, { parentId, text }) {
  const token = await youtubeAccessToken(connection);
  if (!token) return { ok: false, message: 'The YouTube token is missing or expired.' };
  const res = await http('POST', `${YOUTUBE}/comments`, {
    params: { part: 'snippet' },
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { snippet: { parentId, textOriginal: text.slice(0, 9000) } },
  });
  if (res.status !== 200 || !res.data?.id) return failure(res);
  return { ok: true, message: 'Comment reply posted', id: res.data.id };
}

/** New comments on the channel's own videos, newest first. */
async function youtubeNewComments(connection, { since } = {}) {
  const token = await youtubeAccessToken(connection);
  if (!token) return { ok: false, message: 'The YouTube token is missing or expired.', comments: [] };
  const res = await http('GET', `${YOUTUBE}/commentThreads`, {
    params: { part: 'snippet', allThreadsRelatedToChannelId: cred(connection, 'channelId') || undefined, maxResults: 10, order: 'time' },
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status !== 200) return { ...failure(res), comments: [] };
  const sinceMs = since ? new Date(since).getTime() : 0;
  const comments = (res.data.items || [])
    .map((item) => item.snippet?.topLevelComment?.snippet)
    .filter(Boolean)
    .filter((snippet) => !sinceMs || new Date(snippet.publishedAt).getTime() > sinceMs);
  return { ok: true, message: `${comments.length} new comment(s)`, comments };
}

/**
 * Upload a video file or YouTube Short to the connected YouTube channel.
 * Uses Google Resumable Upload protocol with stream piping (zero memory bloat).
 */
async function youtubePublishVideo(connection, text, { mediaUrl, imageUrl } = {}) {
  const token = await youtubeAccessToken(connection);
  if (!token) return { ok: false, message: 'The YouTube OAuth access token is missing or expired.' };

  const targetMedia = mediaUrl || imageUrl;
  if (!targetMedia) {
    return { ok: false, message: 'YouTube requires a video file or YouTube Short to upload.' };
  }

  // Resolve local file path
  let filePath = null;
  const flowService = require('../flowService');
  if (targetMedia.startsWith('http://') || targetMedia.startsWith('https://')) {
    try {
      const urlObj = new URL(targetMedia);
      const filename = path.basename(urlObj.pathname);
      filePath = flowService.findMediaFile(filename);
    } catch {}
  } else {
    filePath = flowService.findMediaFile(path.basename(targetMedia)) || (fs.existsSync(targetMedia) ? targetMedia : null);
  }

  if (!filePath || !fs.existsSync(filePath)) {
    return { ok: false, message: `Video file could not be found on server: ${targetMedia}` };
  }

  const ext = path.extname(filePath).toLowerCase();
  const isVideo = ['.mp4', '.webm', '.mov', '.mkv', '.m4v'].includes(ext);
  if (!isVideo) {
    return { ok: false, message: 'YouTube only accepts video files (.mp4, .webm, .mov). The selected media is an image.' };
  }

  const stat = fs.statSync(filePath);
  const mimeType = ext === '.webm' ? 'video/webm' : ext === '.mov' ? 'video/quicktime' : 'video/mp4';

  // Extract clean title and description from text
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  let title = lines[0] ? lines[0].replace(/^[#*✨🚀👉]+\s*/, '').trim() : 'New Video';
  if (title.length > 90) title = title.slice(0, 87) + '...';

  // Automatically optimize as YouTube Short if under 60 seconds or requested
  if (!title.toLowerCase().includes('#shorts')) {
    title = `${title} #Shorts`.slice(0, 100);
  }

  const description = `${text}\n\nUploaded via HerovaAi ContentBot`;

  try {
    // Step 1: Initiate Google Resumable Upload Session
    const initRes = await axios.post(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
      {
        snippet: {
          title,
          description: description.slice(0, 5000),
          categoryId: '22',
        },
        status: {
          privacyStatus: 'public',
          selfDeclaredMadeForKids: false,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': mimeType,
          'X-Upload-Content-Length': stat.size,
        },
        timeout: 30000,
      }
    );

    const uploadUrl = initRes.headers['location'];
    if (!uploadUrl) {
      return { ok: false, message: 'YouTube upload initialization failed to return upload session URL.' };
    }

    // Step 2: Stream video bytes to uploadUrl (low-RAM stream directly from disk)
    const uploadRes = await axios.put(uploadUrl, fs.createReadStream(filePath), {
      headers: {
        'Content-Type': mimeType,
        'Content-Length': stat.size,
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 180000,
    });

    const videoId = uploadRes.data?.id;
    if (!videoId) {
      return { ok: false, message: 'YouTube upload finished but no video ID was returned.' };
    }

    const shortUrl = `https://www.youtube.com/shorts/${videoId}`;
    const watchUrl = `https://youtu.be/${videoId}`;
    rememberMedia(connection, { id: videoId, kind: 'video', url: shortUrl });

    return {
      ok: true,
      message: `Published to YouTube! (${shortUrl})`,
      id: videoId,
      url: shortUrl,
      meta: { videoId, shortUrl, watchUrl },
    };
  } catch (err) {
    const errorDetail = err.response?.data?.error?.message || err.message;
    return { ok: false, message: `YouTube upload failed: ${errorDetail}` };
  }
}

/* ─────────────────────────────── TikTok ────────────────────────────────── */

async function tiktokTest(connection) {
  const token = cred(connection, 'accessToken');
  const webhookUrl = cred(connection, 'webhookUrl');

  if (!token && !webhookUrl) {
    return { ok: false, message: 'Provide either a TikTok Creator Access Token or a TikTok Webhook Bridge URL.' };
  }

  // 1. If Webhook Bridge URL provided
  if (webhookUrl) {
    const problem = webhookUrlProblem(webhookUrl);
    if (problem) return { ok: false, message: problem };
    const res = await http('POST', webhookUrl, {
      data: { event: 'test', channel: 'tiktok', text: 'HerovaAi test — TikTok bridge is active.', at: new Date().toISOString() },
      headers: { 'Content-Type': 'application/json' },
    });
    if (res.status >= 200 && res.status < 300) {
      return { ok: true, message: `TikTok Webhook Bridge answered ${res.status}` };
    }
    return failure(res);
  }

  // 2. Direct TikTok Creator API v2 test
  const res = await http('GET', 'https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status !== 200 || !res.data?.data?.user) return failure(res);
  const user = res.data.data.user;
  return {
    ok: true,
    message: `Connected to TikTok creator “${user.display_name || user.open_id}”`,
    meta: { displayName: user.display_name, openId: user.open_id, avatar: user.avatar_url },
  };
}

async function tiktokPublish(connection, text, { mediaUrl, imageUrl } = {}) {
  const token = cred(connection, 'accessToken');
  const webhookUrl = cred(connection, 'webhookUrl');
  const targetMedia = mediaUrl || imageUrl;

  if (!token && !webhookUrl) {
    return { ok: false, message: 'TikTok requires an Access Token or a Webhook Bridge URL.' };
  }
  if (!targetMedia) {
    return { ok: false, message: 'TikTok requires a video to publish.' };
  }

  // 1. If Webhook Bridge URL is configured (Make, Zapier, n8n)
  if (webhookUrl) {
    const res = await http('POST', webhookUrl, {
      data: {
        channel: 'tiktok',
        text: text.slice(0, 2200),
        mediaUrl: targetMedia,
        at: new Date().toISOString(),
      },
      headers: { 'Content-Type': 'application/json' },
    });
    if (res.status >= 200 && res.status < 300) {
      return { ok: true, message: `Delivered to TikTok bridge for instant publishing (${res.status})` };
    }
    return failure(res);
  }

  // 2. Direct TikTok Content Posting API v2
  try {
    const res = await http('POST', 'https://open.tiktokapis.com/v2/post/publish/video/init/', {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      data: {
        post_info: {
          title: text.slice(0, 150),
          privacy_level: 'PUBLIC_TO_EVERYONE',
          disable_duet: false,
          disable_stitch: false,
          disable_comment: false,
        },
        source_info: {
          source: 'PULL_FROM_URL',
          video_url: targetMedia,
        },
      },
    });

    if (res.status === 200 && res.data?.data?.publish_id) {
      const publishId = res.data.data.publish_id;
      // A publish id is not a video id. The status endpoint is what converts one
      // into the other, and `tiktokNewComments` below does that lookup lazily —
      // right after posting, TikTok is still transcoding and has no video id yet.
      rememberMedia(connection, { id: publishId, kind: 'publish' });
      return {
        ok: true,
        message: 'Sent to TikTok for publishing (publish id ' + publishId + '). TikTok finishes processing it in a minute or two.',
        id: publishId,
      };
    }
    return failure(res);
  } catch (err) {
    return { ok: false, message: `TikTok publish failed: ${err.message}` };
  }
}

/** TikTok answers everything with { data, error: { code, message } }. */
function tiktokFailure(res) {
  const error = res?.data?.error || {};
  const message = error.message || error.code || `HTTP ${res?.status}`;
  return { ok: false, message: String(message).slice(0, 300), status: res?.status || 0, code: error.code || '' };
}

/**
 * Turn a publish id into the public video id (needed to read its comments).
 * TikTok only fills the field in once the post is live, so "not yet" is normal
 * and reported as such rather than as a failure to connect.
 */
async function tiktokResolveVideoId(connection, publishId) {
  const token = cred(connection, 'accessToken');
  const res = await http('POST', `${TIKTOK}/post/publish/status/fetch/`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
    data: { publish_id: publishId },
  });
  if (res.status !== 200 || res.data?.error?.code !== 'ok') return { ok: false, message: tiktokFailure(res).message };
  const data = res.data?.data || {};
  // TikTok's own typo (`publicaly_available_post_id`) is the field that carries it.
  // It is documented as a list but has been seen as a bare string, and taking the
  // first character of a string would produce a plausible-looking wrong video id.
  const raw = data.publicaly_available_post_id ?? data.publicly_available_post_id ?? data.post_id ?? [];
  const id = Array.isArray(raw) ? String(raw[0] || '') : String(raw || '');
  if (!id) return { ok: false, message: `TikTok has not made the post public yet (status ${data.status || 'PROCESSING'}).` };
  return { ok: true, videoId: id };
}

/**
 * Comments on our recent TikTok videos. Needs the Creator access token — the
 * webhook bridge can publish but cannot read comments back.
 */
async function tiktokNewComments(connection, { since } = {}) {
  const token = cred(connection, 'accessToken');
  if (!token) return { ok: false, message: 'Reading TikTok comments needs a Creator access token (a webhook bridge can only publish).', comments: [] };

  const videos = [];
  for (const item of (connection.meta?.recentMedia || []).slice(-5)) {
    if (item.kind === 'video') { videos.push(item.id); continue; }
    if (item.kind !== 'publish') continue;
    const resolved = await tiktokResolveVideoId(connection, item.id);
    if (resolved.ok) {
      // Upgrade the record so the next poll skips the lookup entirely.
      connection.meta = {
        ...(connection.meta || {}),
        recentMedia: (connection.meta.recentMedia || []).map((row) =>
          (row.id === item.id ? { ...row, kind: 'video', id: resolved.videoId, publishId: item.id } : row)),
      };
      videos.push(resolved.videoId);
    }
  }
  if (!videos.length) return { ok: true, message: 'No live TikTok video to read comments from yet.', comments: [] };

  const sinceMs = since ? new Date(since).getTime() : 0;
  const comments = [];
  for (const videoId of videos.slice(-3)) {
    const res = await http('GET', `${TIKTOK}/comment/list/`, {
      params: { video_id: videoId, max_count: 20, fields: 'id,text,create_time,parent_comment_id,likes' },
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status !== 200 || res.data?.error?.code !== 'ok') return { ...tiktokFailure(res), comments };
    for (const row of res.data?.data?.comments || []) {
      if (sinceMs && new Date(row.create_time || 0).getTime() <= sinceMs) continue;
      comments.push({
        id: row.id,
        videoId,
        text: row.text || '',
        authorDisplayName: row.display_name || 'a viewer',
        authorChannelId: { value: row.id },
        publishedAt: row.create_time,
      });
    }
  }
  return { ok: true, message: `${comments.length} new comment(s)`, comments };
}

/** Reply under one TikTok comment. Needs the Comment API granted to your app. */
async function tiktokCommentReply(connection, { parentId, videoId, text }) {
  const token = cred(connection, 'accessToken');
  if (!token) return { ok: false, message: 'The TikTok access token is missing or expired.' };
  if (!parentId || !videoId) return { ok: false, message: 'TikTok needs both the video id and the comment id to reply.' };
  const res = await http('POST', `${TIKTOK}/comment/reply/create/`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
    data: { video_id: videoId, comment_id: parentId, text: text.slice(0, 500) },
  });
  if (res.status !== 200 || res.data?.error?.code !== 'ok') return tiktokFailure(res);
  return { ok: true, message: 'Replied to the TikTok comment', id: res.data?.data?.comment_id || '' };
}

/* ───────────────────────────── Generic webhook ─────────────────────────── */

/** https everywhere, except a loopback address while setting the webhook up. */
function webhookUrlProblem(url) {
  if (!url) return 'Add the URL to POST to.';
  if (/^https:\/\//i.test(url)) return '';
  if (/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(url)) return '';
  return 'Use an https:// URL — a plain http endpoint would leak the payload.';
}

async function genericWebhookTest(connection) {
  const url = cred(connection, 'url');
  const problem = webhookUrlProblem(url);
  if (problem) return { ok: false, message: problem };
  const res = await http('POST', url, {
    data: { event: 'test', text: 'HerovaAi test — your webhook works.', at: new Date().toISOString() },
    headers: { 'Content-Type': 'application/json', ...(cred(connection, 'secret') ? { 'X-Herova-Secret': cred(connection, 'secret') } : {}) },
  });
  if (res.status >= 200 && res.status < 300) return { ok: true, message: `Endpoint answered ${res.status}` };
  return failure(res);
}

async function genericWebhookPublish(connection, text, extra = {}) {
  const url = cred(connection, 'url');
  if (!url) return { ok: false, message: 'No webhook URL saved.' };
  const res = await http('POST', url, {
    data: { channel: 'webhook', text, at: new Date().toISOString(), ...extra },
    headers: { 'Content-Type': 'application/json', ...(cred(connection, 'secret') ? { 'X-Herova-Secret': cred(connection, 'secret') } : {}) },
  });
  if (res.status >= 200 && res.status < 300) return { ok: true, message: `Delivered (${res.status})` };
  return failure(res);
}

/* ───────────────────────── webhook authenticity ────────────────────────── */

/** Meta signs every webhook POST with the app secret (sha256 of the raw body). */
function metaSignatureOk(rawBody, header, appSecret) {
  if (!appSecret || !header) return false;
  const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(String(header));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Telegram echoes the secret we registered, in a header. */
function telegramSecretOk(connection, headerValue) {
  const secret = cred(connection, 'webhookSecret');
  if (!secret) return true; // nothing registered means nothing to check
  const a = Buffer.from(secret);
  const b = Buffer.from(String(headerValue || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ────────────────────────────── the surface ────────────────────────────── */

const TESTERS = {
  telegram: telegramTest,
  facebook_page: facebookPageTest,
  messenger: messengerTest,
  instagram: instagramTest,
  youtube: youtubeTest,
  tiktok: tiktokTest,
  webhook: genericWebhookTest,
};

const PUBLISHERS = {
  telegram: telegramPublish,
  facebook_page: facebookPagePublish,
  instagram: instagramPublish,
  youtube: youtubePublishVideo,
  tiktok: tiktokPublish,
  webhook: (connection, text) => genericWebhookPublish(connection, text),
};

const REPLIERS = {
  telegram: telegramReply,
  messenger: messengerReply,
  instagram: instagramReply,
  youtube: youtubeReply,
  facebook_page: facebookCommentReply,
  tiktok: tiktokCommentReply,
};

const testerFor = (channel) => {
  const fn = TESTERS[channel] || null;
  if (!fn) return null;
  return fn;
};

const publisherFor = (channel) => {
  return PUBLISHERS[channel] || null;
};

const replierFor = (channel) => REPLIERS[channel] || null;

module.exports = {
  webhookUrlProblem,
  testerFor,
  publisherFor,
  replierFor,
  telegramRegisterWebhook,
  telegramRemoveWebhook,
  youtubeAccessToken,
  youtubeNewComments,
  facebookPageNewComments,
  tiktokNewComments,
  rememberMedia,
  metaSignatureOk,
  telegramSecretOk,
};
