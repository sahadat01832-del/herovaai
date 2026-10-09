'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/cn'
import { useCountUp, useReducedMotion } from '@/lib/hooks'
import { compactNumber } from '@/lib/format'

/* ══════════════════════════════════════════════════════════════════════════
   Motion components.

   Reveal fades a section in as it scrolls into view; CountUp animates a
   number; ProgressRing draws an arc; PageTransition runs the route change.
   All four collapse to "just show it" when the OS asks for less motion — the
   reduced-motion path is the default, not an afterthought.
   ══════════════════════════════════════════════════════════════════════════ */

export function Reveal({ children, delay = 0, className, as: Tag = 'div' }: {
  children: ReactNode
  delay?: number
  className?: string
  as?: 'div' | 'section' | 'li' | 'article'
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)
  const reduced = useReducedMotion()

  useEffect(() => {
    if (reduced) {
      setShown(true)
      return
    }
    const node = ref.current
    // No observer (very old browser): show the content rather than hide it forever.
    if (!node || typeof IntersectionObserver === 'undefined') {
      setShown(true)
      return
    }
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShown(true)
            observer.disconnect()
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [reduced])

  return (
    <Tag
      ref={ref as never}
      style={{ '--reveal-delay': `${delay}ms` } as React.CSSProperties}
      className={cn('reveal', shown && 'reveal-in', className)}
    >
      {children}
    </Tag>
  )
}

/** A number that counts to its value on mount and on every later change. */
export function CountUp({ value, className, duration = 900 }: { value: number; className?: string; duration?: number }) {
  const animated = useCountUp(value, { duration })
  return <span className={cn('mono-num', className)}>{compactNumber(Math.round(animated))}</span>
}

/**
 * `tone` decides what a high number means: `quota` warns as it fills (token
 * spend), `success` rewards as it fills (how complete a profile is).
 */
export function ProgressRing({ value, size = 132, stroke = 9, label, sublabel, tone = 'quota' }: {
  value: number
  size?: number
  stroke?: number
  label?: ReactNode
  sublabel?: ReactNode
  tone?: 'quota' | 'success'
}) {
  const pct = Math.max(0, Math.min(100, value))
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const [drawn, setDrawn] = useState(0)
  const reduced = useReducedMotion()

  useEffect(() => {
    if (reduced) {
      setDrawn(pct)
      return
    }
    let raf = 0
    const started = performance.now()
    const from = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / 1100)
      const eased = 1 - Math.pow(1 - t, 5)
      setDrawn(from + (pct - from) * eased)
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [pct, reduced])

  const offset = circumference - (drawn / 100) * circumference
  const color = tone === 'success'
    ? pct >= 80 ? '#6ee7b7' : pct >= 40 ? '#c0a872' : '#7f9a8c'
    : pct > 85 ? '#f87171' : pct > 60 ? '#e0b79f' : '#d4be8e'

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset}
          style={{ filter: 'drop-shadow(0 0 8px rgba(192,168,114,0.35))' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        {label}
        {sublabel ? <span className="mt-0.5 text-[11px] text-dark-500">{sublabel}</span> : null}
      </div>
    </div>
  )
}

/** Wraps a route's content so navigation fades the new page in instead of snapping. */
export function PageTransition({ children, className }: { children: ReactNode; className?: string }) {
  const pathname = usePathname()
  return (
    <div key={pathname} className={cn('animate-fade-up', className)}>
      {children}
    </div>
  )
}
