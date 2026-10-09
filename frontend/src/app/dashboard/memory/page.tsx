'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BadgeCheck, Brain, Building2, Check, ChevronRight, CircleDollarSign, Clock, Edit2, Eye,
  EyeOff, Info, Lightbulb, MessageSquareQuote, Package, Plus, Save, Search, ShieldAlert,
  Sparkles, Store, Tag, Trash2, Truck, Wand2, X,
} from 'lucide-react'
import { memoryApi } from '@/lib/api'
import { cn } from '@/lib/cn'
import { relativeTime } from '@/lib/format'
import { useDebounced } from '@/lib/hooks'
import {
  Badge, Button, Card, CardHeader, EmptyState, IconButton, InlineError, Meter, SectionHeading,
  Skeleton, Switch, Tooltip,
} from '@/components/ui'
import { ConfirmDialog, Modal } from '@/components/ui/Modal'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Segmented } from '@/components/ui/Tabs'
import { CountUp, ProgressRing, Reveal } from '@/components/ui/Reveal'
import toast from 'react-hot-toast'

/* ══════════════════════════════════════════════════════════════════════════
   AI memory — the business profile the assistant answers from.

   Written for a shop owner, not an engineer: every card is a question they can
   answer in one sentence ("What do you sell?", "When are you open?"), every
   field is optional, and the right rail shows the sample reply their answers
   produce. Nothing on this page blocks anything — leaving it empty simply means
   the assistant asks instead of assuming.
   ══════════════════════════════════════════════════════════════════════════ */

const TONES = [
  { id: 'professional', label: 'Professional', hint: 'polished, no slang' },
  { id: 'friendly', label: 'Friendly', hint: 'warm and chatty' },
  { id: 'casual', label: 'Casual', hint: 'like a texts between friends' },
  { id: 'formal', label: 'Formal', hint: 'respectful, business-like' },
  { id: 'enthusiastic', label: 'Enthusiastic', hint: 'upbeat and lively' },
]

const REPLY_LENGTHS = [
  { id: 'short', label: 'Short' },
  { id: 'balanced', label: 'Balanced' },
  { id: 'detailed', label: 'Detailed' },
]

const CATEGORIES = ['business', 'product', 'customer', 'preference', 'fact', 'other'] as const
type Category = (typeof CATEGORIES)[number]

type CatalogItem = {
  _id?: string
  kind: 'product' | 'service'
  name: string
  price: string
  summary: string
  details: string
  available: boolean
}

type SectionId = 'identity' | 'catalog' | 'operations' | 'rules' | 'voice' | 'entries'

type ChecklistItem = { field: string; label: string; done: boolean }
type ChecklistSection = {
  id: string
  label: string
  hint: string
  done: number
  total: number
  items: ChecklistItem[]
  missing: string[]
}
type Completeness = { score: number; filled: number; total: number; sections: ChecklistSection[] }
type Preview = { text: string; grounded: string[]; missing: string[] }

const IDENTITY_KEYS = ['ownerName', 'ownerRole', 'businessName', 'businessType', 'businessDescription'] as const
const OPERATION_KEYS = [
  'openingHours', 'serviceAreas', 'delivery', 'payment', 'address', 'phone', 'email', 'website', 'bookingLink',
] as const
const RULE_KEYS = ['policies', 'guardrails', 'escalationContact'] as const
const VOICE_KEYS = ['greeting', 'signoff', 'tone', 'language', 'replyLength'] as const

const emptyItem: CatalogItem = { kind: 'product', name: '', price: '', summary: '', details: '', available: true }

