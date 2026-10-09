'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  BadgeCheck, Banknote, Check, RefreshCw, ShieldAlert, ShieldCheck, Smartphone, X,
} from 'lucide-react'
import { adminApi } from '@/lib/api'
import { cn } from '@/lib/cn'
import { formatDateTime, relativeTime } from '@/lib/format'
import { Badge, Button, Card, CardHeader, CopyButton, EmptyState, InlineError, Skeleton } from '@/components/ui/primitives'
import { Field, Input, Switch } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import toast from 'react-hot-toast'

/* ══════════════════════════════════════════════════════════════════════════
   Payments — where the Nagad money is confirmed, and where the Nagad number
   itself is set.

   Nagad's personal ("Send Money") number has no API, so those orders cannot
   confirm themselves: they wait here until a human checks the Nagad statement.
   Owners with a Nagad merchant account can turn on automatic confirmation —
   the switch below — and then this list stays empty on its own.
   ══════════════════════════════════════════════════════════════════════════ */

const taka = (amount: number, currency = 'BDT') =>
  `${currency === 'BDT' ? '৳' : ''}${Number(amount || 0).toLocaleString('en-IN')}`

const TONE: Record<string, 'green' | 'amber' | 'red' | 'slate'> = {
  paid: 'green', awaiting_review: 'amber', pending: 'slate', rejected: 'red', failed: 'red', cancelled: 'slate',
}

