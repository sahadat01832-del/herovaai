'use client'
import { useState, useEffect, useRef } from 'react'
import {
  Smartphone, Plus, WifiOff, Trash2, Send, Bot,
  RefreshCw, User, MessageSquare, Clock, CheckCircle2, AlertTriangle, Save,
} from 'lucide-react'
import { whatsappApi } from '@/lib/api'
import { io, Socket } from 'socket.io-client'
import { getToken, getSocketUrl } from '@/lib/auth'
import toast from 'react-hot-toast'

interface WAMessage {
  from: string
  to: string
  body: string
  direction: 'incoming' | 'outgoing'
  aiGenerated?: boolean
  status?: string
  timestamp?: string
}

interface WASession {
  _id: string
  sessionName: string
  status: 'disconnected' | 'qr_pending' | 'connected' | 'error'
  autoReply: boolean
  autoReplyMode: string
  useMemory: boolean
  tone?: string
  customPrompt?: string
  lastError?: string | null
  qrCode?: string | null
  totalMessagesReceived: number
  totalMessagesSent: number
  messages?: WAMessage[]
  lastActive?: string
}

const STATUS_CONFIG = {
  connected: { label: 'Connected', color: 'text-green-400', dot: 'bg-green-400' },
  qr_pending: { label: 'QR Ready - Scan Now', color: 'text-yellow-400', dot: 'bg-yellow-400' },
  disconnected: { label: 'Disconnected', color: 'text-gray-400', dot: 'bg-gray-400' },
  error: { label: 'Error', color: 'text-red-400', dot: 'bg-red-400' },
}

