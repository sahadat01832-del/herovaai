'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Activity, ArrowUpRight, Check, CircleSlash, Clock, Facebook, Globe, Info, Instagram,
  MessageCircle, Plug, RefreshCw, Send, Smartphone, Upload, Youtube, X,
} from 'lucide-react'
import { channelApi } from '@/lib/api'
import { cn } from '@/lib/cn'
import { formatDateTime, relativeTime } from '@/lib/format'
import { Badge, Button, CopyButton, EmptyState, InlineError, Skeleton } from '@/components/ui/primitives'
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
  const [channels, setChannels] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<any>(null)
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res: any = await channelApi.list()
      if (res?.success) setChannels(res.channels || [])
    } catch (err: any) {
      setError(err.message || 'Could not read your connections')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

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
        />
      ) : null}
    </div>
  )
}

/* ────────────────────────────── the panel ──────────────────────────────── */

function ChannelPanel({
  channel, busy, setBusy, onClose, onChanged,
}: {
  channel: any
  busy: string
  setBusy: (value: string) => void
  onClose: () => void
  onChanged: () => Promise<void> | void
}) {
  const [tab, setTab] = useState<'steps' | 'access' | 'automations' | 'activity'>(
    channel.connection?.status === 'connected' ? 'automations' : 'steps',
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
