'use client'

import { ChangeEvent, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  AlertCircle, CheckCircle2, Copy, Facebook, Image as ImageIcon,
  Loader2, Send, Sparkles, CalendarClock, X,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { channelApi, flowApi } from '@/lib/api'
import { Button } from '@/components/ui/primitives'

interface ReferenceImage {
  mimeType: string
  data: string
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read the selected image.'))
    reader.onload = () => {
      const result = String(reader.result || '')
      const comma = result.indexOf(',')
      if (comma < 0) reject(new Error('Could not prepare the selected image.'))
      else resolve(result.slice(comma + 1))
    }
    reader.readAsDataURL(blob)
  })
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not resize the selected image.')), 'image/jpeg', quality)
  })
}

async function prepareReference(file: File): Promise<ReferenceImage> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Choose a JPEG, PNG, or WebP image.')
  }

  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Your browser could not prepare this image.')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

    let blob: Blob | null = null
    for (const quality of [0.84, 0.76, 0.68, 0.6, 0.52]) {
      blob = await canvasBlob(canvas, quality)
      if (blob.size <= 600 * 1024) break
    }
    if (!blob || blob.size > 600 * 1024) {
      throw new Error('This image is too detailed to prepare. Try a smaller image.')
    }
    return { mimeType: 'image/jpeg', data: await toBase64(blob) }
  } finally {
    bitmap.close()
  }
}

