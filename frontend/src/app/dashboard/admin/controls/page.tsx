'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Activity, AlarmClock, AlertTriangle, Banknote, Gauge, History, Megaphone, Plug,
  RefreshCw, Save, ShieldOff, Smartphone, UserPlus, Zap,
} from 'lucide-react'
import { adminApi } from '@/lib/api'
import { cn } from '@/lib/cn'
import { relativeTime } from '@/lib/format'
import {
  Badge, Button, Card, CardHeader, EmptyState, InlineError,
  SectionHeading, Skeleton, Tooltip,
} from '@/components/ui/primitives'
import { Field, Input, Switch, Textarea } from '@/components/ui/Field'
import { ConfirmDialog } from '@/components/ui/Modal'
import toast from 'react-hot-toast'

/* ══════════════════════════════════════════════════════════════════════════
   Platform controls.

   The switches the owner reaches for when something is misbehaving: stop every
   automatic reply, stop scheduled posting, close sign-ups, close checkout, leave
   a notice for everyone. Plus the two limits that protect the machine every
   owner shares (how many WhatsApp browsers it may run, how many numbers each
   plan gets), the live browser list with a stop button per row, and the audit
   trail that proves who flipped what.
   ══════════════════════════════════════════════════════════════════════════ */

const CONTROL_ICONS: Record<string, typeof Zap> = {
  aiReplies: Zap,
  autoPosts: AlarmClock,
  whatsappEnabled: Smartphone,
  channelsEnabled: Plug,
  signupsOpen: UserPlus,
  paymentsOpen: Banknote,
}

const ACTION_TONE: Record<string, 'green' | 'red' | 'steel' | 'amber' | 'gold'> = {
  'settings.update': 'gold',
  'session.stop': 'amber',
  'payment.approve': 'green',
  'payment.reject': 'red',
  'user.delete': 'red',
  'user.update': 'steel',
}

interface LiveBrowser {
  sessionName: string
  sessionId: string
  userId: string
  state: string
  startedAt?: string | null
  storedStatus?: string
  phoneNumber?: string
  owner?: { name?: string; email?: string } | null
}

