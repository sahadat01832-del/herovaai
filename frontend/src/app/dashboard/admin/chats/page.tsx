'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, Bot, ChevronDown, MessageSquare, RefreshCw, Search, Smartphone, User,
} from 'lucide-react'
import { adminApi } from '@/lib/api'
import { cn } from '@/lib/cn'
import { formatDateTime, relativeTime } from '@/lib/format'
import {
  Avatar, Badge, Button, Card, CardHeader, EmptyState, InlineError, SectionHeading,
  Skeleton, StatusDot,
} from '@/components/ui/primitives'
import { CountUp } from '@/components/ui/Reveal'
import toast from 'react-hot-toast'

/* ══════════════════════════════════════════════════════════════════════════
   All chats (admin).

   Two records live side by side here: dashboard conversations and WhatsApp
   customer threads. Both expand in place, but only one thread is fetched at a
   time so a session with thousands of messages cannot stall the page.
   ══════════════════════════════════════════════════════════════════════════ */

interface WASession {
  _id: string
  sessionName: string
  owner: { id: string; name: string; email: string } | null
  status: string
  phoneNumber?: string
  autoReply: boolean
  autoReplyMode: string
  totalMessagesReceived: number
  totalMessagesSent: number
  lastActive?: string
  lastError?: string | null
  customerCount: number
  lastAiModel?: string | null
}

