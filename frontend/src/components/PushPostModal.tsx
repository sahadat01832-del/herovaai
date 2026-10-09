'use client'

import { useState, useEffect } from 'react'
import {
  Sparkles, Send, Copy, Check, Upload, RefreshCw, Hash,
  Facebook, Instagram, Youtube, ExternalLink, Image as ImageIcon,
  Video, Eye, AlertCircle, CheckCircle2, ShieldCheck, UserCheck,
  Link2, KeyRound, ArrowRight, Loader2, Play
} from 'lucide-react'
import { flowApi, channelApi } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { Modal } from '@/components/ui/Modal'
import { Button, Badge } from '@/components/ui/primitives'
import toast from 'react-hot-toast'
import Link from 'next/link'

interface PushPostModalProps {
  open: boolean
  onClose: () => void
  mediaUrl: string
  prompt?: string
}

const PLATFORMS = [
  { id: 'facebook_page', name: 'Facebook Page', icon: Facebook, color: 'text-blue-400', kind: 'both' },
  { id: 'instagram',     name: 'Instagram',     icon: Instagram, color: 'text-pink-400', kind: 'both' },
  { id: 'youtube',       name: 'YouTube Shorts', icon: Youtube,   color: 'text-red-400',  kind: 'video' },
  { id: 'tiktok',        name: 'TikTok',        icon: Video,     color: 'text-rose-400', kind: 'video' },
  { id: 'telegram',      name: 'Telegram',      icon: Send,      color: 'text-cyan-400', kind: 'both' },
]

