import Link from 'next/link'
import type { ReactNode } from 'react'
import { SiteFooter } from './SiteFooter'

/* ══════════════════════════════════════════════════════════════════════════
   Legal shell — the frame for the policy pages.

   Narrow measure on purpose: a policy is read line by line, so the content
   column stays at ~3xl while the bar and footer keep the marketing width. The
   pages themselves are server components; this frame adds no client state.
   ══════════════════════════════════════════════════════════════════════════ */

export function LegalShell({ title, updated, intro, children }: {
  title: string
  updated: string
  intro: ReactNode
  children: ReactNode
}) {
  return (
    <div className="relative flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-dark-950/80 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-3">
          <Link href="/" className="flex items-center gap-2.5">
            <img src="/logo.png" alt="" width={32} height={32} className="h-8 w-8 rounded-lg ring-1 ring-white/10" />
            <span className="font-display text-[15px] font-semibold text-white">
              Herova<span className="text-brand-400">Ai</span>
            </span>
          </Link>
          <nav className="flex items-center gap-2" aria-label="Account">
            <Link href="/login" className="btn-ghost py-2 text-[12.5px]">Sign in</Link>
            <Link href="/register" className="btn-primary py-2 text-[12.5px]">Get started</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-12 sm:py-16">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-200">HerovaAi</p>
        <h1 className="mt-2 text-[27px] font-semibold tracking-tight text-white sm:text-[32px]">{title}</h1>
        <p className="mt-2.5 text-[12.5px] text-dark-500">Last updated {updated}</p>
        <div className="mt-6 text-[13.5px] leading-relaxed text-dark-300">{intro}</div>
        <div className="mt-9 space-y-9">{children}</div>
        <div className="mt-12 border-t border-white/[0.06] pt-6 text-[12.5px] text-dark-500">
          <p>
            Questions about this page, your account or your data?{' '}
            <Link href="/" className="text-brand-300 underline-offset-4 hover:underline">
              Return to the start page
            </Link>{' '}
            and contact the operator of this deployment using the details published there.
          </p>
        </div>
      </main>

      <SiteFooter />
    </div>
  )
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-[15.5px] font-semibold text-white">{title}</h2>
      <div className="mt-3 space-y-3 text-[13.5px] leading-relaxed text-dark-400">{children}</div>
    </section>
  )
}

export function LegalList({ children }: { children: ReactNode }) {
  return (
    <ul className="ml-4 list-disc space-y-2 marker:text-brand-300/70">
      {children}
    </ul>
  )
}

/** A single standing-out paragraph: the sentence a reader must not miss. */
export function LegalNote({ children }: { children: ReactNode }) {
  return (
    <div className="card border-brand-400/15 bg-brand-400/[0.04] p-4 text-[13px] leading-relaxed text-dark-300">
      {children}
    </div>
  )
}
