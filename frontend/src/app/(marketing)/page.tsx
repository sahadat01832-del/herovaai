'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import {
  Bot, Send, User, Sparkles,
  ArrowRight, Loader2, Square, Wifi, WifiOff, Check, Lock, Download,
} from 'lucide-react'
import { chatApi, authApi } from '@/lib/api'
import { getToken, getUser, getApiUrl, ApiError } from '@/lib/auth'
import { downloadMedia } from '@/lib/download'
import toast from 'react-hot-toast'
import ReactMarkdown from 'react-markdown'
import { Reveal } from '@/components/ui/Reveal'
import { SiteFooter } from '@/components/marketing/SiteFooter'
import { useAuth } from '@/contexts/AuthContext'

interface Message {
  role: 'user' | 'assistant'
  content: string
  model?: string
}

interface PublicModel {
  id: string
  name: string
  source: 'local' | 'api' | 'contentbot'
  badge?: string
  description?: string
  group?: string
  ramHint?: string
  isPaid?: boolean
  servable?: boolean
}

// The public backend answers with a minimal payload only: a boolean plus how
// many public-size models exist. Never the daemon's model list or errors.
interface LocalStatus {
  isOnline: boolean
  starting: boolean
  state?: string
  activeModel?: string | null
  lastError?: string | null
  availablePublicModels?: number
}

const QUICK_PROMPTS = [
  'What should my shop promote this week?',
  'What can you do for my shop?',
  'Write a WhatsApp reply for a price question',
  'Give me 3 ideas to bring customers back',
]

/* ══════════════════════════════════════════════════════════════════════════
   Marketing content — kept in step with the static public site
   (herovaai-site/index.html) so both front doors tell the same story.
   The live demo panel beside the hero is this app's own addition.
   ══════════════════════════════════════════════════════════════════════════ */

const STATS = [
  ['24/7', 'always-on replies'],
  ['<1s', 'typical response'],
  ['10/day', 'free AI images'],
  ['৳0', 'to get started'],
] as const

const FEATURES: { icon: string; title: string; body: string; wide?: boolean }[] = [
  {
    icon: '💬',
    title: '24/7 WhatsApp & Messenger AI',
    body: 'Scan a QR code once. It answers customers while you sleep or serve someone else — prices, inventory, shipping and orders — in your own tone of voice.',
  },
  {
    icon: '🎨',
    title: 'Google Flow image & video studio',
    body: 'Generate photorealistic images (Nano Banana) and cinematic video straight from a prompt — a free daily allowance included, no API keys or subscriptions of your own.',
  },
  {
    icon: '📱',
    title: 'Shorts & TikTok auto-poster',
    body: 'Turn one offer into a short vertical clip and schedule it to YouTube Shorts and TikTok — one click, no extra tools.',
  },
  {
    icon: '🧠',
    title: 'Adaptive business memory',
    body: 'Your prices, policies and style get remembered once and used in every answer — no repeated explanations.',
  },
  {
    icon: '⚡',
    title: 'Transparent local billing',
    body: '৳100/month Pro, ৳300/month Enterprise, Nagad & local payment. No hidden credits, no surprise usage fees.',
  },
  {
    icon: '🛡️',
    title: 'Tenant isolation',
    body: 'Every shop gets a private workspace. Your customers, memory and media never mix with anyone else.',
  },
  {
    icon: '🔌',
    title: 'Every channel, one place',
    body: 'WhatsApp, Messenger, Telegram, web chat, YouTube and TikTok — manage all of them from a single dashboard.',
    wide: true,
  },
]

const FLOW_TILES = [
  'bg-gradient-to-br from-brand-400/40 to-brand-600/15',
  'bg-gradient-to-br from-amber-200/25 to-brand-500/20',
  'bg-gradient-to-br from-brand-300/30 to-orange-500/10',
  'bg-gradient-to-br from-yellow-100/20 to-brand-400/25',
]

const STEPS = [
  {
    title: 'Create your account:',
    body: 'Register in 30 seconds and add your store name, products and rules to the AI memory.',
  },
  {
    title: 'Connect your channels:',
    body: 'Pair WhatsApp with a QR scan, or link YouTube & TikTok with one-click helpers.',
  },
  {
    title: 'Sit back and grow:',
    body: 'Let the AI answer customers around the clock and auto-publish your content.',
  },
] as const

