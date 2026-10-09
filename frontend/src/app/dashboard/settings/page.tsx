'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle, ArrowUpRight, BadgeCheck, Brain, Check, Chrome, ExternalLink, KeyRound, Layers,
  Lock, RefreshCw, Save, Server, ShieldCheck, Trash2, User, Zap,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { adminApi, authApi, userApi } from '@/lib/api'
import { cn } from '@/lib/cn'
import { formatDateTime, relativeTime } from '@/lib/format'
import { Button, Card, CardHeader, Badge, CopyButton, InlineError, Skeleton, StatusDot, Tooltip } from '@/components/ui/primitives'
import { ConfirmDialog } from '@/components/ui/Modal'
import { Field, SecretField, StrengthMeter, type SecretStatus } from '@/components/ui/Field'
import { TabPanel, Tabs } from '@/components/ui/Tabs'
import toast from 'react-hot-toast'

/* ══════════════════════════════════════════════════════════════════════════
   Settings — profile, API keys, security.

   The API-key tab is the screen that used to be broken: it posted to a route
   that did not exist, prefilled from a stale prop and showed a success toast
   either way. It now reads the real status, refuses to invent one, and offers
   the three operations a key actually needs — save, verify, revoke.
   ══════════════════════════════════════════════════════════════════════════ */

type TabId = 'profile' | 'keys' | 'security'

interface KeyStatus {
  configured: boolean
  masked: string
  updatedAt: string | null
  endpoint: string | null
  envFallback: boolean
}

const TABS = [
  { id: 'profile' as TabId, label: 'Profile', icon: <User className="h-3.5 w-3.5" /> },
  { id: 'keys' as TabId, label: 'API keys', icon: <KeyRound className="h-3.5 w-3.5" /> },
  { id: 'security' as TabId, label: 'Security', icon: <Lock className="h-3.5 w-3.5" /> },
]

function readTab(): TabId {
  if (typeof window === 'undefined') return 'profile'
  const tab = new URLSearchParams(window.location.search).get('tab')
  return tab === 'keys' || tab === 'security' ? tab : 'profile'
}

export default function SettingsPage() {
  const { user, refreshUser, isAdmin } = useAuth()
  const [tab, setTab] = useState<TabId>('profile')

  useEffect(() => {
    setTab(readTab())
  }, [])

  const changeTab = (next: TabId) => {
    setTab(next)
    // Keep the URL shareable without a navigation (the palette links straight to ?tab=keys).
    const url = new URL(window.location.href)
    if (next === 'profile') url.searchParams.delete('tab')
    else url.searchParams.set('tab', next)
    window.history.replaceState(null, '', url.toString())
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-1 text-[10.5px] font-bold uppercase tracking-[0.22em] text-brand-400/80">Account</p>
          <h1 className="text-[22px] font-semibold tracking-tight text-white">Settings</h1>
          <p className="mt-1 text-[13px] text-dark-400">
            Your profile, the keys that power agent mode, and how you sign in.
          </p>
        </div>
        <Badge tone={user?.hasContentbotApiKey ? 'green' : 'slate'} icon={user?.hasContentbotApiKey ? <Check className="h-3 w-3" /> : undefined}>
          {user?.hasContentbotApiKey ? 'Agent key active' : 'No agent key'}
        </Badge>
      </div>

      <Tabs items={TABS} value={tab} onChange={changeTab} aria-label="Settings sections" className="max-w-md" />

      <TabPanel id="profile" active={tab === 'profile'}>
        <ProfileTab onDone={refreshUser} />
      </TabPanel>
      <TabPanel id="keys" active={tab === 'keys'}>
        <KeysTab isAdmin={isAdmin} onChanged={refreshUser} />
      </TabPanel>
      <TabPanel id="security" active={tab === 'security'}>
        <SecurityTab />
      </TabPanel>
    </div>
  )
}

/* ─── Profile ───────────────────────────────────────────────────────────── */

