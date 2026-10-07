export const getApiUrl = () => {
  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname}:5000/api`
  }
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api'
}

export const getSocketUrl = () => {
  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname}:5000`
  }
  return process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:5000'
}

export interface User {
  _id: string
  name: string
  email: string
  role: 'admin' | 'user'
  phone?: string
  avatar?: string
  isActive: boolean
  contentbotApiKey?: string
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
  const data = await res.json()
  if (!res.ok) throw new Error(data.message || 'Request failed')
  return data
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
