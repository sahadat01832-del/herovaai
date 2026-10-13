/**
 * registry — the honest catalogue of channels this app can actually drive.
 *
 * Each entry answers three questions before an owner spends five minutes on it:
 *   1. Can this platform be automated at all from a server? (`apiAvailable`)
 *   2. What does connecting it let the assistant DO here? (`capabilities`)
 *   3. Exactly which steps and which pieces of text do I need? (`setup`, `credentials`)
 *
 * Nothing here is aspirational. A platform with no public bot API (imo) says so
 * and explains why, instead of offering a button that would silently do nothing.
 * The steps are the "step shower" the dashboard renders, so they live with the
 * code that would fail if they were wrong.
 */

/** Fields every social channel shares, so the forms stay recognisable. */
const PAGE_TOKEN = {
  key: 'pageToken',
  label: 'Page access token',
  hint: 'A long-lived Page token from the Facebook app — starts with EAA…',
  secret: true,
  placeholder: 'EAAG…',
};

const CHANNELS = [
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    group: 'chat',
    blurb: 'Your shop number answers customers, with the business memory behind it.',
    apiAvailable: true,
    capabilities: { autoReply: true, autoPost: false, postKind: 'none' },
    status: 'own-page',
    ownPage: '/dashboard/whatsapp',
    summary: 'Scan a QR once; sessions and auto-reply are managed on the WhatsApp page.',
    credentials: [],
    setup: [],
    docsUrl: '/dashboard/whatsapp',
    webhook: null,
  },
  {
    id: 'messenger',
    name: 'Facebook Messenger',
    group: 'chat',
    blurb: 'Answers the messages that arrive on your Facebook Page, day and night.',
    apiAvailable: true,
    capabilities: {
      autoReply: true,
      autoPost: false,
      postKind: 'message',
      note: 'Needs a Meta app with the Page subscribed to the messages webhook.',
    },
    credentials: [
      { key: 'pageId', label: 'Page ID', hint: 'Page → About → Page transparency, or the app dashboard.', placeholder: '1234567890' },
      PAGE_TOKEN,
      { key: 'appSecret', label: 'App secret', hint: 'Meta app → Settings → Basic. Used to verify webhook signatures.', secret: true, placeholder: 'abc123…' },
      { key: 'verifyToken', label: 'Webhook verify token', hint: 'Any word you invent — paste the same one into Meta.', placeholder: 'herova-verify-2026' },
    ],
    setup: [
      { title: 'Create a Meta app', detail: 'developers.facebook.com → My Apps → Create app → type "Business".' },
      { title: 'Add the Messenger product', detail: 'In the app dashboard, add Messenger, then connect the Facebook Page you use for customers.' },
      { title: 'Copy the Page access token', detail: 'Messenger → Settings → Access tokens → Generate for your Page, then paste it here.' },
      { title: 'Subscribe the webhook', detail: 'Callback URL and verify token appear below once you save this form. Paste both into Messenger → Settings → Webhooks, and tick the "messages" subscription.' },
      { title: 'Press Test connection', detail: 'We call Meta with your token. Green means messages can arrive.' },
    ],
    docsUrl: 'https://developers.facebook.com/docs/messenger-platform/',
    webhook: { path: '/api/channels/webhook/messenger', verify: 'verify-token', signature: 'appSecret' },
  },
  {
    id: 'facebook_page',
    name: 'Facebook Page posts',
    group: 'social',
    blurb: 'Posts text, photos and videos to your Page feed on a schedule — offers, hours, new stock.',
    apiAvailable: true,
    capabilities: {
      autoPost: true,
      autoReply: true,
      postKind: 'image',
      note: 'Text, photos and videos (Reels) post to your Page — Facebook fetches videos from the public media link, so nothing large passes through the server. Comment replies answer viewers under your own recent posts.',
    },
    credentials: [
      { key: 'pageId', label: 'Page ID', hint: 'The numeric id of the Page you post as.', placeholder: '1234567890' },
      PAGE_TOKEN,
    ],
    setup: [
      { title: 'Open your Page settings', detail: 'Facebook → your Page → About: copy the Page ID.' },
      { title: 'Get a Page token', detail: 'In your Meta app (or Graph API Explorer), select the Page and grant pages_manage_posts (post), pages_read_engagement (read comments) and pages_manage_engagement (reply to comments).' },
      { title: 'Exchange for a long-lived token', detail: 'Short tokens expire in an hour. In the app dashboard use "Exchange for long-lived token".' },
      { title: 'Paste both values here and test', detail: 'Test reads the Page name back from Facebook, which proves the token is live.' },
      { title: 'Turn on the daily post', detail: 'Pick a time and a topic — the assistant writes the post from your business memory.' },
      { title: 'Turn on comment replies', detail: 'New comments on the posts you publish here get an AI answer from your business memory. Without pages_manage_engagement Facebook refuses the reply and says so in Activity.' },
    ],
    docsUrl: 'https://developers.facebook.com/docs/pages-api/posts',
    webhook: null,
  },
  {
    id: 'instagram',
    name: 'Instagram',
    group: 'social',
    blurb: 'Daily posts to your feed and replies to DMs, from the same Meta app.',
    apiAvailable: true,
    capabilities: {
      autoPost: true,
      autoReply: true,
      postKind: 'image',
      note: 'Feed posts need a public image URL. DMs work through the connected Facebook Page.',
    },
    credentials: [
      { key: 'igUserId', label: 'Instagram business account ID', hint: 'Graph API Explorer: GET /{page-id}?fields=instagram_business_account', placeholder: '17841400000000000' },
      PAGE_TOKEN,
      { key: 'appSecret', label: 'App secret', hint: 'Same Meta app secret as Messenger — needed for DM webhook signatures.', secret: true },
      { key: 'verifyToken', label: 'Webhook verify token', hint: 'Any word you invent; paste it into Meta too.', placeholder: 'herova-verify-2026' },
      { key: 'imageUrl', label: 'Default image URL for posts', hint: 'A public https link to the image used when no photo is attached.', optional: true },
    ],
    setup: [
      { title: 'Switch to a professional account', detail: 'Instagram app → Settings → Account type → Business, linked to your Facebook Page.' },
      { title: 'Copy the Instagram business account ID', detail: 'Graph API Explorer: GET /{page-id}?fields=instagram_business_account.' },
      { title: 'Grant the posting permissions', detail: 'instagram_basic, instagram_content_publish, instagram_manage_messages on your Meta app.' },
      { title: 'Paste the values and press Test', detail: 'Test reads your @username back from Instagram.' },
      { title: 'Subscribe the DM webhook', detail: 'Use the Callback URL shown below in the Instagram product settings, with the same verify token.' },
    ],
    docsUrl: 'https://developers.facebook.com/docs/instagram-api/guides/content-publishing',
    webhook: { path: '/api/channels/webhook/instagram', verify: 'verify-token', signature: 'appSecret' },
  },
  {
    id: 'telegram',
    name: 'Telegram',
    group: 'chat',
    blurb: 'The easiest one: a bot token from @BotFather is all it takes.',
    apiAvailable: true,
    capabilities: {
      autoReply: true,
      autoPost: true,
      postKind: 'message',
      note: 'Works end to end — replies in private chats and scheduled posts to a channel or group.',
    },
    credentials: [
      { key: 'botToken', label: 'Bot token', hint: 'From @BotFather: looks like 123456:ABC-DEF…', secret: true, placeholder: '123456:ABC-DEF…' },
      { key: 'chatId', label: 'Channel or group id for posts', hint: 'Add the bot to the channel, then use @userinfobot or getUpdates to read the id (channels look like -100…).', optional: true, placeholder: '-1001234567890' },
      { key: 'webhookSecret', label: 'Webhook secret', hint: 'Any random word; Telegram echoes it back so we know a message is really yours.', secret: true, optional: true, placeholder: 'herova-secret' },
    ],
    setup: [
      { title: 'Talk to @BotFather', detail: 'Send /newbot, pick a name, and copy the token it gives you.' },
      { title: 'Paste the token and press Test', detail: 'Test calls getMe and shows the bot username.' },
      { title: 'Press "Turn on replies"', detail: 'We register the webhook with Telegram for you — no copy-pasting URLs.' },
      { title: 'For scheduled posts, add the bot to your channel', detail: 'Make the bot an admin of the channel, add the channel id, and set a post time.' },
    ],
    docsUrl: 'https://core.telegram.org/bots/api',
    webhook: { path: '/api/channels/webhook/telegram', verify: 'secret-token', managed: true },
  },
  {
    id: 'youtube',
    name: 'YouTube',
    group: 'video',
    blurb: 'Publish YouTube Shorts & Videos with AI metadata, and auto-answer viewer comments.',
    apiAvailable: true,
    capabilities: {
      autoReply: true,
      autoPost: true,
      postKind: 'video',
      note: 'Uploads video files & YouTube Shorts with AI titles and tags, and auto-answers new comments.',
    },
    credentials: [
      { key: 'accessToken', label: 'OAuth access token', hint: 'From Google OAuth 2.0 Playground with youtube.upload and youtube.force-ssl.', secret: true, placeholder: 'ya29.…' },
      { key: 'refreshToken', label: 'OAuth refresh token', hint: 'Lets the app renew the access token without you signing in again.', secret: true, optional: true, placeholder: '1//0e…' },
      { key: 'clientId', label: 'OAuth client id', hint: 'Google Cloud → Credentials → OAuth client (only needed with a refresh token).', optional: true, placeholder: '1234-abc.apps.googleusercontent.com' },
      { key: 'clientSecret', label: 'OAuth client secret', hint: 'Same OAuth client.', secret: true, optional: true, placeholder: 'GOCSPX-…' },
    ],
    setup: [
      { title: 'Enable the YouTube Data API v3', detail: 'console.cloud.google.com → APIs & Services → Enable YouTube Data API v3.' },
      { title: 'Open Google OAuth Playground (Fast 60s way)', detail: 'Visit developers.google.com/oauthplayground, authorize scopes: youtube.upload and youtube.force-ssl.' },
      { title: 'Exchange for tokens', detail: 'Click Exchange authorization code for tokens, then paste the Access token below.' },
      { title: 'Test the connection', detail: 'Press Test — we read your channel title back from Google to confirm.' },
      { title: 'Push posts directly', detail: 'In Push Post modal, any video is published as a YouTube Short or video with 1 click!' },
    ],
    docsUrl: 'https://developers.google.com/youtube/v3/docs/videos/insert',
    webhook: null,
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    group: 'video',
    blurb: 'Publish viral TikTok videos and Shorts directly with AI-crafted hooks, SEO captions, and trending hashtags.',
    apiAvailable: true,
    capabilities: {
      autoPost: true,
      autoReply: true,
      postKind: 'video',
      note: 'Publishes videos directly via the TikTok Content Posting API or through an instant webhook bridge (Make, Zapier, n8n). Comment replies need a Creator access token from an app that TikTok has granted its Comment API to.',
    },
    credentials: [
      { key: 'accessToken', label: 'TikTok Creator API Access Token', hint: 'From TikTok for Developers or authorized creator token.', secret: true, optional: true, placeholder: 'act.example...' },
      { key: 'webhookUrl', label: 'Or Instant TikTok Webhook / Bridge URL', hint: 'Fastest: If using Make.com/Zapier/n8n TikTok integration, paste your webhook URL here.', optional: true, placeholder: 'https://hooks.zapier.com/... or https://hook.eu2.make.com/...' },
    ],
    setup: [
      { title: 'Choose your connection method', detail: 'Use an instant Make/Zapier/n8n TikTok Webhook (easiest, no corporate app needed) OR direct TikTok Creator API.' },
      { title: 'For 1-Minute Webhook Bridge', detail: 'In Make.com or Zapier, create a scenario with a Custom Webhook connected to TikTok Video Upload. Paste the webhook URL here.' },
      { title: 'For Direct TikTok API', detail: 'developers.tiktok.com → Manage apps → Content Posting API permission → Generate Access Token.' },
      { title: 'Test & Publish', detail: 'Press Test to verify. You can now push video posts directly to TikTok with 1 click!' },
      { title: 'For comment replies (optional)', detail: 'Reading and replying to comments requires TikTok to approve your app for its Comment API. Until then only posting works, and any refusal from TikTok is written to Activity so you can see exactly what it said.' },
    ],
    docsUrl: 'https://developers.tiktok.com/doc/content-posting-api-get-started',
    webhook: null,
  },
  {
    id: 'google_business',
    name: 'Google Business Profile',
    group: 'social',
    blurb: 'Posts and reviews on your Google Business Profile.',
    apiAvailable: false,
    availableReason:
      'Google gates these APIs behind an approval form: without it every call returns PERMISSION_DENIED. Request access, then connect with the same Google account.',
    capabilities: { autoPost: false, autoReply: false, postKind: 'none' },
    credentials: [],
    setup: [
      { title: 'Verify your Business Profile', detail: 'business.google.com — the profile must be verified and you must be an owner.' },
      { title: 'Request API access', detail: 'Fill in the Business Profile APIs access request form (developers.google.com/my-business/content/prereqs).' },
      { title: 'Wait for Google\'s approval email', detail: 'Approval usually takes a few days and is granted per project.' },
      { title: 'Then connect with OAuth', detail: 'Once approved, this card switches to a connect form. Until then, nothing here can work — Google refuses the call, not us.' },
    ],
    docsUrl: 'https://developers.google.com/my-business/content/prereqs',
    webhook: null,
  },
  {
    id: 'imo',
    name: 'imo',
    group: 'chat',
    blurb: 'Popular messenger — but with no bot API to automate.',
    apiAvailable: false,
    availableReason:
      'imo publishes no bot or messaging API, so no server can read or answer its chats. Only phone-level automation could, which needs your device unlocked with accessibility control — we will not do that to your account.',
    capabilities: { autoReply: false, autoPost: false, postKind: 'none' },
    credentials: [],
    setup: [
      { title: 'Why this is off', detail: 'Auto-reply needs a documented API to receive messages and send answers. imo has none for third parties.' },
      { title: 'What people do instead', detail: 'Phone-automation apps read notifications and tap the screen. That breaks imo\'s terms, breaks on updates, and hands over your whole device.' },
      { title: 'Practical alternative', detail: 'Point imo contacts to WhatsApp, where the assistant already answers — the WhatsApp card above takes two minutes.' },
    ],
    docsUrl: 'https://www.imo.im/',
    webhook: null,
  },
  {
    id: 'webhook',
    name: 'Any other app (webhook)',
    group: 'other',
    blurb: 'Send the daily post to Zapier, Make, n8n, Discord, Slack or your own server.',
    apiAvailable: true,
    capabilities: {
      autoPost: true,
      autoReply: false,
      postKind: 'json',
      note: 'We POST JSON { text, channel, at, business } to your URL. Whatever receives it decides what to do.',
    },
    credentials: [
      { key: 'url', label: 'Webhook URL', hint: 'Where to POST the daily text (https://…).', placeholder: 'https://hooks.zapier.com/…' },
      { key: 'secret', label: 'Shared secret (optional)', hint: 'Sent as X-Herova-Secret so your endpoint can verify the call.', secret: true, optional: true },
    ],
    setup: [
      { title: 'Create the receiving URL', detail: 'Zapier catch hook, Make custom webhook, n8n, a Discord webhook URL, or your own endpoint.' },
      { title: 'Paste it here and press Test', detail: 'Test sends a small hello payload so you can see it arrive.' },
      { title: 'Set the daily time and topic', detail: 'The same text the assistant posts elsewhere is delivered to this URL.' },
    ],
    docsUrl: '',
    webhook: null,
  },
];

