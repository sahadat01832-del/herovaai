'use client'
import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import {
  LayoutDashboard, MessageSquare, Brain, Smartphone,
  Settings, LogOut, Zap, Users, ChevronLeft, ChevronRight,
  BarChart3, Shield, CreditCard, Menu, X, Sparkles
} from 'lucide-react'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import toast from 'react-hot-toast'

const NAV_ITEMS = [
  { href: '/dashboard',              icon: LayoutDashboard, label: 'Dashboard',    color: 'text-brand-400' },
  { href: '/dashboard/chat',         icon: MessageSquare,   label: 'Chat',         color: 'text-cyan-400' },
  { href: '/dashboard/memory',       icon: Brain,           label: 'AI Memory',    color: 'text-purple-400' },
  { href: '/dashboard/whatsapp',     icon: Smartphone,      label: 'WhatsApp',     color: 'text-green-400' },
  { href: '/dashboard/subscription', icon: CreditCard,      label: 'Subscription', color: 'text-amber-400' },
  { href: '/dashboard/settings',     icon: Settings,        label: 'Settings',     color: 'text-dark-300' },
]

const ADMIN_ITEMS = [
  { href: '/dashboard/admin',        icon: BarChart3,      label: 'Overview' },
  { href: '/dashboard/admin/users',  icon: Users,          label: 'Users & Plans' },
  { href: '/dashboard/admin/chats',  icon: MessageSquare,  label: 'All Chats' },
]

const MOBILE_BOTTOM_NAV = [
  { href: '/dashboard/chat',         icon: MessageSquare, label: 'Chat' },
  { href: '/dashboard/whatsapp',     icon: Smartphone,    label: 'WhatsApp' },
  { href: '/dashboard/subscription', icon: CreditCard,    label: 'Plans' },
  { href: '/dashboard/memory',       icon: Brain,         label: 'Memory' },
]

function SidebarContent({
  collapsed,
  onCloseMobile,
}: {
  collapsed?: boolean
  onCloseMobile?: () => void
}) {
  const pathname = usePathname()
  const { user, logout, isAdmin } = useAuth()

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Logo ── */}
      <div className="flex items-center justify-between px-4 py-5 border-b border-white/6">
        <div className="flex items-center gap-3">
          <div className="relative flex-shrink-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-neon flex items-center justify-center glow-brand">
              <Zap className="w-4.5 h-4.5 text-white" />
            </div>
            <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-cyan-400 rounded-full border-2 border-dark-900 animate-pulse" />
          </div>
          {(!collapsed || onCloseMobile) && (
            <div>
              <span className="font-bold text-white text-sm block leading-tight gradient-text">ContentBot</span>
              <span className="text-[10px] text-dark-500 font-mono tracking-widest uppercase">AI Platform</span>
            </div>
          )}
        </div>
        {onCloseMobile && (
          <button onClick={onCloseMobile} className="p-1.5 rounded-lg text-dark-400 hover:text-white hover:bg-white/5 md:hidden">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Neon divider */}
      <div className="neon-divider" />

      {/* ── Navigation ── */}
      <nav className="flex-1 p-3 overflow-y-auto space-y-0.5">
        {NAV_ITEMS.map(({ href, icon: Icon, label, color }) => {
          const active =
            pathname === href ||
            (href !== '/dashboard' &&
              pathname.startsWith(href) &&
              !pathname.startsWith('/dashboard/admin'))

          return (
            <Link
              key={href}
              href={href}
              onClick={onCloseMobile}
              className={`group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                active
                  ? 'nav-active'
                  : 'text-dark-400 hover:bg-white/4 hover:text-white'
              }`}
            >
              <Icon className={`w-4 h-4 flex-shrink-0 ${active ? 'text-brand-400' : color + ' opacity-70 group-hover:opacity-100'}`} />
              {(!collapsed || onCloseMobile) && (
                <span className="truncate">{label}</span>
              )}
              {active && (!collapsed || onCloseMobile) && (
                <ChevronRight className="w-3 h-3 ml-auto text-brand-400 opacity-60" />
              )}
            </Link>
          )
        })}

        {/* Admin section */}
        {isAdmin && (
          <div className="mt-4 pt-4 border-t border-white/6">
            {(!collapsed || onCloseMobile) && (
              <div className="px-3 mb-2 flex items-center gap-1.5">
                <Shield className="w-3 h-3 text-amber-400" />
                <span className="text-[10px] text-amber-400/80 uppercase tracking-widest font-bold">Admin Zone</span>
              </div>
            )}
            {ADMIN_ITEMS.map(({ href, icon: Icon, label }) => {
              const active =
                pathname === href ||
                (href === '/dashboard/admin'
                  ? pathname === '/dashboard/admin'
                  : pathname.startsWith(href))

              return (
                <Link
                  key={href}
                  href={href}
                  onClick={onCloseMobile}
                  className={`group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                    active
                      ? 'nav-active'
                      : 'text-dark-400 hover:bg-amber-500/5 hover:text-amber-200'
                  }`}
                >
                  <Icon className="w-4 h-4 flex-shrink-0 text-amber-400/70 group-hover:text-amber-400" />
                  {(!collapsed || onCloseMobile) && label}
                </Link>
              )
            })}
          </div>
        )}
      </nav>

      {/* ── User footer ── */}
      <div className="border-t border-white/6 p-3 space-y-1">
        {(!collapsed || onCloseMobile) && user && (
          <div className="px-3 py-2.5 rounded-xl bg-white/3 border border-white/5 flex items-center gap-2.5 mb-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-neon flex items-center justify-center text-sm font-bold text-white flex-shrink-0">
              {user.name?.[0]?.toUpperCase() || 'U'}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-white truncate">{user.name}</p>
              <p className="text-[10px] text-dark-500 flex items-center gap-1">
                <span className="capitalize">{user.subscription?.tier || 'free'}</span>
                {user.role === 'admin' && (
                  <span className="badge badge-amber py-0 ml-1">admin</span>
                )}
              </p>
            </div>
          </div>
        )}
        <button
          onClick={() => { logout(); toast.success('Logged out') }}
          className="flex items-center gap-3 px-3 py-2 w-full rounded-xl text-sm text-dark-400 hover:bg-red-500/8 hover:text-red-400 transition-all"
        >
          <LogOut className="w-4 h-4 flex-shrink-0" />
          {(!collapsed || onCloseMobile) && 'Sign out'}
        </button>
      </div>
    </div>
  )
}

