'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  BarChart3, Check, Clock, Cpu, CreditCard, Layers, RefreshCw, Shield, Sparkles, Zap,
} from 'lucide-react'
import { chatApi, paymentApi, userApi } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/lib/cn'
import { compactNumber, formatDateTime, percent, relativeTime } from '@/lib/format'
import { Badge, Button, Card, CardHeader, EmptyState, InlineError, Meter, Skeleton } from '@/components/ui/primitives'
import { CountUp, ProgressRing, Reveal } from '@/components/ui/Reveal'
import { ConfirmDialog } from '@/components/ui/Modal'
import toast from 'react-hot-toast'

/* ══════════════════════════════════════════════════════════════════════════
   Subscription & quota.

   The allowance is the one number that explains why a cloud model refused to
   answer, so it leads the page as an arc, with the reset clock beside it. Plan
   switching asks for confirmation and states the new limit before it changes.
   ══════════════════════════════════════════════════════════════════════════ */

interface Plan {
  id: 'free' | 'pro' | 'enterprise'
  name: string
  price: string
  period: string
  description: string
  limit: number
  features: string[]
  popular?: boolean
}

const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free Starter',
    price: '$0',
    period: 'forever',
    description: 'Everyday chatting, WhatsApp automation and the standard cloud models.',
    limit: 1_000_000,
    features: [
      'Local on-device models — free and unmetered',
      '1,000,000 cloud tokens per 7 days',
      'WhatsApp assistant with business memory',
      'Web app and HTML5 game skills',
      'Memory released automatically when idle',
    ],
  },
  {
    id: 'pro',
    name: 'Pro Creator',
    price: '$19',
    period: 'per month',
    description: 'Heavier throughput, larger local models and multimodal uploads.',
    limit: 2_000_000,
    popular: true,
    features: [
      'Larger local models (3B – 26B)',
      '2,000,000 cloud tokens per 7 days',
      'Gemini+ multimodal: images, video, documents',
      'Interactive app runner with code export',
      'Custom system prompt and priority replies',
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: '$49',
    period: 'per month',
    description: 'For high-volume operations and multi-number WhatsApp setups.',
    limit: 5_000_000,
    features: [
      '5,000,000 cloud tokens per 7 days',
      'Frontier models: GPT-4o, Claude, Gemini Pro',
      'Multiple WhatsApp numbers under one account',
      'Unlimited memory entries and personas',
      'Admin quota controls and analytics',
    ],
  },
]