export function CommercialPostCreator() {
  const [prompt, setPrompt] = useState('')
  const [offer, setOffer] = useState('')
  const [referenceImage, setReferenceImage] = useState<ReferenceImage | null>(null)
  const [referenceName, setReferenceName] = useState('')
  const [mediaUrl, setMediaUrl] = useState('')
  const [post, setPost] = useState('')
  const [profileUsed, setProfileUsed] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [scheduling, setScheduling] = useState(false)
  const [scheduleAt, setScheduleAt] = useState('')
  const [channel, setChannel] = useState<any>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let active = true
    channelApi.list().then((response: any) => {
      if (active) setChannel((response.channels || []).find((item: any) => item.id === 'facebook_page') || null)
    }).catch(() => {
      if (active) setChannel(null)
    })
    return () => { active = false }
  }, [])

  const configured = channel?.connection?.configured || {}
  const hasCredentials = Object.entries(configured).some(([key, value]) => key !== 'autoSetup' && Boolean(value))
  const connected = channel?.connection?.status === 'connected' && hasCredentials
  const identity = channel?.connection?.meta?.pageName || channel?.connection?.label || 'Facebook Page'
  const minSchedule = new Date(Date.now() + 5 * 60 * 1000)
  const minScheduleValue = new Date(minSchedule.getTime() - minSchedule.getTimezoneOffset() * 60000)
    .toISOString().slice(0, 16)

  const chooseReference = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setUploadingImage(true)
    try {
      setReferenceImage(await prepareReference(file))
      setReferenceName(file.name)
      setMediaUrl('')
      setPost('')
    } catch (error: any) {
      toast.error(error.message || 'Could not prepare this image')
    } finally {
      setUploadingImage(false)
    }
  }

  const generate = async () => {
    setGenerating(true)
    try {
      const response: any = await flowApi.generateCommercialPost({
        prompt,
        customTopic: offer,
        referenceImage,
      })
      if (!response?.success || !response.post?.fullPost) {
        throw new Error(response?.message || 'The post could not be generated.')
      }
      setPost(response.post.fullPost)
      setProfileUsed(Boolean(response.businessProfileUsed))
      setMediaUrl('')
      toast.success('Fresh Facebook post created')
    } catch (error: any) {
      toast.error(error.message || 'Could not generate the post')
    } finally {
      setGenerating(false)
    }
  }

  const getPublishMediaUrl = async () => {
    if (mediaUrl) return mediaUrl
    if (!referenceImage) return ''
    const response: any = await flowApi.uploadCommercialReference(referenceImage)
    if (!response?.success || !response.mediaUrl) {
      throw new Error(response?.message || 'Could not prepare the reference image for Facebook.')
    }
    setMediaUrl(response.mediaUrl)
    return response.mediaUrl
  }

  const publishNow = async () => {
    if (!connected) {
      toast.error('Connect and verify your Facebook Page before publishing.')
      return
    }
    if (!post.trim()) return
    setPublishing(true)
    try {
      const attachedMediaUrl = await getPublishMediaUrl()
      const response: any = await flowApi.publishPost({
        channelId: 'facebook_page',
        text: post.trim(),
        mediaUrl: attachedMediaUrl,
      })
      if (!response?.success) throw new Error(response?.message || 'Facebook could not publish this post.')
      toast.success(response.message || `Published to ${identity}`)
    } catch (error: any) {
      toast.error(error.message || 'Could not publish this post')
    } finally {
      setPublishing(false)
    }
  }

  const schedule = async () => {
    if (!connected) {
      toast.error('Connect and verify your Facebook Page before scheduling.')
      return
    }
    const date = new Date(scheduleAt)
    if (!scheduleAt || !Number.isFinite(date.getTime()) || date.getTime() < Date.now() + 5 * 60 * 1000) {
      toast.error('Choose a time at least five minutes from now.')
      return
    }
    setScheduling(true)
    try {
      const attachedMediaUrl = await getPublishMediaUrl()
      await channelApi.schedulePost({
        channelId: 'facebook_page',
        text: post.trim(),
        mediaUrl: attachedMediaUrl,
        scheduledAt: date.toISOString(),
      })
      toast.success(`Facebook post scheduled for ${date.toLocaleString()}`)
      setScheduleAt('')
    } catch (error: any) {
      toast.error(error.message || 'Could not schedule this post')
    } finally {
      setScheduling(false)
    }
  }

  const copyPost = async () => {
    if (!post.trim()) return
    try {
      await navigator.clipboard.writeText(post)
      setCopied(true)
      toast.success('Post copied')
      window.setTimeout(() => setCopied(false), 1800)
    } catch (error: any) {
      toast.error(error.message || 'Could not copy the post')
    }
  }

  return (
    <section className="card overflow-hidden">
      <div className="border-b border-white/[0.06] bg-gradient-to-r from-blue-500/[0.10] via-brand-500/[0.06] to-transparent p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-400/20 bg-blue-400/10 text-blue-300">
            <Facebook className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-white">Facebook commercial post creator</h2>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-dark-300">
              Start with a short brief, an image, your saved business profile—or any combination. HerovaAi writes a fresh, editable post and avoids repeating your recent drafts.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-2">
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-dark-200">What are you promoting? <span className="text-dark-500">(optional)</span></span>
            <textarea
              value={prompt}
              onChange={event => setPrompt(event.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="Describe your product or service, who it helps, and the result customers can expect. You can leave this blank to use your business profile."
              className="input-dark w-full resize-y text-xs leading-relaxed"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-dark-200">Offer or campaign details <span className="text-dark-500">(optional)</span></span>
            <input
              value={offer}
              onChange={event => setOffer(event.target.value)}
              maxLength={1000}
              placeholder="Only include real details, e.g. launch offer, target audience, or preferred call to action"
              className="input-dark w-full text-xs"
            />
          </label>

          <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ImageIcon className="h-4 w-4 text-brand-300" aria-hidden />
                <span className="text-xs font-medium text-dark-200">Reference image <span className="text-dark-500">(optional)</span></span>
              </div>
              <label className="cursor-pointer rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] font-medium text-dark-200 transition hover:bg-white/[0.06]">
                {uploadingImage ? 'Preparing…' : referenceImage ? 'Choose another' : 'Choose image'}
                <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={chooseReference} disabled={uploadingImage} />
              </label>
            </div>
            <p className="mt-1.5 text-[10px] leading-relaxed text-dark-500">Use a product photo or visual inspiration. If you publish or schedule, this image is attached to the Facebook post.</p>
            {referenceImage ? (
              <div className="mt-3 flex items-center gap-3">
                <img
                  src={`data:${referenceImage.mimeType};base64,${referenceImage.data}`}
                  alt="Selected Facebook post reference"
                  className="h-16 w-16 rounded-lg border border-white/10 object-cover"
                />
                <span className="min-w-0 flex-1 truncate text-[11px] text-dark-300">{referenceName}</span>
                <button
                  type="button"
                  onClick={() => { setReferenceImage(null); setReferenceName(''); setMediaUrl(''); setPost('') }}
                  className="rounded-md p-1 text-dark-400 hover:bg-white/5 hover:text-white"
                  aria-label="Remove reference image"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-sm text-[10px] leading-relaxed text-dark-500">
              {profileUsed
                ? 'Your saved business profile was used. Missing prices or promises are never invented.'
                : <>Your saved business profile is included automatically when available. <Link href="/dashboard/memory" className="text-brand-300 hover:text-brand-200">Add business details</Link> for more tailored copy.</>}
            </p>
            <Button
              variant="primary"
              size="sm"
              onClick={generate}
              loading={generating}
              disabled={generating || uploadingImage}
              icon={<Sparkles className="h-3.5 w-3.5" />}
            >
              {post ? 'Create a fresh version' : 'Create Facebook post'}
            </Button>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="commercial-post-copy" className="flex items-center gap-1.5 text-xs font-medium text-dark-200">
              <Sparkles className="h-3.5 w-3.5 text-brand-300" aria-hidden />
              Review and edit your post
            </label>
            <button
              type="button"
              onClick={copyPost}
              disabled={!post.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] text-dark-300 transition hover:bg-white/[0.05] hover:text-white disabled:opacity-40"
            >
              <Copy className="h-3.5 w-3.5" aria-hidden /> {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <textarea
            id="commercial-post-copy"
            value={post}
            onChange={event => setPost(event.target.value)}
            rows={11}
            maxLength={5000}
            placeholder="Your editable Facebook post will appear here."
            className="input-dark w-full resize-y text-xs leading-relaxed"
          />

          {!connected ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-3">
              <span className="flex items-center gap-1.5 text-[11px] text-amber-200">
                <AlertCircle className="h-3.5 w-3.5" aria-hidden /> Facebook Page is not connected
              </span>
              <Link href="/dashboard/connections" className="text-[11px] font-medium text-brand-300 hover:text-brand-200">Connect Page</Link>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-[11px] text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Ready to publish as {identity}
            </div>
          )}

          <div className="flex flex-col gap-2 border-t border-white/[0.06] pt-3 sm:flex-row sm:items-center">
            <label htmlFor="commercial-post-schedule" className="sr-only">Schedule Facebook post</label>
            <input
              id="commercial-post-schedule"
              type="datetime-local"
              min={minScheduleValue}
              value={scheduleAt}
              onChange={event => setScheduleAt(event.target.value)}
              className="input-dark min-w-0 flex-1 text-xs"
              aria-label="Choose when to publish the Facebook post"
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={schedule}
              loading={scheduling}
              disabled={!connected || !post.trim() || !scheduleAt || generating || uploadingImage}
              icon={<CalendarClock className="h-3.5 w-3.5" />}
            >
              Schedule
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={publishNow}
              loading={publishing}
              disabled={!connected || !post.trim() || generating || uploadingImage}
              icon={<Send className="h-3.5 w-3.5" />}
            >
              Publish now
            </Button>
          </div>
          <p className="text-[10px] leading-relaxed text-dark-500">
            This publishes a Page post, not a paid Ads Manager campaign. Nothing is published automatically; review your edits, then choose Publish now or Schedule.
          </p>
        </div>
      </div>
    </section>
  )
}
