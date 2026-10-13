'use client'

import { useState, useEffect } from 'react'
import {
  Sparkles, Send, Copy, Check, RefreshCw, Hash,
  Facebook, Instagram, Youtube, ExternalLink, Image as ImageIcon,
  Video, Eye, AlertCircle, CheckCircle2, ShieldCheck, UserCheck, Download, CalendarClock, Save
} from 'lucide-react'
import { flowApi, channelApi } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { Modal } from '@/components/ui/Modal'
import { Button, Badge } from '@/components/ui/primitives'
import { downloadMedia } from '@/lib/download'
import toast from 'react-hot-toast'
import Link from 'next/link'

interface PushPostModalProps {
  open: boolean
  onClose: () => void
  mediaUrl: string
  prompt?: string
}

interface PostDraft {
  id: string
  platform: string
  text: string
  topic: string
  mediaUrl: string
  updatedAt: string
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
  const [drafts, setDrafts] = useState<PostDraft[]>([])
  const [draftId, setDraftId] = useState('')
  const [scheduleAt, setScheduleAt] = useState('')
  const [scheduling, setScheduling] = useState(false)

  // AI Generated Post fields
  const [headline, setHeadline] = useState('')
  const [caption, setCaption] = useState('')
  const [hashtags, setHashtags] = useState<string[]>([])
  const [cta, setCta] = useState('')
  const [thumbnailNote, setThumbnailNote] = useState('')
  const [hookType, setHookType] = useState('')
  const [mediaMeta, setMediaMeta] = useState<any>(null)
  const [editablePost, setEditablePost] = useState('')

  const isVideo = Boolean(mediaUrl && /\.(mp4|webm|mov|mkv)(\?|$)/i.test(mediaUrl))
  const draftStorageKey = user?._id ? `herovaai:post-drafts:${user._id}` : ''

  useEffect(() => {
    if (!open || !draftStorageKey) return
    try {
      const saved = JSON.parse(window.localStorage.getItem(draftStorageKey) || '[]')
      setDrafts(Array.isArray(saved) ? saved.filter((item: any) => item && typeof item.text === 'string') : [])
    } catch {
      setDrafts([])
    }
  }, [open, draftStorageKey])

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
  const configured = currentChannel?.connection?.configured || {}
  const hasRealCredentials = Object.entries(configured)
    .some(([key, value]) => key !== 'autoSetup' && Boolean(value))
  const isConnected = currentChannel?.connection?.status === 'connected' && hasRealCredentials
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

  const [sharingWeb, setSharingWeb] = useState(false)

  const PLATFORM_URLS: Record<string, string> = {
    youtube: 'https://www.youtube.com/upload',
    tiktok: 'https://www.tiktok.com/creator-center/upload',
    instagram: 'https://www.instagram.com/',
    facebook_page: 'https://www.facebook.com/',
    telegram: 'https://web.telegram.org/',
  }

  const handleCopy = async () => {
    if (!editablePost) return
    try {
      await navigator.clipboard.writeText(editablePost)
      setCopied(true)
      toast.success('Post text & #tags copied to clipboard!')
      setTimeout(() => setCopied(false), 2000)
    } catch (err: any) {
      toast.error(err.message || 'Could not copy the post text')
    }
  }

  // Prepare the caption and media for the owner's manual upload.
  const handleDirectWebShare = async () => {
    if (!editablePost.trim()) {
      toast.error('Post content is empty')
      return
    }
    setSharingWeb(true)
    const targetUrl = PLATFORM_URLS[platform] || 'https://www.youtube.com/upload'
    const uploadTab = window.open('about:blank', '_blank')
    try {
      await navigator.clipboard.writeText(editablePost)
      setCopied(true)

      if (mediaUrl) {
        toast.loading('Downloading your media and preparing the upload...', { duration: 2500 })
        await downloadMedia(mediaUrl, '1k')
      }

      if (uploadTab) uploadTab.location.href = targetUrl
      toast.success(`Media downloaded and caption copied. Finish the upload on ${currentChannel?.name || 'the platform'} by selecting the file and pasting the caption.`)
    } catch (err: any) {
      uploadTab?.close()
      toast.error(err.message || 'Quick share failed')
    } finally {
      setSharingWeb(false)
    }
  }