const BY_ID = CHANNELS.reduce((acc, channel) => { acc[channel.id] = channel; return acc; }, {});

/** The catalogue as the dashboard renders it (no code, just facts). */
function catalogue() {
  return CHANNELS.map((channel) => ({
    id: channel.id,
    name: channel.name,
    group: channel.group,
    blurb: channel.blurb,
    apiAvailable: channel.apiAvailable,
    availableReason: channel.availableReason || '',
    capabilities: channel.capabilities,
    credentials: channel.credentials.map(({ key, label, hint, secret, optional, placeholder }) => ({
      key, label, hint, secret: Boolean(secret), optional: Boolean(optional), placeholder: placeholder || '',
    })),
    setup: channel.setup,
    docsUrl: channel.docsUrl || '',
    webhook: channel.webhook || null,
    ownPage: channel.ownPage || '',
    summary: channel.summary || '',
  }));
}

/** Which credential keys a channel accepts — the whitelist for saving a form. */
function credentialKeys(id) {
  return (BY_ID[id]?.credentials || []).map((field) => field.key);
}

const isAvailable = (id) => Boolean(BY_ID[id]?.apiAvailable);

module.exports = { CHANNELS, BY_ID, catalogue, credentialKeys, isAvailable, channel: (id) => BY_ID[id] || null };
