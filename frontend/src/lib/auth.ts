/**
 * Where the API lives.
 *
 * Same origin by default: the gateway (scripts/gateway.js) serves the frontend and
 * forwards /api and /socket.io to the backend, so the public site, a tunnel and
 * localhost all work through one URL with no CORS and no build-time addresses.
 *
 * The two ports below are the "I am talking to `next dev` directly" case, which is
 * why they still reach the API on its own port.
 */
const DIRECT_DEV_PORTS = ['3000', '3001', '3002']

const directDev = (): boolean =>
  typeof window !== 'undefined' && DIRECT_DEV_PORTS.includes(window.location.port)

export const getApiUrl = () => {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL.replace(/\/+$/, '')
  if (typeof window === 'undefined') return 'http://localhost:5000/api'
  if (directDev()) return `${window.location.protocol}//${window.location.hostname}:5000/api`
  return '/api'
}

export const getSocketUrl = () => {
  if (process.env.NEXT_PUBLIC_SOCKET_URL) return process.env.NEXT_PUBLIC_SOCKET_URL.replace(/\/+$/, '')
  if (typeof window === 'undefined') return 'http://localhost:5000'
  if (directDev()) return `${window.location.protocol}//${window.location.hostname}:5000`
  return window.location.origin
}

export interface User {
  _id: string
  name: string
  email: string
  role: 'admin' | 'user'
  phone?: string
  avatar?: string
  isActive: boolean
  /** The raw agent-platform key never leaves the server; these two describe it. */
  hasContentbotApiKey?: boolean
  contentbotApiKeyMasked?: string
  businessInfo?: Record<string, string>
  chatSettings?: { model: string; temperature: number; systemPrompt: string }
  subscription?: {
    tier: string
    status: string
    startDate?: string
    expiresAt?: string
  }
  tokenQuota?: {
    weeklyLimit: number
    tokensUsed7d: number
    lastResetDate: string
  }
  lastSeen: string
  createdAt: string
}

export interface ApiError extends Error {
  status?: number
  code?: string
}

export async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
  const res = await fetch(`${getApiUrl()}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })

  let data: any = null
  try {
    data = await res.json()
  } catch {
    data = null
  }

  if (!res.ok) {
    // Codes let the UI react to a specific failure (e.g. LM_STARTING) instead of
    // parsing English out of the message.
    const error = new Error(data?.message || `Request failed (${res.status})`) as ApiError
    error.status = res.status
    error.code = data?.code
    throw error
  }
  return data as T
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('token')
}

export function setToken(token: string): void {
  if (typeof window !== 'undefined') localStorage.setItem('token', token)
}

export function removeToken(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
  }
}

export function getUser(): User | null {
  if (typeof window === 'undefined') return null
  const u = localStorage.getItem('user')
  return u ? JSON.parse(u) : null
}

export function setUser(user: User): void {
  if (typeof window !== 'undefined') localStorage.setItem('user', JSON.stringify(user))
}
