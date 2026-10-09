'use client'

import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react'
import { AlertCircle, Check, Copy, Loader2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useCopy } from '@/lib/hooks'

/* ══════════════════════════════════════════════════════════════════════════
   Primitives — the vocabulary every screen is written in.

   Each one wraps a class from the design system (globals.css) and keeps the
   accessibility wiring in one place, so a page author writes intent
   ("destructive, loading, small") instead of six utility classes.
   ══════════════════════════════════════════════════════════════════════════ */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg'

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'btn-primary btn-sheen',
  secondary: 'btn-cyan',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
}

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: 'btn-sm',
  md: '',
  lg: 'btn-lg',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: ReactNode
  iconRight?: ReactNode
  full?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, icon, iconRight, full, className, children, disabled, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(VARIANT_CLASS[variant], SIZE_CLASS[size], full && 'w-full', className)}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
      {!loading && iconRight}
    </button>
  )
})

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  danger?: boolean
}

/** Square, quiet button for table rows and toolbars. `label` becomes the tooltip + a11y name. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, danger, className, children, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={cn('icon-btn', danger && 'icon-btn-danger', className)}
      {...rest}
    >
      {children}
    </button>
  )
})

/* ─── Badge ─────────────────────────────────────────────────────────────── */

export type BadgeTone = 'gold' | 'steel' | 'green' | 'amber' | 'red' | 'slate'

const TONE_CLASS: Record<BadgeTone, string> = {
  gold: 'badge-violet',
  steel: 'badge-cyan',
  green: 'badge-green',
  amber: 'badge-amber',
  red: 'badge-red',
  slate: 'badge-slate',
}

export function Badge({ tone = 'slate', icon, children, className }: {
  tone?: BadgeTone
  icon?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <span className={cn('badge', TONE_CLASS[tone], className)}>
      {icon}
      {children}
    </span>
  )
}

/* ─── Avatar ────────────────────────────────────────────────────────────── */

const AVATAR_SIZE = {
  sm: 'h-8 w-8 text-[11px]',
  md: 'h-10 w-10 text-[13px]',
  lg: 'h-14 w-14 text-[18px]',
} as const

/** Initials avatar; deterministic gold-to-steel tint derived from the name, not random. */
export function Avatar({ name, src, size = 'md', className }: {
  name?: string | null
  src?: string | null
  size?: keyof typeof AVATAR_SIZE
  className?: string
}) {
  const label = (name || 'User').trim()
  const initials = label
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() || '')
    .join('') || 'U'

  const hash = Array.from(label).reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
  const tint = hash % 3
  const gradient = tint === 0
    ? 'linear-gradient(140deg,#d4be8e,#8f7746)'
    : tint === 1
      ? 'linear-gradient(140deg,#c0a872,#6f5c37)'
      : 'linear-gradient(140deg,#9fb0bb,#4b5b66)'

  return (
    <span
      className={cn(
        'inline-flex flex-none items-center justify-center overflow-hidden rounded-full font-bold text-dark-950 ring-1 ring-white/10',
        AVATAR_SIZE[size],
        className
      )}
      style={{ background: gradient }}
      title={label}
    >
      {src ? <img src={src} alt={label} className="h-full w-full object-cover" /> : initials}
    </span>
  )
}

export function StatusDot({ tone = 'idle', label }: { tone?: 'live' | 'idle' | 'warn' | 'error'; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5" title={label} role={label ? 'img' : undefined} aria-label={label}>
      <span className={cn('dot', `dot-${tone}`)} />
      {label ? <span className="text-[11px] text-dark-400">{label}</span> : null}
    </span>
  )
}

/* ─── Card ──────────────────────────────────────────────────────────────── */

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  interactive?: boolean
  gold?: boolean
  danger?: boolean
  padded?: boolean
  /** Delay (ms) for the reveal-on-scroll transition. */
  delay?: number
}

export function Card({ interactive, gold, danger, padded = true, className, children, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        'card',
        padded && 'p-5',
        interactive && 'card-interactive',
        gold && 'card-gold',
        danger && 'card-danger',
        className
      )}
      {...rest}
    >
      {children}
    </div>
  )
}

