'use client'
import { useState, FormEvent } from 'react'
import { Settings, Key, Save, Lock, User } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { apiRequest } from '@/lib/auth'
import toast from 'react-hot-toast'

export default function SettingsPage() {
  const { user, refreshUser } = useAuth()
  const [profile, setProfile] = useState({ name: user?.name || '', phone: user?.phone || '' })
  const [apiKey, setApiKey] = useState(user?.contentbotApiKey || '')
  const [passwords, setPasswords] = useState({ current: '', newPass: '', confirm: '' })
  const [saving, setSaving] = useState(false)

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await apiRequest('/user/profile', { method: 'PUT', body: JSON.stringify(profile) })
      await refreshUser()
      toast.success('Profile updated!')
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const saveApiKey = async () => {
    try {
      await apiRequest('/user/api-key', {
        method: 'PUT',
        body: JSON.stringify({ contentbotApiKey: apiKey }),
      })
      await refreshUser()
      toast.success('ContentBot API Key saved!')
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const changePassword = async (e: FormEvent) => {
    e.preventDefault()
    if (passwords.newPass !== passwords.confirm) {
      toast.error('Passwords do not match')
      return
    }
    try {
      await apiRequest('/user/password', {
        method: 'PUT',
        body: JSON.stringify({
          currentPassword: passwords.current,
          newPassword: passwords.newPass,
        }),
      })
      setPasswords({ current: '', newPass: '', confirm: '' })
      toast.success('Password changed successfully!')
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  return (
    <div className="p-6 space-y-6 animate-fade-in max-w-2xl">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-purple-600 flex items-center justify-center">
          <Settings className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Account & System Settings</h1>
          <p className="text-dark-300 text-sm">Configure your personal profile, credentials and API keys</p>
        </div>
      </div>

      {/* Profile */}
      <form onSubmit={saveProfile} className="glass rounded-2xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <User className="w-5 h-5 text-brand-400" /> User Profile
        </h2>
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-dark-300 mb-1">Full Name</label>
            <input
              value={profile.name}
              onChange={e => setProfile(p => ({ ...p, name: e.target.value }))}
              className="input-dark"
            />
          </div>
          <div>
            <label className="block text-sm text-dark-300 mb-1">Email</label>
            <input
              value={user?.email || ''}
              disabled
              className="input-dark opacity-50 cursor-not-allowed"
            />
          </div>
          <div>
            <label className="block text-sm text-dark-300 mb-1">Phone Number</label>
            <input
              value={profile.phone}
              onChange={e => setProfile(p => ({ ...p, phone: e.target.value }))}
              placeholder="+8801..."
              className="input-dark"
            />
          </div>
        </div>
        <button type="submit" disabled={saving} className="btn-primary mt-4">
          <Save className="w-4 h-4" />
          {saving ? 'Saving...' : 'Save Profile'}
        </button>
      </form>

      {/* ContentBot API Key */}
      <div className="glass rounded-2xl p-6">
        <h2 className="text-lg font-semibold text-white mb-2 flex items-center gap-2">
          <Key className="w-5 h-5 text-brand-400" /> ContentBot Agent Key
        </h2>
        <p className="text-dark-400 text-sm mb-4">
          Provide your ContentBot agent API key to enable ContentBot cloud modes and multi-agent workflows.
        </p>
        <div className="flex gap-2">
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="cb-agents-key-..."
            className="input-dark flex-1 font-mono text-sm"
          />
          <button onClick={saveApiKey} className="btn-primary">
            <Save className="w-4 h-4" /> Save Key
          </button>
        </div>
      </div>

      {/* Password change */}
      <form onSubmit={changePassword} className="glass rounded-2xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Lock className="w-5 h-5 text-brand-400" /> Change Password
        </h2>
        <div className="space-y-3">
          {[
            { label: 'Current Password', key: 'current' },
            { label: 'New Password', key: 'newPass' },
            { label: 'Confirm New Password', key: 'confirm' },
          ].map(({ label, key }) => (
            <div key={key}>
              <label className="block text-sm text-dark-300 mb-1">{label}</label>
              <input
                type="password"
                value={passwords[key as keyof typeof passwords]}
                onChange={e => setPasswords(p => ({ ...p, [key]: e.target.value }))}
                className="input-dark"
                required
                minLength={key !== 'current' ? 8 : 1}
              />
            </div>
          ))}
        </div>
        <button type="submit" className="btn-primary mt-4">
          <Lock className="w-4 h-4" /> Change Password
        </button>
      </form>
    </div>
  )
}