export default function AdminPaymentsPage() {
  const [orders, setOrders] = useState<any[]>([])
  const [summary, setSummary] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [settings, setSettings] = useState<any>(null)
  const [live, setLive] = useState<any>(null)
  const [wallet, setWallet] = useState('')
  const [holder, setHolder] = useState('')
  const [autoVerify, setAutoVerify] = useState(true)
  const [saving, setSaving] = useState(false)

  const [rejecting, setRejecting] = useState<any>(null)
  const [rejectNote, setRejectNote] = useState('')
  const [working, setWorking] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [payments, cfg] = await Promise.all([adminApi.getPayments(), adminApi.getNagadSettings()])
      if (payments?.success) {
        setOrders(payments.orders || [])
        setSummary(payments.summary || null)
      }
      if (cfg?.success) {
        setSettings(cfg.settings || null)
        setLive(cfg.live || null)
        setWallet(cfg.settings?.wallet || '')
        setHolder(cfg.settings?.holder || '')
        setAutoVerify(cfg.settings?.autoVerify !== false)
      }
    } catch (err: any) {
      setError(err.message || 'Could not read the payment list')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const saveSettings = async () => {
    setSaving(true)
    try {
      const res: any = await adminApi.updateNagadSettings({ wallet, holder, autoVerify })
      toast.success(res.message || 'Nagad settings saved')
      setLive(res.live || live)
      setSettings(res.settings || settings)
    } catch (err: any) {
      toast.error(err.message || 'Could not save the Nagad settings')
    } finally {
      setSaving(false)
    }
  }

  const decide = async (order: any, approve: boolean) => {
    setWorking(order.tranId)
    try {
      const res: any = approve
        ? await adminApi.approvePayment(order.tranId)
        : await adminApi.rejectPayment(order.tranId, rejectNote)
      toast.success(res.message || (approve ? 'Payment approved' : 'Payment rejected'))
      setRejecting(null)
      setRejectNote('')
      await load()
    } catch (err: any) {
      toast.error(err.message || 'That did not work')
    } finally {
      setWorking('')
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-1 text-[10.5px] font-bold uppercase tracking-[0.22em] text-brand-400/80">Admin</p>
          <h1 className="text-[22px] font-semibold tracking-tight text-white">Payments &amp; Nagad</h1>
          <p className="mt-1 text-[13px] text-dark-400">
            Confirm Nagad TrxIDs, and set the number your customers send money to.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={load} loading={loading} icon={<RefreshCw className="h-3.5 w-3.5" />}>
          Refresh
        </Button>
      </div>

      {error ? <InlineError>{error}</InlineError> : null}

      {/* Nagad setup */}
      <Card>
        <CardHeader
          icon={<Smartphone className="h-4 w-4" />}
          title="Nagad number"
          description="The wallet your customers send money to. ৳100 Pro · ৳300 Enterprise, per month."
        />
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <Field
              label="Nagad number (Send Money)"
              hint="11 digits, for example 01712345678. This is shown on every checkout screen."
            >
              <div className="flex items-center gap-2">
                <Input
                  value={wallet}
                  onChange={e => setWallet(e.target.value.replace(/[^\d]/g, '').slice(0, 11))}
                  placeholder="01712345678"
                  inputMode="numeric"
                  autoComplete="off"
                />
                {wallet ? <CopyButton value={wallet} label="Copy number" /> : null}
              </div>
            </Field>
            <Field label="Account name shown to buyers" hint="Optional — helps customers trust the number.">
              <Input value={holder} onChange={e => setHolder(e.target.value)} placeholder="HerovaAi" />
            </Field>
            <Switch
              checked={autoVerify}
              onChange={setAutoVerify}
              label="Use Nagad's merchant API when it is configured"
              hint="Off never touches the API. On only activates when the merchant id + RSA keys exist in the key vault or backend/.env — otherwise every order waits for a human."
            />
            <Button onClick={saveSettings} loading={saving} icon={<Check className="h-4 w-4" />}>
              Save Nagad settings
            </Button>
          </div>

          <div className="space-y-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
            <p className="flex items-center gap-2 text-[13px] font-semibold text-white">
              {live?.auto ? (
                <ShieldCheck className="h-4 w-4 text-emerald-400" aria-hidden />
              ) : (
                <ShieldAlert className="h-4 w-4 text-amber-400" aria-hidden />
              )}
              {live?.auto ? 'Automatic verification is live' : 'Manual verification'}
            </p>
            <p className="text-[12px] leading-relaxed text-dark-400">{live?.reason}</p>
            <ul className="space-y-1.5 text-[11.5px] text-dark-500">
              <li>Merchant id: <span className="text-dark-300">{live?.merchantId ? 'configured' : 'not set'}</span></li>
              <li>Merchant RSA keys: <span className="text-dark-300">{live?.merchantKeys ? 'configured' : 'not set'}</span></li>
            </ul>
            <p className="rounded-lg border border-white/[0.06] bg-dark-950/40 p-3 text-[11.5px] leading-relaxed text-dark-400">
              <span className="text-dark-200">Why a human sometimes has to look:</span> a personal Nagad number — the one
              everybody uses with Send Money — has no API, so nothing can confirm a payment automatically. Automatic
              verification needs a Nagad <span className="text-dark-200">merchant (MFS)</span> account, whose keys go in
              the key vault as NAGAD_MERCHANT_ID, NAGAD_MERCHANT_PRIVATE_KEY and NAGAD_PGW_PUBLIC_KEY — never in this
              page or in chat.
            </p>
          </div>
        </div>
      </Card>

      {/* Waiting orders */}
      <Card padded={false}>
        <div className="px-5 pt-5">
          <CardHeader
            icon={<Banknote className="h-4 w-4" />}
            title="Nagad orders"
            description="Newest first. Check the TrxID against the Nagad statement before approving."
            action={
              summary ? (
                <div className="flex items-center gap-2">
                  <Badge tone={summary.awaitingReview ? 'amber' : 'slate'}>
                    {summary.awaitingReview} waiting
                  </Badge>
                  <Badge tone="green">{summary.paidLast24h} paid · 24h</Badge>
                </div>
              ) : undefined
            }
          />
        </div>

        {loading && orders.length === 0 ? (
          <div className="space-y-3 p-5">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : orders.length === 0 ? (
          <EmptyState
            icon={<BadgeCheck className="h-5 w-5" />}
            title="Nothing waiting"
            description="When a customer sends money and records a TrxID, the order lands here for a quick check."
          />
        ) : (
          <ul className="mt-3 divide-y divide-white/[0.05]">
            {orders.map(order => (
              <li key={order.tranId} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-white">
                      <span className="uppercase">{order.tier}</span>
                      <span className="mono-num text-brand-200">{taka(order.amount, order.currency)}</span>
                      <Badge tone={TONE[order.status] || 'slate'}>{order.status.replace('_', ' ')}</Badge>
                      {order.verifiedBy === 'auto' ? <Badge tone="green">auto-confirmed</Badge> : null}
                    </p>
                    <p className="text-[11.5px] text-dark-400">
                      {order.user ? (
                        <>
                          <span className="text-dark-200">{order.user.name}</span> · {order.user.email}
                          {order.user.phone ? ` · ${order.user.phone}` : ''} · plan {order.user.tier || 'free'}
                        </>
                      ) : 'account deleted'}
                    </p>
                    <p className="text-[11.5px] text-dark-500">
                      TrxID <span className="mono-num font-mono text-dark-200">{order.nagadTrxId || '—'}</span> · from{' '}
                      <span className="mono-num font-mono text-dark-200">{order.senderNumber || '—'}</span> · order{' '}
                      <span className="font-mono">{order.tranId}</span>
                    </p>
                    <p className="text-[11px] text-dark-500" title={formatDateTime(order.createdAt)}>
                      created {relativeTime(order.createdAt)}
                      {order.paidAt ? ` · paid ${relativeTime(order.paidAt)}` : ''}
                      {order.reviewNote ? ` · ${order.reviewNote}` : ''}
                    </p>
                  </div>

                  {order.status === 'awaiting_review' || order.status === 'pending' ? (
                    <div className="flex flex-none items-center gap-2">
                      <Button
                        size="sm"
                        onClick={() => decide(order, true)}
                        loading={working === order.tranId}
                        icon={<Check className="h-3.5 w-3.5" />}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => { setRejecting(order); setRejectNote('') }}
                        icon={<X className="h-3.5 w-3.5" />}
                      >
                        Reject
                      </Button>
                    </div>
                  ) : (
                    <span className={cn('text-[11.5px]', order.status === 'paid' ? 'text-emerald-300' : 'text-dark-500')}>
                      {order.status === 'paid' ? 'plan switched on' : 'no action needed'}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={Boolean(rejecting)}
        onClose={() => setRejecting(null)}
        title="Reject this payment?"
        description="The customer's plan does not change. They keep the order and can submit a correct TrxID from the same screen."
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setRejecting(null)}>Cancel</Button>
            <Button
              size="sm"
              onClick={() => rejecting && decide(rejecting, false)}
              loading={working === rejecting?.tranId}
            >
              Reject payment
            </Button>
          </div>
        }
      >
        <Field label="Reason (shown to the customer)" hint="For example: no ৳100 Nagad receive from that number.">
          <Input value={rejectNote} onChange={e => setRejectNote(e.target.value)} placeholder="No matching Nagad receive" />
        </Field>
      </Modal>
    </div>
  )
}
