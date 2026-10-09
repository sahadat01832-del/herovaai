'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import {
  Bot, Send, User, Sparkles, ShieldCheck, Smartphone, Brain,
  ArrowRight, Cpu, Loader2, Square, Wifi, WifiOff, Check, Lock,
} from 'lucide-react'
import { chatApi } from '@/lib/api'
import { getToken, getUser, ApiError } from '@/lib/auth'
import toast from 'react-hot-toast'
import ReactMarkdown from 'react-markdown'
import { Reveal } from '@/components/ui/Reveal'
import { SiteFooter } from '@/components/marketing/SiteFooter'

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
  'What can you do for my shop?',
  'Write a WhatsApp reply for a price question',
  'How do I stop answering the same questions all day?',
  'Give me 3 ideas to bring customers back',
]

export default function HomePage() {
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [userName, setUserName] = useState('')
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

  // ── Session ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const token = getToken()
    const user = getUser()
    if (token && user) {
      setIsLoggedIn(true)
      setUserName(user.name)
    }
  }, [])

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
        fetch(`${window.location.protocol}//${window.location.hostname}:5000/api/chat/lm-studio/unload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stopServer: true, graceSeconds: 90 }),
          keepalive: true,
        }).catch(() => {})
      } catch { /* nothing else we can do while unloading */ }
    }
    const onHidden = () => { if (document.visibilityState === 'hidden') release() }

    window.addEventListener('pagehide', release)
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      window.removeEventListener('pagehide', release)
      document.removeEventListener('visibilitychange', onHidden)
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
              <span className="inline-flex items-center gap-2 rounded-full border border-brand-400/20 bg-brand-400/[0.08] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-200">
                <Sparkles className="h-3 w-3" aria-hidden />
                For shop owners &amp; managers
              </span>

              <h1 className="mt-5 text-[30px] font-semibold leading-[1.08] tracking-tight text-white sm:text-[40px] lg:text-[44px]">
                Answer every customer
                <span className="gradient-text block">even while you are serving one</span>
              </h1>

              <p className="mt-5 max-w-xl text-[14.5px] leading-relaxed text-dark-400 sm:text-[15px]">
                “How much is it?” “When do you open?” “Do you deliver to my area?” — the assistant
                answers all of it on WhatsApp, in your words, using the prices and rules you gave it.
                Try it below without signing up.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <button
                  onClick={() => {
                    // On a phone the panel sits below the fold: bring it up first, then focus.
                    panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                    chatInputRef.current?.focus({ preventScroll: true })
                  }}
                  className="btn-primary btn-sheen btn-lg"
                >
                  Ask it something
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </button>
                <Link href={isLoggedIn ? '/dashboard' : '/login'} className="btn-ghost btn-lg">
                  <ShieldCheck className="h-4 w-4" aria-hidden />
                  {isLoggedIn ? 'Open dashboard' : 'Owner sign in'}
                </Link>
              </div>
            </Reveal>

            <dl className="stagger mt-9 space-y-4 border-t border-white/[0.06] pt-7">
              {[
                { icon: Smartphone, title: 'It answers on WhatsApp', body: 'Pair your number once. Customers get replies at 11pm, on holidays, while you are with someone.' },
                { icon: Brain, title: 'It learns your business', body: 'Your name, products, prices, opening hours and the rules it must never break — optional, two minutes.' },
                { icon: Cpu, title: 'It can stay on your machine', body: 'Prefer nothing leaving your shop? Run the private model and your conversations stay here.' },
              ].map(({ icon: Icon, title, body }) => (
                <div key={title} className="flex gap-4">
                  <span className="mt-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-xl border border-brand-400/15 bg-brand-400/[0.06] text-brand-200">
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <div>
                    <dt className="text-[13.5px] font-semibold text-white">{title}</dt>
                    <dd className="mt-1 text-[13px] leading-relaxed text-dark-400">{body}</dd>
                  </div>
                </div>
              ))}
            </dl>
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
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
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
      </main>

      {/* One footer for every public page: the policy pages live here so a
          visitor can find them from any route, not just the landing page. */}
      <SiteFooter />
    </div>
  )
}