  const handlePublish = async () => {
    if (!editablePost.trim()) {
      toast.error('Post content is empty')
      return
    }

    if (!isConnected) {
      toast.error(`Connect and verify ${currentChannel?.name || platform} in Connections before publishing directly.`)
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

  const saveDraft = () => {
    if (!editablePost.trim()) {
      toast.error('Write or generate post text before saving a draft')
      return
    }
    if (!draftStorageKey) {
      toast.error('Sign in to save a private draft on this device')
      return
    }
    const draft: PostDraft = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      platform,
      text: editablePost,
      topic: customTopic,
      mediaUrl,
      updatedAt: new Date().toISOString(),
    }
    const next = [draft, ...drafts].slice(0, 20)
    try {
      window.localStorage.setItem(draftStorageKey, JSON.stringify(next))
      setDrafts(next)
      setDraftId(draft.id)
      toast.success('Draft saved on this device')
    } catch (err: any) {
      toast.error(err.message || 'Could not save this draft in your browser')
    }
  }

  const loadDraft = (id: string) => {
    setDraftId(id)
    const draft = drafts.find(item => item.id === id)
    if (!draft) return
    if (draft.mediaUrl !== mediaUrl) {
      toast.error('This draft belongs to different media. Open it from the original media first.')
      return
    }
    setPlatform(draft.platform)
    setCustomTopic(draft.topic || '')
    setEditablePost(draft.text)
    toast.success('Draft restored')
  }

  const schedulePost = async () => {
    if (!isConnected || !editablePost.trim()) return
    const time = new Date(scheduleAt)
    if (!scheduleAt || !Number.isFinite(time.getTime())) {
      toast.error('Choose a date and time for your post')
      return
    }
    setScheduling(true)
    try {
      await channelApi.schedulePost({
        channelId: platform,
        text: editablePost,
        mediaUrl,
        scheduledAt: time.toISOString(),
      })
      toast.success(`Post scheduled for ${time.toLocaleString()}`)
      setScheduleAt('')
      onClose()
    } catch (err: any) {
      toast.error(err.message || 'Could not schedule this post')
    } finally {
      setScheduling(false)
    }
  }

  const minScheduleTime = new Date(Date.now() + 5 * 60 * 1000)
  const scheduleMin = new Date(minScheduleTime.getTime() - minScheduleTime.getTimezoneOffset() * 60000)
    .toISOString().slice(0, 16)
  const restorableDrafts = drafts.filter(draft => draft.mediaUrl === mediaUrl)

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
          <span className="text-white font-semibold">Prepare a post with AI</span>
          <span className="rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
            Gemini Multimodal Vision
          </span>
        </div>
      }
      description="HerovaAi drafts a caption for your media. Publish directly only after connecting and verifying the platform, or prepare the file and caption for a manual upload."
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
            {/* Quick 1K & 2K Download buttons */}
            <div className="absolute bottom-2.5 right-2 flex items-center gap-1.5 z-10">
              <button
                type="button"
                onClick={() => downloadMedia(mediaUrl, '1k', 'herova_push_media')}
                className="px-2 py-1 rounded-lg bg-black/85 hover:bg-black text-[10.5px] font-medium text-emerald-300 border border-white/15 backdrop-blur-md flex items-center gap-1 shadow-md transition-all cursor-pointer"
                title="Download 1K High Resolution"
              >
                <Download className="w-3 h-3" /> 1K HD
              </button>
              {!isVideo && (
                <button
                  type="button"
                  onClick={() => downloadMedia(mediaUrl, '2k', 'herova_push_media')}
                  className="px-2 py-1 rounded-lg bg-brand-500/85 hover:bg-brand-500 text-[10.5px] font-semibold text-white border border-brand-400/30 backdrop-blur-md flex items-center gap-1 shadow-md transition-all cursor-pointer"
                  title="Upscale to 2K Ultra HD (2048px)"
                >
                  <Sparkles className="w-3 h-3 text-brand-200" /> 2K UHD
                </button>
              )}
            </div>
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

