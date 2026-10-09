'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import {
  Banknote, BarChart3, Brain, ChevronLeft, ChevronRight, CreditCard, KeyRound, LayoutDashboard,
  LogOut, Menu, MessageSquare, Plus, Search, Settings, Shield, Smartphone, Sparkles,
  Users, X, Zap,
} from 'lucide-react'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { chatApi } from '@/lib/api'
import { cn } from '@/lib/cn'
import { compactNumber, percent } from '@/lib/format'
import { useHotkey, useMediaQuery, useScrollLock } from '@/lib/hooks'
import { Avatar, IconButton, Kbd, Meter, Tooltip } from '@/components/ui/primitives'
import { CommandPalette } from '@/components/dashboard/CommandPalette'
import { PageTransition } from '@/components/ui/Reveal'
import toast from 'react-hot-toast'

/* ══════════════════════════════════════════════════════════════════════════
   The dashboard shell.

   One rail, one topbar, three navigation surfaces (rail, ⌘K, mobile bottom
   bar) that all read the same route table — so a page added once shows up
   everywhere. The active rail item is marked by a single gold bar that slides
   between positions rather than a background that blinks on and off.
   ══════════════════════════════════════════════════════════════════════════ */

interface NavItem {
  href: string
  icon: typeof LayoutDashboard
  label: string
  hint: string
}

const WORKSPACE: NavItem[] = [
  { href: '/dashboard',          icon: LayoutDashboard, label: 'Dashboard',    hint: 'Overview and activity' },
  { href: '/dashboard/chat',     icon: MessageSquare,   label: 'Chat',         hint: 'Ask a local or cloud model' },
  { href: '/dashboard/memory',   icon: Brain,           label: 'AI Memory',    hint: 'Business profile and persona' },
  { href: '/dashboard/whatsapp', icon: Smartphone,      label: 'WhatsApp',     hint: 'Sessions and auto-reply' },
]

const ACCOUNT: NavItem[] = [
  { href: '/dashboard/subscription', icon: CreditCard, label: 'Subscription', hint: 'Plan and token quota' },
  { href: '/dashboard/settings',     icon: Settings,   label: 'Settings',     hint: 'Profile, API keys, security' },
]

const ADMIN: NavItem[] = [
  { href: '/dashboard/admin/users',    icon: Users,       label: 'Users & Plans', hint: 'Accounts and tiers' },
  { href: '/dashboard/admin/payments', icon: Banknote,    label: 'Payments',      hint: 'Nagad orders and the wallet number' },
  { href: '/dashboard/admin/api-keys', icon: KeyRound,    label: 'API Keys',      hint: 'Provider key vault' },
  { href: '/dashboard/admin/chats',    icon: BarChart3,   label: 'All Chats',     hint: 'Every conversation' },
]

const MOBILE_NAV = [
  { href: '/dashboard/chat',         icon: MessageSquare, label: 'Chat' },
  { href: '/dashboard/whatsapp',     icon: Smartphone,    label: 'WhatsApp' },
  { href: '/dashboard/subscription', icon: CreditCard,    label: 'Plans' },
  { href: '/dashboard/memory',       icon: Brain,         label: 'Memory' },
  { href: '/dashboard/settings',     icon: Settings,      label: 'Settings' },
]

/** Breadcrumb label for the current route, longest prefix wins. */
function useBreadcrumb(pathname: string) {
  return useMemo(() => {
    if (pathname.startsWith('/dashboard/admin/api-keys')) return { section: 'Admin', page: 'API Keys' }
    if (pathname.startsWith('/dashboard/admin/users'))    return { section: 'Admin', page: 'Users & Plans' }
    if (pathname.startsWith('/dashboard/admin'))          return { section: 'Admin', page: 'Overview' }
    const all = [...WORKSPACE, ...ACCOUNT]
    const match = all
      .filter(item => pathname === item.href || pathname.startsWith(`${item.href}/`))
      .sort((a, b) => b.href.length - a.href.length)[0]
    return { section: 'Workspace', page: match?.label || 'Dashboard' }
  }, [pathname])
}

function isActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard'
  if (href === '/dashboard/admin/users') return pathname.startsWith('/dashboard/admin/users') || pathname === '/dashboard/admin'
  return pathname === href || pathname.startsWith(`${href}/`)
}

