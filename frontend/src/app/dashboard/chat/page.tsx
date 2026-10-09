'use client'
import { useState, useEffect, useRef, FormEvent } from 'react'
import {
  Send, Plus, Trash2, Bot, User, Zap, Loader2, Sparkles,
  Paperclip, Image as ImageIcon, X, Play, Code, Download,
  Maximize2, Minimize2, Globe, Gamepad2, Code2, BarChart3,
  CreditCard, FileText, ChevronDown, ChevronUp, Check,
  Brain, Cloud, Cpu, MessageSquare, Search, Settings2, Square
} from 'lucide-react'
import { chatApi } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import toast from 'react-hot-toast'
import ReactMarkdown from 'react-markdown'
import Link from 'next/link'

interface Attachment { name: string; mimeType: string; data: string; size: number }
interface Artifact   { title: string; type: string; code: string; language: string }
interface Message {
  role: 'user' | 'assistant'
  content: string; model?: string; tokens?: number
  attachments?: Attachment[]; artifacts?: Artifact[]; timestamp?: string
}
interface Conversation { _id: string; title: string; mode: string; model?: string; skill?: string; updatedAt: string }
interface AIModel {
  id: string; name: string; source: 'api' | 'local' | 'contentbot'
  tier: 'free' | 'paid'; isPaid: boolean; badge: string
  description?: string; multimodal?: boolean; group?: string
  availability?: string; servable?: boolean; pricing?: { prompt: number; completion: number } | null
}

const SKILL_OPTIONS = [
  { id: 'general',    name: 'General AI',    icon: Bot,       desc: 'Conversational assistant',        color: 'text-cyan-400' },
  { id: 'webapp',     name: 'Web App',        icon: Globe,     desc: 'Single-file HTML/Tailwind apps', color: 'text-blue-400' },
  { id: 'game',       name: 'HTML5 Game',     icon: Gamepad2,  desc: 'Playable canvas games',          color: 'text-purple-400' },
  { id: 'program',    name: 'Code Tool',      icon: Code2,     desc: 'Scripts & utilities',            color: 'text-green-400' },
  { id: 'visualizer', name: 'Data Chart',     icon: BarChart3, desc: 'Interactive charts',             color: 'text-amber-400' },
]

