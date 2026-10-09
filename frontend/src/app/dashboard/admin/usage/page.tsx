'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity, BarChart3, ChevronDown, MessageSquare, Plug, RefreshCw, Search, Send,
  Smartphone, Users, Zap,
} from 'lucide-react'
import { adminApi } from '@/lib/api'
import { cn } from '@/lib/cn'
import { compactNumber, percent, relativeTime } from '@/lib/format'
import {
  Avatar, Badge, Button, Card, CardHeader, EmptyState, InlineError, Meter,
  SectionHeading, Skeleton, Tooltip,
} from '@/components/ui/primitives'
import { Input } from '@/components/ui/Field'

/* ══════════════════════════════════════════════════════════════════════════
   Usage by account.

   The question this screen answers is "who is actually being answered, and is
   anyone running out of room?" — every column comes from a counter the running
   service already keeps (sessions, messages received/sent, channel replies and
   posts, tokens), so it stays meaningful as conversations grow instead of
   recounting message arrays on every load.

   Plan headroom is shown next to the numbers, because "2 of 1 numbers used" is
   the fact an owner will ask about; the plan limits themselves are edited on the
   Controls screen.
   ══════════════════════════════════════════════════════════════════════════ */

type SortKey = 'activity' | 'messages' | 'tokens' | 'newest'

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'activity', label: 'Most active' },
  { key: 'messages', label: 'Most messages' },
  { key: 'tokens', label: 'Closest to quota' },
  { key: 'newest', label: 'Newest accounts' },
]

interface UsageRow {
  id: string
  name: string
  email: string
  role: string
  active: boolean
  tier: string
  createdAt?: string
  lastSeen?: string
  whatsapp: {
    sessions: number; connected: number; live: number; queued: number; queuePosition: number | null
    received: number; sent: number; lastActiveAt?: string | null; limit: number; left: number
  }
  channels: {
    total: number; connected: number; replies: number; repliesToday: number
    waiting: number; posts: number; lastInboundAt?: string | null; limit: number; left: number
  }
  tokens: { used: number; limit: number; percent: number }
}