/* ─── Rail ──────────────────────────────────────────────────────────────── */

function Rail({ collapsed, onNavigate, showLabels }: {
  collapsed: boolean
  onNavigate?: () => void
  showLabels: boolean
}) {
  const pathname = usePathname()
  const { user, logout, isAdmin } = useAuth()

  // One sliding marker instead of a background per item: the gold bar travels, which reads as
  // movement between places rather than a state that flickers.
  const navRef = useRef<HTMLElement>(null)
  const [marker, setMarker] = useState<{ top: number; height: number } | null>(null)

  const measure = useCallback(() => {
    const nav = navRef.current
    if (!nav) return
    const active = nav.querySelector<HTMLElement>('[data-active="true"]')
    if (!active) {
      setMarker(null)
      return
    }
    setMarker({ top: active.offsetTop, height: active.offsetHeight })
  }, [])

  useEffect(() => {
    measure()
    const raf = requestAnimationFrame(measure)
    window.addEventListener('resize', measure)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', measure)
    }
  }, [measure, pathname, collapsed, showLabels, isAdmin])

  const renderItem = (item: NavItem, tone: 'default' | 'admin' = 'default') => {
    const Icon = item.icon
    const active = isActive(pathname, item.href)
    const link = (
      <Link
        key={item.href}
        href={item.href}
        data-active={active}
        onClick={onNavigate}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-all duration-200',
          active
            ? 'bg-gradient-to-r from-brand-400/[0.16] to-brand-400/[0.04] text-brand-200'
            : tone === 'admin'
              ? 'text-dark-400 hover:bg-white/[0.04] hover:text-brand-100'
              : 'text-dark-400 hover:bg-white/[0.04] hover:text-white'
        )}
      >
        <Icon
          className={cn(
            'h-4 w-4 flex-none transition-colors',
            active ? 'text-brand-300' : 'text-dark-500 group-hover:text-dark-200'
          )}
          aria-hidden
        />
        {showLabels ? <span className="truncate">{item.label}</span> : null}
        {active && showLabels ? (
          <span className="ml-auto h-1.5 w-1.5 flex-none rounded-full bg-brand-300/80" aria-hidden />
        ) : null}
      </Link>
    )

    return showLabels ? link : (
      <Tooltip key={item.href} text={item.label} side="right" className="w-full">
        {link}
      </Tooltip>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Brand */}
      <div className="flex items-center gap-3 px-4 py-4">
        <div className="relative flex-none">
          <img
            src="/logo.png"
            alt=""
            width={36}
            height={36}
            className="h-9 w-9 rounded-xl ring-1 ring-white/10"
          />
          <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-dark-950 bg-emerald-400" aria-hidden />
        </div>
        {showLabels ? (
          <div className="min-w-0">
            <p className="font-display text-[15px] font-semibold leading-tight text-white">
              Herova<span className="text-brand-400">Ai</span>
            </p>
            <p className="text-[10px] uppercase tracking-[0.18em] text-dark-500">Control centre</p>
          </div>
        ) : null}
      </div>

      <div className="neon-divider" />

      {/* Navigation */}
      <nav ref={navRef} className="relative flex-1 space-y-0.5 overflow-y-auto p-3 scroll-thin">
        {marker && (
          <span
            className="pointer-events-none absolute left-0 w-[3px] rounded-full bg-gradient-to-b from-brand-300 to-brand-600 transition-all duration-300 ease-quint"
            style={{ top: marker.top + 6, height: Math.max(12, marker.height - 12) }}
            aria-hidden
          />
        )}

        {showLabels ? (
          <p className="px-3 pb-1.5 pt-1 text-[10px] font-bold uppercase tracking-[0.2em] text-dark-600">Workspace</p>
        ) : null}
        {WORKSPACE.map(item => renderItem(item))}

        {showLabels ? (
          <p className="px-3 pb-1.5 pt-4 text-[10px] font-bold uppercase tracking-[0.2em] text-dark-600">Account</p>
        ) : (
          <div className="my-2 h-px bg-white/[0.06]" />
        )}
        {ACCOUNT.map(item => renderItem(item))}

        {isAdmin ? (
          <>
            {showLabels ? (
              <div className="mt-4 flex items-center gap-1.5 px-3 pb-1.5">
                <Shield className="h-3 w-3 text-brand-300/80" aria-hidden />
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-300/80">Admin zone</span>
              </div>
            ) : (
              <div className="my-2 h-px bg-white/[0.06]" />
            )}
            {ADMIN.map(item => renderItem(item, 'admin'))}
          </>
        ) : null}
      </nav>

      {/* Account footer */}
      <div className="space-y-1 border-t border-white/[0.06] p-3">
        {showLabels && user ? (
          <Link
            href="/dashboard/settings"
            onClick={onNavigate}
            className="mb-1 flex items-center gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 transition-colors hover:border-brand-400/25 hover:bg-brand-400/[0.06]"
          >
            <Avatar name={user.name} size="sm" />
            <div className="min-w-0">
              <p className="truncate text-[12px] font-semibold text-white">{user.name}</p>
              <p className="flex items-center gap-1 truncate text-[10px] capitalize text-dark-500">
                {user.subscription?.tier || 'free'} plan
                {user.role === 'admin' ? <span className="badge badge-amber ml-1 py-0">admin</span> : null}
              </p>
            </div>
          </Link>
        ) : null}

        <button
          type="button"
          onClick={() => {
            logout()
            toast.success('Signed out')
          }}
          className={cn(
            'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-[13px] text-dark-400 transition-colors hover:bg-red-500/[0.08] hover:text-red-300',
            !showLabels && 'justify-center'
          )}
        >
          <LogOut className="h-4 w-4 flex-none" aria-hidden />
          {showLabels ? 'Sign out' : null}
        </button>
      </div>
    </div>
  )
}

