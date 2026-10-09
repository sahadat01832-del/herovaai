'use client'

import {
  forwardRef, useId, useState,
  type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react'
import { AlertCircle, Check, ClipboardPaste, Eraser, Eye, EyeOff, Loader2, ShieldCheck, Sparkles } from 'lucide-react'
import { cn } from '@/lib/cn'
import { passwordStrength } from '@/lib/format'
import { InlineError, Tooltip } from './primitives'

/* ══════════════════════════════════════════════════════════════════════════
   Form primitives.

   Field owns the label/hint/error wiring (one id, aria-describedby, aria-invalid),
   and SecretField is the specialised key input: reveal, paste-clean, clear and a
   saved/verified state line — the pieces an API-key screen actually needs.
   ══════════════════════════════════════════════════════════════════════════ */

export interface FieldProps {
  label?: ReactNode
  hint?: ReactNode
  error?: ReactNode
  required?: boolean
  htmlFor?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}

export function Field({ label, hint, error, required, htmlFor, action, children, className }: FieldProps) {
  return (
    <div className={cn('field', className)}>
      {label ? (
        <div className="flex items-center justify-between gap-2">
          <label className="field-label" htmlFor={htmlFor}>
            {label}
            {required ? <span className="text-brand-400">*</span> : null}
          </label>
          {action}
        </div>
      ) : null}
      {children}
      {error ? <InlineError>{error}</InlineError> : hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  )
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode
  hint?: ReactNode
  error?: ReactNode
  icon?: ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, icon, className, id, ...rest },
  ref
) {
  const autoId = useId()
  const fieldId = id || autoId
  return (
    <Field label={label} hint={hint} error={error} htmlFor={fieldId} required={rest.required}>
      <div className="relative">
        {icon ? (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-dark-500">{icon}</span>
        ) : null}
        <input
          ref={ref}
          id={fieldId}
          aria-invalid={error ? true : undefined}
          className={cn('input-dark', icon && 'pl-9', className)}
          {...rest}
        />
      </div>
    </Field>
  )
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: ReactNode; hint?: ReactNode; error?: ReactNode
}>(function Textarea({ label, hint, error, className, id, ...rest }, ref) {
  const autoId = useId()
  const fieldId = id || autoId
  return (
    <Field label={label} hint={hint} error={error} htmlFor={fieldId}>
      <textarea
        ref={ref}
        id={fieldId}
        rows={4}
        aria-invalid={error ? true : undefined}
        className={cn('input-dark resize-y leading-relaxed', className)}
        {...rest}
      />
    </Field>
  )
})

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & {
  label?: ReactNode; hint?: ReactNode; error?: ReactNode
}>(function Select({ label, hint, error, className, id, children, ...rest }, ref) {
  const autoId = useId()
  const fieldId = id || autoId
  return (
    <Field label={label} hint={hint} error={error} htmlFor={fieldId}>
      <div className="relative">
        <select ref={ref} id={fieldId} className={cn('input-dark appearance-none pr-9', className)} {...rest}>
          {children}
        </select>
        <svg
          aria-hidden viewBox="0 0 20 20"
          className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-dark-400"
        >
          <path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </div>
    </Field>
  )
})

/* ─── Switch ────────────────────────────────────────────────────────────── */

export function Switch({ checked, onChange, label, hint, disabled }: {
  checked: boolean
  onChange: (next: boolean) => void
  label?: ReactNode
  hint?: ReactNode
  disabled?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      {(label || hint) && (
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-dark-100">{label}</p>
          {hint ? <p className="mt-0.5 text-[11.5px] text-dark-500">{hint}</p> : null}
        </div>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={typeof label === 'string' ? label : 'Toggle'}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn('switch mt-0.5', checked && 'switch-on', disabled && 'cursor-not-allowed opacity-40')}
      />
    </div>
  )
}

/* ─── Password strength ─────────────────────────────────────────────────── */

export function StrengthMeter({ password }: { password: string }) {
  const { score, label } = passwordStrength(password)
  if (!password) return null
  return (
    <div className="space-y-1.5">
      <div className={cn('strength', `strength-${score || 1}`)} aria-hidden>
        <span /><span /><span />
      </div>
      <p className="text-[11px] text-dark-400">{label} — use 12+ characters with a mix of cases, digits and a symbol.</p>
    </div>
  )
}

/* ─── Secret field ──────────────────────────────────────────────────────── */

export type SecretStatus = 'idle' | 'checking' | 'ok' | 'fail'

export interface SecretFieldProps {
  value: string
  onChange: (next: string) => void
  label?: ReactNode
  hint?: ReactNode
  error?: ReactNode
  placeholder?: string
  disabled?: boolean
  /** Masked form of the key already stored on the server (e.g. "cb-age…7890"). */
  savedMasked?: string
  savedAt?: string | null
  status?: SecretStatus
  statusMessage?: string
  autoFocus?: boolean
}

/**
 * The API-key input.
 *
 * Typed values are never sent anywhere except by the caller's save action, and a stored key is
 * only ever shown masked — so this field is where "paste a new key to rotate" is expressed.
 */
export function SecretField({
  value, onChange, label = 'API key', hint, error, placeholder = 'Paste the key here',
  disabled, savedMasked, savedAt, status = 'idle', statusMessage, autoFocus,
}: SecretFieldProps) {
  const [revealed, setRevealed] = useState(false)
  const autoId = useId()

  // A pasted key often carries surrounding whitespace or a line break; cleaning it beats making
  // the user find the stray character.
  const clean = () => onChange(value.replace(/\s+/g, '').trim())
  const dirty = value.trim().length > 0

  return (
    <Field
      label={label}
      htmlFor={autoId}
      hint={hint}
      error={error}
      action={
        savedMasked ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-dark-400">
            <ShieldCheck className="h-3.5 w-3.5 text-brand-400/80" aria-hidden />
            saved {savedMasked}
          </span>
        ) : null
      }
    >
      <div className="relative">
        <input
          id={autoId}
          type={revealed ? 'text' : 'password'}
          value={value}
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          onChange={e => onChange(e.target.value)}
          onPaste={e => {
            const pasted = e.clipboardData?.getData('text') || ''
            if (/\s/.test(pasted)) {
              e.preventDefault()
              onChange(pasted.replace(/\s+/g, '').trim())
            }
          }}
          placeholder={placeholder}
          className="input-dark input-secret pr-[6.5rem]"
        />
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
          {dirty && !revealed ? (
            <Tooltip text="Remove spaces / line breaks">
              <button type="button" onClick={clean} className="icon-btn h-7 w-7" aria-label="Clean up pasted key">
                <Eraser className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
          ) : null}
          <Tooltip text={revealed ? 'Hide' : 'Reveal while typing'}>
            <button
              type="button"
              onClick={() => setRevealed(r => !r)}
              className="icon-btn h-7 w-7"
              aria-label={revealed ? 'Hide key' : 'Reveal key'}
            >
              {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </Tooltip>
          <Tooltip text="Paste from clipboard">
            <button
              type="button"
              onClick={async () => {
                try {
                  const text = await navigator.clipboard.readText()
                  onChange(text.replace(/\s+/g, '').trim())
                } catch {
                  /* clipboard permission denied — the user can still paste manually */
                }
              }}
              className="icon-btn h-7 w-7"
              aria-label="Paste from clipboard"
            >
              <ClipboardPaste className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        </div>
      </div>

      {(dirty || status !== 'idle' || savedAt) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          {status === 'checking' ? (
            <span className="inline-flex items-center gap-1.5 text-dark-300">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Testing against the provider…
            </span>
          ) : status === 'ok' ? (
            <span className="inline-flex items-center gap-1.5 text-emerald-300">
              <Check className="h-3 w-3" aria-hidden /> {statusMessage || 'Verified — the provider accepted this key'}
            </span>
          ) : status === 'fail' ? (
            <span className="inline-flex items-center gap-1.5 text-red-300">
              <AlertCircle className="h-3 w-3" aria-hidden /> {statusMessage || 'The provider rejected this key'}
            </span>
          ) : dirty ? (
            <span className="inline-flex items-center gap-1.5 text-brand-300/90">
              <Sparkles className="h-3 w-3" aria-hidden /> Not saved yet
            </span>
          ) : null}
          {savedAt && status === 'idle' ? (
            <span className="text-dark-500">rotated {new Date(savedAt).toLocaleString()}</span>
          ) : null}
        </div>
      )}
    </Field>
  )
}
