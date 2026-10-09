'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Brain, CornerDownLeft, CreditCard, LayoutDashboard, KeyRound, MessageSquare,
  Search, Settings, Shield, Smartphone, Users,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { Modal } from '@/components/ui/Modal'
import { Kbd } from '@/components/ui/primitives'

/* ══════════════════════════════════════════════════════════════════════════
   Command palette (⌘K / Ctrl+K).

   Fourteen screens is more than a rail can hold comfortably, so navigation is
   also reachable by typing. Arrow keys move, Enter opens, Escape closes.
   ══════════════════════════════════════════════════════════════════════════ */

interface Command {
  id: string
  label: string
  description: string
  href: string
  icon: typeof LayoutDashboard
  adminOnly?: boolean
  keywords?: string
}

const COMMANDS: Command[] = [
  { id: 'dashboard', label: 'Dashboard', description: 'Overview and activity', href: '/dashboard', icon: LayoutDashboard, keywords: 'home overview stats' },
  { id: 'chat', label: 'Chat workspace', description: 'Talk to a local or cloud model', href: '/dashboard/chat', icon: MessageSquare, keywords: 'ai assistant conversation' },
  { id: 'memory', label: 'AI memory', description: 'Business profile and persona', href: '/dashboard/memory', icon: Brain, keywords: 'knowledge persona tone' },
  { id: 'whatsapp', label: 'WhatsApp automation', description: 'Sessions, QR pairing, auto-reply', href: '/dashboard/whatsapp', icon: Smartphone, keywords: 'qr bot messages' },
  { id: 'subscription', label: 'Subscription & quota', description: 'Plan and 7-day token usage', href: '/dashboard/subscription', icon: CreditCard, keywords: 'billing plan tokens' },
  { id: 'settings', label: 'Settings', description: 'Profile, API keys, security', href: '/dashboard/settings', icon: Settings, keywords: 'profile password keys account' },
  { id: 'api-keys', label: 'API key vault', description: 'Provider keys, rotate and test', href: '/dashboard/settings?tab=keys', icon: KeyRound, keywords: 'gemini groq openrouter rotate secret' },
  { id: 'admin-users', label: 'Users & plans', description: 'Accounts, tiers, key assignment', href: '/dashboard/admin/users', icon: Users, adminOnly: true, keywords: 'accounts subscriptions quota' },
  { id: 'admin-keys', label: 'Provider keys (admin)', description: 'Live health of every provider key', href: '/dashboard/admin/api-keys', icon: KeyRound, adminOnly: true, keywords: 'vault secrets providers health' },
  { id: 'admin-chats', label: 'All conversations', description: 'Every chat across accounts', href: '/dashboard/admin/chats', icon: Shield, adminOnly: true, keywords: 'admin inspect audit' },
]

export function CommandPalette({ open, onClose, isAdmin }: { open: boolean; onClose: () => void; isAdmin: boolean }) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)

  const results = useMemo(() => {
    const pool = COMMANDS.filter(c => !c.adminOnly || isAdmin)
    const needle = query.trim().toLowerCase()
    if (!needle) return pool
    return pool.filter(c =>
      `${c.label} ${c.description} ${c.keywords || ''}`.toLowerCase().includes(needle)
    )
  }, [query, isAdmin])

  useEffect(() => {
    if (open) {
      setQuery('')
      setIndex(0)
    }
  }, [open])

  useEffect(() => {
    setIndex(0)
  }, [query])

  const run = (command?: Command) => {
    const target = command || results[index]
    if (!target) return
    onClose()
    router.push(target.href)
  }

  return (
    <Modal open={open} onClose={onClose} size="md" closeOnEscape>
      <div className="-mx-5 -my-4">
        <div className="flex items-center gap-3 border-b border-white/[0.06] px-5 py-3.5">
          <Search className="h-4 w-4 flex-none text-dark-500" aria-hidden />
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setIndex(i => Math.min(results.length - 1, i + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setIndex(i => Math.max(0, i - 1))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                run()
              }
            }}
            placeholder="Search pages, keys and settings…"
            aria-label="Search navigation"
            className="w-full bg-transparent text-[14px] text-white outline-none placeholder:text-dark-500"
          />
          <Kbd>esc</Kbd>
        </div>

        <ul ref={listRef} className="max-h-[46vh] overflow-y-auto py-2 scroll-thin" role="listbox">
          {results.length === 0 ? (
            <li className="px-5 py-6 text-center text-[12.5px] text-dark-500">
              Nothing matches “{query}”. Try “keys”, “users” or “chat”.
            </li>
          ) : (
            results.map((command, i) => {
              const Icon = command.icon
              const active = i === index
              return (
                <li key={command.id} role="option" aria-selected={active}>
                  <button
                    type="button"
                    onMouseEnter={() => setIndex(i)}
                    onClick={() => run(command)}
                    className={cn(
                      'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors',
                      active ? 'bg-brand-400/[0.09]' : 'hover:bg-white/[0.03]'
                    )}
                  >
                    <span className={cn(
                      'flex h-8 w-8 flex-none items-center justify-center rounded-lg border transition-colors',
                      active ? 'border-brand-400/30 bg-brand-400/10 text-brand-300' : 'border-white/[0.06] bg-white/[0.02] text-dark-400'
                    )}>
                      <Icon className="h-3.5 w-3.5" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-dark-100">{command.label}</span>
                      <span className="block truncate text-[11.5px] text-dark-500">{command.description}</span>
                    </span>
                    {active ? <CornerDownLeft className="h-3.5 w-3.5 flex-none text-brand-300/70" aria-hidden /> : null}
                  </button>
                </li>
              )
            })
          )}
        </ul>

        <div className="flex items-center justify-between border-t border-white/[0.06] px-5 py-2.5 text-[11px] text-dark-500">
          <span className="flex items-center gap-2">
            <Kbd>↑</Kbd><Kbd>↓</Kbd> to move
          </span>
          <span className="flex items-center gap-2">
            <Kbd>↵</Kbd> to open
          </span>
        </div>
      </div>
    </Modal>
  )
}
