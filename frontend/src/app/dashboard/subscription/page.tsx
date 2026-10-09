'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  BarChart3, Check, Clock, Cpu, CreditCard, Layers, ListOrdered, RefreshCw, Shield, Smartphone, Sparkles, Zap,
} from 'lucide-react'
import { chatApi, paymentApi, userApi } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/lib/cn'
import { compactNumber, formatDateTime, percent, relativeTime } from '@/lib/format'
import { Badge, Button, Card, CardHeader, CopyButton, EmptyState, InlineError, Meter, Skeleton } from '@/components/ui/primitives'
import { CountUp, ProgressRing, Reveal } from '@/components/ui/Reveal'
import { ConfirmDialog, Modal } from '@/components/ui/Modal'
import { Field, Input } from '@/components/ui/Field'
import toast from 'react-hot-toast'

/* ══════════════════════════════════════════════════════════════════════════
   Subscription & quota — three plans, priced in taka.

   Free is self-serve. Pro (৳100/month) and Enterprise (৳300/month) are paid,
   and the plan only moves when the money is confirmed:
     • Nagad  — the local rail. Send money to the owner's Nagad number, paste the
                TrxID; done automatically when Nagad merchant keys are set up,
                otherwise confirmed by the owner within minutes.
     • Cards / bKash — SSLCommerz checkout, for anyone who prefers it.
   ══════════════════════════════════════════════════════════════════════════ */

interface Plan {
  id: 'free' | 'pro' | 'enterprise'
  name: string
  bdt: number
  period: string
  blurb: string
  tokens: number
  popular?: boolean
  features: string[]
}

/** Shown until /payments/plans answers; the server value always wins after. */
const PLAN_FALLBACK: Plan[] = [
  {
    id: 'free', name: 'Free', bdt: 0, period: 'forever', tokens: 1_000_000,
    blurb: 'Everyday chatting, WhatsApp automation and the standard cloud models.',
    features: [
      'Local on-device models — free and unmetered',
      '1,000,000 cloud tokens per 7 days',
      'WhatsApp assistant with business memory',
      'Channel connections: Messenger, Facebook, Telegram',
      'Memory released automatically when idle',
    ],
  },
  {
    id: 'pro', name: 'Pro', bdt: 100, period: 'per month', tokens: 2_000_000, popular: true,
    blurb: 'Heavier throughput, larger local models and daily auto-posting.',
    features: [
      'Larger local models (3B – 26B)',
      '2,000,000 cloud tokens per 7 days',
      'Daily auto-post to Facebook, Instagram and Telegram',
      'AI auto-reply on Messenger, Instagram, Telegram and WhatsApp',
      'Gemini+ multimodal: images, video, documents',
    ],
  },
  {
    id: 'enterprise', name: 'Enterprise', bdt: 300, period: 'per month', tokens: 5_000_000,
    blurb: 'For high-volume operations and multi-number, multi-channel setups.',
    features: [
      '5,000,000 cloud tokens per 7 days',
      'Frontier models: GPT-4o, Claude, Gemini Pro',
      'Multiple WhatsApp numbers + YouTube / Google channels',
      'Unlimited memory entries, personas and post topics',
      'Priority replies and admin quota controls',
    ],
  },
]

const taka = (amount: number) => `৳${Number(amount || 0).toLocaleString('en-IN')}`

const ORDER_TONE: Record<string, 'green' | 'amber' | 'red' | 'slate'> = {
  paid: 'green',
  awaiting_review: 'amber',
  pending: 'slate',
  failed: 'red',
  cancelled: 'slate',
  expired: 'slate',
  rejected: 'red',
}

const ORDER_LABEL: Record<string, string> = {
  paid: 'paid',
  awaiting_review: 'awaiting confirmation',
  pending: 'not paid yet',
  failed: 'failed',
  cancelled: 'cancelled',
  expired: 'expired',
  rejected: 'rejected',
}