export default function AdminChatsPage() {
  const [conversations, setConversations] = useState<any[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')

  const [waSessions, setWaSessions] = useState<WASession[]>([])
  const [waOpen, setWaOpen] = useState<string | null>(null)
  const [waThreads, setWaThreads] = useState<Record<string, any[]>>({})
  const [waLoading, setWaLoading] = useState(true)

  const loadChats = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const d: any = await adminApi.getAllConversations()
      setConversations(d.conversations || [])
      setTotal(d.total || 0)
    } catch (err: any) {
      setError(err.message || 'Could not load conversations')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadWhatsApp = useCallback(async () => {
    setWaLoading(true)
    try {
      const d: any = await adminApi.getWhatsAppSessions()
      setWaSessions(d.sessions || [])
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setWaLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadChats()
    void loadWhatsApp()
  }, [loadChats, loadWhatsApp])

  const openWhatsAppSession = async (session: WASession) => {
    if (waOpen === session._id) {
      setWaOpen(null)
      return
    }
    setWaOpen(session._id)
    if (!waThreads[session._id]) {
      try {
        const d: any = await adminApi.getWhatsAppMessages(session._id)
        setWaThreads(prev => ({ ...prev, [session._id]: d.messages || [] }))
      } catch (err: any) {
        toast.error(err.message)
      }
    }
  }

  const needle = query.trim().toLowerCase()
  const filteredSessions = useMemo(() => {
    if (!needle) return waSessions
    return waSessions.filter(session =>
      `${session.owner?.name || ''} ${session.owner?.email || ''} ${session.sessionName} ${session.phoneNumber || ''}`
        .toLowerCase()
        .includes(needle)
    )
  }, [waSessions, needle])

  const filteredConversations = useMemo(() => {
    if (!needle) return conversations
    return conversations.filter(convo =>
      `${convo.title || ''} ${convo.userId?.name || ''} ${convo.userId?.email || ''} ${convo.mode || ''}`
        .toLowerCase()
        .includes(needle)
    )
  }, [conversations, needle])

  const activeSessions = waSessions.filter(s => s.status === 'connected').length

  return (
    <div className="space-y-5">
      <SectionHeading
        eyebrow="Admin zone"
        title="All conversations"
        description="Dashboard chats and WhatsApp customer threads, with the model that answered each reply."
        action={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => { void loadChats(); void loadWhatsApp() }} loading={loading || waLoading} icon={<RefreshCw className="h-3.5 w-3.5" />}>
              Refresh
            </Button>
          </div>
        }
      />

      {error ? <InlineError>{error}</InlineError> : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat label="Conversations" value={total} />
        <MiniStat label="WhatsApp sessions" value={waSessions.length} />
        <MiniStat label="Connected" value={activeSessions} tone="live" />
        <MiniStat label="Customers reached" value={waSessions.reduce((acc, s) => acc + (s.customerCount || 0), 0)} />
      </div>

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-dark-500" aria-hidden />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Filter by owner, session or title…"
          className="input-dark pl-9 text-[12.5px]"
          aria-label="Filter conversations"
        />
      </div>

      {/* WhatsApp */}
      <Card padded={false}>
        <div className="px-5 pt-5">
          <CardHeader
            icon={<Smartphone className="h-4 w-4" />}
            title="WhatsApp sessions & AI replies"
            description="Owner, status, and the model behind the last automatic reply."
            action={<Badge tone="steel">{filteredSessions.length}</Badge>}
          />
        </div>

        {waLoading ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        ) : filteredSessions.length === 0 ? (
          <EmptyState
            icon={<Smartphone className="h-5 w-5" />}
            title={query ? 'No session matches that filter' : 'No WhatsApp session yet'}
            description={query
              ? 'Try the owner name, the phone number or the session name.'
              : 'Once a user pairs a number it appears here with every customer reply.'}
          />
        ) : (
          <ul className="mt-3 divide-y divide-white/[0.05]">
            {filteredSessions.map(session => {
              const open = waOpen === session._id
              return (
                <li key={session._id}>
                  <button
                    type="button"
                    onClick={() => openWhatsAppSession(session)}
                    aria-expanded={open}
                    className="flex w-full items-start justify-between gap-4 px-5 py-3.5 text-left transition-colors hover:bg-white/[0.03]"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <Avatar name={session.owner?.name || 'Unknown'} size="sm" />
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 truncate text-[13px] text-dark-100">
                          {session.owner?.name || 'Unknown user'}
                          <span className="text-dark-500">· {session.sessionName.split('_').slice(1).join('_') || session.sessionName}</span>
                        </p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-dark-500">
                          <span className="inline-flex items-center gap-1.5">
                            <StatusDot tone={session.status === 'connected' ? 'live' : session.status === 'error' ? 'error' : 'idle'} />
                            {session.status}
                          </span>
                          {session.phoneNumber ? <span>· {session.phoneNumber}</span> : null}
                          <span>· auto-reply {session.autoReply ? session.autoReplyMode : 'off'}</span>
                          <span>· {session.customerCount} customer{session.customerCount === 1 ? '' : 's'}</span>
                          <span>· {session.totalMessagesReceived} in / {session.totalMessagesSent} out</span>
                          {session.lastActive ? <span>· active {relativeTime(session.lastActive)}</span> : null}
                        </p>
                        {session.lastAiModel ? (
                          <p className="mt-1 inline-flex items-center gap-1.5 text-[11px] text-brand-300">
                            <Bot className="h-3 w-3" aria-hidden />
                            last AI reply: {session.lastAiModel}
                          </p>
                        ) : null}
                        {session.lastError ? (
                          <p className="mt-1 flex items-center gap-1.5 text-[11px] text-red-300/90">
                            <AlertTriangle className="h-3 w-3 flex-none" aria-hidden />
                            {session.lastError}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <ChevronDown className={cn('mt-1 h-4 w-4 flex-none text-dark-500 transition-transform', open && 'rotate-180')} aria-hidden />
                  </button>

                  {open ? (
                    <div className="max-h-96 space-y-2 overflow-y-auto border-t border-white/[0.06] bg-black/25 p-4 animate-fade-up scroll-thin">
                      {(waThreads[session._id] || []).length === 0 ? (
                        <p className="text-[12px] text-dark-500">No customer messages yet.</p>
                      ) : (
                        (waThreads[session._id] || []).map((msg: any, i: number) => (
                          <div key={i} className={cn('flex', msg.direction !== 'incoming' && 'flex-row-reverse')}>
                            <div className={cn('max-w-[80%] rounded-xl px-3 py-2 text-[12px]', msg.direction === 'incoming' ? 'msg-ai text-dark-100' : 'msg-user text-white')}>
                              <p className="mb-0.5 text-[10px] text-dark-500">
                                {msg.direction === 'incoming' ? msg.from : 'AI reply'}
                                {msg.aiModel ? ` · ${msg.aiModel}` : ''}
                                {msg.status === 'failed' ? ' · not delivered' : ''}
                              </p>
                              <p className="whitespace-pre-wrap">{msg.body}</p>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {/* Dashboard conversations */}
      <Card padded={false}>
        <div className="px-5 pt-5">
          <CardHeader
            icon={<MessageSquare className="h-4 w-4" />}
            title="Dashboard conversations"
            description="Every chat created from the workspace or the public page."
            action={<Badge tone="steel">{filteredConversations.length}</Badge>}
          />
        </div>

        {loading ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
          </div>
        ) : filteredConversations.length === 0 ? (
          <EmptyState
            icon={<MessageSquare className="h-5 w-5" />}
            title={query ? 'No conversation matches that filter' : 'No conversations yet'}
            description="Chips created from the workspace and the public AI page land here."
          />
        ) : (
          <ul className="mt-3 divide-y divide-white/[0.05]">
            {filteredConversations.map(convo => {
              const open = expanded === convo._id
              return (
                <li key={convo._id}>
                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : convo._id)}
                    aria-expanded={open}
                    className="flex w-full items-center justify-between gap-4 px-5 py-3.5 text-left transition-colors hover:bg-white/[0.03]"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar name={convo.userId?.name || 'Guest'} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate text-[13px] text-dark-100">{convo.title || 'Untitled chat'}</p>
                        <p className="truncate text-[11px] text-dark-500">
                          {convo.userId?.name || 'Unknown'} ({convo.userId?.email || 'N/A'}) · mode {convo.mode || 'chat'} · {convo.messages?.length || 0} messages
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-none items-center gap-3">
                      <span className="hidden text-[11px] text-dark-500 sm:block" title={formatDateTime(convo.updatedAt)}>
                        {relativeTime(convo.updatedAt)}
                      </span>
                      <ChevronDown className={cn('h-4 w-4 text-dark-500 transition-transform', open && 'rotate-180')} aria-hidden />
                    </div>
                  </button>

                  {open ? (
                    <div className="max-h-96 space-y-3 overflow-y-auto border-t border-white/[0.06] bg-black/25 p-4 animate-fade-up scroll-thin">
                      {(!convo.messages || convo.messages.length === 0) ? (
                        <p className="text-[12px] text-dark-500">No messages in this session.</p>
                      ) : (
                        convo.messages.map((msg: any, i: number) => (
                          <div key={i} className={cn('flex gap-2', msg.role === 'user' && 'flex-row-reverse')}>
                            <span className={cn(
                              'flex h-6 w-6 flex-none items-center justify-center rounded-full',
                              msg.role === 'user' ? 'bg-brand-600/70' : 'bg-dark-600'
                            )}>
                              {msg.role === 'user'
                                ? <User className="h-3 w-3 text-white" aria-hidden />
                                : <Bot className="h-3 w-3 text-brand-200" aria-hidden />}
                            </span>
                            <div className={cn('max-w-[80%] rounded-xl px-3 py-2 text-[12px]', msg.role === 'user' ? 'msg-user text-white' : 'msg-ai text-dark-100')}>
                              <p className="whitespace-pre-wrap">{msg.content}</p>
                              <span className="mt-1 block text-[10px] text-dark-500">
                                {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : ''}
                              </span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}

function MiniStat({ label, value, tone = 'default' }: { label: string; value: number; tone?: 'default' | 'live' }) {
  return (
    <div className={cn('card p-4', tone === 'live' && 'border-emerald-500/20')}>
      <p className="truncate text-[10.5px] font-semibold uppercase tracking-wider text-dark-500">{label}</p>
      <p className={cn('mono-num mt-1.5 text-[22px] font-semibold leading-none', tone === 'live' ? 'text-emerald-300' : 'text-white')}>
        <CountUp value={value} />
      </p>
    </div>
  )
}