export function CardHeader({ title, description, icon, action, className }: {
  title: ReactNode
  description?: ReactNode
  icon?: ReactNode
  action?: ReactNode
  className?: string
}) {
  // On a phone the action drops under the title instead of squeezing it into an
  // ellipsis — a card title that reads "About you and your s…" is worse than a
  // second row.
  return (
    <div className={cn('flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon ? (
          <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl border border-brand-400/20 bg-brand-400/[0.08] text-brand-300">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-white">{title}</h2>
          {description ? <p className="mt-0.5 text-[12.5px] leading-relaxed text-dark-400">{description}</p> : null}
        </div>
      </div>
      {action ? (
        <div className="flex flex-none flex-wrap items-center gap-2 self-start">{action}</div>
      ) : null}
    </div>
  )
}

export function SectionHeading({ eyebrow, title, description, action }: {
  eyebrow?: string
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-1 text-[10.5px] font-bold uppercase tracking-[0.22em] text-brand-400/80">{eyebrow}</p>
        ) : null}
        <h2 className="text-[17px] font-semibold tracking-tight text-white">{title}</h2>
        {description ? <p className="mt-1 max-w-2xl text-[12.5px] text-dark-400">{description}</p> : null}
      </div>
      {action}
    </div>
  )
}

/* ─── Loading ───────────────────────────────────────────────────────────── */

export function Spinner({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return (
    <span role="status" aria-label={label} className={cn('inline-flex', className)}>
      <Loader2 className="h-4 w-4 animate-spin text-brand-300" aria-hidden />
    </span>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} aria-hidden />
}

export function EmptyState({ icon, title, description, action, className }: {
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('empty', className)}>
      {icon ? <span className="empty-icon">{icon}</span> : null}
      <div>
        <p className="text-[14px] font-medium text-dark-100">{title}</p>
        {description ? <p className="mx-auto mt-1 max-w-sm text-[12.5px] leading-relaxed text-dark-500">{description}</p> : null}
      </div>
      {action}
    </div>
  )
}

export function InlineError({ children, className }: { children?: ReactNode; className?: string }) {
  if (!children) return null
  return (
    <p role="alert" className={cn('flex items-start gap-1.5 text-[12px] text-red-300', className)}>
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden />
      <span>{children}</span>
    </p>
  )
}

/* ─── Meter ─────────────────────────────────────────────────────────────── */

export function Meter({ value, tone = 'gold', className }: { value: number; tone?: 'gold' | 'warn' | 'danger'; className?: string }) {
  const pct = Math.max(0, Math.min(100, value))
  const fill = tone === 'danger'
    ? 'linear-gradient(90deg,#b91c1c,#f87171)'
    : tone === 'warn'
      ? 'linear-gradient(90deg,#8f7746,#e0b79f)'
      : undefined
  return (
    <div className={cn('meter', className)} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className="meter-fill" style={{ width: `${pct}%`, background: fill }} />
    </div>
  )
}

/* ─── Tooltip / copy ───────────────────────────────────────────────────── */

export function Tooltip({ text, side = 'top', children, className }: {
  text: string
  side?: 'top' | 'right'
  children: ReactNode
  className?: string
}) {
  return (
    <span className={cn('tooltip-host inline-flex', className)}>
      {children}
      <span role="tooltip" className={cn('tooltip', side === 'right' && 'tooltip-right')}>{text}</span>
    </span>
  )
}

export function CopyButton({ value, label = 'Copy', className }: { value: string; label?: string; className?: string }) {
  const { copied, copy } = useCopy()
  return (
    <button
      type="button"
      onClick={() => copy(value)}
      className={cn('icon-btn', className)}
      aria-label={copied ? 'Copied' : label}
      title={copied ? 'Copied' : label}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  )
}

/* ─── Prompt to run a command / go to a page ────────────────────────────── */

export function CommandHint({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[11px] text-dark-400">{children}</span>
}

export const Kbd = ({ children }: { children: ReactNode }) => <kbd className="kbd">{children}</kbd>