export default function SubscriptionPage() {
  const { user, isAdmin } = useAuth()
  const [quota, setQuota] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pendingPlan, setPendingPlan] = useState<Plan | null>(null)
  const [checkoutPlan, setCheckoutPlan] = useState<Plan | null>(null)
  const [plans, setPlans] = useState<Plan[]>(PLAN_FALLBACK)
  const [orders, setOrders] = useState<any[]>([])

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

  const loadOrders = useCallback(async () => {
    try {
      const res: any = await paymentApi.orders()
      if (res?.success) setOrders(res.orders || [])
    } catch {
      /* the history is a convenience — never block the page on it */
    }
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => { void loadOrders() }, [loadOrders])

  // Plan prices come from the server so the dashboard and the checkout can
  // never quote different numbers.
  useEffect(() => {
    (async () => {
      try {
        const res: any = await paymentApi.plans()
        if (res?.success && Array.isArray(res.plans) && res.plans.length) setPlans(res.plans)
      } catch { /* keep the fallback table */ }
    })()
  }, [])

  // Back from a gateway: ?payment=success|failed|cancelled|review|invalid.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('payment')
    if (!q) return
    if (q === 'success') toast.success('Payment received — welcome to your new plan')
    else if (q === 'review') toast('Payment recorded — we are confirming it now')
    else if (q === 'failed' || q === 'cancelled') toast.error(`Checkout ${q} — no charge was made, try again when ready`)
    else toast('Checkout finished with an unclear result — check with support if you were charged')
    window.history.replaceState(null, '', window.location.pathname)
    void load()
    void loadOrders()
  }, [load, loadOrders])

  const currentTier: string = quota?.tier || user?.subscription?.tier || 'free'
  const used = quota?.tokensUsed7d ?? user?.tokenQuota?.tokensUsed7d ?? 0
  const limit = quota?.weeklyLimit ?? user?.tokenQuota?.weeklyLimit ?? 1_000_000
  const usedPct = percent(used, limit)
  const daysLeft = quota?.daysLeft ?? 7
  const history: any[] = quota?.history || []
  const awaiting = orders.filter(o => o.status === 'awaiting_review').length

  /** Free is a self-serve downgrade; paid tiers open the checkout. */
  const applyPlan = async () => {
    if (!pendingPlan) return
    if (pendingPlan.id !== 'free') {
      const chosen = pendingPlan
      setPendingPlan(null)
      setCheckoutPlan(chosen)
      return
    }
    setPendingPlan(null)
    try {
      const res: any = await userApi.updateSubscription(pendingPlan.id)
      toast.success(res.message || `Switched to ${pendingPlan.name}`)
      await load()
    } catch (err: any) {
      toast.error(err.message || 'Could not switch plans')
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
            Free, ৳100 and ৳300 a month. Local models never touch this allowance — only cloud requests count.
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
                    <p className="mt-1.5 text-[15px] font-semibold text-white">{usedPct}% used</p>
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
                  {awaiting > 0 ? (
                    <p className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-3 text-[11.5px] leading-relaxed text-amber-200">
                      <Smartphone className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden />
                      {awaiting} Nagad payment{awaiting === 1 ? '' : 's'} waiting to be confirmed. Your plan switches on
                      the moment it is checked — no need to pay again.
                    </p>
                  ) : null}
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
            {plans.map(plan => {
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
                      <p className="mt-1 text-[12px] leading-relaxed text-dark-400">{plan.blurb}</p>
                    </div>
                    {isCurrent ? <Badge tone="green">current</Badge> : null}
                  </div>

                  <p className="mt-4 flex items-baseline gap-1.5">
                    <span className="text-[28px] font-semibold leading-none text-white">{taka(plan.bdt)}</span>
                    <span className="text-[11.5px] text-dark-500">/ {plan.period}</span>
                  </p>

                  <p className="mt-3 flex items-center gap-2 text-[12px] text-brand-200">
                    <Zap className="h-3.5 w-3.5" aria-hidden />
                    {compactNumber(plan.tokens)} tokens / 7 days
                  </p>

                  <ul className="mt-4 flex-1 space-y-2 border-t border-white/[0.06] pt-4">
                    {(plan.features || []).map(feature => (
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
                    {isCurrent ? 'Current plan' : plan.bdt === 0 ? `Switch to ${plan.name}` : `Pay ${taka(plan.bdt)} — ${plan.name}`}
                  </Button>
                </div>
              )
            })}
          </div>
        </div>
      </Reveal>

      {/* Payment history */}
      <Reveal delay={90}>
        <Card padded={false}>
          <div className="px-5 pt-5">
            <CardHeader
              icon={<ListOrdered className="h-4 w-4" />}
              title="Payments"
              description="Every Nagad and card order on this account, newest first."
              action={
                awaiting > 0 ? <Badge tone="amber">{awaiting} waiting</Badge> : undefined
              }
            />
          </div>
          {orders.length === 0 ? (
            <EmptyState
              icon={<CreditCard className="h-5 w-5" />}
              title="No payments yet"
              description="Choose Pro or Enterprise above and pay with Nagad — the receipt shows up here."
            />
          ) : (
            <ul className="mt-3 divide-y divide-white/[0.05]">
              {orders.map(order => (
                <li key={order.tranId} className="table-row flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-[12.5px] font-medium text-dark-100">
                      <span className="uppercase">{order.tier}</span>
                      <span className="mono-num text-dark-300">{taka(order.amount)}</span>
                      <Badge tone={ORDER_TONE[order.status] || 'slate'}>{ORDER_LABEL[order.status] || order.status}</Badge>
                    </p>
                    <p className="mt-0.5 text-[11px] text-dark-500">
                      {order.gateway === 'nagad' ? 'Nagad' : 'Card'} · {order.tranId}
                      {order.nagadTrxId ? ` · TrxID ${order.nagadTrxId}` : ''} · {relativeTime(order.createdAt)}
                    </p>
                    {order.reviewNote ? (
                      <p className="mt-0.5 text-[11px] text-amber-300/80">{order.reviewNote}</p>
                    ) : null}
                  </div>
                  {order.status === 'awaiting_review' ? (
                    <NagadCheckNow tranId={order.tranId} onDone={() => { void loadOrders(); void load() }} />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Reveal>

      {/* Token activity */}
      <Reveal delay={120}>
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
        tone="primary"
        title={pendingPlan ? (pendingPlan.bdt === 0 ? `Switch to ${pendingPlan.name}?` : `Pay ${taka(pendingPlan.bdt)} for ${pendingPlan.name}?`) : ''}
        description={pendingPlan
          ? pendingPlan.bdt === 0
            ? `Your weekly allowance becomes ${compactNumber(pendingPlan.tokens)} tokens. Existing usage in this window is kept, and the change takes effect immediately.`
            : `You go to checkout — Nagad in taka, or card through SSLCommerz. ${pendingPlan.name} switches on automatically once the payment is confirmed.`
          : ''}
        confirmLabel={pendingPlan?.bdt === 0 ? 'Switch plan' : 'Continue to payment'}
      />

      {checkoutPlan ? (
        <NagadCheckout
          plan={checkoutPlan}
          onClose={() => setCheckoutPlan(null)}
          onPaid={async () => { await load(); await loadOrders() }}
        />
      ) : null}
    </div>
  )
}

/* ────────────────────────── Nagad / card checkout ───────────────────────── */

function NagadCheckout({ plan, onClose, onPaid }: { plan: Plan; onClose: () => void; onPaid: () => Promise<void> | void }) {
  const [config, setConfig] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [tranId, setTranId] = useState('')
  const [trxId, setTrxId] = useState('')
  const [sender, setSender] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ status: string; message: string } | null>(null)
  const [cardBusy, setCardBusy] = useState(false)

  useEffect(() => {
    (async () => {
      try {
        const res: any = await paymentApi.nagadConfig()
        if (res?.success) setConfig(res)
      } catch (err: any) {
        setConfig({ manual: false, auto: false, reason: err.message || 'Nagad is unavailable right now.' })
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  /** One press: create the order, then either redirect or show where to pay. */
  const startOrder = async () => {
    setBusy(true)
    setResult(null)
    try {
      const res: any = await paymentApi.nagadOrder(plan.id as 'pro' | 'enterprise')
      if (res?.url) {
        window.location.href = res.url
        return
      }
      setTranId(res.tranId)
      setConfig((prev: any) => ({ ...(prev || {}), ...res }))
      toast.success('Nagad order created — send the money, then paste the TrxID')
    } catch (err: any) {
      toast.error(err.message || 'Could not start the Nagad payment')
    } finally {
      setBusy(false)
    }
  }

  const submitTrx = async () => {
    if (!tranId) return
    setBusy(true)
    try {
      const res: any = await paymentApi.nagadSubmit(tranId, trxId, sender)
      setResult({ status: res.status, message: res.message })
      if (res.status === 'paid') {
        toast.success(res.message)
        await onPaid()
      } else {
        toast(res.message)
        await onPaid()
      }
      setTrxId('')
      setSender('')
    } catch (err: any) {
      toast.error(err.message || 'Could not record that TrxID')
    } finally {
      setBusy(false)
    }
  }

  const payByCard = async () => {
    setCardBusy(true)
    try {
      const res: any = await paymentApi.init(plan.id as 'pro' | 'enterprise')
      if (res?.url) {
        window.location.href = res.url
        return
      }
      toast.error('Checkout did not return a payment page — try again')
    } catch (err: any) {
      toast.error(err.message || 'Card checkout is not available right now')
    } finally {
      setCardBusy(false)
    }
  }

  const wallet: string = config?.wallet || ''
  const auto: boolean = Boolean(config?.auto)

  return (
    <Modal open onClose={onClose} title={`Pay ${taka(plan.bdt)} — ${plan.name}`} size="lg">
      <div className="space-y-4">
        <p className="text-[12.5px] leading-relaxed text-dark-300">
          {plan.name} gives you {compactNumber(plan.tokens)} cloud tokens every 7 days. Pay month by month — nothing
          renews unless you pay again.
        </p>

        {loading ? <Skeleton className="h-24 w-full" /> : null}

        {!loading && !config?.manual && !config?.auto ? (
          <InlineError>
            {config?.reason || 'The owner has not published a Nagad number yet — try the card checkout below.'}
          </InlineError>
        ) : null}

        {!loading && auto ? (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] p-4">
            <p className="flex items-center gap-2 text-[13px] font-semibold text-emerald-200">
              <Shield className="h-4 w-4" aria-hidden /> Automatic Nagad verification is on
            </p>
            <p className="mt-1.5 text-[12px] leading-relaxed text-dark-300">
              Press pay and you land on Nagad&apos;s own page. Once you finish there, Nagad tells our server and the plan
              switches on by itself — no TrxID to copy.
            </p>
            <Button className="mt-3" onClick={startOrder} loading={busy} icon={<Smartphone className="h-4 w-4" />}>
              Pay {taka(plan.bdt)} with Nagad
            </Button>
          </div>
        ) : null}

        {!loading && config?.manual ? (
          <div className="space-y-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
            <p className="flex items-center gap-2 text-[13px] font-semibold text-white">
              <Smartphone className="h-4 w-4 text-brand-300" aria-hidden />
              Pay by Nagad — send money, then paste the TrxID
            </p>

            <ol className="space-y-2.5 text-[12.5px] leading-relaxed text-dark-300">
              <Step n={1} title="Open the Nagad app (or *167#)">
                Tap <span className="text-dark-100">Send Money</span> — not Payment, not Cash Out.
              </Step>
              <Step n={2} title="Send exactly the plan amount">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="mono-num rounded-lg border border-white/[0.08] bg-white/[0.04] px-2 py-1 font-mono text-[13px] text-white">
                    {taka(plan.bdt)}
                  </span>
                  to
                  <span className="mono-num rounded-lg border border-brand-400/30 bg-brand-500/[0.08] px-2 py-1 font-mono text-[13px] text-brand-100">
                    {wallet || 'the owner’s Nagad number'}
                  </span>
                  {wallet ? <CopyButton value={wallet} label="Copy number" /> : null}
                </span>
                {config?.holder ? <span className="mt-1 block text-[11.5px] text-dark-500">Account name: {config.holder}</span> : null}
              </Step>
              <Step n={3} title="Copy the TrxID from the Nagad SMS">
                It looks like <span className="font-mono text-dark-200">7A9F2C1B4D</span>. Cash Out and Payment
                transactions are not accepted.
              </Step>
              <Step n={4} title="Paste it below and press Confirm">
                We check it against the Nagad statement and switch {plan.name} on — usually within a few minutes.
              </Step>
            </ol>

            {!tranId ? (
              <Button onClick={startOrder} loading={busy} icon={<Zap className="h-4 w-4" />}>
                I&apos;m ready — create my order
              </Button>
            ) : (
              <div className="space-y-3 rounded-xl border border-white/[0.06] bg-dark-950/40 p-3">
                <p className="text-[11.5px] text-dark-400">
                  Order <span className="mono-num font-mono text-dark-200">{tranId}</span> · {taka(plan.bdt)} ·{' '}
                  {plan.name}
                </p>
                <Field label="Nagad TrxID" hint="From the SMS Nagad sent you after sending the money.">
                  <Input
                    value={trxId}
                    onChange={e => setTrxId(e.target.value)}
                    placeholder="7A9F2C1B4D"
                    autoComplete="off"
                  />
                </Field>
                <Field label="The Nagad number you paid from">
                  <Input
                    value={sender}
                    onChange={e => setSender(e.target.value)}
                    placeholder="01712345678"
                    inputMode="numeric"
                    autoComplete="tel"
                  />
                </Field>
                <Button
                  onClick={submitTrx}
                  loading={busy}
                  disabled={!trxId.trim() || !sender.trim()}
                  icon={<Check className="h-4 w-4" />}
                >
                  Confirm payment
                </Button>
                <p className="text-[11px] leading-relaxed text-dark-500">{config?.reason}</p>
              </div>
            )}
          </div>
        ) : null}

        {result ? (
          <div
            className={cn(
              'rounded-xl border p-3.5 text-[12.5px] leading-relaxed',
              result.status === 'paid'
                ? 'border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-200'
                : 'border-amber-500/25 bg-amber-500/[0.06] text-amber-200',
            )}
          >
            <p className="font-semibold">
              {result.status === 'paid' ? 'Payment confirmed — your plan is on' : 'Recorded — waiting for confirmation'}
            </p>
            <p className="mt-1 text-dark-300">{result.message}</p>
            {result.status === 'paid' ? (
              <Button className="mt-3" size="sm" variant="secondary" onClick={onClose}>
                Done
              </Button>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-4">
          <p className="text-[11.5px] text-dark-500">
            Prefer a card, bKash or internet banking? The same plan is available through the secure SSLCommerz checkout.
          </p>
          <Button variant="ghost" size="sm" onClick={payByCard} loading={cardBusy} icon={<CreditCard className="h-3.5 w-3.5" />}>
            Pay by card instead
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function Step({ n, title, children }: { n: number; title: string; children?: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mono-num mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full border border-brand-400/30 bg-brand-500/[0.1] text-[11px] font-semibold text-brand-200">
        {n}
      </span>
      <span>
        <span className="block font-medium text-dark-100">{title}</span>
        {children ? <span className="mt-1 block">{children}</span> : null}
      </span>
    </li>
  )
}

function NagadCheckNow({ tranId, onDone }: { tranId: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <Button
      size="sm"
      variant="ghost"
      loading={busy}
      onClick={async () => {
        setBusy(true)
        try {
          const res: any = await paymentApi.nagadVerify(tranId)
          if (res.status === 'paid') toast.success(res.message)
          else toast(res.message || 'Nagad has not confirmed it yet')
          onDone()
        } catch (err: any) {
          toast.error(err.message || 'Could not check with Nagad')
        } finally {
          setBusy(false)
        }
      }}
    >
      Check now
    </Button>
  )
}