export default function AdminUsagePage() {
  const [rows, setRows] = useState<UsageRow[]>([])
  const [totals, setTotals] = useState<any>(null)
  const [queue, setQueue] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('activity')

  const load = useCallback(async () => {
    setError('')
    try {
      const d: any = await adminApi.getUsage(200)
      setRows(d.rows || [])
      setTotals(d.totals || null)
      setQueue(d.queue || [])
    } catch (err: any) {
      setError(err.message || 'Could not load usage')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const filtered = needle
      ? rows.filter((r) => `${r.name} ${r.email} ${r.tier}`.toLowerCase().includes(needle))
      : rows
    const sorted = [...filtered]
    sorted.sort((a, b) => {
      if (sort === 'messages') {
        return (b.whatsapp.received + b.channels.replies) - (a.whatsapp.received + a.channels.replies)
      }
      if (sort === 'tokens') return b.tokens.percent - a.tokens.percent
      if (sort === 'newest') return String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
      // "Most active" — a live browser, then this week's traffic, then last seen.
      const liveDiff = (b.whatsapp.live + b.whatsapp.queued) - (a.whatsapp.live + a.whatsapp.queued)
      if (liveDiff) return liveDiff
      const traffic = (b.whatsapp.received + b.whatsapp.sent + b.channels.replies) - (a.whatsapp.received + a.whatsapp.sent + a.channels.replies)
      if (traffic) return traffic
      return String(b.lastSeen || '').localeCompare(String(a.lastSeen || ''))
    })
    return sorted
  }, [rows, search, sort])

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-24" />
        <Skeleton className="h-96" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Admin"
        title="Usage by account"
        description="What the running system is actually doing for each owner — sessions, messages answered, posts published, and how much of their plan is used."
        action={
          <Button variant="ghost" size="sm" onClick={() => void load()}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Refresh
          </Button>
        }
      />

      <InlineError>{error}</InlineError>

      {/* ── Totals ────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ['Accounts', totals?.accounts, Users],
          ['WhatsApp numbers', totals?.whatsappSessions, Smartphone],
          ['Live browsers', `${totals?.whatsappLive ?? 0}/${totals?.ceiling ?? 0}`, Activity],
          ['Messages in', compactNumber(totals?.received || 0), MessageSquare],
          ['Replies sent', compactNumber((totals?.sent || 0) + (totals?.channelReplies || 0)), Send],
          ['Scheduled posts', totals?.posts, BarChart3],
        ].map(([label, value, Icon]: any) => (
          <div key={label} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3">
            <Icon className="h-3.5 w-3.5 text-dark-500" aria-hidden />
            <p className="mt-1 text-xl font-semibold text-white">{value ?? 0}</p>
            <p className="text-[10.5px] uppercase tracking-wide text-dark-500">{label}</p>
          </div>
        ))}
      </div>

      {queue.length ? (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-400/25 bg-amber-400/[0.06] px-4 py-3">
          <Zap className="mt-0.5 h-4 w-4 flex-none text-amber-300" aria-hidden />
          <p className="text-[12px] leading-relaxed text-amber-100/90">
            {queue.length} session{queue.length === 1 ? '' : 's'} waiting for a free browser slot
            (the host limit is {totals?.ceiling}). They start on their own, oldest request first, as
            soon as a slot frees — nobody has to ask again.
          </p>
        </div>
      ) : null}

      {/* ── Controls over the table ───────────────────────────────────────── */}
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-white/[0.06] px-4 py-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-dark-500" aria-hidden />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email or plan…"
              className="pl-9"
              aria-label="Search accounts"
            />
          </div>
          <div className="relative">
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="input appearance-none pr-9 text-[12.5px]"
              aria-label="Sort accounts"
            >
              {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-dark-500" aria-hidden />
          </div>
          <Badge tone="steel">{visible.length} shown</Badge>
        </div>

        {visible.length === 0 ? (
          <EmptyState
            icon={<Users className="h-5 w-5" />}
            title={search ? 'No account matches that search' : 'No accounts yet'}
            description={search ? 'Try a shorter search, or clear it to see everyone.' : 'Accounts appear here with whatever they connect.'}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-[12.5px]">
              <thead>
                <tr className="text-[10.5px] uppercase tracking-wide text-dark-500">
                  <th className="px-4 py-2.5 font-semibold">Account</th>
                  <th className="px-4 py-2.5 font-semibold">Plan</th>
                  <th className="px-4 py-2.5 font-semibold">WhatsApp</th>
                  <th className="px-4 py-2.5 font-semibold">Messages</th>
                  <th className="px-4 py-2.5 font-semibold">Channels</th>
                  <th className="px-4 py-2.5 font-semibold">Tokens this week</th>
                  <th className="px-4 py-2.5 font-semibold">Room left</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.id} className="border-t border-white/[0.06] align-top">
                    <td className="px-4 py-3">
                      <div className="flex items-start gap-2.5">
                        <Avatar name={row.name || row.email} size="sm" />
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 truncate font-medium text-dark-100">
                            {row.name || '—'}
                            {!row.active ? <Badge tone="red">suspended</Badge> : null}
                          </p>
                          <p className="truncate text-[11px] text-dark-500">{row.email}</p>
                          <p className="mt-0.5 text-[10.5px] text-dark-600">
                            {row.lastSeen ? `seen ${relativeTime(row.lastSeen)}` : `joined ${relativeTime(row.createdAt)}`}
                          </p>
                        </div>
                      </div>
                    </td>

                    <td className="px-4 py-3">
                      <Badge tone={row.tier === 'enterprise' ? 'amber' : row.tier === 'pro' ? 'gold' : 'steel'}>
                        {row.tier}
                      </Badge>
                    </td>

                    <td className="px-4 py-3">
                      <p className="text-dark-100">
                        {row.whatsapp.sessions}<span className="text-dark-500">/{row.whatsapp.limit || '∞'} numbers</span>
                      </p>
                      <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-dark-500">
                        {row.whatsapp.live > 0
                          ? <Badge tone="green">{row.whatsapp.live} live</Badge>
                          : <span>no browser running</span>}
                        {row.whatsapp.queued > 0
                          ? <Badge tone="amber">queued #{row.whatsapp.queuePosition}</Badge>
                          : null}
                      </p>
                    </td>

                    <td className="px-4 py-3">
                      <p className="text-dark-100">{compactNumber(row.whatsapp.received)} in · {compactNumber(row.whatsapp.sent)} out</p>
                      <p className="mt-1 text-[11px] text-dark-500">
                        {row.whatsapp.lastActiveAt ? `last traffic ${relativeTime(row.whatsapp.lastActiveAt)}` : 'no traffic yet'}
                      </p>
                    </td>

                    <td className="px-4 py-3">
                      <p className="text-dark-100">
                        {row.channels.total}<span className="text-dark-500">/{row.channels.limit || '∞'} connected</span>
                      </p>
                      <p className="mt-1 text-[11px] text-dark-500">
                        {row.channels.replies} replies ({row.channels.repliesToday} today) · {row.channels.posts} posts
                      </p>
                      {row.channels.waiting > 0 ? (
                        <Tooltip text="Messages arrived but no automatic reply was sent — usually no model available">
                          <span className="mt-1 block text-[11px] text-amber-300/90">{row.channels.waiting} waiting for a reply</span>
                        </Tooltip>
                      ) : null}
                    </td>

                    <td className="px-4 py-3">
                      <p className="text-dark-100">{compactNumber(row.tokens.used)}<span className="text-dark-500"> of {compactNumber(row.tokens.limit)}</span></p>
                      <div className="mt-1.5 w-32">
                        <Meter value={percent(row.tokens.used, row.tokens.limit)} tone={row.tokens.percent >= 90 ? 'danger' : row.tokens.percent >= 60 ? 'warn' : 'gold'} />
                      </div>
                      <p className="mt-1 text-[10.5px] text-dark-500">{row.tokens.percent}% of quota</p>
                    </td>

                    <td className="px-4 py-3">
                      <p className={cn('text-[11.5px]', row.whatsapp.left === 0 ? 'text-amber-300' : 'text-dark-300')}>
                        {row.whatsapp.left} number{row.whatsapp.left === 1 ? '' : 's'} left
                      </p>
                      <p className={cn('text-[11.5px]', row.channels.left === 0 ? 'text-amber-300' : 'text-dark-300')}>
                        {row.channels.left} channel{row.channels.left === 1 ? '' : 's'} left
                      </p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          icon={<Activity className="h-4 w-4" />}
          title="How to read this"
          description="Messages in/out are the WhatsApp counters. Channel replies and posts are the assistant's own receipts, including failures it recorded. A browser that is not running still holds messages until its owner reconnects."
        />
        <p className="mt-3 text-[11.5px] leading-relaxed text-dark-500">
          Change any plan limit on the Controls screen; accounts over a limit keep what they have and simply
          cannot add more. The host limit ({totals?.ceiling ?? 0} browsers) is a RAM guard — raise it from
          Controls if you add memory.
        </p>
      </Card>
    </div>
  )
}
