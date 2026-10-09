'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/** True when the visitor asked the OS to minimise motion. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}

/**
 * Count from the previous value to the next one on a rAF loop, so a KPI animates instead of
 * snapping. Jumps straight to the target when motion is unwelcome.
 */
export function useCountUp(target: number, { duration = 900 }: { duration?: number } = {}): number {
  const reduced = useReducedMotion()
  const [value, setValue] = useState(0)
  const fromRef = useRef(0)

  useEffect(() => {
    const to = Number(target || 0)
    if (reduced || duration <= 0) {
      fromRef.current = to
      setValue(to)
      return
    }

    const from = fromRef.current
    if (from === to) return
    let raf = 0
    const started = performance.now()

    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / duration)
      // easeOutQuint — fast start, long settle
      const eased = 1 - Math.pow(1 - t, 5)
      setValue(from + (to - from) * eased)
      if (t < 1) raf = requestAnimationFrame(tick)
      else fromRef.current = to
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration, reduced])

  return reduced ? Number(target || 0) : value
}

/** Clipboard write with a short "copied" flag for the button that triggered it. */
export function useCopy(resetMs = 1800) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const copy = useCallback(async (text: string) => {
    const value = String(text ?? '')
    if (!value) return false
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value)
      } else {
        // Older browsers (and any context without the async clipboard API) need the textarea trick.
        const area = document.createElement('textarea')
        area.value = value
        area.style.position = 'fixed'
        area.style.opacity = '0'
        document.body.appendChild(area)
        area.select()
        document.execCommand('copy')
        document.body.removeChild(area)
      }
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), resetMs)
      return true
    } catch {
      return false
    }
  }, [resetMs])

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  return { copied, copy }
}

/**
 * Keyboard shortcut listener. `combo` uses "mod" for ⌘ on macOS and Ctrl elsewhere, e.g. "mod+k".
 * The handler is skipped while the visitor is typing in a field, unless the combo needs a modifier.
 */
export function useHotkey(combo: string, handler: (event: KeyboardEvent) => void, { allowInInput = false } = {}) {
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    const parts = combo.toLowerCase().split('+')
    const key = parts[parts.length - 1]
    const needMod = parts.includes('mod')
    const needShift = parts.includes('shift')
    const needAlt = parts.includes('alt')

    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey
      if (needMod !== mod) return
      if (needShift && !event.shiftKey) return
      if (needAlt && !event.altKey) return
      if (event.key.toLowerCase() !== key) return

      const target = event.target as HTMLElement | null
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if (typing && !allowInInput && !needMod) return

      event.preventDefault()
      handlerRef.current(event)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [combo, allowInInput])
}

/** Locks page scroll while a modal or drawer is open (without jumping the layout). */
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return
    const { overflow, paddingRight } = document.body.style
    const gap = window.innerWidth - document.documentElement.clientWidth
    document.body.style.overflow = 'hidden'
    if (gap > 0) document.body.style.paddingRight = `${gap}px`
    return () => {
      document.body.style.overflow = overflow
      document.body.style.paddingRight = paddingRight
    }
  }, [active])
}

/** Debounce for search boxes: one request per pause, not per keystroke. */
export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

/** Match a media query (used for the responsive shell without layout thrash). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia(query)
    setMatches(mq.matches)
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return matches
}