export default function ChatPage() {
  const { user } = useAuth()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConvId, setActiveConvId] = useState<string | null>(null)
  /** Sidebar filter — long histories are unusable without one. */
  const [convQuery, setConvQuery] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [mode, setMode] = useState<'api' | 'local' | 'contentbot'>('api')
  const [selectedModel, setSelectedModel] = useState<string>('nvidia/nemotron-3.5-lightning:free')
  const [selectedSkill, setSelectedSkill] = useState<string>('general')
  const [models, setModels] = useState<AIModel[]>([])
  const [lmStudioOnline, setLmStudioOnline] = useState(false)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [tokenQuota, setTokenQuota] = useState<any>(null)
  const [activeArtifact, setActiveArtifact] = useState<Artifact | null>(null)
  const [showCode, setShowCode] = useState(false)
  const [modalFullscreen, setModalFullscreen] = useState(false)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

  // Bottom-bar pickers
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [skillPickerOpen, setSkillPickerOpen] = useState(false)
  const [modePickerOpen, setModePickerOpen] = useState(false)

  const bottomRef    = useRef<HTMLDivElement>(null)
  const textareaRef  = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const modelRef     = useRef<HTMLDivElement>(null)
  const skillRef     = useRef<HTMLDivElement>(null)
  const modeRef      = useRef<HTMLDivElement>(null)
  const abortRef     = useRef<AbortController | null>(null)

  useEffect(() => {
    loadConversations(); loadModels(); loadQuota()
    const handleLeave = () => { try { navigator.sendBeacon('/api/chat/lm-studio/unload') } catch {} chatApi.unloadModel().catch(() => {}) }
    window.addEventListener('beforeunload', handleLeave)
    return () => { window.removeEventListener('beforeunload', handleLeave); chatApi.unloadModel().catch(() => {}) }
  }, [])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, sending])

  // Close any picker on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (modelRef.current && !modelRef.current.contains(e.target as Node)) setModelPickerOpen(false)
      if (skillRef.current && !skillRef.current.contains(e.target as Node)) setSkillPickerOpen(false)
      if (modeRef.current  && !modeRef.current.contains(e.target as Node))  setModePickerOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const loadQuota = async () => { try { const r: any = await chatApi.getQuota(); if (r.success) setTokenQuota(r.quota) } catch {} }

  const loadModels = async () => {
    try {
      const d: any = await chatApi.getModels()
      if (d.models) {
        setModels(d.models); setLmStudioOnline(Boolean(d.lmStudioOnline))
        const avail = d.models.filter((m: AIModel) => m.source === mode)
        if (avail.length > 0) setSelectedModel((avail.find((m: AIModel) => m.id === selectedModel) || avail[0]).id)
      }
    } catch {}
  }

  useEffect(() => {
    const avail = models.filter(m => m.source === mode)
    if (avail.length > 0) setSelectedModel((avail.find(m => m.id === selectedModel) || avail[0]).id)
  }, [mode])

  const loadConversations = async () => { try { const d: any = await chatApi.getConversations(); setConversations(d.conversations || []) } catch {} }

  const newChat = async () => {
    try {
      const d: any = await chatApi.createConversation(mode, selectedModel, selectedSkill)
      setActiveConvId(d.conversation._id); setMessages([]); setAttachments([])
      setConversations(prev => [d.conversation, ...prev])
    } catch (err: any) { toast.error(err.message) }
  }

  const selectConversation = async (id: string) => {
    setActiveConvId(id); setAttachments([])
    try {
      const d: any = await chatApi.getConversation(id)
      setMessages(d.conversation.messages || [])
      if (d.conversation.mode)  setMode(d.conversation.mode)
      if (d.conversation.model) setSelectedModel(d.conversation.model)
      if (d.conversation.skill) setSelectedSkill(d.conversation.skill)
    } catch (err: any) { toast.error(err.message) }
  }

  const deleteConversation = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await chatApi.deleteConversation(id)
      setConversations(prev => prev.filter(c => c._id !== id))
      if (activeConvId === id) { setActiveConvId(null); setMessages([]) }
      toast.success('Deleted')
    } catch (err: any) { toast.error(err.message) }
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files; if (!files?.length) return
    Array.from(files).forEach(file => {
      if (file.size > 20 * 1024 * 1024) { toast.error(`${file.name} too large`); return }
      const reader = new FileReader()
      reader.onload = () => setAttachments(prev => [...prev, { name: file.name, mimeType: file.type || 'application/octet-stream', data: reader.result as string, size: file.size }])
      reader.readAsDataURL(file)
    })
    e.target.value = ''
  }

  const sendMessage = async (e: FormEvent) => {
    e.preventDefault()
    if ((!input.trim() && !attachments.length) || sending) return
    let convId = activeConvId
    if (!convId) {
      try { const d: any = await chatApi.createConversation(mode, selectedModel, selectedSkill); convId = d.conversation._id; setActiveConvId(convId); setConversations(prev => [d.conversation, ...prev]) }
      catch (err: any) { toast.error(err.message); return }
    }
    const currentInput = input; const currentAttachments = [...attachments]
    setMessages(prev => [...prev, { role: 'user', content: currentInput, attachments: currentAttachments, timestamp: new Date().toISOString() }])
    setInput(''); setAttachments([]); setSending(true)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const d: any = await chatApi.sendMessage(convId!, currentInput, mode, selectedModel, currentAttachments, selectedSkill, controller.signal)
      setMessages(prev => [...prev, d.aiMessage]); loadQuota()
      if (d.artifacts?.length > 0) toast.success(`✨ ${d.artifacts.length} artifact generated! Tap Run to preview.`)
      setConversations(prev => prev.map(c => c._id === convId ? { ...c, title: (currentInput || 'File').slice(0, 40) } : c))
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        toast('⏹ Generation stopped', { icon: '🛑' })
      } else {
        toast.error(err.message)
        setMessages(prev => [...prev, { role: 'assistant', content: `⚠️ ${err.message}` }])
      }
    } finally { setSending(false); abortRef.current = null }
  }

  // Stop button: cancel the browser fetch AND abort the upstream AI call on the
  // backend, so a stuck "thinking" reply frees both sides (no ghost message
  // appears later from the request we abandoned).
  const stopGeneration = () => {
    abortRef.current?.abort()
    if (activeConvId) chatApi.stopMessage(activeConvId).catch(() => {})
    setSending(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(e as any) }
  }

  const downloadArtifact = (art: Artifact) => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([art.code], { type: 'text/html' }))
    a.download = `${art.title.toLowerCase().replace(/[^a-z0-9]/g, '_')}.html`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    toast.success('Downloaded!')
  }

  const currentModels = models.filter(m => m.source === mode)
  const currentModelObj = models.find(m => m.id === selectedModel)
  const activeSkillObj  = SKILL_OPTIONS.find(s => s.id === selectedSkill) || SKILL_OPTIONS[0]
  const SkillIcon = activeSkillObj.icon

  // Group models for the picker — verified-servable first so the menu leads
  // with models that answer; unverified entries stay selectable (the backend
  // attempts them once and reports truthfully instead of silent-failover).
  const modelGroups = [...currentModels]
    .sort((a, b) => Number(b.servable ?? true) - Number(a.servable ?? true))
    .reduce((acc, m) => {
      const g = m.group || 'Other'
      if (!acc[g]) acc[g] = []
      acc[g].push(m)
      return acc
    }, {} as Record<string, AIModel[]>)

  const quotaPct = tokenQuota ? Math.min(100, Math.round((tokenQuota.tokensUsed7d / tokenQuota.weeklyLimit) * 100)) : 0

  const filteredConversations = convQuery.trim()
    ? conversations.filter(c => (c.title || '').toLowerCase().includes(convQuery.trim().toLowerCase()))
    : conversations

  /* ───── Conversation sidebar ───── */
  const Sidebar = () => (
    <div className="flex flex-col h-full">
      <div className="p-3 flex-shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <button onClick={() => { newChat(); setMobileSidebarOpen(false) }} className="btn-primary w-full justify-center text-sm py-2.5 rounded-xl">
          <Plus className="w-4 h-4" /> New Chat
        </button>
      </div>
      {conversations.length > 2 ? (
        <div className="relative px-3 pb-2">
          <Search className="pointer-events-none absolute left-5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-dark-600" aria-hidden />
          <input
            value={convQuery}
            onChange={e => setConvQuery(e.target.value)}
            placeholder="Search chats…"
            aria-label="Search conversations"
            className="input-dark py-1.5 pl-8 text-[11.5px]"
          />
        </div>
      ) : null}
      <div className="scroll-thin flex-1 overflow-y-auto p-2">
        {conversations.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <Brain className="mx-auto mb-2 h-8 w-8 text-dark-600" aria-hidden />
            <p className="text-[12px] text-dark-500">No chats yet</p>
            <p className="mt-1 text-[11px] text-dark-600">Start one and it will show up here.</p>
          </div>
        ) : filteredConversations.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-[12px] text-dark-500">Nothing matches “{convQuery}”</p>
          </div>
        ) : filteredConversations.map(c => (
          <button key={c._id} onClick={() => { selectConversation(c._id); setMobileSidebarOpen(false) }}
            className={`w-full text-left px-3 py-2.5 rounded-xl mb-1 flex items-center gap-2 group transition-all ${activeConvId === c._id ? 'nav-active' : 'text-dark-400 hover:bg-white/4 hover:text-white'}`}>
            <MessageSquare className={`w-3.5 h-3.5 flex-shrink-0 ${activeConvId === c._id ? 'text-brand-400' : 'text-dark-600'}`} />
            <span className="text-xs truncate flex-1">{c.title}</span>
            <span onClick={e => deleteConversation(c._id, e)} className="opacity-0 group-hover:opacity-100 p-0.5 text-dark-600 hover:text-red-400 transition-all flex-shrink-0">
              <Trash2 className="w-3 h-3" />
            </span>
          </button>
        ))}
      </div>
    </div>
  )

  return (
    // Fills the shell's content area instead of the whole viewport: the dashboard chrome owns
    // the outer scroll, so a nested 100vh here produced a second scrollbar and a dead strip.
    // `dvh` keeps the composer above the mobile browser chrome, and the shorter mobile height
    // reserves room for the fixed bottom navigation.
    <div className="card chat-shell flex overflow-hidden p-0">

      {/* ── Desktop sidebar ── */}
      <div className="hidden md:flex w-60 flex-col flex-shrink-0" style={{ background: 'rgba(7,7,15,0.95)', borderRight: '1px solid rgba(255,255,255,0.06)' }}>
        <Sidebar />
      </div>

      {/* ── Mobile drawer ── */}
      {mobileSidebarOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setMobileSidebarOpen(false)} />
          <div className="relative w-64 h-full z-10 animate-slide-right shadow-2xl flex flex-col" style={{ background: 'rgba(7,7,15,0.98)', borderRight: '1px solid rgba(124,58,237,0.2)' }}>
            <div className="p-3 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <span className="text-xs font-bold text-white">Conversations</span>
              <button onClick={() => setMobileSidebarOpen(false)} className="p-1 text-dark-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex-1 overflow-hidden"><Sidebar /></div>
          </div>
        </div>
      )}

      {/* ── Main area ── */}
      <div className="flex-1 flex flex-col h-full overflow-hidden w-full min-w-0">

        {/* ══ THIN TOP BAR — just title + quota ══ */}
        <div className="flex-shrink-0 px-3 py-2 flex items-center justify-between gap-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: 'rgba(7,7,15,0.97)' }}>
          <div className="flex items-center gap-2 min-w-0">
            {/* Mobile: open convos */}
            <button onClick={() => setMobileSidebarOpen(true)} className="md:hidden p-1.5 rounded-lg text-dark-500 hover:text-white" style={{ background: 'rgba(255,255,255,0.04)' }}>
              <MessageSquare className="w-4 h-4" />
            </button>
            <div className="w-6 h-6 rounded-lg bg-gradient-neon flex items-center justify-center glow-brand flex-shrink-0">
              <Zap className="w-3.5 h-3.5 text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-white truncate">{currentModelObj?.name || selectedModel}</p>
              <p className="text-[10px] text-dark-600 truncate hidden sm:block">{activeSkillObj.name} · {mode.toUpperCase()}</p>
            </div>
          </div>
          <Link href="/dashboard/subscription" className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl flex-shrink-0 group" style={{ background: 'rgba(124,58,237,0.07)', border: '1px solid rgba(124,58,237,0.15)' }} title="Token quota">
            <CreditCard className="w-3.5 h-3.5 text-brand-400" />
            <div className="hidden sm:block">
              <div className="token-bar-track w-20"><div className="token-bar-fill" style={{ width: `${quotaPct}%` }} /></div>
              <p className="text-[9px] text-dark-600 mt-0.5 text-right font-mono">{((tokenQuota?.tokensUsed7d||0)/1000).toFixed(0)}k / {((tokenQuota?.weeklyLimit||1000000)/1000).toFixed(0)}k</p>
            </div>
          </Link>
        </div>

        {/* ══ MESSAGES ══ */}
        <div className="flex-1 overflow-y-auto" style={{ padding: '1rem 1rem 0.5rem' }}>
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center min-h-full text-center py-8 animate-fade-in">
              <div className="relative mb-5">
                <div className="w-16 h-16 rounded-2xl bg-gradient-neon flex items-center justify-center glow-brand">
                  <Bot className="w-8 h-8 text-white" />
                </div>
                <div className="absolute -top-1 -right-1 w-5 h-5 bg-cyan-400 rounded-full flex items-center justify-center">
                  <Sparkles className="w-3 h-3 text-dark-900" />
                </div>
              </div>
              <h3 className="text-xl font-bold gradient-text mb-1">Ready to chat</h3>
              <p className="text-dark-500 text-sm mb-1">{currentModelObj?.name || selectedModel}</p>
              <p className="text-dark-700 text-xs mb-6 max-w-xs">
                {mode === 'api' ? 'All models free · 1M tokens / 7 days' : 'Local models · No quota · Auto RAM-free'}
              </p>
              {/* Quick starters */}
              <div className="grid grid-cols-2 gap-2 max-w-sm w-full text-left">
                {[
                  { skill: 'game', icon: Gamepad2, text: 'Build a Flappy Bird clone', color: 'text-purple-400', bg: 'rgba(124,58,237,0.07)', border: 'rgba(124,58,237,0.18)' },
                  { skill: 'webapp', icon: Globe, text: 'Create a web app UI', color: 'text-blue-400', bg: 'rgba(6,182,212,0.06)', border: 'rgba(6,182,212,0.18)' },
                  { skill: 'visualizer', icon: BarChart3, text: 'Build a data dashboard', color: 'text-amber-400', bg: 'rgba(245,158,11,0.06)', border: 'rgba(245,158,11,0.18)' },
                  { skill: 'general', icon: Brain, text: 'Just chat with AI', color: 'text-cyan-400', bg: 'rgba(16,185,129,0.06)', border: 'rgba(16,185,129,0.18)' },
                ].map(({ skill, icon: Icon, text, color, bg, border }) => (
                  <button key={skill} onClick={() => { setSelectedSkill(skill); setInput(text) }}
                    className={`flex items-center gap-2.5 p-3 rounded-xl text-xs text-dark-300 hover:text-white transition-all`}
                    style={{ background: bg, border: `1px solid ${border}` }}>
                    <Icon className={`w-4 h-4 flex-shrink-0 ${color}`} />
                    <span>{text}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-4 max-w-3xl mx-auto">
            {messages.map((msg, i) => (
              <div key={i} className={`flex animate-fade-up gap-2.5 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                {/* Avatar */}
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 ${msg.role === 'user' ? 'bg-gradient-neon glow-brand' : 'bg-gradient-to-br from-cyan-700 to-blue-800 glow-cyan'}`}>
                  {msg.role === 'user' ? <User className="w-4 h-4 text-white" /> : <Bot className="w-4 h-4 text-white" />}
                </div>

                {/* Bubble */}
                <div className={`max-w-[84%] rounded-2xl px-4 py-3 text-sm space-y-2.5 ${msg.role === 'user' ? 'msg-user text-white' : 'msg-ai text-dark-100'}`}>
                  {msg.attachments?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pb-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                      {msg.attachments.map((att, idx) => (
                        <div key={idx} className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs border border-white/10 bg-white/4">
                          {att.mimeType?.startsWith('image/') ? <ImageIcon className="w-3 h-3 text-cyan-400" /> : <FileText className="w-3 h-3 text-brand-400" />}
                          <span className="truncate max-w-[120px]">{att.name}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {msg.role === 'assistant'
                    ? <div className="prose prose-invert prose-sm max-w-none break-words leading-relaxed"><ReactMarkdown>{msg.content}</ReactMarkdown></div>
                    : <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>
                  }

                  {/* Artifacts */}
                  {msg.artifacts?.length > 0 && (
                    <div className="pt-2 space-y-1.5" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                      <p className="text-[11px] font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1">
                        <Sparkles className="w-3 h-3" /> {msg.artifacts.length} Artifact{msg.artifacts.length > 1 ? 's' : ''}
                      </p>
                      {msg.artifacts.map((art, idx) => (
                        <div key={idx} className="rounded-xl p-2.5 flex items-center justify-between gap-2" style={{ background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.2)' }}>
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-7 h-7 rounded-lg bg-brand-500/15 flex items-center justify-center flex-shrink-0">
                              {art.type === 'game' ? <Gamepad2 className="w-3.5 h-3.5 text-brand-400" /> : art.type === 'webapp' ? <Globe className="w-3.5 h-3.5 text-brand-400" /> : <Code2 className="w-3.5 h-3.5 text-brand-400" />}
                            </div>
                            <div className="min-w-0"><p className="text-xs font-semibold text-white truncate">{art.title}</p></div>
                          </div>
                          <div className="flex gap-1 flex-shrink-0">
                            <button onClick={() => { setActiveArtifact(art); setShowCode(false) }} className="btn-primary text-xs py-1 px-2.5 rounded-lg"><Play className="w-3 h-3" /> Run</button>
                            <button onClick={() => { setActiveArtifact(art); setShowCode(true) }} className="btn-ghost text-xs py-1 px-2 rounded-lg" title="Code"><Code className="w-3.5 h-3.5" /></button>
                            <button onClick={() => downloadArtifact(art)} className="btn-ghost text-xs py-1 px-2 rounded-lg text-green-400" title="Download"><Download className="w-3.5 h-3.5" /></button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {msg.role === 'assistant' && (
                    <p className="text-[10px] text-dark-700 font-mono pt-1" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                      {msg.model || selectedModel}{msg.tokens ? ` · ${msg.tokens.toLocaleString()} tokens` : ''}
                    </p>
                  )}
                </div>
              </div>
            ))}

            {sending && (
              <div className="flex gap-2.5 animate-slide-up">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-cyan-700 to-blue-800 flex items-center justify-center glow-cyan flex-shrink-0">
                  <Bot className="w-4 h-4 text-white" />
                </div>
                <div className="msg-ai flex items-center gap-2.5 rounded-2xl px-4 py-3">
                  <span className="typing flex items-center text-brand-300" aria-hidden>
                    <span /><span /><span />
                  </span>
                  <span className="text-[12px] text-dark-400">Thinking…</span>
                  <button onClick={stopGeneration}
                    className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-red-300 transition-colors hover:bg-red-500/10">
                    <Square className="h-2.5 w-2.5 fill-current" /> Stop
                  </button>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* ══ BOTTOM INPUT BAR — model + skill + send all in one bar ══ */}
        <div className="flex-shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(7,7,15,0.98)' }}>

          {/* Attachments strip */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-3 pt-2">
              {attachments.map((att, i) => (
                <div key={i} className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-white" style={{ background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.25)' }}>
                  <Paperclip className="w-3 h-3 text-brand-400" />
                  <span className="truncate max-w-[120px]">{att.name}</span>
                  <button onClick={() => setAttachments(p => p.filter((_, j) => j !== i))} className="text-dark-500 hover:text-red-400"><X className="w-3 h-3" /></button>
                </div>
              ))}
            </div>
          )}

          {/* ── Toolbar row: mode + model + skill ── */}
          <div className="flex items-center gap-1.5 px-3 pt-2 pb-1 flex-wrap">

            {/* Mode picker */}
            <div className="relative" ref={modeRef}>
              <button onClick={() => { setModePickerOpen(o => !o); setModelPickerOpen(false); setSkillPickerOpen(false) }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-all"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: '#a8a8cc' }}>
                {mode === 'api' ? <Cloud className="w-3.5 h-3.5 text-cyan-400" /> : mode === 'local' ? <Cpu className="w-3.5 h-3.5 text-green-400" /> : <Brain className="w-3.5 h-3.5 text-amber-400" />}
                <span className="hidden sm:inline">{mode === 'api' ? 'Cloud API' : mode === 'local' ? 'LM Studio' : 'Agent'}</span>
                <ChevronUp className={`w-3 h-3 transition-transform ${modePickerOpen ? '' : 'rotate-180'}`} />
              </button>
              {modePickerOpen && (
                <div className="absolute bottom-full mb-2 left-0 rounded-xl overflow-hidden z-50 shadow-2xl" style={{ background: 'rgba(13,13,26,0.98)', border: '1px solid rgba(255,255,255,0.1)', minWidth: '140px' }}>
                  {([
                    { id: 'api',        icon: Cloud, color: 'text-cyan-400',   label: 'Cloud API' },
                    { id: 'local',      icon: Cpu,   color: 'text-green-400',  label: 'LM Studio' },
                    { id: 'contentbot', icon: Brain, color: 'text-amber-400',  label: 'Agent' },
                  ] as const).map(({ id, icon: Icon, color, label }) => (
                    <button key={id} onClick={() => { setMode(id); setModePickerOpen(false) }}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-all ${mode === id ? 'bg-brand-500/15 text-white' : 'text-dark-400 hover:bg-white/5 hover:text-white'}`}>
                      <Icon className={`w-3.5 h-3.5 ${color}`} /> {label}
                      {mode === id && <Check className="w-3 h-3 ml-auto text-brand-400" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Model picker — MAIN CONTROL */}
            <div className="relative flex-1 min-w-0" ref={modelRef}>
              <button onClick={() => { setModelPickerOpen(o => !o); setSkillPickerOpen(false); setModePickerOpen(false) }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all w-full max-w-xs"
                style={{ background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.3)', color: '#c4b5fd' }}>
                <Sparkles className="w-3.5 h-3.5 text-brand-400 flex-shrink-0" />
                <span className="truncate">{currentModelObj?.name || selectedModel}</span>
                <ChevronUp className={`w-3.5 h-3.5 flex-shrink-0 ml-auto transition-transform ${modelPickerOpen ? '' : 'rotate-180'}`} />
              </button>

              {/* Model dropdown — opens UPWARD */}
              {modelPickerOpen && (
                <div className="absolute bottom-full mb-2 left-0 w-80 max-h-96 overflow-y-auto rounded-xl z-50 shadow-2xl" style={{ background: 'rgba(13,13,26,0.99)', border: '1px solid rgba(124,58,237,0.25)' }}>
                  <div className="sticky top-0 px-3 py-2" style={{ background: 'rgba(13,13,26,0.99)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <p className="text-[10px] text-dark-500 uppercase tracking-widest font-bold">Select AI Model</p>
                  </div>
                  {Object.entries(modelGroups).map(([group, groupModels]) => (
                    <div key={group}>
                      <div className="px-3 py-1.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <p className="text-[10px] text-dark-600 uppercase tracking-wider font-semibold">{group}</p>
                      </div>
                      {groupModels.map(m => (
                        <button key={m.id} onClick={() => { setSelectedModel(m.id); setModelPickerOpen(false) }}
                          className={`w-full text-left flex items-center gap-2.5 px-3 py-2.5 text-xs transition-all ${selectedModel === m.id ? 'bg-brand-500/15 text-white' : 'text-dark-300 hover:bg-white/5 hover:text-white'} ${m.servable === false ? 'opacity-55' : ''}`}>
                          <div className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 ${m.multimodal ? 'bg-cyan-500/15' : 'bg-brand-500/12'}`}>
                            {m.multimodal ? <ImageIcon className="w-3.5 h-3.5 text-cyan-400" /> : <Sparkles className="w-3.5 h-3.5 text-brand-400" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold truncate">{m.name}</p>
                            <p className="text-[10px] text-dark-600 truncate">{m.badge}</p>
                          </div>
                          {m.servable === false && <span className="badge py-0 text-[9px] flex-shrink-0" title={m.availability}>Unverified</span>}
                          {selectedModel === m.id && <Check className="w-3.5 h-3.5 text-brand-400 flex-shrink-0" />}
                          {m.multimodal && <span className="badge badge-cyan py-0 text-[9px] flex-shrink-0">Vision</span>}
                        </button>
                      ))}
                    </div>
                  ))}
                  {currentModels.length === 0 && (
                    <p className="text-center text-dark-500 text-xs py-6">
                      {mode === 'local' ? '⚠️ LM Studio offline — try Cloud API mode' : 'No models available'}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Skill picker */}
            <div className="relative flex-shrink-0" ref={skillRef}>
              <button onClick={() => { setSkillPickerOpen(o => !o); setModelPickerOpen(false); setModePickerOpen(false) }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-all"
                style={{ background: 'rgba(6,182,212,0.08)', border: '1px solid rgba(6,182,212,0.2)', color: '#67e8f9' }}>
                <SkillIcon className={`w-3.5 h-3.5 ${activeSkillObj.color}`} />
                <span className="hidden sm:inline">{activeSkillObj.name}</span>
                <ChevronUp className={`w-3 h-3 transition-transform ${skillPickerOpen ? '' : 'rotate-180'}`} />
              </button>
              {skillPickerOpen && (
                <div className="absolute bottom-full mb-2 right-0 w-52 rounded-xl overflow-hidden z-50 shadow-2xl" style={{ background: 'rgba(13,13,26,0.98)', border: '1px solid rgba(6,182,212,0.2)' }}>
                  <div className="px-3 py-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <p className="text-[10px] text-dark-500 uppercase tracking-widest font-bold">Artifact Skill</p>
                  </div>
                  {SKILL_OPTIONS.map(s => {
                    const SI = s.icon
                    return (
                      <button key={s.id} onClick={() => { setSelectedSkill(s.id); setSkillPickerOpen(false) }}
                        className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-xs transition-all ${selectedSkill === s.id ? 'bg-cyan-500/10 text-white' : 'text-dark-300 hover:bg-white/5 hover:text-white'}`}>
                        <SI className={`w-4 h-4 flex-shrink-0 ${s.color}`} />
                        <div><p className="font-semibold">{s.name}</p><p className="text-[10px] text-dark-600">{s.desc}</p></div>
                        {selectedSkill === s.id && <Check className="w-3.5 h-3.5 text-cyan-400 ml-auto flex-shrink-0" />}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ── Input + attach + send ── */}
          <div className="flex gap-2 px-3 pb-3 pt-1">
            <input ref={fileInputRef as any} type="file" multiple onChange={handleFileUpload} className="hidden" accept="image/*,video/*,.pdf,.doc,.docx,.txt,.json,.csv,.js,.py,.html" />

            {/* Attach */}
            <button type="button" onClick={() => fileInputRef.current?.click()}
              className="p-3 rounded-xl flex-shrink-0 transition-all hover:scale-105"
              style={{ background: 'rgba(6,182,212,0.07)', border: '1px solid rgba(6,182,212,0.15)' }}
              title="Attach file (Gemini+ multimodal)">
              <Paperclip className="w-4 h-4 text-cyan-400" />
            </button>

            {/* Text input */}
            <textarea ref={textareaRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
              placeholder="Type your message... (Enter to send)"
              rows={1} style={{ resize: 'none' }}
              className="input-dark flex-1 py-3 min-h-[46px] max-h-32 text-sm leading-relaxed" />

            {/* Send (while idle) / Stop (while the AI is thinking) */}
            {sending ? (
              <button type="button" onClick={stopGeneration} title="Stop generating"
                className="btn-danger flex-shrink-0 px-3" aria-label="Stop generating">
                <Square className="h-4 w-4 fill-current" />
              </button>
            ) : (
              <button type="button" onClick={sendMessage as any}
                disabled={!input.trim() && !attachments.length}
                className="btn-primary p-3 flex-shrink-0 rounded-xl">
                <Send className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ══ ARTIFACT MODAL ══ */}
      {activeArtifact && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
          <div className={`flex flex-col overflow-hidden transition-all duration-300 ${modalFullscreen ? 'w-full h-full rounded-none' : 'w-[92vw] max-w-5xl h-[88vh] rounded-2xl'}`}
            style={{ background: 'rgba(10,10,20,0.99)', border: '1px solid rgba(124,58,237,0.3)', boxShadow: '0 0 60px rgba(124,58,237,0.2)' }}>
            <div className="px-4 py-3 flex items-center justify-between flex-shrink-0 bg-black/20" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-brand-500/15 flex items-center justify-center text-brand-400">
                  {activeArtifact.type === 'game' ? <Gamepad2 className="w-4 h-4" /> : <Globe className="w-4 h-4" />}
                </div>
                <div><h3 className="font-bold text-white text-sm">{activeArtifact.title}</h3><p className="text-[10px] text-dark-600">Live Sandbox</p></div>
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={() => setShowCode(!showCode)} className={`btn-ghost text-xs py-1.5 px-2.5 ${showCode ? 'border-brand-500/30 text-brand-400' : ''}`}>
                  <Code className="w-3.5 h-3.5" /> {showCode ? 'Preview' : 'Code'}
                </button>
                <button onClick={() => downloadArtifact(activeArtifact)} className="btn-ghost text-xs py-1.5 px-2.5 text-green-400"><Download className="w-3.5 h-3.5" /></button>
                <button onClick={() => setModalFullscreen(!modalFullscreen)} className="btn-ghost p-1.5">
                  {modalFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                </button>
                <button onClick={() => setActiveArtifact(null)} className="btn-ghost p-1.5 hover:text-red-400"><X className="w-4 h-4" /></button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden bg-black">
              {showCode
                ? <pre className="h-full overflow-auto p-4 text-xs font-mono text-dark-200 bg-dark-950 select-all leading-relaxed"><code>{activeArtifact.code}</code></pre>
                : <iframe srcDoc={activeArtifact.code} title={activeArtifact.title} className="w-full h-full border-0 bg-white" sandbox="allow-scripts allow-modals allow-forms allow-same-origin" />
              }
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
