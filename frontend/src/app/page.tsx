'use client'
import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import {
  Zap, Bot, Send, User, Sparkles, MessageSquare, Shield,
  Smartphone, Brain, ChevronRight, Loader2, ArrowRight
} from 'lucide-react'
import { chatApi } from '@/lib/api'
import { getToken, getUser } from '@/lib/auth'
import toast from 'react-hot-toast'
import ReactMarkdown from 'react-markdown'

interface Message {
  role: 'user' | 'assistant'
  content: string
  model?: string
  timestamp?: string
}

interface AIModel {
  id: string
  name: string
  source: 'local' | 'contentbot'
  tier: 'free' | 'paid'
  isPaid: boolean
  badge: string
}

export default function HomePage() {
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [userName, setUserName] = useState('')
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: '👋 Hello! I am **ContentBot AI** running on your local PC. This is the **Free Public Chat** powered by local LM Studio models (0.5B - 1B). How can I help you today?',
      model: 'qwen2.5-0.5b-instruct',
    }
  ])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [selectedModel, setSelectedModel] = useState('qwen2.5-0.5b-instruct')
  const [models, setModels] = useState<AIModel[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [lmStudioOnline, setLmStudioOnline] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const token = getToken()
    const user = getUser()
    if (token && user) {
      setIsLoggedIn(true)
      setUserName(user.name)
    }
    loadModels()

    // Free RAM when leaving chat page
    const handleLeave = () => {
      try {
        navigator.sendBeacon('/api/chat/lm-studio/unload')
      } catch {}
      chatApi.unloadModel().catch(() => {})
    }

    window.addEventListener('beforeunload', handleLeave)
    return () => {
      window.removeEventListener('beforeunload', handleLeave)
      chatApi.unloadModel().catch(() => {})
    }
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const loadModels = async () => {
    try {
      const data = await chatApi.getModels()
      if (data.models) {
        // Public chat only uses free local models
        const freeModels = data.models.filter((m: AIModel) => !m.isPaid && m.source === 'local')
        setModels(freeModels.length > 0 ? freeModels : data.models.filter((m: AIModel) => !m.isPaid))
        setLmStudioOnline(Boolean(data.lmStudioOnline))
        if (freeModels.length > 0) {
          setSelectedModel(freeModels[0].id)
        }
      }
    } catch {
      // Fallback
      setModels([
        { id: 'qwen2.5-0.5b-instruct', name: 'Qwen 2.5 0.5B Instruct', source: 'local', tier: 'free', isPaid: false, badge: 'FREE (0.5B)' },
        { id: 'llama-3.2-1b-instruct', name: 'Llama 3.2 1B Instruct', source: 'local', tier: 'free', isPaid: false, badge: 'FREE (1B)' },
      ])
    }
  }

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!input.trim() || sending) return

    const userText = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: userText }])
    setSending(true)

    try {
      const res: any = await chatApi.sendPublicMessage(userText, conversationId, selectedModel)
      if (res.conversationId) setConversationId(res.conversationId)
      if (res.aiMessage) {
        setMessages(prev => [...prev, res.aiMessage])
      }
    } catch (err: any) {
      const errMsg = err.message || 'Error communicating with AI'
      toast.error(errMsg)
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: `⚠️ **Error:** ${errMsg}\n\n*Make sure LM Studio is open on your PC on port 1234 with a model loaded.*`,
          model: 'system-error',
        }
      ])
    } finally {
      setSending(false)
    }
  }

  const sendQuickPrompt = (text: string) => {
    setInput(text)
  }

  return (
    <div className="min-h-screen bg-[#070715] text-[#f8f8fc] flex flex-col selection:bg-indigo-500/30">
      {/* Top Navigation */}
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-[#070715]/80 border-b border-white/10 px-4 lg:px-8 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <div>
            <span className="font-bold text-lg tracking-tight text-white">ContentBot</span>
            <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 font-medium">
              Free Public Portal
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* LM Studio status indicator */}
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs">
            <span className={`w-2 h-2 rounded-full ${lmStudioOnline ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
            <span className="text-gray-300">
              {lmStudioOnline ? 'LM Studio Online' : 'LM Studio Local (Port 1234)'}
            </span>
          </div>

          {isLoggedIn ? (
            <Link
              href="/dashboard"
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-sm font-medium hover:brightness-110 transition shadow-lg shadow-indigo-500/25"
            >
              <span>Dashboard ({userName || 'Admin'})</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          ) : (
            <div className="flex items-center gap-2">
              <Link
                href="/login"
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-sm font-medium text-white transition"
              >
                <Shield className="w-4 h-4 text-indigo-400" />
                <span>Admin Login</span>
              </Link>
              <Link
                href="/register"
                className="hidden sm:inline-flex px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition"
              >
                Register
              </Link>
            </div>
          )}
        </div>
      </header>

      {/* Main Content: Split Hero & Live Chat */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 lg:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Side: Overview & Fast Actions (5 cols) */}
        <div className="lg:col-span-5 space-y-6 pt-2">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs font-semibold uppercase tracking-wider">
              <Sparkles className="w-3.5 h-3.5" /> 100% Free Local AI & Automation
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white leading-tight">
              AI Chatbot &amp; <span className="bg-gradient-to-r from-indigo-400 via-purple-300 to-pink-400 bg-clip-text text-transparent">WhatsApp Engine</span>
            </h1>
            <p className="text-gray-400 text-sm leading-relaxed">
              Chat directly with free local LLMs running on your PC (0.5B – 1B models). Business owners can sign in to manage WhatsApp auto-replies, AI memory, and multi-agent workflows.
            </p>
          </div>

          {/* Quick Info Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/10 hover:border-indigo-500/30 transition">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/15 text-emerald-400 flex items-center justify-center mb-2.5">
                <Bot className="w-4 h-4" />
              </div>
              <h3 className="font-semibold text-sm text-white">Free Local LLMs</h3>
              <p className="text-xs text-gray-400 mt-1">Runs privately on your PC via LM Studio with zero token fees.</p>
            </div>

            <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/10 hover:border-indigo-500/30 transition">
              <div className="w-8 h-8 rounded-lg bg-indigo-500/15 text-indigo-400 flex items-center justify-center mb-2.5">
                <Smartphone className="w-4 h-4" />
              </div>
              <h3 className="font-semibold text-sm text-white">WhatsApp Agent</h3>
              <p className="text-xs text-gray-400 mt-1">Connect your WhatsApp to auto-reply to customers 24/7.</p>
            </div>

            <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/10 hover:border-indigo-500/30 transition">
              <div className="w-8 h-8 rounded-lg bg-purple-500/15 text-purple-400 flex items-center justify-center mb-2.5">
                <Brain className="w-4 h-4" />
              </div>
              <h3 className="font-semibold text-sm text-white">AI Business Memory</h3>
              <p className="text-xs text-gray-400 mt-1">Teach AI about your business, tone, and knowledge base.</p>
            </div>

            <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/10 hover:border-indigo-500/30 transition">
              <div className="w-8 h-8 rounded-lg bg-pink-500/15 text-pink-400 flex items-center justify-center mb-2.5">
                <Shield className="w-4 h-4" />
              </div>
              <h3 className="font-semibold text-sm text-white">Admin Control</h3>
              <p className="text-xs text-gray-400 mt-1">View all public chats, manage users, and configure API keys.</p>
            </div>
          </div>

          {/* Quick Prompts */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">Try a quick prompt:</p>
            <div className="flex flex-wrap gap-2">
              {[
                'Tell me about your capabilities',
                'Write a short WhatsApp business greeting',
                'How do I connect WhatsApp automation?',
                'Tips to grow local business sales',
              ].map((q, idx) => (
                <button
                  key={idx}
                  onClick={() => sendQuickPrompt(q)}
                  className="text-xs px-3 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-gray-300 hover:text-white transition"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          {/* Admin Credentials Quick Hint */}
          <div className="p-3.5 rounded-2xl bg-indigo-950/30 border border-indigo-500/20 text-xs text-indigo-300 flex items-center justify-between">
            <div>
              <span className="font-semibold block text-indigo-200">Admin Account Ready:</span>
              <span>admin@contentbot.local • Admin@123456</span>
            </div>
            <Link
              href="/login"
              className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition flex items-center gap-1"
            >
              Sign In <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>

        {/* Right Side: Interactive Public Chat Window (7 cols) */}
        <div className="lg:col-span-7 flex flex-col h-[650px] rounded-3xl bg-[#0c0c22]/90 border border-white/10 shadow-2xl backdrop-blur-2xl overflow-hidden">
          {/* Chat Header */}
          <div className="px-5 py-3.5 border-b border-white/10 bg-white/[0.02] flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white">
                <Bot className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-white">Public AI Chat</h2>
                <div className="flex items-center gap-2 mt-0.5">
                  <p className="text-[11px] text-gray-400 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    Free 0.5B – 1B Local
                  </p>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/15 border border-purple-500/30 text-purple-300 font-medium">
                    ⚡ Auto-frees RAM after 20s
                  </span>
                </div>
              </div>
            </div>

            {/* Model Selector */}
            <div className="flex items-center gap-2">
              <label htmlFor="model-select" className="text-xs text-gray-400 hidden sm:inline">Model:</label>
              <select
                id="model-select"
                value={selectedModel}
                onChange={e => setSelectedModel(e.target.value)}
                className="bg-white/5 border border-white/10 rounded-xl px-2.5 py-1 text-xs text-white focus:outline-none focus:border-indigo-500"
              >
                {models.map(m => (
                  <option key={m.id} value={m.id} className="bg-[#0c0c22] text-white">
                    {m.name} ({m.badge})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Messages Scroll Area */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role === 'assistant' && (
                  <div className="w-7 h-7 rounded-xl bg-indigo-600/30 border border-indigo-500/30 flex items-center justify-center text-indigo-300 flex-shrink-0 mt-0.5">
                    <Bot className="w-4 h-4" />
                  </div>
                )}
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-indigo-600 text-white rounded-br-sm'
                      : 'bg-white/[0.04] border border-white/10 text-gray-200 rounded-bl-sm'
                  }`}
                >
                  <div className="prose prose-invert prose-sm max-w-none">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                  {msg.model && (
                    <div className="mt-1.5 pt-1 border-t border-white/5 flex items-center gap-1 text-[10px] text-gray-400">
                      <span>Model: {msg.model}</span>
                    </div>
                  )}
                </div>
                {msg.role === 'user' && (
                  <div className="w-7 h-7 rounded-xl bg-purple-600 flex items-center justify-center text-white flex-shrink-0 mt-0.5">
                    <User className="w-4 h-4" />
                  </div>
                )}
              </div>
            ))}

            {sending && (
              <div className="flex gap-3 items-center text-gray-400 text-xs">
                <div className="w-7 h-7 rounded-xl bg-indigo-600/30 border border-indigo-500/30 flex items-center justify-center text-indigo-300 flex-shrink-0">
                  <Bot className="w-4 h-4 animate-spin" />
                </div>
                <div className="bg-white/[0.04] border border-white/10 rounded-2xl px-4 py-2.5 flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                  <span>Generating response with local model...</span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Chat Input Bar */}
          <form
            onSubmit={handleSend}
            className="p-3.5 border-t border-white/10 bg-white/[0.02] flex items-center gap-2"
          >
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Type your message... (Free Local AI)"
              className="flex-1 bg-white/5 border border-white/10 rounded-2xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition"
              disabled={sending}
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              className="px-4 py-2.5 rounded-2xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:hover:bg-indigo-600 text-white text-sm font-medium transition flex items-center gap-1.5 shadow-lg shadow-indigo-600/20"
            >
              <Send className="w-4 h-4" />
              <span className="hidden sm:inline">Send</span>
            </button>
          </form>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/10 py-4 px-6 text-center text-xs text-gray-500">
        ContentBot AI Platform • 100% Free Local Stack: MongoDB Community, LM Studio, Brave Browser WPPConnect
      </footer>
    </div>
  )
}