const PLANS = [
  {
    name: 'Free Starter',
    desc: 'For testing the waters and small shops.',
    price: '৳0',
    features: [
      '1,000,000 AI tokens per week',
      '1 WhatsApp assistant connection',
      '10 AI images per day',
      'Basic business memory',
      'Web AI chat assistant',
    ],
    cta: 'Start free',
    featured: false,
  },
  {
    name: 'Pro Creator & Shop',
    desc: 'For active shops, creators and sellers.',
    price: '৳100',
    features: [
      '5,000,000 AI tokens per week',
      'Google Flow studio (image & video)',
      '100 AI images per billing cycle',
      'Shorts & TikTok 1-click publishing',
      'Daily automated social posting',
      'Messenger & Telegram auto-replies',
    ],
    cta: 'Upgrade to Pro',
    featured: true,
  },
  {
    name: 'Enterprise',
    desc: 'For agencies, high-volume shops and brands.',
    price: '৳300',
    features: [
      'Unlimited token throughput',
      'Unlimited AI image generation',
      'Multiple WhatsApp numbers',
      'Priority generation queue',
      'Custom webhook automations',
      'Dedicated support & setup',
    ],
    cta: 'Get Enterprise',
    featured: false,
  },
] as const

export default function HomePage() {
  const { user, token } = useAuth()
  const isLoggedIn = Boolean(user || token)
  const userName = user?.name || ''
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content:
        "Hello! I'm **HerovaAi** — the assistant for your business. Ask me what you would ask a new staff member: prices, opening hours, what to say to a customer. **No sign-up needed to try.**",
    },
  ])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [models, setModels] = useState<PublicModel[]>([])
  const [modelsLoading, setModelsLoading] = useState(true)
  const [selectedModel, setSelectedModel] = useState('')
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [status, setStatus] = useState<LocalStatus | null>(null)
  const [warmingUp, setWarmingUp] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const hasMounted = useRef(false)
  const chatInputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const selected = models.find(m => m.id === selectedModel)
  const selectedIsLocal = selected?.source === 'local'
  const localReady = Boolean(status?.isOnline && (!status?.starting))

  // ── Model catalog ─────────────────────────────────────────────────────────
  const loadModels = useCallback(async () => {
    try {
      const data = await chatApi.getModels()
      const list: PublicModel[] = Array.isArray(data.publicModels)
        ? data.publicModels
        : [
            // Older backend without the public catalog: keep guests inside the tier
            // the API actually accepts instead of showing every model.
            ...(data.localModels || []).filter((m: PublicModel) => !m.isPaid),
            ...(data.apiModels || []).filter((m: PublicModel) => m.servable && m.isPaid === false),
          ]
      // LM Studio asleep means the backend lists no local ids yet. Offer one honest
      // switch for it anyway, otherwise a visitor could never choose the private
      // route and the local server would never be asked to start.
      const withLocalEntry = list.some(m => m.source === 'local')
        ? list
        : [
            {
              id: 'local',
              name: 'Private on-device — starts on demand',
              source: 'local' as const,
              badge: 'on-device',
              ramHint: 'never leaves this machine',
            },
            ...list,
          ]
      setModels(withLocalEntry)
    } catch {
      toast.error('Could not load the model list — is the backend running?')
    } finally {
      setModelsLoading(false)
    }
  }, [])

  useEffect(() => { loadModels() }, [loadModels])

  // Pick a sensible first model once we know whether the local server is awake:
  // a warm local model is the private option, otherwise a free cloud model answers
  // instantly instead of making every visitor boot a model on the host's RAM.
  useEffect(() => {
    if (selectedModel || models.length === 0 || status === null) return
    const local = models.find(m => m.source === 'local')
    const cloud = models.find(m => m.source !== 'local')
    const preferred = status.isOnline ? (local ?? cloud) : (cloud ?? local)
    setSelectedModel(preferred?.id || '')
  }, [models, status, selectedModel])

  // ── Local LM Studio status (polled only while it matters) ────────────────
  const pollStatus = useCallback(async () => {
    try {
      const data = await chatApi.getLmStatus()
      setStatus({
        isOnline: Boolean(data.isOnline),
        starting: Boolean(data.starting),
        state: data.state || (data.isOnline ? 'online' : 'offline'),
        activeModel: data.activeModel ?? null,
        lastError: data.lastError ?? null,
        availablePublicModels:
          typeof data.availablePublicModels === 'number' ? data.availablePublicModels : undefined,
      })
    } catch {
      /* status is best effort */
    }
  }, [])

  useEffect(() => {
    pollStatus()
    const interval = setInterval(pollStatus, selectedIsLocal || warmingUp ? 3000 : 20000)
    return () => clearInterval(interval)
  }, [pollStatus, selectedIsLocal, warmingUp])

  useEffect(() => {
    if (status?.isOnline && !status?.starting && warmingUp) {
      setWarmingUp(false)
      toast.success('Private AI is ready — it runs entirely on this machine.')
    }
    if (status?.state === 'error' && warmingUp) setWarmingUp(false)
  }, [status?.state, warmingUp])

  // ── Free the RAM when the visitor leaves the local chat ──────────────────
  useEffect(() => {
    const release = () => {
      try {
        // keepalive lets the request survive the page going away; the backend
        // unloads the model and (when it started it) stops LM Studio.
        // 90s of grace: a reload re-uses the running server, but a visitor who
        // really left gets the RAM back shortly after.
        fetch(`${getApiUrl()}/chat/lm-studio/unload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stopServer: true, graceSeconds: 90 }),
          keepalive: true,
        }).catch(() => {})
      } catch { /* nothing else we can do while unloading */ }
    }
    window.addEventListener('pagehide', release)
    return () => {
      window.removeEventListener('pagehide', release)
    }
  }, [])

  // ── Scroll only when a message is actually added (never on first paint) ──
  useEffect(() => {
    if (!hasMounted.current) { hasMounted.current = true; return }
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length, sending])

  // ── Send ─────────────────────────────────────────────────────────────────
  const send = async (text?: string) => {
    const composed = (text ?? input).trim()
    if (!composed || sending) return

    if (selectedIsLocal && !localReady) {
      toast.error('Local AI is still starting — this takes a moment the first time.')
      warmUp()
      return
    }

    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: composed }])
    setSending(true)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res: any = await chatApi.sendPublicMessage(composed, conversationId, selectedModel || undefined, controller.signal)
      if (res.conversationId) setConversationId(res.conversationId)
      if (res.aiMessage) setMessages(prev => [...prev, res.aiMessage])
    } catch (err) {
      const apiErr = err as ApiError
      if (apiErr.name === 'AbortError') {
        setMessages(prev => [...prev, { role: 'assistant', content: '_Cancelled._' }])
      } else if (apiErr.code === 'LM_STARTING' || apiErr.code === 'LM_OFFLINE') {
        warmUp()
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: '⏳ The private on-device model is waking up. Send that message again in a few seconds.',
        }])
      } else {
        toast.error(apiErr.message)
        setMessages(prev => [...prev, { role: 'assistant', content: `⚠️ **${apiErr.message}**` }])
      }
    } finally {
      abortRef.current = null
      setSending(false)
    }
  }

  const cancel = () => {
    abortRef.current?.abort()
    setSending(false)
  }

  const warmUp = async () => {
    setWarmingUp(true)
    try {
      await chatApi.warmLocalModel(selectedModel === 'local' ? undefined : selectedModel)
      pollStatus()
    } catch (err) {
      setWarmingUp(false)
      toast.error((err as Error).message)
    }
  }

  const localModels = models.filter(m => m.source === 'local')
  const cloudModels = models.filter(m => m.source !== 'local')
  const localLabel = status?.starting || warmingUp
    ? 'Waking private AI…'
    : status?.isOnline
      ? 'Private AI active'
      : 'Private AI off'

  return (
    <div className="relative flex min-h-screen flex-col text-dark-100">
      {/* Slow colour field behind everything: three drifting washes, no neon. */}
      <div className="aurora fixed inset-0 -z-10" aria-hidden>
        <span /><span /><span />
      </div>

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <header className="glass-toolbar sticky top-0 z-40">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-3 px-5">
          <Link href="/" className="flex items-center gap-3">
            <img
              src="/logo.png"
              alt="HerovaAi"
              width={40}
              height={40}
              className="h-10 w-10 rounded-xl ring-1 ring-white/10"
            />
            <span className="flex items-baseline gap-2">
              <span className="font-display text-[17px] font-semibold tracking-tight text-white">
                Herova<span className="text-brand-400">Ai</span>
              </span>
              <span className="hidden text-[11px] font-medium uppercase tracking-[0.14em] text-dark-500 sm:inline">
                AI assistant for shops
              </span>
            </span>
          </Link>

          <nav className="hidden items-center gap-1 lg:flex" aria-label="Page sections">
            {[
              { href: '#features', label: 'Features' },
              { href: '#flow', label: 'Flow Studio' },
              { href: '#pricing', label: 'Pricing' },
              { href: '#how', label: 'How it works' },
            ].map(l => (
              <a
                key={l.href}
                href={l.href}
                className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-dark-300 transition-colors hover:bg-white/[0.06] hover:text-white"
              >
                {l.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <span
              className="hidden items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-[11px] font-medium text-dark-300 md:inline-flex"
              title={status?.isOnline ? 'Answering on this machine' : 'Kept off to save resources'}
            >
              {status?.isOnline ? (
                <Wifi className="h-3 w-3 text-emerald-400" aria-hidden />
              ) : (
                <WifiOff className="h-3 w-3 text-dark-500" aria-hidden />
              )}
              {localLabel}
            </span>

            {isLoggedIn ? (
              <Link href="/dashboard" className="btn-primary btn-sm btn-sheen">
                Dashboard{userName ? ` · ${userName}` : ''}
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            ) : (
              <>
                <Link href="/login" className="btn-ghost btn-sm">
                  <Lock className="h-3.5 w-3.5" aria-hidden />
                  Sign in
                </Link>
                <Link href="/register" className="btn-primary btn-sm btn-sheen">
                  Get started
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="relative mx-auto w-full max-w-6xl flex-1 px-5 pb-16 pt-12 lg:pt-16">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-12">
          {/* ── Left: proposition ─────────────────────────────────────── */}
          <section className="lg:col-span-6 xl:col-span-5">
            <Reveal>
              <span className="inline-flex items-center gap-2 rounded-full border border-brand-400/25 bg-brand-400/[0.08] px-3.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-200 shadow-[0_0_20px_rgba(216,189,133,0.15)]">
                <Sparkles className="h-3 w-3 text-brand-300" aria-hidden />
                Autonomous AI Engine for Business &amp; Content
              </span>

              <h1 className="mt-5 text-[32px] font-semibold leading-[1.08] tracking-tight text-white sm:text-[42px] lg:text-[46px]">
                Automate customer sales
                <span className="gradient-text block">&amp; grow your social presence</span>
              </h1>

              <p className="mt-5 max-w-xl text-[14.5px] leading-relaxed text-dark-300 sm:text-[15px]">
                Tell it once what you sell, your prices and your rules. HerovaAi answers customers on
                WhatsApp around the clock, generates images and cinematic video with Google Flow, and
                publishes to YouTube Shorts &amp; TikTok — all from one dashboard.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link href={isLoggedIn ? '/dashboard' : '/register'} className="btn-primary btn-sheen btn-lg shadow-gold">
                  {isLoggedIn ? 'Open your dashboard' : 'Get started free'}
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
                <button
                  onClick={() => {
                    // On a phone the panel sits below the fold: bring it up first, then focus.
                    panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                    chatInputRef.current?.focus({ preventScroll: true })
                  }}
                  className="btn-ghost btn-lg"
                >
                  <Sparkles className="h-4 w-4 text-brand-300" aria-hidden />
                  Try the live AI chat
                </button>
              </div>

              <p className="mt-4 text-[12px] text-dark-500">
                Zero credit card required · Free tier forever · Nagad &amp; local payment ready
              </p>
            </Reveal>
          </section>

          {/* ── Right: live chat ─────────────────────────────────────── */}
          <section className="lg:col-span-6 xl:col-span-7">
            {/* A chat panel that fits the screen it is on: phones get the available
                height (so the composer is never under the fold), desktop keeps 600px. */}
            <div
              ref={panelRef}
              className="relative flex h-[min(600px,calc(100dvh-7.5rem))] min-h-[26rem] animate-fade-up flex-col overflow-hidden rounded-3xl border border-white/[0.08] bg-dark-900/70 shadow-lift backdrop-blur-xl"
            >
              {/* Champagne hairline: the one luxury cue on the panel edge. */}
              <span className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-brand-400/50 to-transparent" />

              {/* Chat header */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-3.5">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="relative flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-gradient-to-br from-brand-400/30 to-brand-500/20 text-brand-100 ring-1 ring-inset ring-white/10">
                    <Bot className="h-[18px] w-[18px]" aria-hidden />
                    {localReady ? (
                      <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-dark-900 bg-emerald-400" aria-hidden />
                    ) : null}
                  </span>
                  <div className="min-w-0">
                    <h2 className="truncate text-[13.5px] font-semibold text-white">Try it before you sign up</h2>
                    <p className="truncate text-[11px] text-dark-500">
                      {selectedIsLocal
                        ? localReady
                          ? 'Running on this machine'
                          : 'Starts on demand · frees itself when you leave'
                        : 'Free cloud model · no sign-in needed'}
                    </p>
                  </div>
                </div>

                <label className="flex min-w-[180px] flex-1 items-center gap-2 sm:flex-none">
                  <span className="sr-only">Model</span>
                  <select
                    value={selectedModel}
                    onChange={e => setSelectedModel(e.target.value)}
                    disabled={modelsLoading || models.length === 0}
                    className="input-dark w-full px-3 py-2 text-[12px] font-medium disabled:opacity-50"
                  >
                    {modelsLoading && <option>Loading models…</option>}
                    {!modelsLoading && models.length === 0 && <option>No models available</option>}
                    {localModels.length > 0 && (
                      <optgroup label="Private on-device">
                        {localModels.map(m => (
                          <option key={m.id} value={m.id} className="bg-dark-900">
                            {m.name || m.id}{m.ramHint ? ` · ${m.ramHint}` : ''}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {cloudModels.length > 0 && (
                      <optgroup label="Free cloud models">
                        {cloudModels.map(m => (
                          <option key={m.id} value={m.id} className="bg-dark-900">
                            {m.name}{m.badge ? ` · ${m.badge}` : ''}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </label>
              </div>

              {/* Local lifecycle notice */}
              {selectedIsLocal && (!localReady || warmingUp) && (
                <div className="flex items-center gap-3 border-b border-white/[0.06] bg-brand-400/[0.05] px-5 py-3 text-[12px] text-brand-100">
                  <Loader2 className="h-4 w-4 flex-none animate-spin" aria-hidden />
                  <span className="flex-1">
                    {status?.starting || warmingUp
                      ? 'Waking the private on-device model — the first start can take up to a minute.'
                      : 'Private AI is off right now. Turn it on to chat without anything leaving this machine.'}
                  </span>
                  {!status?.starting && !warmingUp && (
                    <button onClick={warmUp} className="btn-primary btn-sm">
                      Turn on private AI
                    </button>
                  )}
                </div>
              )}

              {/* Messages */}
              <div ref={scrollRef} className="scroll-thin flex-1 space-y-4 overflow-y-auto px-5 py-5">
                {messages.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex animate-fade-up gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    {msg.role === 'assistant' && (
                      <span className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.04] text-brand-200">
                        <Bot className="h-3.5 w-3.5" aria-hidden />
                      </span>
                    )}
                    <div className={`max-w-[82%] px-4 py-2.5 text-[13.5px] leading-relaxed ${msg.role === 'user' ? 'msg-user text-white' : 'msg-ai text-dark-100'}`}>
                      <div className="prose prose-invert prose-sm max-w-none prose-p:my-1.5 prose-pre:bg-black/40">
                        <ReactMarkdown
                          components={{
                            img: ({ node, ...props }) => {
                              const src = String(props.src || '')
                              return (
                                <div className="my-2.5 space-y-2 group">
                                  <a href={src} target="_blank" rel="noopener noreferrer" className="block">
                                    <img
                                      {...props}
                                      alt={props.alt || 'AI generated image'}
                                      className="max-h-80 w-auto rounded-xl border border-white/10 shadow-lg transition-transform group-hover:scale-[1.01]"
                                      loading="lazy"
                                    />
                                  </a>
                                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
                                    <button
                                      type="button"
                                      onClick={() => downloadMedia(src, '1k', 'herova_image')}
                                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-dark-200 bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 shadow transition-all cursor-pointer"
                                    >
                                      <Download className="w-3.5 h-3.5 text-emerald-400" /> ⬇ 1K (HD)
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => downloadMedia(src, '2k', 'herova_image')}
                                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold text-brand-200 bg-brand-500/20 hover:bg-brand-500/30 border border-brand-400/30 shadow transition-all cursor-pointer"
                                    >
                                      <Sparkles className="w-3.5 h-3.5 text-brand-300" /> ⬆ 2K (Ultra HD)
                                    </button>
                                    <a
                                      href={src}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-[11px] text-dark-400 hover:text-brand-300 ml-1"
                                    >
                                      ↗ Full Size
                                    </a>
                                  </div>
                                </div>
                              )
                            },
                          }}
                        >
                          {msg.content}
                        </ReactMarkdown>
                      </div>
                      {msg.model && msg.role === 'assistant' && (
                        <p className="mt-2 border-t border-white/[0.06] pt-1.5 text-[10.5px] uppercase tracking-wider text-dark-500">
                          {msg.model}
                        </p>
                      )}
                    </div>
                    {msg.role === 'user' && (
                      <span className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-white/[0.07] text-dark-200">
                        <User className="h-3.5 w-3.5" aria-hidden />
                      </span>
                    )}
                  </div>
                ))}

                {sending && (
                  <div className="flex animate-fade-up items-center gap-3">
                    <span className="flex h-7 w-7 flex-none items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.04] text-brand-200">
                      <Bot className="h-3.5 w-3.5" aria-hidden />
                    </span>
                    <div className="flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.03] px-4 py-2.5">
                      <span className="typing flex items-center text-brand-300" aria-hidden>
                        <span /><span /><span />
                      </span>
                      <span className="text-[12px] text-dark-400">
                        {selectedIsLocal ? 'Thinking on this PC…' : 'Thinking…'}
                      </span>
                      <button
                        onClick={cancel}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium text-dark-400 transition-colors hover:bg-white/[0.06] hover:text-dark-100"
                      >
                        <Square className="h-2.5 w-2.5" aria-hidden />
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>

              {/* Quick prompts — only before the conversation starts */}
              {messages.length <= 1 && (
                <div className="scroll-thin flex gap-2 overflow-x-auto border-t border-white/[0.06] px-5 py-3">
                  {QUICK_PROMPTS.map(prompt => (
                    <button
                      key={prompt}
                      onClick={() => send(prompt)}
                      className="chip whitespace-nowrap"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              )}

              {/* Composer */}
              <form
                onSubmit={e => { e.preventDefault(); send() }}
                className="border-t border-white/[0.06] bg-black/25 px-4 py-3.5"
              >
                <div className="flex items-center gap-2">
                  <input
                    ref={chatInputRef}
                    type="text"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    placeholder={
                      selectedIsLocal && !localReady
                        ? 'Turn on private AI to chat…'
                        : 'Ask anything…'
                    }
                    className="input-dark min-w-0 flex-1 py-2.5"
                  />
                  <button
                    type="submit"
                    disabled={!input.trim() || sending}
                    className="btn-primary flex-none py-2.5 disabled:cursor-not-allowed"
                  >
                    <Send className="h-4 w-4" aria-hidden />
                    <span className="hidden sm:inline">Send</span>
                  </button>
                </div>

                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-dark-500">
                  <span className="inline-flex items-center gap-1.5">
                    <Check className="h-3 w-3 text-emerald-400" aria-hidden />
                    {selectedIsLocal ? 'Runs on this machine' : 'Free cloud tier'} · no account needed
                  </span>
                </div>
              </form>
            </div>
          </section>
        </div>

        {/* ── Trust bar (mirrors the redesigned public site) ────────────── */}
        <Reveal>
          <dl className="mt-14 grid grid-cols-2 gap-y-6 border-y border-white/[0.06] py-7 sm:grid-cols-4">
            {STATS.map(([value, label]) => (
              <div key={label} className="px-2 text-center">
                <dt className="font-display text-[26px] font-semibold text-brand-300">{value}</dt>
                <dd className="mt-1 text-[11px] uppercase tracking-[0.14em] text-dark-500">{label}</dd>
              </div>
            ))}
          </dl>
        </Reveal>

        {/* ── Features bento ─────────────────────────────────────────────── */}
        <section id="features" className="mt-24 scroll-mt-20">
          <Reveal className="text-center">
            <h2 className="font-display text-[26px] font-semibold tracking-tight text-white sm:text-[32px]">
              Everything you need to run on autopilot
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-[14.5px] leading-relaxed text-dark-400">
              Automate conversations, create media, and distribute content — without paying for
              separate API keys.
            </p>
          </Reveal>

          <div className="mt-9 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(f => (
              <Reveal
                key={f.title}
                className={f.wide ? 'sm:col-span-2 lg:col-span-3' : 'h-full'}
              >
                <article
                  className={`group h-full rounded-2xl border border-white/[0.07] bg-white/[0.025] p-6 transition-colors hover:border-brand-400/30 hover:bg-brand-400/[0.05] ${
                    f.wide ? 'flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6' : ''
                  }`}
                >
                  <div className="text-[26px] leading-none" aria-hidden>
                    {f.icon}
                  </div>
                  <div className={f.wide ? 'min-w-0 flex-1' : ''}>
                    <h3 className="text-[15px] font-semibold text-white">{f.title}</h3>
                    <p className="mt-2 text-[13.5px] leading-relaxed text-dark-400">{f.body}</p>
                  </div>
                </article>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ── Google Flow showcase ───────────────────────────────────────── */}
        <section id="flow" className="mt-24 scroll-mt-20">
          <Reveal>
            <div className="overflow-hidden rounded-3xl border border-white/[0.07] bg-gradient-to-br from-brand-400/[0.08] via-transparent to-transparent">
              <div className="grid gap-8 p-7 sm:p-10 lg:grid-cols-2 lg:items-center">
                <div>
                  <span className="inline-flex items-center rounded-full border border-brand-400/25 bg-brand-400/[0.08] px-3 py-1 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-brand-200">
                    Now working · free tier
                  </span>
                  <h2 className="mt-4 font-display text-[24px] font-semibold tracking-tight text-white sm:text-[30px]">
                    Generate images in seconds with Google Flow
                  </h2>
                  <p className="mt-3 max-w-xl text-[14.5px] leading-relaxed text-dark-300">
                    Type a prompt, pick an aspect ratio, and HerovaAi drives Google Flow to create
                    photorealistic images — no API key, no subscription. Free includes 10 successful
                    images a day; Pro gets 100 per billing cycle and Enterprise is unlimited.
                  </p>
                  <div className="mt-6 flex flex-wrap gap-3">
                    <Link href={isLoggedIn ? '/dashboard/flow' : '/register'} className="btn-primary btn-sheen">
                      Open Flow Studio
                    </Link>
                    <a href="#pricing" className="btn-ghost">
                      See plans
                    </a>
                  </div>
                </div>

                {/* Prompt bar + four result tiles: the Flow Studio in miniature. */}
                <div className="rounded-2xl border border-white/[0.08] bg-black/40 p-4 shadow-lift">
                  <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.03] px-3.5 py-2.5 text-[13px] text-dark-200">
                    <span className="text-brand-300" aria-hidden>
                      ›
                    </span>
                    <span className="truncate">
                      a serene mountain lake at golden hour, cinematic, ultra detailed
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-4 gap-2.5">
                    {FLOW_TILES.map((tile, i) => (
                      <div
                        key={i}
                        className={`aspect-square rounded-lg ring-1 ring-inset ring-white/[0.06] ${tile}`}
                      />
                    ))}
                  </div>
                  <p className="mt-3 flex items-center gap-1.5 text-[11px] text-dark-500">
                    <Sparkles className="h-3 w-3 text-brand-300" aria-hidden />
                    4 variations · saved to your media library
                  </p>
                </div>
              </div>
            </div>
          </Reveal>
        </section>

        {/* ── How it works ───────────────────────────────────────────────── */}
        <section id="how" className="mt-24 scroll-mt-20">
          <Reveal>
            <div className="rounded-3xl border border-white/[0.07] bg-white/[0.02] p-7 sm:p-10">
              <h2 className="font-display text-[24px] font-semibold tracking-tight text-white sm:text-[28px]">
                How it works in 3 simple steps
              </h2>
              <ol className="mt-7 grid gap-4 md:grid-cols-3">
                {STEPS.map((step, i) => (
                  <li
                    key={step.title}
                    className="rounded-2xl border border-white/[0.06] bg-white/[0.025] p-5"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-400/15 text-[13px] font-semibold text-brand-200 ring-1 ring-inset ring-brand-400/30">
                      {i + 1}
                    </span>
                    <p className="mt-3.5 text-[13.5px] leading-relaxed text-dark-300">
                      <strong className="text-white">{step.title}</strong> {step.body}
                    </p>
                  </li>
                ))}
              </ol>
              <p className="mt-6 text-[13px] text-dark-500">
                Your data stays in your private workspace. Review every message and activity anytime
                from the dashboard.
              </p>
            </div>
          </Reveal>
        </section>

        {/* ── Pricing ────────────────────────────────────────────────────── */}
        <section id="pricing" className="mt-24 scroll-mt-20">
          <Reveal className="text-center">
            <h2 className="font-display text-[26px] font-semibold tracking-tight text-white sm:text-[32px]">
              Transparent, flat-rate pricing
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-[14.5px] leading-relaxed text-dark-400">
              Zero hidden fees. Free to start, affordable to scale your whole business.
            </p>
          </Reveal>

          <Reveal>
            <div className="mt-10 grid gap-4 lg:grid-cols-3">
              {PLANS.map(plan => (
                <div
                  key={plan.name}
                  className={`relative flex flex-col rounded-2xl border p-6 ${
                    plan.featured
                      ? 'border-brand-400/40 bg-brand-400/[0.06] shadow-gold'
                      : 'border-white/[0.07] bg-white/[0.025]'
                  }`}
                >
                  {plan.featured && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-brand-400/40 bg-dark-900 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-200">
                      Most popular
                    </span>
                  )}
                  <h3 className="text-[15px] font-semibold text-white">{plan.name}</h3>
                  <p className="mt-1 text-[12.5px] text-dark-500">{plan.desc}</p>
                  <p
                    className={`mt-4 font-display text-[34px] font-semibold leading-none ${
                      plan.featured ? 'text-brand-200' : 'text-white'
                    }`}
                  >
                    {plan.price}{' '}
                    <span className="text-[13px] font-normal text-dark-500">/ month</span>
                  </p>
                  <ul className="mt-5 flex-1 space-y-2.5">
                    {plan.features.map(f => (
                      <li key={f} className="flex items-start gap-2 text-[13px] text-dark-300">
                        <Check className="mt-0.5 h-3.5 w-3.5 flex-none text-brand-300" aria-hidden />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <Link
                    href={isLoggedIn ? '/dashboard/subscription' : '/register'}
                    className={`mt-6 w-full justify-center ${plan.featured ? 'btn-primary btn-sheen' : 'btn-ghost'}`}
                  >
                    {plan.cta}
                  </Link>
                </div>
              ))}
            </div>
          </Reveal>
        </section>

        {/* ── Final CTA band ─────────────────────────────────────────────── */}
        <section className="mt-24">
          <Reveal>
            <div className="relative overflow-hidden rounded-3xl border border-brand-400/25 bg-gradient-to-br from-brand-400/[0.12] via-brand-400/[0.04] to-transparent px-7 py-12 text-center sm:px-12">
              <h2 className="font-display text-[26px] font-semibold tracking-tight text-white sm:text-[32px]">
                Put your shop on autopilot today
              </h2>
              <p className="mx-auto mt-3 max-w-2xl text-[14.5px] leading-relaxed text-dark-300">
                Start free, connect your WhatsApp in five minutes, and let HerovaAi answer your
                customers while you focus on the work.
              </p>
              <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
                <Link href={isLoggedIn ? '/dashboard' : '/register'} className="btn-primary btn-sheen btn-lg shadow-gold">
                  Create your free account
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
                {isLoggedIn ? (
                  <Link href="/dashboard/connections" className="btn-ghost btn-lg">
                    See what you can connect
                  </Link>
                ) : (
                  <a
                    href="https://sahadat01832-del.github.io/herovaai/connect/"
                    className="btn-ghost btn-lg"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    See what you can connect
                  </a>
                )}
              </div>
              <p className="mt-5 text-[12px] text-dark-500">
                Zero credit card required · Free tier forever · Nagad &amp; local payment ready
              </p>
            </div>
          </Reveal>
        </section>
      </main>

      {/* One footer for every public page: the policy pages live here so a
          visitor can find them from any route, not just the landing page. */}
      <SiteFooter />
    </div>
  )
}
