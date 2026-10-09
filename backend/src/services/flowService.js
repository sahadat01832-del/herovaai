const axios = require('axios');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const os = require('os');

const GATEWAY_URL = process.env.CONTENTBOT_API_URL || 'http://127.0.0.1:8787';
const EXTENSION_DIR = fs.existsSync(path.resolve(process.env.HOME || '', 'content-bot/tools/google-flow-mcp/extension'))
  ? path.resolve(process.env.HOME || '', 'content-bot/tools/google-flow-mcp/extension')
  : path.resolve(process.env.HOME || '', '.local/share/google-flow-mcp/extension');

const MEDIA_DIRS = [
  path.resolve(process.env.HOME || '', 'content-bot/outputs/flow'),
  path.resolve(process.env.HOME || '', 'content-bot/outputs/final'),
  path.resolve(process.env.HOME || '', 'content-bot/data/google_flow_mcp/jobs'),
  path.resolve(__dirname, '../../public/media'),
];

// Ensure local media dirs exist
for (const dir of MEDIA_DIRS) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {}
}

const flowService = {
  extensionDirectory: EXTENSION_DIR,

  async getStatus() {
    try {
      const res = await axios.get(`${GATEWAY_URL}/flow/status`, { timeout: 15000 });
      return {
        success: true,
        extensionDirectory: EXTENSION_DIR,
        availableModels: flowService.FLOW_MODELS,
        ...res.data,
      };
    } catch (err) {
      return {
        success: false,
        ready: false,
        extensionDirectory: EXTENSION_DIR,
        availableModels: flowService.FLOW_MODELS,
        error: err.message,
        message: 'ContentBot gateway or Flow MCP is initializing. Check `contentbot flow status`.',
      };
    }
  },

  FLOW_MODELS: {
    image: [
      { id: 'nano-banana-2', name: 'Nano Banana 2 (2.1)', isDefault: true, desc: 'High-detail photorealism & fast render' },
      { id: 'nano-banana-pro', name: 'Nano Banana Pro', isDefault: false, desc: 'Maximum aesthetic quality & complex lighting' },
      { id: 'nano-banana-2-lite', name: 'Nano Banana 2 Lite', isDefault: false, desc: 'Ultra-low latency generation' },
      { id: 'ui-default', name: 'Workspace Default', isDefault: false, desc: 'Auto-selected by Flow workspace' },
    ],
    video: [
      { id: 'omni-flash', name: 'Omni Flash 1.1', isDefault: true, desc: 'Fluid camera motion & prompt-to-video' },
      { id: 'veo-3-1-quality', name: 'Veo 3.1 Quality', isDefault: false, desc: 'High-definition cinematic renders' },
      { id: 'veo-3-1-fast', name: 'Veo 3.1 Fast', isDefault: false, desc: 'Fast rendering for rapid iteration' },
      { id: 'ui-default', name: 'Workspace Default', isDefault: false, desc: 'Auto-selected by Flow workspace' },
    ],
    aspectRatios: [
      { id: '16:9', label: '16:9 (Landscape / YouTube / Desktop)' },
      { id: '9:16', label: '9:16 (Vertical / Reels / TikTok)' },
      { id: '1:1',  label: '1:1 (Square / Feed / Profile)' },
      { id: '4:3',  label: '4:3 (Standard Photo)' },
    ],
  },

  async generateMedia({ prompt, mediaType = 'image', duration = 6, ratio = '16:9', model = null, accountId = null }) {
    if (!prompt || typeof prompt !== 'string') {
      throw new Error('Prompt is required for Flow generation');
    }

    const type = mediaType.toLowerCase();
    const defaultModel = type === 'video' ? 'omni-flash' : 'nano-banana-2';

    const payload = {
      prompt: prompt.trim(),
      mediaType: type,
      duration: Number(duration) || 6,
      ratio,
      model: model || defaultModel,
      accountId: accountId || null,
    };

    const res = await axios.post(`${GATEWAY_URL}/flow/generate`, payload, {
      timeout: 300000, // up to 5 min for video / heavy Flow jobs
    });

    return res.data;
  },

  async beginConnect({ accountId, label } = {}) {
    const payload = {};
    if (accountId) payload.accountId = accountId;
    if (label) payload.label = label;
    const res = await axios.post(`${GATEWAY_URL}/flow/connect/begin`, payload, { timeout: 60000 });
    return res.data;
  },

  async completeConnect({ connectionId, accountId, label } = {}) {
    const payload = {
      connectionId,
      accountId,
      label,
    };
    const res = await axios.post(`${GATEWAY_URL}/flow/connect/complete`, payload, { timeout: 180000 });
    return res.data;
  },

  async connectWithCookies({ rawCookies, accountId, label } = {}) {
    let cookiesList = [];
    if (Array.isArray(rawCookies)) {
      cookiesList = rawCookies;
    } else if (typeof rawCookies === 'string') {
      try {
        const parsed = JSON.parse(rawCookies);
        if (Array.isArray(parsed)) cookiesList = parsed;
      } catch {
        // Parse cookie header string format: key=val; key2=val2
        const parts = rawCookies.split(';').map(p => p.trim()).filter(Boolean);
        cookiesList = parts.map(part => {
          const eqIdx = part.indexOf('=');
          if (eqIdx === -1) return null;
          const name = part.slice(0, eqIdx).trim();
          const value = part.slice(eqIdx + 1).trim();
          return {
            name,
            value,
            domain: '.google.com',
            path: '/',
            secure: true,
            httpOnly: false,
          };
        }).filter(Boolean);
      }
    }

    if (!cookiesList.length) {
      throw new Error('No valid Google cookies found in payload. Provide a JSON cookie array or cookie string.');
    }

    // Step 1: Arm connection session
    const beginRes = await this.beginConnect({ accountId, label });
    const connectionId = beginRes?.result?.connectionId || beginRes?.connectionId;

    // Step 2: Post cookies to the bridge
    const bridgePort = beginRes?.result?.bridge?.port || 37421;
    await axios.post(`http://127.0.0.1:${bridgePort}/session`, {
      cookies: cookiesList,
      browser: 'UserBrowser',
      profile: label || 'GoogleAccount',
    }, { timeout: 10000 });

    // Step 3: Complete handshake
    const completeRes = await this.completeConnect({ connectionId, accountId, label });
    return completeRes;
  },

  async generateSocialPost({
    mediaUrl = '',
    prompt = '',
    mediaType = 'image',
    platform = 'facebook',
    customTopic = '',
    user = null,
    memory = null,
  }) {
    const cloudAIService = require('./cloudAIService');
    const businessName = memory?.businessName || user?.businessInfo?.name || 'Our Brand';
    const industry = memory?.industry || user?.businessInfo?.industry || '';
    const website = user?.businessInfo?.website || '';

    // Step 1: Detect physical media and extract visual frames + metadata
    let detectedType = mediaType;
    let visualAttachment = null;
    let mediaMeta = {
      isVertical: false,
      aspectRatio: '16:9',
      dimensions: 'Standard',
      duration: '',
      hasVisualAnalysis: false,
      summary: '',
    };

    let filePath = null;
    if (mediaUrl) {
      const cleanUrl = mediaUrl.split('?')[0];
      const filename = path.basename(cleanUrl);
      filePath = this.findMediaFile(filename);
      if (!filePath && fs.existsSync(mediaUrl)) {
        filePath = mediaUrl;
      }
    }

    if (filePath && fs.existsSync(filePath)) {
      const ext = path.extname(filePath).toLowerCase();
      const isVideo = ['.mp4', '.webm', '.mov', '.mkv', '.m4v'].includes(ext);
      detectedType = isVideo ? 'video' : 'image';

      if (isVideo) {
        // Inspect video dimensions and duration via ffprobe
        try {
          const probeOut = execSync(
            `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,duration -of json "${filePath}"`,
            { timeout: 3000 }
          ).toString();
          const parsed = JSON.parse(probeOut);
          const stream = parsed?.streams?.[0];
          if (stream?.width && stream?.height) {
            const w = stream.width;
            const h = stream.height;
            const dur = stream.duration ? `${parseFloat(stream.duration).toFixed(1)}s` : '';
            const isVert = h > w;
            mediaMeta = {
              isVertical: isVert,
              aspectRatio: isVert ? '9:16 (Vertical Short/Reel/TikTok)' : (w === h ? '1:1 (Square)' : '16:9 (Landscape)'),
              dimensions: `${w}x${h}`,
              duration: dur,
              hasVisualAnalysis: true,
              summary: `${isVert ? 'Vertical 9:16 Short Video' : 'Widescreen Video'} (${w}x${h}${dur ? `, ${dur}` : ''})`,
            };
          }
        } catch {}

        // Extract thumbnail snapshot via ffmpeg for Gemini Vision
        try {
          const tempThumb = path.join(os.tmpdir(), `ai_thumb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.jpg`);
          try {
            execSync(`ffmpeg -y -ss 00:00:01 -i "${filePath}" -vframes 1 -q:v 2 "${tempThumb}" 2>/dev/null`, { timeout: 4000 });
          } catch {
            execSync(`ffmpeg -y -i "${filePath}" -vframes 1 -q:v 2 "${tempThumb}" 2>/dev/null`, { timeout: 4000 });
          }
          if (fs.existsSync(tempThumb)) {
            const thumbBuffer = fs.readFileSync(tempThumb);
            visualAttachment = {
              mimeType: 'image/jpeg',
              data: thumbBuffer.toString('base64'),
            };
            fs.unlinkSync(tempThumb);
          }
        } catch (e) {
          console.warn('[flowService] Video thumbnail extraction note:', e.message);
        }
      } else {
        // Image: read directly
        try {
          const imgBuffer = fs.readFileSync(filePath);
          const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
          visualAttachment = {
            mimeType: mime,
            data: imgBuffer.toString('base64'),
          };
          mediaMeta.hasVisualAnalysis = true;
          mediaMeta.dimensions = 'Image (Visual analysis attached)';
          mediaMeta.summary = 'High-Resolution Still Image';
        } catch (e) {
          console.warn('[flowService] Image read note:', e.message);
        }
      }
    }

    // Step 2: Psychological Viral Copywriting System Prompt
    const platformGuidelines = {
      youtube: `Target Platform: YouTube Shorts / YouTube Video.
- Format: High-energy thumb-stopping hook in line 1. Title must include #Shorts if vertical or under 60s.
- Retention: Add an intriguing open-loop or question in the first sentence to keep viewers watching past 3 seconds.
- Algorithmic SEO: Include 3 high-volume search keywords in the description.
- CTA: "Subscribe & drop your reaction below 👇"`,
      tiktok: `Target Platform: TikTok.
- Format: Punchy, trend-aware, colloquial hook. No corporate fluff.
- Retention: Pattern interrupt that stops the high-speed feed thumb scroll.
- Algorithmic SEO: Natural TikTok SEO keywords + viral hashtag mix.
- CTA: "Save this for later 📌 and tell me what you think in the comments!"`,
      instagram: `Target Platform: Instagram Feed / Reel.
- Format: Clean aesthetic layout with line breaks and selective emojis.
- Structure: Bold 1-sentence hook -> 2-line relatable micro-story -> engaging CTA.
- CTA: "Double tap if you feel this & save to your collection ✨"`,
      facebook_page: `Target Platform: Facebook Page.
- Format: Conversational, community-focused storytelling.
- Retention: Pose a genuine question that invites people in the comments to share their experience.
- CTA: "Share this with someone who needs to see this, and leave your thoughts below!"`,
      telegram: `Target Platform: Telegram Channel.
- Format: Clean, bulleted broadcast with crisp bold headings and value points.
- CTA: "Tap the link below to get started or forward to your friends."`,
    };

    const targetGuideline = platformGuidelines[platform] || platformGuidelines.facebook_page;

    const systemPrompt = `You are a world-class viral social media marketing director and behavioral psychology copywriter.
You understand why humans click, watch, comment, and share. You NEVER write bland, robotic, or generic corporate filler.
Every post you generate applies proven human attraction principles:
1. PATTERN INTERRUPT: The very first sentence must break expectations, spark instant curiosity, or trigger an emotional reaction.
2. VISUAL ANCHOR: Mention specific visual elements, lighting, vibe, or details visible in the attached media so the post feels authentic to what the human viewer is seeing.
3. CURIOSITY GAP: Open a loop that compels people to read the full caption or watch the video.
4. ENGAGEMENT CATALYST: Ask a question or give a CTA that has zero friction to reply to.
5. STRATEGIC HASHTAGS: Exactly 10-14 hashtags split into: 3 macro viral tags (1M+ reach), 6 niche community tags, 2 brand/aesthetic tags.

Brand Context: "${businessName}" ${industry ? `(Industry: ${industry})` : ''} ${website ? `(Website: ${website})` : ''}
Media Specs: ${detectedType} (${mediaMeta.aspectRatio}${mediaMeta.duration ? `, duration: ${mediaMeta.duration}` : ''}).
${targetGuideline}

Output MUST be valid JSON ONLY in this exact structure:
{
  "headline": "Magnetic 1-line hook with emoji (pattern interrupt)",
  "caption": "Persuasive 2-4 sentence human-attracting copy tailored to the visual",
  "hashtags": ["#tag1", "#tag2", ... 10-14 strategic tags],
  "cta": "Frictionless call to action",
  "thumbnailNote": "Specific thumbnail advice (exact visual focal point + bold 3-5 word high-contrast text overlay to maximize CTR)",
  "hookType": "Pattern Interrupt / Curiosity Gap / Story / Bold Question",
  "fullPost": "The complete, ready-to-publish post with headline, caption, CTA, and hashtags formatted beautifully with clean line breaks."
}`;

    const userPrompt = `Media inspection:
- Type: ${detectedType}
- Dimensions / Format: ${mediaMeta.dimensions} (${mediaMeta.aspectRatio})
${mediaMeta.duration ? `- Duration: ${mediaMeta.duration}` : ''}
- Visual subject/intent: "${prompt}"
- Target Platform: ${platform}
${customTopic ? `- Campaign Focus / Angle: "${customTopic}"` : ''}

Analyze the visual content${visualAttachment ? ' (inspect the attached frame directly)' : ''} and craft a high-converting, human-attracting viral post. Return JSON only.`;

    try {
      const messages = [{ role: 'user', content: userPrompt }];
      const attachments = visualAttachment ? [visualAttachment] : [];

      let res;
      try {
        res = await cloudAIService.generateCompletion({
          model: 'gemini-2.5-flash',
          messages,
          systemPrompt,
          attachments,
          temperature: 0.7,
        });
      } catch (geminiErr) {
        console.warn('[flowService] Gemini Vision failed, attempting Groq fallback:', geminiErr.message);
        res = await cloudAIService.generateCompletion({
          model: 'groq/qwen/qwen3.8-27b',
          messages,
          systemPrompt,
          temperature: 0.7,
        });
      }

      const raw = res?.text || '';
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          ...parsed,
          mediaMeta,
        };
      }
    } catch (err) {
      console.warn('[flowService] AI social post generation fallback:', err.message);
    }

    // High quality template fallback if AI is offline
    const cleanTags = [
      `#${businessName.replace(/\s+/g, '')}`,
      `#${detectedType === 'video' ? 'Shorts' : 'Photography'}`,
      '#Viral', '#Trending', '#CreativeDirection', '#VisualStorytelling',
      '#MustWatch', '#ExplorePage', '#DailyInspo', '#ContentCreator'
    ];
    const headline = `⚡ You need to see this from ${businessName}`;
    const caption = prompt
      ? `We pushed the visual limits on this one: "${prompt}". Look closely at the details and tell us what stands out most to you.`
      : `Behind the scenes of something truly unique. Crafted to catch the eye and inspire.`;
    const cta = platform === 'youtube'
      ? `Subscribe and let us know your reaction in the comments! 👇`
      : platform === 'tiktok'
      ? `Save this for later 📌 & drop your thoughts below!`
      : `Drop a comment with your favorite detail below!`;
    const fullPost = `${headline}\n\n${caption}\n\n👉 ${cta}\n\n${cleanTags.join(' ')}`;

    return {
      headline,
      caption,
      hashtags: cleanTags,
      cta,
      thumbnailNote: `Optimal framing: vibrant focal point centered in ${mediaMeta.aspectRatio}. Overlay text: "WAIT FOR IT" or "HOW WE MADE THIS".`,
      hookType: 'Pattern Interrupt',
      mediaMeta,
      fullPost,
    };
  },

  findMediaFile(filename) {
    const safeName = path.basename(filename);
    for (const dir of MEDIA_DIRS) {
      const full = path.join(dir, safeName);
      if (fs.existsSync(full)) {
        return full;
      }
    }
    // Deep search in jobs subdirectories if needed
    const jobsDir = path.resolve(process.env.HOME || '', 'content-bot/data/google_flow_mcp/jobs');
    if (fs.existsSync(jobsDir)) {
      try {
        const subdirs = fs.readdirSync(jobsDir);
        for (const sub of subdirs) {
          const nested = path.join(jobsDir, sub, safeName);
          if (fs.existsSync(nested)) return nested;
        }
      } catch {}
    }
    return null;
  },
};

module.exports = flowService;
