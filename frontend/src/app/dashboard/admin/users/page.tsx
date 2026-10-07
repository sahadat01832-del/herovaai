'use client'
import { useState, useEffect } from 'react'
import {
  Plus, Trash2, Edit2, Search, Shield, X, CreditCard,
  RotateCcw, Zap, CheckCircle2, AlertCircle
} from 'lucide-react'
import { adminApi } from '@/lib/api'
import toast from 'react-hot-toast'

export default function AdminUsersPage() {
  const [users, setUsers] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [newUser, setNewUser] = useState({
    name: '',
    email: '',
    password: '',
    role: 'user',
    contentbotApiKey: '',
  })
  const [editingUser, setEditingUser] = useState<any>(null)

  useEffect(() => {
    loadUsers()
  }, [search])

  const loadUsers = async () => {
    setLoading(true)
    try {
      const d: any = await adminApi.getUsers(search ? { search } : {})
      setUsers(d.users || [])
      setTotal(d.total || 0)
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  const createUser = async () => {
    try {
      await adminApi.createUser(newUser)
      setShowCreate(false)
      setNewUser({ name: '', email: '', password: '', role: 'user', contentbotApiKey: '' })
      loadUsers()
      toast.success('User account created!')
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const updateUser = async () => {
    if (!editingUser) return
    try {
      await adminApi.updateUser(editingUser._id, editingUser)
      // If subscription fields changed, update subscription
      if (editingUser.subscription || editingUser.tokenQuota) {
        await adminApi.updateUserSubscription(editingUser._id, {
          tier: editingUser.subscription?.tier,
          weeklyLimit: editingUser.tokenQuota?.weeklyLimit,
          status: editingUser.subscription?.status,
        })
      }
      setEditingUser(null)
      loadUsers()
      toast.success('User updated!')
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const resetTokens = async (userId: string, userName: string) => {
    if (!confirm(`Reset 7-day token count to 0 for ${userName}?`)) return
    try {
      await adminApi.resetUserTokens(userId)
      loadUsers()
      toast.success(`Reset tokens for ${userName}`)
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const deleteUser = async (id: string) => {
    if (!confirm('Are you sure you want to delete this user?')) return
    try {
      await adminApi.deleteUser(id)
      loadUsers()
      toast.success('User deleted')
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const toggleActive = async (user: any) => {
    try {
      await adminApi.updateUser(user._id, { isActive: !user.isActive })
      loadUsers()
      toast.success(`User ${!user.isActive ? 'activated' : 'deactivated'}`)
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Shield className="w-6 h-6 text-brand-400" /> Admin: User & Subscription Management
          </h1>
          <p className="text-dark-300 text-sm mt-1">
            Manage {total} registered accounts, assign subscription tiers, and control 1M weekly token quotas
          </p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary">
          <Plus className="w-4 h-4" /> Add User
        </button>
      </div>

      {/* Edit User Modal */}
      {editingUser && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="glass-strong rounded-2xl p-6 w-full max-w-lg border border-white/10 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-white">Edit User & Subscription</h3>
              <button onClick={() => setEditingUser(null)} className="text-dark-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-dark-300 mb-1">Full Name</label>
                <input
                  value={editingUser.name || ''}
                  onChange={e => setEditingUser((u: any) => ({ ...u, name: e.target.value }))}
                  className="input-dark"
                />
              </div>
              <div>
                <label className="block text-dark-300 mb-1">Email</label>
                <input
                  value={editingUser.email || ''}
                  onChange={e => setEditingUser((u: any) => ({ ...u, email: e.target.value }))}
                  className="input-dark"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-dark-300 mb-1">Subscription Tier</label>
                  <select
                    value={editingUser.subscription?.tier || 'free'}
                    onChange={e =>
                      setEditingUser((u: any) => ({
                        ...u,
                        subscription: { ...(u.subscription || {}), tier: e.target.value },
                      }))
                    }
                    className="input-dark"
                  >
                    <option value="free" className="bg-dark-900">Free Tier (1M Quota)</option>
                    <option value="pro" className="bg-dark-900">Pro Tier (2M Quota)</option>
                    <option value="enterprise" className="bg-dark-900">Enterprise (5M Quota)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-dark-300 mb-1">Weekly Token Quota (7d)</label>
                  <input
                    type="number"
                    value={editingUser.tokenQuota?.weeklyLimit || 1000000}
                    onChange={e =>
                      setEditingUser((u: any) => ({
                        ...u,
                        tokenQuota: { ...(u.tokenQuota || {}), weeklyLimit: Number(e.target.value) },
                      }))
                    }
                    className="input-dark"
                  />
                </div>
              </div>
              <div>
                <label className="block text-dark-300 mb-1">Role</label>
                <select
                  value={editingUser.role}
                  onChange={e => setEditingUser((u: any) => ({ ...u, role: e.target.value }))}
                  className="input-dark"
                >
                  <option value="user" className="bg-dark-900">Standard User</option>
                  <option value="admin" className="bg-dark-900">Administrator</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={updateUser} className="btn-primary flex-1 justify-center">
                Save Changes
              </button>
              <button onClick={() => setEditingUser(null)} className="btn-ghost">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search accounts by name or email..."
          className="input-dark pl-10 text-xs"
        />
      </div>

      {/* Users table */}
      <div className="glass rounded-2xl overflow-x-auto border border-white/5">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-white/8 bg-black/20">
              {['User Account', 'Subscription Plan', '7-Day Token Quota', 'Account Role', 'Status', 'Actions'].map(h => (
                <th key={h} className="px-4 py-3 font-semibold text-dark-400 uppercase tracking-wider text-[10px]">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {loading ? (
              <tr>
                <td colSpan={6} className="text-center py-8 text-dark-400">
                  Loading accounts...
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-8 text-dark-400">
                  No accounts found
                </td>
              </tr>
            ) : (
              users.map(u => {
                const tier = u.subscription?.tier || 'free'
                const tokensUsed = u.tokenQuota?.tokensUsed7d || 0
                const weeklyLimit = u.tokenQuota?.weeklyLimit || 1000000
                const pct = Math.min(100, Math.round((tokensUsed / weeklyLimit) * 100))

                return (
                  <tr key={u._id} className="hover:bg-white/5 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-600 to-purple-600 flex items-center justify-center font-bold text-white flex-shrink-0">
                          {u.name?.[0]?.toUpperCase() || 'U'}
                        </div>
                        <div className="truncate">
                          <p className="font-semibold text-white truncate">{u.name}</p>
                          <p className="text-[11px] text-dark-400 truncate">{u.email}</p>
                        </div>
                      </div>
                    </td>

                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded-full uppercase text-[10px] font-bold border ${
                          tier === 'enterprise'
                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                            : tier === 'pro'
                            ? 'bg-purple-500/20 text-purple-300 border-purple-500/30'
                            : 'bg-brand-500/20 text-brand-300 border-brand-500/30'
                        }`}
                      >
                        {tier}
                      </span>
                    </td>

                    <td className="px-4 py-3">
                      <div className="space-y-1 w-36">
                        <div className="flex justify-between text-[10px] text-dark-300 font-mono">
                          <span>{tokensUsed.toLocaleString()}</span>
                          <span>{weeklyLimit.toLocaleString()}</span>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-black/40 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              pct > 80 ? 'bg-red-400' : 'bg-brand-400'
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    </td>

                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded-full border text-[10px] font-medium ${
                          u.role === 'admin'
                            ? 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30'
                            : 'bg-dark-600/40 text-dark-300 border-white/5'
                        }`}
                      >
                        {u.role}
                      </span>
                    </td>

                    <td className="px-4 py-3">
                      <button
                        onClick={() => toggleActive(u)}
                        className={`px-2 py-0.5 rounded-full border text-[10px] font-medium transition-all ${
                          u.isActive
                            ? 'bg-green-500/20 text-green-400 border-green-500/30'
                            : 'bg-red-500/20 text-red-400 border-red-500/30'
                        }`}
                      >
                        {u.isActive ? 'Active' : 'Disabled'}
                      </button>
                    </td>

                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => resetTokens(u._id, u.name)}
                          className="p-1.5 text-dark-400 hover:text-emerald-400 hover:bg-emerald-500/10 rounded-lg transition-all"
                          title="Reset 7-Day Token Count to 0"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setEditingUser({ ...u })}
                          className="p-1.5 text-dark-400 hover:text-brand-400 hover:bg-brand-500/10 rounded-lg transition-all"
                          title="Edit User & Plan"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        {u.role !== 'admin' && (
                          <button
                            onClick={() => deleteUser(u._id)}
                            className="p-1.5 text-dark-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
                            title="Delete User"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
