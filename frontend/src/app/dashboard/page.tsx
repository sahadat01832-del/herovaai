'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  ArrowUpRight, Bot, Brain, Check, CheckCircle2, Cpu, KeyRound, MessageSquare, Plus,
  Server, Smartphone, Sparkles, TrendingUp, Users, Zap,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { adminApi, authApi, chatApi, memoryApi, whatsappApi } from '@/lib/api'
import { cn } from '@/lib/cn'
import { compactNumber, percent, relativeTime } from '@/lib/format'
import { Badge, Button, Card, CardHeader, EmptyState, Meter, Skeleton, StatusDot } from '@/components/ui/primitives'
import { CountUp, ProgressRing, Reveal } from '@/components/ui/Reveal'

/* ══════════════════════════════════════════════════════════════════════════
   Dashboard home.

   Four questions in order: is the system healthy, how much quota is left,
   what can I start right now, and what happened recently. Numbers count up on
   arrival, the quota arc draws itself, and every panel is a link to the screen
   that owns the data.
   ══════════════════════════════════════════════════════════════════════════ */

interface Stats {
  totalUsers: number
  totalConvos: number
  totalWaSessions: number
  activeWaSessions: number
}

const QUICK_ACTIONS = [
  { href: '/dashboard/chat',         icon: MessageSquare, title: 'New chat',      desc: 'Ask a question or draft a customer reply' },
  { href: '/dashboard/whatsapp',     icon: Smartphone,    title: 'WhatsApp',      desc: 'Pair a number and reply automatically' },
  { href: '/dashboard/memory',       icon: Brain,         title: 'Business memory', desc: 'Your products, prices, hours and rules' },
  { href: '/dashboard/settings?tab=keys', icon: KeyRound, title: 'API keys',      desc: 'Agent key and provider vault' },
]

function greeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export default function DashboardPage() {
  const { user, isAdmin } = useAuth()
  const [stats, setStats] = useState<Stats | null>(null)
  const [recentChats, setRecentChats] = useState<any[]>([])
  const [statsLoading, setStatsLoading] = useState(false)
  const [quota, setQuota] = useState<any>(null)
  const [localModel, setLocalModel] = useState<any>(null)
  const [vault, setVault] = useState<any>(null)

  // The setup checklist is driven by real state, not by a static list of tips:
  // it disappears on its own once the shop is actually set up.
  const [setup, setSetup] = useState<{
    memoryScore: number
    memoryFilled: number
    memoryTotal: number
    memoryEnabled: boolean
    whatsappConnected: number
    googleReady: boolean
  } | null>(null)

  useEffect(() => {
    if (isAdmin) {
      setStatsLoading(true)
      Promise.all([adminApi.getStats(), adminApi.getApiKeys().catch(() => null)])
        .then(([statsRes, vaultRes]: any[]) => {
          setStats(statsRes.stats)
          setRecentChats(statsRes.recentChats || [])
          if (vaultRes?.summary) setVault(vaultRes.summary)
        })
        .catch(() => setStats(null))
        .finally(() => setStatsLoading(false))
    }
    chatApi.getQuota().then((d: any) => setQuota(d.quota)).catch(() => {})
    chatApi.getLmStatus().then((d: any) => setLocalModel(d)).catch(() => {})

    Promise.all([
      memoryApi.get().catch(() => null),
      whatsappApi.getSessions().catch(() => null),
      authApi.googleStatus().catch(() => null),
    ]).then(([memory, sessions, google]: any[]) => {
      const connected = (sessions?.sessions || []).filter(
        (session: any) => session.status === 'connected' || session.status === 'active'
      ).length
      setSetup({
        memoryScore: memory?.completeness?.score ?? 0,
        memoryFilled: memory?.completeness?.filled ?? 0,
        memoryTotal: memory?.completeness?.total ?? 0,
        memoryEnabled: memory?.memory?.enabled !== false,
        whatsappConnected: connected,
        googleReady: Boolean(google?.configured),
      })
    })
  }, [isAdmin])

  const used = quota?.tokensUsed7d ?? user?.tokenQuota?.tokensUsed7d ?? 0
  const limit = quota?.weeklyLimit ?? user?.tokenQuota?.weeklyLimit ?? 1_000_000
  const daysLeft = quota?.daysLeft ?? 7
  const usedPct = percent(used, limit)

  const localReady = Boolean(localModel?.running || localModel?.serverRunning || localModel?.ok)
  const agentKeySet = Boolean(user?.hasContentbotApiKey)
  const providerCount = vault ? `${vault.providersConfigured}/${vault.providersTotal}` : null

  return (
    <div className="space-y-5">
      {/* Hero */}
      <Reveal>
        <div className="card relative overflow-hidden p-5 sm:p-6">
          <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-brand-500/[0.09] blur-3xl animate-aurora" />
          <div className="relative flex flex-wrap items-start justify-between gap-5">
            <div className="min-w-0">
              <p className="text-[10.5px] font-bold uppercase tracking-[0.22em] text-brand-400/80">
                {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
              </p>
              <h1 className="mt-1.5 text-[24px] font-semibold tracking-tight text-white sm:text-[27px]">
                {greeting()}, {user?.name?.split(' ')[0] || 'there'}
              </h1>
              <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-dark-400">
                {isAdmin
                  ? 'Here is the state of the platform — accounts, conversations, WhatsApp sessions and the keys behind every model.'
                  : 'Your assistant is ready. Start a chat, check your quota, or make it sound more like your business.'}
              </p>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Link href="/dashboard/chat" className="btn-primary btn-sm btn-sheen">
                  <Plus className="h-3.5 w-3.5" />
                  Start a chat
                </Link>
                <Link href="/dashboard/memory" className="btn-ghost btn-sm">
                  <Sparkles className="h-3.5 w-3.5" />
                  Teach it your business
                </Link>
              </div>
            </div>

            {/* Quota ring */}
            <div className="flex items-center gap-5">
              <ProgressRing
                value={usedPct}
                size={124}
                label={<span className="text-[19px] font-semibold text-white mono-num">{usedPct}%</span>}
                sublabel="of weekly quota"
              />
              <div className="hidden text-[12px] leading-relaxed text-dark-400 sm:block">
                <p className="mono-num text-[15px] font-semibold text-white">{compactNumber(used)}</p>
                <p className="text-dark-500">of {compactNumber(limit)} tokens</p>
                <p className="mt-2 flex items-center gap-1.5 text-dark-400">
                  <Zap className="h-3 w-3 text-brand-300" aria-hidden />
                  resets in {daysLeft} day{daysLeft === 1 ? '' : 's'}
                </p>
                <Link href="/dashboard/subscription" className="mt-2 inline-flex items-center gap-1 text-brand-300/90 hover:text-brand-200">
                  Manage plan <ArrowUpRight className="h-3 w-3" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </Reveal>

      {/* KPIs (admin) */}
      {isAdmin ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {statsLoading && !stats ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[92px] rounded-2xl" />)
          ) : (
            <>
              <KpiCard
                icon={<Users className="h-4 w-4" />}
                label="Accounts"
                value={stats?.totalUsers || 0}
                href="/dashboard/admin/users"
                delay={0}
              />
              <KpiCard
                icon={<MessageSquare className="h-4 w-4" />}
                label="Conversations"
                value={stats?.totalConvos || 0}
                href="/dashboard/admin/chats"
                delay={60}
              />
              <KpiCard
                icon={<Smartphone className="h-4 w-4" />}
                label="WhatsApp sessions"
                value={stats?.totalWaSessions || 0}
                href="/dashboard/whatsapp"
                delay={120}
              />
              <KpiCard
                icon={<TrendingUp className="h-4 w-4" />}
                label="Live sessions"
                value={stats?.activeWaSessions || 0}
                tone="live"
                href="/dashboard/whatsapp"
                delay={180}
              />
            </>
          )}
        </div>
      ) : null}

      {/* Setup checklist — real state, so it retires itself when the shop is ready */}
      {setup ? (() => {
        const items = [
          {
            key: 'memory',
            done: setup.memoryScore >= 70,
            title: setup.memoryFilled === 0
              ? 'Tell the assistant about your shop'
              : setup.memoryScore >= 70
                ? 'Your assistant knows your business'
                : 'Finish your business profile',
            desc: setup.memoryFilled === 0
              ? 'Products, prices, opening hours and the rules it must never break — two minutes now saves hundreds of replies.'
              : `${setup.memoryFilled} of ${setup.memoryTotal} answers filled in. Each one is a question it stops asking you.`,
            href: '/dashboard/memory',
            cta: setup.memoryFilled === 0 ? 'Start the profile' : 'Continue',
          },
          {
            key: 'whatsapp',
            done: setup.whatsappConnected > 0,
            title: setup.whatsappConnected > 0 ? 'WhatsApp is answering customers' : 'Connect WhatsApp',
            desc: setup.whatsappConnected > 0
              ? `${setup.whatsappConnected} number${setup.whatsappConnected === 1 ? '' : 's'} paired and replying from your business memory.`
              : 'Pair a number once and the assistant replies to customers while you are serving someone else.',
            href: '/dashboard/whatsapp',
            cta: setup.whatsappConnected > 0 ? 'Open threads' : 'Pair a number',
          },
          ...(isAdmin
            ? [{
                key: 'google',
                done: setup.googleReady,
                title: setup.googleReady ? 'Staff can sign in with Google' : 'Switch on Google sign-in',
                desc: setup.googleReady
                  ? 'Your team signs in with the Google account they already have.'
                  : 'Five short steps in Settings → Security — no password to share or reset afterwards.',
                href: '/dashboard/settings?tab=security',
                cta: setup.googleReady ? 'Review' : 'Set it up',
              }]
            : []),
        ]
        const remaining = items.filter(item => !item.done)
        if (remaining.length === 0) return null

        return (
          <Reveal delay={40}>
            <Card>
              <CardHeader
                icon={<Sparkles className="h-4 w-4" />}
                title="Get set up"
                description={`${items.length} step${items.length === 1 ? '' : 's'} and the assistant runs on its own.`}
                action={                <Badge tone="gold">{items.length - remaining.length}/{items.length} done</Badge>}
              />
              <ul className="mt-4 grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
                {items.map(item => (
                  <li key={item.key}>
                    <Link
                      href={item.href}
                      className={cn(
                        'group flex h-full items-start gap-3 rounded-2xl border p-3.5 transition-colors',
                        item.done
                          ? 'border-white/[0.06] bg-white/[0.02]'
                          : 'border-brand-400/25 bg-brand-400/[0.05] hover:border-brand-400/45'
                      )}
                    >
                      <span className={cn(
                        'mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-lg border',
                        item.done
                          ? 'border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-300'
                          : 'border-brand-400/30 bg-brand-400/[0.1] text-brand-200'
                      )}>
                        {item.done
                          ? <Check className="h-3.5 w-3.5" aria-hidden />
                          : <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[12.5px] font-semibold text-dark-100">{item.title}</span>
                        <span className="mt-0.5 block text-[11.5px] leading-relaxed text-dark-500">{item.desc}</span>
                        {!item.done ? (
                          <span className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-medium text-brand-300">
                            {item.cta}
                          </span>
                        ) : null}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          </Reveal>
        )
      })() : null}

      {/* Quick actions */}
      <Reveal delay={80}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {QUICK_ACTIONS.map(({ href, icon: Icon, title, desc }) => (
            <Link key={href} href={href} className="card card-interactive group flex items-center gap-4 p-4">
              <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 text-dark-950 shadow-gold-sm">
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[13.5px] font-semibold text-white">
                  {title}
                  <ArrowUpRight className="h-3.5 w-3.5 text-dark-500 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />
                </span>
                <span className="mt-0.5 block truncate text-[12px] text-dark-400">{desc}</span>
              </span>
            </Link>
          ))}
        </div>
      </Reveal>

      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        {/* Recent conversations */}
        {isAdmin ? (
          <Reveal>
            <Card padded={false} className="h-full">
              <div className="px-5 pt-5">
                <CardHeader
                  icon={<MessageSquare className="h-4 w-4" />}
                  title="Recent conversations"
                  description="Across every account and the public page."
                  action={
                    <Link href="/dashboard/admin/chats" className="btn-ghost btn-sm">View all</Link>
                  }
                />
              </div>

              {statsLoading && recentChats.length === 0 ? (
                <div className="space-y-2 p-5">
                  {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-11 w-full" />)}
                </div>
              ) : recentChats.length === 0 ? (
                <EmptyState
                  icon={<Bot className="h-5 w-5" />}
                  title="No conversations yet"
                  description="Chats from the public page and from every workspace appear here as soon as they happen."
                  action={<Link href="/dashboard/chat" className="btn-ghost btn-sm">Start the first one</Link>}
                />
              ) : (
                <ul className="mt-3 divide-y divide-white/[0.04]">
                  {recentChats.slice(0, 7).map((chat: any) => (
                    <li key={chat._id} className="table-row flex items-center justify-between gap-4 px-5 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-brand-500/15 text-[11.5px] font-semibold text-brand-100">
                          {chat.userId?.name?.[0]?.toUpperCase() || '?'}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-[13px] text-dark-100">{chat.title || 'Untitled chat'}</p>
                          <p className="truncate text-[11.5px] text-dark-500">
                            {chat.userId?.name || 'Guest'} · {chat.mode || 'chat'}
                          </p>
                        </div>
                      </div>
                      <time className="flex-none text-[11.5px] text-dark-500" title={chat.updatedAt ? new Date(chat.updatedAt).toLocaleString() : undefined}>
                        {relativeTime(chat.updatedAt)}
                      </time>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </Reveal>
        ) : setup && setup.memoryScore < 70 ? (
          // While the owner still has setup to do, the checklist above already says
          // what to do next. A second list of the same advice would just be noise.
          <Reveal>
            <Card className="h-full">
              <CardHeader
                icon={<Sparkles className="h-4 w-4" />}
                title="What happens next"
                description="How your assistant starts answering on its own."
              />
              <ul className="mt-4 space-y-3">
                {[
                  { title: 'You fill in the profile', desc: 'Products, prices, opening hours and the rules it must keep.', href: '/dashboard/memory' },
                  { title: 'It answers with your facts', desc: 'No invented prices. Anything it does not know, it says it will confirm.', href: '/dashboard/memory' },
                  { title: 'WhatsApp runs itself', desc: 'Pair a number and it takes the day-long questions off your phone.', href: '/dashboard/whatsapp' },
                ].map(item => (
                  <li key={item.title}>
                    <Link href={item.href} className="group flex items-start gap-3 rounded-xl border border-white/[0.05] bg-white/[0.02] p-3 transition-colors hover:border-brand-400/25">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-brand-300" aria-hidden />
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-dark-100">
                          {item.title}
                          <ArrowUpRight className="h-3 w-3 text-dark-600 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />
                        </span>
                        <span className="mt-0.5 block text-[11.5px] leading-relaxed text-dark-500">{item.desc}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          </Reveal>
        ) : (
          <Reveal>
            <Card className="h-full">
              <CardHeader
                icon={<Sparkles className="h-4 w-4" />}
                title="Getting the most out of HerovaAi"
                description="Three steps that make replies noticeably better."
              />
              <ul className="mt-4 space-y-3">
                {[
                  { title: 'Fill in your business memory', desc: 'Name, industry and tone are injected into every reply.', href: '/dashboard/memory' },
                  { title: 'Connect WhatsApp', desc: 'Pair once, then the assistant answers while you are away.', href: '/dashboard/whatsapp' },
                  { title: 'Review your quota', desc: 'Local models are free; cloud models draw on the weekly allowance.', href: '/dashboard/subscription' },
                ].map(item => (
                  <li key={item.title}>
                    <Link href={item.href} className="group flex items-start gap-3 rounded-xl border border-white/[0.05] bg-white/[0.02] p-3 transition-colors hover:border-brand-400/25">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-brand-300" aria-hidden />
                      <span className="min-w-0">
                        <span className="block text-[12.5px] font-medium text-dark-100">{item.title}</span>
                        <span className="mt-0.5 block text-[11.5px] leading-relaxed text-dark-500">{item.desc}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          </Reveal>
        )}

        {/* System status */}
        <Reveal delay={80}>
          <Card className="h-full">
            <CardHeader
              icon={<Server className="h-4 w-4" />}
              title="System status"
              description="Live from this deployment."
            />
            <ul className="mt-4 space-y-2.5">
              <StatusRow
                label="API backend"
                tone="live"
                value="reachable"
              />
              <StatusRow
                label="Local model server"
                tone={localReady ? 'live' : 'idle'}
                value={localReady ? 'ready' : 'idle'}
                hint={localReady ? undefined : 'starts on demand in Chat'}
              />
              {setup ? (
                <StatusRow
                  label="Google sign-in"
                  tone={setup.googleReady ? 'live' : 'idle'}
                  value={setup.googleReady ? 'ready' : 'not set up'}
                  hint={setup.googleReady ? undefined : 'Settings → Security'}
                />
              ) : null}
              <StatusRow
                label="Agent platform key"
                tone={agentKeySet ? 'live' : 'warn'}
                value={agentKeySet ? user?.contentbotApiKeyMasked || 'set' : 'not set'}
                hint={agentKeySet ? undefined : 'add it in Settings → API keys'}
              />
              {providerCount ? (
                <StatusRow
                  label="Cloud providers"
                  tone={vault?.failingKeys ? 'warn' : 'live'}
                  value={`${providerCount} configured`}
                  hint={vault?.failingKeys ? `${vault.failingKeys} key(s) rejected by their provider` : undefined}
                />
              ) : null}
            </ul>

            {isAdmin ? (
              <Link href="/dashboard/admin/api-keys" className="mt-4 flex items-center justify-between gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-[12.5px] text-dark-300 transition-colors hover:border-brand-400/25 hover:text-white">
                <span className="flex items-center gap-2">
                  <KeyRound className="h-3.5 w-3.5 text-brand-300" aria-hidden />
                  Open the key vault
                </span>
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            ) : null}

            <div className="mt-4 border-t border-white/[0.06] pt-4">
              <div className="flex items-center justify-between text-[12px]">
                <span className="flex items-center gap-2 text-dark-400">
                  <Cpu className="h-3.5 w-3.5 text-dark-500" aria-hidden />
                  Weekly quota
                </span>
                <span className="mono-num text-dark-200">{usedPct}%</span>
              </div>
              <Meter className="mt-2" value={usedPct} tone={usedPct > 85 ? 'danger' : usedPct > 60 ? 'warn' : 'gold'} />
            </div>
          </Card>
        </Reveal>
      </div>
    </div>
  )
}

/* ─── Bits ──────────────────────────────────────────────────────────────── */

function KpiCard({ icon, label, value, href, tone = 'default', delay = 0 }: {
  icon: React.ReactNode
  label: string
  value: number
  href: string
  tone?: 'default' | 'live'
  delay?: number
}) {
  return (
    <Reveal delay={delay}>
      <Link href={href} className="card card-interactive flex items-start justify-between gap-3 p-4">
        <span className="min-w-0">
          <span className="block truncate text-[10.5px] font-semibold uppercase tracking-wider text-dark-500">{label}</span>
          <span className="mono-num mt-1.5 block text-[26px] font-semibold leading-none text-white">
            <CountUp value={value} />
          </span>
        </span>
        <span className={cn(
          'flex h-9 w-9 flex-none items-center justify-center rounded-xl border',
          tone === 'live'
            ? 'border-emerald-500/25 bg-emerald-500/[0.08] text-emerald-300'
            : 'border-brand-400/20 bg-brand-400/[0.07] text-brand-300'
        )}>
          {icon}
        </span>
      </Link>
    </Reveal>
  )
}

function StatusRow({ label, value, tone, hint }: {
  label: string
  value: string
  tone: 'live' | 'idle' | 'warn' | 'error'
  hint?: string
}) {
  return (
    <li className="rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-[12.5px] text-dark-300">
          <StatusDot tone={tone} />
          {label}
        </span>
        <span className="truncate font-mono text-[11.5px] text-dark-200">{value}</span>
      </div>
      {hint ? <p className="mt-1 pl-4 text-[11px] text-dark-500">{hint}</p> : null}
    </li>
  )
}