function DashboardLayoutInner({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false)

  useEffect(() => {
    if (!loading && !user) router.push('/login')
  }, [user, loading, router])

  // Close drawer on route change
  useEffect(() => {
    setMobileDrawerOpen(false)
  }, [pathname])

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-animated flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-neon flex items-center justify-center glow-brand animate-neon-pulse">
            <Zap className="w-7 h-7 text-white" />
          </div>
          <div className="space-y-1 text-center">
            <p className="text-white text-sm font-semibold">Loading ContentBot</p>
            <p className="text-dark-500 text-xs font-mono">Initializing AI systems...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row" style={{ background: 'var(--bg-void)' }}>

      {/* ── Desktop Sidebar ── */}
      <aside
        className={`hidden md:flex fixed left-0 top-0 h-full flex-col transition-all duration-300 z-40 ${
          collapsed ? 'w-16' : 'w-60'
        }`}
        style={{
          background: 'rgba(7,7,15,0.95)',
          borderRight: '1px solid rgba(255,255,255,0.06)',
          backdropFilter: 'blur(20px)',
        }}
      >
        <SidebarContent collapsed={collapsed} />
        {/* Collapse button */}
        <button
          onClick={() => setCollapsed(c => !c)}
          className="absolute -right-3.5 top-20 w-7 h-7 rounded-full flex items-center justify-center transition-all hover:scale-110"
          style={{
            background: 'rgba(17,17,36,0.95)',
            border: '1px solid rgba(124,58,237,0.3)',
            boxShadow: '0 0 12px rgba(124,58,237,0.2)',
          }}
        >
          {collapsed
            ? <ChevronRight className="w-3.5 h-3.5 text-brand-400" />
            : <ChevronLeft className="w-3.5 h-3.5 text-brand-400" />
          }
        </button>
      </aside>

      {/* ── Mobile Header ── */}
      <header
        className="md:hidden sticky top-0 z-30 flex items-center justify-between px-4 py-3"
        style={{
          background: 'rgba(7,7,15,0.95)',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          backdropFilter: 'blur(20px)',
        }}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={() => setMobileDrawerOpen(true)}
            className="p-2 rounded-xl text-dark-400 hover:text-white transition-colors"
            style={{ background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.15)' }}
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-neon flex items-center justify-center glow-brand">
              <Zap className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="font-bold text-white text-sm gradient-text">ContentBot</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {user.role === 'admin' && (
            <span className="badge badge-amber">
              <Shield className="w-2.5 h-2.5" /> Admin
            </span>
          )}
          <div className="w-8 h-8 rounded-xl bg-gradient-neon flex items-center justify-center text-xs font-bold text-white glow-brand">
            {user.name?.[0]?.toUpperCase() || 'U'}
          </div>
        </div>
      </header>

      {/* ── Mobile Drawer ── */}
      {mobileDrawerOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setMobileDrawerOpen(false)}
          />
          <div
            className="relative w-72 max-w-[85vw] h-full flex flex-col z-10 animate-slide-right shadow-2xl"
            style={{
              background: 'rgba(7,7,15,0.98)',
              borderRight: '1px solid rgba(124,58,237,0.2)',
            }}
          >
            <SidebarContent onCloseMobile={() => setMobileDrawerOpen(false)} />
          </div>
        </div>
      )}

      {/* ── Main content ── */}
      <main
        className={`flex-1 transition-all duration-300 w-full min-h-screen ${
          collapsed ? 'md:ml-16' : 'md:ml-60'
        } pb-16 md:pb-0`}
        style={{ background: 'var(--bg-void)' }}
      >
        {children}
      </main>

      {/* ── Mobile bottom nav ── */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-30 px-2 py-2 flex justify-around items-center"
        style={{
          background: 'rgba(7,7,15,0.97)',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          backdropFilter: 'blur(24px)',
        }}
      >
        {MOBILE_BOTTOM_NAV.map(({ href, icon: Icon, label }) => {
          const active = pathname === href || pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-col items-center py-1.5 px-4 rounded-xl transition-all relative ${
                active ? 'bottom-nav-active' : 'text-dark-500 hover:text-dark-300'
              }`}
            >
              <Icon className={`w-5 h-5 mb-0.5 ${active ? 'text-brand-400' : ''}`} />
              <span className="text-[10px] font-medium">{label}</span>
            </Link>
          )
        })}
      </nav>
    </div>
  )
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <DashboardLayoutInner>{children}</DashboardLayoutInner>
    </AuthProvider>
  )
}