/* ─── Topbar ────────────────────────────────────────────────────────────── */

function Topbar({ collapsed, onOpenDrawer, onOpenPalette, quota }: {
  collapsed: boolean
  onOpenDrawer: () => void
  onOpenPalette: () => void
  quota: { used: number; limit: number; tier: string } | null
}) {
  const { user, isAdmin } = useAuth()
  const pathname = usePathname()
  const breadcrumb = useBreadcrumb(pathname)
  const [menuOpen, setMenuOpen] = useState(false)
  const desktop = useMediaQuery('(min-width: 768px)')

  useEffect(() => {
    setMenuOpen(false)
  }, [pathname])

  const used = quota?.used || 0
  const limit = quota?.limit || user?.tokenQuota?.weeklyLimit || 1_000_000
  const usedPct = percent(used, limit)

  return (
    <header className={cn('sticky top-0 z-30 glass-toolbar', desktop && (collapsed ? 'md:pl-[4.25rem]' : 'md:pl-[15rem]'))}>
      <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
        <button
          type="button"
          onClick={onOpenDrawer}
          className="icon-btn md:hidden"
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5" />
        </button>

        {/* Breadcrumb */}
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[11px] text-dark-500">
            {breadcrumb.section}
            <ChevronRight className="h-3 w-3" aria-hidden />
            <span className="text-dark-300">{breadcrumb.page}</span>
          </p>
          <h1 className="truncate text-[15px] font-semibold tracking-tight text-white">
            {breadcrumb.section === 'Admin' ? 'Administration' : breadcrumb.page}
          </h1>
        </div>

        {/* Palette trigger */}
        <button
          type="button"
          onClick={onOpenPalette}
          className="hidden items-center gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-[12.5px] text-dark-400 transition-colors hover:border-brand-400/25 hover:text-dark-200 sm:flex"
        >
          <Search className="h-3.5 w-3.5" aria-hidden />
          <span>Search…</span>
          <span className="ml-1 flex items-center gap-1">
            <Kbd>⌘</Kbd><Kbd>K</Kbd>
          </span>
        </button>

        {/* Quota chip */}
        {quota ? (
          <Tooltip text={`${compactNumber(used)} of ${compactNumber(limit)} tokens used this week`}>
            <span className="hidden items-center gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-2 lg:flex">
              <Zap className="h-3.5 w-3.5 text-brand-300" aria-hidden />
              <span className="w-24">
                <span className="mb-1 flex items-baseline justify-between text-[10px] text-dark-400">
                  <span className="uppercase tracking-wider">{quota.tier}</span>
                  <span className="mono-num">{usedPct}%</span>
                </span>
                <Meter value={usedPct} tone={usedPct > 85 ? 'danger' : usedPct > 60 ? 'warn' : 'gold'} />
              </span>
            </span>
          </Tooltip>
        ) : null}

        {/* New chat */}
        <Link href="/dashboard/chat" className="btn-primary btn-sm btn-sheen hidden sm:inline-flex">
          <Plus className="h-3.5 w-3.5" aria-hidden />
          New chat
        </Link>

        {/* Account menu */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen(o => !o)}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.02] p-1 pr-2 transition-colors hover:border-brand-400/25"
          >
            <Avatar name={user?.name} size="sm" />
            <span className="hidden text-[12.5px] font-medium text-dark-200 sm:block">
              {user?.name?.split(' ')[0] || 'Account'}
            </span>
            <ChevronRight className={cn('h-3.5 w-3.5 text-dark-500 transition-transform', menuOpen && 'rotate-90')} aria-hidden />
          </button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} aria-hidden />
              <div
                role="menu"
                className="absolute right-0 top-[calc(100%+0.5rem)] z-20 w-64 animate-fade-down overflow-hidden rounded-2xl border border-white/[0.09] bg-dark-900/97 shadow-[0_30px_70px_-30px_rgba(0,0,0,1)] backdrop-blur-2xl"
              >
                <div className="border-b border-white/[0.06] px-4 py-3">
                  <p className="truncate text-[13px] font-semibold text-white">{user?.name}</p>
                  <p className="truncate text-[11.5px] text-dark-500">{user?.email}</p>
                  <div className="mt-2 flex items-center gap-1.5">
                    <span className="badge badge-violet capitalize">{user?.subscription?.tier || 'free'}</span>
                    {isAdmin ? <span className="badge badge-amber">admin</span> : null}
                    {user?.hasContentbotApiKey ? (
                      <span className="badge badge-green" title="Agent platform key configured">key set</span>
                    ) : null}
                  </div>
                </div>
                <div className="p-1.5">
                  <Link href="/dashboard/settings" role="menuitem" className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-[12.5px] text-dark-300 transition-colors hover:bg-white/[0.05] hover:text-white">
                    <Settings className="h-3.5 w-3.5" aria-hidden /> Settings & API keys
                  </Link>
                  {isAdmin ? (
                    <Link href="/dashboard/admin/api-keys" role="menuitem" className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-[12.5px] text-dark-300 transition-colors hover:bg-white/[0.05] hover:text-white">
                      <KeyRound className="h-3.5 w-3.5" aria-hidden /> Provider key vault
                    </Link>
                  ) : null}
                  <Link href="/dashboard/subscription" role="menuitem" className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-[12.5px] text-dark-300 transition-colors hover:bg-white/[0.05] hover:text-white">
                    <Sparkles className="h-3.5 w-3.5" aria-hidden /> Plan & quota
                  </Link>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  )
}

