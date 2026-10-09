'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity, AlertTriangle, Copy, ExternalLink, KeyRound, Layers,
  Plus, RefreshCw, ShieldCheck, Sliders, Trash2, Zap,
} from 'lucide-react'
import { adminApi } from '@/lib/api'
import { cn } from '@/lib/cn'
import { relativeTime } from '@/lib/format'
import {
  Badge, Button, Card, CardHeader, EmptyState, IconButton, InlineError,
  SectionHeading, Skeleton, StatusDot, Tooltip,
} from '@/components/ui/primitives'
import { ConfirmDialog, Modal } from '@/components/ui/Modal'
import { Field, SecretField, Select, Switch, type SecretStatus } from '@/components/ui/Field'
import { Segmented } from '@/components/ui/Tabs'
import { CountUp } from '@/components/ui/Reveal'
import toast from 'react-hot-toast'

/* ══════════════════════════════════════════════════════════════════════════
   API key vault (admin).

   The deployment keeps its provider keys in backend/.env, which is fine until
   a key needs rotating at 2am. This screen shows what the server actually
   holds — file-baked and runtime-saved, per slot — proves a key against the
   provider, and rotates it without a restart or a shell.
   ══════════════════════════════════════════════════════════════════════════ */

interface Slot {
  envName: string
  source: 'vault' | 'env' | 'missing'
  masked: string
  savedCount: number
  hasEnvFallback: boolean
  saved: { id: string; label: string }[]
}

interface Provider {
  id: string
  label: string
  group: string
  setupUrl: string
  placeholder: string
  probeable: boolean
  slots: Slot[]
  configured: number
  keys: { id: string; label: string; envName: string }[]
}

interface SavedKey {
  _id: string
  provider: string
  providerLabel: string
  envName: string
  label: string
  enabled: boolean
  lastTestedAt: string | null
  lastTestStatus: 'ok' | 'failed' | 'unknown'
  lastTestMessage: string
  lastTestLatencyMs: number | null
  updatedAt: string
}

interface VaultData {
  providers: { id: string; label: string; group: string; setupUrl: string; placeholder: string; envNames: string[]; probeable: boolean }[]
  inventory: Provider[]
  keys: SavedKey[]
  summary: {
    providersConfigured: number
    providersTotal: number
    savedKeys: number
    enabledKeys: number
    failingKeys: number
    runtimeSlots: number
    hydratedAt: number | null
    hydrationError: string | null
  }
}

type Filter = 'all' | 'saved' | 'failing' | 'missing'

