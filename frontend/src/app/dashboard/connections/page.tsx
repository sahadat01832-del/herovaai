'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Activity, ArrowUpRight, Check, CircleSlash, Clock, Facebook, Globe, Info, Instagram,
  MessageCircle, Plug, RefreshCw, Send, Smartphone, Sparkles, Upload, Youtube, Video, X,
} from 'lucide-react'
import { channelApi, flowApi } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/lib/cn'
import { formatDateTime, relativeTime } from '@/lib/format'
import { Badge, Button, CopyButton, EmptyState, InlineError, Skeleton } from '@/components/ui/primitives'
import { EasyStart } from '@/components/dashboard/EasyStart'
import { Field, Input, Switch, Textarea } from '@/components/ui/Field'
import { Modal, ConfirmDialog } from '@/components/ui/Modal'
import { Segmented } from '@/components/ui/Tabs'
import toast from 'react-hot-toast'

/* ══════════════════════════════════════════════════════════════════════════
   Connections — connect a platform once, then let the assistant work.

   Each card opens a panel with four honest sections:
     • Steps      — exactly what to click where, in order.
     • Access     — the tokens/ids the platform requires (never shown again).
     • Automations— what it may do on its own, per day.
     • Activity   — the receipt: what it did, and what failed.
   A platform we cannot automate says why, and still shows the steps, so
   nobody is left wondering whether they missed a button.
   ══════════════════════════════════════════════════════════════════════════ */

const ICONS: Record<string, any> = {
  whatsapp: MessageCircle,
  messenger: Send,
  facebook_page: Facebook,
  instagram: Instagram,
  telegram: Send,
  youtube: Youtube,
  tiktok: Video,
  google_business: Globe,
  imo: Smartphone,
  webhook: Upload,
}

const STATUS_BADGE: Record<string, { tone: 'green' | 'amber' | 'red' | 'slate'; label: string }> = {
  connected: { tone: 'green', label: 'connected' },
  error: { tone: 'red', label: 'needs attention' },
  not_configured: { tone: 'amber', label: 'not connected' },
}

