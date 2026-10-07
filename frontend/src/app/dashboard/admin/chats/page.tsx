'use client'
import { useState, useEffect } from 'react'
import { MessageSquare, ChevronDown, ChevronUp, User, Bot, RefreshCw, Smartphone, AlertTriangle } from 'lucide-react'

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
import { adminApi } from '@/lib/api'
import toast from 'react-hot-toast'

export default function AdminChatsPage() {
  const [conversations, setConversations] = useState<any[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)

  // WhatsApp: every user's sessions, and the model behind each AI reply
  const [waSessions, setWaSessions] = useState<WASession[]>([])
  const [waOpen, setWaOpen] = useState<string | null>(null)
  const [waThreads, setWaThreads] = useState<Record<string, any[]>>({})
  const [waLoading, setWaLoading] = useState(true)

  useEffect(() => {
    loadChats()
    loadWhatsApp()
  }, [])

  const loadWhatsApp = async () => {
    setWaLoading(true)
    try {
      const d: any = await adminApi.getWhatsAppSessions()
      setWaSessions(d.sessions || [])
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setWaLoading(false)
    }
  }

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

  const loadChats = async () => {
    setLoading(true)
    try {
      const d: any = await adminApi.getAllConversations()
      setConversations(d.conversations || [])
      setTotal(d.total || 0)
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <MessageSquare className="w-6 h-6 text-brand-400" /> Admin: All Public Chats
          </h1>
          <p className="text-dark-300 text-sm mt-1">
            Live overview of all user chats across LM Studio and ContentBot
          </p>
        </div>
        <button
          onClick={() => { loadChats(); loadWhatsApp() }}
          className="btn-ghost text-xs"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {/* ─── WhatsApp sessions: customers, status, and the model that answered ─── */}
      <div className="glass rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Smartphone className="w-5 h-5 text-green-400" />
          <h2 className="font-semibold text-white text-sm">WhatsApp Sessions &amp; AI Replies</h2>
          <span className="text-[11px] text-dark-400">({waSessions.length})</span>
        </div>

        {waLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : waSessions.length === 0 ? (
          <p className="text-xs text-dark-400">No WhatsApp session has been created yet</p>
        ) : (
          waSessions.map(session => (
            <div key={session._id} className="rounded-xl border border-white/8 overflow-hidden">
              <button
                onClick={() => openWhatsAppSession(session)}
                className="w-full flex items-center justify-between p-3 hover:bg-white/5 transition-all text-left"
              >
                <div className="min-w-0">
                  <p className="text-sm text-white truncate">
                    {session.owner?.name || 'Unknown user'}
                    <span className="text-dark-400"> · {session.sessionName.split('_').slice(1).join('_') || session.sessionName}</span>
                  </p>
                  <p className="text-[11px] text-dark-400">
                    {session.status}
                    {session.phoneNumber ? ` · ${session.phoneNumber}` : ''}
                    {' '}· auto-reply {session.autoReply ? session.autoReplyMode : 'off'}
                    {' '}· {session.customerCount} customer(s) · {session.totalMessagesReceived} in / {session.totalMessagesSent} out
                  </p>
                  {session.lastAiModel && (
                    <p className="text-[11px] text-brand-300">last AI reply: {session.lastAiModel}</p>
                  )}
                  {session.lastError && (
                    <p className="text-[11px] text-red-300/80 flex items-center gap-1 mt-0.5">
                      <AlertTriangle className="w-3 h-3" /> {session.lastError}
                    </p>
                  )}
                </div>
                {waOpen === session._id
                  ? <ChevronUp className="w-4 h-4 text-dark-400 flex-shrink-0" />
                  : <ChevronDown className="w-4 h-4 text-dark-400 flex-shrink-0" />}
              </button>

              {waOpen === session._id && (
                <div className="border-t border-white/8 p-3 space-y-2 max-h-96 overflow-y-auto bg-black/20">
                  {(waThreads[session._id] || []).length === 0 ? (
                    <p className="text-xs text-dark-400">No customer messages yet</p>
                  ) : (
                    (waThreads[session._id] || []).map((msg: any, i: number) => (
                      <div key={i} className={`flex ${msg.direction === 'incoming' ? '' : 'flex-row-reverse'}`}>
                        <div className={`max-w-[80%] rounded-xl px-3 py-2 text-xs ${msg.direction === 'incoming' ? 'msg-user text-white' : 'msg-ai text-dark-100'}`}>
                          <p className="text-[10px] text-dark-400 mb-0.5">
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
              )}
            </div>
          ))
        )}
      </div>

      <div className="space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : conversations.length === 0 ? (
          <div className="glass rounded-2xl p-12 text-center">
            <MessageSquare className="w-12 h-12 text-dark-500 mx-auto mb-3" />
            <p className="text-dark-400">No public conversations yet</p>
          </div>
        ) : (
          conversations.map(convo => (
            <div key={convo._id} className="glass rounded-2xl overflow-hidden">
              <button
                onClick={() => setExpanded(expanded === convo._id ? null : convo._id)}
                className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-all text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-brand-600/30 flex items-center justify-center text-xs font-bold text-brand-300">
                    {convo.userId?.name?.[0]?.toUpperCase() || '?'}
                  </div>
                  <div>
                    <p className="font-medium text-white text-sm">{convo.title}</p>
                    <p className="text-xs text-dark-400">
                      User: <span className="text-brand-300">{convo.userId?.name || 'Unknown'}</span> ({convo.userId?.email || 'N/A'}) · Mode: {convo.mode} · {convo.messages?.length || 0} messages
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-dark-400">
                    {new Date(convo.updatedAt).toLocaleString()}
                  </span>
                  {expanded === convo._id ? (
                    <ChevronUp className="w-4 h-4 text-dark-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-dark-400" />
                  )}
                </div>
              </button>

              {expanded === convo._id && (
                <div className="border-t border-white/8 p-4 space-y-3 max-h-96 overflow-y-auto bg-black/20">
                  {(!convo.messages || convo.messages.length === 0) ? (
                    <p className="text-xs text-dark-400">No messages in this chat session</p>
                  ) : (
                    convo.messages.map((msg: any, i: number) => (
                      <div
                        key={i}
                        className={`flex gap-2 ${
                          msg.role === 'user' ? 'flex-row-reverse' : ''
                        }`}
                      >
                        <div
                          className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                            msg.role === 'user' ? 'bg-brand-600' : 'bg-purple-600'
                          }`}
                        >
                          {msg.role === 'user' ? (
                            <User className="w-3 h-3 text-white" />
                          ) : (
                            <Bot className="w-3 h-3 text-white" />
                          )}
                        </div>
                        <div
                          className={`max-w-[80%] rounded-xl px-3 py-2 text-xs ${
                            msg.role === 'user' ? 'msg-user text-white' : 'msg-ai text-dark-100'
                          }`}
                        >
                          <p className="whitespace-pre-wrap">{msg.content}</p>
                          <span className="text-[10px] text-dark-400 block mt-1">
                            {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : ''}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
