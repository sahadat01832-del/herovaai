'use client'
import { useState, useEffect } from 'react'
import {
  CreditCard, Zap, CheckCircle2, Shield, Sparkles,
  BarChart3, Clock, AlertCircle, RefreshCw, Cpu, Layers
} from 'lucide-react'
import { chatApi, userApi } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import toast from 'react-hot-toast'

export default function SubscriptionPage() {
  const { user, isAdmin } = useAuth()
  const [quota, setQuota] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [updatingTier, setUpdatingTier] = useState<string | null>(null)

  useEffect(() => {
    loadQuota()
  }, [])

  const loadQuota = async () => {
    setLoading(true)
    try {
      const res: any = await chatApi.getQuota()
      if (res.success) {
        setQuota(res.quota)
      }
    } catch (err: any) {
      toast.error('Failed to load token quota')
    } finally {
      setLoading(false)
    }
  }

  const selectPlan = async (tier: string) => {
    setUpdatingTier(tier)
    try {
      const res: any = await userApi.updateSubscription(tier)
      if (res.success) {
        toast.success(res.message || `Switched to ${tier.toUpperCase()} plan!`)
        loadQuota()
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to update plan')
    } finally {
      setUpdatingTier(null)
    }
  }

  const currentTier = quota?.tier || user?.subscription?.tier || 'free'
  const usedTokens = quota?.tokensUsed7d || 0
  const limitTokens = quota?.weeklyLimit || 1000000
  const percentUsed = Math.min(100, Math.round((usedTokens / limitTokens) * 100))
  const daysLeft = quota?.daysLeft || 7

  const PLANS = [
    {
      id: 'free',
      name: 'Free Starter',
      badge: 'Current Standard',
      price: '$0',
      period: 'forever',
      description: 'Ideal for everyday local AI chatting and standard API access',
      features: [
        'Local LM Studio 0.5B - 1B models (Free & Unlimited)',
        '1,000,000 API Tokens per 7 days',
        'OpenRouter, Nemotron, Liquid, Gemma cloud models',
        'WhatsApp AI Assistant with Business Memory',
        'Web App & HTML5 Game creation skills',
        'Auto RAM-release after 20 seconds inactivity',
      ],
      popular: false,
    },
    {
      id: 'pro',
      name: 'Pro Creator & Business',
      badge: 'Most Popular',
      price: '$19',
      period: 'per month',
      description: 'For power users needing heavy token throughput, higher models, and multimodal',
      features: [
        'Higher Local Models (3B - 26B Qwen & Gemma Pro)',
        '2,000,000 API Tokens per 7 days',
        'Gemini+ Multimodal: Upload images, videos, documents',
        'Interactive App & Game Live Runner with code export',
        'Priority WhatsApp response speed & custom rules',
        'Advanced System Prompt customization',
      ],
      popular: true,
    },
    {
      id: 'enterprise',
      name: 'Enterprise VIP',
      badge: 'Full Capacity',
      price: '$49',
      period: 'per month',
      description: 'For high-volume business operations and full team automation',
      features: [
        '5,000,000 API Tokens per 7 days',
        'All frontier models: GPT-4o, Claude 3.5, Gemini 2.0 Pro',
        'Multi-number WhatsApp Bot management',
        'Unlimited memory entries & tailored business persona',
        'Dedicated admin quota controls & analytics',
        '24/7 Priority support & uptime guarantee',
      ],
      popular: false,
    },
  ]

  return (
    <div className="p-3 sm:p-6 max-w-6xl mx-auto space-y-6 sm:space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-brand-500 to-purple-600 flex items-center justify-center glow-brand">
            <CreditCard className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              Subscription & Token Quotas
              {isAdmin && (
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-yellow-500/20 text-yellow-300 border border-yellow-500/30 flex items-center gap-1">
                  <Shield className="w-3 h-3" /> Admin (Unlimited Quota)
                </span>
              )}
            </h1>
            <p className="text-dark-300 text-sm">
              Manage your plan, monitor your 7-day API token quota, and unlock Gemini+ multimodal features
            </p>
          </div>
        </div>
        <button onClick={loadQuota} className="btn-ghost text-xs self-start md:self-auto">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh Usage
        </button>
      </div>

      {/* 7-Day Token Quota Status Card */}
      <div className="glass-strong rounded-3xl p-6 border border-white/10 relative overflow-hidden">
        <div className="absolute -right-16 -top-16 w-64 h-64 bg-brand-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs uppercase font-bold tracking-wider text-brand-400 flex items-center gap-1">
                <Zap className="w-3.5 h-3.5" /> 7-Day API Token Quota
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-white font-medium">
                Active Tier: {currentTier.toUpperCase()}
              </span>
            </div>
            <h3 className="text-2xl font-bold text-white">
              {usedTokens.toLocaleString()}{' '}
              <span className="text-dark-400 text-lg font-normal">
                / {limitTokens.toLocaleString()} tokens
              </span>
            </h3>
          </div>

          <div className="flex items-center gap-3">
            <div className="glass px-4 py-2.5 rounded-xl border border-white/5 flex items-center gap-2">
              <Clock className="w-4 h-4 text-purple-400" />
              <div>
                <p className="text-[10px] text-dark-400 uppercase">Quota Resets In</p>
                <p className="text-xs font-bold text-white">{daysLeft} Day{daysLeft > 1 ? 's' : ''}</p>
              </div>
            </div>
            <div className="glass px-4 py-2.5 rounded-xl border border-white/5 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-emerald-400" />
              <div>
                <p className="text-[10px] text-dark-400 uppercase">Remaining</p>
                <p className="text-xs font-bold text-white">
                  {Math.max(0, limitTokens - usedTokens).toLocaleString()} tokens
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="space-y-2">
          <div className="w-full h-3 rounded-full bg-black/40 border border-white/5 overflow-hidden p-0.5">
            <div
              className={`h-full rounded-full transition-all duration-700 ${
                percentUsed > 85
                  ? 'bg-gradient-to-r from-red-500 to-rose-600'
                  : percentUsed > 60
                  ? 'bg-gradient-to-r from-yellow-500 to-amber-600'
                  : 'bg-gradient-to-r from-brand-500 to-purple-600'
              }`}
              style={{ width: `${percentUsed}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-dark-400 font-mono">
            <span>0 Tokens</span>
            <span>{percentUsed}% used (Auto-resets every 7 days)</span>
            <span>{limitTokens.toLocaleString()} Max</span>
          </div>
        </div>

        {/* Local LM Studio Notice */}
        <div className="mt-5 pt-4 border-t border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-dark-300">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <span>
              <strong>Local 0.5B - 1B LM Studio Models:</strong> 100% Free & Unmetered (do not consume your weekly API quota).
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-brand-300 font-medium">
            <Sparkles className="w-3.5 h-3.5" />
            <span>All API Models included in your 1M token limit</span>
          </div>
        </div>
      </div>

      {/* Plan Cards */}
      <div>
        <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <Layers className="w-5 h-5 text-brand-400" /> Choose Your Plan
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {PLANS.map(plan => {
            const isCurrent = currentTier === plan.id

            return (
              <div
                key={plan.id}
                className={`glass-strong rounded-3xl p-6 flex flex-col justify-between border transition-all duration-200 relative ${
                  plan.popular
                    ? 'border-brand-500/50 glow-brand scale-[1.02]'
                    : isCurrent
                    ? 'border-emerald-500/40 bg-emerald-950/10'
                    : 'border-white/5 hover:border-white/20'
                }`}
              >
                {plan.popular && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-brand-500 to-purple-600 text-white text-[11px] font-bold px-3 py-1 rounded-full uppercase tracking-wider shadow-lg">
                    {plan.badge}
                  </span>
                )}

                <div>
                  <div className="flex justify-between items-start mb-3">
                    <h3 className="text-xl font-bold text-white">{plan.name}</h3>
                    {isCurrent && (
                      <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Active Plan
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-dark-300 mb-4">{plan.description}</p>

                  <div className="flex items-baseline gap-1 mb-6">
                    <span className="text-3xl font-extrabold text-white">{plan.price}</span>
                    <span className="text-xs text-dark-400">/{plan.period}</span>
                  </div>

                  <div className="space-y-3 mb-6">
                    {plan.features.map((feat, idx) => (
                      <div key={idx} className="flex items-start gap-2.5 text-xs text-dark-200">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mt-0.5 flex-shrink-0" />
                        <span>{feat}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <button
                  onClick={() => selectPlan(plan.id)}
                  disabled={isCurrent || updatingTier === plan.id}
                  className={`w-full py-2.5 rounded-xl font-semibold text-xs transition-all ${
                    isCurrent
                      ? 'bg-white/10 text-dark-400 cursor-default'
                      : plan.popular
                      ? 'btn-primary justify-center'
                      : 'btn-ghost justify-center border border-white/10 hover:border-white/30 text-white'
                  }`}
                >
                  {updatingTier === plan.id
                    ? 'Updating...'
                    : isCurrent
                    ? 'Current Plan'
                    : `Switch to ${plan.name}`}
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {/* Token Usage History (Recent 5) */}
      {quota?.history && quota.history.length > 0 && (
        <div className="glass rounded-2xl p-5 border border-white/5">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <Clock className="w-4 h-4 text-dark-400" /> Recent Token Activity
          </h3>
          <div className="divide-y divide-white/5 text-xs">
            {quota.history.slice(-5).reverse().map((entry: any, i: number) => (
              <div key={i} className="py-2.5 flex items-center justify-between">
                <div>
                  <p className="font-medium text-white">{entry.model || 'API Model'}</p>
                  <p className="text-[10px] text-dark-400">
                    {new Date(entry.date).toLocaleString()}
                  </p>
                </div>
                <span className="font-mono text-brand-300 font-semibold">
                  +{entry.tokens} tokens
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
