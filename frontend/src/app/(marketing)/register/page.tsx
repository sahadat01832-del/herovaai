'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowRight, Eye, EyeOff, Lock, Mail, Phone, User } from 'lucide-react'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { Button, InlineError } from '@/components/ui/primitives'
import { Field, StrengthMeter } from '@/components/ui/Field'
import { AuthShell, GoogleButton } from '@/components/auth/AuthShell'
import { getApiUrl } from '@/lib/auth'
import { authApi } from '@/lib/api'
import toast from 'react-hot-toast'

/* ══════════════════════════════════════════════════════════════════════════
   Create account.

   The password rule is shown as a live meter rather than a rejection after
   submitting, and the email is checked before the network call so a typo does
   not cost a round-trip.
   ══════════════════════════════════════════════════════════════════════════ */

function RegisterForm() {
  const { register } = useAuth()
  const router = useRouter()
  const [form, setForm] = useState({ name: '', email: '', password: '', phone: '' })
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<{ name?: string; email?: string; password?: string; form?: string }>({})
  const [googleReady, setGoogleReady] = useState<boolean | null>(null)

  // Only invite the Google path when the server says it can actually finish it.
  useEffect(() => {
    let cancelled = false
    authApi.googleStatus()
      .then((data: any) => { if (!cancelled) setGoogleReady(Boolean(data?.configured)) })
      .catch(() => { if (!cancelled) setGoogleReady(false) })
    return () => { cancelled = true }
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const next: typeof errors = {}
    if (!form.name.trim()) next.name = 'Enter your name'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) next.email = 'That email address looks incomplete'
    if (form.password.length < 8) next.password = 'Use at least 8 characters'
    setErrors(next)
    if (Object.keys(next).length) return

    setLoading(true)
    const ok = await register(form.name.trim(), form.email.trim(), form.password, form.phone.trim())
    setLoading(false)
    if (ok) {
      toast.success('Account created — welcome aboard')
      router.push('/dashboard')
    } else {
      setErrors({ form: 'That email may already be registered. Try signing in instead.' })
    }
  }

  return (
    <AuthShell
      title="Set up your shop's assistant"
      subtitle="Free to start. One minute now, then it is ready for your busiest hour."
      footer={
        <>
          Already have an account?{' '}
          <Link href="/login" className="font-semibold text-brand-300 transition-colors hover:text-brand-200">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Full name" htmlFor="reg-name" error={errors.name} required>
          <div className="relative">
            <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dark-500" aria-hidden />
            <input
              id="reg-name"
              autoFocus
              autoComplete="name"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Jane Cooper"
              className="input-dark pl-10"
            />
          </div>
        </Field>

        <Field label="Email" htmlFor="reg-email" error={errors.email} required>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dark-500" aria-hidden />
            <input
              id="reg-email"
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              placeholder="you@company.com"
              className="input-dark pl-10"
            />
          </div>
        </Field>

        <Field label="Phone (optional)" htmlFor="reg-phone" hint="Used to match incoming WhatsApp messages to your account.">
          <div className="relative">
            <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dark-500" aria-hidden />
            <input
              id="reg-phone"
              type="tel"
              autoComplete="tel"
              value={form.phone}
              onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
              placeholder="+8801…"
              className="input-dark pl-10"
            />
          </div>
        </Field>

        <div className="space-y-1.5">
          <Field label="Password" htmlFor="reg-password" error={errors.password} required>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dark-500" aria-hidden />
              <input
                id="reg-password"
                type={showPass ? 'text' : 'password'}
                autoComplete="new-password"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                placeholder="At least 8 characters"
                className="input-dark pl-10 pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPass(s => !s)}
                className="icon-btn absolute right-2 top-1/2 h-7 w-7 -translate-y-1/2"
                aria-label={showPass ? 'Hide password' : 'Show password'}
              >
                {showPass ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </Field>
          <StrengthMeter password={form.password} />
        </div>

        {errors.form ? <InlineError>{errors.form}</InlineError> : null}

        <Button type="submit" full size="lg" loading={loading} iconRight={<ArrowRight className="h-4 w-4" />} className="mt-1">
          {loading ? 'Creating account…' : 'Create account'}
        </Button>

        <p className="text-[11px] leading-relaxed text-dark-500">
          By creating an account you agree to keep your own keys and data on this machine. You can
          change the plan or delete the account at any time.
        </p>
      </form>

      <div className="my-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-white/[0.07]" />
        <span className="font-mono text-[10.5px] text-dark-600">OR</span>
        <span className="h-px flex-1 bg-white/[0.07]" />
      </div>

      <GoogleButton
        label="Sign up with Google"
        ready={googleReady}
        onClick={() => {
          if (googleReady === false) {
            toast.error('Google sign-up is not switched on yet — create an account with your email instead')
            return
          }
          window.location.href = `${getApiUrl()}/auth/google`
        }}
      />
    </AuthShell>
  )
}

export default function RegisterPage() {
  return (
    <AuthProvider>
      <RegisterForm />
    </AuthProvider>
  )
}
