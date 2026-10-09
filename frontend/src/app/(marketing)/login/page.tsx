'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { AlertCircle, ArrowRight, Eye, EyeOff, Lock, Mail } from 'lucide-react'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { getApiUrl } from '@/lib/auth'
import { authApi } from '@/lib/api'
import { Button, InlineError } from '@/components/ui/primitives'
import { Field } from '@/components/ui/Field'
import { AuthShell, AuthSplash, GoogleButton } from '@/components/auth/AuthShell'
import toast from 'react-hot-toast'
import { Suspense } from 'react'

/* ══════════════════════════════════════════════════════════════════════════
   Sign in.

   Errors land next to the field that caused them instead of only in a toast,
   and the OAuth notices that arrive as ?error= are explained in plain words.
   ══════════════════════════════════════════════════════════════════════════ */

function LoginForm() {
  const { login } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [oauthError, setOauthError] = useState<string | null>(null)
  const [googleReady, setGoogleReady] = useState<boolean | null>(null)
  const [fieldError, setFieldError] = useState<{ email?: string; password?: string; form?: string }>({})

  // Ask the server whether the Google button can work before showing it, so a
  // click never dead-ends on a half-configured deployment.
  useEffect(() => {
    let cancelled = false
    authApi.googleStatus()
      .then((data: any) => { if (!cancelled) setGoogleReady(Boolean(data?.configured)) })
      .catch(() => { if (!cancelled) setGoogleReady(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const err = searchParams.get('error')
    if (err === 'google_not_configured') {
      setOauthError(
        'Google sign-in is switched off on this deployment. Sign in with your email below — an ' +
        'administrator can switch Google on in Settings → Security.'
      )
    } else if (err === 'google' || err === 'google_failed') {
      setOauthError('Google sign-in did not complete. Try again, or use your email and password below.')
    } else if (err === 'oauth_state') {
      setOauthError('That Google sign-in link expired or was opened in a different tab. Start again below.')
    } else if (err) {
      setOauthError(decodeURIComponent(err))
    }
  }, [searchParams])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const next: typeof fieldError = {}
    if (!email.trim()) next.email = 'Enter your email'
    if (!password) next.password = 'Enter your password'
    setFieldError(next)
    if (Object.keys(next).length) return

    setLoading(true)
    const ok = await login(email.trim(), password)
    setLoading(false)
    if (ok) {
      toast.success('Welcome back')
      router.push('/dashboard')
    } else {
      setFieldError({ form: 'That email and password combination did not work.' })
    }
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your shop's assistant, WhatsApp replies and business memory."
      footer={
        <>
          No account yet?{' '}
          <Link href="/register" className="font-semibold text-brand-300 transition-colors hover:text-brand-200">
            Create one free
          </Link>
        </>
      }
    >
      {oauthError ? (
        <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-brand-400/25 bg-brand-400/[0.06] p-3">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-none text-brand-300" aria-hidden />
          <p className="text-[12px] leading-relaxed text-brand-100/90">{oauthError}</p>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <Field label="Email" htmlFor="login-email" error={fieldError.email} required>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dark-500" aria-hidden />
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              autoFocus
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="input-dark pl-10"
              aria-invalid={fieldError.email ? true : undefined}
            />
          </div>
        </Field>

        <Field label="Password" htmlFor="login-password" error={fieldError.password} required>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dark-500" aria-hidden />
            <input
              id="login-password"
              type={showPass ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              className="input-dark pl-10 pr-10"
              aria-invalid={fieldError.password ? true : undefined}
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

        {fieldError.form ? <InlineError>{fieldError.form}</InlineError> : null}

        <Button type="submit" full size="lg" loading={loading} iconRight={<ArrowRight className="h-4 w-4" />} className="mt-1">
          {loading ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      <div className="my-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-white/[0.07]" />
        <span className="font-mono text-[10.5px] text-dark-600">OR</span>
        <span className="h-px flex-1 bg-white/[0.07]" />
      </div>

      <GoogleButton
        ready={googleReady}
        onClick={() => {
          if (googleReady === false) {
            setOauthError(
              'Google sign-in is not set up yet. An administrator can switch it on from ' +
              'Settings → Security in about five steps — sign in with your email for now.'
            )
            return
          }
          window.location.href = `${getApiUrl()}/auth/google`
        }}
      />
    </AuthShell>
  )
}

export default function LoginPage() {
  return (
    <AuthProvider>
      <Suspense fallback={<AuthSplash />}>
        <LoginForm />
      </Suspense>
    </AuthProvider>
  )
}