            {/* Connection status */}
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
              </div>
              {isConnected && connectedIdentity && (
                <div className="text-[10px] text-emerald-400/80 pl-5">Account connection was verified.</div>
              )}
            </div>
          </div>
        </div>

        {!isConnected ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-3.5">
            <p className="text-[12px] leading-relaxed text-dark-300">
              Direct publishing needs a real, verified platform connection. This account is not linked yet.
            </p>
            <Link href="/dashboard/connections" className="btn-ghost btn-sm inline-flex items-center gap-1.5">
              Connect in Settings <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </div>
        ) : null}

        {/* ── AI Generated Copy & Hashtags Editor ── */}
        <div className="space-y-2.5 pt-2 border-t border-white/10">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-white flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-brand-400" /> Viral Post Copy (Engineered with Psychology)
            </label>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={saveDraft} disabled={!editablePost.trim()} icon={<Save className="h-3 w-3" />}>
                Save draft
              </Button>
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

          {restorableDrafts.length > 0 ? (
            <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
              <label htmlFor="post-draft" className="text-[10.5px] text-dark-400">Saved drafts on this device</label>
              <select
                id="post-draft"
                value={draftId}
                onChange={event => loadDraft(event.target.value)}
                className="input-dark min-w-0 flex-1 text-xs"
              >
                <option value="">Choose a draft to restore…</option>
                {restorableDrafts.map(draft => (
                  <option key={draft.id} value={draft.id}>
                    {new Date(draft.updatedAt).toLocaleString()} · {PLATFORMS.find(item => item.id === draft.platform)?.name || draft.platform}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <p className="text-[10px] leading-relaxed text-dark-500">Drafts stay in this browser and store the caption plus media link, not a copy of the media file.</p>

          <textarea
            rows={6}
            value={editablePost}
            onChange={e => setEditablePost(e.target.value)}
            placeholder="Analyzing your media and drafting an original post..."
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
        <div className="sticky bottom-0 -mx-5 -mb-4 border-t border-white/10 bg-dark-900/95 px-5 pb-4 pt-3 backdrop-blur-xl">
          <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <label className="sr-only" htmlFor="scheduled-post-time">Schedule date and time</label>
            <input
              id="scheduled-post-time"
              type="datetime-local"
              min={scheduleMin}
              value={scheduleAt}
              onChange={event => setScheduleAt(event.target.value)}
              className="input-dark min-w-0 text-xs"
              aria-label="Choose when to publish this post"
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={schedulePost}
              loading={scheduling}
              disabled={!isConnected || !editablePost.trim() || !scheduleAt || generating}
              icon={<CalendarClock className="h-3.5 w-3.5" />}
              className="w-full sm:w-auto"
            >
              Schedule post
            </Button>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Button variant="ghost" size="sm" onClick={onClose} className="w-full sm:w-auto">
              Close
            </Button>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDirectWebShare}
              loading={sharingWeb}
              disabled={generating || !editablePost.trim()}
              icon={<ExternalLink className="w-3.5 h-3.5 text-cyan-400" />}
              className="w-full border border-cyan-500/30 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20 sm:w-auto"
              title="Downloads the media, copies its caption, and opens the platform so you can finish uploading"
            >
              Prepare manual upload
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleCopy}
              icon={copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              className="w-full sm:w-auto"
            >
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handlePublish}
              loading={publishing}
              disabled={generating || !editablePost.trim() || !isConnected}
              icon={<Send className="w-3.5 h-3.5" />}
              className="col-span-2 w-full sm:col-span-1 sm:w-auto"
            >
              {isConnected ? `Publish to ${currentChannel?.name || 'Channel'}` : 'Connect platform first'}
            </Button>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}