export default function ConnectionsPage() {
  const { user, refreshUser, isAdmin } = useAuth()
  const [channels, setChannels] = useState<any[]>([])
  const [flowStatus, setFlowStatus] = useState<any>(null)
  const [flowModalOpen, setFlowModalOpen] = useState(false)
  const [flowConnecting, setFlowConnecting] = useState(false)
  const [flowConnectionId, setFlowConnectionId] = useState<string>('')
  const [flowConnectStep, setFlowConnectStep] = useState<'idle' | 'waiting_session' | 'verifying'>('idle')
  const [houseFlowAccountId, setHouseFlowAccountId] = useState<'ff2' | 'ff3' | 'ff1' | ''>('')
  const [houseFlowConnectionId, setHouseFlowConnectionId] = useState('')
  const [houseFlowConnecting, setHouseFlowConnecting] = useState(false)
  const [flowTab, setFlowTab] = useState<'extension' | 'cookies'>('extension')
  const [cookiesInput, setCookiesInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<any>(null)
  const [busy, setBusy] = useState('')
  const [youtubeResult, setYoutubeResult] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [chResult, flResult] = await Promise.allSettled([
        channelApi.list(),
        flowApi.getStatus(),
      ])
      const chRes: any = chResult.status === 'fulfilled' ? chResult.value : null
      const flRes: any = flResult.status === 'fulfilled' ? flResult.value : null

      if (chRes?.success) setChannels(chRes.channels || [])
      if (flRes) setFlowStatus(flRes)
    } catch (err: any) {
      setError(err.message || 'Could not read your connections')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // Google sends the YouTube connection back here with a short result code. Say what
  // happened in plain words — "failed" on its own sends people hunting for a button
  // that was never wrong. The message is a banner, not only a toast: a toast can be
  // missed while the page is still mounting, and this is the one result the person
  // actually needs to read.
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get('youtube')
    if (!result) return
    const messages: Record<string, { tone: 'ok' | 'warn'; text: string }> = {
      connected: { tone: 'ok', text: 'YouTube is connected — uploads and comment replies are live.' },
      failed: { tone: 'warn', text: 'Google did not finish the YouTube connection. Try again, or paste a token in the YouTube card below.' },
      expired: { tone: 'warn', text: 'That YouTube connection link expired. Press “Connect YouTube with Google” again.' },
      address: { tone: 'warn', text: 'Google refused because it has not been told about this address yet. An administrator can add it in Google Cloud Console → Credentials (the exact two values are in Settings → Security). Until then, paste a token in the YouTube card, or use the other platforms.' },
      unconfigured: { tone: 'warn', text: 'One-click Google sign-in is not set up on this deployment, so the YouTube button cannot work yet. The token route in the YouTube card still works.' },
    }
    const message = messages[result] || { tone: 'warn' as const, text: 'The YouTube connection did not complete.' }
    setYoutubeResult(message)
    if (message.tone === 'ok') toast.success(message.text)
    else toast.error(message.text)

    // Drop the code so a refresh does not repeat the message.
    const url = new URL(window.location.href)
    url.searchParams.delete('youtube')
    window.history.replaceState({}, '', url.toString())
  }, [])

  // Keep the open panel in step with the fresh list after any change.
  useEffect(() => {
    if (!open) return
    const fresh = channels.find(c => c.id === open.id)
    if (fresh) setOpen(fresh)
  }, [channels, open?.id])

  const connectedCount = channels.filter(c => c.connection?.status === 'connected').length
  const availableCount = channels.filter(c => c.apiAvailable).length
  const openPanel = (channel: any) => {
    setOpen(channel)
    setBusy('')
  }

  const isPersonalFlowActive = user?.flowAccountStatus === 'connected'
  const connectedHouseFlowIds: string[] = flowStatus?.houseAccounts?.ids || []
  const sharedImagePoolReady = connectedHouseFlowIds.length > 0
  const flowUnavailableAccount = flowStatus?.accounts?.accounts?.find(
    (account: any) => account.connectionStatus === 'access_unavailable',
  )

  const finishPersonalFlowConnection = useCallback(async (connectionId: string) => {
    setFlowConnectStep('verifying')
    setFlowConnecting(true)
    try {
      toast.loading('Flow session received — verifying your account…', { id: 'fl-conn' })
      await flowApi.completeConnect({ connectionId })
      toast.success('Google Flow connected. Nano Banana is ready when your account has generation access.', { id: 'fl-conn' })
      setFlowConnectionId('')
      setFlowConnectStep('idle')
      if (refreshUser) await refreshUser()
      await load()
      setFlowModalOpen(false)
    } catch (err: any) {
      setFlowConnectionId('')
      setFlowConnectStep('idle')
      toast.error(err.message || 'Flow could not verify this session. Start Connect again and send the session from the extension.', { id: 'fl-conn' })
    } finally {
      setFlowConnecting(false)
    }
  }, [load, refreshUser])

  // The bridge only receives a session after the user explicitly clicks
  // “Connect Flow” in the installed extension. Once that handoff is visible,
  // complete the existing account verification automatically.
  useEffect(() => {
    if (!flowModalOpen || flowConnectStep !== 'waiting_session' || !flowConnectionId) return

    let active = true
    let checking = false
    const deadline = Date.now() + 5 * 60 * 1000
    let timer: ReturnType<typeof setTimeout>

    const pollBridge = async () => {
      if (!active || checking) return
      checking = true
      try {
        const status: any = await flowApi.getStatus()
        if (!active) return
        if (status?.bridge?.queuedSession) {
          const connectionId = flowConnectionId
          setFlowConnectionId('')
          await finishPersonalFlowConnection(connectionId)
          return
        }
      } catch {
        // The bridge status can briefly be unavailable while Flow starts; retry
        // within the same bounded handshake window instead of failing silently.
      } finally {
        checking = false
      }

      if (!active) return
      if (Date.now() >= deadline) {
        setFlowConnectionId('')
        setFlowConnectStep('idle')
        toast.error('Connection timed out. Start again, then click Connect Flow in the extension within five minutes.', { id: 'fl-conn' })
        return
      }
      timer = setTimeout(pollBridge, 2500)
    }

    timer = setTimeout(pollBridge, 1000)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [flowModalOpen, flowConnectStep, flowConnectionId, finishPersonalFlowConnection])

  const beginHouseFlowConnect = async (accountId: 'ff2' | 'ff3' | 'ff1') => {
    setHouseFlowConnecting(true)
    setHouseFlowAccountId(accountId)
    setHouseFlowConnectionId('')
    try {
      const response: any = await flowApi.beginHouseConnect(accountId)
      const result = response?.result?.result || response?.result || response
      const connectionId = result?.connectionId
      if (!connectionId) {
        if (result?.status === 'ALREADY_CONNECTED') {
          toast.success(`${accountId.toUpperCase()} is already connected.`)
          await load()
          return
        }
        throw new Error(response?.message || 'Flow did not start the account handshake.')
      }
      setHouseFlowConnectionId(connectionId)
      toast.success(`${accountId.toUpperCase()} handshake started. Follow the steps shown below.`)
    } catch (err: any) {
      setHouseFlowAccountId('')
      toast.error(err.message || 'Could not start the shared-account handshake.')
    } finally {
      setHouseFlowConnecting(false)
    }
  }

  const completeHouseFlowConnect = async () => {
    if (!houseFlowAccountId || !houseFlowConnectionId) return
    setHouseFlowConnecting(true)
    try {
      await flowApi.completeHouseConnect({
        accountId: houseFlowAccountId,
        connectionId: houseFlowConnectionId,
      })
      toast.success(`${houseFlowAccountId.toUpperCase()} is connected to the shared image pool.`)
      setHouseFlowAccountId('')
      setHouseFlowConnectionId('')
      await load()
    } catch (err: any) {
      toast.error(err.message || 'Could not verify this Google Flow account.')
    } finally {
      setHouseFlowConnecting(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-1 text-[10.5px] font-bold uppercase tracking-[0.22em] text-brand-400/80">Connections</p>
          <h1 className="text-[22px] font-semibold tracking-tight text-white">
            Connect your platforms, then let them run
          </h1>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-dark-400">
            Answer customers automatically on Messenger, Instagram, Telegram, YouTube and WhatsApp — and post
            every day to Facebook, Instagram, Telegram or any other app through a webhook. Each card tells you
            exactly which steps to click.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {!loading ? (
            <Badge tone={connectedCount ? 'green' : 'slate'}>{connectedCount} of {availableCount} connected</Badge>
          ) : null}
          <Button variant="ghost" size="sm" onClick={load} loading={loading} icon={<RefreshCw className="h-3.5 w-3.5" />}>
            Refresh
          </Button>
        </div>
      </div>

      {error ? <InlineError>{error}</InlineError> : null}

      {!user && !loading ? (
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl border border-brand-500/30 bg-brand-500/10 text-white">
          <div>
            <p className="font-semibold text-sm">Guest Mode / Not Logged In</p>
            <p className="text-xs text-dark-300 mt-0.5">You can preview all platforms below. Log in to link your own personal accounts and post automatically.</p>
          </div>
          <Link href="/login" className="btn-primary btn-sm whitespace-nowrap">
            Log In Now
          </Link>
        </div>
      ) : null}

      {/* ── Google Flow MCP Banner / Status ── */}
      <div className="card relative overflow-hidden p-5 sm:p-6 border border-emerald-500/20 bg-gradient-to-r from-emerald-950/30 via-dark-900/60 to-dark-900/40">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
              <Sparkles className="h-5 w-5" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-white">Google Flow Video (MCP)</h2>
                <Badge tone={isPersonalFlowActive ? 'green' : (flowStatus?.ready ? 'green' : 'amber')}>
                  {isPersonalFlowActive ? 'personal video quota active' : (flowStatus?.ready ? 'ready for video' : 'connection needed')}
                </Badge>
                {isPersonalFlowActive && (
                  <span className="rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-mono text-emerald-300">
                    {user?.flowAccountLabel || user?.flowAccountId}
                  </span>
                )}
              </div>
              <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-dark-300">
                {sharedImagePoolReady
                  ? 'AI images try HerovaAi’s shared Flow accounts first, then your connected personal Flow account if the shared pool cannot serve a request. Personal fallback may use your Google Flow allowance; HerovaAi’s image limits are 10/day on Free, 100 per billing cycle on Pro, and unlimited on Enterprise.'
                  : isPersonalFlowActive
                    ? 'The shared Google Flow image pool is offline. Images will try your connected personal Flow account before HerovaAi’s backup engine; using your personal account may consume its Google Flow allowance. HerovaAi’s image quota still applies.'
                    : 'The shared Google Flow image pool is offline. Images will try HerovaAi’s configured backup engine; if unavailable, chat will explain the issue so you can retry. Connect your personal Flow account to try Nano Banana before the backup; this may use your Google Flow allowance.'}
              </p>
              {flowUnavailableAccount && !isPersonalFlowActive ? (
                <div className="mt-3 max-w-2xl rounded-xl border border-amber-500/30 bg-amber-500/[0.08] p-3 text-[12px] leading-relaxed text-amber-100" role="alert">
                  <p className="font-semibold">Your saved Google session is not connected to the Flow workspace.</p>
                  <p className="mt-1 text-amber-100/80">
                    {flowUnavailableAccount.lastValidationError || 'Google Flow did not verify this account for generation.'}
                    {' '}Sign in with a Google account that can open the Flow creation workspace, then use <strong>Connect Flow for Video</strong> and approve the session in the browser extension. The bridge being online does not mean the account is ready.
                  </p>
                </div>
              ) : null}
              {isAdmin ? (
                <div className="mt-4 rounded-xl border border-white/[0.08] bg-black/20 p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold text-white">Shared image accounts</p>
                      <p className="mt-0.5 text-[11px] text-dark-400">Failover order: FF2 → FF3 → FF1. Connect each with its matching Google account.</p>
                    </div>
                    <Badge tone={connectedHouseFlowIds.length === 3 ? 'green' : 'amber'}>
                      {connectedHouseFlowIds.length}/3 ready
                    </Badge>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    {([
                      ['ff2', 'FF2 · Primary'],
                      ['ff3', 'FF3 · Backup 1'],
                      ['ff1', 'FF1 · Backup 2'],
                    ] as const).map(([accountId, label]) => {
                      const connected = connectedHouseFlowIds.includes(accountId)
                      return (
                        <div key={accountId} className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-white/[0.025] px-3 py-2">
                          <span className="text-xs text-dark-200">{label}</span>
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] ${connected ? 'text-emerald-300' : 'text-amber-300'}`}>
                              {connected ? 'connected' : 'not connected'}
                            </span>
                            {!connected ? (
                              <Button
                                variant="secondary"
                                size="sm"
                                loading={houseFlowConnecting && houseFlowAccountId === accountId}
                                disabled={houseFlowConnecting || Boolean(houseFlowConnectionId)}
                                onClick={() => void beginHouseFlowConnect(accountId)}
                              >
                                Connect
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  {houseFlowConnectionId && houseFlowAccountId ? (
                    <div className="mt-3 rounded-lg border border-cyan-500/20 bg-cyan-500/[0.06] p-3">
                      <p className="text-[11px] leading-relaxed text-cyan-100">
                        Make sure Chromium is signed into the {houseFlowAccountId.toUpperCase()} Google account. Open Flow Login Bridge → <strong>Connect Flow</strong>, wait for “Session sent”, then verify below.
                      </p>
                      <div className="mt-2 flex justify-end">
                        <Button
                          variant="primary"
                          size="sm"
                          loading={houseFlowConnecting}
                          onClick={() => void completeHouseFlowConnect()}
                        >
                          Verify {houseFlowAccountId.toUpperCase()}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-dark-400">
                <span className="rounded-lg bg-white/[0.04] px-2.5 py-1 font-mono text-[11px] text-cyan-300 border border-white/[0.08]">
                  ContentBot ↔ Google Flow MCP
                </span>
                {flowStatus?.bridge?.running && (
                  <span className="rounded-lg bg-emerald-500/10 px-2.5 py-1 text-emerald-400 text-[11px] font-medium border border-emerald-500/20">
                    {flowStatus?.ready
                      ? `Bridge online (port ${flowStatus.bridge.port})`
                      : 'Local bridge running · account not verified'}
                  </span>
                )}
                <span className="rounded-lg bg-cyan-500/10 px-2.5 py-1 text-cyan-300 text-[11px] font-medium border border-cyan-500/20">
                  Video: Omni Flash 1.1
                </span>
                {isPersonalFlowActive && (
                  <span className="rounded-lg bg-brand-500/15 px-2.5 py-1 text-brand-300 text-[11px] font-medium border border-brand-500/25">
                    Account: {user?.flowAccountLabel || user?.flowAccountId}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/dashboard/settings?tab=media"
              className="btn-ghost btn-sm text-xs inline-flex items-center gap-1.5"
            >
              Model Settings <ArrowUpRight className="h-3 w-3" />
            </Link>
            <Button
              variant={isPersonalFlowActive ? 'secondary' : (flowStatus?.ready ? 'secondary' : 'primary')}
              size="sm"
              onClick={() => setFlowModalOpen(true)}
              icon={<Sparkles className="h-3.5 w-3.5" />}
            >
              {isPersonalFlowActive ? 'Manage Flow Video Account' : (flowStatus?.ready ? 'Manage Flow' : 'Connect Flow for Video')}
            </Button>
          </div>
        </div>
      </div>

      {youtubeResult ? (
        <div
          className={cn(
            'flex items-start gap-3 rounded-2xl border px-4 py-3 text-[12.5px] leading-relaxed',
            youtubeResult.tone === 'ok'
              ? 'border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-100'
              : 'border-amber-500/25 bg-amber-500/[0.06] text-amber-100',
          )}
          role="status"
        >
          <Info className="mt-0.5 h-4 w-4 flex-none" aria-hidden />
          <p className="flex-1">{youtubeResult.text}</p>
          <button
            type="button"
            onClick={() => setYoutubeResult(null)}
            className="flex-none text-[11px] font-semibold uppercase tracking-wide opacity-70 hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <EasyStart
        imageAccountsReady={flowStatus ? sharedImagePoolReady : null}
        onOpenChannel={(id) => {
          const channel = channels.find(c => c.id === id)
          if (channel) openPanel(channel)
        }}
      />

      {loading && channels.length === 0 ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {[0, 1, 2].map(i => <Skeleton key={i} className="h-40 w-full" />)}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {channels.map(channel => {
            const Icon = ICONS[channel.id] || Plug
            const status = channel.connection?.status || 'not_configured'
            const badge = STATUS_BADGE[status]
            const unavailable = !channel.apiAvailable
            return (
              <button
                key={channel.id}
                type="button"
                onClick={() => openPanel(channel)}
                className={cn(
                  'card group relative flex h-full flex-col p-5 text-left transition-all duration-300 ease-quint hover:-translate-y-0.5',
                  unavailable && 'opacity-70',
                  status === 'connected' && 'border-emerald-500/25',
                  status === 'error' && 'border-amber-500/25',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-brand-200">
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  {channel.ownPage ? (
                    <Badge tone="slate">managed separately</Badge>
                  ) : unavailable ? (
                    <Badge tone="slate" icon={<CircleSlash className="h-3 w-3" />}>not available</Badge>
                  ) : (
                    <Badge tone={badge.tone}>{badge.label}</Badge>
                  )}
                </div>

                <h2 className="mt-3.5 text-[14.5px] font-semibold text-white">{channel.name}</h2>
                <p className="mt-1 flex-1 text-[12.5px] leading-relaxed text-dark-400">{channel.blurb}</p>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {channel.capabilities?.autoReply ? <Badge tone="green">auto-reply</Badge> : null}
                  {channel.capabilities?.autoPost ? <Badge tone="gold">daily post</Badge> : null}
                  {!channel.capabilities?.autoReply && !channel.capabilities?.autoPost && channel.ownPage ? (
                    <Badge tone="green">auto-reply</Badge>
                  ) : null}
                  {channel.connection?.automations?.autoReply ? <Badge tone="steel">replies on</Badge> : null}
                  {channel.connection?.automations?.autoPost ? (
                    <Badge tone="steel">posts {channel.connection.automations.autoPostTime}</Badge>
                  ) : null}
                </div>

                <span className="mt-4 flex items-center gap-1.5 text-[12px] font-medium text-brand-300">
                  {channel.ownPage ? 'Open WhatsApp' : channel.connection ? 'Manage connection' : 'See the steps'}
                  <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden />
                </span>
              </button>
            )
          })}
        </div>
      )}

      {open ? (
        <ChannelPanel
          channel={open}
          busy={busy}
          setBusy={setBusy}
          onClose={() => setOpen(null)}
          onChanged={load}
          user={user}
        />
      ) : null}

      {/* ── Google Flow MCP Connection Modal ── */}
      <Modal
        open={flowModalOpen}
        onClose={() => setFlowModalOpen(false)}
        size="lg"
        title="Connect Google Flow"
      >
        <div className="space-y-4">
          {/* Shared Flow serves images first; the personal account is the image failover and video account. */}
          {Boolean(flowStatus?.freeForEveryone) ? (
            <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.07] p-3.5 text-xs">
              <div className="flex items-center gap-2 font-semibold text-emerald-300">
                <Sparkles className="w-4 h-4 text-emerald-400" />
                <span>Shared Nano Banana Pro image pool is ready</span>
              </div>
              <p className="mt-1 text-dark-300 leading-relaxed text-[11.5px]">
                Your image allowance is 10/day on Free, 100 per billing cycle on Pro, or unlimited on Enterprise. Images use the shared pool first; if it cannot serve a request, your connected personal Google Flow account may be tried and use its allowance. Your personal connection also serves video.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.07] p-3.5 text-xs">
              <div className="flex items-center gap-2 font-semibold text-amber-200">
                <Sparkles className="w-4 h-4 text-amber-300" />
                <span>Shared image pool is not connected</span>
              </div>
              <p className="mt-1 text-dark-300 leading-relaxed text-[11.5px]">
                Images try your connected personal Google Flow account before HerovaAi’s backup engine; using it may consume your Google Flow allowance. HerovaAi’s quota is 10/day on Free, 100 per billing cycle on Pro, and unlimited on Enterprise. Video also uses this personal account.
              </p>
            </div>
          )}

          {/* Connection Method Tabs */}
          <div className="flex rounded-xl bg-white/[0.04] p-1 border border-white/5">
            <button
              type="button"
              onClick={() => setFlowTab('extension')}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                flowTab === 'extension' ? 'bg-brand-500 text-white shadow-md' : 'text-dark-400 hover:text-white'
              }`}
            >
              📥 Method 1: Browser Extension (.zip)
            </button>
            <button
              type="button"
              onClick={() => setFlowTab('cookies')}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                flowTab === 'cookies' ? 'bg-brand-500 text-white shadow-md' : 'text-dark-400 hover:text-white'
              }`}
            >
              🍪 Method 2: Paste Session Cookies
            </button>
          </div>

          {flowTab === 'extension' ? (
            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-white">Flow Login Bridge Extension</p>
                  <p className="text-[11px] text-dark-400">Works with Google Chrome, Brave, Edge &amp; Opera</p>
                </div>
                <a
                  href="/flow-login-bridge.zip"
                  download="flow-login-bridge.zip"
                  className="px-3 py-1.5 rounded-lg bg-brand-500/20 hover:bg-brand-500/30 border border-brand-500/40 text-brand-200 font-semibold text-xs inline-flex items-center gap-1.5 transition-all"
                >
                  <Upload className="w-3.5 h-3.5 rotate-180" /> Download .zip
                </a>
              </div>

              <ol className="space-y-2 text-dark-300 text-[11.5px]">
                <li className="flex gap-2">
                  <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-brand-500/20 text-brand-300 font-bold text-[10px]">1</span>
                  <span>Download and unzip <strong>flow-login-bridge.zip</strong>.</span>
                </li>
                <li className="flex gap-2">
                  <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-brand-500/20 text-brand-300 font-bold text-[10px]">2</span>
                  <span>In your browser, visit <code className="text-cyan-300 font-mono">chrome://extensions</code> and turn ON <strong>Developer mode</strong> (top right).</span>
                </li>
                <li className="flex gap-2">
                  <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-brand-500/20 text-brand-300 font-bold text-[10px]">3</span>
                  <span>Click <strong>Load unpacked</strong> and select the unzipped extension folder.</span>
                </li>
                <li className="flex gap-2">
                  <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-sky-500/20 text-sky-300 font-bold text-[10px]">4</span>
                  <span>Click <strong>Open Flow &amp; start connection</strong> below. HerovaAi will open Flow in a new tab and arm the secure, temporary connection. If a popup is blocked, <a href="https://labs.google/fx/tools/flow" target="_blank" rel="noreferrer" className="text-brand-300 underline">open Flow here</a>.</span>
                </li>
                <li className="flex gap-2">
                  <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-brand-500/20 text-brand-300 font-bold text-[10px]">5</span>
                  <span>Sign in to Google in the Flow tab if asked, then click the Flow Login Bridge extension and <strong>Connect Flow</strong>. HerovaAi detects “Session sent” and verifies automatically; Google may ask you to choose the account.</span>
                </li>
              </ol>

              {flowConnectStep !== 'idle' ? (
                <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/[0.06] px-3 py-2 text-[11.5px] text-cyan-100" role="status" aria-live="polite">
                  {flowConnectStep === 'waiting_session'
                    ? 'Waiting for the Flow Login Bridge extension to send your signed-in session…'
                    : 'Session received. Verifying Google Flow and waiting for any account chooser…'}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-white/5">
                <Button
                  variant="primary"
                  size="sm"
                  loading={flowConnecting}
                  onClick={async () => {
                    // Open synchronously in the click handler to avoid popup
                    // blockers, then arm the local bridge before asking for the
                    // user’s explicit extension handoff.
                    const flowWindow = window.open('https://labs.google/fx/tools/flow', '_blank')
                    setFlowConnecting(true)
                    try {
                      toast.loading('Opening Flow and preparing a secure connection…', { id: 'fl-conn' })
                      const res: any = await flowApi.beginConnect()
                      const result = res?.result?.result || res?.result || res
                      const cId = result?.connectionId || ''
                      if (result?.status === 'ALREADY_CONNECTED') {
                        toast.success('Google Flow is already connected.', { id: 'fl-conn' })
                        if (refreshUser) await refreshUser()
                        await load()
                        setFlowModalOpen(false)
                        return
                      }
                      if (!cId) throw new Error(result?.message || 'Flow did not return a connection request.')
                      setFlowConnectionId(cId)
                      setFlowConnectStep('waiting_session')
                      if (!flowWindow) {
                        toast('Popup blocked — open Flow using the link above, then use the extension.', { id: 'fl-conn' })
                      } else {
                        toast.success('Flow opened. Sign in if needed, then click Connect Flow in the extension; verification will run automatically.', { id: 'fl-conn' })
                      }
                      await load()
                    } catch (err: any) {
                      flowWindow?.close()
                      toast.error(err.message || 'Handshake failed', { id: 'fl-conn' })
                    } finally {
                      setFlowConnecting(false)
                    }
                  }}
                  disabled={flowConnectStep !== 'idle'}
                >
                  Open Flow &amp; start connection
                </Button>
                {flowConnectStep !== 'idle' ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={flowConnecting}
                    onClick={() => {
                      setFlowConnectionId('')
                      setFlowConnectStep('idle')
                      toast('Flow connection cancelled.', { id: 'fl-conn' })
                    }}
                  >
                    Cancel
                  </Button>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="space-y-3 text-xs">
              <p className="text-[11.5px] text-dark-300 leading-relaxed">
                Export cookies from <a href="https://labs.google/fx" target="_blank" rel="noreferrer" className="text-brand-300 underline font-medium">labs.google/fx</a> using any cookie extension (like Cookie-Editor) or DevTools, and paste the JSON array or cookie string below:
              </p>
              <textarea
                rows={4}
                value={cookiesInput}
                onChange={e => setCookiesInput(e.target.value)}
                placeholder='[{"name":"SID","value":"...","domain":".google.com"},...] or SID=...; HSID=...'
                className="w-full bg-black/60 border border-white/10 rounded-xl p-2.5 text-xs text-white placeholder-dark-600 focus:outline-none focus:border-brand-500 font-mono"
              />
              <div className="flex justify-end gap-2 pt-1 border-t border-white/5">
                <Button
                  variant="primary"
                  size="sm"
                  loading={flowConnecting}
                  disabled={!cookiesInput.trim()}
                  onClick={async () => {
                    setFlowConnecting(true)
                    try {
                      toast.loading('Connecting session via cookies...', { id: 'fl-conn' })
                      await flowApi.connectCookies(cookiesInput.trim())
                      toast.success('Google Flow connected successfully! Personal quota is active.', { id: 'fl-conn' })
                      setCookiesInput('')
                      if (refreshUser) await refreshUser()
                      await load()
                      setFlowModalOpen(false)
                    } catch (err: any) {
                      toast.error(err.message || 'Failed to connect cookies', { id: 'fl-conn' })
                    } finally {
                      setFlowConnecting(false)
                    }
                  }}
                >
                  Verify &amp; Link Cookies
                </Button>
              </div>
            </div>
          )}

          {user?.flowAccountStatus === 'connected' && (
            <div className="p-3.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-emerald-300 flex items-center gap-1.5">
                  <Check className="w-4 h-4 text-emerald-400" /> Your Personal Google Flow Quota is Active
                </p>
                <p className="text-[11px] text-dark-300 mt-0.5">
                  Linked Account: <code className="font-mono text-white">{user?.flowAccountId}</code> ({user?.flowAccountLabel || user?.name})
                </p>
              </div>
              <Button
                variant="danger"
                size="sm"
                loading={flowConnecting}
                onClick={async () => {
                  setFlowConnecting(true)
                  try {
                    toast.loading('Unlinking Flow account...', { id: 'fl-conn' })
                    await flowApi.disconnect()
                    toast.success('Your Flow account has been unlinked. Switched to shared pool.', { id: 'fl-conn' })
                    if (refreshUser) await refreshUser()
                    await load()
                  } catch (err: any) {
                    toast.error(err.message || 'Disconnect failed', { id: 'fl-conn' })
                  } finally {
                    setFlowConnecting(false)
                  }
                }}
              >
                Revert to Shared Pool
              </Button>
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}

/* ────────────────────────────── the panel ──────────────────────────────── */

function ChannelPanel({
  channel, busy, setBusy, onClose, onChanged, user,
}: {
  channel: any
  busy: string
  setBusy: (value: string) => void
  onClose: () => void
  onChanged: () => Promise<void> | void
  user?: any
}) {
  const [tab, setTab] = useState<'steps' | 'access' | 'automations' | 'activity'>(
    channel.connection?.status === 'connected' ? 'automations' : 'access',
  )
  const [values, setValues] = useState<Record<string, string>>({})
  const [automations, setAutomations] = useState<Record<string, any>>({
    autoReply: channel.connection?.automations?.autoReply || false,
    autoPost: channel.connection?.automations?.autoPost || false,
    autoPostTime: channel.connection?.automations?.autoPostTime || '09:00',
    postTopic: channel.connection?.automations?.postTopic || '',
    replyNote: channel.connection?.automations?.replyNote || '',
  })
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const [postPreview, setPostPreview] = useState('')

  const connection = channel.connection
  const Icon = ICONS[channel.id] || Plug
  const status = connection?.status || 'not_configured'

  const save = async () => {
    if (!user) {
      toast.error('Please log in first to connect and save personal channel credentials.')
      return
    }
    setBusy('save')
    try {
      const res: any = await channelApi.connect(channel.id, { credentials: values })
      toast[res.test?.ok ? 'success' : 'error'](res.message || 'Saved')
      setValues({})
      await onChanged()
    } catch (err: any) {
      toast.error(err.message || 'Could not save those details')
    } finally {
      setBusy('')
    }
  }

  const runTest = async () => {
    setBusy('test')
    try {
      const res: any = await channelApi.test(channel.id)
      toast[res.test?.ok ? 'success' : 'error'](res.test?.message || 'Test finished')
      await onChanged()
    } catch (err: any) {
      toast.error(err.message || 'Test failed')
    } finally {
      setBusy('')
    }
  }

  const saveAutomations = async (patch?: Record<string, any>) => {
    const body = patch || automations
    setBusy('automations')
    try {
      const res: any = await channelApi.setAutomations(channel.id, body)
      toast[res.webhook && !res.webhook.ok ? 'error' : 'success'](res.message || 'Saved')
      await onChanged()
    } catch (err: any) {
      toast.error(err.message || 'Could not save that')
      await onChanged()
    } finally {
      setBusy('')
    }
  }

  const postNow = async () => {
    setBusy('post')
    try {
      const res: any = await channelApi.postNow(channel.id, postPreview.trim() || undefined)
      toast[res.result?.ok ? 'success' : 'error'](res.result?.ok ? res.result.message : res.result?.message || 'Post failed')
      setPostPreview('')
      await onChanged()
    } catch (err: any) {
      toast.error(err.message || 'Could not post')
    } finally {
      setBusy('')
    }
  }

  const disconnect = async () => {
    setBusy('disconnect')
    try {
      await channelApi.disconnect(channel.id)
      toast.success('Disconnected — the stored credentials are gone')
      setConfirmDisconnect(false)
      await onChanged()
      onClose()
    } catch (err: any) {
      toast.error(err.message || 'Could not disconnect')
    } finally {
      setBusy('')
    }
  }

  return (
    <>
      <Modal
        open
        onClose={onClose}
        size="xl"
        icon={<Icon className="h-4 w-4" aria-hidden />}
        title={channel.name}
        description={channel.blurb}
      >
        <div className="space-y-4">
          {/* Status strip */}
          <div className="flex flex-wrap items-center gap-2">
            {status === 'connected' ? (
              <Badge tone="green" icon={<Check className="h-3 w-3" />}>connected</Badge>
            ) : status === 'error' ? (
              <Badge tone="red">needs attention</Badge>
            ) : (
              <Badge tone="amber">not connected</Badge>
            )}
            {connection?.meta?.pageName || connection?.meta?.username || connection?.meta?.botUsername || connection?.meta?.channelTitle ? (
              <span className="text-[12px] text-dark-300">
                {connection.meta.pageName || connection.meta.username || connection.meta.botUsername || connection.meta.channelTitle}
              </span>
            ) : null}
            {connection?.lastTest?.message ? (
              <span className={cn('text-[11.5px]', connection.lastTest.ok ? 'text-emerald-300/80' : 'text-amber-300/80')}>
                last test: {connection.lastTest.message}
              </span>
            ) : null}
          </div>

          {!channel.apiAvailable ? (
            <div className="flex items-start gap-2 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3.5 text-[12.5px] leading-relaxed text-dark-300">
              <Info className="mt-0.5 h-4 w-4 flex-none text-amber-300" aria-hidden />
              <span>{channel.availableReason}</span>
            </div>
          ) : null}

          {channel.ownPage ? (
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3.5">
              <p className="text-[12.5px] text-dark-300">{channel.summary}</p>
              <Link href={channel.ownPage} className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-brand-300 hover:text-brand-200">
                Open the WhatsApp page <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </div>
          ) : null}

          {channel.webhook?.path && connection?.status === 'connected' ? (
            <div className="rounded-xl border border-brand-400/20 bg-brand-500/[0.05] p-3.5">
              <p className="text-[12px] font-semibold text-brand-100">
                {channel.webhook.managed ? 'Handled for you' : 'Paste this into the platform'}
              </p>
              {channel.webhook.managed ? (
                <p className="mt-1 text-[11.5px] leading-relaxed text-dark-300">
                  We registered the webhook with Telegram automatically when you switched replies on.
                </p>
              ) : (
                <>
                  <div className="mt-2 flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-lg border border-white/[0.08] bg-dark-950/60 px-2.5 py-1.5 font-mono text-[11.5px] text-dark-200">
                      {channel.webhookUrl}
                    </code>
                    <CopyButton value={channel.webhookUrl} label="Copy callback URL" />
                  </div>
                  {channel.webhook.verify === 'verify-token' ? (
                    <p className="mt-2 text-[11.5px] text-dark-400">
                      Verify token: the one you saved in the “Access” tab. Signature checking uses your app secret,
                      so unsigned calls are rejected.
                    </p>
                  ) : null}
                </>
              )}
            </div>
          ) : null}

          <Segmented
            value={tab}
            onChange={value => setTab(value)}
            options={[
              { id: 'steps', label: 'Steps', icon: <ListOrderedGlyph /> },
              { id: 'access', label: 'Access', icon: <Plug className="h-3.5 w-3.5" /> },
              { id: 'automations', label: 'Automations', icon: <Activity className="h-3.5 w-3.5" /> },
              { id: 'activity', label: 'Activity', icon: <Clock className="h-3.5 w-3.5" /> },
            ]}
          />

          {/* Steps */}
          {tab === 'steps' ? (
            <div className="space-y-3">
              {channel.setup?.length ? (
                <ol className="space-y-3">
                  {channel.setup.map((step: any, index: number) => (
                    <li key={step.title} className="flex gap-3">
                      <span className="mono-num mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full border border-brand-400/30 bg-brand-500/[0.1] text-[11.5px] font-semibold text-brand-200">
                        {index + 1}
                      </span>
                      <div>
                        <p className="text-[13px] font-medium text-dark-100">{step.title}</p>
                        <p className="mt-0.5 text-[12.5px] leading-relaxed text-dark-400">{step.detail}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <EmptyState icon={<Info className="h-5 w-5" />} title="Nothing to set up" description="This channel needs no steps." />
              )}
              {channel.docsUrl && /^https?:/.test(channel.docsUrl) ? (
                <a
                  href={channel.docsUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1.5 text-[12px] text-brand-300 hover:text-brand-200"
                >
                  Open the official documentation <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                </a>
              ) : null}
              {channel.credentials?.length ? (
                <Button size="sm" onClick={() => setTab('access')} icon={<Plug className="h-3.5 w-3.5" />}>
                  I have these — enter the details
                </Button>
              ) : null}
            </div>
          ) : null}

          {/* Access */}
          {tab === 'access' ? (
            <div className="space-y-3">
              {!channel.apiAvailable ? (
                <InlineError>{channel.name} cannot be connected here yet — see the reason above.</InlineError>
              ) : channel.credentials?.length === 0 ? (
                <EmptyState icon={<Info className="h-5 w-5" />} title="No credentials needed" description="Nothing to paste for this channel." />
              ) : (
                <>
                  {channel.id === 'youtube' && (
                    <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-200 space-y-2 mb-2">
                      <div className="font-semibold text-white flex items-center gap-1.5">
                        <Youtube className="w-4 h-4 text-red-400" />
                        <span>Permanent YouTube connection (no Console address needed):</span>
                      </div>
                      <p className="text-[11.5px] text-dark-300 leading-relaxed">
                        This route does <strong>not</strong> need the redirect-URI in Google Cloud Console, so it keeps working even when the
                        public address changes. Use your own client id &amp; secret (the pair already saved in Settings → Security):
                      </p>
                      <ol className="list-decimal ml-4 space-y-1 text-[11.5px] text-dark-300 leading-relaxed">
                        <li>Open the OAuth Playground (button below).</li>
                        <li>Top-right gear ⚙ → tick <strong>Use your own OAuth credentials</strong> → paste the client id &amp; secret → Close.</li>
                        <li>Authorize <code className="text-cyan-300 font-mono">youtube.upload</code> and <code className="text-cyan-300 font-mono">youtube.force-ssl</code>, then <strong>Exchange authorization code for tokens</strong>.</li>
                        <li>Copy <strong>both</strong> the Access token <em>and</em> the Refresh token below, plus the same client id &amp; secret → <strong>Save &amp; Test</strong>. The refresh token makes it renew itself forever.</li>
                      </ol>
                      <a
                        href="https://developers.google.com/oauthplayground"
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-300 underline hover:text-white"
                      >
                        ⚡ Open Google OAuth Playground <ArrowUpRight className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  )}

                  {channel.id === 'tiktok' && (
                    <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-200 space-y-2 mb-2">
                      <div className="font-semibold text-white flex items-center gap-1.5">
                        <Video className="w-4 h-4 text-rose-400" />
                        <span>Connect TikTok in 1 Minute:</span>
                      </div>
                      <div className="space-y-1.5 text-[11.5px] text-dark-300">
                        <p><strong>Method A (Easiest &amp; Instant):</strong> Create a free scenario in Make.com, Zapier, or n8n with a Custom Webhook connected to TikTok Video Upload. Paste your webhook URL in the box below!</p>
                        <p><strong>Method B (TikTok Developers):</strong> Paste your TikTok Creator API Access Token.</p>
                      </div>
                    </div>
                  )}

                  {channel.id === 'facebook_page' && (
                    <div className="p-3.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-xs text-blue-200 space-y-2 mb-2">
                      <div className="font-semibold text-white flex items-center gap-1.5">
                        <Facebook className="w-4 h-4 text-blue-400" />
                        <span>Meta Graph API Helper:</span>
                      </div>
                      <p className="text-[11.5px] text-dark-300 leading-relaxed">
                        Generate a Page Access Token with <code className="text-cyan-300">pages_manage_posts</code> and <code className="text-cyan-300">pages_read_engagement</code>.
                      </p>
                      <a
                        href="https://developers.facebook.com/tools/explorer/"
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-300 underline hover:text-white"
                      >
                        ⚡ Open Meta Graph API Explorer <ArrowUpRight className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  )}

                  {channel.id === 'telegram' && (
                    <div className="p-3.5 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-xs text-cyan-200 space-y-2 mb-2">
                      <div className="font-semibold text-white flex items-center gap-1.5">
                        <Send className="w-4 h-4 text-cyan-400" />
                        <span>Telegram Bot Helper:</span>
                      </div>
                      <p className="text-[11.5px] text-dark-300 leading-relaxed">
                        Send <code className="text-cyan-300">/newbot</code> to @BotFather, pick a name, and paste the token below.
                      </p>
                      <a
                        href="https://t.me/BotFather"
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-cyan-300 underline hover:text-white"
                      >
                        ⚡ Open @BotFather on Telegram <ArrowUpRight className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  )}

                  {channel.credentials.map((field: any) => (
                    <Field
                      key={field.key}
                      label={field.optional ? `${field.label} (optional)` : field.label}
                      hint={field.hint}
                    >
                      <div className="flex items-center gap-2">
                        <Input
                          type={field.secret ? 'password' : 'text'}
                          value={values[field.key] ?? ''}
                          placeholder={connection?.configured?.[field.key] ? '•••••••• (saved — type to replace)' : field.placeholder}
                          onChange={e => setValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                          autoComplete="off"
                        />
                        {connection?.configured?.[field.key] ? <Badge tone="green">saved</Badge> : null}
                      </div>
                    </Field>
                  ))}
                  <p className="text-[11.5px] leading-relaxed text-dark-500">
                    Saved values are never sent back to this page — a saved field shows “saved” instead of the secret.
                    Clearing a box and saving removes that value.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button onClick={save} loading={busy === 'save'} icon={<Check className="h-4 w-4" />}>
                      Save &amp; test
                    </Button>
                    {connection ? (
                      <Button variant="secondary" onClick={runTest} loading={busy === 'test'} icon={<RefreshCw className="h-3.5 w-3.5" />}>
                        Test connection
                      </Button>
                    ) : null}
                    {connection ? (
                      <Button variant="ghost" onClick={() => setConfirmDisconnect(true)} icon={<X className="h-3.5 w-3.5" />}>
                        Disconnect
                      </Button>
                    ) : null}
                  </div>
                </>
              )}
            </div>
          ) : null}

          {/* Automations */}
          {tab === 'automations' ? (
            <div className="space-y-4">
              {!connection ? (
                <InlineError>Connect this channel first — automations switch on only after a successful test.</InlineError>
              ) : null}

              <Switch
                checked={Boolean(automations.autoReply)}
                disabled={!connection || !channel.capabilities?.autoReply}
                onChange={next => { setAutomations(prev => ({ ...prev, autoReply: next })); void saveAutomations({ autoReply: next }) }}
                label="Answer customers automatically"
                hint={
                  channel.capabilities?.autoReply
                    ? 'Replies use your AI Memory (prices, hours, policies) and never invent facts. If no AI model is available, nothing is sent and the message waits for you.'
                    : `${channel.name} cannot answer messages automatically from here.`
                }
              />

              <Switch
                checked={Boolean(automations.autoPost)}
                disabled={!connection || !channel.capabilities?.autoPost}
                onChange={next => { setAutomations(prev => ({ ...prev, autoPost: next })); void saveAutomations({ autoPost: next }) }}
                label="Post once a day"
                hint={
                  channel.capabilities?.autoPost
                    ? channel.capabilities?.note || 'Writes the post from your AI Memory.'
                    : `${channel.name} has no daily post — ${channel.capabilities?.note || 'the platform does not support it'}`
                }
              />

              {channel.capabilities?.autoPost ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
                    <Field label="Post at" hint="Server local time.">
                      <Input
                        type="time"
                        value={automations.autoPostTime}
                        onChange={e => setAutomations(prev => ({ ...prev, autoPostTime: e.target.value }))}
                      />
                    </Field>
                    <Field label="What to post about" hint="A topic, an offer, today's hours — the assistant writes the post.">
                      <Input
                        value={automations.postTopic}
                        onChange={e => setAutomations(prev => ({ ...prev, postTopic: e.target.value }))}
                        placeholder="Weekend offer: 10% off all repairs"
                      />
                    </Field>
                  </div>
                </>
              ) : null}

              {channel.capabilities?.autoReply ? (
                <Field label="Extra instruction for replies" hint="Optional — e.g. “always mention the delivery charge”.">
                  <Input
                    value={automations.replyNote}
                    onChange={e => setAutomations(prev => ({ ...prev, replyNote: e.target.value }))}
                    placeholder="Keep replies in Bangla when the customer writes in Bangla"
                  />
                </Field>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  onClick={() => saveAutomations()}
                  loading={busy === 'automations'}
                  disabled={!connection}
                  icon={<Check className="h-4 w-4" />}
                >
                  Save automations
                </Button>
                {connection?.status === 'connected' && (channel.capabilities?.autoPost || channel.capabilities?.autoReply) ? (
                  <span className="text-[11.5px] text-dark-500">
                    Last post {connection?.stats?.lastPostAt ? relativeTime(connection.stats.lastPostAt) : 'never'} · last reply{' '}
                    {connection?.stats?.lastReplyAt ? relativeTime(connection.stats.lastReplyAt) : 'never'}
                  </span>
                ) : null}
              </div>

              {channel.capabilities?.autoPost && connection?.status === 'connected' ? (
                <div className="space-y-2 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3.5">
                  <p className="text-[12.5px] font-medium text-dark-100">Post something now</p>
                  <Textarea
                    rows={3}
                    value={postPreview}
                    onChange={e => setPostPreview(e.target.value)}
                    placeholder="Leave empty and the assistant drafts it from your topic — or type the exact text."
                  />
                  <Button size="sm" variant="secondary" onClick={postNow} loading={busy === 'post'} icon={<Upload className="h-3.5 w-3.5" />}>
                    Publish now
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Activity */}
          {tab === 'activity' ? (
            <div className="space-y-2">
              {connection?.activity?.length ? (
                <ul className="divide-y divide-white/[0.05] overflow-hidden rounded-xl border border-white/[0.06]">
                  {[...connection.activity].reverse().map((entry: any, index: number) => (
                    <li key={`${entry.at}-${index}`} className="flex items-start gap-2.5 bg-white/[0.015] px-3.5 py-2.5">
                      <span
                        className={cn(
                          'mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full border text-[10px]',
                          entry.ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-300',
                        )}
                      >
                        {entry.ok ? '✓' : '!'}
                      </span>
                      <div className="min-w-0">
                        <p className="text-[12.5px] leading-relaxed text-dark-200">{entry.message}</p>
                        <p className="text-[11px] text-dark-500" title={formatDateTime(entry.at)}>
                          {entry.kind} · {relativeTime(entry.at)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  icon={<Activity className="h-5 w-5" />}
                  title="Nothing yet"
                  description="Connecting, testing, posting and answering all leave a line here — including failures."
                />
              )}
              {connection ? (
                <div className="flex gap-4 text-[11.5px] text-dark-500">
                  <span>{connection.stats?.postsSent || 0} posts sent</span>
                  <span>{connection.stats?.repliesSent || 0} replies sent</span>
                  <span>{connection.stats?.repliesToday || 0} today</span>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmDisconnect}
        onClose={() => setConfirmDisconnect(false)}
        onConfirm={disconnect}
        loading={busy === 'disconnect'}
        tone="danger"
        title={`Disconnect ${channel.name}?`}
        description="The saved tokens are deleted, automatic replies and posts stop, and nothing is posted again until you reconnect."
        confirmLabel="Disconnect"
      />
    </>
  )
}

function ListOrderedGlyph() {
  return (
    <span className="flex flex-col gap-[2px]">
      {[0, 1, 2].map(i => <span key={i} className="block h-[2px] w-3 rounded-full bg-current" />)}
    </span>
  )
}
