'use client'
import { useState, useEffect, useRef } from 'react'
import {
  Smartphone, Plus, WifiOff, Send, Bot, CheckCircle2, Settings2, Trash2,
  RefreshCw, User, MessageSquare, Clock, Save, X, Mic, MicOff, Server, QrCode
} from 'lucide-react'
import { Download, Search } from 'lucide-react'
import { whatsappApi } from '@/lib/api'
import { io, Socket } from 'socket.io-client'
import { getToken, getSocketUrl } from '@/lib/auth'
import toast from 'react-hot-toast'

interface WAMessage {
  from: string
  to: string
  body: string
  mediaUrl?: string
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
  phoneNumber?: string | null
  lastError?: string | null
  qrCode?: string | null
  pairingCode?: string | null
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
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerLastActivity, setCustomerLastActivity] = useState<Record<string, number>>({})
  const [messages, setMessages] = useState<WAMessage[]>([])
  const [qrCodes, setQrCodes] = useState<Record<string, string>>({})
  // "Link with a code" alternative: per-session phone input, minted code, and
  // which session is currently generating one.
  const [pairingCodes, setPairingCodes] = useState<Record<string, string>>({})
  const [pairingPhone, setPairingPhone] = useState<Record<string, string>>({})
  const [codeBusy, setCodeBusy] = useState<string | null>(null)
  const [newSessionName, setNewSessionName] = useState('WhatsApp')
  const [newSessionPhone, setNewSessionPhone] = useState('')
  const [connectMethod, setConnectMethod] = useState<'code' | 'qr'>('code')
  const [showNewSession, setShowNewSession] = useState(false)
  const [sendMsg, setSendMsg] = useState('')
  const [manualPhone, setManualPhone] = useState('')
  const [muteFlag, setMuteFlag] = useState<Record<string, { muted: boolean; until: string | null; reason: string }>>({})
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [handoffMsgDraft, setHandoffMsgDraft] = useState('')
  const [muteWindowDraft, setMuteWindowDraft] = useState('5')
  const [muteState, setMuteState] = useState<{ muted: boolean; until: string | null; reason: string } | null>(null)
  const [promptDraft, setPromptDraft] = useState<Record<string, string>>({})
  // Reply tone is edited per session and only sent when the owner saves, so it needs the same
  // draft buffer as the custom prompt.
  const [toneDraft, setToneDraft] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const socketRef = useRef<Socket | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const selectedSessionRef = useRef<WASession | null>(null)
  const selectSession = (session: WASession | null) => {
    selectedSessionRef.current = session
    setSelectedSession(session)
  }
  const selectedCustomerRef = useRef<string | null>(null)
  const selectCustomer = (customer: string | null) => {
    selectedCustomerRef.current = customer
    setSelectedCustomer(customer)
  }

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

    // The one-time pairing code minted for "link with a code" login.
    socket.on('whatsapp-pairing-code', ({ sessionName, code }: any) => {
      setPairingCodes(prev => ({ ...prev, [sessionName]: code }))
      setCodeBusy(null)
      toast.success('Pairing code ready — enter it on your phone to link.')
    })

    // Generation failed or hung (WhatsApp throttled it) — release the button
    // and say why, instead of sitting on "Generating…" for ever.
    socket.on('whatsapp-pairing-error', ({ error }: any) => {
      setCodeBusy(null)
      toast.error(error || 'Could not generate a pairing code. Try again in a minute.')
    })

    socket.on('whatsapp-status', ({ sessionName, status, error }: any) => {
      setSessions(prev =>
        prev.map(s => (s.sessionName === sessionName ? {
          ...s,
          status,
          ...(status === 'connected' ? { qrCode: null, lastError: null } : {}),
          ...(error ? { lastError: error } : {}),
        } : s))
      )
      if (status === 'connected') {
        // The one-time pairing code is burned by a successful link.
        setPairingCodes(prev => { const n = { ...prev }; delete n[sessionName]; return n })
        toast.success('WhatsApp connected successfully!')
      } else if (status === 'error') {
        toast.error(error || 'WhatsApp could not connect. Check the session error for details.')
      }
    })

    socket.on('whatsapp-message', (data: any) => {
      const { message, senderContact } = data
      const currentSession = selectedSessionRef.current
      const matchesSession = currentSession && (
        data.sessionId
          ? String(data.sessionId) === String(currentSession._id)
          : data.sessionName === currentSession.sessionName
      )
      if (!matchesSession) return
      setMessages(prev => [...prev, message])
      if (message.from && message.from !== 'me') {
        setCustomers(prev => Array.from(new Set([...prev, message.from])))
      }
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    })
    socket.on('whatsapp-mute', (data: any) => {
      const { customer, mutedUntil, reason } = data
      if (customer === selectedCustomerRef.current) {
        setMuteFlag(prev => ({ ...prev, [customer]: { muted: true, until: mutedUntil, reason } }))
      }
    })
    socket.on('whatsapp-handoff', (data: any) => {
      const { customer, mutedUntil } = data
      if (customer === selectedCustomerRef.current) {
        setMuteFlag(prev => ({ ...prev, [customer]: { muted: true, until: mutedUntil, reason: 'handoff_request' } }))
      }
      toast.success(`🙋 ${customer.replace('@c.us','')} wants to talk to the owner — AI muted, waiting for you to respond`)
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
        const codeMap: Record<string, string> = {}
        d.sessions.forEach((s: WASession) => {
          if (s.qrCode) qrMap[s.sessionName] = s.qrCode
          if (s.pairingCode) codeMap[s.sessionName] = s.pairingCode
        })
        setQrCodes(prev => ({ ...prev, ...qrMap }))
        setPairingCodes(prev => ({ ...prev, ...codeMap }))

        // Keep selectedSession synced
        if (selectedSessionRef.current) {
          const updated = d.sessions.find((s: WASession) => s._id === selectedSessionRef.current?._id)
          if (updated) selectSession(updated)
        }
      }
    } catch (err: any) {
      if (showToast) toast.error(err.message)
    }
  }

  const createSession = async () => {
    const name = newSessionName.trim() || 'WhatsApp'
    const phone = newSessionPhone.trim()
    if (connectMethod === 'code') {
      const digitsOnly = phone.replace(/[^0-9]/g, '')
      if (digitsOnly.length < 7) {
        toast.error('Enter your WhatsApp phone number (e.g. 018... or 88018...)')
        return
      }
    }
    setLoading(true)
    try {
      const d: any = await whatsappApi.createSession(name, connectMethod === 'code' ? phone : undefined)
      setSessions(prev => [...prev.filter(s => s._id !== d.session._id), d.session])
      if (connectMethod === 'code') {
        setCodeBusy(d.session._id)
        toast.success('Generating your 8-digit pairing code… Ready in ~10 seconds!')
      } else {
        toast.success('Session started! QR code will appear in seconds...')
      }
      setNewSessionName('WhatsApp')
      setNewSessionPhone('')
      setShowNewSession(false)
      loadSessions(false)
    } catch (err: any) {
      toast.error(err.message)
      await loadSessions(false)
    } finally {
      setLoading(false)
    }
  }

  const disconnectSession = async (id: string) => {
    try {
      await whatsappApi.disconnect(id)
      const target = sessions.find(s => s._id === id)
      if (target) {
        setPairingCodes(prev => { const n = { ...prev }; delete n[target.sessionName]; return n })
        setQrCodes(prev => { const n = { ...prev }; delete n[target.sessionName]; return n })
      }
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
      if (selectedSessionRef.current?._id === id) {
        selectSession(null)
        setMessages([])
      }
      toast.success('Session deleted')
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  // Mint an 8-char pairing code for this session (link-by-code, no QR scan). The
  // code arrives over the `whatsapp-pairing-code` socket event, not in this reply.
  const requestCode = async (session: WASession) => {
    const phone = (pairingPhone[session.sessionName] || '').trim()
    if (phone.replace(/[^0-9]/g, '').length < 7) {
      toast.error('Enter your full phone number with country code (e.g. 8801712345678)')
      return
    }
    setCodeBusy(session._id)
    // The old QR is dead the moment we relaunch in code mode — clear both so a
    // stale QR never sits next to the new code.
    setPairingCodes(prev => { const n = { ...prev }; delete n[session.sessionName]; return n })
    setQrCodes(prev => { const n = { ...prev }; delete n[session.sessionName]; return n })
    try {
      const res: any = await whatsappApi.requestPairingCode(session._id, phone)
      toast.loading(res?.message || 'Generating your pairing code…', { id: 'wa-code' })
      setTimeout(() => toast.dismiss('wa-code'), 4000)
    } catch (err: any) {
      toast.error(err.message || 'Could not generate a code')
      setCodeBusy(null)
    }
  }

  const openCustomerChats = async (session: WASession) => {
    selectSession(session)
    try {
      const d: any = await whatsappApi.getMessages(session._id)
      setCustomers(d.customers || [])
      setMessages(d.messages || [])
      setCustomerSearch('')
      const lastActivity: Record<string, number> = {}
      for (const message of d.messages || []) {
        const contact = message.direction === 'incoming' ? message.from : message.to
        const at = new Date(message.timestamp || 0).getTime()
        if (contact && contact !== 'me' && Number.isFinite(at)) {
          lastActivity[contact] = Math.max(lastActivity[contact] || 0, at)
        }
      }
      setCustomerLastActivity(lastActivity)
      if (d.customers && d.customers.length > 0) {
        selectCustomer(d.customers[0])
      } else {
        selectCustomer(null)
      }
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const filterCustomerChat = async (session: WASession, contact: string) => {
    selectCustomer(contact)
    try {
      const d: any = await whatsappApi.getMessages(session._id, contact)
      setMessages(d.messages || [])
      await loadMuteState(session._id, contact)
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const loadMuteState = async (sessionId: string, customer: string) => {
    try {
      const d: any = await whatsappApi.getMuteState(sessionId, customer)
      if (d?.success) setMuteFlag(prev => ({ ...prev, [customer]: { muted: d.muted, until: d.until, reason: d.reason } }))
    } catch {
      // session never written to the database yet (fresh session) — ignore
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
      if (selectedSessionRef.current?._id === session._id) selectSession(d.session)
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
      if (selectedSessionRef.current?._id === session._id) selectSession(d.session)
      toast.success('Reply settings saved')
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const activeMessages = selectedCustomer
    ? messages.filter(m => m.from === selectedCustomer || m.to === selectedCustomer)
    : messages
  const visibleCustomers = customers
    .filter(customer => customer.replace('@c.us', '').toLowerCase().includes(customerSearch.trim().toLowerCase()))
    .sort((a, b) => (customerLastActivity[b] || 0) - (customerLastActivity[a] || 0))

  const exportHistory = async () => {
    if (!selectedSession) return
    try {
    const backup = await whatsappApi.exportHistory(selectedSession._id)
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `herovaai-whatsapp-${selectedSession._id}-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast.success('WhatsApp history backup downloaded')
    } catch (err: any) {
    toast.error(err.message || 'Could not export WhatsApp history')
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-1 text-[10.5px] font-bold uppercase tracking-[0.22em] text-brand-400/80">Channels</p>
          <h1 className="flex items-center gap-2 text-[22px] font-semibold tracking-tight text-white">
            WhatsApp automation
            <span className="badge badge-green">{sessions.filter(s => s.status === 'connected').length} live</span>
          </h1>
          <p className="mt-1 max-w-2xl text-[13px] text-dark-400">
            Link your shop number, switch on AI replies, then send a test message from another phone.
            You can pause replies here at any time.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => loadSessions()} className="btn-ghost btn-sm">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
          <button onClick={() => setShowNewSession(true)} className="btn-primary btn-sm btn-sheen">
            <Plus className="h-3.5 w-3.5" /> Connect account
          </button>
        </div>
      </div>

      {/* Connect Form */}
      {showNewSession && (
        <div className="card animate-fade-up p-5 border-cyan-400/30 space-y-4 shadow-xl">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-[15px] font-semibold text-white">
              <Smartphone className="h-4 w-4 text-cyan-300" />
              Connect a WhatsApp Account
            </h3>
            <button onClick={() => setShowNewSession(false)} className="text-xs text-dark-400 hover:text-white transition">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Connection Mode Selector */}
          <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-black/40 border border-white/10">
            <button
              type="button"
              onClick={() => setConnectMethod('code')}
              className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-medium transition ${
                connectMethod === 'code'
                  ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-400/40 shadow-sm'
                  : 'text-dark-400 hover:text-dark-200'
              }`}
            >
              <Smartphone className="h-3.5 w-3.5 text-cyan-400" />
              <span>Link with Phone Number <span className="text-[10px] bg-cyan-400/20 text-cyan-200 px-1.5 py-0.5 rounded font-bold ml-1">EASIEST</span></span>
            </button>
            <button
              type="button"
              onClick={() => setConnectMethod('qr')}
              className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-medium transition ${
                connectMethod === 'qr'
                  ? 'bg-brand-500/20 text-brand-200 border border-brand-400/40 shadow-sm'
                  : 'text-dark-400 hover:text-dark-200'
              }`}
            >
              <QrCode className="h-3.5 w-3.5 text-brand-400" />
              <span>Scan QR Code</span>
            </button>
          </div>

          {connectMethod === 'code' ? (
            <div className="space-y-3 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.04] p-4">
              <div className="rounded-lg bg-black/30 p-2.5 border border-cyan-400/10">
                <p className="text-[12px] font-medium text-cyan-200 mb-1">
                  ✨ No camera scanning needed:
                </p>
                <ol className="text-[11.5px] text-dark-300 space-y-1 list-decimal list-inside">
                  <li>Enter the WhatsApp number you want HerovaAi to use and click <strong>&quot;Get 8-Digit Pairing Code&quot;</strong></li>
                  <li>On your phone, open WhatsApp → <strong>⋮ (Menu) → Linked Devices → Link a Device</strong></li>
                  <li>Tap <strong>&quot;Link with phone number instead&quot;</strong> at the bottom</li>
                  <li>Type the 8-digit code shown on screen — <strong>done!</strong></li>
                </ol>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-[11px] font-medium text-dark-300 mb-1">Account Label</label>
                  <input
                    value={newSessionName}
                    onChange={e => setNewSessionName(e.target.value)}
                    placeholder="e.g. Sales Desk or My Shop"
                    className="input-dark w-full"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-dark-300 mb-1">WhatsApp Phone Number</label>
                  <input
                    type="tel"
                    value={newSessionPhone}
                    onChange={e => setNewSessionPhone(e.target.value)}
                    placeholder="Your WhatsApp number, including country code"
                    className="input-dark w-full"
                    onKeyDown={e => e.key === 'Enter' && createSession()}
                  />
                  <p className="mt-1 text-[10.5px] text-dark-400">Use the number on the phone you want to link. Include your country code (for Bangladesh: 880…).</p>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={createSession}
                  disabled={loading}
                  className="rounded-lg bg-cyan-500 hover:bg-cyan-400 text-black px-4 py-2 text-xs font-semibold shadow-md transition disabled:opacity-50"
                >
                  {loading ? 'Starting…' : 'Get 8-Digit Pairing Code'}
                </button>
                <button onClick={() => setShowNewSession(false)} className="btn-ghost">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3 rounded-xl border border-brand-400/20 bg-brand-400/[0.04] p-4">
              <p className="text-[12.5px] leading-relaxed text-dark-300">
                A QR code will be generated on screen. On your phone, open WhatsApp → <strong>Linked Devices → Link a Device</strong>, then scan it.
              </p>
              <div>
                <label className="block text-[11px] font-medium text-dark-300 mb-1">Account Label</label>
                <input
                  value={newSessionName}
                  onChange={e => setNewSessionName(e.target.value)}
                  placeholder="Optional label, e.g. Shop WhatsApp"
                  className="input-dark w-full max-w-md"
                  onKeyDown={e => e.key === 'Enter' && createSession()}
                />
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button onClick={createSession} disabled={loading} className="btn-primary">
                  {loading ? 'Starting browser…' : 'Generate QR Code'}
                </button>
                <button onClick={() => setShowNewSession(false)} className="btn-ghost">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Sessions list */}
      {sessions.length === 0 ? (
        <div className="card">
          <div className="empty">
            <span className="empty-icon"><Smartphone className="h-5 w-5" /></span>
            <div>
              <p className="text-[14px] font-medium text-dark-100">No WhatsApp account connected</p>
              <p className="mx-auto mt-1 max-w-md text-[12.5px] leading-relaxed text-dark-500">
                Pair a number to let HerovaAi answer customer DMs with your business memory. Replies
                keep going while you are away, and you can pause any customer from the thread view.
              </p>
            </div>
            <button onClick={() => setShowNewSession(true)} className="btn-primary btn-sm">
              <Plus className="h-3.5 w-3.5" /> Connect a number
            </button>
          </div>
        </div>
      ) : (
        <div className="stagger grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sessions.map(session => {
            const statusCfg =
              STATUS_CONFIG[session.status as keyof typeof STATUS_CONFIG] ||
              STATUS_CONFIG.disconnected
            const qr = qrCodes[session.sessionName] || session.qrCode
            const dotTone = session.status === 'connected'
              ? 'dot-live'
              : session.status === 'error'
                ? 'dot-error'
                : session.status === 'qr_pending'
                  ? 'dot-warn'
                  : 'dot-idle'

            return (
              <div
                key={session._id}
                className={`card space-y-4 p-5 ${selectedSession?._id === session._id ? 'card-gold' : ''}`}
              >
                {/* Session Header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold text-white">
                      {session.sessionName.includes('_')
                        ? session.sessionName.split('_').slice(1).join('_')
                        : session.sessionName}
                    </h3>
                    <div className="mt-1 flex items-center gap-1.5">
                      <span className={`dot ${dotTone}`} aria-hidden />
                      <span className={`text-xs ${statusCfg.color}`}>{statusCfg.label}</span>
                    </div>
                    {session.lastError && (
                      <p className="mt-1 max-w-[240px] text-[10.5px] text-red-300/85">
                        {session.lastError}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => deleteSession(session._id)}
                    aria-label="Delete session"
                    className="icon-btn icon-btn-danger flex-none h-7 w-7"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* QR Code Display — shown ONLY when NOT in phone pairing mode */}
                {session.status === 'qr_pending' && !session.phoneNumber && !pairingCodes[session.sessionName] && !session.pairingCode && codeBusy !== session._id && (
                  <div className="flex flex-col items-center rounded-xl border border-brand-400/25 bg-brand-400/[0.04] p-3">
                    <p className="mb-2 flex items-center gap-1 text-xs font-medium text-brand-200">
                      <Clock className="h-3.5 w-3.5" aria-hidden /> Scan with WhatsApp
                    </p>
                    {qr ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={qr}
                        alt="WhatsApp QR code"
                        className="h-48 w-48 rounded-xl border border-brand-400/40 bg-white p-2 shadow-lift"
                      />
                    ) : (
                      <div className="flex h-48 w-48 flex-col items-center justify-center gap-2 rounded-xl border border-white/10 bg-black/40">
                        <span className="skeleton h-6 w-6 rounded-full" />
                        <span className="text-[11px] text-dark-300">Generating QR…</span>
                      </div>
                    )}
                    <p className="mt-2 text-center text-[10.5px] text-dark-500">
                      The code refreshes automatically; scan the newest one.
                    </p>
                  </div>
                )}

                {/* Pairing Code Display (Link with Phone Number) */}
                {session.status === 'qr_pending' && (
                  <div className="rounded-xl border border-cyan-400/25 bg-cyan-400/[0.04] p-3.5 shadow-sm">
                    <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-cyan-200">
                      <Smartphone className="h-3.5 w-3.5 text-cyan-400" aria-hidden /> Link with Phone Number
                    </p>
                    {(() => {
                      const activeCode = pairingCodes[session.sessionName] || session.pairingCode
                      const isGenerating = codeBusy === session._id || (!activeCode && session.phoneNumber)

                      if (isGenerating) {
                        return (
                          <div className="flex flex-col items-center gap-2.5 py-4">
                            <span className="h-7 w-7 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
                            <p className="text-[13px] font-semibold text-cyan-200">
                              Generating 8-digit code{session.phoneNumber ? ` for ${session.phoneNumber}` : ''}…
                            </p>
                            <p className="text-[11px] text-dark-400">Takes about 10–15 seconds. Keep this page open.</p>
                          </div>
                        )
                      }

                      if (activeCode) {
                        return (
                          <div className="flex flex-col items-center gap-2.5 py-1">
                            <p className="mono-num select-all rounded-xl border border-cyan-400/50 bg-black/60 px-5 py-2.5 text-[26px] font-extrabold tracking-[0.25em] text-cyan-100 shadow-inner">
                              {activeCode.length === 8 ? `${activeCode.slice(0, 4)}-${activeCode.slice(4)}` : activeCode}
                            </p>
                            <div className="rounded-lg bg-black/40 p-2.5 border border-white/5 text-center">
                              <p className="text-[11.5px] text-dark-200 font-medium">
                                On your phone:
                              </p>
                              <p className="text-[11px] text-dark-300 mt-0.5">
                                WhatsApp → <strong className="text-white">Linked devices</strong> → <strong className="text-white">Link a device</strong> → <strong className="text-cyan-300">&quot;Link with phone number instead&quot;</strong> → type this code.
                              </p>
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <button
                                type="button"
                                onClick={() => {
                                  navigator.clipboard?.writeText(activeCode.length === 8 ? `${activeCode.slice(0, 4)}-${activeCode.slice(4)}` : activeCode)
                                  toast.success('Pairing code copied!')
                                }}
                                className="rounded-lg bg-cyan-500/20 border border-cyan-400/40 px-3 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/30 transition"
                              >
                                Copy code
                              </button>
                              <button
                                type="button"
                                onClick={() => requestCode(session)}
                                disabled={codeBusy === session._id}
                                className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-dark-300 hover:text-white transition disabled:opacity-50"
                              >
                                New code
                              </button>
                            </div>
                          </div>
                        )
                      }

                      return (
                        <div className="flex flex-col gap-2">
                          <p className="text-[11px] leading-relaxed text-dark-400">
                            Enter your WhatsApp number to get an 8-digit code instead of scanning.
                          </p>
                          <div className="flex items-center gap-2">
                            <input
                              type="tel"
                              inputMode="numeric"
                              value={pairingPhone[session.sessionName] || ''}
                              onChange={e => setPairingPhone(prev => ({ ...prev, [session.sessionName]: e.target.value }))}
                              placeholder="e.g. 01832123456 or 8801832123456"
                              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 text-xs text-white placeholder-dark-600 focus:border-cyan-400/50 focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => requestCode(session)}
                              disabled={codeBusy === session._id}
                              className="flex-none rounded-lg bg-cyan-500/20 border border-cyan-400/40 px-3 py-1.5 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-500/30 disabled:opacity-50"
                            >
                              {codeBusy === session._id ? 'Starting…' : 'Get code'}
                            </button>
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                )}

                {/* Connected Badge */}
                {session.status === 'connected' && (
                  <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.07] px-3 py-2 text-xs text-emerald-300">
                    <CheckCircle2 className="h-4 w-4 flex-none" aria-hidden />
                    <span>
                      Number linked. {session.autoReply
                        ? 'AI replies are on — send a test message from another phone.'
                        : 'AI replies are still off. Switch them on below when you are ready, then test from another phone.'}
                    </span>
                  </div>
                )}

                {/* Counters */}
                <div className="grid grid-cols-2 gap-2 text-center">
                  <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-2">
                    <p className="mono-num text-[17px] font-semibold text-white">{session.totalMessagesReceived || 0}</p>
                    <p className="text-[11px] text-dark-500">incoming</p>
                  </div>
                  <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-2">
                    <p className="mono-num text-[17px] font-semibold text-white">{session.totalMessagesSent || 0}</p>
                    <p className="text-[11px] text-dark-500">AI / sent</p>
                  </div>
                </div>

                {/* AI Auto-reply Toggle */}
                <div className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] p-3">
                  <div className="flex items-center gap-2">
                    <Bot className="h-4 w-4 text-brand-400" aria-hidden />
                    <div>
                      <span className="block text-xs font-semibold text-white">Reply to new customer messages</span>
                      <span className="text-[10.5px] text-dark-400">
                        {session.autoReply
                          ? 'On — HerovaAi will reply using your business details. Switch off to pause.'
                          : 'Off — no automatic replies are being sent.'}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={session.autoReply}
                    aria-label={`AI auto-reply for ${session.sessionName}`}
                    onClick={() => toggleAutoReply(session)}
                    className={`switch ${session.autoReply ? 'switch-on' : ''}`}
                  />
                </div>

                {/* AI Reply Tone & Owner Instructions */}
                <div className="p-3 rounded-xl bg-white/5 space-y-2">
                  <span className="text-xs font-semibold text-white block">Reply Tone &amp; Instructions</span>
                  <input
                    className="input-dark text-xs"
                    placeholder="Tone (e.g. warm, formal, short replies)"
                    defaultValue={session.tone || ''}
                    onChange={e => setToneDraft(prev => ({ ...prev, [session._id]: e.target.value }))}
                  />
                  <textarea
                    className="input-dark text-xs min-h-[60px]"
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
        <div className="card mt-1 animate-fade-up overflow-hidden p-0">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/[0.06] bg-black/20 p-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500/15 text-brand-300">
                <MessageSquare className="h-4 w-4" aria-hidden />
              </div>
              <div className="min-w-0">
                <h3 className="text-[13.5px] font-semibold text-white">
                  Customer chats &amp; AI replies —{' '}
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
            <div className="flex flex-none items-center gap-1.5">
              <button type="button" onClick={exportHistory} className="btn-ghost text-xs py-1.5" title="Download the retained chat history as JSON">
                <Download className="h-3 w-3" /> <span className="hidden sm:inline">Backup</span>
              </button>
              <button
                onClick={() => openCustomerChats(selectedSession)}
                className="btn-ghost text-xs py-1.5"
              >
                <RefreshCw className="w-3 h-3" /> <span className="hidden sm:inline">Refresh</span>
              </button>
            </div>
          </div>

          <div className="flex flex-col md:flex-row h-[500px]">
            {/* Customer List Column */}
            <div
              className={`w-full md:w-64 border-b md:border-b-0 md:border-r border-white/8 flex flex-col bg-black/10 ${
                selectedCustomer ? 'hidden md:flex' : 'flex'
              }`}
            >
              <div className="border-b border-white/8 p-3">
                <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-dark-300">
                <span>Customers ({customers.length})</span>
                <span className="text-[10px] text-dark-400 md:hidden">Tap to view chat</span>
                </div>
                <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-2.5 py-2">
                  <Search className="h-3.5 w-3.5 flex-none text-dark-500" aria-hidden />
                  <input
                    value={customerSearch}
                    onChange={event => setCustomerSearch(event.target.value)}
                    placeholder="Find a customer"
                    aria-label="Search customer conversations"
                    className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-dark-500"
                  />
                </label>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {customers.length === 0 ? (
                  <p className="text-dark-500 text-xs text-center py-10">No customer DMs yet</p>
                ) : visibleCustomers.length === 0 ? (
                  <p className="text-dark-500 text-xs text-center py-10">No customers match that search</p>
                ) : (
                  visibleCustomers.map(c => (
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
                        <p className="text-[10px] text-dark-400">
                          {customerLastActivity[c] ? new Date(customerLastActivity[c]).toLocaleDateString() : 'Customer'}
                        </p>
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
                    onClick={() => selectCustomer(null)}
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

               {selectedCustomer && selectedSession && selectedSession.autoReply && (
                 <div className="px-4 pb-1 flex items-center gap-2">
                   {muteFlag[selectedCustomer]?.muted ? (
                     <>
                       <span className="text-[11px] text-red-300 flex items-center gap-1.5">
                         <MicOff className="w-3.5 h-3.5" /> AI muted
                         {muteFlag[selectedCustomer]?.until && (
                           <Clock className="w-3 h-3" />
                         )}
                       </span>
                       <div className="flex items-center gap-1.5">
                         <button
                           onClick={() => setSettingsOpen(true)}
                           className="p-1.5 rounded-lg text-dark-400 hover:bg-white/10 hover:text-white transition-all"
                           title="Change the owner-pause time or who gets the owner response"
                         >
                           <Settings2 className="w-3.5 h-3.5" />
                         </button>
                         <button
                           onClick={async () => {
                             try {
                               await whatsappApi.unmuteMessage(selectedSession!._id, selectedCustomer)
                               setMuteFlag(prev => ({ ...prev, [selectedCustomer]: { muted: false, until: null, reason: '' } }))
                               toast.success('AI resumed — you can reply again now')
                             } catch (err: any) {
                               toast.error(err.message)
                             }
                           }}
                           className="btn-ghost text-xs py-1 px-3 text-white"
                         >
                           ▶ Resume AI
                         </button>
                       </div>
                     </>
                   ) : (
                     <>
                       <span className="text-[11px] text-dark-400 flex items-center gap-1.5">
                         <Mic className="w-3.5 h-3.5" /> AI answering
                       </span>
                       <button
                         onClick={async () => {
                           try {
                             await whatsappApi.muteMessage(selectedSession!._id, selectedCustomer, 'manual')
                             setMuteFlag(prev => ({ ...prev, [selectedCustomer]: { muted: true, until: null, reason: 'manual' } }))
                             toast.success('Owner is writing — AI paused (5 min default)')
                           } catch (err: any) {
                             toast.error(err.message)
                           }
                         }}
                         className="btn-ghost text-xs py-1 px-3 text-white"
                       >
                         🔇 Take over
                       </button>
                     </>
                   )}
                 </div>
               )}

              {/* Messages Scroll Area */}
              <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3">
                {activeMessages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center">

  {/* ── Reply + owner-pause settings dialog ── */}
  {settingsOpen && (
    <div className="fixed inset-0 z-[70] flex animate-fade-in items-center justify-center bg-black/70 p-4 backdrop-blur-md" onClick={() => setSettingsOpen(false)}>
      <div className="w-[560px] max-w-full animate-scale-in rounded-2xl border border-white/[0.09] bg-dark-900/97 p-6 shadow-[0_40px_120px_-40px_rgba(0,0,0,1)]" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Owner and AI controls">
        <div className="mb-4 flex items-center gap-2">
          <Server className="h-4 w-4 text-brand-300" aria-hidden />
          <h3 className="text-[15px] font-semibold text-white">Owner + AI controls</h3>
          <button onClick={() => setSettingsOpen(false)} className="icon-btn ml-auto" aria-label="Close settings"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 text-xs text-dark-300">
          <div>
            <label className="text-[11px] font-semibold text-dark-200">How long the AI stays silent after the owner speaks</label>
            <input
              className="input-dark mt-1 text-sm"
              type="number" min={1} max={1440} value={muteWindowDraft}
              onChange={e => setMuteWindowDraft(e.target.value)}
              placeholder="5 min default"
            />
            <p className="text-[10px] text-dark-500 mt-1">Owner speaks → AI pauses that conversation for this many minutes. Every owner message re-arms the timer.</p>
          </div>
          <div className="border-t border-white/10 pt-3">
            <label className="text-[11px] font-semibold text-dark-200">What the AI says when a customer asks for the real owner</label>
            <textarea
              className="input-dark min-h-[56px] text-sm"
              value={handoffMsgDraft}
              onChange={e => setHandoffMsgDraft(e.target.value)}
              placeholder="e.g. Sure! 🙏 I've alerted {ownerName} at {bizName} — you'll hear from the owner personally here very soon."
            />
            <p className="text-[10px] text-dark-500 mt-1">Leave empty to skip the alert to the owner; the AI still pauses and the owner gets a dashboard alert either way.</p>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={() => setSettingsOpen(false)} className="btn-ghost text-xs py-2 flex-1">Cancel</button>
            <button onClick={async () => {
              try {
                await whatsappApi.updateSettings(selectedSession!._id, {
                  ownerMuteMinutes: Number(muteWindowDraft) || 5,
                  handoffMessage: handoffMsgDraft,
                })
                setSettingsOpen(false)
                toast.success('Owner + AI controls saved')
              } catch (err: any) {
                toast.error(err.message)
              }
            }} className="btn-primary text-xs py-2 flex-1">Save settings</button>
          </div>
        </div>
      </div>
    </div>
  )}

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
                        {msg.mediaUrl && (
                          <div className="mb-2 rounded-lg overflow-hidden max-w-xs border border-white/10">
                            {msg.mediaUrl.match(/\.(mp4|webm|mov)$/i) ? (
                              <video src={msg.mediaUrl} controls className="rounded-lg max-h-56 w-auto" />
                            ) : (
                              <img src={msg.mediaUrl} alt="WhatsApp media" className="rounded-lg max-h-56 w-auto object-cover" />
                            )}
                          </div>
                        )}
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
