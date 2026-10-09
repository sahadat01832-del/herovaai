'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BadgeCheck, Copy, Edit2, KeyRound, Plus, RefreshCw, RotateCcw, Search, Shield,
  ShieldOff, Trash2, UserPlus, Users, Wand2,
} from 'lucide-react'
import { adminApi } from '@/lib/api'
import { cn } from '@/lib/cn'
import { compactNumber, formatDate, percent, relativeTime } from '@/lib/format'
import { useDebounced } from '@/lib/hooks'
import {
  Avatar, Badge, Button, Card, EmptyState, IconButton, InlineError,
  Meter, SectionHeading, Skeleton, Tooltip,
} from '@/components/ui/primitives'
import { ConfirmDialog, Modal } from '@/components/ui/Modal'
import { Field, SecretField, Select, Switch } from '@/components/ui/Field'
import { Segmented } from '@/components/ui/Tabs'
import toast from 'react-hot-toast'

/* ══════════════════════════════════════════════════════════════════════════
   Users & Plans.

   Three things were missing from this screen: the "Add user" button opened
   nothing, the API-key box in the create form was dropped on the floor by the
   server, and admins were invisible because the list always asked for
   role=user. All three are fixed here, and every destructive action now asks
   through a styled dialog instead of window.confirm.
   ══════════════════════════════════════════════════════════════════════════ */

type RoleFilter = 'user' | 'admin'

interface AdminUser {
  _id: string
  name: string
  email: string
  role: 'user' | 'admin'
  phone?: string
  isActive: boolean
  hasContentbotApiKey?: boolean
  contentbotApiKeyMasked?: string
  subscription?: { tier: string; status: string }
  tokenQuota?: { weeklyLimit: number; tokensUsed7d: number }
  createdAt?: string
  lastSeen?: string
}

const TIER_TONE: Record<string, 'gold' | 'steel' | 'green' | 'amber'> = {
  enterprise: 'amber',
  pro: 'gold',
  free: 'steel',
}

const TIER_LIMIT: Record<string, number> = { free: 1_000_000, pro: 2_000_000, enterprise: 5_000_000 }