export default function SubscriptionPage() {
  const { user, isAdmin } = useAuth()
  const [quota, setQuota] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pendingPlan, setPendingPlan] = useState<Plan | null>(null)
  const [switching, setSwitching] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res: any = await chatApi.getQuota()
      if (res?.success) setQuota(res.quota)
    } catch (err: any) {
      setError(err.message || 'Could not read the token quota')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // Back from the payment gateway: ?payment=success|failed|cancelled|invalid.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('payment')
    if (!q) return
    if (q === 'success') toast.success('Payment received — welcome to your new plan')
    else if (q === 'failed' || q === 'cancelled') toast.error(`Checkout ${q} — no charge was made, try again when ready`)
    else toast('Checkout finished with an unclear result — check with support if you were charged')
    window.history.replaceState(null, '', window.location.pathname)
    void load()
  }, [load])

  const currentTier: string = quota?.tier || user?.subscription?.tier || 'free'
  const used = quota?.tokensUsed7d ?? user?.tokenQuota?.tokensUsed7d ?? 0
  const limit = quota?.weeklyLimit ?? user?.tokenQuota?.weeklyLimit ?? 1_000_000
  const usedPct = percent(used, limit)
  const daysLeft = quota?.daysLeft ?? 7
  const history: any[] = quota?.history || []

  const applyPlan = async () => {
    if (!pendingPlan) return
    // Free is a self-serve downgrade. Paid tiers MUST go through checkout —
    // the server answers 402 to any direct upgrade attempt.
    if (pendingPlan.id !== 'free') {
      setSwitching(true)
      try {
        const res: any = await paymentApi.init(pendingPlan.id)
        if (res?.url) {
          window.location.href = res.url
          return
        }
        toast.error('Checkout did not return a payment page — try again')
      } catch (err: any) {
        toast.error(err.message || 'Checkout is not available right now')
      } finally {
        setSwitching(false)
      }
      return
    }
    setSwitching(true)
    try {
      const res: any = await userApi.updateSubscription(pendingPlan.id)
      toast.success(res.message || `Switched to ${pendingPlan.name}`)
      setPendingPlan(null)
      await load()
    } catch (err: any) {
      toast.error(err.message || 'Could not switch plans')
    } finally {
      setSwitching(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-1 text-[10.5px] font-bold uppercase tracking-[0.22em] text-brand-400/80">Billing</p>
          <h1 className="flex flex-wrap items-center gap-2 text-[22px] font-semibold tracking-tight text-white">
            Subscription &amp; quota
            {isAdmin ? (
              <Badge tone="amber" icon={<Shield className="h-3 w-3" />}>admin · unmetered</Badge>
            ) : null}
          </h1>
          <p className="mt-1 text-[13px] text-dark-400">
            Local models never touch this allowance — only cloud requests count.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={load} loading={loading} icon={<RefreshCw className="h-3.5 w-3.5" />}>
          Refresh usage
        </Button>
      </div>

      {error ? <InlineError>{error}</InlineError> : null}

      {/* Usage */}
      <Reveal>
        <Card gold className="relative overflow-hidden">
          <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-brand-500/[0.08] blur-3xl" />
          <div className="relative flex flex-wrap items-center justify-between gap-6">
            {loading && !quota ? (
              <>
                <Skeleton className="h-32 w-32 rounded-full" />
                <div className="flex-1 space-y-3">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-3 w-full" />
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-6">
                  <ProgressRing
                    value={usedPct}
                    size={148}
                    stroke={10}
                    label={
                      <span className="mono-num text-[22px] font-semibold text-white">
                        <CountUp value={used} />
                      </span>
                    }
                    sublabel={`of ${compactNumber(limit)}`}
                  />
                  <div>
                    <p className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-brand-300">
                      7-day cloud token allowance
                    </p>
                    <p className="mt-1.5 text-[15px] font-semibold text-white">
                      {usedPct}% used
                    </p>
                    <p className="mt-1 text-[12.5px] text-dark-400">
                      {compactNumber(Math.max(0, limit - used))} tokens left
                    </p>
                    <p className="mt-3 flex items-center gap-1.5 text-[12px] text-dark-400">
                      <Clock className="h-3.5 w-3.5 text-dark-500" aria-hidden />
                      resets in {daysLeft} day{daysLeft === 1 ? '' : 's'}
                    </p>
                  </div>
                </div>

                <div className="min-w-[240px] flex-1 space-y-3">
                  <Meter value={usedPct} tone={usedPct > 85 ? 'danger' : usedPct > 60 ? 'warn' : 'gold'} />
                  <div className="flex justify-between text-[11px] text-dark-500">
                    <span>0</span>
                    <span>current plan: <span className="uppercase text-dark-300">{currentTier}</span></span>
                    <span>{compactNumber(limit)}</span>
                  </div>
                  <p className="flex items-start gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-[11.5px] leading-relaxed text-dark-400">
                    <Cpu className="mt-0.5 h-3.5 w-3.5 flex-none text-emerald-400" aria-hidden />
                    Local on-device models are unmetered. If a cloud reply fails with a quota message,
                    switch the model or wait for the reset.
                  </p>
                </div>
              </>
            )}
          </div>
        </Card>
      </Reveal>

      {/* Plans */}
      <Reveal delay={60}>
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-brand-300" aria-hidden />
            <h2 className="text-[15px] font-semibold text-white">Choose a plan</h2>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {PLANS.map(plan => {
              const isCurrent = currentTier === plan.id
              return (
                <div
                  key={plan.id}
                  className={cn(
                    'card relative flex flex-col p-5 transition-all duration-300 ease-quint',
                    plan.popular && !isCurrent && 'border-brand-400/30 shadow-gold-sm',
                    isCurrent && 'border-emerald-500/30 bg-emerald-500/[0.03]'
                  )}
                >
                  {plan.popular && !isCurrent ? (
                    <span className="absolute -top-2.5 left-5 inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-brand-400 to-brand-600 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-dark-950">
                      <Sparkles className="h-2.5 w-2.5" aria-hidden /> most popular
                    </span>
                  ) : null}

                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-[15px] font-semibold text-white">{plan.name}</h3>
                      <p className="mt-1 text-[12px] leading-relaxed text-dark-400">{plan.description}</p>
                    </div>
                    {isCurrent ? <Badge tone="green">current</Badge> : null}
                  </div>

                  <p className="mt-4 flex items-baseline gap-1.5">
                    <span className="text-[28px] font-semibold leading-none text-white">{plan.price}</span>
                    <span className="text-[11.5px] text-dark-500">/ {plan.period}</span>
                  </p>

                  <p className="mt-3 flex items-center gap-2 text-[12px] text-brand-200">
                    <Zap className="h-3.5 w-3.5" aria-hidden />
                    {compactNumber(plan.limit)} tokens / 7 days
                  </p>

                  <ul className="mt-4 flex-1 space-y-2 border-t border-white/[0.06] pt-4">
                    {plan.features.map(feature => (
                      <li key={feature} className="flex items-start gap-2 text-[12.5px] leading-relaxed text-dark-300">
                        <Check className="mt-0.5 h-3.5 w-3.5 flex-none text-emerald-400" aria-hidden />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>

                  <Button
                    className="mt-5"
                    full
                    variant={isCurrent ? 'ghost' : plan.popular ? 'primary' : 'secondary'}
                    disabled={isCurrent}
                    onClick={() => setPendingPlan(plan)}
                  >
                    {isCurrent ? 'Current plan' : `Switch to ${plan.name}`}
                  </Button>
                </div>
              )
            })}
          </div>
        </div>
      </Reveal>

      {/* Activity */}
      <Reveal delay={100}>
        <Card padded={false}>
          <div className="px-5 pt-5">
            <CardHeader
              icon={<BarChart3 className="h-4 w-4" />}
              title="Recent token activity"
              description="The last cloud requests charged to this account."
            />
          </div>
          {history.length === 0 ? (
            <EmptyState
              icon={<CreditCard className="h-5 w-5" />}
              title="Nothing charged yet"
              description="Local chats and this week's cloud replies will appear here with the model name and token count."
            />
          ) : (
            <ul className="mt-3 divide-y divide-white/[0.05]">
              {history.slice(-8).reverse().map((entry: any, index: number) => (
                <li key={`${entry.date}-${index}`} className="table-row flex items-center justify-between gap-4 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-[12.5px] font-medium text-dark-100">{entry.model || 'Cloud model'}</p>
                    <p className="text-[11px] text-dark-500" title={formatDateTime(entry.date)}>
                      {relativeTime(entry.date)}
                    </p>
                  </div>
                  <span className="mono-num flex-none font-mono text-[12px] font-semibold text-brand-300">
                    +{(entry.tokens || 0).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Reveal>

      <ConfirmDialog
        open={Boolean(pendingPlan)}
        onClose={() => setPendingPlan(null)}
        onConfirm={applyPlan}
        loading={switching}
        tone="primary"
        title={pendingPlan ? `Switch to ${pendingPlan.name}?` : ''}
        description={pendingPlan
          ? pendingPlan.id === 'free'
            ? `Your weekly allowance becomes ${compactNumber(pendingPlan.limit)} tokens. Existing usage in this window is kept, and the change takes effect immediately.`
            : `You go to the secure checkout (cards, bKash, Nagad) for ${pendingPlan.name}. Your plan switches on automatically once the payment validates.`
          : ''}
        confirmLabel={pendingPlan?.id === 'free' ? 'Switch plan' : 'Pay & switch'}
      />
    </div>
  )
}
