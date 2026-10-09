'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useScrollLock } from '@/lib/hooks'
import { Button } from './primitives'

/* ══════════════════════════════════════════════════════════════════════════
   Modal — a real dialog, not a positioned div.

   Escape closes, the backdrop closes, Tab is trapped inside, focus returns to
   the element that opened it, and the background cannot scroll. Screens get all
   of that by rendering <Modal open …> instead of hand-rolling a fixed overlay.
   ══════════════════════════════════════════════════════════════════════════ */

export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  description?: ReactNode
  icon?: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  children?: ReactNode
  /** Set false for flows where Escape should not abandon the work (e.g. required setup). */
  closeOnEscape?: boolean
}

const SIZE: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
}

export function Modal({
  open, onClose, title, description, icon, footer, size = 'md', children, closeOnEscape = true,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)

  useScrollLock(open)

  // Remember what had focus so closing the dialog puts the user back where they were.
  useEffect(() => {
    if (!open) return
    restoreRef.current = document.activeElement as HTMLElement | null
    const raf = requestAnimationFrame(() => {
      const panel = panelRef.current
      if (!panel) return
      // Prefer the first control a user would type into; only fall back to a button. Focusing the
      // close button (DOM order puts it first) made every dialog start on "dismiss".
      const target =
        panel.querySelector<HTMLElement>('[data-autofocus]')
        || panel.querySelector<HTMLElement>('input:not([type=hidden]):not([disabled]), textarea:not([disabled]), select:not([disabled])')
        || panel.querySelector<HTMLElement>('button:not([disabled]), [tabindex]:not([tabindex="-1"])')
      target?.focus()
    })
    return () => {
      cancelAnimationFrame(raf)
      restoreRef.current?.focus?.()
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && closeOnEscape) {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
      if (!focusables || focusables.length === 0) return
      const list = Array.from(focusables)
      const first = list[0]
      const last = list[list.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose, closeOnEscape])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div
        className="absolute inset-0 animate-fade-in bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        className={cn(
          'relative z-10 w-full animate-scale-in overflow-hidden rounded-t-3xl border border-white/10 bg-dark-900/95 shadow-[0_40px_120px_-40px_rgba(0,0,0,1)] backdrop-blur-2xl sm:rounded-3xl',
          SIZE[size]
        )}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-400/50 to-transparent" />

        {(title || description) && (
          <div className="flex items-start justify-between gap-4 border-b border-white/[0.06] px-5 py-4">
            <div className="flex min-w-0 items-start gap-3">
              {icon ? (
                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl border border-brand-400/20 bg-brand-400/[0.08] text-brand-300">
                  {icon}
                </span>
              ) : null}
              <div className="min-w-0">
                <h3 className="text-[15px] font-semibold text-white">{title}</h3>
                {description ? <p className="mt-0.5 text-[12.5px] leading-relaxed text-dark-400">{description}</p> : null}
              </div>
            </div>
            <button type="button" onClick={onClose} className="icon-btn -mr-1" aria-label="Close dialog">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {children ? <div className="max-h-[70vh] overflow-y-auto px-5 py-4 scroll-thin">{children}</div> : null}

        {footer ? (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/[0.06] bg-black/20 px-5 py-3.5">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  )
}

export interface ConfirmDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void | Promise<void>
  title: string
  description?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'danger' | 'primary'
  loading?: boolean
}

/** Replaces window.confirm: same question, but styled, animated and non-blocking. */
export function ConfirmDialog({
  open, onClose, onConfirm, title, description, confirmLabel = 'Confirm', cancelLabel = 'Cancel', tone = 'danger', loading,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={title}
      description={description}
      icon={<AlertTriangle className="h-4 w-4" />}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>{cancelLabel}</Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            size="sm"
            loading={loading}
            onClick={() => void onConfirm()}
          >
            {confirmLabel}
          </Button>
        </>
      }
    />
  )
}