function suggestPassword(): string {
  const words = ['cedar', 'harbor', 'quartz', 'lantern', 'meadow', 'signal', 'cobalt', 'ember']
  const word = words[Math.floor(Math.random() * words.length)]
  const word2 = words[Math.floor(Math.random() * words.length)]
  const digits = Math.floor(1000 + Math.random() * 9000)
  return `${word[0].toUpperCase()}${word.slice(1)}-${word2}-${digits}!`
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [total, setTotal] = useState(0)
  const [role, setRole] = useState<RoleFilter>('user')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounced(search, 320)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<AdminUser | null>(null)
  const [pendingDelete, setPendingDelete] = useState<AdminUser | null>(null)
  const [pendingReset, setPendingReset] = useState<AdminUser | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params: Record<string, string> = { role }
      if (debouncedSearch.trim()) params.search = debouncedSearch.trim()
      const d: any = await adminApi.getUsers(params)
      setUsers(d.users || [])
      setTotal(d.total || 0)
    } catch (err: any) {
      setError(err.message || 'Could not load accounts')
    } finally {
      setLoading(false)
    }
  }, [role, debouncedSearch])

  useEffect(() => { void load() }, [load])

  const toggleActive = async (user: AdminUser) => {
    try {
      await adminApi.updateUser(user._id, { isActive: !user.isActive })
      setUsers(prev => prev.map(u => (u._id === user._id ? { ...u, isActive: !u.isActive } : u)))
      toast.success(`${user.name} ${!user.isActive ? 'reactivated' : 'deactivated'}`)
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const resetTokens = async () => {
    if (!pendingReset) return
    setBusy(true)
    try {
      await adminApi.resetUserTokens(pendingReset._id)
      setPendingReset(null)
      await load()
      toast.success('Token usage reset')
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  const removeUser = async () => {
    if (!pendingDelete) return
    setBusy(true)
    try {
      await adminApi.deleteUser(pendingDelete._id)
      setPendingDelete(null)
      await load()
      toast.success('Account deleted')
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  const withKey = useMemo(() => users.filter(u => u.hasContentbotApiKey).length, [users])

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Admin zone"
        title="Users & plans"
        description="Accounts, subscription tiers, weekly token quotas and the agent-platform key each person may hold."
        action={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={load} loading={loading} icon={<RefreshCw className="h-3.5 w-3.5" />}>
              Refresh
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)} icon={<UserPlus className="h-3.5 w-3.5" />}>
              Add user
            </Button>
          </div>
        }
      />

      {error ? <InlineError>{error}</InlineError> : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat label={`${role === 'admin' ? 'Admin' : 'User'} accounts`} value={total} icon={<Users className="h-4 w-4" />} />
        <MiniStat label="Shown here" value={users.length} icon={<Users className="h-4 w-4" />} />
        <MiniStat label="With agent key" value={withKey} icon={<KeyRound className="h-4 w-4" />} />
        <MiniStat
          label="Deactivated"
          value={users.filter(u => !u.isActive).length}
          icon={<ShieldOff className="h-4 w-4" />}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Segmented<RoleFilter>
          value={role}
          onChange={setRole}
          options={[
            { id: 'user', label: 'Users', icon: <Users className="h-3.5 w-3.5" /> },
            { id: 'admin', label: 'Admins', icon: <Shield className="h-3.5 w-3.5" /> },
          ]}
        />
        <div className="relative max-w-xs flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-dark-500" aria-hidden />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={`Search ${role}s by name or email…`}
            className="input-dark pl-9 text-[12.5px]"
            aria-label="Search accounts"
          />
        </div>
        {loading ? <Skeleton className="h-4 w-20" /> : null}
      </div>

      <Card padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12.5px]">
            <thead>
              <tr>
                {['Account', 'Plan', '7-day quota', 'Agent key', 'Status', ''].map(h => (
                  <th key={h} className="th">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05]">
              {loading && users.length === 0 ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={6} className="px-4 py-3"><Skeleton className="h-9 w-full" /></td>
                  </tr>
                ))
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <EmptyState
                      icon={<Users className="h-5 w-5" />}
                      title={search ? `No ${role} matches “${search}”` : `No ${role} accounts yet`}
                      description={role === 'admin'
                        ? 'Admin accounts can see every conversation and manage provider keys.'
                        : 'Create the first one with “Add user” — you can assign a plan and an agent key at the same time.'}
                      action={role === 'user' ? (
                        <Button size="sm" variant="ghost" onClick={() => setCreateOpen(true)} icon={<Plus className="h-3.5 w-3.5" />}>
                          Add user
                        </Button>
                      ) : undefined}
                    />
                  </td>
                </tr>
              ) : (
                users.map(user => {
                  const tier = user.subscription?.tier || 'free'
                  const used = user.tokenQuota?.tokensUsed7d || 0
                  const limit = user.tokenQuota?.weeklyLimit || TIER_LIMIT[tier] || 1_000_000
                  const usedPct = percent(used, limit)
                  return (
                    <tr key={user._id} className="table-row">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <Avatar name={user.name} size="sm" />
                          <div className="min-w-0">
                            <p className="truncate font-medium text-white">{user.name}</p>
                            <p className="truncate text-[11px] text-dark-500">{user.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col items-start gap-1">
                          <Badge tone={TIER_TONE[tier] || 'slate'}>{tier}</Badge>
                          {user.role === 'admin' ? <Badge tone="amber">admin</Badge> : null}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="w-40 space-y-1">
                          <div className="flex justify-between text-[10.5px] text-dark-400">
                            <span className="mono-num">{compactNumber(used)}</span>
                            <span className="mono-num">{compactNumber(limit)}</span>
                          </div>
                          <Meter value={usedPct} tone={usedPct > 85 ? 'danger' : usedPct > 60 ? 'warn' : 'gold'} />
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {user.hasContentbotApiKey ? (
                          <span className="inline-flex items-center gap-1.5">
                            <BadgeCheck className="h-3.5 w-3.5 text-emerald-400" aria-hidden />
                            <span className="font-mono text-[11px] text-dark-300">{user.contentbotApiKeyMasked}</span>
                          </span>
                        ) : (
                          <span className="text-[11.5px] text-dark-500">not set</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Switch checked={user.isActive} onChange={() => toggleActive(user)} label="" />
                          <span className={cn('text-[11.5px]', user.isActive ? 'text-emerald-300' : 'text-red-300')}>
                            {user.isActive ? 'active' : 'disabled'}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[10.5px] text-dark-600">seen {relativeTime(user.lastSeen)}</p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Tooltip text="Reset 7-day token usage">
                            <IconButton label="Reset tokens" onClick={() => setPendingReset(user)}>
                              <RotateCcw className="h-3.5 w-3.5" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip text="Edit account & key">
                            <IconButton label="Edit account" onClick={() => setEditing({ ...user })}>
                              <Edit2 className="h-3.5 w-3.5" />
                            </IconButton>
                          </Tooltip>
                          {user.role !== 'admin' ? (
                            <Tooltip text="Delete account">
                              <IconButton label="Delete account" danger onClick={() => setPendingDelete(user)}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </IconButton>
                            </Tooltip>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <CreateUserModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={async () => { setCreateOpen(false); await load() }}
      />

      <EditUserModal
        user={editing}
        onClose={() => setEditing(null)}
        onSaved={async () => { setEditing(null); await load() }}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        onConfirm={removeUser}
        loading={busy}
        title={`Delete ${pendingDelete?.name || 'this account'}?`}
        description="Their conversations and memory stay in the database but the account can no longer sign in. This cannot be undone from the dashboard."
        confirmLabel="Delete account"
      />

      <ConfirmDialog
        open={Boolean(pendingReset)}
        onClose={() => setPendingReset(null)}
        onConfirm={resetTokens}
        loading={busy}
        tone="primary"
        title="Reset the 7-day token count?"
        description={pendingReset ? `${pendingReset.name} goes back to 0 used of ${compactNumber(pendingReset.tokenQuota?.weeklyLimit || 1_000_000)} this week.` : ''}
        confirmLabel="Reset usage"
      />
    </div>
  )
}

/* ─── Bits ──────────────────────────────────────────────────────────────── */

function MiniStat({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="card flex items-center justify-between gap-3 p-4">
      <div className="min-w-0">
        <p className="truncate text-[10.5px] font-semibold uppercase tracking-wider text-dark-500">{label}</p>
        <p className="mono-num mt-1 text-[22px] font-semibold leading-none text-white">{value}</p>
      </div>
      <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl border border-brand-400/20 bg-brand-400/[0.07] text-brand-300">
        {icon}
      </span>
    </div>
  )
}

/* ─── Create ────────────────────────────────────────────────────────────── */

function CreateUserModal({ open, onClose, onCreated }: {
  open: boolean
  onClose: () => void
  onCreated: () => Promise<void> | void
}) {
  const [form, setForm] = useState({
    name: '', email: '', password: '', role: 'user' as 'user' | 'admin', phone: '', tier: 'free',
  })
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (open) {
      setForm({ name: '', email: '', password: '', role: 'user', phone: '', tier: 'free' })
      setApiKey('')
      setError('')
      setCreated(null)
      setCopied(false)
    }
  }, [open])

  const submit = async () => {
    setError('')
    if (!form.name.trim() || !form.email.trim()) {
      setError('Name and email are required')
      return
    }
    if (form.password && form.password.length < 8) {
      setError('The password must be at least 8 characters')
      return
    }
    setSaving(true)
    try {
      const password = form.password || suggestPassword()
      const d: any = await adminApi.createUser({
        name: form.name.trim(),
        email: form.email.trim(),
        password,
        role: form.role,
        phone: form.phone.trim(),
        contentbotApiKey: apiKey.trim() || undefined,
      })
      if (form.tier !== 'free') {
        await adminApi.updateUserSubscription(d.user._id, { tier: form.tier, weeklyLimit: TIER_LIMIT[form.tier] })
      }
      setCreated({ email: form.email.trim(), password })
      await onCreated()
      toast.success('Account created')
    } catch (err: any) {
      setError(err.message || 'Could not create the account')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add user"
      description="The account is usable immediately; hand over the credentials below."
      icon={<UserPlus className="h-4 w-4" />}
      size="lg"
      footer={
        created ? (
          <Button size="sm" onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button size="sm" onClick={submit} loading={saving} icon={<Plus className="h-3.5 w-3.5" />}>
              Create account
            </Button>
          </>
        )
      }
    >
      {created ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.06] p-4">
            <BadgeCheck className="mt-0.5 h-4 w-4 flex-none text-emerald-400" aria-hidden />
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-emerald-200">Account created</p>
              <p className="mt-1 text-[12px] leading-relaxed text-emerald-100/70">
                Copy the password now — it is stored hashed and cannot be read again. The user can
                change it in Settings.
              </p>
            </div>
          </div>

          <dl className="space-y-2 rounded-2xl border border-white/[0.07] bg-black/30 p-4 text-[12.5px]">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-dark-400">Email</dt>
              <dd className="truncate font-mono text-dark-100">{created.email}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-dark-400">Password</dt>
              <dd className="flex items-center gap-1.5">
                <span className="font-mono text-brand-200">{created.password}</span>
                <IconButton
                  label="Copy credentials"
                  onClick={async () => {
                    await navigator.clipboard.writeText(`Email: ${created.email}\nPassword: ${created.password}`)
                    setCopied(true)
                    toast.success('Credentials copied')
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </IconButton>
              </dd>
            </div>
            {copied ? <p className="text-[11px] text-dark-500">Copied to the clipboard.</p> : null}
          </dl>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" htmlFor="cu-name" required>
              <input id="cu-name" className="input-dark" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Jane Cooper" />
            </Field>
            <Field label="Email" htmlFor="cu-email" required>
              <input id="cu-email" type="email" className="input-dark" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="jane@company.com" />
            </Field>
          </div>

          <Field
            label="Password"
            htmlFor="cu-password"
            hint="Leave blank to generate a strong one."
            action={
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, password: suggestPassword() }))}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-brand-300/90 hover:text-brand-200"
              >
                <Wand2 className="h-3 w-3" /> Generate
              </button>
            }
          >
            <input
              id="cu-password"
              className="input-dark input-secret"
              value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              placeholder="At least 8 characters"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <Select label="Role" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value as 'user' | 'admin' }))}>
              <option value="user">Standard user</option>
              <option value="admin">Administrator</option>
            </Select>
            <Select label="Plan" value={form.tier} onChange={e => setForm(f => ({ ...f, tier: e.target.value }))}>
              <option value="free">Free · 1M / 7d</option>
              <option value="pro">Pro · 2M / 7d</option>
              <option value="enterprise">Enterprise · 5M / 7d</option>
            </Select>
            <Field label="Phone" htmlFor="cu-phone">
              <input id="cu-phone" className="input-dark" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+8801…" />
            </Field>
          </div>

          <SecretField
            value={apiKey}
            onChange={setApiKey}
            label="Agent platform key (optional)"
            placeholder="cb-agents-key-…"
            hint="Assigned now, shown to the owner only as a masked preview."
          />

          {error ? <InlineError>{error}</InlineError> : null}
        </div>
      )}
    </Modal>
  )
}

/* ─── Edit ──────────────────────────────────────────────────────────────── */

function EditUserModal({ user, onClose, onSaved }: {
  user: AdminUser | null
  onClose: () => void
  onSaved: () => Promise<void> | void
}) {
  const [form, setForm] = useState({ name: '', email: '', role: 'user', tier: 'free', weeklyLimit: 1_000_000, status: 'active' })
  const [apiKey, setApiKey] = useState('')
  const [revokeKey, setRevokeKey] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!user) return
    setForm({
      name: user.name || '',
      email: user.email || '',
      role: user.role,
      tier: user.subscription?.tier || 'free',
      weeklyLimit: user.tokenQuota?.weeklyLimit || 1_000_000,
      status: user.subscription?.status || 'active',
    })
    setApiKey('')
    setRevokeKey(false)
    setError('')
  }, [user])

  const save = async () => {
    if (!user) return
    setError('')
    if (!form.name.trim() || !form.email.trim()) {
      setError('Name and email are required')
      return
    }
    setSaving(true)
    try {
      // Revoking wins over a pasted value — the server treats '' as "remove this key" and a
      // non-empty string as "write this key", and sending both would be ambiguous.
      const keyPayload = revokeKey
        ? { contentbotApiKey: '' }
        : apiKey.trim()
          ? { contentbotApiKey: apiKey.trim() }
          : {}

      await adminApi.updateUser(user._id, {
        name: form.name.trim(),
        email: form.email.trim(),
        role: form.role,
        ...keyPayload,
      })
      await adminApi.updateUserSubscription(user._id, {
        tier: form.tier,
        weeklyLimit: Number(form.weeklyLimit),
        status: form.status,
      })
      toast.success('Account updated')
      await onSaved()
    } catch (err: any) {
      setError(err.message || 'Could not save the changes')
    } finally {
      setSaving(false)
    }
  }

  const keyChanged = Boolean(apiKey.trim()) || revokeKey

  return (
    <Modal
      open={Boolean(user)}
      onClose={onClose}
      title="Edit account"
      description={user?.email}
      icon={<Edit2 className="h-4 w-4" />}
      size="lg"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button size="sm" onClick={save} loading={saving}>Save changes</Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" htmlFor="eu-name">
            <input id="eu-name" className="input-dark" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </Field>
          <Field label="Email" htmlFor="eu-email">
            <input id="eu-email" className="input-dark" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Select label="Role" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
            <option value="user">Standard user</option>
            <option value="admin">Administrator</option>
          </Select>
          <Select
            label="Plan"
            value={form.tier}
            onChange={e => setForm(f => ({ ...f, tier: e.target.value, weeklyLimit: TIER_LIMIT[e.target.value] || f.weeklyLimit }))}
          >
            <option value="free">Free · 1M / 7d</option>
            <option value="pro">Pro · 2M / 7d</option>
            <option value="enterprise">Enterprise · 5M / 7d</option>
          </Select>
          <Select label="Subscription" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
            <option value="active">Active</option>
            <option value="cancelled">Cancelled</option>
            <option value="expired">Expired</option>
          </Select>
        </div>

        <Field label="Weekly token limit" htmlFor="eu-limit" hint="Tokens are counted per rolling 7-day window.">
          <input
            id="eu-limit"
            type="number"
            min={0}
            step={100000}
            className="input-dark mono-num"
            value={form.weeklyLimit}
            onChange={e => setForm(f => ({ ...f, weeklyLimit: Number(e.target.value) }))}
          />
        </Field>

        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="flex items-center gap-2 text-[13px] font-medium text-dark-100">
                <KeyRound className="h-3.5 w-3.5 text-brand-300" aria-hidden />
                Agent platform key
              </p>
              <p className="mt-0.5 text-[11.5px] text-dark-500">
                {user?.hasContentbotApiKey
                  ? `Currently stored as ${user.contentbotApiKeyMasked}`
                  : 'No personal key — the platform-wide fallback is used.'}
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            <SecretField
              value={apiKey}
              onChange={setApiKey}
              label={user?.hasContentbotApiKey ? 'Replace key' : 'Assign key'}
              placeholder="cb-agents-key-…"
              disabled={revokeKey}
              hint="Saved server-side. The owner sees it only as a masked preview."
            />
            {user?.hasContentbotApiKey ? (
              <Switch
                checked={revokeKey}
                onChange={setRevokeKey}
                label="Revoke this key"
                hint="Removes the personal key on save; the platform fallback takes over."
              />
            ) : null}
            {apiKey.trim() && revokeKey ? (
              <InlineError>Either paste a replacement or revoke — not both.</InlineError>
            ) : null}
          </div>

          {keyChanged ? (
            <p className="mt-3 text-[11px] text-brand-300/90">
              {revokeKey ? 'The key will be removed when you save.' : 'The new key is written when you save.'}
            </p>
          ) : null}
        </div>

        {user?.createdAt ? (
          <p className="text-[11.5px] text-dark-500">
            Account created {formatDate(user.createdAt)} · last seen {relativeTime(user.lastSeen)}
          </p>
        ) : null}

        {error ? <InlineError>{error}</InlineError> : null}
      </div>
    </Modal>
  )
}