export default function AdminControlsPage() {
  const [controls, setControls] = useState<Record<string, any> | null>(null)
  const [catalogue, setCatalogue] = useState<any>(null)
  const [live, setLive] = useState<any>(null)
  const [audit, setAudit] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [savingKey, setSavingKey] = useState('')
  const [noticeDraft, setNoticeDraft] = useState('')
  const [limitsDraft, setLimitsDraft] = useState<Record<string, Record<string, string>>>({})
  const [pendingStop, setPendingStop] = useState<LiveBrowser | null>(null)

  const load = useCallback(async () => {
    setError('')
    try {
      const [d, a]: any[] = await Promise.all([adminApi.getControls(), adminApi.getAudit(25)])
      setControls(d.controls || {})
      setCatalogue(d.catalogue || null)
      setLive(d.live || null)
      setNoticeDraft(d.controls?.notice || '')
      const limits: Record<string, Record<string, string>> = {}
      for (const [tier, row] of Object.entries(d.controls?.limits || {})) {
        limits[tier] = Object.fromEntries(Object.entries(row as any).map(([k, v]) => [k, String(v)]))
      }
      setLimitsDraft(limits)
      setAudit(a.actions || [])
    } catch (err: any) {
      setError(err.message || 'Could not load the control panel')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  /** Apply one change and adopt what the server says the setting now is. */
  const apply = async (key: string, patch: Record<string, any>) => {
    setSavingKey(key)
    try {
      const d: any = await adminApi.updateControls(patch)
      setControls(d.controls || controls)
      if (d.live) setLive(d.live)
      toast.success(d.message || 'Saved')
      // The audit trail is the point of this screen; refresh it with the change.
      adminApi.getAudit(25).then((a: any) => setAudit(a.actions || [])).catch(() => {})
    } catch (err: any) {
      toast.error(err.message || 'Could not save that')
      void load()
    } finally {
      setSavingKey('')
    }
  }

  const stopSession = async () => {
    if (!pendingStop?.sessionId) return
    try {
      await adminApi.stopWhatsappSession(pendingStop.sessionId, 'Stopped from the admin Controls screen')
      toast.success('Browser stopped')
      setPendingStop(null)
      await load()
    } catch (err: any) {
      toast.error(err.message || 'Could not stop that session')
    }
  }

  const saveLimits = async () => {
    const limits: Record<string, Record<string, number>> = {}
    for (const [tier, row] of Object.entries(limitsDraft)) {
      limits[tier] = {}
      for (const [key, value] of Object.entries(row)) {
        const n = Number(value)
        if (!Number.isInteger(n) || n < 1 || n > 50) {
          toast.error(`${tier} ${key}: use a whole number between 1 and 50`)
          return
        }
        limits[tier][key] = n
      }
    }
    await apply('limits', { limits })
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-64" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
      </div>
    )
  }

  const browsers: LiveBrowser[] = live?.browsers || []
  const ceiling = Number(controls?.maxActiveWhatsapp || 0)
  const running = Number(live?.running || 0)
  const usage = ceiling ? Math.min(100, Math.round((running / ceiling) * 100)) : 0

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Admin"
        title="Platform controls"
        description="Switches, plan limits and the trail behind them. Everything here is live the moment you change it — no restart, no redeploy."
        action={
          <Button variant="ghost" size="sm" onClick={() => void load()}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Refresh
          </Button>
        }
      />

      <InlineError>{error}</InlineError>

      {/* ── Stop buttons ───────────────────────────────────────────────── */}
      <Card>
        <CardHeader
          icon={<ShieldOff className="h-4 w-4" />}
          title="Stop buttons"
          description="Turn something off without touching anyone's saved settings. Messages still arrive; they just wait for a human."
        />
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {(catalogue?.flags || []).map((flag: { key: string; label: string }) => {
            const Icon = CONTROL_ICONS[flag.key] || Zap
            const on = Boolean(controls?.[flag.key])
            return (
              <div
                key={flag.key}
                className={cn(
                  'rounded-2xl border px-4 py-3.5 transition-colors',
                  on ? 'border-white/[0.07] bg-white/[0.02]' : 'border-red-400/25 bg-red-400/[0.05]',
                )}
              >
                <div className="flex items-start gap-3">
                  <span className={cn('mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-xl', on ? 'bg-brand-400/10 text-brand-300' : 'bg-red-400/10 text-red-300')}>
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-dark-100">{flag.label}</p>
                    <p className="mt-0.5 text-[11.5px] text-dark-500">
                      {on ? 'Running' : 'Stopped — nothing happens automatically'}
                    </p>
                  </div>
                  <Switch
                    checked={on}
                    disabled={savingKey === flag.key}
                    onChange={(next) => void apply(flag.key, { [flag.key]: next })}
                    label=""
                  />
                </div>
              </div>
            )
          })}
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── Notice ──────────────────────────────────────────────────── */}
        <Card>
          <CardHeader
            icon={<Megaphone className="h-4 w-4" />}
            title="Notice for everyone"
            description="Shown as a dismissible banner at the top of every dashboard — maintenance windows, new limits, an apology. Empty means no banner."
          />
          <div className="mt-4 space-y-3">
            <Field label="Notice text" hint={`${noticeDraft.length}/240`}>
              <Textarea
                rows={3}
                maxLength={240}
                value={noticeDraft}
                onChange={(e) => setNoticeDraft(e.target.value)}
                placeholder="e.g. Nagad confirmation is delayed today — approved plans may take an hour longer than usual."
              />
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                onClick={() => void apply('notice', { notice: noticeDraft })}
                disabled={savingKey === 'notice' || noticeDraft === (controls?.notice || '')}
              >
                <Save className="h-3.5 w-3.5" aria-hidden /> Publish notice
              </Button>
              {controls?.notice ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => { setNoticeDraft(''); void apply('notice', { notice: '' }) }}
                  disabled={savingKey === 'notice'}
                >
                  Clear
                </Button>
              ) : null}
            </div>
          </div>
        </Card>

        {/* ── Server load ─────────────────────────────────────────────── */}
        <Card>
          <CardHeader
            icon={<Gauge className="h-4 w-4" />}
            title="Server capacity"
            description="Each live WhatsApp session is a whole browser. The ceiling is what keeps every owner's messages being answered."
          />
          <div className="mt-4 space-y-4">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-3xl font-semibold text-white">
                  {running}
                  <span className="text-dark-500"> / {ceiling}</span>
                </p>
                <p className="mt-0.5 text-[11.5px] text-dark-500">live WhatsApp browsers right now</p>
              </div>
              <Badge tone={usage >= 90 ? 'red' : usage >= 60 ? 'amber' : 'green'}>
                {ceiling ? `${usage}% of limit` : 'no limit set'}
              </Badge>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
              <span
                className={cn('block h-full rounded-full transition-[width] duration-500',
                  usage >= 90 ? 'bg-red-400' : usage >= 60 ? 'bg-amber-400' : 'bg-gradient-to-r from-brand-600 to-brand-300')}
                style={{ width: `${ceiling ? usage : 0}%` }}
              />
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ['Sessions', live?.sessions, Smartphone],
                ['Waiting for a slot', live?.queued, Zap],
                ['Channels', live?.channels, Plug],
                ['Payments waiting', live?.awaitingReview, Banknote],
              ].filter(([, value]) => value !== null && value !== undefined).map(([label, value, Icon]: any) => (
                <div key={label} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                  <Icon className="h-3.5 w-3.5 text-dark-500" aria-hidden />
                  <p className="mt-1 text-lg font-semibold text-white">{value}</p>
                  <p className="text-[10.5px] uppercase tracking-wide text-dark-500">{label}</p>
                </div>
              ))}
            </div>

            {live?.queued > 0 ? (
              <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.06] px-3.5 py-2.5">
                <p className="text-[11.5px] leading-relaxed text-amber-100/90">
                  {live.queued} session{live.queued === 1 ? '' : 's'} waiting in line. They start on their
                  own, oldest request first, the moment a slot frees — raising the limit starts them now.
                </p>
              </div>
            ) : null}

            <Field
              label="Maximum live browsers"
              hint="1–50. Lower it to keep the host responsive; sessions beyond it stay queued and say so."
              error={controls?.maxActiveWhatsapp === undefined ? 'Not set' : undefined}
              action={
                <Button size="sm" variant="ghost" onClick={() => void load()}>
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                </Button>
              }
            >
              <ServerCeilingInput
                value={String(controls?.maxActiveWhatsapp ?? '')}
                saving={savingKey === 'maxActiveWhatsapp'}
                onSave={(value) => void apply('maxActiveWhatsapp', { maxActiveWhatsapp: value })}
              />
            </Field>
          </div>
        </Card>
      </div>

      {/* ── Plan limits ───────────────────────────────────────────────── */}
      <Card>
        <CardHeader
          icon={<Activity className="h-4 w-4" />}
          title="What each plan may connect"
          description="Enforced when a session or channel is created — never in the browser. Owners over the limit keep what they have; they just cannot add more."
          action={
            <Button size="sm" onClick={() => void saveLimits()} disabled={savingKey === 'limits'}>
              <Save className="h-3.5 w-3.5" aria-hidden /> Save limits
            </Button>
          }
        />
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[420px] text-left text-[12.5px]">
            <thead>
              <tr className="text-[10.5px] uppercase tracking-wide text-dark-500">
                <th className="pb-2 font-semibold">Plan</th>
                <th className="pb-2 font-semibold">WhatsApp numbers</th>
                <th className="pb-2 font-semibold">Channels</th>
              </tr>
            </thead>
            <tbody>
              {['free', 'pro', 'enterprise'].map((tier) => (
                <tr key={tier} className="border-t border-white/[0.06]">
                  <td className="py-3 capitalize text-dark-200">{tier}</td>
                  {['whatsapp', 'channels'].map((key) => (
                    <td key={key} className="py-2 pr-3">
                      <Input
                        type="number"
                        min={1}
                        max={50}
                        value={limitsDraft?.[tier]?.[key] ?? ''}
                        onChange={(e) => setLimitsDraft((prev) => ({
                          ...prev,
                          [tier]: { ...(prev[tier] || {}), [key]: e.target.value },
                        }))}
                        className="max-w-[110px]"
                        aria-label={`${tier} ${key} limit`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11.5px] text-dark-500">
          Defaults: free 1 number / 3 channels · pro 2 / 8 · enterprise 5 / 20.
        </p>
      </Card>

      {/* ── Live browsers ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader
          icon={<Smartphone className="h-4 w-4" />}
          title="Live WhatsApp browsers"
          description="What this server is actually running, per owner. Stopping one keeps the login — the owner only has to scan again."
          action={
            <Button size="sm" variant="ghost" onClick={() => void load()}>
              <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Refresh
            </Button>
          }
        />
        {browsers.length === 0 ? (
          <EmptyState
            icon={<Smartphone className="h-5 w-5" />}
            title="No WhatsApp browser is running"
            description="Sessions appear here from the moment a QR is requested until the browser is closed."
          />
        ) : (
          <ul className="mt-4 divide-y divide-white/[0.06]">
            {browsers.map((row) => (
              <li key={row.sessionName} className="flex flex-wrap items-center gap-3 py-3">
                <span className={cn('h-2 w-2 flex-none rounded-full', row.state === 'waiting-for-scan' ? 'bg-amber-400' : 'bg-emerald-400')} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-dark-100">
                    {row.owner?.email || 'Unknown owner'}
                    {row.phoneNumber ? <span className="text-dark-500"> · {row.phoneNumber}</span> : null}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-[10.5px] text-dark-500">
                    {row.state === 'waiting-for-scan' ? 'waiting for the owner to scan' : 'browser running'}
                    {row.startedAt ? ` · since ${relativeTime(row.startedAt)}` : ''}
                  </p>
                </div>
                <Tooltip text={row.sessionId ? 'Stop this browser' : 'No stored session row to stop'}>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!row.sessionId}
                    onClick={() => setPendingStop(row)}
                  >
                    Stop
                  </Button>
                </Tooltip>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ── Audit trail ───────────────────────────────────────────────── */}
      <Card>
        <CardHeader
          icon={<History className="h-4 w-4" />}
          title="Recent admin actions"
          description="Who changed which switch, approved which payment, stopped which browser — newest first."
        />
        {audit.length === 0 ? (
          <EmptyState
            icon={<History className="h-5 w-5" />}
            title="Nothing recorded yet"
            description="Every change made on this screen lands here with your email attached."
          />
        ) : (
          <ul className="mt-4 divide-y divide-white/[0.06]">
            {audit.map((row) => (
              <li key={row._id} className="flex flex-wrap items-center gap-3 py-2.5">
                <Badge tone={ACTION_TONE[row.action] || 'steel'}>{row.action}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] text-dark-200">{row.detail || row.target || '—'}</p>
                  <p className="mt-0.5 truncate text-[10.5px] text-dark-500">
                    {row.actorEmail || 'unknown admin'}{row.target ? ` · ${row.target}` : ''}
                  </p>
                </div>
                <span className="flex-none text-[10.5px] text-dark-500">{relativeTime(row.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="flex items-start gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-amber-300" aria-hidden />
        <p className="text-[11.5px] leading-relaxed text-dark-400">
          Stopping AI replies is a hard stop: customer messages are still stored and you still get the
          alerts, but nothing is answered until you switch it back on. Approved payments and plans are
          never affected by any switch here.
        </p>
      </div>

      <ConfirmDialog
        open={Boolean(pendingStop)}
        onClose={() => setPendingStop(null)}
        onConfirm={() => void stopSession()}
        title="Stop this WhatsApp browser?"
        description={pendingStop ? `${pendingStop.owner?.email || 'This owner'}'s browser will be closed now. Their login is kept, so reconnecting only needs a new QR scan.` : ''}
        confirmLabel="Stop browser"
        tone="danger"
      />
    </div>
  )
}

/* ─── Number input that saves on blur or Enter, not on every keystroke ────── */

function ServerCeilingInput({ value, saving, onSave }: {
  value: string
  saving: boolean
  onSave: (value: number) => void
}) {
  const [draft, setDraft] = useState(value)

  useEffect(() => { setDraft(value) }, [value])

  const commit = () => {
    const next = Number(draft)
    if (!Number.isInteger(next) || next < 1 || next > 50) {
      toast.error('Use a whole number between 1 and 50')
      setDraft(value)
      return
    }
    if (String(next) !== String(value)) onSave(next)
  }

  return (
    <Input
      type="number"
      min={1}
      max={50}
      value={draft}
      disabled={saving}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit() }}
      className="max-w-[140px]"
    />
  )
}
