'use client'

import Link from 'next/link'
import { Brain, KeyRound, Loader2, Smartphone, Sparkles, Zap } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/* ══════════════════════════════════════════════════════════════════════════
   Auth shell — one frame for sign in and sign up.

   Wide screens get a brand panel that states what the product does; narrow
   screens drop it and keep only the form, because a marketing column on a
   phone is just a wall of text before the field the visitor came for.
   ══════════════════════════════════════════════════════════════════════════ */

const POINTS = [
  { icon: Smartphone, title: 'Answers on WhatsApp',   desc: 'Pair one number — it replies while you are serving someone' },
  { icon: Brain,      title: 'Knows your business',   desc: 'Your products, prices and rules — optional, and yours to pause' },
  { icon: KeyRound,   title: 'Nothing to hand over',  desc: 'No shared password: sign in with Google or your own email' },
]

export function AuthShell({ title, subtitle, children, footer }: {
  title: string
  subtitle: string
  children: ReactNode
  footer: ReactNode
}) {
  return (
    <div className="relative flex min-h-screen flex-col lg:flex-row">
      {/* Brand panel */}
      <div className="bg-animated noise relative hidden w-[46%] flex-col justify-between overflow-hidden border-r border-white/[0.06] p-10 lg:flex xl:p-14">
        <div className="aurora">
          <span /><span /><span />
        </div>

        <Link href="/" className="relative z-10 flex items-center gap-3">
          <img src="/logo.png" alt="" width={40} height={40} className="h-10 w-10 rounded-xl ring-1 ring-white/10" />
          <span className="font-display text-[17px] font-semibold text-white">
            Herova<span className="text-brand-400">Ai</span>
          </span>
        </Link>

        <div className="relative z-10 max-w-md">
          <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-brand-400/25 bg-brand-400/[0.08] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-200">
            <Sparkles className="h-3 w-3" aria-hidden />
            For shop owners &amp; managers
          </p>
          <h1 className="text-[30px] font-semibold leading-[1.1] tracking-tight text-white sm:text-[34px] xl:text-[38px]">
            Your shop's assistant,
            <span className="gradient-text"> answering customers on WhatsApp.</span>
          </h1>
          <p className="mt-4 text-[13.5px] leading-relaxed text-dark-400">
            Tell it once what you sell, when you open and what it must never promise — then it
            handles the questions you answer twenty times a day, in your words.
          </p>

          <ul className="mt-8 space-y-4">
            {POINTS.map(({ icon: Icon, title: pointTitle, desc }, index) => (
              <li
                key={pointTitle}
                className="flex items-start gap-3.5 animate-fade-up"
                style={{ animationDelay: `${120 + index * 90}ms` }}
              >
                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-brand-300">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <span>
                  <span className="block text-[13px] font-medium text-dark-100">{pointTitle}</span>
                  <span className="mt-0.5 block text-[12px] text-dark-500">{desc}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative z-10 text-[11.5px] text-dark-600">
          © {new Date().getFullYear()} HerovaAi · made for small businesses
        </p>
      </div>

      {/* Form */}
      <div className="relative flex flex-1 items-center justify-center p-5 sm:p-8">
        <div className="bg-animated pointer-events-none absolute inset-0 lg:hidden" aria-hidden />
        <div className="relative z-10 w-full max-w-[26rem]">
          <Link href="/" className="mb-8 flex items-center justify-center gap-3 lg:hidden">
            <img src="/logo.png" alt="" width={38} height={38} className="h-9 w-9 rounded-xl ring-1 ring-white/10" />
            <span className="font-display text-[16px] font-semibold text-white">
              Herova<span className="text-brand-400">Ai</span>
            </span>
          </Link>

          <div className="mb-6">
            <h2 className="text-[22px] font-semibold tracking-tight text-white">{title}</h2>
            <p className="mt-1 text-[13px] text-dark-400">{subtitle}</p>
          </div>

          <div className="card p-5 sm:p-6">{children}</div>

          <div className="mt-5 text-center text-[12.5px] text-dark-500">{footer}</div>

          {/* Sign-in is where a visitor decides to trust the product with a
              business number, so the policies are one click away right here. */}
          <p className="mt-4 text-center text-[11.5px] leading-relaxed text-dark-600">
            By continuing you agree to the{' '}
            <Link href="/terms" className="text-dark-400 underline-offset-4 transition-colors hover:text-white hover:underline">
              Terms of Service
            </Link>{' '}
            and acknowledge the{' '}
            <Link href="/privacy" className="text-dark-400 underline-offset-4 transition-colors hover:text-white hover:underline">
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  )
}

/**
 * Google button shared by both screens.
 *
 * `ready` is the server's answer to "can this actually work?". While it is still
 * unknown the button shows a quiet spinner rather than inviting a click that
 * would bounce back with an error.
 */
export function GoogleButton({ onClick, label = 'Continue with Google', ready = null }: {
  onClick: () => void
  label?: string
  ready?: boolean | null
}) {
  const unavailable = ready === false
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={ready === null}
      title={unavailable ? 'Google sign-in is not set up on this deployment yet' : undefined}
      className={cn(
        'btn-ghost w-full justify-center py-2.5 text-[12.5px] font-semibold',
        unavailable && 'opacity-70'
      )}
    >
      {ready === null ? <Loader2 className="h-4 w-4 flex-none animate-spin" aria-hidden /> : null}
      <svg className={cn('h-4 w-4 flex-none', ready === null && 'hidden')} viewBox="0 0 24 24" aria-hidden>
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
      </svg>
      <span className="truncate">{label}</span>
      {unavailable ? (
        <span className="ml-1 flex-none rounded-md border border-amber-400/30 bg-amber-400/[0.08] px-1.5 py-0.5 text-[10px] font-medium text-amber-200">
          not set up
        </span>
      ) : null}
    </button>
  )
}

export function AuthSplash() {
  return (
    <div className="bg-animated flex min-h-screen items-center justify-center">
      <div className="flex h-12 w-12 animate-neon-pulse items-center justify-center rounded-2xl bg-gradient-neon shadow-gold">
        <Zap className="h-6 w-6 text-dark-950" aria-hidden />
      </div>
    </div>
  )
}
