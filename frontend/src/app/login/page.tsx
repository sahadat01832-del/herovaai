'use client'
import { useState, useEffect, FormEvent, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Eye, EyeOff, Mail, Lock, AlertCircle, Zap, ChevronRight, Sparkles } from 'lucide-react'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { getApiUrl } from '@/lib/auth'
import toast from 'react-hot-toast'

function LoginForm() {
  const { login } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [oauthError, setOauthError] = useState<string | null>(null)

  useEffect(() => {
    const err = searchParams.get('error')
    if (err === 'google_not_configured') {
      setOauthError('Google OAuth needs credentials from Google Cloud Console. Use email & password below.')
    } else if (err === 'google' || err === 'google_failed') {
      setOauthError('Google sign-in failed. Please use email & password.')
    }
  }, [searchParams])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    const ok = await login(email, password)
    if (ok) {
      toast.success('Welcome back!')
      router.push('/dashboard')
    }
    setLoading(false)
  }

  const handleGoogleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    window.location.href = `${getApiUrl()}/auth/google`
  }

  return (
    <div className="min-h-screen bg-animated flex items-center justify-center p-4 relative overflow-hidden">
      {/* Animated orbs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-20%] right-[-10%] w-[500px] h-[500px] rounded-full bg-brand-500/10 blur-[120px] animate-pulse-slow" />
        <div className="absolute bottom-[-20%] left-[-10%] w-[400px] h-[400px] rounded-full bg-cyan-500/8 blur-[100px] animate-pulse-slow" style={{ animationDelay: '2s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-brand-700/5 blur-[150px]" />
      </div>

      {/* Content */}
      <div className="relative z-10 w-full max-w-sm">
        {/* Logo mark */}
        <div className="flex flex-col items-center mb-8">
          <div className="relative mb-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-neon flex items-center justify-center glow-brand animate-neon-pulse">
              <Zap className="w-8 h-8 text-white" />
            </div>
            {/* Corner brackets */}
            <div className="absolute -top-1 -left-1 w-4 h-4 border-t-2 border-l-2 border-brand-400/60 rounded-tl" />
            <div className="absolute -top-1 -right-1 w-4 h-4 border-t-2 border-r-2 border-cyan-400/60 rounded-tr" />
            <div className="absolute -bottom-1 -left-1 w-4 h-4 border-b-2 border-l-2 border-cyan-400/60 rounded-bl" />
            <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-2 border-r-2 border-brand-400/60 rounded-br" />
          </div>
          <h1 className="text-2xl font-bold gradient-text tracking-tight">ContentBot</h1>
          <p className="text-dark-400 text-xs mt-1 font-mono tracking-widest uppercase">AI · WhatsApp · Dashboard</p>
        </div>

        {/* Card */}
        <div className="panel p-6 space-y-5">
          <div>
            <h2 className="text-xl font-bold text-white">Sign in</h2>
            <p className="text-dark-400 text-sm mt-0.5">Access your AI workspace</p>
          </div>

          {/* OAuth error */}
          {oauthError && (
            <div className="p-3 rounded-xl bg-amber-500/8 border border-amber-500/25 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
              <p className="text-amber-300/90 text-xs leading-relaxed">{oauthError}</p>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-dark-300 uppercase tracking-wider">Email</label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-400" />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  required
                  className="input-dark pl-10 text-sm"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-dark-300 uppercase tracking-wider">Password</label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-400" />
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="input-dark pl-10 pr-10 text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-dark-400 hover:text-dark-200 transition-colors"
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full justify-center py-3 rounded-xl text-sm font-bold mt-1"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Signing in...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  Sign In <ChevronRight className="w-4 h-4" />
                </span>
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-white/6" />
            <span className="text-dark-500 text-[11px] font-mono">OR</span>
            <div className="flex-1 h-px bg-white/6" />
          </div>

          {/* Google */}
          <button
            onClick={handleGoogleClick}
            type="button"
            className="btn-ghost w-full justify-center py-2.5 text-xs font-semibold rounded-xl hover:border-brand-500/40"
          >
            <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Continue with Google
          </button>

          {/* Feature pills */}
          <div className="flex flex-wrap gap-1.5 justify-center pt-1">
            {['Multi-Model AI', 'WhatsApp Bot', 'AI Memory', 'Skill Builder'].map(f => (
              <span key={f} className="badge badge-violet">
                <Sparkles className="w-2.5 h-2.5" />{f}
              </span>
            ))}
          </div>

          <p className="text-center text-dark-500 text-xs">
            No account?{' '}
            <Link href="/register" className="text-brand-400 hover:text-brand-300 font-semibold transition-colors">
              Create one free
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <AuthProvider>
      <Suspense fallback={
        <div className="min-h-screen bg-animated flex items-center justify-center">
          <div className="w-10 h-10 rounded-xl bg-gradient-neon animate-pulse flex items-center justify-center glow-brand">
            <Zap className="w-5 h-5 text-white" />
          </div>
        </div>
      }>
        <LoginForm />
      </Suspense>
    </AuthProvider>
  )
}
