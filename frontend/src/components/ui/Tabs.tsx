'use client'

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

/* ══════════════════════════════════════════════════════════════════════════
   Tabs — one sliding pill for the whole strip.

   Switching tabs animates a single indicator between positions instead of
   cross-fading two backgrounds, which is what makes it read as one control.
   Arrow keys move between tabs, as a real tablist should.
   ══════════════════════════════════════════════════════════════════════════ */

export interface TabItem<T extends string = string> {
  id: T
  label: ReactNode
  icon?: ReactNode
  badge?: ReactNode
  disabled?: boolean
}

export function Tabs<T extends string>({ items, value, onChange, className, 'aria-label': ariaLabel }: {
  items: TabItem<T>[]
  value: T
  onChange: (id: T) => void
  className?: string
  'aria-label'?: string
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const [indicator, setIndicator] = useState({ left: 0, width: 0, ready: false })

  const measure = () => {
    const list = listRef.current
    if (!list) return
    const active = list.querySelector<HTMLElement>(`[data-tab="${value}"]`)
    if (!active) return
    setIndicator({ left: active.offsetLeft, width: active.offsetWidth, ready: true })
  }

  useLayoutEffect(measure, [value, items.length])

  useEffect(() => {
    // Labels can reflow (fonts, zoom, container resize) — re-measure rather than drift.
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [value])

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    const enabled = items.filter(i => !i.disabled)
    const index = enabled.findIndex(i => i.id === value)
    const next = event.key === 'ArrowRight'
      ? enabled[(index + 1) % enabled.length]
      : enabled[(index - 1 + enabled.length) % enabled.length]
    if (next) onChange(next.id)
  }

  return (
    <div ref={listRef} role="tablist" aria-label={ariaLabel} className={cn('tabs', className)} onKeyDown={onKeyDown}>
      {indicator.ready && (
        <span
          className="tab-indicator"
          style={{ transform: `translateX(${indicator.left}px)`, width: indicator.width }}
          aria-hidden
        />
      )}
      {items.map(item => {
        const active = item.id === value
        return (
          <button
            key={item.id}
            data-tab={item.id}
            role="tab"
            type="button"
            aria-selected={active}
            aria-controls={`panel-${item.id}`}
            disabled={item.disabled}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item.id)}
            className={cn('tab', active && 'tab-active', item.disabled && 'cursor-not-allowed opacity-40')}
          >
            {item.icon}
            <span>{item.label}</span>
            {item.badge}
          </button>
        )
      })}
    </div>
  )
}

export function TabPanel({ id, active, children, className }: {
  id: string
  active: boolean
  children: ReactNode
  className?: string
}) {
  if (!active) return null
  return (
    <div role="tabpanel" id={`panel-${id}`} className={cn('animate-fade-up', className)}>
      {children}
    </div>
  )
}

/** Two-or-three-state inline control. No sliding pill: the states are short enough to just fill. */
export function Segmented<T extends string>({ options, value, onChange, className }: {
  options: { id: T; label: ReactNode; icon?: ReactNode }[]
  value: T
  onChange: (id: T) => void
  className?: string
}) {
  return (
    <div className={cn('segmented', className)} role="group">
      {options.map(option => (
        <button
          key={option.id}
          type="button"
          aria-pressed={option.id === value}
          onClick={() => onChange(option.id)}
          className={cn('segmented-item inline-flex items-center gap-1.5', option.id === value && 'segmented-item-active')}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  )
}