/* ─── Shell ─────────────────────────────────────────────────────────────── */

function Shell({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [quota, setQuota] = useState<{ used: number; limit: number; tier: string } | null>(null)

  useScrollLock(drawerOpen)

  useEffect(() => {
    if (!loading && !user) router.push('/login')
  }, [user, loading, router])

  useEffect(() => {
    setDrawerOpen(false)
  }, [pathname])

  // Collapse preference survives a reload; the rail is the only width-critical chrome.
  useEffect(() => {
    const saved = window.localStorage.getItem('herova.rail')
    if (saved === 'collapsed') setCollapsed(true)
  }, [])
  useEffect(() => {
    window.localStorage.setItem('herova.rail', collapsed ? 'collapsed' : 'expanded')
  }, [collapsed])

  useHotkey('mod+k', () => setPaletteOpen(o => !o))

  useEffect(() => {
    if (!user) return
    let alive = true
    chatApi.getQuota()
      .then((d: any) => {
        if (!alive || !d?.quota) return
        setQuota({
          used: d.quota.tokensUsed7d || 0,
          limit: d.quota.weeklyLimit || 1_000_000,
          tier: d.quota.tier || 'free',
        })
      })
      .catch(() => {})
    return () => { alive = false }
  }, [user])

  if (loading || !user) {
    return (
      <div className="bg-animated flex min-h-screen items-center justify-center">
        <div className="relative flex flex-col items-center gap-5">
          <div className="absolute -inset-16 -z-10 opacity-70 blur-2xl">
            <span className="block h-40 w-40 rounded-full bg-brand-500/20" />
          </div>
          <div className="flex h-14 w-14 animate-neon-pulse items-center justify-center rounded-2xl bg-gradient-neon shadow-gold">
            <Zap className="h-7 w-7 text-dark-950" aria-hidden />
          </div>
          <div className="space-y-1 text-center">
            <p className="text-[13px] font-semibold text-white">Loading HerovaAi</p>
            <p className="font-mono text-[11px] text-dark-500">initialising AI systems…</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-void)' }}>
      {/* Desktop rail */}
      <aside
        className={cn(
          'fixed left-0 top-0 z-40 hidden h-full flex-col border-r border-white/[0.06] transition-[width] duration-300 ease-quint md:flex',
          collapsed ? 'w-[4.25rem]' : 'w-[15rem]'
        )}
        style={{ background: 'rgba(7,9,11,0.95)', backdropFilter: 'blur(20px)' }}
      >
        <Rail collapsed={collapsed} showLabels={!collapsed} />
        <button
          type="button"
          onClick={() => setCollapsed(c => !c)}
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          className="absolute -right-3.5 top-20 flex h-7 w-7 items-center justify-center rounded-full border border-brand-400/30 bg-dark-800/95 text-brand-300 shadow-gold-sm transition-transform hover:scale-110"
        >
          {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
        </button>
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-[60] flex md:hidden">
          <div
            className="absolute inset-0 animate-fade-in bg-black/70 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />
          <div
            className="relative z-10 flex h-full w-72 max-w-[85vw] animate-slide-right flex-col border-r border-brand-400/20 shadow-2xl"
            style={{ background: 'rgba(7,9,11,0.98)' }}
          >
            <IconButton label="Close navigation" onClick={() => setDrawerOpen(false)} className="absolute right-3 top-4 z-10">
              <X className="h-4 w-4" />
            </IconButton>
            <Rail collapsed={false} showLabels onNavigate={() => setDrawerOpen(false)} />
          </div>
        </div>
      )}

      <Topbar
        collapsed={collapsed}
        onOpenDrawer={() => setDrawerOpen(true)}
        onOpenPalette={() => setPaletteOpen(true)}
        quota={quota}
      />

      <main
        className={cn(
          // 65px = the topbar's own height (h-16 + its 1px hairline). Using an
          // exact value keeps the document from growing a 1px scrollbar.
          'min-h-[calc(100vh-65px)] pb-24 transition-[padding] duration-300 ease-quint md:pb-8',
          collapsed ? 'md:pl-[4.25rem]' : 'md:pl-[15rem]'
        )}
      >
        <div className="mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6 sm:py-6">
          <PageTransition>{children}</PageTransition>
        </div>
      </main>

      {/* Mobile bottom bar */}
      <nav className="glass-toolbar fixed bottom-0 left-0 right-0 z-30 border-t px-1 pb-1.5 pt-1 md:hidden">
        <div className="flex items-stretch justify-around">
          {MOBILE_NAV.map(({ href, icon: Icon, label }) => {
            const active = isActive(pathname, href)
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'relative flex flex-1 flex-col items-center gap-0.5 rounded-xl py-1.5 text-[10px] font-medium transition-colors',
                  active ? 'text-brand-300' : 'text-dark-500 hover:text-dark-300'
                )}
              >
                <Icon className={cn('h-5 w-5 transition-transform', active && 'scale-110')} aria-hidden />
                {label}
                {active ? (
                  <span className="absolute -top-1 h-[3px] w-8 rounded-full bg-gradient-to-r from-brand-600 to-brand-300" aria-hidden />
                ) : null}
              </Link>
            )
          })}
        </div>
      </nav>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} isAdmin={user.role === 'admin'} />
    </div>
  )
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <Shell>{children}</Shell>
    </AuthProvider>
  )
}