export default function AdminApiKeysPage() {
  const [data, setData] = useState<VaultData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [testState, setTestState] = useState<Record<string, { status: SecretStatus; message: string }>>({})
  const [addOpen, setAddOpen] = useState(false)
  const [rotating, setRotating] = useState<SavedKey | null>(null)
  const [pendingDelete, setPendingDelete] = useState<SavedKey | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const d: any = await adminApi.getApiKeys()
      setData(d)
    } catch (err: any) {
      setError(err.message || 'Could not load the vault')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const mark = (id: string, status: SecretStatus, message: string) =>
    setTestState(prev => ({ ...prev, [id]: { status, message } }))

  /** Probe one slot (id) or one saved key (id) against the live provider. */
  const test = useCallback(async (id: string, payload: { id?: string; envName?: string; value?: string }) => {
    mark(id, 'checking', '')
    try {
      const d: any = await adminApi.testApiKey(payload)
      const result = d.result
      mark(id, result.ok ? 'ok' : 'fail', result.message)
      if (result.ok) toast.success(result.message)
      else toast.error(result.message, { duration: 6000 })
      if (payload.id) await load()
    } catch (err: any) {
      mark(id, 'fail', err.message || 'Probe failed')
      toast.error(err.message || 'Probe failed')
    }
  }, [load])

  const toggleEnabled = async (key: SavedKey) => {
    setBusyId(key._id)
    try {
      await adminApi.updateApiKey(key._id, { enabled: !key.enabled })
      await load()
      toast.success(key.enabled ? 'Key disabled' : 'Key enabled')
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setBusyId(null)
    }
  }

  const remove = async () => {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await adminApi.deleteApiKey(pendingDelete._id)
      await load()
      toast.success('Key revoked')
      setPendingDelete(null)
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setDeleting(false)
    }
  }

  const providers = useMemo(() => {
    const list = data?.inventory || []
    const needle = query.trim().toLowerCase()
    return list.filter(provider => {
      if (needle && !`${provider.label} ${provider.group} ${provider.id} ${provider.slots.map(s => s.envName).join(' ')}`.toLowerCase().includes(needle)) {
        return false
      }
      if (filter === 'saved') return provider.keys.length > 0
      if (filter === 'missing') return provider.configured === 0
      if (filter === 'failing') return (data?.keys || []).some(k => k.envName && k.provider === provider.id && k.lastTestStatus === 'failed')
      return true
    })
  }, [data, filter, query])

  const summary = data?.summary

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Admin zone"
        title="API key vault"
        description="Every provider key this deployment holds, whether it came from backend/.env or was added here, and whether the provider still accepts it."
        action={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={load} loading={loading} icon={<RefreshCw className="h-3.5 w-3.5" />}>
              Refresh
            </Button>
            <Button size="sm" onClick={() => setAddOpen(true)} icon={<Plus className="h-3.5 w-3.5" />}>
              Add key
            </Button>
          </div>
        }
      />

      {error ? <InlineError>{error}</InlineError> : null}

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {loading && !summary ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[86px] rounded-2xl" />)
        ) : (
          <>
            <Kpi
              icon={<Layers className="h-4 w-4" />}
              label="Providers configured"
              value={<><CountUp value={summary?.providersConfigured || 0} /><span className="text-dark-500">/{summary?.providersTotal || 0}</span></>}
            />
            <Kpi
              icon={<KeyRound className="h-4 w-4" />}
              label="Keys saved here"
              value={<CountUp value={summary?.savedKeys || 0} />}
              hint={summary?.savedKeys ? `${summary.enabledKeys} enabled` : 'all keys come from .env'}
            />
            <Kpi
              icon={<Zap className="h-4 w-4" />}
              label="Runtime slots"
              value={<CountUp value={summary?.runtimeSlots || 0} />}
              hint="take effect without a restart"
            />
            <Kpi
              icon={summary?.failingKeys ? <AlertTriangle className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
              label="Failing probes"
              value={<CountUp value={summary?.failingKeys || 0} />}
              tone={summary?.failingKeys ? 'danger' : 'ok'}
              hint={summary?.failingKeys ? 'rotate these' : 'nothing rejected'}
            />
          </>
        )}
      </div>

      {summary?.hydrationError ? (
        <Card danger>
          <p className="text-[12.5px] text-red-200">
            The vault could not hydrate: {summary.hydrationError}. Requests are still served from
            backend/.env, but saved keys are not in effect.
          </p>
        </Card>
      ) : null}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Segmented<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { id: 'all', label: 'All providers' },
            { id: 'saved', label: 'With saved keys' },
            { id: 'failing', label: 'Failing' },
            { id: 'missing', label: 'Not configured' },
          ]}
        />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search provider, slot or key name…"
          className="input-dark max-w-xs text-[12.5px]"
          aria-label="Search keys"
        />
        <span className="text-[11.5px] text-dark-500">
          {providers.length} of {data?.inventory.length || 0} providers
        </span>
      </div>

      {/* Saved keys */}
      {(data?.keys?.length || 0) > 0 ? (
        <Card padded={false}>
          <div className="px-5 pt-5">
            <CardHeader
              icon={<KeyRound className="h-4 w-4" />}
              title="Keys saved from this dashboard"
              description="These override the same slot in backend/.env. Deleting one falls back to the file value instead of breaking the provider."
            />
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-[12.5px]">
              <thead>
                <tr>
                  {['Key', 'Provides', 'Slot', 'Health', 'Enabled', ''].map(h => (
                    <th key={h} className="th">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {data?.keys.map(key => {
                  const state = testState[key._id]
                  const status = state?.status === 'ok'
                    ? 'ok'
                    : state?.status === 'fail'
                      ? 'failed'
                      : key.lastTestStatus
                  return (
                    <tr key={key._id} className="table-row">
                      <td className="px-4 py-3">
                        <p className="font-medium text-dark-100">{key.label || 'Untitled key'}</p>
                        <p className="text-[11px] text-dark-500">added {relativeTime(key.updatedAt)}</p>
                      </td>
                      <td className="px-4 py-3 text-dark-300">{key.providerLabel}</td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-[11px] text-brand-200">{key.envName}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <StatusDot tone={status === 'ok' ? 'live' : status === 'failed' ? 'error' : 'idle'} />
                          <span className="text-[11.5px] text-dark-400">
                            {state?.status === 'checking'
                              ? 'testing…'
                              : status === 'ok'
                                ? `verified${key.lastTestLatencyMs ? ` · ${key.lastTestLatencyMs}ms` : ''}`
                                : status === 'failed'
                                  ? 'rejected'
                                  : 'untested'}
                          </span>
                        </div>
                        {state?.message || key.lastTestMessage ? (
                          <p className="mt-0.5 max-w-[22rem] truncate text-[10.5px] text-dark-500" title={state?.message || key.lastTestMessage}>
                            {state?.message || key.lastTestMessage}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <Switch
                          checked={key.enabled}
                          disabled={busyId === key._id}
                          onChange={() => toggleEnabled(key)}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Tooltip text="Test against the provider">
                            <IconButton
                              label="Test key"
                              onClick={() => test(key._id, { id: key._id })}
                              disabled={state?.status === 'checking'}
                            >
                              <Activity className={cn('h-3.5 w-3.5', state?.status === 'checking' && 'animate-pulse')} />
                            </IconButton>
                          </Tooltip>
                          <Tooltip text="Rotate value">
                            <IconButton label="Rotate key" onClick={() => setRotating(key)}>
                              <RefreshCw className="h-3.5 w-3.5" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip text="Delete">
                            <IconButton label="Delete key" danger onClick={() => setPendingDelete(key)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </IconButton>
                          </Tooltip>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {/* Provider grid */}
      {loading && !data ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-44 rounded-2xl" />)}
        </div>
      ) : providers.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Sliders className="h-5 w-5" />}
            title="No provider matches that filter"
            description="Clear the search box or switch back to “All providers”."
          />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {providers.map(provider => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              testState={testState}
              onTest={test}
            />
          ))}
        </div>
      )}

      <AddKeyModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        providers={data?.providers || []}
        onSaved={async () => { setAddOpen(false); await load() }}
      />

      <RotateKeyModal
        keyDoc={rotating}
        onClose={() => setRotating(null)}
        onSaved={async () => { setRotating(null); await load() }}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        onConfirm={remove}
        loading={deleting}
        title="Delete this key?"
        description={pendingDelete
          ? `${pendingDelete.envName} falls back to the value in backend/.env if one exists; otherwise that provider stops serving.`
          : ''}
        confirmLabel="Delete key"
      />
    </div>
  )
}

/* ─── Bits ──────────────────────────────────────────────────────────────── */

function Kpi({ icon, label, value, hint, tone = 'default' }: {
  icon: React.ReactNode
  label: string
  value: React.ReactNode
  hint?: string
  tone?: 'default' | 'ok' | 'danger'
}) {
  return (
    <div className={cn(
      'card p-4',
      tone === 'danger' && 'border-red-500/25',
      tone === 'ok' && 'border-emerald-500/20'
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10.5px] font-semibold uppercase tracking-wider text-dark-500">{label}</p>
          <p className={cn(
            'mono-num mt-1.5 text-[24px] font-semibold leading-none',
            tone === 'danger' ? 'text-red-300' : 'text-white'
          )}>
            {value}
          </p>
          {hint ? <p className="mt-1.5 truncate text-[11px] text-dark-500">{hint}</p> : null}
        </div>
        <span className={cn(
          'flex h-9 w-9 flex-none items-center justify-center rounded-xl border',
          tone === 'danger'
            ? 'border-red-500/25 bg-red-500/[0.08] text-red-300'
            : 'border-brand-400/20 bg-brand-400/[0.07] text-brand-300'
        )}>
          {icon}
        </span>
      </div>
    </div>
  )
}

const SOURCE_LABEL: Record<Slot['source'], { text: string; tone: 'gold' | 'steel' | 'red' }> = {
  vault: { text: 'dashboard', tone: 'gold' },
  env: { text: '.env', tone: 'steel' },
  missing: { text: 'missing', tone: 'red' },
}

function ProviderCard({ provider, testState, onTest }: {
  provider: Provider
  testState: Record<string, { status: SecretStatus; message: string }>
  onTest: (id: string, payload: { id?: string; envName?: string; value?: string }) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const slots = expanded ? provider.slots : provider.slots.slice(0, 4)
  const hidden = provider.slots.length - slots.length

  return (
    <Card className="flex flex-col">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusDot tone={provider.configured === 0 ? 'error' : 'live'} />
            <h3 className="truncate text-[14px] font-semibold text-white">{provider.label}</h3>
          </div>
          <p className="mt-0.5 text-[11px] uppercase tracking-wider text-dark-500">{provider.group}</p>
        </div>
        <Badge tone={provider.keys.length ? 'green' : provider.configured ? 'steel' : 'red'}>
          {provider.keys.length ? `${provider.keys.length} saved` : provider.configured ? `${provider.configured} from .env` : 'no key'}
        </Badge>
      </div>

      <ul className="mt-3 flex-1 space-y-1">
        {slots.map(slot => {
          const state = testState[slot.envName]
          const tone = state?.status === 'ok' ? 'live' : state?.status === 'fail' ? 'error' : slot.source === 'missing' ? 'idle' : 'live'
          return (
            <li
              key={slot.envName}
              className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.05] bg-white/[0.015] px-2.5 py-2"
            >
              <span className="flex min-w-0 items-center gap-2">
                <StatusDot tone={tone as any} />
                <span className="min-w-0">
                  <span className="block truncate font-mono text-[11px] text-dark-300">{slot.envName}</span>
                  <span className="block truncate font-mono text-[10px] text-dark-600">
                    {slot.masked || '—'}
                  </span>
                </span>
              </span>
              <span className="flex flex-none items-center gap-1">
                <Badge tone={SOURCE_LABEL[slot.source].tone} className="hidden xs:inline-flex">
                  {SOURCE_LABEL[slot.source].text}
                </Badge>
                {provider.probeable && slot.source !== 'missing' ? (
                  <Tooltip text={state?.status === 'checking' ? 'Testing…' : 'Test this slot'}>
                    <IconButton
                      label={`Test ${slot.envName}`}
                      className="h-7 w-7"
                      disabled={state?.status === 'checking'}
                      onClick={() => onTest(slot.envName, { envName: slot.envName })}
                    >
                      <Activity className={cn('h-3.5 w-3.5', state?.status === 'checking' && 'animate-pulse')} />
                    </IconButton>
                  </Tooltip>
                ) : null}
              </span>
            </li>
          )
        })}
      </ul>

      {hidden > 0 || expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          className="mt-2 text-left text-[11.5px] font-medium text-brand-300/90 hover:text-brand-200"
        >
          {expanded ? 'Show fewer slots' : `Show ${hidden} more slot${hidden === 1 ? '' : 's'}`}
        </button>
      ) : null}

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/[0.06] pt-3">
        <span className="text-[11px] text-dark-500">
          {provider.slots.filter(s => s.source === 'vault').length} from dashboard
        </span>
        {provider.setupUrl ? (
          <a
            href={provider.setupUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11.5px] text-dark-400 transition-colors hover:text-brand-200"
          >
            Get a key
            <ExternalLink className="h-3 w-3" />
          </a>
        ) : null}
      </div>
    </Card>
  )
}

/* ─── Add key ───────────────────────────────────────────────────────────── */

function AddKeyModal({ open, onClose, providers, onSaved }: {
  open: boolean
  onClose: () => void
  providers: VaultData['providers']
  onSaved: () => Promise<void> | void
}) {
  const [providerId, setProviderId] = useState('')
  const [envName, setEnvName] = useState('')
  const [value, setValue] = useState('')
  const [label, setLabel] = useState('')
  const [status, setStatus] = useState<SecretStatus>('idle')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const provider = providers.find(p => p.id === providerId)

  useEffect(() => {
    if (!open) {
      setProviderId('')
      setEnvName('')
      setValue('')
      setLabel('')
      setStatus('idle')
      setMessage('')
      setError('')
    }
  }, [open])

  // Default the slot to the provider's first empty slot — the common case is filling a gap.
  useEffect(() => {
    if (!provider) return
    setEnvName(provider.envNames[0])
    setStatus('idle')
    setMessage('')
  }, [providerId]) // eslint-disable-line react-hooks/exhaustive-deps

  const testDraft = async () => {
    setError('')
    if (!envName || !value.trim()) {
      setError('Pick a slot and paste the key first')
      return
    }
    setStatus('checking')
    try {
      const d: any = await adminApi.testApiKey({ envName, value: value.trim() })
      setStatus(d.result.ok ? 'ok' : 'fail')
      setMessage(d.result.message)
    } catch (err: any) {
      setStatus('fail')
      setMessage(err.message || 'Probe failed')
    }
  }

  const save = async () => {
    setError('')
    if (!envName) {
      setError('Choose which slot this key fills')
      return
    }
    if (!value.trim()) {
      setError('Paste the key value')
      return
    }
    setSaving(true)
    try {
      await adminApi.createApiKey({ envName, value: value.trim(), label })
      toast.success(`Saved for ${envName}`)
      await onSaved()
    } catch (err: any) {
      setError(err.message || 'Could not save the key')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a provider key"
      description="Saved keys take effect on the next AI request — no restart, and backend/.env stays as the fallback."
      icon={<KeyRound className="h-4 w-4" />}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={testDraft}
            loading={status === 'checking'}
            disabled={!provider?.probeable || !value.trim()}
            icon={<Zap className="h-3.5 w-3.5" />}
          >
            Test first
          </Button>
          <Button size="sm" onClick={save} loading={saving} icon={<Plus className="h-3.5 w-3.5" />}>
            Save key
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Select
          label="Provider"
          value={providerId}
          data-autofocus
          onChange={e => setProviderId(e.target.value)}
        >
          <option value="">Choose a provider…</option>
          {providers.map(p => (
            <option key={p.id} value={p.id}>{p.label} · {p.group}</option>
          ))}
        </Select>

        {provider ? (
          <Select label="Slot" value={envName} onChange={e => setEnvName(e.target.value)} hint="The .env variable this key fills (and overrides).">
            {provider.envNames.map(slot => (
              <option key={slot} value={slot}>{slot}</option>
            ))}
          </Select>
        ) : null}

        <SecretField
          value={value}
          onChange={v => { setValue(v); setStatus('idle'); setMessage('') }}
          label="Key value"
          placeholder={provider?.placeholder || 'Paste the key'}
          status={status}
          statusMessage={message}
          hint="Stored server-side, never returned by the API."
          disabled={!provider}
        />

        <Field label="Label" htmlFor="key-label" hint="Optional — helps you tell two keys for the same provider apart.">
          <input
            id="key-label"
            className="input-dark"
            value={label}
            onChange={e => setLabel(e.target.value)}
            placeholder="e.g. billing account, backup key"
          />
        </Field>

        {provider && !provider.probeable ? (
          <p className="flex items-start gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-[11.5px] text-dark-400">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none text-brand-300/80" />
            {provider.label} publishes no endpoint this dashboard can probe, so the key can be stored
            and rotated but not verified from here.
          </p>
        ) : null}

        {error ? <InlineError>{error}</InlineError> : null}
      </div>
    </Modal>
  )
}

/* ─── Rotate key ────────────────────────────────────────────────────────── */

function RotateKeyModal({ keyDoc, onClose, onSaved }: {
  keyDoc: SavedKey | null
  onClose: () => void
  onSaved: () => Promise<void> | void
}) {
  const [value, setValue] = useState('')
  const [status, setStatus] = useState<SecretStatus>('idle')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setValue('')
    setStatus('idle')
    setMessage('')
    setError('')
  }, [keyDoc?._id])

  const save = async () => {
    if (!keyDoc) return
    setError('')
    if (!value.trim()) {
      setError('Paste the new key')
      return
    }
    setSaving(true)
    try {
      const d: any = await adminApi.updateApiKey(keyDoc._id, { value: value.trim() })
      toast.success(`Rotated ${d.key.envName}`)
      await onSaved()
    } catch (err: any) {
      setError(err.message || 'Could not rotate the key')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={Boolean(keyDoc)}
      onClose={onClose}
      title="Rotate key"
      description={keyDoc ? `${keyDoc.providerLabel} · ${keyDoc.envName}` : ''}
      icon={<RefreshCw className="h-4 w-4" />}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button size="sm" onClick={save} loading={saving} icon={<ShieldCheck className="h-3.5 w-3.5" />}>
            Save new value
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <SecretField
          value={value}
          onChange={v => { setValue(v); setStatus('idle'); setMessage('') }}
          label="New value"
          status={status}
          statusMessage={message}
          hint="The old value is replaced immediately; the previous key stops being used."
          autoFocus
        />

        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-[11.5px] text-dark-400">
          <p className="flex items-center gap-2">
            <Copy className="h-3.5 w-3.5 text-dark-500" />
            Stored keys cannot be read back. Rotate by pasting a new value; use the test action in the
            table afterwards to prove it works.
          </p>
        </div>

        {error ? <InlineError>{error}</InlineError> : null}
      </div>
    </Modal>
  )
}