function ProfileTab({ onDone }: { onDone: () => Promise<void> }) {
  const { user } = useAuth()
  const [form, setForm] = useState({ name: '', phone: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Seed from the loaded user, not from the first render — the old form captured a null user and
  // stayed blank even after the session arrived.
  useEffect(() => {
    if (!user) return
    setForm({ name: user.name || '', phone: user.phone || '' })
  }, [user])

  const save = async () => {
    setError('')
    if (!form.name.trim()) {
      setError('A display name is required')
      return
    }
    setSaving(true)
    try {
      await userApi.updateProfile({ name: form.name.trim(), phone: form.phone.trim() })
      await onDone()
      toast.success('Profile updated')
    } catch (err: any) {
      setError(err.message || 'Could not save the profile')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <Card>
        <CardHeader
          icon={<User className="h-4 w-4" />}
          title="Your profile"
          description="Shown across the dashboard and in WhatsApp reply signatures."
        />
        <div className="mt-5 space-y-4">
          <Field label="Full name" htmlFor="settings-name" required>
            <input
              id="settings-name"
              className="input-dark"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Your name"
            />
          </Field>

          <Field label="Email" htmlFor="settings-email" hint="Sign-in address — an admin can change it from Users & Plans.">
            <input id="settings-email" className="input-dark opacity-60" value={user?.email || ''} disabled />
          </Field>

          <Field label="Phone" htmlFor="settings-phone" hint="Used for WhatsApp contact matching and OTP codes.">
            <input
              id="settings-phone"
              className="input-dark"
              value={form.phone}
              onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
              placeholder="+8801…"
            />
          </Field>

          {error ? <InlineError>{error}</InlineError> : null}

          <div className="flex items-center gap-2 pt-1">
            <Button onClick={save} loading={saving} icon={<Save className="h-4 w-4" />}>
              {saving ? 'Saving…' : 'Save profile'}
            </Button>
            <span className="text-[11.5px] text-dark-500">
              Last updated {relativeTime(user?.lastSeen)}
            </span>
          </div>
        </div>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader
            icon={<Brain className="h-4 w-4" />}
            title="AI memory"
            description="Business details, persona and knowledge base used in every reply."
          />
          <p className="mt-3 text-[12.5px] leading-relaxed text-dark-400">
            Your assistant sounds like your business because of what is stored there — name, industry,
            tone and any custom knowledge you add.
          </p>
          <Link href="/dashboard/memory" className="btn-ghost btn-sm mt-4 inline-flex">
            Open AI memory
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </Card>

        <Card>
          <CardHeader
            icon={<Layers className="h-4 w-4" />}
            title="Plan"
            description={`${(user?.subscription?.tier || 'free').toUpperCase()} · ${user?.subscription?.status || 'active'}`}
          />
          <div className="mt-3 space-y-1.5 text-[12.5px] text-dark-400">
            <p className="flex justify-between">
              <span>Weekly token limit</span>
              <span className="mono-num text-dark-200">{(user?.tokenQuota?.weeklyLimit || 1_000_000).toLocaleString()}</span>
            </p>
            <p className="flex justify-between">
              <span>Used this week</span>
              <span className="mono-num text-dark-200">{(user?.tokenQuota?.tokensUsed7d || 0).toLocaleString()}</span>
            </p>
          </div>
          <Link href="/dashboard/subscription" className="btn-ghost btn-sm mt-4 inline-flex">
            Manage plan
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </Card>
      </div>
    </div>
  )
}

/* ─── API keys ──────────────────────────────────────────────────────────── */

function KeysTab({ isAdmin, onChanged }: { isAdmin: boolean; onChanged: () => Promise<void> }) {
  const [status, setStatus] = useState<KeyStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [secretStatus, setSecretStatus] = useState<SecretStatus>('idle')
  const [statusMessage, setStatusMessage] = useState('')
  const [error, setError] = useState('')
  const [confirmRevoke, setConfirmRevoke] = useState(false)
  const [revoking, setRevoking] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data: any = await userApi.getApiKey()
      setStatus(data.key)
    } catch (err: any) {
      setError(err.message || 'Could not read the key status')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const save = async () => {
    setError('')
    if (!draft.trim()) {
      setError('Paste the key first')
      return
    }
    setSaving(true)
    try {
      const data: any = await userApi.setApiKey(draft.trim())
      setStatus(data.key)
      setDraft('')
      setSecretStatus('idle')
      setStatusMessage('')
      await onChanged()
      toast.success(data.message || 'Key saved')
    } catch (err: any) {
      setError(err.message || 'Could not save the key')
    } finally {
      setSaving(false)
    }
  }

  const verify = async (draftOnly: boolean) => {
    setError('')
    if (draftOnly && !draft.trim()) {
      setError('Paste a key to test it')
      return
    }
    setVerifying(true)
    setSecretStatus('checking')
    try {
      const data: any = await userApi.verifyApiKey(draftOnly ? draft.trim() : undefined)
      const result = data.result
      setSecretStatus(result.ok ? 'ok' : 'fail')
      setStatusMessage(result.message)
      if (result.ok) toast.success(result.message)
      else toast.error(result.message, { duration: 6000 })
    } catch (err: any) {
      setSecretStatus('fail')
      setStatusMessage(err.message || 'Verification failed')
      toast.error(err.message || 'Verification failed')
    } finally {
      setVerifying(false)
    }
  }

  const revoke = async () => {
    setRevoking(true)
    try {
      const data: any = await userApi.revokeApiKey()
      setStatus(data.key)
      await onChanged()
      setConfirmRevoke(false)
      toast.success(data.message || 'Key revoked')
    } catch (err: any) {
      toast.error(err.message || 'Could not revoke the key')
    } finally {
      setRevoking(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        {/* Agent platform key */}
        <Card gold>
          <CardHeader
            icon={<KeyRound className="h-4 w-4" />}
            title="Agent platform key"
            description="Authenticates agent mode — the multi-step workspaces that call your platform."
            action={
              loading ? <Skeleton className="h-6 w-20 rounded-full" /> : status?.configured ? (
                <Badge tone="green" icon={<BadgeCheck className="h-3 w-3" />}>configured</Badge>
              ) : (
                <Badge tone="slate">not set</Badge>
              )
            }
          />

          {loading ? (
            <div className="mt-5 space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : (
            <>
              <div className="mt-5">
                <SecretField
                  value={draft}
                  onChange={v => { setDraft(v); setSecretStatus('idle'); setStatusMessage('') }}
                  label={status?.configured ? 'Replace the stored key' : 'Add your key'}
                  placeholder={status?.configured ? 'Paste a new key to rotate' : 'cb-agents-key-…'}
                  savedMasked={status?.configured ? status.masked : undefined}
                  savedAt={status?.updatedAt}
                  status={secretStatus}
                  statusMessage={statusMessage}
                  hint={
                    status?.configured
                      ? 'Stored keys are never shown again — paste a new one to rotate, or revoke to stop using it.'
                      : 'Saved server-side and sent only as a Bearer header to your platform endpoint.'
                  }
                />
              </div>

              {error ? <div className="mt-3"><InlineError>{error}</InlineError></div> : null}

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button onClick={save} loading={saving} icon={<Save className="h-4 w-4" />} disabled={!draft.trim()}>
                  {status?.configured ? 'Rotate key' : 'Save key'}
                </Button>
                <Tooltip text="Send a real request with this key and report what the platform says">
                  <Button
                    variant="ghost"
                    onClick={() => verify(true)}
                    loading={verifying}
                    disabled={!draft.trim()}
                    icon={<Zap className="h-4 w-4" />}
                  >
                    Test pasted key
                  </Button>
                </Tooltip>
                {status?.configured ? (
                  <>
                    <Button variant="ghost" onClick={() => verify(false)} loading={verifying} icon={<RefreshCw className="h-4 w-4" />}>
                      Test stored key
                    </Button>
                    <Button variant="danger" onClick={() => setConfirmRevoke(true)} icon={<Trash2 className="h-4 w-4" />}>
                      Revoke
                    </Button>
                  </>
                ) : null}
              </div>

              {status?.configured ? (
                <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-white/[0.06] pt-4 text-[12px]">
                  <div>
                    <dt className="text-dark-500">Stored as</dt>
                    <dd className="mono-num mt-0.5 font-mono text-brand-200">{status.masked}</dd>
                  </div>
                  <div>
                    <dt className="text-dark-500">Last rotated</dt>
                    <dd className="mt-0.5 text-dark-200">{formatDateTime(status.updatedAt)}</dd>
                  </div>
                </dl>
              ) : null}
            </>
          )}
        </Card>

        {/* Where it is used */}
        <div className="space-y-4">
          <Card>
            <CardHeader
              icon={<Server className="h-4 w-4" />}
              title="Where it is used"
              description="Agent mode in Chat sends your key to this endpoint."
            />
            <div className="mt-3 space-y-2 text-[12.5px]">
              <p className="flex items-start justify-between gap-3">
                <span className="text-dark-400">Endpoint</span>
                <span className="truncate font-mono text-[11.5px] text-dark-200">
                  {status?.endpoint || 'not configured'}
                </span>
              </p>
              <p className="flex items-start justify-between gap-3">
                <span className="text-dark-400">Platform fallback</span>
                <span className="text-dark-200">{status?.envFallback ? 'available' : 'none'}</span>
              </p>
              <p className="flex items-start justify-between gap-3">
                <span className="text-dark-400">Read back</span>
                <span className="text-dark-200">never — write-only</span>
              </p>
            </div>
            {status?.endpoint ? (
              <p className="mt-3 flex items-start gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-[11.5px] leading-relaxed text-dark-400">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none text-brand-300/80" aria-hidden />
                Agent mode fails with a connection error when nothing is listening there. Local chat and
                cloud models are unaffected.
              </p>
            ) : null}
          </Card>

          <Card>
            <CardHeader
              icon={<ShieldCheck className="h-4 w-4" />}
              title="How keys are handled"
              description="Three rules the server enforces for you."
            />
            <ul className="mt-3 space-y-2 text-[12.5px] text-dark-400">
              {[
                'Keys are stored server-side and stripped from every API response.',
                'Whitespace from a copy/paste is cleaned before saving.',
                'Any verification runs against the real provider, so a green light means something.',
              ].map(line => (
                <li key={line} className="flex items-start gap-2">
                  <Check className="mt-0.5 h-3.5 w-3.5 flex-none text-emerald-400" aria-hidden />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      {isAdmin ? <ProviderVaultSummary /> : null}

      <ConfirmDialog
        open={confirmRevoke}
        onClose={() => setConfirmRevoke(false)}
        onConfirm={revoke}
        loading={revoking}
        title="Revoke the agent platform key?"
        description="Agent mode stops using this key immediately. The platform-wide fallback key (if configured) takes over."
        confirmLabel="Revoke key"
      />
    </div>
  )
}

/* ─── Provider vault summary (admin) ───────────────────────────────────── */

function ProviderVaultSummary() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    adminApi.getApiKeys()
      .then((d: any) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [])

  const summary = data?.summary
  const providers = (data?.inventory || []).filter((p: any) => p.configured > 0 || p.keys?.length)

  return (
    <Card>
      <CardHeader
        icon={<Layers className="h-4 w-4" />}
        title="Provider keys"
        description="Keys that power the cloud models — administered centrally."
        action={
          <Link href="/dashboard/admin/api-keys" className="btn-ghost btn-sm">
            Open vault
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        }
      />

      {loading ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : !data ? (
        <p className="mt-4 text-[12.5px] text-dark-400">Could not read the provider vault.</p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: 'Providers', value: `${summary.providersConfigured}/${summary.providersTotal}` },
              { label: 'Saved keys', value: summary.savedKeys },
              { label: 'Enabled', value: summary.enabledKeys },
              { label: 'Failing', value: summary.failingKeys, danger: summary.failingKeys > 0 },
            ].map(item => (
              <div key={item.label} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-wider text-dark-500">{item.label}</p>
                <p className={cn('mono-num mt-0.5 text-[15px] font-semibold', item.danger ? 'text-red-300' : 'text-white')}>
                  {item.value}
                </p>
              </div>
            ))}
          </div>

          <ul className="mt-4 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {providers.map((provider: any) => (
              <li key={provider.id} className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2">
                <span className="flex min-w-0 items-center gap-2">
                  <StatusDot tone={provider.keys?.length ? 'live' : 'idle'} />
                  <span className="truncate text-[12.5px] text-dark-200">{provider.label}</span>
                </span>
                <span className="mono-num flex-none text-[11px] text-dark-500">{provider.configured} key{provider.configured === 1 ? '' : 's'}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  )
}

/* ─── Security ──────────────────────────────────────────────────────────── */

function SecurityTab() {
  const { user } = useAuth()
  const [form, setForm] = useState({ current: '', next: '', confirm: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setError('')
    if (!form.current || !form.next) {
      setError('Fill in both password fields')
      return
    }
    if (form.next !== form.confirm) {
      setError('The new passwords do not match')
      return
    }
    if (form.next.length < 8) {
      setError('The new password must be at least 8 characters')
      return
    }
    setBusy(true)
    try {
      await userApi.changePassword(form.current, form.next)
      setForm({ current: '', next: '', confirm: '' })
      toast.success('Password changed')
    } catch (err: any) {
      setError(err.message || 'Could not change the password')
    } finally {
      setBusy(false)
    }
  }

  const googleAccount = Boolean((user as any)?.googleId)

  return (
    <div className="space-y-4">
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <Card>
        <CardHeader
          icon={<Lock className="h-4 w-4" />}
          title="Change password"
          description={googleAccount ? 'This account signs in with Google.' : 'At least 8 characters; a passphrase beats a short scramble.'}
        />

        {googleAccount ? (
          <p className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-[12.5px] text-dark-400">
            There is no password on this account — sign-in happens through Google OAuth, so there is
            nothing here to change.
          </p>
        ) : (
          <div className="mt-5 space-y-4">
            <Field label="Current password" htmlFor="pw-current" required>
              <input
                id="pw-current"
                type="password"
                autoComplete="current-password"
                className="input-dark"
                value={form.current}
                onChange={e => setForm(f => ({ ...f, current: e.target.value }))}
              />
            </Field>
            <Field label="New password" htmlFor="pw-next" required>
              <input
                id="pw-next"
                type="password"
                autoComplete="new-password"
                className="input-dark"
                value={form.next}
                onChange={e => setForm(f => ({ ...f, next: e.target.value }))}
              />
            </Field>
            <StrengthMeter password={form.next} />
            <Field label="Confirm new password" htmlFor="pw-confirm" required>
              <input
                id="pw-confirm"
                type="password"
                autoComplete="new-password"
                className="input-dark"
                value={form.confirm}
                onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))}
              />
            </Field>

            {error ? <InlineError>{error}</InlineError> : null}

            <Button onClick={submit} loading={busy} icon={<Lock className="h-4 w-4" />}>
              {busy ? 'Updating…' : 'Update password'}
            </Button>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          icon={<ShieldCheck className="h-4 w-4" />}
          title="Session"
          description="What this browser is signed in as."
        />
        <dl className="mt-4 space-y-2.5 text-[12.5px]">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-dark-400">Account</dt>
            <dd className="truncate text-dark-100">{user?.email}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-dark-400">Role</dt>
            <dd className="capitalize text-dark-100">{user?.role}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-dark-400">Last seen</dt>
            <dd className="text-dark-100">{relativeTime(user?.lastSeen)}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-dark-400">Token lifetime</dt>
            <dd className="text-dark-100">7 days</dd>
          </div>
        </dl>
        <p className="mt-4 border-t border-white/[0.06] pt-3 text-[11.5px] leading-relaxed text-dark-500">
          Signing out clears the stored token in this browser only. Changing your password does not
          invalidate tokens on other devices — ask an admin to deactivate the account if you need that.
        </p>
      </Card>
    </div>

    <GoogleSignInCard isAdmin={user?.role === 'admin'} />
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════════
   Google sign-in.

   Owners do not want to hear "create an OAuth client" — they want one screen
   that says exactly which two links to paste into Google, a box for the two
   values, and a Test button that proves it works. An admin can do the whole
   thing from here; everyone else sees the current state read-only.
   ══════════════════════════════════════════════════════════════════════════ */
const GOOGLE_SLOTS = [
  { envName: 'GOOGLE_CLIENT_ID', label: 'Client ID', placeholder: '…apps.googleusercontent.com' },
  { envName: 'GOOGLE_CLIENT_SECRET', label: 'Client secret', placeholder: 'GOCSPX-…' },
] as const

function GoogleSignInCard({ isAdmin }: { isAdmin: boolean }) {
  const [status, setStatus] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [verdict, setVerdict] = useState<{ ok: boolean; message: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setStatus(await (isAdmin ? adminApi.getGoogleSignin() : authApi.googleStatus()))
    } catch {
      setStatus(null)
    } finally {
      setLoading(false)
    }
  }, [isAdmin])

  useEffect(() => { load() }, [load])

  const save = async (envName: string) => {
    const value = (drafts[envName] || '').trim()
    if (!value) {
      toast.error('Paste the value first')
      return
    }
    setBusy(envName)
    try {
      await adminApi.createApiKey({ envName, value, label: 'Google sign-in' })
      setDrafts(current => ({ ...current, [envName]: '' }))
      toast.success(`${envName === 'GOOGLE_CLIENT_ID' ? 'Client ID' : 'Client secret'} saved`)
      await load()
    } catch (err: any) {
      toast.error(err?.message || 'Could not save that')
    } finally {
      setBusy(null)
    }
  }

  const test = async () => {
    setTesting(true)
    setVerdict(null)
    try {
      const data: any = await adminApi.testApiKey({ envName: 'GOOGLE_CLIENT_ID' })
      const result = data?.result || {}
      setVerdict({ ok: Boolean(result.ok), message: result.message || 'No answer from Google' })
    } catch (err: any) {
      setVerdict({ ok: false, message: err?.message || 'The test could not run' })
    } finally {
      setTesting(false)
    }
  }

  if (loading) return <Skeleton className="h-56 w-full" />
  if (!status) return null

  const ready = Boolean(status.configured)

  return (
    <Card className={cn(ready && 'card-gold')}>
      <CardHeader
        icon={<Chrome className="h-4 w-4" />}
        title="Continue with Google"
        description="Let customers and staff sign in with the Google account they already have — no password to remember or reset."
        action={
          <Badge tone={ready ? 'green' : 'amber'} icon={ready ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}>
            {ready ? 'Ready' : 'Needs setup'}
          </Badge>
        }
      />

      {ready ? (
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-dark-400">
          <span>Client ID <span className="mono-num text-dark-100">{status.clientIdMasked}</span></span>
          <span className="inline-flex items-center gap-1.5">
            <StatusDot tone="live" />
            <span>Button live on the sign-in page</span>
          </span>
          <span>Credentials from <span className="text-dark-200">{status.source === 'vault' ? 'this dashboard' : 'the server config'}</span></span>
        </div>
      ) : (
        <p className="mt-4 rounded-xl border border-amber-400/25 bg-amber-400/[0.06] p-3 text-[12.5px] leading-relaxed text-amber-100">
          The sign-in page shows a plain "Google is not switched on yet" notice instead of a button that
          dead-ends. Follow the five steps below once and it works everywhere from then on.
        </p>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.25fr_1fr]">
        {/* Steps */}
        <ol className="space-y-3">
          {(status.steps || []).map((step: any, index: number) => (
            <li key={step.title} className="flex gap-3">
              <span className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-lg border border-brand-400/25 bg-brand-400/[0.07] text-[11px] font-semibold text-brand-200">
                {index + 1}
              </span>
              <div className="min-w-0">
                <p className="text-[12.5px] font-medium text-dark-100">{step.title}</p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-dark-500">{step.detail}</p>
                {step.value ? (
                  <div className="mt-1.5 flex items-center gap-2">
                    <code className="break-anywhere rounded-lg border border-white/[0.08] bg-black/30 px-2 py-1 text-[11px] text-dark-200">
                      {step.value}
                    </code>
                    <CopyButton value={step.value} label="Copy" />
                  </div>
                ) : null}
                {step.link ? (
                  <a
                    href={step.link}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="mt-1 inline-flex items-center gap-1 text-[11.5px] text-brand-300 hover:text-brand-200"
                  >
                    Open Google Cloud Console <ExternalLink className="h-3 w-3" />
                  </a>
                ) : null}
              </div>
            </li>
          ))}
        </ol>

        {/* Credentials */}
        <div className="space-y-4">
          {isAdmin ? (
            <>
              {GOOGLE_SLOTS.map(slot => (
                <SecretField
                  key={slot.envName}
                  label={slot.label}
                  placeholder={slot.placeholder}
                  value={drafts[slot.envName] || ''}
                  onChange={value => setDrafts(current => ({ ...current, [slot.envName]: value }))}
                  hint={slot.envName === 'GOOGLE_CLIENT_SECRET'
                    ? 'Stored write-only. Paste a new one here to rotate it at any time.'
                    : 'Ends in …apps.googleusercontent.com — this one is not secret.'}
                />
              ))}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  icon={<Save className="h-3.5 w-3.5" />}
                  loading={busy !== null}
                  onClick={() => save(GOOGLE_SLOTS[0].envName)}
                  disabled={!drafts.GOOGLE_CLIENT_ID}
                >
                  Save client ID
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Save className="h-3.5 w-3.5" />}
                  loading={busy !== null}
                  onClick={() => save(GOOGLE_SLOTS[1].envName)}
                  disabled={!drafts.GOOGLE_CLIENT_SECRET}
                >
                  Save secret
                </Button>
                <Button size="sm" variant="ghost" icon={<Zap className="h-3.5 w-3.5" />} loading={testing} onClick={test}>
                  Test
                </Button>
              </div>

              {verdict ? (
                <p className={cn(
                  'flex items-start gap-2 rounded-xl border p-3 text-[12px] leading-relaxed',
                  verdict.ok
                    ? 'border-emerald-400/25 bg-emerald-400/[0.06] text-emerald-100'
                    : 'border-red-400/25 bg-red-400/[0.06] text-red-100'
                )}>
                  {verdict.ok ? <Check className="mt-0.5 h-3.5 w-3.5 flex-none" /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" />}
                  {verdict.message}
                </p>
              ) : null}
            </>
          ) : (
            <p className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-[12px] leading-relaxed text-dark-400">
              Only an administrator can change these. Ask one to paste the client ID and secret here
              if Google sign-in should be available.
            </p>
          )}

          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-dark-500">If signs-in fail</p>
            <ul className="mt-2 space-y-1.5 text-[11.5px] leading-relaxed text-dark-400">
              <li>· <span className="text-dark-200">redirect_uri_mismatch</span> — the redirect URI in Google has a typo or a trailing slash. Copy it again with the button above.</li>
              <li>· <span className="text-dark-200">Access blocked</span> — add the Google account you are testing with under OAuth consent screen → Test users, or publish the app.</li>
              <li>· Credentials are picked up on the next click, so nothing here needs a server restart.</li>
            </ul>
          </div>
        </div>
      </div>
    </Card>
  )
}
