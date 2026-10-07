'use client'
import { useState, useEffect, FormEvent } from 'react'
import { Brain, Plus, Trash2, Edit2, Save, X } from 'lucide-react'
import { memoryApi } from '@/lib/api'
import toast from 'react-hot-toast'

const CATEGORIES = ['business', 'product', 'customer', 'preference', 'fact', 'other']
const CATEGORY_COLORS: Record<string, string> = {
  business: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  product: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  customer: 'bg-green-500/20 text-green-400 border-green-500/30',
  preference: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  fact: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
  other: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
}

export default function MemoryPage() {
  const [memory, setMemory] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [addingEntry, setAddingEntry] = useState(false)
  const [editingEntry, setEditingEntry] = useState<string | null>(null)
  const [newEntry, setNewEntry] = useState({ key: '', value: '', category: 'other' })
  const [editEntry, setEditEntry] = useState({ key: '', value: '', category: 'other' })
  const [baseForm, setBaseForm] = useState({
    ownerName: '',
    businessName: '',
    businessType: '',
    businessDescription: '',
    tone: 'professional',
    language: 'English',
  })

  useEffect(() => {
    loadMemory()
  }, [])

  const loadMemory = async () => {
    setLoading(true)
    try {
      const d: any = await memoryApi.get()
      setMemory(d.memory)
      setBaseForm({
        ownerName: d.memory?.ownerName || '',
        businessName: d.memory?.businessName || '',
        businessType: d.memory?.businessType || '',
        businessDescription: d.memory?.businessDescription || '',
        tone: d.memory?.tone || 'professional',
        language: d.memory?.language || 'English',
      })
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  const saveBase = async () => {
    setSaving(true)
    try {
      const d: any = await memoryApi.update(baseForm)
      setMemory(d.memory)
      toast.success('Memory updated!')
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const addEntry = async (e: FormEvent) => {
    e.preventDefault()
    if (!newEntry.key || !newEntry.value) {
      toast.error('Key and value required')
      return
    }
    try {
      const d: any = await memoryApi.addEntry(newEntry.key, newEntry.value, newEntry.category)
      setMemory(d.memory)
      setNewEntry({ key: '', value: '', category: 'other' })
      setAddingEntry(false)
      toast.success('Knowledge entry added!')
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const deleteEntry = async (entryId: string) => {
    try {
      const d: any = await memoryApi.deleteEntry(entryId)
      setMemory(d.memory)
      toast.success('Entry deleted')
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const saveEdit = async (entryId: string) => {
    try {
      const d: any = await memoryApi.updateEntry(
        entryId,
        editEntry.key,
        editEntry.value,
        editEntry.category
      )
      setMemory(d.memory)
      setEditingEntry(null)
      toast.success('Entry updated!')
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 animate-fade-in max-w-4xl">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center">
          <Brain className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">AI Memory & Context</h1>
          <p className="text-dark-300 text-sm">
            Teach your AI who the owner is, business profile, and custom customer memory
          </p>
        </div>
      </div>

      {/* Base info */}
      <div className="glass rounded-2xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Business Identity & Owner Details</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            { label: 'Owner Name', key: 'ownerName', placeholder: 'e.g. Sahadat' },
            { label: 'Business Name', key: 'businessName', placeholder: 'e.g. My Agency' },
            { label: 'Business Type / Industry', key: 'businessType', placeholder: 'e.g. E-commerce, Real Estate' },
            { label: 'Primary Language', key: 'language', placeholder: 'e.g. English, Bengali' },
          ].map(({ label, key, placeholder }) => (
            <div key={key}>
              <label className="block text-sm text-dark-300 mb-1.5">{label}</label>
              <input
                value={baseForm[key as keyof typeof baseForm]}
                onChange={e => setBaseForm(f => ({ ...f, [key]: e.target.value }))}
                placeholder={placeholder}
                className="input-dark"
              />
            </div>
          ))}
          <div className="md:col-span-2">
            <label className="block text-sm text-dark-300 mb-1.5">Business Description & Services</label>
            <textarea
              value={baseForm.businessDescription}
              onChange={e => setBaseForm(f => ({ ...f, businessDescription: e.target.value }))}
              placeholder="Describe your products, pricing, working hours, and what the AI should answer on your behalf..."
              rows={3}
              className="input-dark"
            />
          </div>
          <div>
            <label className="block text-sm text-dark-300 mb-1.5">AI Persona Tone</label>
            <select
              value={baseForm.tone}
              onChange={e => setBaseForm(f => ({ ...f, tone: e.target.value }))}
              className="input-dark"
            >
              {['professional', 'friendly', 'casual', 'formal', 'enthusiastic'].map(t => (
                <option key={t} value={t} className="bg-dark-900">
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button onClick={saveBase} disabled={saving} className="btn-primary mt-4">
          <Save className="w-4 h-4" />
          {saving ? 'Saving...' : 'Save Identity'}
        </button>
      </div>

      {/* Memory entries */}
      <div className="glass rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-white">
              Custom Knowledge Entries ({memory?.entries?.length || 0})
            </h2>
            <p className="text-dark-400 text-xs">
              Add specific facts, policies, prices, or FAQs the AI should recall
            </p>
          </div>
          <button onClick={() => setAddingEntry(true)} className="btn-primary">
            <Plus className="w-4 h-4" /> Add Memory
          </button>
        </div>

        {/* Add form */}
        {addingEntry && (
          <form onSubmit={addEntry} className="glass-strong rounded-xl p-4 mb-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                value={newEntry.key}
                onChange={e => setNewEntry(n => ({ ...n, key: e.target.value }))}
                placeholder="Key / Topic (e.g. Delivery Area or Refund Policy)"
                className="input-dark"
                required
              />
              <select
                value={newEntry.category}
                onChange={e => setNewEntry(n => ({ ...n, category: e.target.value }))}
                className="input-dark"
              >
                {CATEGORIES.map(c => (
                  <option key={c} value={c} className="bg-dark-900">
                    {c.charAt(0).toUpperCase() + c.slice(1)}
                  </option>
                ))}
              </select>
            </div>
            <textarea
              value={newEntry.value}
              onChange={e => setNewEntry(n => ({ ...n, value: e.target.value }))}
              placeholder="Information / Memory content..."
              rows={2}
              className="input-dark"
              required
            />
            <div className="flex gap-2">
              <button type="submit" className="btn-primary">
                <Save className="w-4 h-4" />
                Save Memory
              </button>
              <button
                type="button"
                onClick={() => setAddingEntry(false)}
                className="btn-ghost"
              >
                <X className="w-4 h-4" />
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Entries list */}
        <div className="space-y-2">
          {memory?.entries?.length === 0 ? (
            <div className="text-center py-8">
              <Brain className="w-10 h-10 text-dark-500 mx-auto mb-2" />
              <p className="text-dark-400 text-sm">
                No custom memory added yet. Add details about your business so the AI knows!
              </p>
            </div>
          ) : (
            memory?.entries?.map((entry: any) => (
              <div key={entry._id} className="glass-strong rounded-xl p-4">
                {editingEntry === entry._id ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        value={editEntry.key}
                        onChange={e => setEditEntry(n => ({ ...n, key: e.target.value }))}
                        className="input-dark text-sm"
                      />
                      <select
                        value={editEntry.category}
                        onChange={e =>
                          setEditEntry(n => ({ ...n, category: e.target.value }))
                        }
                        className="input-dark text-sm"
                      >
                        {CATEGORIES.map(c => (
                          <option key={c} value={c} className="bg-dark-900">
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>
                    <textarea
                      value={editEntry.value}
                      onChange={e =>
                        setEditEntry(n => ({ ...n, value: e.target.value }))
                      }
                      rows={2}
                      className="input-dark text-sm"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => saveEdit(entry._id)}
                        className="btn-primary text-xs py-1.5"
                      >
                        <Save className="w-3.5 h-3.5" />
                        Save
                      </button>
                      <button
                        onClick={() => setEditingEntry(null)}
                        className="btn-ghost text-xs py-1.5"
                      >
                        <X className="w-3.5 h-3.5" />
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-white text-sm">{entry.key}</span>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full border ${
                            CATEGORY_COLORS[entry.category] || CATEGORY_COLORS.other
                          }`}
                        >
                          {entry.category}
                        </span>
                      </div>
                      <p className="text-dark-200 text-sm">{entry.value}</p>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <button
                        onClick={() => {
                          setEditingEntry(entry._id)
                          setEditEntry({
                            key: entry.key,
                            value: entry.value,
                            category: entry.category,
                          })
                        }}
                        className="p-1.5 text-dark-400 hover:text-brand-400 hover:bg-brand-500/10 rounded-lg transition-all"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => deleteEntry(entry._id)}
                        className="p-1.5 text-dark-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
