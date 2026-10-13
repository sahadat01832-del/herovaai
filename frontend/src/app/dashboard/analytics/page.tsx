'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Activity, Bot, MessageCircle, RefreshCw, Send, Smartphone } from 'lucide-react'
import { whatsappApi } from '@/lib/api'
import { Button, InlineError, Skeleton } from '@/components/ui/primitives'

const number = (value: number) => new Intl.NumberFormat().format(value || 0)

export default function AnalyticsPage() {
  const [report, setReport] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const response: any = await whatsappApi.getAnalytics()
      setReport(response)
    } catch (err: any) {
      setError(err.message || 'Could not load your business analytics')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const whatsapp = report?.whatsapp
  const channels = report?.channels
  const maxDaily = Math.max(1, ...(whatsapp?.days || []).map((day: any) => day.incoming + day.replies))

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-1 text-[10.5px] font-bold uppercase tracking-[0.22em] text-brand-400/80">Overview</p>
          <h1 className="text-[22px] font-semibold tracking-tight text-white">Business analytics</h1>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-dark-400">
            See how many conversations and posts HerovaAi has handled across your connected accounts.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={load} loading={loading} icon={<RefreshCw className="h-3.5 w-3.5" />}>
          Refresh
        </Button>
      </div>

      {error ? <InlineError>{error}</InlineError> : null}
      {loading && !report ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-28 rounded-2xl" />)}
        </div>
      ) : null}

      {report ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: 'WhatsApp conversations received', value: number(whatsapp.messagesReceived), icon: MessageCircle, tone: 'text-cyan-300' },
              { label: 'WhatsApp messages sent', value: number(whatsapp.messagesSent), icon: Send, tone: 'text-emerald-300' },
              { label: 'Connected accounts', value: number(channels.connected), icon: Smartphone, tone: 'text-brand-300' },
              { label: 'Posts published', value: number(channels.postsSent), icon: Activity, tone: 'text-amber-300' },
            ].map(({ label, value, icon: Icon, tone }) => (
              <div className="card flex items-start gap-3 p-4 sm:p-5" key={label}>
                <span className={`flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-white/[0.05] ${tone}`}>
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="mono-num text-2xl font-semibold text-white">{value}</p>
                  <p className="mt-1 text-xs leading-relaxed text-dark-400">{label}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
            <section className="card p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-white">WhatsApp activity · last 7 days</h2>
                  <p className="mt-1 text-xs text-dark-400">Incoming messages and AI replies in the retained message history.</p>
                </div>
                <Bot className="h-4 w-4 flex-none text-brand-300" aria-hidden />
              </div>
              <div className="mt-6 grid grid-cols-7 gap-2">
                {(whatsapp.days || []).map((day: any) => {
                  const incomingHeight = Math.max(3, (day.incoming / maxDaily) * 120)
                  const replyHeight = Math.max(3, (day.replies / maxDaily) * 120)
                  return (
                    <div key={day.date} className="flex min-w-0 flex-col items-center gap-2">
                      <div className="flex h-32 w-full items-end justify-center gap-1 rounded-lg bg-black/20 px-1 pt-2">
                        <span title={`${day.incoming} incoming`} className="w-1/3 rounded-t bg-cyan-400/80" style={{ height: `${incomingHeight}px` }} />
                        <span title={`${day.replies} AI replies`} className="w-1/3 rounded-t bg-brand-400/80" style={{ height: `${replyHeight}px` }} />
                      </div>
                      <span className="text-[9px] text-dark-500">{new Date(`${day.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' })}</span>
                    </div>
                  )
                })}
              </div>
              <div className="mt-3 flex flex-wrap gap-4 text-[10px] text-dark-400">
                <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-cyan-400" /> Customer messages</span>
                <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-brand-400" /> AI replies</span>
              </div>
            </section>

            <section className="card p-4 sm:p-5">
              <h2 className="text-sm font-semibold text-white">Your channels</h2>
              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-dark-300">WhatsApp numbers online</span>
                  <strong className="mono-num text-white">{number(whatsapp.connectedSessions)} / {number(whatsapp.sessions)}</strong>
                </div>
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-dark-300">Replies on social channels</span>
                  <strong className="mono-num text-white">{number(channels.repliesSent)}</strong>
                </div>
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-dark-300">Scheduled posts waiting</span>
                  <Link href="/dashboard/publishing" className="font-semibold text-brand-300 hover:text-brand-200">{number(channels.scheduledPosts)} · View queue</Link>
                </div>
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-dark-300">Recent channel failures</span>
                  <strong className={channels.failuresLast7Days ? 'text-amber-300' : 'text-emerald-300'}>{number(channels.failuresLast7Days)}</strong>
                </div>
                <p className="border-t border-white/[0.06] pt-3 text-[10.5px] leading-relaxed text-dark-500">
                  Lifetime message and publishing totals come from saved counters. The daily chart and recent activity only include the messages and activity HerovaAi currently retains.
                </p>
              </div>
            </section>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link href="/dashboard/whatsapp" className="btn-ghost btn-sm">Open customer inbox</Link>
            <Link href="/dashboard/connections" className="btn-ghost btn-sm">Manage platforms</Link>
            <Link href="/dashboard/publishing" className="btn-ghost btn-sm">Manage scheduled posts</Link>
          </div>
        </>
      ) : null}
    </div>
  )
}