export default function WhatsAppPage() {
  const [sessions, setSessions] = useState<WASession[]>([])
  const [selectedSession, setSelectedSession] = useState<WASession | null>(null)
  const [selectedCustomer, setSelectedCustomer] = useState<string | null>(null)
  const [customers, setCustomers] = useState<string[]>([])
  const [messages, setMessages] = useState<WAMessage[]>([])
  const [qrCodes, setQrCodes] = useState<Record<string, string>>({})
  const [newSessionName, setNewSessionName] = useState('')
  const [showNewSession, setShowNewSession] = useState(false)
  const [sendMsg, setSendMsg] = useState('')
  const [manualPhone, setManualPhone] = useState('')
  const [toneDraft, setToneDraft] = useState<Record<string, string>>({})
  const [promptDraft, setPromptDraft] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const socketRef = useRef<Socket | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadSessions()
    const token = getToken()
    const socket = io(getSocketUrl(), {
      auth: { token },
    })
    socketRef.current = socket

    socket.on('whatsapp-qr', ({ sessionName, qrCode }: any) => {
      setQrCodes(prev => ({ ...prev, [sessionName]: qrCode }))
      setSessions(prev =>
        prev.map(s => (s.sessionName === sessionName ? { ...s, status: 'qr_pending', qrCode } : s))
      )
    })

    socket.on('whatsapp-status', ({ sessionName, status }: any) => {
      setSessions(prev =>
        prev.map(s => (s.sessionName === sessionName ? { ...s, status, ...(status === 'connected' ? { qrCode: null } : {}) } : s))
      )
      if (status === 'connected') {
        toast.success('WhatsApp connected successfully!')
      }
    })

    socket.on('whatsapp-message', (data: any) => {
      const { message, senderContact } = data
      setMessages(prev => [...prev, message])
      if (message.from && message.from !== 'me') {
        setCustomers(prev => Array.from(new Set([...prev, message.from])))
      }
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    })

    return () => {
      socket.disconnect()
    }
  }, [])

  // Poll sessions periodically if any session is in qr_pending
  useEffect(() => {
    const hasPending = sessions.some(s => s.status === 'qr_pending')
    if (!hasPending) return

    const interval = setInterval(() => {
      loadSessions(false)
    }, 3000)

    return () => clearInterval(interval)
  }, [sessions])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const loadSessions = async (showToast = true) => {
    try {
      const d: any = await whatsappApi.getSessions()
      if (d.sessions) {
        setSessions(d.sessions)
        // Store any initial QR codes from DB
        const qrMap: Record<string, string> = {}
        d.sessions.forEach((s: WASession) => {
          if (s.qrCode) qrMap[s.sessionName] = s.qrCode
        })
        setQrCodes(prev => ({ ...prev, ...qrMap }))

        // Keep selectedSession synced
        if (selectedSession) {
          const updated = d.sessions.find((s: WASession) => s._id === selectedSession._id)
          if (updated) setSelectedSession(updated)
        }
      }
    } catch (err: any) {
      if (showToast) toast.error(err.message)
    }
  }

  const createSession = async () => {
    if (!newSessionName.trim()) {
      toast.error('Please enter a session or business account name')
      return
    }
    setLoading(true)
    try {
      const d: any = await whatsappApi.createSession(newSessionName)
      setSessions(prev => [...prev.filter(s => s._id !== d.session._id), d.session])
      setNewSessionName('')
      setShowNewSession(false)
      toast.success('Session started! QR code will appear in seconds...')
      loadSessions(false)
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  const disconnectSession = async (id: string) => {
    try {
      await whatsappApi.disconnect(id)
      setSessions(prev =>
        prev.map(s => (s._id === id ? { ...s, status: 'disconnected', qrCode: null } : s))
      )
      toast.success('Session disconnected')
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const deleteSession = async (id: string) => {
    if (!confirm('Delete this WhatsApp session?')) return
    try {
      await whatsappApi.deleteSession(id)
      setSessions(prev => prev.filter(s => s._id !== id))
      if (selectedSession?._id === id) {
        setSelectedSession(null)
        setMessages([])
      }
      toast.success('Session deleted')
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const openCustomerChats = async (session: WASession) => {
    setSelectedSession(session)
    try {
      const d: any = await whatsappApi.getMessages(session._id)
      setCustomers(d.customers || [])
      setMessages(d.messages || [])
      if (d.customers && d.customers.length > 0) {
        setSelectedCustomer(d.customers[0])
      }
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const filterCustomerChat = async (session: WASession, contact: string) => {
    setSelectedCustomer(contact)
    try {
      const d: any = await whatsappApi.getMessages(session._id, contact)
      setMessages(d.messages || [])
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const sendManualMessage = async () => {
    const targetNumber = selectedCustomer || manualPhone
    if (!selectedSession || !targetNumber || !sendMsg.trim()) {
      toast.error('Select a customer and type a message')
      return
    }
    try {
      await whatsappApi.sendMessage(selectedSession._id, targetNumber, sendMsg)
      const newMsg: WAMessage = {
        from: 'me',
        to: targetNumber,
        body: sendMsg,
        direction: 'outgoing',
        status: 'sent',
        timestamp: new Date().toISOString(),
      }
      setMessages(prev => [...prev, newMsg])
      setSendMsg('')
      toast.success('WhatsApp message sent!')
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const toggleAutoReply = async (session: WASession) => {
    try {
      const d: any = await whatsappApi.updateSettings(session._id, {
        autoReply: !session.autoReply,
        autoReplyMode: !session.autoReply ? 'always' : 'never',
      })
      setSessions(prev => prev.map(s => (s._id === session._id ? d.session : s)))
      if (selectedSession?._id === session._id) setSelectedSession(d.session)
      toast.success(`AI Auto-reply ${!session.autoReply ? 'activated' : 'disabled'}`)
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const saveReplySettings = async (session: WASession) => {
    try {
      const d: any = await whatsappApi.updateSettings(session._id, {
        tone: toneDraft[session._id] ?? session.tone ?? '',
        customPrompt: promptDraft[session._id] ?? session.customPrompt ?? '',
      })
      setSessions(prev => prev.map(s => (s._id === session._id ? d.session : s)))
      if (selectedSession?._id === session._id) setSelectedSession(d.session)
      toast.success('Reply settings saved')
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const activeMessages = selectedCustomer
    ? messages.filter(m => m.from === selectedCustomer || m.to === selectedCustomer)
    : messages

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center glow-green">
            <Smartphone className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">WhatsApp Business Automation</h1>
            <p className="text-dark-300 text-sm">
              Connect accounts, let AI reply to customers with your Business Memory, and inspect chats live
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => loadSessions()} className="btn-ghost text-xs">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
          <button onClick={() => setShowNewSession(true)} className="btn-primary">
            <Plus className="w-4 h-4" /> Connect Account
          </button>
        </div>
      </div>

      {/* Connect Form */}
      {showNewSession && (
        <div className="glass-strong rounded-2xl p-6 border border-brand-500/30">
          <h3 className="text-lg font-semibold text-white mb-2">Connect WhatsApp Account</h3>
          <p className="text-dark-300 text-sm mb-4">
            Enter a label for this number. A dynamic QR code will be generated to scan with WhatsApp (Linked Devices).
          </p>
          <div className="flex gap-3">
            <input
              value={newSessionName}
              onChange={e => setNewSessionName(e.target.value)}
              placeholder="Account name (e.g. Sales Desk, Business WhatsApp)"
              className="input-dark flex-1"
              onKeyDown={e => e.key === 'Enter' && createSession()}
            />
            <button onClick={createSession} disabled={loading} className="btn-primary">
              {loading ? 'Initializing Browser...' : 'Generate QR Code'}
            </button>
            <button onClick={() => setShowNewSession(false)} className="btn-ghost">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Sessions list */}
      {sessions.length === 0 ? (
        <div className="glass rounded-2xl p-12 text-center">
          <Smartphone className="w-12 h-12 text-dark-500 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-white mb-2">No WhatsApp Accounts Connected</h3>
          <p className="text-dark-400 text-sm mb-4">
            Connect your WhatsApp number to let ContentBot manage incoming customer DMs with AI.
          </p>
          <button onClick={() => setShowNewSession(true)} className="btn-primary">
            <Plus className="w-4 h-4" /> Connect WhatsApp Account
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {sessions.map(session => {
            const statusCfg =
              STATUS_CONFIG[session.status as keyof typeof STATUS_CONFIG] ||
              STATUS_CONFIG.disconnected
            const qr = qrCodes[session.sessionName] || session.qrCode

            return (
              <div
                key={session._id}
                className={`glass rounded-2xl p-5 space-y-4 border transition-all ${
                  selectedSession?._id === session._id ? 'border-brand-500/50 glow-brand' : 'border-white/5'
                }`}
              >
                {/* Session Header */}
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-white">
                      {session.sessionName.includes('_')
                        ? session.sessionName.split('_').slice(1).join('_')
                        : session.sessionName}
                    </h3>
                    <div className="flex items-center gap-1.5 mt-1">
                      <div className={`w-2 h-2 rounded-full ${statusCfg.dot} animate-pulse`} />
                      <span className={`text-xs ${statusCfg.color}`}>{statusCfg.label}</span>
                    </div>
                    {session.lastError && (
                      <p className="text-[10px] text-red-300/80 mt-1 max-w-[240px]">
                        {session.lastError}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => deleteSession(session._id)}
                    className="p-1.5 text-dark-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {/* QR Code Display */}
                {session.status === 'qr_pending' && (
                  <div className="flex flex-col items-center p-3 glass-strong rounded-xl border border-yellow-500/30">
                    <p className="text-xs text-yellow-300 font-medium mb-2 flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" /> Scan QR code with WhatsApp
                    </p>
                    {qr ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={qr}
                        alt="WhatsApp QR Code"
                        className="w-48 h-48 rounded-xl bg-white p-2 border-2 border-yellow-400/50 shadow-lg"
                      />
                    ) : (
                      <div className="w-48 h-48 rounded-xl bg-black/40 flex flex-col items-center justify-center gap-2 border border-white/10">
                        <div className="w-6 h-6 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
                        <span className="text-[11px] text-dark-300">Generating QR...</span>
                      </div>
                    )}
                    <p className="text-[10px] text-dark-400 mt-2 text-center">
                      Open WhatsApp → Settings → Linked Devices → Link a Device
                    </p>
                  </div>
                )}

                {/* Connected Badge */}
                {session.status === 'connected' && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-green-500/10 border border-green-500/20 text-green-400 text-xs">
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                    <span>WhatsApp Connected & Listening for DMs</span>
                  </div>
                )}

                {/* Counters */}
                <div className="grid grid-cols-2 gap-2 text-center">
                  <div className="glass-strong rounded-lg p-2">
                    <p className="text-lg font-bold text-white">{session.totalMessagesReceived || 0}</p>
                    <p className="text-xs text-dark-400">Incoming DMs</p>
                  </div>
                  <div className="glass-strong rounded-lg p-2">
                    <p className="text-lg font-bold text-white">{session.totalMessagesSent || 0}</p>
                    <p className="text-xs text-dark-400">AI / Sent DMs</p>
                  </div>
                </div>

                {/* AI Auto-reply Toggle */}
                <div className="flex items-center justify-between p-3 rounded-xl bg-white/5">
                  <div className="flex items-center gap-2">
                    <Bot className="w-4 h-4 text-brand-400" />
                    <div>
                      <span className="text-xs font-semibold text-white block">AI Auto-Reply</span>
                      <span className="text-[10px] text-dark-400">Uses AI Memory & Profile</span>
                    </div>
                  </div>
                  <button
                    onClick={() => toggleAutoReply(session)}
                    className={`w-11 h-6 rounded-full transition-all relative ${
                      session.autoReply ? 'bg-green-500' : 'bg-dark-600'
                    }`}
                  >
                    <div
                      className={`w-4 h-4 bg-white rounded-full transition-transform absolute top-1 ${
                        session.autoReply ? 'left-6' : 'left-1'
                      }`}
                    />
                  </button>
                </div>

                {/* AI Reply Tone & Owner Instructions */}
                <div className="p-3 rounded-xl bg-white/5 space-y-2">
                  <span className="text-xs font-semibold text-white block">Reply Tone &amp; Instructions</span>
                  <input
                    className="input text-xs"
                    placeholder="Tone (e.g. warm, formal, short replies)"
                    defaultValue={session.tone || ''}
                    onChange={e => setToneDraft(prev => ({ ...prev, [session._id]: e.target.value }))}
                  />
                  <textarea
                    className="input text-xs min-h-[60px]"
                    placeholder="Extra instructions for the AI (business rules, offers, what never to promise)"
                    defaultValue={session.customPrompt || ''}
                    onChange={e => setPromptDraft(prev => ({ ...prev, [session._id]: e.target.value }))}
                  />
                  <button onClick={() => saveReplySettings(session)} className="btn-ghost text-xs py-1.5">
                    <Save className="w-3.5 h-3.5" /> Save reply settings
                  </button>
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                  <button
                    onClick={() => openCustomerChats(session)}
                    className={`btn-ghost flex-1 text-xs py-2 justify-center ${
                      selectedSession?._id === session._id ? 'nav-active' : ''
                    }`}
                  >
                    <MessageSquare className="w-3.5 h-3.5" /> Customer Chats & DMs
                  </button>
                  {session.status === 'connected' && (
                    <button
                      onClick={() => disconnectSession(session._id)}
                      className="btn-ghost text-xs py-2 text-red-400 hover:bg-red-500/10"
                      title="Disconnect"
                    >
                      <WifiOff className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Customer Chats & AI Replies Live Viewer */}
      {selectedSession && (
        <div className="glass-strong rounded-2xl overflow-hidden border border-white/10 mt-6 animate-slide-up">
          {/* Header */}
          <div className="p-4 border-b border-white/8 flex items-center justify-between bg-black/20">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-brand-600/30 flex items-center justify-center text-brand-300">
                <MessageSquare className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-semibold text-white text-sm">
                  Customer Chats & AI Replies —{' '}
                  <span className="text-brand-400">
                    {selectedSession.sessionName.includes('_')
                      ? selectedSession.sessionName.split('_').slice(1).join('_')
                      : selectedSession.sessionName}
                  </span>
                </h3>
                <p className="text-xs text-dark-400">
                  Select a customer to inspect what they asked and what the AI answered
                </p>
              </div>
            </div>
            <button
              onClick={() => openCustomerChats(selectedSession)}
              className="btn-ghost text-xs py-1.5"
            >
              <RefreshCw className="w-3 h-3" /> Refresh DMs
            </button>
          </div>

          <div className="flex flex-col md:flex-row h-[500px]">
            {/* Customer List Column */}
            <div
              className={`w-full md:w-64 border-b md:border-b-0 md:border-r border-white/8 flex flex-col bg-black/10 ${
                selectedCustomer ? 'hidden md:flex' : 'flex'
              }`}
            >
              <div className="p-3 border-b border-white/8 text-xs font-semibold text-dark-300 uppercase tracking-wider flex items-center justify-between">
                <span>Customers ({customers.length})</span>
                <span className="text-[10px] text-dark-400 md:hidden">Tap to view chat</span>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {customers.length === 0 ? (
                  <p className="text-dark-500 text-xs text-center py-10">No customer DMs yet</p>
                ) : (
                  customers.map(c => (
                    <button
                      key={c}
                      onClick={() => filterCustomerChat(selectedSession, c)}
                      className={`w-full text-left p-2.5 rounded-xl transition-all flex items-center gap-2.5 ${
                        selectedCustomer === c ? 'nav-active' : 'hover:bg-white/5 text-dark-300'
                      }`}
                    >
                      <div className="w-7 h-7 rounded-full bg-brand-600/20 flex items-center justify-center text-xs text-brand-300 flex-shrink-0">
                        <User className="w-3.5 h-3.5" />
                      </div>
                      <div className="truncate flex-1">
                        <p className="text-xs font-medium text-white truncate">
                          {c.replace('@c.us', '')}
                        </p>
                        <p className="text-[10px] text-dark-400">Customer</p>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* Conversation Thread Column */}
            <div
              className={`flex-1 flex flex-col bg-black/20 ${
                !selectedCustomer ? 'hidden md:flex' : 'flex'
              }`}
            >
              {/* Thread Header */}
              <div className="p-3 border-b border-white/8 px-4 flex items-center justify-between text-xs text-dark-300">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSelectedCustomer(null)}
                    className="md:hidden text-brand-400 hover:text-white font-semibold text-xs flex items-center gap-1 mr-1"
                  >
                    ← Customers
                  </button>
                  <span>
                    Customer:{' '}
                    <strong className="text-white">
                      {selectedCustomer ? selectedCustomer.replace('@c.us', '') : 'Select a customer'}
                    </strong>
                  </span>
                </div>
                <span className="text-[11px] text-dark-400">
                  {activeMessages.length} msgs
                </span>
              </div>

              {/* Messages Scroll Area */}
              <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3">
                {activeMessages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center">
                    <MessageSquare className="w-10 h-10 text-dark-500 mb-2" />
                    <p className="text-dark-300 text-sm">No messages with this contact yet</p>
                  </div>
                ) : (
                  activeMessages.map((msg, i) => (
                    <div
                      key={i}
                      className={`flex flex-col ${
                        msg.direction === 'outgoing' ? 'items-end' : 'items-start'
                      }`}
                    >
                      <div
                        className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm ${
                          msg.direction === 'outgoing'
                            ? msg.aiGenerated
                              ? 'bg-purple-900/40 border border-purple-500/30 text-purple-100'
                              : 'msg-user text-white'
                            : 'msg-ai text-dark-100'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 mb-1">
                          {msg.direction === 'outgoing' ? (
                            msg.aiGenerated ? (
                              <span className="text-[10px] bg-purple-500/30 text-purple-300 px-1.5 py-0.2 rounded-full font-semibold flex items-center gap-1">
                                <Bot className="w-3 h-3" /> AI Auto-Replied
                              </span>
                            ) : (
                              <span className="text-[10px] bg-brand-500/30 text-brand-300 px-1.5 py-0.2 rounded-full font-semibold flex items-center gap-1">
                                <User className="w-3 h-3" /> Owner Reply
                              </span>
                            )
                          ) : (
                            <span className="text-[10px] text-dark-400 font-mono">
                              Customer ({msg.from.replace('@c.us', '')})
                            </span>
                          )}
                        </div>
                        <p className="whitespace-pre-wrap">{msg.body}</p>
                        {msg.timestamp && (
                          <span className="text-[10px] text-dark-400 block mt-1 text-right">
                            {new Date(msg.timestamp).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Reply Input Bar */}
              <div className="p-3 border-t border-white/8 flex gap-2">
                {!selectedCustomer && (
                  <input
                    value={manualPhone}
                    onChange={e => setManualPhone(e.target.value)}
                    placeholder="Customer (+8801...)"
                    className="input-dark w-44 text-xs"
                  />
                )}
                <input
                  value={sendMsg}
                  onChange={e => setSendMsg(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && sendManualMessage()}
                  placeholder={
                    selectedCustomer
                      ? `Send manual reply to ${selectedCustomer.replace('@c.us', '')}...`
                      : 'Type message...'
                  }
                  className="input-dark flex-1 text-xs"
                />
                <button onClick={sendManualMessage} className="btn-primary px-4 py-2">
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