export function PushPostModal({ open, onClose, mediaUrl, prompt = '' }: PushPostModalProps) {
  const { user } = useAuth()
  const [platform, setPlatform] = useState<string>('facebook_page')
  const [channels, setChannels] = useState<any[]>([])
  const [customTopic, setCustomTopic] = useState<string>('')
  const [loadingChannels, setLoadingChannels] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [copied, setCopied] = useState(false)

  // AI Generated Post fields
  const [headline, setHeadline] = useState('')
  const [caption, setCaption] = useState('')
  const [hashtags, setHashtags] = useState<string[]>([])
  const [cta, setCta] = useState('')
  const [thumbnailNote, setThumbnailNote] = useState('')
  const [hookType, setHookType] = useState('')
  const [mediaMeta, setMediaMeta] = useState<any>(null)
  const [editablePost, setEditablePost] = useState('')

  // In-modal Quick Connect state
  const [quickConnectOpen, setQuickConnectOpen] = useState(false)
  const [connectFields, setConnectFields] = useState<Record<string, string>>({})
  const [connecting, setConnecting] = useState(false)

  const isVideo = Boolean(mediaUrl && /\.(mp4|webm|mov|mkv)(\?|$)/i.test(mediaUrl))

  // Auto-switch default platform to YouTube/TikTok if video, or Facebook if image
  useEffect(() => {
    if (isVideo && (platform === 'facebook_page' || platform === 'instagram')) {
      setPlatform('youtube')
    }
  }, [isVideo])

  // Load user's connected channels
  const fetchChannels = async () => {
    setLoadingChannels(true)
    try {
      const res: any = await channelApi.list()
      if (res?.success) {
        setChannels(res.channels || [])
      }
    } catch {}
    finally {
      setLoadingChannels(false)
    }
  }

  useEffect(() => {
    if (!open) return
    fetchChannels()
  }, [open])

  // Auto-generate post if empty when modal opens or platform changes
  useEffect(() => {
    if (open && mediaUrl && !editablePost && !generating) {
      handleGenerate()
    }
  }, [open, mediaUrl, platform])

  const currentChannel = channels.find(c => c.id === platform)
  const isConnected = currentChannel?.connection?.status === 'connected'
  const connectedIdentity = currentChannel?.connection?.meta?.pageName ||
    currentChannel?.connection?.meta?.username ||
    currentChannel?.connection?.meta?.channelTitle ||
    currentChannel?.connection?.meta?.displayName ||
    currentChannel?.connection?.label ||
    ''

  const handleGenerate = async () => {
    if (!mediaUrl) return
    setGenerating(true)
    try {
      const res: any = await flowApi.generatePost({
        mediaUrl,
        prompt: prompt || 'Showcasing our latest premium design and creative visuals',
        platform,
        customTopic,
      })
      if (res?.success && res.post) {
        setHeadline(res.post.headline || '')
        setCaption(res.post.caption || '')
        setHashtags(res.post.hashtags || [])
        setCta(res.post.cta || '')
        setThumbnailNote(res.post.thumbnailNote || '')
        setHookType(res.post.hookType || '')
        setMediaMeta(res.post.mediaMeta || res.mediaMeta || null)
        setEditablePost(res.post.fullPost || '')
      }
    } catch (err: any) {
      toast.error(err.message || 'AI generation failed')
    } finally {
      setGenerating(false)
    }
  }

  const handleCopy = () => {
    if (!editablePost) return
    navigator.clipboard.writeText(editablePost)
    setCopied(true)
    toast.success('Post text & #tags copied to clipboard!')
    setTimeout(() => setCopied(false), 2000)
  }

  const handlePublish = async () => {
    if (!editablePost.trim()) {
      toast.error('Post content is empty')
      return
    }
    if (!isConnected) {
      setQuickConnectOpen(true)
      toast.error(`Please connect ${currentChannel?.name || platform} first!`)
      return
    }

    // Check platform compatibility
    const targetPlatformDef = PLATFORMS.find(p => p.id === platform)
    if (targetPlatformDef?.kind === 'video' && !isVideo) {
      toast.error(`${targetPlatformDef.name} only accepts video files. Please select a video, or publish this image to Instagram or Facebook!`, { duration: 5000 })
      return
    }

    setPublishing(true)
    try {
      const res: any = await flowApi.publishPost({
        channelId: platform,
        text: editablePost,
        mediaUrl,
      })
      if (res?.success) {
        toast.success(res.message || `🚀 Post published to ${currentChannel?.name}!`, { duration: 6000 })
        onClose()
      } else {
        toast.error(res?.message || 'Publish failed')
      }
    } catch (err: any) {
      toast.error(err.message || 'Publishing failed')
    } finally {
      setPublishing(false)
    }
  }

  // Quick Connect submission
  const handleQuickConnect = async () => {
    setConnecting(true)
    try {
      const res: any = await channelApi.connect(platform, {
        credentials: connectFields,
        label: `${user?.name || 'Customer'}'s ${currentChannel?.name || platform}`,
      })
      if (res?.success) {
        if (res.test?.ok) {
          toast.success(`Successfully connected to ${currentChannel?.name}!`, { duration: 4000 })
          setQuickConnectOpen(false)
          setConnectFields({})
          await fetchChannels()
        } else {
          toast.error(res.test?.message || 'Connection test failed. Check your tokens.')
        }
      } else {
        toast.error(res?.message || 'Could not save connection.')
      }
    } catch (err: any) {
      toast.error(err.message || 'Quick connect failed')
    } finally {
      setConnecting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400">
            <Sparkles className="h-4 w-4" />
          </span>
          <span className="text-white font-semibold">Push Post with AI (Auto-Publish)</span>
          <span className="rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
            Gemini Multimodal Vision
          </span>
        </div>
      }
      description="Analyzes the visual frames of your photo or video, engineers human-attracting viral copy with psychology hooks, and publishes directly to your personal connected account."
    >
      <div className="space-y-4 pt-1">
        {/* ── Customer Tenant Scoping Assurance ── */}
        <div className="flex items-center justify-between px-3 py-1.5 rounded-xl bg-white/[0.03] border border-white/5 text-[11px] text-dark-300">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Customer Isolation:</span>
            <strong className="text-white font-mono">
              Account #{user?._id ? user._id.slice(-6).toUpperCase() : 'PERSONAL'}
            </strong>
          </div>
          <div className="flex items-center gap-1 text-[10.5px] text-dark-400">
            <UserCheck className="w-3 h-3 text-cyan-400" />
            <span>Posts go strictly to your personal channels</span>
          </div>
        </div>

        {/* ── Media Preview & Platform Strip ── */}
        <div className="grid gap-4 md:grid-cols-12 items-start">
          {/* Visual Preview (Col 5) */}
          <div className="md:col-span-5 rounded-2xl overflow-hidden border border-white/10 bg-black/60 relative group shadow-xl">
            {isVideo ? (
              <video
                src={mediaUrl}
                controls
                autoPlay
                loop
                muted
                className="w-full h-56 object-cover bg-black"
              />
            ) : (
              <img
                src={mediaUrl}
                alt="Generated Media Preview"
                className="w-full h-56 object-cover bg-black/40"
              />
            )}
            <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-lg bg-black/75 backdrop-blur-md border border-white/10 text-[11px] text-white font-medium">
              {isVideo ? <Video className="w-3.5 h-3.5 text-cyan-400" /> : <ImageIcon className="w-3.5 h-3.5 text-emerald-400" />}
              <span>{mediaMeta?.summary || (isVideo ? 'Flow Video' : 'Flow Image')}</span>
            </div>
            {hookType && (
              <div className="absolute top-2 right-2 px-2 py-0.5 rounded-md bg-brand-500/80 backdrop-blur-md text-[10px] text-white font-semibold">
                {hookType}
              </div>
            )}
            {thumbnailNote && (
              <div className="p-2.5 bg-dark-900/95 border-t border-white/10 text-[11px] text-dark-300 flex items-start gap-1.5">
                <Eye className="w-3.5 h-3.5 text-brand-400 flex-shrink-0 mt-0.5" />
                <span className="line-clamp-2"><strong className="text-dark-100">CTR Advice:</strong> {thumbnailNote}</span>
              </div>
            )}
          </div>

          {/* Platform & Campaign Controls (Col 7) */}
          <div className="md:col-span-7 space-y-3">
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-dark-400 mb-1.5 block">
                Target Platform
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
                {PLATFORMS.map(p => {
                  const Icon = p.icon
                  const active = platform === p.id
                  const chan = channels.find(c => c.id === p.id)
                  const isConn = chan?.connection?.status === 'connected'

                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setPlatform(p.id)
                        setQuickConnectOpen(false)
                      }}
                      className={`flex flex-col items-center justify-center p-2 rounded-xl border text-xs transition-all ${
                        active
                          ? 'border-brand-500/50 bg-brand-500/15 text-white shadow-md'
                          : 'border-white/5 bg-white/[0.02] text-dark-400 hover:text-white hover:bg-white/[0.05]'
                      }`}
                    >
                      <Icon className={`w-4 h-4 mb-1 ${p.color}`} />
                      <span className="font-semibold text-[10.5px] truncate w-full text-center">{p.name}</span>
                      <span className={`text-[8.5px] mt-0.5 ${isConn ? 'text-emerald-400' : 'text-dark-500'}`}>
                        {isConn ? '● Linked' : '○ Unlinked'}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Custom campaign or angle prompt */}
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-dark-400 mb-1 block">
                Viral Angle / Offer (Optional)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={customTopic}
                  onChange={e => setCustomTopic(e.target.value)}
                  placeholder="e.g. 20% launch discount, behind-the-scenes mystery..."
                  className="flex-1 bg-black/50 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white placeholder-dark-600 focus:outline-none focus:border-brand-500"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleGenerate}
                  loading={generating}
                  icon={<RefreshCw className="w-3 h-3" />}
                >
                  Regen
                </Button>
              </div>
            </div>

            {/* Connection Status & Quick Connect Toggle */}
            <div className={`p-2.5 rounded-xl border flex flex-col gap-1.5 text-xs ${
              isConnected
                ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-300'
                : 'border-amber-500/20 bg-amber-500/5 text-amber-300'
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 truncate">
                  {isConnected ? <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0" />}
                  <span className="truncate">
                    {isConnected
                      ? `Publishing as: ${connectedIdentity || currentChannel?.name}`
                      : `${currentChannel?.name || platform} is not connected`}
                  </span>
                </div>
                {!isConnected && (
                  <button
                    type="button"
                    onClick={() => setQuickConnectOpen(!quickConnectOpen)}
                    className="px-2 py-0.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 font-semibold text-[11px] transition-all flex items-center gap-1 flex-shrink-0"
                  >
                    <KeyRound className="w-3 h-3" />
                    {quickConnectOpen ? 'Hide Connect' : '⚡ Quick Connect'}
                  </button>
                )}
              </div>
              {isConnected && connectedIdentity && (
                <div className="text-[10px] text-emerald-400/80 font-mono pl-5">
                  ● Verified OAuth Session (Private Tenant)
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── In-Modal Quick Connect Drawer ── */}
        {quickConnectOpen && !isConnected && (
          <div className="p-3.5 rounded-xl border border-brand-500/30 bg-dark-900/90 space-y-3 animate-fadeIn">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
                <KeyRound className="w-3.5 h-3.5 text-brand-400" />
                <span>Quick Connect {currentChannel?.name || platform}</span>
              </div>
              <Link
                href="/dashboard/connections"
                target="_blank"
                className="text-[10.5px] text-dark-400 hover:text-white inline-flex items-center gap-1 underline"
              >
                Advanced Settings <ExternalLink className="w-2.5 h-2.5" />
              </Link>
            </div>

            {platform === 'youtube' && (
              <div className="space-y-2 text-xs">
                <p className="text-[11px] text-dark-300">
                  Connect YouTube in 60 seconds with Google OAuth Playground:
                </p>
                <div className="p-2 rounded-lg bg-white/[0.02] border border-white/5 text-[11px] text-dark-400 space-y-1">
                  <div>1. Open <a href="https://developers.google.com/oauthplayground" target="_blank" rel="noreferrer" className="text-brand-300 underline font-medium">Google OAuth 2.0 Playground <ExternalLink className="w-2.5 h-2.5 inline" /></a></div>
                  <div>2. Select scopes: <code className="text-cyan-300 font-mono">youtube.upload</code> and <code className="text-cyan-300 font-mono">youtube.force-ssl</code></div>
                  <div>3. Authorize APIs & click Exchange authorization code for tokens</div>
                </div>
                <input
                  type="password"
                  placeholder="Paste your OAuth Access Token (ya29...)"
                  value={connectFields.accessToken || ''}
                  onChange={e => setConnectFields({ ...connectFields, accessToken: e.target.value })}
                  className="w-full bg-black/60 border border-white/10 rounded-lg p-2 text-xs text-white placeholder-dark-600 focus:outline-none focus:border-brand-500 font-mono"
                />
              </div>
            )}

            {platform === 'tiktok' && (
              <div className="space-y-2 text-xs">
                <p className="text-[11px] text-dark-300">
                  Connect TikTok via 1-Minute Webhook Bridge (Make/Zapier) or Direct API:
                </p>
                <div className="space-y-2">
                  <input
                    type="text"
                    placeholder="Fastest: TikTok Webhook URL (https://hooks.zapier.com/... or Make hook)"
                    value={connectFields.webhookUrl || ''}
                    onChange={e => setConnectFields({ ...connectFields, webhookUrl: e.target.value })}
                    className="w-full bg-black/60 border border-white/10 rounded-lg p-2 text-xs text-white placeholder-dark-600 focus:outline-none focus:border-brand-500 font-mono"
                  />
                  <div className="text-[10px] text-dark-500 text-center uppercase tracking-wider">— OR —</div>
                  <input
                    type="password"
                    placeholder="TikTok Developer Access Token (act.example...)"
                    value={connectFields.accessToken || ''}
                    onChange={e => setConnectFields({ ...connectFields, accessToken: e.target.value })}
                    className="w-full bg-black/60 border border-white/10 rounded-lg p-2 text-xs text-white placeholder-dark-600 focus:outline-none focus:border-brand-500 font-mono"
                  />
                </div>
              </div>
            )}

            {platform === 'facebook_page' && (
              <div className="space-y-2 text-xs">
                <input
                  type="text"
                  placeholder="Page ID (numeric, e.g. 1092837465)"
                  value={connectFields.pageId || ''}
                  onChange={e => setConnectFields({ ...connectFields, pageId: e.target.value })}
                  className="w-full bg-black/60 border border-white/10 rounded-lg p-2 text-xs text-white placeholder-dark-600 focus:outline-none focus:border-brand-500 font-mono"
                />
                <input
                  type="password"
                  placeholder="Page Access Token (EAAG...)"
                  value={connectFields.pageToken || ''}
                  onChange={e => setConnectFields({ ...connectFields, pageToken: e.target.value })}
                  className="w-full bg-black/60 border border-white/10 rounded-lg p-2 text-xs text-white placeholder-dark-600 focus:outline-none focus:border-brand-500 font-mono"
                />
              </div>
            )}

            {platform === 'instagram' && (
              <div className="space-y-2 text-xs">
                <input
                  type="text"
                  placeholder="Instagram Business Account ID (1784...)"
                  value={connectFields.igUserId || ''}
                  onChange={e => setConnectFields({ ...connectFields, igUserId: e.target.value })}
                  className="w-full bg-black/60 border border-white/10 rounded-lg p-2 text-xs text-white placeholder-dark-600 focus:outline-none focus:border-brand-500 font-mono"
                />
                <input
                  type="password"
                  placeholder="Meta Page Access Token (EAAG...)"
                  value={connectFields.pageToken || ''}
                  onChange={e => setConnectFields({ ...connectFields, pageToken: e.target.value })}
                  className="w-full bg-black/60 border border-white/10 rounded-lg p-2 text-xs text-white placeholder-dark-600 focus:outline-none focus:border-brand-500 font-mono"
                />
              </div>
            )}

            {platform === 'telegram' && (
              <div className="space-y-2 text-xs">
                <input
                  type="password"
                  placeholder="Bot Token from @BotFather (123456:ABC-DEF...)"
                  value={connectFields.botToken || ''}
                  onChange={e => setConnectFields({ ...connectFields, botToken: e.target.value })}
                  className="w-full bg-black/60 border border-white/10 rounded-lg p-2 text-xs text-white placeholder-dark-600 focus:outline-none focus:border-brand-500 font-mono"
                />
                <input
                  type="text"
                  placeholder="Channel or Group Chat ID (e.g. -1001234567890)"
                  value={connectFields.chatId || ''}
                  onChange={e => setConnectFields({ ...connectFields, chatId: e.target.value })}
                  className="w-full bg-black/60 border border-white/10 rounded-lg p-2 text-xs text-white placeholder-dark-600 focus:outline-none focus:border-brand-500 font-mono"
                />
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button size="sm" variant="ghost" onClick={() => setQuickConnectOpen(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={handleQuickConnect}
                loading={connecting}
                icon={<Check className="w-3.5 h-3.5" />}
              >
                Verify & Connect
              </Button>
            </div>
          </div>
        )}

        {/* ── AI Generated Copy & Hashtags Editor ── */}
        <div className="space-y-2.5 pt-2 border-t border-white/10">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-white flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-brand-400" /> Viral Post Copy (Engineered with Psychology)
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopy}
                className="text-xs text-dark-400 hover:text-white flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-white/5 transition-all"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>{copied ? 'Copied' : 'Copy Text'}</span>
              </button>
            </div>
          </div>

          <textarea
            rows={6}
            value={editablePost}
            onChange={e => setEditablePost(e.target.value)}
            placeholder="Gemini Vision is analyzing your media and crafting your viral post..."
            className="w-full bg-black/60 border border-white/10 rounded-xl p-3 text-xs leading-relaxed text-dark-100 placeholder-dark-600 focus:outline-none focus:border-brand-500 font-mono"
          />

          {/* Hashtag chips */}
          {hashtags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-[10px] font-semibold text-dark-400 flex items-center gap-0.5 mr-1">
                <Hash className="w-3 h-3 text-brand-400" /> Strategic Tags:
              </span>
              {hashtags.map((tag, idx) => (
                <span
                  key={idx}
                  className="rounded-md bg-white/[0.04] border border-white/[0.08] px-2 py-0.5 text-[10.5px] font-mono text-cyan-300 hover:bg-white/[0.08] cursor-pointer transition-all"
                  onClick={() => {
                    navigator.clipboard.writeText(tag)
                    toast.success(`Copied ${tag}`)
                  }}
                  title="Click to copy tag"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* ── Modal Footer Buttons ── */}
        <div className="flex items-center justify-between pt-3 border-t border-white/10">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>

          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleCopy}
              icon={copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            >
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handlePublish}
              loading={publishing}
              disabled={generating || !editablePost.trim()}
              icon={<Send className="w-3.5 h-3.5" />}
            >
              🚀 Publish to {currentChannel?.name || 'Channel'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
