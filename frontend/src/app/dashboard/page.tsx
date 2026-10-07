'use client'
import { useEffect, useState } from 'react'
import { MessageSquare, Users, Smartphone, Brain, TrendingUp, Activity, Zap } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { adminApi } from '@/lib/api'

interface Stats {
  totalUsers: number
  totalConvos: number
  totalWaSessions: number
  activeWaSessions: number
}

function StatCard({ icon: Icon, label, value, color, glow }: any) {
  return (
    <div className={`glass rounded-2xl p-6 border transition-all hover:scale-[1.01] ${glow}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-dark-300 text-sm mb-1">{label}</p>
          <p className="text-3xl font-bold text-white">{value ?? '—'}</p>
        </div>
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color}`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const { user, isAdmin } = useAuth()
  const [stats, setStats] = useState<Stats | null>(null)
  const [recentChats, setRecentChats] = useState<any[]>([])

  useEffect(() => {
    if (isAdmin) {
      adminApi.getStats().then((d: any) => {
        setStats(d.stats)
        setRecentChats(d.recentChats || [])
      }).catch(console.error)
    }
  }, [isAdmin])

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">
            Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}, {user?.name?.split(' ')[0] || 'User'} 👋
          </h1>
          <p className="text-dark-300 text-sm mt-1">Here's what's happening with your ContentBot.</p>
        </div>
        <div className="glass rounded-xl px-4 py-2 flex items-center gap-2">
          <Activity className="w-4 h-4 text-green-400 animate-pulse" />
          <span className="text-sm text-green-400">System Online</span>
        </div>
      </div>

      {/* Stats (admin only) */}
      {isAdmin && stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard icon={Users} label="Total Users" value={stats.totalUsers} color="bg-brand-600" glow="border-brand-800/30" />
          <StatCard icon={MessageSquare} label="Conversations" value={stats.totalConvos} color="bg-purple-600" glow="border-purple-800/30" />
          <StatCard icon={Smartphone} label="WA Sessions" value={stats.totalWaSessions} color="bg-green-600" glow="border-green-800/30" />
          <StatCard icon={TrendingUp} label="WA Active" value={stats.activeWaSessions} color="bg-blue-600" glow="border-blue-800/30" />
        </div>
      )}

      {/* Quick actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { href: '/dashboard/chat', icon: MessageSquare, title: 'Start Chat', desc: 'Chat with your local AI or ContentBot', color: 'from-brand-500 to-purple-600' },
          { href: '/dashboard/whatsapp', icon: Smartphone, title: 'WhatsApp', desc: 'Connect accounts & automated DMs', color: 'from-green-500 to-emerald-600' },
          { href: '/dashboard/memory', icon: Brain, title: 'AI Memory', desc: 'Manage your business knowledge base', color: 'from-purple-500 to-pink-600' },
        ].map(({ href, icon: Icon, title, desc, color }) => (
          <a key={href} href={href}
            className="glass rounded-2xl p-6 flex items-center gap-4 hover:bg-white/8 transition-all group cursor-pointer">
            <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform`}>
              <Icon className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="font-semibold text-white">{title}</h3>
              <p className="text-sm text-dark-300">{desc}</p>
            </div>
          </a>
        ))}
      </div>

      {/* Recent chats (admin) */}
      {isAdmin && recentChats.length > 0 && (
        <div className="glass rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-brand-400" /> Recent Conversations
          </h2>
          <div className="space-y-2">
            {recentChats.slice(0, 8).map((chat: any) => (
              <div key={chat._id} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-full bg-brand-600/30 flex items-center justify-center text-xs font-bold text-brand-300">
                    {chat.userId?.name?.[0]?.toUpperCase() || '?'}
                  </div>
                  <div>
                    <p className="text-sm text-white">{chat.title}</p>
                    <p className="text-xs text-dark-400">{chat.userId?.name} · {chat.mode}</p>
                  </div>
                </div>
                <span className="text-xs text-dark-500">{new Date(chat.updatedAt).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