export default function MemoryPage() {
  const [memory, setMemory] = useState<any>(null)
  const [completeness, setCompleteness] = useState<Completeness | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busySection, setBusySection] = useState<SectionId | null>(null)
  const [dirty, setDirty] = useState<Record<string, boolean>>({})
  const [togglingEnabled, setTogglingEnabled] = useState(false)

  const [identity, setIdentity] = useState<Record<string, string>>({})
  const [operations, setOperations] = useState<Record<string, string>>({})
  const [rules, setRules] = useState<Record<string, string>>({})
  const [voice, setVoice] = useState<Record<string, string>>({})

  const [catalogOpen, setCatalogOpen] = useState(false)
  const [catalogDraft, setCatalogDraft] = useState<CatalogItem>(emptyItem)
  const [catalogEditing, setCatalogEditing] = useState<string | null>(null)
  const [catalogSaving, setCatalogSaving] = useState(false)
  const [catalogFilter, setCatalogFilter] = useState<'all' | 'product' | 'service'>('all')

  const [entryModal, setEntryModal] = useState<'add' | 'edit' | null>(null)
  const [entryDraft, setEntryDraft] = useState({ key: '', value: '', category: 'other' as string })
  const [entryEditing, setEntryEditing] = useState<string | null>(null)
  const [entryFilter, setEntryFilter] = useState<'all' | Category>('all')
  const [entryQuery, setEntryQuery] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<{ kind: 'entry' | 'catalog'; id: string; label: string } | null>(null)

  /* ── Loading ───────────────────────────────────────────────────────────── */

  const applyEnvelope = useCallback((data: any) => {
    if (!data?.memory) return
    setMemory(data.memory)
    if (data.completeness) setCompleteness(data.completeness)
    if (data.preview) setPreview(data.preview)
    setIdentity({
      ownerName: data.memory.ownerName || '',
      ownerRole: data.memory.ownerRole || '',
      businessName: data.memory.businessName || '',
      businessType: data.memory.businessType || '',
      businessDescription: data.memory.businessDescription || '',
    })
    setOperations(Object.fromEntries(OPERATION_KEYS.map((key) => [key, data.memory.operations?.[key] || ''])))
    setRules({
      policies: data.memory.policies || '',
      guardrails: data.memory.guardrails || '',
      escalationContact: data.memory.escalationContact || '',
    })
    setVoice({
      greeting: data.memory.greeting || '',
      signoff: data.memory.signoff || '',
      tone: data.memory.tone || 'professional',
      language: data.memory.language || 'English',
      replyLength: data.memory.replyLength || 'balanced',
    })
    setDirty({})
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      applyEnvelope(await memoryApi.get())
    } catch (err: any) {
      setError(err?.message || 'Could not load your business profile')
    } finally {
      setLoading(false)
    }
  }, [applyEnvelope])

  useEffect(() => { load() }, [load])

  /* ── Saving one card at a time ─────────────────────────────────────────── */

  const saveSection = useCallback(async (section: SectionId, payload: Record<string, unknown>) => {
    setBusySection(section)
    try {
      const data = await memoryApi.update(payload)
      applyEnvelope(data)
      toast.success('Saved — the assistant will use it right away')
    } catch (err: any) {
      toast.error(err?.message || 'Could not save that section')
    } finally {
      setBusySection(null)
    }
  }, [applyEnvelope])

  const markDirty = (section: string) => setDirty((current) => ({ ...current, [section]: true }))

  const toggleEnabled = async (next: boolean) => {
    setTogglingEnabled(true)
    try {
      applyEnvelope(await memoryApi.setEnabled(next))
      setDirty({})
      toast.success(next ? 'Business memory is on' : 'Business memory is paused')
    } catch (err: any) {
      toast.error(err?.message || 'Could not change that')
    } finally {
      setTogglingEnabled(false)
    }
  }

  /* ── Live sample reply ─────────────────────────────────────────────────── */

  const draftSignature = useMemo(() => JSON.stringify({ identity, operations, rules, voice }), [
    identity, operations, rules, voice,
  ])
  const debouncedSignature = useDebounced(draftSignature, 600)
  const firstPreview = useRef(true)

  useEffect(() => {
    if (loading) return
    if (firstPreview.current) { firstPreview.current = false; return }
    let cancelled = false
    ;(async () => {
      try {
        const data = await memoryApi.preview({
          ...identity, ...rules, ...voice,
          operations,
          catalog: (memory?.catalog || []).map((item: CatalogItem) => ({
            kind: item.kind, name: item.name, price: item.price, summary: item.summary, details: item.details,
          })),
        })
        if (cancelled) return
        if (data?.preview) setPreview(data.preview)
        if (data?.completeness) setCompleteness(data.completeness)
      } catch {
        /* The saved state is still shown; a failed preview must not shout. */
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSignature, loading])

  /* ── Catalogue ─────────────────────────────────────────────────────────── */

  const openCatalogAdd = () => {
    setCatalogDraft(emptyItem)
    setCatalogEditing(null)
    setCatalogOpen(true)
  }

  const openCatalogEdit = (item: CatalogItem) => {
    setCatalogDraft({ ...emptyItem, ...item })
    setCatalogEditing(item._id || null)
    setCatalogOpen(true)
  }

  const submitCatalog = async () => {
    if (!catalogDraft.name.trim()) {
      toast.error('Give it a name first — that is what customers ask for')
      return
    }
    setCatalogSaving(true)
    try {
      const payload = {
        kind: catalogDraft.kind,
        name: catalogDraft.name,
        price: catalogDraft.price,
        summary: catalogDraft.summary,
        details: catalogDraft.details,
        available: catalogDraft.available,
      }
      const data = catalogEditing
        ? await memoryApi.updateCatalogItem(catalogEditing, payload)
        : await memoryApi.addCatalogItem(payload)
      applyEnvelope(data)
      setCatalogOpen(false)
      toast.success(catalogEditing ? 'Updated' : 'Added to what you sell')
    } catch (err: any) {
      toast.error(err?.message || 'Could not save that item')
    } finally {
      setCatalogSaving(false)
    }
  }

  const removeCatalog = async (id: string) => {
    try {
      applyEnvelope(await memoryApi.deleteCatalogItem(id))
      toast.success('Removed')
    } catch (err: any) {
      toast.error(err?.message || 'Could not remove that')
    }
  }

  const toggleAvailable = async (item: CatalogItem) => {
    try {
      applyEnvelope(await memoryApi.updateCatalogItem(item._id!, { available: !item.available }))
    } catch (err: any) {
      toast.error(err?.message || 'Could not change availability')
    }
  }

  /* ── Extra facts ───────────────────────────────────────────────────────── */

  const submitEntry = async () => {
    if (!entryDraft.key.trim() || !entryDraft.value.trim()) {
      toast.error('Both a topic and an answer are needed')
      return
    }
    try {
      const data = entryEditing
        ? await memoryApi.updateEntry(entryEditing, entryDraft.key, entryDraft.value, entryDraft.category)
        : await memoryApi.addEntry(entryDraft.key, entryDraft.value, entryDraft.category)
      applyEnvelope(data)
      setEntryModal(null)
      setEntryEditing(null)
      toast.success(entryEditing ? 'Fact updated' : 'Fact added')
    } catch (err: any) {
      toast.error(err?.message || 'Could not save that fact')
    }
  }

  const removeEntry = async (id: string) => {
    try {
      applyEnvelope(await memoryApi.deleteEntry(id))
      toast.success('Removed')
    } catch (err: any) {
      toast.error(err?.message || 'Could not remove that')
    }
  }

  const clearAll = async () => {
    try {
      applyEnvelope(await memoryApi.clear())
      toast.success('Business memory cleared')
      setConfirmClear(false)
    } catch (err: any) {
      toast.error(err?.message || 'Could not clear it')
    }
  }

  /* ── Derived ───────────────────────────────────────────────────────────── */

  const catalog: CatalogItem[] = memory?.catalog || []
  const visibleCatalog = catalogFilter === 'all' ? catalog : catalog.filter((item) => item.kind === catalogFilter)

  const entries = memory?.entries || []
  const visibleEntries = useMemo(() => {
    const query = entryQuery.trim().toLowerCase()
    return entries.filter((entry: any) => {
      if (entryFilter !== 'all' && entry.category !== entryFilter) return false
      if (!query) return true
      return `${entry.key} ${entry.value}`.toLowerCase().includes(query)
    })
  }, [entries, entryFilter, entryQuery])

  const enabled = memory?.enabled !== false
  const score = completeness?.score ?? 0

  if (loading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-28 w-full" />
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="space-y-5">
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
          <Skeleton className="h-72 w-full" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <Card className="p-8 text-center">
        <InlineError>{error}</InlineError>
        <Button className="mx-auto mt-4" onClick={load}>Try again</Button>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <Reveal>
        <Card className="p-5 sm:p-6" gold>
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge tone="gold" icon={<Brain className="h-3 w-3" />}>Business memory</Badge>
                <Badge tone="slate" icon={<Info className="h-3 w-3" />}>Optional</Badge>
                <Badge tone={enabled ? 'green' : 'amber'}>{enabled ? 'In use' : 'Paused'}</Badge>
              </div>
              <SectionHeading
                title="Teach the assistant your business"
                description="These answers are what the assistant, and your WhatsApp auto-reply, use instead of guessing. Fill in as little or as much as you like — every field is optional, and you can pause the whole thing whenever you want."
              />
            </div>

            <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center lg:flex-col lg:items-end">
              <Switch
                checked={enabled}
                disabled={togglingEnabled}
                onChange={toggleEnabled}
                label={enabled ? 'Using this profile' : 'Paused'}
                hint={enabled ? 'Replies are personalised' : 'Replies stay generic'}
              />
              <Button variant="ghost" size="sm" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setConfirmClear(true)}>
                Clear everything
              </Button>
            </div>
          </div>
        </Card>
      </Reveal>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
        {/* ── Left: the questions ──────────────────────────────────────── */}
        <div className="min-w-0 space-y-6">
          {/* 1 · About you */}
          <Reveal>
            <Card className="p-5 sm:p-6">
              <CardHeader
                icon={<Store className="h-4 w-4" />}
                title="About you and your shop"
                description="So the assistant introduces itself as your business, not as a robot."
                action={dirty.identity
                  ? <Button size="sm" icon={<Save className="h-3.5 w-3.5" />} loading={busySection === 'identity'}
                      onClick={() => saveSection('identity', identity)}>Save</Button>
                  : <Badge tone="green" icon={<Check className="h-3 w-3" />}>Saved</Badge>}
              />
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <Field label="Your name" hint="Who customers are talking to">
                  <Input
                    value={identity.ownerName || ''}
                    onChange={(event) => { setIdentity({ ...identity, ownerName: event.target.value }); markDirty('identity') }}
                    placeholder="e.g. Sahadat"
                  />
                </Field>
                <Field label="Your role" hint="Owner, manager, pharmacist…">
                  <Input
                    value={identity.ownerRole || ''}
                    onChange={(event) => { setIdentity({ ...identity, ownerRole: event.target.value }); markDirty('identity') }}
                    placeholder="e.g. Shop owner"
                  />
                </Field>
                <Field label="Business name">
                  <Input
                    value={identity.businessName || ''}
                    onChange={(event) => { setIdentity({ ...identity, businessName: event.target.value }); markDirty('identity') }}
                    placeholder="e.g. Northwind Traders"
                  />
                </Field>
                <Field label="What kind of business" hint="Helps the assistant pick the right words">
                  <Input
                    value={identity.businessType || ''}
                    onChange={(event) => { setIdentity({ ...identity, businessType: event.target.value }); markDirty('identity') }}
                    placeholder="e.g. mobile phone shop"
                  />
                </Field>
                <Field
                  className="sm:col-span-2"
                  label="Tell customers about the shop"
                  hint="Two or three sentences is plenty. Write it the way you would explain it to a new customer."
                >
                  <Textarea
                    rows={4}
                    value={identity.businessDescription || ''}
                    onChange={(event) => { setIdentity({ ...identity, businessDescription: event.target.value }); markDirty('identity') }}
                    placeholder="We sell new and pre-owned phones with warranty, plus accessories and repairs. We have been in Mirpur since 2015."
                  />
                </Field>
              </div>
            </Card>
          </Reveal>

          {/* 2 · What you sell */}
          <Reveal>
            <Card className="p-5 sm:p-6">
              <CardHeader
                icon={<Package className="h-4 w-4" />}
                title="What you sell"
                description="Products, services, packages and prices. The assistant quotes these back instead of inventing anything."
                action={
                  <div className="flex items-center gap-2">
                    <Segmented<'all' | 'product' | 'service'>
                      options={[
                        { id: 'all', label: 'All' },
                        { id: 'product', label: 'Products' },
                        { id: 'service', label: 'Services' },
                      ]}
                      value={catalogFilter}
                      onChange={setCatalogFilter}
                    />
                    <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={openCatalogAdd}>Add</Button>
                  </div>
                }
              />

              {visibleCatalog.length === 0 ? (
                <EmptyState
                  className="mt-5"
                  icon={<Tag className="h-5 w-5" />}
                  title={catalog.length ? 'Nothing in this filter' : 'Nothing listed yet'}
                  description={catalog.length
                    ? 'Switch back to “All” to see everything you listed.'
                    : 'Add the three or four things customers ask about most — a price and one line each is enough.'}
                  action={<Button size="sm" variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} onClick={openCatalogAdd}>Add the first one</Button>}
                />
              ) : (
                <ul className="mt-5 space-y-2">
                  {visibleCatalog.map((item, index) => (
                    <li
                      key={item._id}
                      className="group flex flex-col gap-2 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5 transition-colors hover:border-brand-400/25 animate-fade-up sm:flex-row sm:items-center sm:justify-between"
                      style={{ animationDelay: `${index * 40}ms` }}
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        <span className={cn(
                          'flex h-9 w-9 flex-none items-center justify-center rounded-xl border text-[11px] font-semibold',
                          item.kind === 'service'
                            ? 'border-steel-400/25 bg-steel-400/[0.06] text-steel-200'
                            : 'border-brand-400/25 bg-brand-400/[0.06] text-brand-200'
                        )}>
                          {item.kind === 'service' ? <Sparkles className="h-4 w-4" /> : <Package className="h-4 w-4" />}
                        </span>
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-2 text-[13.5px] font-medium text-dark-100">
                            <span className="break-anywhere">{item.name}</span>
                            {item.price ? (
                              <span className="mono-num rounded-md border border-brand-400/20 bg-brand-400/[0.08] px-1.5 py-0.5 text-[11px] text-brand-200">
                                {item.price}
                              </span>
                            ) : null}
                            {!item.available ? <Badge tone="amber">Unavailable</Badge> : null}
                          </p>
                          {item.summary || item.details ? (
                            <p className="mt-1 break-anywhere text-[12px] leading-relaxed text-dark-500">
                              {item.summary || item.details}
                            </p>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex flex-none items-center gap-1 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                        <Tooltip text={item.available ? 'Mark as unavailable' : 'Mark as available'}>
                          <IconButton label="Toggle availability" onClick={() => toggleAvailable(item)}>
                            {item.available ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                          </IconButton>
                        </Tooltip>
                        <Tooltip text="Edit">
                          <IconButton label="Edit item" onClick={() => openCatalogEdit(item)}>
                            <Edit2 className="h-3.5 w-3.5" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip text="Remove">
                          <IconButton
                            label="Remove item"
                            className="icon-btn-danger"
                            onClick={() => setConfirmDelete({ kind: 'catalog', id: item._id!, label: item.name })}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </IconButton>
                        </Tooltip>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </Reveal>

          {/* 3 · How you run */}
          <Reveal>
            <Card className="p-5 sm:p-6">
              <CardHeader
                icon={<Clock className="h-4 w-4" />}
                title="How you run the shop"
                description="The questions customers ask all day long. Anything left blank, the assistant says it will confirm — it never guesses."
                action={dirty.operations
                  ? <Button size="sm" icon={<Save className="h-3.5 w-3.5" />} loading={busySection === 'operations'}
                      onClick={() => saveSection('operations', { operations })}>Save</Button>
                  : <Badge tone="green" icon={<Check className="h-3 w-3" />}>Saved</Badge>}
              />
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <Field label="Opening hours" hint="Include the day you close">
                  <Input
                    value={operations.openingHours || ''}
                    onChange={(event) => { setOperations({ ...operations, openingHours: event.target.value }); markDirty('operations') }}
                    placeholder="e.g. 10am – 9pm, closed Friday"
                  />
                </Field>
                <Field label="Where you serve" hint="City, area, or “online only”">
                  <Input
                    value={operations.serviceAreas || ''}
                    onChange={(event) => { setOperations({ ...operations, serviceAreas: event.target.value }); markDirty('operations') }}
                    placeholder="e.g. Dhaka and Gazipur"
                  />
                </Field>
                <Field label="Delivery or pickup" hint="Timing, charge, courier">
                  <Input
                    value={operations.delivery || ''}
                    onChange={(event) => { setOperations({ ...operations, delivery: event.target.value }); markDirty('operations') }}
                    placeholder="e.g. Same-day inside Dhaka, ৳60"
                  />
                </Field>
                <Field label="How customers can pay">
                  <Input
                    value={operations.payment || ''}
                    onChange={(event) => { setOperations({ ...operations, payment: event.target.value }); markDirty('operations') }}
                    placeholder="e.g. bKash, Nagad, cash on delivery"
                  />
                </Field>
                <Field label="Address">
                  <Input
                    value={operations.address || ''}
                    onChange={(event) => { setOperations({ ...operations, address: event.target.value }); markDirty('operations') }}
                    placeholder="Shop or office address"
                  />
                </Field>
                <Field label="Phone customers can call">
                  <Input
                    value={operations.phone || ''}
                    onChange={(event) => { setOperations({ ...operations, phone: event.target.value }); markDirty('operations') }}
                    placeholder="e.g. 01711-000000"
                  />
                </Field>
                <Field label="Email">
                  <Input
                    value={operations.email || ''}
                    onChange={(event) => { setOperations({ ...operations, email: event.target.value }); markDirty('operations') }}
                    placeholder="orders@yourshop.com"
                  />
                </Field>
                <Field label="Website">
                  <Input
                    value={operations.website || ''}
                    onChange={(event) => { setOperations({ ...operations, website: event.target.value }); markDirty('operations') }}
                    placeholder="https://yourshop.com"
                  />
                </Field>
                <Field className="sm:col-span-2" label="Booking or order link" hint="Where customers can order or pick a time">
                  <Input
                    value={operations.bookingLink || ''}
                    onChange={(event) => { setOperations({ ...operations, bookingLink: event.target.value }); markDirty('operations') }}
                    placeholder="https://calendly.com/… or a Google Form link"
                  />
                </Field>
              </div>
            </Card>
          </Reveal>

          {/* 4 · Ground rules */}
          <Reveal>
            <Card className="p-5 sm:p-6">
              <CardHeader
                icon={<ShieldAlert className="h-4 w-4" />}
                title="Ground rules"
                description="What the assistant must never promise, and who takes over when a chat needs a human decision."
                action={dirty.rules
                  ? <Button size="sm" icon={<Save className="h-3.5 w-3.5" />} loading={busySection === 'rules'}
                      onClick={() => saveSection('rules', rules)}>Save</Button>
                  : <Badge tone="green" icon={<Check className="h-3 w-3" />}>Saved</Badge>}
              />
              <div className="mt-5 grid gap-4">
                <Field
                  label="Returns, warranty or booking rules"
                  hint="One rule per line works best."
                >
                  <Textarea
                    rows={3}
                    value={rules.policies || ''}
                    onChange={(event) => { setRules({ ...rules, policies: event.target.value }); markDirty('rules') }}
                    placeholder={'7-day replacement on faulty items\nWarranty claims need the original receipt'}
                  />
                </Field>
                <Field
                  label="Things it must never promise"
                  hint="Discounts, free delivery, exact stock, dates you cannot keep — write them here."
                >
                  <Textarea
                    rows={3}
                    value={rules.guardrails || ''}
                    onChange={(event) => { setRules({ ...rules, guardrails: event.target.value }); markDirty('rules') }}
                    placeholder={'Never promise a discount or a price match\nNever confirm stock without asking me first\nNever quote a delivery date for outside Dhaka'}
                  />
                </Field>
                <Field
                  label="Where to hand over a tricky chat"
                  hint="A phone number, a WhatsApp contact or a colleague's name."
                >
                  <Input
                    value={rules.escalationContact || ''}
                    onChange={(event) => { setRules({ ...rules, escalationContact: event.target.value }); markDirty('rules') }}
                    placeholder="e.g. 01711-000000 (ask for Rahat)"
                  />
                </Field>
              </div>
            </Card>
          </Reveal>

          {/* 5 · Voice */}
          <Reveal>
            <Card className="p-5 sm:p-6">
              <CardHeader
                icon={<MessageSquareQuote className="h-4 w-4" />}
                title="How replies should sound"
                description="Tone, length and the words you would use yourself. This is what makes a reply feel like your shop."
                action={dirty.voice
                  ? <Button size="sm" icon={<Save className="h-3.5 w-3.5" />} loading={busySection === 'voice'}
                      onClick={() => saveSection('voice', voice)}>Save</Button>
                  : <Badge tone="green" icon={<Check className="h-3 w-3" />}>Saved</Badge>}
              />
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <Field label="Opening line" hint="How every conversation starts">
                  <Input
                    value={voice.greeting || ''}
                    onChange={(event) => { setVoice({ ...voice, greeting: event.target.value }); markDirty('voice') }}
                    placeholder="Hi! Thanks for messaging Northwind Traders."
                  />
                </Field>
                <Field label="Closing line">
                  <Input
                    value={voice.signoff || ''}
                    onChange={(event) => { setVoice({ ...voice, signoff: event.target.value }); markDirty('voice') }}
                    placeholder="Anything else I can check for you?"
                  />
                </Field>
                <Field label="Tone" hint={TONES.find((tone) => tone.id === voice.tone)?.hint}>
                  <Select
                    value={voice.tone || 'professional'}
                    onChange={(event) => { setVoice({ ...voice, tone: event.target.value }); markDirty('voice') }}
                  >
                    {TONES.map((tone) => <option key={tone.id} value={tone.id}>{tone.label}</option>)}
                  </Select>
                </Field>
                <Field label="Reply length">
                  <Segmented
                    className="w-full"
                    options={REPLY_LENGTHS}
                    value={voice.replyLength || 'balanced'}
                    onChange={(id) => { setVoice({ ...voice, replyLength: id }); markDirty('voice') }}
                  />
                </Field>
                <Field
                  className="sm:col-span-2"
                  label="Language your customers write in"
                  hint="The assistant still switches to match whoever is writing."
                >
                  <Input
                    value={voice.language || ''}
                    onChange={(event) => { setVoice({ ...voice, language: event.target.value }); markDirty('voice') }}
                    placeholder="e.g. Bangla or English"
                  />
                </Field>
              </div>
            </Card>
          </Reveal>

          {/* 6 · Extra facts */}
          <Reveal>
            <Card className="p-5 sm:p-6">
              <CardHeader
                icon={<Lightbulb className="h-4 w-4" />}
                title="Anything else it should know"
                description="Short question-and-answer facts: warranty terms, parking, wholesale minimums, seasonal offers."
                action={<Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => { setEntryDraft({ key: '', value: '', category: 'other' }); setEntryEditing(null); setEntryModal('add') }}>Add fact</Button>}
              />

              {entries.length > 0 ? (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <div className="no-scrollbar -mx-1 flex max-w-full flex-1 gap-1.5 overflow-x-auto px-1 py-1">
                    <button type="button" onClick={() => setEntryFilter('all')} className={cn('chip shrink-0', entryFilter === 'all' && 'chip-active')}>
                      All <span className="mono-num opacity-60">{entries.length}</span>
                    </button>
                    {CATEGORIES.map((category) => {
                      const count = entries.filter((entry: any) => entry.category === category).length
                      if (!count) return null
                      return (
                        <button key={category} type="button" onClick={() => setEntryFilter(category)}
                          className={cn('chip shrink-0 capitalize', entryFilter === category && 'chip-active')}>
                          {category} <span className="mono-num opacity-60">{count}</span>
                        </button>
                      )
                    })}
                  </div>
                  <div className="relative w-full sm:w-56">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-dark-600" aria-hidden />
                    <input
                      className="input-dark pl-9 text-[12.5px]"
                      placeholder="Search facts…"
                      value={entryQuery}
                      onChange={(event) => setEntryQuery(event.target.value)}
                    />
                  </div>
                </div>
              ) : null}

              {visibleEntries.length === 0 ? (
                <EmptyState
                  className="mt-5"
                  icon={<Wand2 className="h-5 w-5" />}
                  title={entries.length ? 'Nothing matches that filter' : 'No extra facts yet'}
                  description={entries.length
                    ? 'Clear the search or pick another category.'
                    : 'Optional. Add the odd detail customers ask about that does not fit anywhere else.'}
                />
              ) : (
                <ul className="mt-4 space-y-2">
                  {visibleEntries.map((entry: any, index: number) => (
                    <li
                      key={entry._id}
                      className="group flex items-start justify-between gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5 animate-fade-up"
                      style={{ animationDelay: `${index * 30}ms` }}
                    >
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-dark-100">
                          <span className="break-anywhere">{entry.key}</span>
                          <Badge tone="slate" className="capitalize">{entry.category}</Badge>
                        </p>
                        <p className="mt-1 break-anywhere text-[12.5px] leading-relaxed text-dark-400">{entry.value}</p>
                        {entry.createdAt ? (
                          <p className="mt-1 text-[11px] text-dark-600">added {relativeTime(entry.createdAt)}</p>
                        ) : null}
                      </div>
                      <div className="flex flex-none items-center gap-1 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                        <IconButton
                          label="Edit fact"
                          onClick={() => {
                            setEntryDraft({ key: entry.key, value: entry.value, category: entry.category })
                            setEntryEditing(entry._id)
                            setEntryModal('edit')
                          }}
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </IconButton>
                        <IconButton
                          label="Delete fact"
                          className="icon-btn-danger"
                          onClick={() => setConfirmDelete({ kind: 'entry', id: entry._id, label: entry.key })}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </IconButton>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </Reveal>
        </div>

        {/* ── Right: how it looks and what is missing ──────────────────── */}
        <div className="space-y-5 lg:sticky lg:top-24 lg:self-start">
          <Reveal delay={80}>
            <Card className="p-5">
              <div className="flex items-center gap-4">
                <ProgressRing value={score} size={92} stroke={8} label={`${score}%`} tone="success" />
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-dark-100">How much it knows</p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-dark-500">
                    <CountUp value={completeness?.filled ?? 0} /> of {completeness?.total ?? 0} answers filled in.
                    Optional — nothing here is required.
                  </p>
                </div>
              </div>

              <ul className="mt-4 space-y-1.5">
                {(completeness?.sections || []).map((section) => {
                  const complete = section.done === section.total
                  return (
                    <li key={section.id} className="flex items-center justify-between gap-3 rounded-xl px-2 py-1.5">
                      <span className="flex min-w-0 items-center gap-2 text-[12.5px]">
                        <span className={cn('dot', complete ? 'dot-live' : 'dot-idle')} aria-hidden />
                        <span className={complete ? 'text-dark-300' : 'text-dark-400'}>{section.label}</span>
                      </span>
                      <span className="mono-num flex-none text-[11px] text-dark-600">{section.done}/{section.total}</span>
                    </li>
                  )
                })}
              </ul>

              {completeness?.sections.some((section) => section.missing.length) ? (
                <div className="mt-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-dark-500">Worth adding</p>
                  <ul className="space-y-1">
                    {completeness.sections.flatMap((section) => section.missing).slice(0, 4).map((item) => (
                      <li key={item} className="flex items-start gap-2 text-[12px] text-dark-400">
                        <ChevronRight className="mt-0.5 h-3 w-3 flex-none text-brand-400" aria-hidden />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="mt-4 flex items-center gap-2 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06] p-3 text-[12px] text-emerald-200">
                  <BadgeCheck className="h-3.5 w-3.5 flex-none" aria-hidden />
                  Your assistant has a complete picture of the business.
                </p>
              )}
            </Card>
          </Reveal>

          <Reveal delay={140}>
            <Card className="p-5">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-[13px] font-semibold text-dark-100">
                  <MessageSquareQuote className="h-4 w-4 text-brand-300" aria-hidden />
                  How a reply will sound
                </p>
                <Badge tone="slate">live</Badge>
              </div>

              {!enabled ? (
                <p className="rounded-2xl border border-amber-400/25 bg-amber-400/[0.07] p-3.5 text-[12.5px] leading-relaxed text-amber-100">
                  Memory is paused, so replies stay generic. Switch it back on to use everything on this page.
                </p>
              ) : preview ? (
                <>
                  <p className="rounded-2xl border border-white/[0.07] bg-black/25 p-3.5 text-[12.5px] leading-relaxed text-dark-200">
                    {preview.text}
                  </p>
                  <div className="mt-3">
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-dark-500">Built from</p>
                    <div className="flex flex-wrap gap-1.5">
                      {preview.grounded.length
                        ? preview.grounded.map((item) => <Badge key={item} tone="green">{item}</Badge>)
                        : <span className="text-[12px] text-dark-600">Nothing yet — this is the generic answer.</span>}
                    </div>
                  </div>
                  {preview.missing.length ? (
                    <div className="mt-3">
                      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-dark-500">Still guessing</p>
                      <div className="flex flex-wrap gap-1.5">
                        {preview.missing.map((item) => <Badge key={item} tone="amber">{item}</Badge>)}
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <Skeleton className="h-24 w-full" />
              )}

              <p className="mt-3 text-[11.5px] leading-relaxed text-dark-600">
                A sample, not a script. The assistant writes its own wording from the same facts.
              </p>
            </Card>
          </Reveal>

          <Reveal delay={200}>
            <Card className="p-5">
              <p className="flex items-center gap-2 text-[13px] font-semibold text-dark-100">
                <CircleDollarSign className="h-4 w-4 text-brand-300" aria-hidden />
                Why this pays off
              </p>
              <ul className="mt-3 space-y-2.5">
                {[
                  { icon: Clock, text: '“When are you open?” and “how much is it?” get answered instantly, at midnight too.' },
                  { icon: Truck, text: 'Delivery, payment and area questions stop reaching your phone personally.' },
                  { icon: ShieldAlert, text: 'A price the assistant never invents is a customer who does not feel cheated.' },
                ].map(({ icon: Icon, text }) => (
                  <li key={text} className="flex items-start gap-2.5 text-[12px] leading-relaxed text-dark-400">
                    <span className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-brand-300">
                      <Icon className="h-3 w-3" aria-hidden />
                    </span>
                    {text}
                  </li>
                ))}
              </ul>
              <p className="mt-4 border-t border-white/[0.06] pt-3 text-[11.5px] leading-relaxed text-dark-600">
                Only your account can see this. It is used to write replies and nothing else.
              </p>
            </Card>
          </Reveal>
        </div>
      </div>

      {/* ── Add / edit a product or service ─────────────────────────────── */}
      <Modal
        open={catalogOpen}
        onClose={() => setCatalogOpen(false)}
        title={catalogEditing ? 'Edit what you sell' : 'Add a product or service'}
        description="Customers ask about this by name, so keep it short and factual."
        footer={
          <>
            <Button variant="ghost" onClick={() => setCatalogOpen(false)}>Cancel</Button>
            <Button icon={<Save className="h-3.5 w-3.5" />} loading={catalogSaving} onClick={submitCatalog}>
              {catalogEditing ? 'Save changes' : 'Add it'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Is it a product or a service?">
            <Segmented
              className="w-full"
              options={[{ id: 'product', label: 'Product' }, { id: 'service', label: 'Service' }]}
              value={catalogDraft.kind}
              onChange={(id) => setCatalogDraft({ ...catalogDraft, kind: id as 'product' | 'service' })}
            />
          </Field>
          <Field label="Name" required>
            <Input
              autoFocus
              value={catalogDraft.name}
              onChange={(event) => setCatalogDraft({ ...catalogDraft, name: event.target.value })}
              placeholder="e.g. Redmi Note 13, or screen replacement"
            />
          </Field>
          <Field label="Price" hint="Write it however you say it out loud — “from ৳3,500”, “৳24,999”, “ask for a quote”">
            <Input
              value={catalogDraft.price}
              onChange={(event) => setCatalogDraft({ ...catalogDraft, price: event.target.value })}
              placeholder="e.g. BDT 24,999"
            />
          </Field>
          <Field label="One-line summary" hint="What the assistant can say about it in a sentence">
            <Input
              value={catalogDraft.summary}
              onChange={(event) => setCatalogDraft({ ...catalogDraft, summary: event.target.value })}
              placeholder="e.g. 6GB/128GB with a 1-year warranty"
            />
          </Field>
          <Field label="Full detail" hint="Everything the assistant is allowed to quote: sizes, colours, what is included, what is not.">
            <Textarea
              rows={5}
              value={catalogDraft.details}
              onChange={(event) => setCatalogDraft({ ...catalogDraft, details: event.target.value })}
              placeholder="Comes with charger and case. Available in blue and black. Warranty handled at our shop counter."
            />
          </Field>
          <Switch
            checked={catalogDraft.available}
            onChange={(next) => setCatalogDraft({ ...catalogDraft, available: next })}
            label="Currently available"
            hint="Turn this off for anything you are out of stock on"
          />
        </div>
      </Modal>

      {/* ── Add / edit an extra fact ────────────────────────────────────── */}
      <Modal
        open={entryModal !== null}
        onClose={() => { setEntryModal(null); setEntryEditing(null) }}
        title={entryEditing ? 'Edit fact' : 'Add a fact'}
        description="A short topic and the exact answer you want given."
        footer={
          <>
            <Button variant="ghost" onClick={() => { setEntryModal(null); setEntryEditing(null) }}>Cancel</Button>
            <Button icon={<Save className="h-3.5 w-3.5" />} onClick={submitEntry}>{entryEditing ? 'Save changes' : 'Add fact'}</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Topic" required>
            <Input
              autoFocus
              value={entryDraft.key}
              onChange={(event) => setEntryDraft({ ...entryDraft, key: event.target.value })}
              placeholder="e.g. Wholesale orders"
            />
          </Field>
          <Field label="What should it say?" required>
            <Textarea
              rows={4}
              value={entryDraft.value}
              onChange={(event) => setEntryDraft({ ...entryDraft, value: event.target.value })}
              placeholder="Minimum order is 10 pieces, delivered within 3 days in Dhaka."
            />
          </Field>
          <Field label="Group" hint="Only used to keep this list tidy">
            <Select
              value={entryDraft.category}
              onChange={(event) => setEntryDraft({ ...entryDraft, category: event.target.value })}
            >
              {CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
            </Select>
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={clearAll}
        title="Clear the whole business profile?"
        description="Everything you have written — products, hours, rules, facts — is removed and replies go back to the generic assistant. This cannot be undone."
        confirmLabel="Clear everything"
      />

      <ConfirmDialog
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        onConfirm={async () => {
          if (!confirmDelete) return
          if (confirmDelete.kind === 'entry') await removeEntry(confirmDelete.id)
          else await removeCatalog(confirmDelete.id)
          setConfirmDelete(null)
        }}
        title={`Remove ${confirmDelete?.label ?? 'this'}?`}
        description={confirmDelete?.kind === 'entry'
          ? 'The assistant will stop answering from this fact.'
          : 'It will no longer be mentioned in any reply.'}
        confirmLabel="Remove"
      />
    </div>
  )
}
