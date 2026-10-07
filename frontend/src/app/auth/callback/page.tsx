'use client'
import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { setToken } from '@/lib/auth'
import { Zap } from 'lucide-react'

function CallbackHandler() {
  const router = useRouter()
  const params = useSearchParams()

  useEffect(() => {
    const token = params.get('token')
    if (token) {
      setToken(token)
      router.push('/dashboard')
    } else {
      router.push('/login?error=oauth')
    }
  }, [params, router])

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-brand-500 to-purple-600 flex items-center justify-center glow-brand animate-pulse">
        <Zap className="w-6 h-6 text-white" />
      </div>
      <p className="text-dark-300">Authenticating...</p>
    </div>
  )
}

export default function AuthCallbackPage() {
  return (
    <div className="min-h-screen bg-animated flex items-center justify-center">
      <Suspense
        fallback={
          <div className="text-dark-300 flex items-center gap-2">
            <Zap className="w-5 h-5 text-brand-400 animate-spin" />
            Loading authentication...
          </div>
        }
      >
        <CallbackHandler />
      </Suspense>
    </div>
  )
}
